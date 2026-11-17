import { Client, Permission, Query, Role, Storage, TablesDB, Teams, Users } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import { decodeWords, hashId, normalizeMessageId, parseAddress, parseReceipt } from './parse.js';

const DATABASE_ID = process.env.OUTLAY_DATABASE_ID || 'outlay';
const BUCKET_ID = process.env.OUTLAY_BUCKET_ID || 'receipts';
const TEAM_ID = process.env.OUTLAY_TEAM_ID || 'workspace';
const RECEIPT_TYPES = /^(image\/(png|jpe?g|gif|webp|heic|heif|avif)|application\/pdf)$/i;
const MAX_RECEIPTS = 10;

export default async ({ req, res, log, error }) => {
  if (req.headers['x-appwrite-trigger'] !== 'email') {
    return res.json({ service: 'outlay-receipts', ok: true });
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
  const teams = new Teams(client);

  // Only workspace members can file receipts; everyone else is ignored.
  const sender = parseAddress(email.from).email || String(email.envelope?.from ?? '').toLowerCase();
  const member = sender ? await findMember(new Users(client), teams, sender) : null;
  if (!member) {
    log(`Ignoring email from ${sender || 'an unknown sender'}: not a workspace member.`);
    return res.json({ ok: true, ignored: true });
  }

  const prefs = await teams.getPrefs({ teamId: TEAM_ID }).catch(() => ({}));
  const subject = decodeWords(email.subject);
  const parsed = parseReceipt({
    subject,
    text: email.text,
    html: email.html,
    date: email.date,
    receivedAt: email.receivedAt,
    defaultCurrency: typeof prefs.currency === 'string' && prefs.currency ? prefs.currency : 'USD'
  });

  const deliveryKey = normalizeMessageId(email.messageId) || email.id;
  const files = (email.attachments ?? [])
    .filter((attachment) => RECEIPT_TYPES.test(attachment.contentType) && attachment.disposition !== 'inline')
    .slice(0, MAX_RECEIPTS);

  // One draft per attached receipt; an email without attachments becomes one
  // draft that keeps the email itself as the receipt.
  const receipts = files.length ? files : [null];
  const created = [];
  for (const attachment of receipts) {
    const part = attachment ? `:${attachment.id}` : ':body';
    const expenseId = hashId('e', deliveryKey + part);
    if (await exists(db, expenseId)) continue;

    let receipt = {};
    if (attachment) {
      const blob = form.get(attachment.id);
      if (!blob || typeof blob === 'string' || blob.size === 0) continue;
      const fileId = hashId('r', deliveryKey + part);
      const name = decodeWords(attachment.name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || 'receipt';
      try {
        await storage.createFile({ bucketId: BUCKET_ID, fileId, file: InputFile.fromBuffer(Buffer.from(await blob.arrayBuffer()), name) });
      } catch (err) {
        if (err.code !== 409) {
          error(`Could not store ${name}: ${err.message}`);
          continue;
        }
      }
      receipt = { receiptFileId: fileId, receiptName: name, receiptType: attachment.contentType };
    }

    const permissions = [Permission.read(Role.user(member.userId))];
    try {
      await db.createRow({
        databaseId: DATABASE_ID,
        tableId: 'expenses',
        rowId: expenseId,
        permissions,
        data: {
          ownerId: member.userId,
          ownerName: member.name,
          merchant: parsed.merchant,
          amount: parsed.amount ?? 0,
          currency: parsed.currency,
          spentAt: parsed.spentAt,
          status: 'draft',
          source: 'email',
          description: receipts.length > 1 ? `From “${subject}”` : '',
          emailSubject: subject.slice(0, 512),
          emailHtml: attachment ? '' : String(email.html ?? '').slice(0, 2_000_000),
          emailText: String(email.text ?? '').slice(0, 200_000),
          ...receipt
        }
      });
    } catch (err) {
      if (err.code === 409) continue;
      throw err;
    }

    await db.createRow({
      databaseId: DATABASE_ID,
      tableId: 'events',
      rowId: hashId('v', deliveryKey + part),
      permissions,
      data: { expenseId, actorId: member.userId, actorName: member.name, action: 'created', toStatus: 'draft', comment: 'Forwarded by email' }
    }).catch((err) => err.code === 409 || Promise.reject(err));

    created.push(expenseId);
  }

  log(`Filed ${created.length} receipt(s) from ${sender}.`);
  return res.json({ ok: true, created });
};

async function findMember(users, teams, email) {
  const { users: found } = await users.list({ queries: [Query.equal('email', [email]), Query.limit(1)] });
  const user = found[0];
  if (!user) return null;
  const { memberships } = await teams.listMemberships({ teamId: TEAM_ID, queries: [Query.equal('userId', [user.$id]), Query.limit(1)] });
  return memberships[0] ? { userId: user.$id, name: user.name || user.email } : null;
}

async function exists(db, rowId) {
  try {
    await db.getRow({ databaseId: DATABASE_ID, tableId: 'expenses', rowId, queries: [Query.select(['$id'])] });
    return true;
  } catch (err) {
    if (err.code === 404) return false;
    throw err;
  }
}
