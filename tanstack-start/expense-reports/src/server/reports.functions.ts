import { createServerFn } from '@tanstack/react-start'
import { notFound } from '@tanstack/react-router'
import { ID, Query } from 'node-appwrite'
import { z } from 'zod'
import type { Status } from '#/lib/types'
import {
  DATABASE_ID,
  TABLES,
  admin,
  getRowOrNull,
  ownerPermissions,
  recordEvent,
  requireAdmin,
  requireApprover,
  requireMember,
  toEvent,
  toExpense,
  toReport,
  totalsOf,
  type MemberContext,
} from './appwrite.server'

const id = z.string().min(1).max(36)
const EDITABLE: Status[] = ['draft', 'rejected']

async function reportExpenses(reportId: string) {
  const { rows } = await admin().db.listRows({
    databaseId: DATABASE_ID,
    tableId: TABLES.expenses,
    queries: [Query.equal('reportId', reportId), Query.orderAsc('spentAt'), Query.limit(200)],
    total: false,
  })
  return rows.map(toExpense)
}

async function loadReport(reportId: string) {
  const row = await getRowOrNull(TABLES.reports, reportId)
  if (!row) throw notFound()
  return toReport(row)
}

// Keeps the report's cached totals and count in step with its expenses.
async function refreshTotals(reportId: string) {
  const expenses = await reportExpenses(reportId)
  await admin().db.updateRow({
    databaseId: DATABASE_ID,
    tableId: TABLES.reports,
    rowId: reportId,
    data: { totals: JSON.stringify(totalsOf(expenses)), expenseCount: expenses.length },
  })
  return expenses
}

async function setStatus(reportId: string, expenses: { id: string }[], status: Status, extra: Record<string, unknown> = {}) {
  const { db } = admin()
  await db.updateRow({ databaseId: DATABASE_ID, tableId: TABLES.reports, rowId: reportId, data: { status, ...extra } })
  await Promise.all(
    expenses.map((expense) => db.updateRow({ databaseId: DATABASE_ID, tableId: TABLES.expenses, rowId: expense.id, data: { status } })),
  )
}

function canSee(member: MemberContext, ownerId: string) {
  return member.viewer.canApprove || ownerId === member.viewer.id
}

export const listReports = createServerFn({ method: 'GET' })
  .validator(z.object({ scope: z.enum(['mine', 'all', 'review', 'reimburse']).default('mine') }))
  .handler(async ({ data }) => {
    const { viewer } = await requireMember()
    const scope = viewer.canApprove ? data.scope : 'mine'
    const queries =
      scope === 'mine'
        ? [Query.equal('ownerId', viewer.id)]
        : scope === 'review'
          ? [Query.equal('status', 'submitted')]
          : scope === 'reimburse'
            ? [Query.equal('status', 'approved')]
            : []
    const { rows, total } = await admin().db.listRows({
      databaseId: DATABASE_ID,
      tableId: TABLES.reports,
      queries: [...queries, Query.orderDesc('$updatedAt'), Query.limit(100)],
    })
    return { reports: rows.map(toReport), total, scope }
  })

export const getReport = createServerFn({ method: 'GET' })
  .validator(z.object({ id }))
  .handler(async ({ data }) => {
    const member = await requireMember()
    const { viewer } = member
    const report = await loadReport(data.id)
    if (!canSee(member, report.ownerId)) throw notFound()

    const isOwner = report.ownerId === viewer.id
    const editable = isOwner && EDITABLE.includes(report.status)
    const [expenses, events, available] = await Promise.all([
      reportExpenses(report.id),
      admin().db.listRows({
        databaseId: DATABASE_ID,
        tableId: TABLES.events,
        queries: [Query.equal('reportId', report.id), Query.orderDesc('$createdAt'), Query.limit(100)],
        total: false,
      }),
      editable
        ? admin().db.listRows({
            databaseId: DATABASE_ID,
            tableId: TABLES.expenses,
            queries: [Query.equal('ownerId', viewer.id), Query.isNull('reportId'), Query.equal('status', 'draft'), Query.orderDesc('spentAt'), Query.limit(100)],
            total: false,
          })
        : Promise.resolve({ rows: [] }),
    ])

    return {
      report,
      expenses,
      events: events.rows.map(toEvent),
      available: available.rows.map(toExpense),
      permissions: {
        edit: editable,
        submit: editable && expenses.length > 0,
        // Nobody approves their own report, except the owner of a one-person workspace.
        decide: report.status === 'submitted' && viewer.canApprove && (!isOwner || viewer.role === 'owner'),
        reimburse: report.status === 'approved' && viewer.isAdmin,
      },
    }
  })

