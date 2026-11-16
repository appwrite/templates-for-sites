import { randomInt, randomUUID } from 'node:crypto'
import { AppwriteException, Query, type Models } from 'node-appwrite'
import { InputFile } from 'node-appwrite/file'
import {
  cleanSubject,
  extractMessageIds,
  hashId,
  normalizeMessageId,
  plusTag,
  previewOf,
  safeFileName,
  sameAddress,
  subjectRef,
} from '../../inbound-function/src/email.js'
import type { Attachment } from '#/lib/types'
import { BUCKET_ID, DATABASE_ID, TABLES, admin, getRowOrNull } from './appwrite.server'

export const MAX_FILES = 10
export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const MAX_METADATA_CHARS = 64 * 1024
const MAX_BODY_CHARS = 100_000

// One ticket request: everything an email carries, plus free-form metadata.
export interface IncomingMessage {
  // "api" follows the documented fields; "webhook" is an email forwarded by a provider.
  source: 'api' | 'webhook'
  email: string
  name: string
  subject: string
  text: string
  html: string
  cc: string[]
  metadata: string
  // Explicit #ref, plus-tagged recipients and threading headers, used to find an existing ticket.
  ref: string
  recipients: string[]
  messageId: string
  inReplyTo: string[]
  mailbox: string
  idempotencyKey: string
  files: File[]
}

// Files a message the same way the inbound function files an email: the same
// customer IDs, threading rules and idempotent writes.
export async function fileMessage(input: IncomingMessage) {
  const { db } = admin()
  const messageId = normalizeMessageId(input.messageId)
  const deliveryKey = messageId || (input.idempotencyKey ? `http:${input.idempotencyKey}` : `http:${randomUUID()}`)
  const messageRowId = hashId('m', deliveryKey)

  const existing = await getRowOrNull(TABLES.messages, messageRowId)
  if (existing) {
    const conversation = await getRowOrNull(TABLES.conversations, String(existing.conversationId))
    return { conversationId: String(existing.conversationId), ref: String(conversation?.ref ?? ''), created: false, duplicate: true }
  }

  const receivedAt = new Date().toISOString()
  const preview = previewOf(input.text, input.html)
  const customer = await upsertCustomer(input.email, input.name, receivedAt)

  let conversation = await findConversation(input)
  const threaded = Boolean(conversation)
  if (!conversation) {
    conversation = await createConversation(hashId('c', deliveryKey), {
      subject: cleanSubject(input.subject),
      status: 'open',
      mailbox: input.mailbox,
      customerId: customer.$id,
      customerEmail: input.email,
      customerName: input.name || String(customer.name ?? ''),
      tags: [],
      preview,
      lastMessageAt: receivedAt,
      lastDirection: 'inbound',
      messageCount: 1,
      seen: false,
      spamScore: null,
    })
  }

  const attachments = await saveFiles(input.files, deliveryKey)
  try {
    await db.createRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.messages,
      rowId: messageRowId,
      data: {
        conversationId: conversation.$id,
        direction: 'inbound',
        fromEmail: input.email,
        fromName: input.name,
        recipients: input.recipients.join(', ').slice(0, 1024),
        cc: input.cc.join(', ').slice(0, 1024),
        subject: input.subject.slice(0, 512),
        text: input.text.slice(0, MAX_BODY_CHARS),
        html: input.html.slice(0, MAX_BODY_CHARS),
        messageId,
        attachments: JSON.stringify(attachments),
        source: input.source,
        metadata: input.metadata,
      },
    })
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 409) {
      return { conversationId: conversation.$id, ref: String(conversation.ref), created: !threaded, duplicate: true }
    }
    throw error
  }

  if (threaded) {
    await db.updateRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.conversations,
      rowId: conversation.$id,
      data: {
        preview,
        lastMessageAt: receivedAt,
        lastDirection: 'inbound',
        seen: false,
        // A customer reply reopens pending and closed conversations.
        status: conversation.status === 'spam' ? 'spam' : 'open',
      },
    })
    await db.incrementRowColumn({ databaseId: DATABASE_ID, tableId: TABLES.conversations, rowId: conversation.$id, column: 'messageCount', value: 1 })
  } else {
    await db.incrementRowColumn({ databaseId: DATABASE_ID, tableId: TABLES.customers, rowId: customer.$id, column: 'conversationCount', value: 1 })
  }

  return { conversationId: conversation.$id, ref: String(conversation.ref), created: !threaded, duplicate: false }
}

