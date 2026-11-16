import { randomInt } from 'node:crypto';
import { Client, Query, Storage, TablesDB } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import {
  cleanSubject,
  decodeWords,
  extractMessageIds,
  hashId,
  normalizeMessageId,
  parseAddress,
  plusTag,
  previewOf,
  safeFileName,
  sameAddress,
  stripTag,
  subjectRef
} from './email.js';

const DATABASE_ID = process.env.MAILROOM_DATABASE_ID || 'mailroom';
const BUCKET_ID = process.env.MAILROOM_BUCKET_ID || 'attachments';
const MAX_BODY_CHARS = 4_000_000;
const MAX_ATTACHMENTS = 40;

// Senders that must never open a conversation, to avoid reply loops.
const IGNORED_SENDERS = (process.env.MAILROOM_IGNORED_SENDERS || '')
  .split(',')
  .map((address) => address.trim().toLowerCase())
  .filter(Boolean);

export default async ({ req, res, log, error }) => {
  if (req.headers['x-appwrite-trigger'] !== 'email') {
    return res.json({ service: 'mailroom-inbound', ok: true });
  }

  const form = await new Response(req.bodyBinary, {
    headers: { 'content-type': req.headers['content-type'] }
  }).formData();
  const email = JSON.parse(form.get('email'));

  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(req.headers['x-appwrite-key']);
  const db = new TablesDB(client);
  const storage = new Storage(client);

  const messageId = normalizeMessageId(email.messageId);
  const deliveryKey = messageId || email.id;
  const messageRowId = hashId('m', deliveryKey);

  if (await getRow(db, 'messages', messageRowId)) {
    log(`Duplicate delivery of ${deliveryKey}, already filed.`);
    return res.json({ ok: true, duplicate: true });
  }

  const sender = senderOf(email);
  if (sender.email.endsWith('.appwrite.email') || IGNORED_SENDERS.includes(sender.email)) {
    log(`Ignoring email from ${sender.email} to avoid a reply loop.`);
    return res.json({ ok: true, ignored: true });
  }

  const recipients = email.envelope?.to?.length ? email.envelope.to : [req.headers['x-appwrite-email-recipient']];
  const mailbox = stripTag(recipients.find(Boolean) ?? '');
  const subject = decodeWords(email.subject);
  const receivedAt = new Date(email.receivedAt || Date.now()).toISOString();
  const preview = previewOf(email.text, email.html);
  const isSpam = email.spam?.verdict === 'spam';

  const customer = await upsertCustomer(db, sender, receivedAt);

  let conversation = await findConversation(db, { email, sender, recipients, subject });
  let isNewConversation = false;
  if (!conversation) {
    ({ row: conversation } = await createConversation(db, hashId('c', deliveryKey), {
      subject: cleanSubject(subject),
      status: isSpam ? 'spam' : 'open',
      mailbox,
      customerId: customer.$id,
      customerEmail: sender.email,
      customerName: sender.name || customer.name || '',
      tags: [],
      preview,
      lastMessageAt: receivedAt,
      lastDirection: 'inbound',
      messageCount: 1,
      seen: false,
      spamScore: typeof email.spam?.score === 'number' ? email.spam.score : null
    }));
    isNewConversation = true;
  }

  const attachments = await saveAttachments(storage, form, email.attachments ?? [], deliveryKey, error);

  try {
    await db.createRow({
      databaseId: DATABASE_ID,
      tableId: 'messages',
      rowId: messageRowId,
      data: {
        conversationId: conversation.$id,
        direction: 'inbound',
        fromEmail: sender.email,
        fromName: sender.name,
        recipients: decodeWords(email.to).slice(0, 1024),
        cc: decodeWords(email.cc).slice(0, 1024),
        subject: subject.slice(0, 512),
        text: String(email.text ?? '').slice(0, MAX_BODY_CHARS),
        html: String(email.html ?? '').slice(0, MAX_BODY_CHARS),
        messageId,
        attachments: JSON.stringify(attachments),
        deliveryId: String(email.id ?? '').slice(0, 64),
        spamVerdict: email.spam?.verdict ?? ''
      }
    });
  } catch (err) {
    if (err.code === 409) return res.json({ ok: true, duplicate: true });
    throw err;
  }

  if (isNewConversation) {
    await db.incrementRowColumn({
      databaseId: DATABASE_ID,
      tableId: 'customers',
      rowId: customer.$id,
      column: 'conversationCount',
      value: 1
    });
  } else {
    await db.updateRow({
      databaseId: DATABASE_ID,
      tableId: 'conversations',
      rowId: conversation.$id,
      data: {
        preview,
        lastMessageAt: receivedAt,
        lastDirection: 'inbound',
        seen: false,
        // A customer reply reopens pending and closed conversations.
        status: conversation.status === 'spam' ? 'spam' : 'open'
      }
    });
    await db.incrementRowColumn({
      databaseId: DATABASE_ID,
      tableId: 'conversations',
      rowId: conversation.$id,
      column: 'messageCount',
      value: 1
    });
  }

  log(`Filed ${deliveryKey} from ${sender.email} into #${conversation.ref} (${isNewConversation ? 'new' : 'reply'}).`);
  return res.json({ ok: true, conversationId: conversation.$id, ref: conversation.ref });
};

