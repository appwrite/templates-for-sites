import { createFileRoute } from '@tanstack/react-router'
import { Query } from 'node-appwrite'
import { fractionDigits } from '#/lib/money'
import { DATABASE_ID, TABLES, admin, currentMember, getRowOrNull, toExpense, toReport } from '#/server/appwrite.server'

const cell = (value: string | number) => {
  const text = String(value)
  // Quote everything and neutralise spreadsheet formulas.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export const Route = createFileRoute('/api/reports/$reportId/csv')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const member = await currentMember()
        if (!member) return new Response('Unauthorized', { status: 401 })
        const row = await getRowOrNull(TABLES.reports, params.reportId)
        if (!row) return new Response('Not found', { status: 404 })
        const report = toReport(row)
        if (report.ownerId !== member.viewer.id && !member.viewer.canApprove) return new Response('Not found', { status: 404 })

        const { rows } = await admin().db.listRows({
          databaseId: DATABASE_ID,
          tableId: TABLES.expenses,
          queries: [Query.equal('reportId', report.id), Query.orderAsc('spentAt'), Query.limit(200)],
          total: false,
        })
        const lines = [
          ['Date', 'Merchant', 'Category', 'Description', 'Amount', 'Currency', 'Status', 'Receipt', 'Submitted by'].map(cell).join(','),
          ...rows.map(toExpense).map((expense) =>
            [
              expense.spentAt.slice(0, 10),
              expense.merchant,
              expense.categoryName,
              expense.description,
              (expense.amount / 10 ** fractionDigits(expense.currency)).toFixed(fractionDigits(expense.currency)),
              expense.currency,
              expense.status,
              expense.receipt ? 'yes' : 'no',
              expense.ownerName,
            ]
              .map(cell)
              .join(','),
          ),
        ]
        const filename = `${report.title.replace(/[^\w\- ]+/g, '').trim() || 'report'}.csv`
        return new Response(`﻿${lines.join('\r\n')}\r\n`, {
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
            'cache-control': 'private, no-store',
          },
        })
      },
    },
  },
})