export const createReport = createServerFn({ method: 'POST' })
  .validator(z.object({ title: z.string().trim().min(1, 'Name the report.').max(255), expenseIds: z.array(id).max(200).default([]) }))
  .handler(async ({ data }) => {
    const { viewer } = await requireMember()
    const reportId = ID.unique()
    await admin().db.createRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.reports,
      rowId: reportId,
      permissions: ownerPermissions(viewer.id),
      data: { title: data.title, ownerId: viewer.id, ownerName: viewer.name, status: 'draft', totals: '{}', expenseCount: 0 },
    })
    if (data.expenseIds.length) await attach(viewer.id, reportId, data.expenseIds)
    await refreshTotals(reportId)
    await recordEvent(viewer.id, { reportId, actorId: viewer.id, actorName: viewer.name, action: 'created', fromStatus: '', toStatus: 'draft', comment: '' })
    return { id: reportId }
  })

async function attach(ownerId: string, reportId: string, expenseIds: string[]) {
  const { db } = admin()
  for (const expenseId of expenseIds) {
    const row = await getRowOrNull(TABLES.expenses, expenseId)
    if (!row) continue
    const expense = toExpense(row)
    if (expense.ownerId !== ownerId || expense.reportId || expense.status !== 'draft') continue
    await db.updateRow({ databaseId: DATABASE_ID, tableId: TABLES.expenses, rowId: expense.id, data: { reportId } })
  }
}

export const updateReportExpenses = createServerFn({ method: 'POST' })
  .validator(z.object({ id, add: z.array(id).max(200).default([]), remove: z.array(id).max(200).default([]) }))
  .handler(async ({ data }) => {
    const { viewer } = await requireMember()
    const report = await loadReport(data.id)
    if (report.ownerId !== viewer.id || !EDITABLE.includes(report.status)) throw new Error('This report is locked.')
    await attach(viewer.id, report.id, data.add)
    const { db } = admin()
    for (const expenseId of data.remove) {
      const row = await getRowOrNull(TABLES.expenses, expenseId)
      if (row && toExpense(row).reportId === report.id) {
        await db.updateRow({ databaseId: DATABASE_ID, tableId: TABLES.expenses, rowId: expenseId, data: { reportId: null, status: 'draft' } })
      }
    }
    await refreshTotals(report.id)
    return { ok: true }
  })

export const renameReport = createServerFn({ method: 'POST' })
  .validator(z.object({ id, title: z.string().trim().min(1).max(255) }))
  .handler(async ({ data }) => {
    const { viewer } = await requireMember()
    const report = await loadReport(data.id)
    if (report.ownerId !== viewer.id || !EDITABLE.includes(report.status)) throw new Error('This report is locked.')
    await admin().db.updateRow({ databaseId: DATABASE_ID, tableId: TABLES.reports, rowId: report.id, data: { title: data.title } })
    return { ok: true }
  })

