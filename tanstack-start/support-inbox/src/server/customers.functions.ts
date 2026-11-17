import { createServerFn } from '@tanstack/react-start'
import { notFound } from '@tanstack/react-router'
import { Query } from 'node-appwrite'
import { z } from 'zod'
import { DATABASE_ID, TABLES, admin, getRowOrNull, requireAgent, toConversation, toCustomer } from './appwrite.server'

const PAGE_SIZE = 30

export const listCustomers = createServerFn({ method: 'GET' })
  .validator(z.object({ q: z.string().trim().max(200).optional(), page: z.number().int().min(1).max(400).default(1) }))
  .handler(async ({ data }) => {
    await requireAgent()
    const search = data.q?.toLowerCase()
    const { rows, total } = await admin().db.listRows({
      databaseId: DATABASE_ID,
      tableId: TABLES.customers,
      queries: [
        ...(search ? [Query.or([Query.contains('email', search), Query.contains('name', data.q!)])] : []),
        Query.orderDesc('lastContactAt'),
        Query.limit(PAGE_SIZE),
        Query.offset((data.page - 1) * PAGE_SIZE),
      ],
    })
    return { customers: rows.map(toCustomer), total, page: data.page, pageSize: PAGE_SIZE }
  })

export const getCustomer = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().min(1).max(36) }))
  .handler(async ({ data }) => {
    await requireAgent()
    const row = await getRowOrNull(TABLES.customers, data.id)
    if (!row) throw notFound()
    const { rows } = await admin().db.listRows({
      databaseId: DATABASE_ID,
      tableId: TABLES.conversations,
      queries: [Query.equal('customerId', data.id), Query.orderDesc('lastMessageAt'), Query.limit(50)],
      total: false,
    })
    return { customer: toCustomer(row), conversations: rows.map(toConversation) }
  })
