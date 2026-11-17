import { createServerFn } from '@tanstack/react-start'
import { notFound } from '@tanstack/react-router'
import { ID, Query } from 'node-appwrite'
import { InputFile } from 'node-appwrite/file'
import { z } from 'zod'
import { CURRENCIES, parseMoney } from '#/lib/money'
import { STATUSES } from '#/lib/types'
import {
  BUCKET_ID,
  DATABASE_ID,
  TABLES,
  admin,
  getRowOrNull,
  getWorkspace,
  listCategories,
  ownerPermissions,
  recordEvent,
  requireMember,
  toEvent,
  toExpense,
  toExpenseDetail,
  toReport,
} from './appwrite.server'

const PAGE_SIZE = 30
const RECEIPT_TYPES = /^(image\/(png|jpe?g|gif|webp|heic|heif|avif)|application\/pdf)$/i
const EDITABLE = ['draft', 'rejected']

export const listExpenses = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      scope: z.enum(['mine', 'all']).default('mine'),
      status: z.enum([...STATUSES, 'unreported']).optional(),
      q: z.string().trim().max(100).optional(),
      page: z.number().int().min(1).max(400).default(1),
    }),
  )
  .handler(async ({ data }) => {
    const { viewer } = await requireMember()
    const scope = viewer.canApprove ? data.scope : 'mine'
    const queries: string[] = []
    if (scope === 'mine') queries.push(Query.equal('ownerId', viewer.id))
    if (data.status === 'unreported') queries.push(Query.isNull('reportId'), Query.equal('status', 'draft'))
    else if (data.status) queries.push(Query.equal('status', data.status))
    if (data.q) queries.push(Query.search('merchant', data.q))

    const [{ rows, total }, categories] = await Promise.all([
      admin().db.listRows({
        databaseId: DATABASE_ID,
        tableId: TABLES.expenses,
        queries: [...queries, Query.orderDesc('spentAt'), Query.limit(PAGE_SIZE), Query.offset((data.page - 1) * PAGE_SIZE)],
      }),
      listCategories(),
    ])
    return { expenses: rows.map(toExpense), total, page: data.page, pageSize: PAGE_SIZE, scope, categories }
  })

export const getExpense = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().min(1).max(36) }))
  .handler(async ({ data }) => {
    const { viewer } = await requireMember()
    const row = await getRowOrNull(TABLES.expenses, data.id)
    if (!row) throw notFound()
    const expense = toExpenseDetail(row)
    if (expense.ownerId !== viewer.id && !viewer.canApprove) throw notFound()

    const [events, categories, reportRow] = await Promise.all([
      admin().db.listRows({
        databaseId: DATABASE_ID,
        tableId: TABLES.events,
        queries: [Query.equal('expenseId', expense.id), Query.orderDesc('$createdAt'), Query.limit(50)],
        total: false,
      }),
      listCategories(),
      expense.reportId ? getRowOrNull(TABLES.reports, expense.reportId) : Promise.resolve(null),
    ])
    const report = reportRow ? toReport(reportRow) : null
    const editable = expense.ownerId === viewer.id && EDITABLE.includes(expense.status) && (!report || EDITABLE.includes(report.status))
    return { expense, events: events.rows.map(toEvent), categories, report, editable }
  })

const expenseInput = z.object({
  id: z.string().min(1).max(36).optional(),
  merchant: z.string().trim().min(1, 'Enter the merchant.').max(255),
  amount: z.string().trim().min(1, 'Enter the amount.'),
  currency: z.enum(CURRENCIES),
  spentAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date.'),
  categoryId: z.string().max(36).optional(),
  description: z.string().max(2000).optional(),
  removeReceipt: z.boolean(),
  receipt: z.instanceof(File).nullable(),
})