// Reply-To wins over From, so contact forms that send on behalf of a customer
// open the conversation with the customer instead of the form service.
function senderOf(email) {
  const replyTo = parseAddress(email.replyTo);
  const from = parseAddress(email.from);
  if (replyTo.email) return { email: replyTo.email, name: replyTo.name || from.name };
  if (from.email) return from;
  return { email: String(email.envelope?.from || 'unknown-sender').toLowerCase(), name: '' };
}

async function findConversation(db, { email, sender, recipients, subject }) {
  // 1. Replies to Mailroom go to support+<ref>@…, set as the reply-to address.
  for (const recipient of recipients) {
    const conversation = await conversationByRef(db, plusTag(recipient));
    if (conversation && sameAddress(conversation.customerEmail, sender.email)) return conversation;
  }

  // 2. Standard threading headers that point at a message we already filed.
  const ids = extractMessageIds([...(email.headers?.['in-reply-to'] ?? []), ...(email.headers?.references ?? [])]);
  if (ids.length) {
    const { rows } = await db.listRows({
      databaseId: DATABASE_ID,
      tableId: 'messages',
      queries: [Query.equal('messageId', ids.slice(-50)), Query.select(['conversationId']), Query.limit(1)],
      total: false
    });
    const conversation = rows[0] && (await getRow(db, 'conversations', rows[0].conversationId));
    if (conversation) return conversation;
  }

  // 3. The "[#482913]" token Mailroom adds to reply subjects.
  const conversation = await conversationByRef(db, subjectRef(subject));
  if (conversation && sameAddress(conversation.customerEmail, sender.email)) return conversation;

  return null;
}

async function conversationByRef(db, ref) {
  if (!ref) return null;
  const { rows } = await db.listRows({
    databaseId: DATABASE_ID,
    tableId: 'conversations',
    queries: [Query.equal('ref', ref), Query.limit(1)],
    total: false
  });
  return rows[0] ?? null;
}

async function createConversation(db, rowId, data) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const row = await db.createRow({
        databaseId: DATABASE_ID,
        tableId: 'conversations',
        rowId,
        data: { ...data, ref: String(randomInt(100000, 1000000)) }
      });
      return { row };
    } catch (err) {
      if (err.code !== 409) throw err;
      // Either an earlier attempt at this delivery created it, or the ref collided.
      const existing = await getRow(db, 'conversations', rowId);
      if (existing) return { row: existing };
    }
  }
  throw new Error('Could not allocate a unique conversation reference.');
}

async function upsertCustomer(db, sender, contactAt) {
  const rowId = hashId('p', sender.email);
  const existing = await getRow(db, 'customers', rowId);
  if (existing) {
    return db.updateRow({
      databaseId: DATABASE_ID,
      tableId: 'customers',
      rowId,
      data: { lastContactAt: contactAt, ...(sender.name && !existing.name ? { name: sender.name } : {}) }
    });
  }

  try {
    return await db.createRow({
      databaseId: DATABASE_ID,
      tableId: 'customers',
      rowId,
      data: { email: sender.email, name: sender.name, conversationCount: 0, lastContactAt: contactAt }
    });
  } catch (err) {
    if (err.code !== 409) throw err;
    const { rows } = await db.listRows({
      databaseId: DATABASE_ID,
      tableId: 'customers',
      queries: [Query.equal('email', sender.email), Query.limit(1)],
      total: false
    });
    if (!rows[0]) throw err;
    return rows[0];
  }
}

// Appwrite does not keep attachments, so copy each one into Storage.
async function saveAttachments(storage, form, attachments, deliveryKey, error) {
  const saved = [];
  for (const attachment of attachments.slice(0, MAX_ATTACHMENTS)) {
    const part = form.get(attachment.id);
    if (!part || typeof part === 'string' || part.size === 0) continue;

    const fileId = hashId('f', `${deliveryKey}:${attachment.id}`);
    const name = safeFileName(decodeWords(attachment.name));
    try {
      await storage.createFile({
        bucketId: BUCKET_ID,
        fileId,
        file: InputFile.fromBuffer(Buffer.from(await part.arrayBuffer()), name)
      });
    } catch (err) {
      if (err.code !== 409) {
        error(`Could not store attachment ${name}: ${err.message}`);
        continue;
      }
    }

    saved.push({
      fileId,
      name,
      contentType: attachment.contentType || 'application/octet-stream',
      size: attachment.size ?? part.size,
      contentId: attachment.contentId || '',
      inline: attachment.disposition === 'inline'
    });
  }
  return saved;
}

async function getRow(db, tableId, rowId) {
  try {
    return await db.getRow({ databaseId: DATABASE_ID, tableId, rowId });
  } catch (err) {
    if (err.code === 404) return null;
    throw err;
  }
}
