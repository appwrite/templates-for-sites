import { createServerFn } from '@tanstack/react-start'
import { notFound } from '@tanstack/react-router'
import { ID, Query } from 'node-appwrite'
import { InputFile } from 'node-appwrite/file'
import { z } from 'zod'
import type { Attachment, ConversationStatus } from '#/lib/types'
import {
  BUCKET_ID,
  DATABASE_ID,
  TABLES,
  admin,
  defaultMailbox,
  getRowOrNull,
  getWorkspace,
  listAgents,
  requireAgent,
  toConversation,
  toCustomer,
  toMessage,
  toSavedReply,
} from './appwrite.server'
import { previewOf, renderReplyHtml, replyAddress, replySubject } from './email.server'

const STATUSES = ['open', 'pending', 'closed', 'spam'] as const
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export const getConversation = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().min(1).max(36) }))
  .handler(async ({ data }) => {
    await requireAgent()
    const { db, messaging } = admin()
    const row = await getRowOrNull(TABLES.conversations, data.id)
    if (!row) throw notFound()
    const conversation = toConversation(row)

    const [messageRows, customerRow, history, agents, replies] = await Promise.all([
      db.listRows({
        databaseId: DATABASE_ID,
        tableId: TABLES.messages,
        queries: [Query.equal('conversationId', conversation.id), Query.orderAsc('$createdAt'), Query.limit(200)],
        total: false,
      }),
      getRowOrNull(TABLES.customers, conversation.customerId),
      db.listRows({
        databaseId: DATABASE_ID,
        tableId: TABLES.conversations,
        queries: [
          Query.equal('customerId', conversation.customerId),
          Query.notEqual('$id', conversation.id),
          Query.orderDesc('lastMessageAt'),
          Query.limit(5),
        ],
        total: false,
      }),
      listAgents(),
      db.listRows({
        databaseId: DATABASE_ID,
        tableId: TABLES.replies,
        queries: [Query.orderAsc('name'), Query.limit(100)],
        total: false,
      }),
    ])

    const messages = messageRows.rows.map(toMessage)

    // Refresh delivery state for replies Messaging was still processing.
    await Promise.all(
      messages
        .filter((message) => message.direction === 'outbound' && ['processing', 'scheduled'].includes(message.deliveryStatus))
        .map(async (message) => {
          try {
            const delivery = await messaging.getMessage({ messageId: message.deliveryId })
            if (delivery.status === message.deliveryStatus) return
            message.deliveryStatus = delivery.status
            message.deliveryError = (delivery.deliveryErrors ?? []).join('; ').slice(0, 1024)
            await db.updateRow({
              databaseId: DATABASE_ID,
              tableId: TABLES.messages,
              rowId: message.id,
              data: { deliveryStatus: message.deliveryStatus, deliveryError: message.deliveryError },
            })
          } catch {
            // Keep the last known status if Messaging can't be reached.
          }
        }),
    )

    if (!conversation.seen) {
      conversation.seen = true
      await db.updateRow({ databaseId: DATABASE_ID, tableId: TABLES.conversations, rowId: conversation.id, data: { seen: true } })
    }

    return {
      conversation,
      messages,
      customer: customerRow ? toCustomer(customerRow) : null,
      history: history.rows.map(toConversation),
      agents,
      replies: replies.rows.map(toSavedReply),
    }
  })

export const updateConversation = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string().min(1).max(36),
      status: z.enum(STATUSES).optional(),
      assigneeId: z.string().max(36).nullable().optional(),
      tags: z.array(z.string().trim().toLowerCase().min(1).max(48)).max(20).optional(),
      subject: z.string().trim().min(1).max(512).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireAgent()
    const update: Record<string, unknown> = {}
    if (data.status) update.status = data.status
    if (data.tags) update.tags = [...new Set(data.tags)]
    if (data.subject) update.subject = data.subject
    if (data.assigneeId !== undefined) {
      if (data.assigneeId === null) {
        Object.assign(update, { assigneeId: null, assigneeName: '' })
      } else {
        const agent = (await listAgents()).find((candidate) => candidate.id === data.assigneeId)
        if (!agent) throw new Error('That teammate is no longer on the support team.')
        Object.assign(update, { assigneeId: agent.id, assigneeName: agent.name || agent.email })
      }
    }

    await admin().db.updateRow({ databaseId: DATABASE_ID, tableId: TABLES.conversations, rowId: data.id, data: update })
    return { ok: true }
  })

const replyInput = z.object({
  conversationId: z.string().min(1).max(36),
  body: z.string().trim().min(1, 'Write a reply first.').max(100_000),
  status: z.enum(STATUSES),
  attachments: z.array(z.instanceof(File)).max(10),
})

