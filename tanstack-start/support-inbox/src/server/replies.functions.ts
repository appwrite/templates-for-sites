import { createServerFn } from '@tanstack/react-start'
import { ID, Query } from 'node-appwrite'
import { z } from 'zod'
import { DATABASE_ID, TABLES, admin, requireAgent, toSavedReply } from './appwrite.server'

export const listReplies = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAgent()
  const { rows } = await admin().db.listRows({
    databaseId: DATABASE_ID,
    tableId: TABLES.replies,
    queries: [Query.orderAsc('name'), Query.limit(100)],
    total: false,
  })
  return rows.map(toSavedReply)
})

export const saveReply = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string().min(1).max(36).optional(),
      name: z.string().trim().min(1, 'Give the reply a name.').max(128),
      body: z.string().trim().min(1, 'Write the reply text.').max(16_000),
    }),
  )
  .handler(async ({ data }) => {
    await requireAgent()
    const row = await admin().db.upsertRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.replies,
      rowId: data.id ?? ID.unique(),
      data: { name: data.name, body: data.body },
    })
    return toSavedReply(row)
  })

export const deleteReply = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1).max(36) }))
  .handler(async ({ data }) => {
    await requireAgent()
    await admin().db.deleteRow({ databaseId: DATABASE_ID, tableId: TABLES.replies, rowId: data.id })
    return { ok: true }
  })