export const submitReport = createServerFn({ method: 'POST' })
  .validator(z.object({ id }))
  .handler(async ({ data }) => {
    const { viewer } = await requireMember()
    const report = await loadReport(data.id)
    if (report.ownerId !== viewer.id || !EDITABLE.includes(report.status)) throw new Error('This report can’t be submitted.')
    const expenses = await refreshTotals(report.id)
    if (expenses.length === 0) throw new Error('Add at least one expense before submitting.')
    const missing = expenses.find((expense) => expense.amount <= 0)
    if (missing) throw new Error(`Add an amount to the ${missing.merchant} expense first.`)

    await setStatus(report.id, expenses, 'submitted', { submittedAt: new Date().toISOString(), decidedAt: null, comment: '' })
    await recordEvent(viewer.id, {
      reportId: report.id,
      actorId: viewer.id,
      actorName: viewer.name,
      action: 'submitted',
      fromStatus: report.status,
      toStatus: 'submitted',
      comment: '',
    })
    return { ok: true }
  })

export const decideReport = createServerFn({ method: 'POST' })
  .validator(z.object({ id, decision: z.enum(['approved', 'rejected']), comment: z.string().trim().max(2000).default('') }))
  .handler(async ({ data }) => {
    const { viewer } = await requireApprover()
    const report = await loadReport(data.id)
    if (report.status !== 'submitted') throw new Error('Only reports awaiting approval can be decided.')
    if (report.ownerId === viewer.id && viewer.role !== 'owner') throw new Error('Ask another approver to review your own report.')
    if (data.decision === 'rejected' && !data.comment) throw new Error('Tell the submitter what to fix.')

    const expenses = await reportExpenses(report.id)
    await setStatus(report.id, expenses, data.decision, {
      approverId: viewer.id,
      approverName: viewer.name,
      decidedAt: new Date().toISOString(),
      comment: data.comment,
    })
    await recordEvent(report.ownerId, {
      reportId: report.id,
      actorId: viewer.id,
      actorName: viewer.name,
      action: data.decision,
      fromStatus: 'submitted',
      toStatus: data.decision,
      comment: data.comment,
    })
    return { ok: true }
  })

export const reimburseReport = createServerFn({ method: 'POST' })
  .validator(z.object({ id }))
  .handler(async ({ data }) => {
    const { viewer } = await requireAdmin()
    const report = await loadReport(data.id)
    if (report.status !== 'approved') throw new Error('Only approved reports can be reimbursed.')
    const expenses = await reportExpenses(report.id)
    await setStatus(report.id, expenses, 'reimbursed', { reimbursedAt: new Date().toISOString() })
    await recordEvent(report.ownerId, {
      reportId: report.id,
      actorId: viewer.id,
      actorName: viewer.name,
      action: 'reimbursed',
      fromStatus: 'approved',
      toStatus: 'reimbursed',
      comment: '',
    })
    return { ok: true }
  })

export const commentOnReport = createServerFn({ method: 'POST' })
  .validator(z.object({ id, comment: z.string().trim().min(1).max(2000) }))
  .handler(async ({ data }) => {
    const member = await requireMember()
    const report = await loadReport(data.id)
    if (!canSee(member, report.ownerId)) throw notFound()
    await recordEvent(report.ownerId, {
      reportId: report.id,
      actorId: member.viewer.id,
      actorName: member.viewer.name,
      action: 'commented',
      fromStatus: '',
      toStatus: '',
      comment: data.comment,
    })
    return { ok: true }
  })

export const deleteReport = createServerFn({ method: 'POST' })
  .validator(z.object({ id }))
  .handler(async ({ data }) => {
    const { viewer } = await requireMember()
    const report = await loadReport(data.id)
    if (report.ownerId !== viewer.id || !EDITABLE.includes(report.status)) throw new Error('Only draft or rejected reports can be deleted.')
    const { db } = admin()
    for (const expense of await reportExpenses(report.id)) {
      await db.updateRow({ databaseId: DATABASE_ID, tableId: TABLES.expenses, rowId: expense.id, data: { reportId: null, status: 'draft' } })
    }
    await db.deleteRow({ databaseId: DATABASE_ID, tableId: TABLES.reports, rowId: report.id })
    return { ok: true }
  })