export const sendReply = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    if (!(input instanceof FormData)) throw new Error('Expected form data.')
    return replyInput.parse({
      conversationId: input.get('conversationId'),
      body: input.get('body'),
      status: input.get('status'),
      attachments: input.getAll('attachments').filter((file) => file instanceof File && file.size > 0),
    })
  })
  .handler(async ({ data }) => {
    const { viewer } = await requireAgent()
    const { db, storage, messaging } = admin()
    const row = await getRowOrNull(TABLES.conversations, data.conversationId)
    if (!row) throw notFound()
    const conversation = toConversation(row)
    const workspace = await getWorkspace()

    const attachments: Attachment[] = []
    for (const file of data.attachments) {
      if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} is larger than 20 MB.`)
      const fileId = ID.unique()
      await storage.createFile({
        bucketId: BUCKET_ID,
        fileId,
        file: InputFile.fromBuffer(Buffer.from(await file.arrayBuffer()), file.name),
      })
      attachments.push({
        fileId,
        name: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        contentId: '',
        inline: false,
      })
    }

    const subject = replySubject(conversation.subject, conversation.ref)
    const html = renderReplyHtml(data.body, viewer.signature)
    const mailbox = conversation.mailbox || workspace.mailbox
    const replyTo = mailbox || defaultMailbox()

    // Replies go out through Messaging; the customer's answer comes back to
    // support+<ref>@… so the email trigger files it into this conversation.
    const deliveryId = ID.unique()
    let deliveryStatus = 'processing'
    let deliveryError = ''
    try {
      const delivery = await messaging.createEmail({
        messageId: deliveryId,
        subject,
        content: html,
        html: true,
        emails: [conversation.customerEmail],
        // Without a support address (possible on self-hosted), replies carry no reply-to.
        ...(replyTo ? { replyToEmail: replyAddress(replyTo, conversation.ref), replyToName: workspace.replyToName || workspace.name } : {}),
        attachments: attachments.map((attachment) => `${BUCKET_ID}:${attachment.fileId}`),
      })
      deliveryStatus = delivery.status
    } catch (error) {
      deliveryStatus = 'failed'
      deliveryError = error instanceof Error ? error.message.slice(0, 1024) : 'Messaging rejected the email.'
    }

    const now = new Date().toISOString()
    await db.createRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.messages,
      rowId: ID.unique(),
      data: {
        conversationId: conversation.id,
        direction: 'outbound',
        fromEmail: mailbox,
        fromName: viewer.name,
        recipients: conversation.customerEmail,
        subject,
        text: viewer.signature ? `${data.body}\n\n${viewer.signature}` : data.body,
        html,
        authorId: viewer.id,
        authorName: viewer.name,
        attachments: JSON.stringify(attachments),
        deliveryId,
        deliveryStatus,
        deliveryError,
      },
    })

    await db.updateRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.conversations,
      rowId: conversation.id,
      data: {
        status: data.status satisfies ConversationStatus,
        preview: previewOf(data.body),
        lastMessageAt: now,
        lastDirection: 'outbound',
        seen: true,
        // Replying to an unassigned conversation claims it.
        ...(conversation.assigneeId ? {} : { assigneeId: viewer.id, assigneeName: viewer.name }),
      },
    })
    await db.incrementRowColumn({
      databaseId: DATABASE_ID,
      tableId: TABLES.conversations,
      rowId: conversation.id,
      column: 'messageCount',
      value: 1,
    })

    return { ok: deliveryStatus !== 'failed', deliveryStatus, deliveryError }
  })

export const addNote = createServerFn({ method: 'POST' })
  .validator(z.object({ conversationId: z.string().min(1).max(36), body: z.string().trim().min(1).max(20_000) }))
  .handler(async ({ data }) => {
    const { viewer } = await requireAgent()
    await admin().db.createRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.messages,
      rowId: ID.unique(),
      data: {
        conversationId: data.conversationId,
        direction: 'note',
        fromEmail: viewer.email,
        fromName: viewer.name,
        text: data.body,
        authorId: viewer.id,
        authorName: viewer.name,
        attachments: '[]',
      },
    })
    return { ok: true }
  })

export const updateCustomerNotes = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string().min(1).max(36),
      name: z.string().trim().max(255).optional(),
      notes: z.string().max(16_000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireAgent()
    const update: Record<string, string> = {}
    if (data.name !== undefined) update.name = data.name
    if (data.notes !== undefined) update.notes = data.notes
    await admin().db.updateRow({ databaseId: DATABASE_ID, tableId: TABLES.customers, rowId: data.id, data: update })
    return { ok: true }
  })
