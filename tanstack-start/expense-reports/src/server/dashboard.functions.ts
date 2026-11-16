import { createServerFn } from '@tanstack/react-start'
import { Query } from 'node-appwrite'
import { DATABASE_ID, TABLES, admin, getWorkspace, listCategories, requireMember, toExpense, toReport } from './appwrite.server'

async function count(tableId: string, queries: string[]) {
  const { total } = await admin().db.listRows({ databaseId: DATABASE_ID, tableId, queries: [...queries, Query.select(['$id']), Query.limit(1)] })
  return total
}

export const getShell = createServerFn({ method: 'GET' }).handler(async () => {
  const { viewer } = await requireMember()
  const [workspace, drafts, review, reimburse] = await Promise.all([
    getWorkspace(),
    count(TABLES.expenses, [Query.equal('ownerId', viewer.id), Query.isNull('reportId'), Query.equal('status', 'draft')]),
    viewer.canApprove ? count(TABLES.reports, [Query.equal('status', 'submitted')]) : Promise.resolve(0),
    viewer.isAdmin ? count(TABLES.reports, [Query.equal('status', 'approved')]) : Promise.resolve(0),
  ])
  return { viewer, workspace, counts: { drafts, review, reimburse } }
})

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export const getDashboard = createServerFn({ method: 'GET' }).handler(async () => {
  const { viewer } = await requireMember()
  const workspace = await getWorkspace()
  const { db } = admin()

  const now = new Date()
  const months = Array.from({ length: 6 }, (_, index) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + index, 1)))
  // Approvers see the whole team's spend; members see their own.
  const scope = viewer.canApprove ? [] : [Query.equal('ownerId', viewer.id)]

  const rows = []
  for (let offset = 0; offset < 2000; offset += 500) {
    const page = await db.listRows({
      databaseId: DATABASE_ID,
      tableId: TABLES.expenses,
      queries: [
        ...scope,
        Query.greaterThanEqual('spentAt', months[0].toISOString()),
        Query.notEqual('status', 'rejected'),
        Query.select(['$id', 'amount', 'currency', 'categoryName', 'spentAt', 'status', 'ownerId']),
        Query.limit(500),
        Query.offset(offset),
      ],
      total: false,
    })
    rows.push(...page.rows)
    if (page.rows.length < 500) break
  }

  const byMonth = new Map(months.map((month) => [monthKey(month), 0]))
  const byCategory = new Map<string, number>()
  let otherCurrency = 0
  for (const row of rows) {
    if (row.currency !== workspace.currency) {
      otherCurrency++
      continue
    }
    const amount = Number(row.amount ?? 0)
    const key = monthKey(new Date(String(row.spentAt)))
    if (byMonth.has(key)) byMonth.set(key, byMonth.get(key)! + amount)
    const category = String(row.categoryName || 'Uncategorized')
    byCategory.set(category, (byCategory.get(category) ?? 0) + amount)
  }

  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1])
  const top = categories.slice(0, 6)
  const rest = categories.slice(6).reduce((sum, [, amount]) => sum + amount, 0)
  if (rest > 0) top.push(['Other', rest])

  const [categoryList, recent, pending, approved] = await Promise.all([
    listCategories(),
    db.listRows({
      databaseId: DATABASE_ID,
      tableId: TABLES.expenses,
      queries: [Query.equal('ownerId', viewer.id), Query.orderDesc('spentAt'), Query.limit(6)],
      total: false,
    }),
    db.listRows({
      databaseId: DATABASE_ID,
      tableId: TABLES.reports,
      queries: [...(viewer.canApprove ? [] : [Query.equal('ownerId', viewer.id)]), Query.equal('status', 'submitted'), Query.limit(100)],
    }),
    db.listRows({
      databaseId: DATABASE_ID,
      tableId: TABLES.reports,
      queries: [Query.equal('ownerId', viewer.id), Query.equal('status', 'approved'), Query.limit(100)],
      total: false,
    }),
  ])

  const owed = approved.rows.map(toReport).reduce((sum, report) => sum + (report.totals[workspace.currency] ?? 0), 0)
  const thisMonth = byMonth.get(monthKey(now)) ?? 0
  const lastMonth = byMonth.get(monthKey(months[4])) ?? 0

  return {
    viewer,
    currency: workspace.currency,
    scopeLabel: viewer.canApprove ? 'Team spend' : 'Your spend',
    stats: { thisMonth, lastMonth, pending: pending.total, owed },
    byMonth: [...byMonth.entries()].map(([month, amount]) => ({ month, amount })),
    byCategory: top.map(([name, amount]) => ({ name, amount })),
    otherCurrency,
    recent: recent.rows.map(toExpense),
    categories: categoryList,
  }
})
