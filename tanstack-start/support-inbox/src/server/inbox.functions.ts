import { createServerFn } from '@tanstack/react-start'
import { Query } from 'node-appwrite'
import { z } from 'zod'
import { FOLDERS, type Folder, type FolderCounts } from '#/lib/types'
import { DATABASE_ID, TABLES, admin, emailSetupStatus, getWorkspace, requireAgent, toConversation } from './appwrite.server'

export const PAGE_SIZE = 25

function folderQueries(folder: Folder, viewerId: string) {
  switch (folder) {
    case 'unassigned':
      return [Query.equal('status', 'open'), Query.isNull('assigneeId')]
    // Your own pending conversations stay in Mine while you wait on the customer.
    case 'mine':
      return [Query.equal('assigneeId', viewerId), Query.equal('status', ['open', 'pending'])]
    case 'open':
      return [Query.equal('status', 'open')]
    default:
      return [Query.equal('status', folder)]
  }
}

async function countRows(queries: string[]) {
  const { total } = await admin().db.listRows({
    databaseId: DATABASE_ID,
    tableId: TABLES.conversations,
    queries: [...queries, Query.select(['$id']), Query.limit(1)],
  })
  return total
}

export const getShell = createServerFn({ method: 'GET' }).handler(async () => {
  const { viewer } = await requireAgent()
  const counted = ['unassigned', 'mine', 'open', 'pending', 'spam'] as const
  const [workspace, setup, ...totals] = await Promise.all([
    getWorkspace(),
    // Only admins can finish setup, so only they see the checklist.
    viewer.isAdmin ? emailSetupStatus() : Promise.resolve(null),
    ...counted.map((folder) => countRows(folderQueries(folder, viewer.id))),
  ])
  const counts = Object.fromEntries(counted.map((folder, index) => [folder, totals[index]])) as unknown as FolderCounts
  return { viewer, workspace, counts, setup }
})

export const listConversations = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      folder: z.enum(FOLDERS),
      q: z.string().trim().max(200).optional(),
      tag: z.string().trim().max(48).optional(),
      page: z.number().int().min(1).max(400).default(1),
    }),
  )
  .handler(async ({ data }) => {
    const { viewer } = await requireAgent()
    const queries: string[] = []
    const search = data.q?.replace(/^#/, '')

    // A search looks across every folder, like a mailbox search bar.
    if (search) {
      if (/^\d{6}$/.test(search)) queries.push(Query.equal('ref', search))
      else if (search.includes('@')) queries.push(Query.contains('customerEmail', search.toLowerCase()))
      else queries.push(Query.search('subject', search))
    } else {
      queries.push(...folderQueries(data.folder, viewer.id))
    }
    if (data.tag) queries.push(Query.contains('tags', [data.tag]))

    const { rows, total } = await admin().db.listRows({
      databaseId: DATABASE_ID,
      tableId: TABLES.conversations,
      queries: [...queries, Query.orderDesc('lastMessageAt'), Query.limit(PAGE_SIZE), Query.offset((data.page - 1) * PAGE_SIZE)],
    })
    return { conversations: rows.map(toConversation), total, page: data.page, pageSize: PAGE_SIZE }
  })

export const bulkUpdateConversations = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      ids: z.array(z.string().min(1).max(36)).min(1).max(PAGE_SIZE),
      action: z.enum(['open', 'pending', 'closed', 'spam', 'assign-me', 'unassign']),
    }),
  )
  .handler(async ({ data }) => {
    const { viewer } = await requireAgent()
    const update =
      data.action === 'assign-me'
        ? { assigneeId: viewer.id, assigneeName: viewer.name }
        : data.action === 'unassign'
          ? { assigneeId: null, assigneeName: '' }
          : { status: data.action }

    const { db } = admin()
    await Promise.all(
      data.ids.map((rowId) => db.updateRow({ databaseId: DATABASE_ID, tableId: TABLES.conversations, rowId, data: update })),
    )
    return { ok: true, updated: data.ids.length }
  })