export const saveExpense = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    if (!(input instanceof FormData)) throw new Error('Expected form data.')
    const file = input.get('receipt')
    return expenseInput.parse({
      id: input.get('id') || undefined,
      merchant: input.get('merchant'),
      amount: input.get('amount'),
      currency: input.get('currency'),
      spentAt: input.get('spentAt'),
      categoryId: input.get('categoryId') || undefined,
      description: input.get('description') ?? '',
      removeReceipt: input.get('removeReceipt') === 'true',
      receipt: file instanceof File && file.size > 0 ? file : null,
    })
  })
  .handler(async ({ data }) => {
    const { viewer } = await requireMember()
    const { db, storage } = admin()

    const amount = parseMoney(data.amount, data.currency)
    if (amount === null) throw new Error('Enter a valid amount.')

    let existing = null
    if (data.id) {
      const row = await getRowOrNull(TABLES.expenses, data.id)
      if (!row) throw notFound()
      existing = toExpense(row)
      if (existing.ownerId !== viewer.id) throw new Error('You can only edit your own expenses.')
      if (!EDITABLE.includes(existing.status)) throw new Error('Submitted expenses are locked until the report is decided.')
    }

    const [categories, workspace] = await Promise.all([listCategories(), getWorkspace()])
    const category = categories.find((item) => item.id === data.categoryId && !item.archived)
    // Limits are set in the workspace currency, so only same-currency expenses are compared.
    const overLimit = Boolean(category && category.limit > 0 && data.currency === workspace.currency && amount > category.limit)

    let receipt: Record<string, string | null> = {}
    if (data.receipt) {
      if (!RECEIPT_TYPES.test(data.receipt.type)) throw new Error('Receipts can be images or PDFs.')
      if (data.receipt.size > 20 * 1024 * 1024) throw new Error('Receipts can be up to 20 MB.')
      const fileId = ID.unique()
      await storage.createFile({
        bucketId: BUCKET_ID,
        fileId,
        file: InputFile.fromBuffer(Buffer.from(await data.receipt.arrayBuffer()), data.receipt.name || 'receipt'),
      })
      receipt = { receiptFileId: fileId, receiptName: data.receipt.name.slice(0, 255), receiptType: data.receipt.type }
    } else if (data.removeReceipt) {
      receipt = { receiptFileId: null, receiptName: null, receiptType: null }
    }
    if (existing?.receipt && (data.receipt || data.removeReceipt)) {
      await storage.deleteFile({ bucketId: BUCKET_ID, fileId: existing.receipt.fileId }).catch(() => undefined)
    }

    const fields = {
      merchant: data.merchant,
      amount,
      currency: data.currency,
      spentAt: new Date(`${data.spentAt}T12:00:00.000Z`).toISOString(),
      categoryId: category?.id ?? null,
      categoryName: category?.name ?? '',
      description: data.description ?? '',
      overLimit,
      ...receipt,
    }

    const rowId = existing?.id ?? ID.unique()
    if (existing) {
      await db.updateRow({ databaseId: DATABASE_ID, tableId: TABLES.expenses, rowId, data: fields })
    } else {
      await db.createRow({
        databaseId: DATABASE_ID,
        tableId: TABLES.expenses,
        rowId,
        permissions: ownerPermissions(viewer.id),
        data: { ...fields, ownerId: viewer.id, ownerName: viewer.name, status: 'draft', source: 'manual' },
      })
    }
    await recordEvent(viewer.id, {
      expenseId: rowId,
      actorId: viewer.id,
      actorName: viewer.name,
      action: existing ? 'updated' : 'created',
      fromStatus: '',
      toStatus: existing?.status ?? 'draft',
      comment: '',
    })
    return { id: rowId, overLimit }
  })

export const deleteExpense = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1).max(36) }))
  .handler(async ({ data }) => {
    const { viewer } = await requireMember()
    const row = await getRowOrNull(TABLES.expenses, data.id)
    if (!row) throw notFound()
    const expense = toExpense(row)
    if (expense.ownerId !== viewer.id) throw new Error('You can only delete your own expenses.')
    if (expense.status !== 'draft' || expense.reportId) throw new Error('Remove the expense from its report before deleting it.')
    const { db, storage } = admin()
    await db.deleteRow({ databaseId: DATABASE_ID, tableId: TABLES.expenses, rowId: expense.id })
    if (expense.receipt) await storage.deleteFile({ bucketId: BUCKET_ID, fileId: expense.receipt.fileId }).catch(() => undefined)
    return { ok: true }
  })