// Like email, a message only joins a conversation that belongs to its sender.
async function findConversation(input: IncomingMessage) {
  const { db } = admin()
  const refs = [input.ref, ...input.recipients.map(plusTag), subjectRef(input.subject)].filter(Boolean)
  for (const ref of new Set(refs)) {
    const { rows } = await db.listRows({
      databaseId: DATABASE_ID,
      tableId: TABLES.conversations,
      queries: [Query.equal('ref', ref), Query.limit(1)],
      total: false,
    })
    if (rows[0] && sameAddress(String(rows[0].customerEmail), input.email)) return rows[0]
  }

  const ids = extractMessageIds(input.inReplyTo)
  if (ids.length) {
    const { rows } = await db.listRows({
      databaseId: DATABASE_ID,
      tableId: TABLES.messages,
      queries: [Query.equal('messageId', ids.slice(-50)), Query.select(['conversationId']), Query.limit(1)],
      total: false,
    })
    const conversation = rows[0] && (await getRowOrNull(TABLES.conversations, String(rows[0].conversationId)))
    if (conversation && sameAddress(String(conversation.customerEmail), input.email)) return conversation
  }
  return null
}

async function createConversation(rowId: string, data: Record<string, unknown>): Promise<Models.DefaultRow> {
  const { db } = admin()
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await db.createRow({
        databaseId: DATABASE_ID,
        tableId: TABLES.conversations,
        rowId,
        data: { ...data, ref: String(randomInt(100000, 1000000)) },
      })
    } catch (error) {
      if (!(error instanceof AppwriteException) || error.code !== 409) throw error
      // Either a retry of this request created it, or the ref collided.
      const existing = await getRowOrNull(TABLES.conversations, rowId)
      if (existing) return existing
    }
  }
  throw new Error('Could not allocate a unique conversation reference.')
}

async function upsertCustomer(email: string, name: string, contactAt: string) {
  const { db } = admin()
  const rowId = hashId('p', email)
  const existing = await getRowOrNull(TABLES.customers, rowId)
  if (existing) {
    return db.updateRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.customers,
      rowId,
      data: { lastContactAt: contactAt, ...(name && !existing.name ? { name } : {}) },
    })
  }
  try {
    return await db.createRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.customers,
      rowId,
      data: { email, name, conversationCount: 0, lastContactAt: contactAt },
    })
  } catch (error) {
    if (!(error instanceof AppwriteException) || error.code !== 409) throw error
    const { rows } = await db.listRows({
      databaseId: DATABASE_ID,
      tableId: TABLES.customers,
      queries: [Query.equal('email', email), Query.limit(1)],
      total: false,
    })
    if (!rows[0]) throw error
    return rows[0]
  }
}

async function saveFiles(files: File[], deliveryKey: string) {
  const { storage } = admin()
  const saved: Attachment[] = []
  for (const [index, file] of files.slice(0, MAX_FILES).entries()) {
    const fileId = hashId('f', `${deliveryKey}:${index}`)
    const name = safeFileName(file.name)
    try {
      await storage.createFile({ bucketId: BUCKET_ID, fileId, file: InputFile.fromBuffer(Buffer.from(await file.arrayBuffer()), name) })
    } catch (error) {
      if (!(error instanceof AppwriteException) || error.code !== 409) throw error
    }
    saved.push({ fileId, name, contentType: file.type || 'application/octet-stream', size: file.size, contentId: '', inline: false })
  }
  return saved
}
