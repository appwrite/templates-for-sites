import { useEffect, useState, type FormEvent } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Search, Users } from 'lucide-react'
import { z } from 'zod'
import { PageHeader } from '#/components/page-header'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/field'
import { Avatar, EmptyState } from '#/components/ui/primitives'
import { displayName, timeAgo } from '#/lib/utils'
import { listCustomers } from '#/server/customers.functions'

export const Route = createFileRoute('/_app/customers/')({
  validateSearch: z.object({ q: z.string().optional(), page: z.number().int().min(1).optional() }),
  loaderDeps: ({ search }) => ({ q: search.q, page: search.page ?? 1 }),
  loader: ({ deps }) => listCustomers({ data: deps }),
  staleTime: 15_000,
  head: () => ({ meta: [{ title: 'Customers · Mailroom' }] }),
  component: CustomersPage,
})

function CustomersPage() {
  const { customers, total, page, pageSize } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [query, setQuery] = useState(search.q ?? '')

  useEffect(() => setQuery(search.q ?? ''), [search.q])

  function onSearch(event: FormEvent) {
    event.preventDefault()
    navigate({ search: { q: query.trim() || undefined } })
  }

  const lastIndex = Math.min(page * pageSize, total)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Customers"
        meta={<span className="font-mono text-xs text-muted-foreground tabular-nums">{total}</span>}
        actions={
          <form onSubmit={onSearch} className="relative w-72 max-sm:w-48">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or email"
              className="h-8 pl-8"
              aria-label="Search customers"
            />
          </form>
        }
      />

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-6">
        {customers.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={search.q ? 'No matching customers' : 'No customers yet'}
            description={search.q ? 'Try part of their name or email address.' : 'Everyone who emails your support address gets a profile here.'}
          />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="eyebrow px-5 py-2.5 font-normal">Customer</th>
                  <th className="eyebrow px-5 py-2.5 font-normal max-sm:hidden">Conversations</th>
                  <th className="eyebrow px-5 py-2.5 text-right font-normal">Last contact</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id} className="group relative border-b last:border-0 hover:bg-accent/50">
                    <td className="px-5 py-3">
                      <Link
                        to="/customers/$customerId"
                        params={{ customerId: customer.id }}
                        className="flex items-center gap-3 after:absolute after:inset-0"
                      >
                        <Avatar name={customer.name} email={customer.email} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{displayName(customer.name, customer.email)}</span>
                          <span className="block truncate text-xs text-muted-foreground">{customer.email}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs tabular-nums max-sm:hidden">{customer.conversationCount}</td>
                    <td className="px-5 py-3 text-right text-xs text-muted-foreground" suppressHydrationWarning>
                      {timeAgo(customer.lastContactAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > pageSize ? (
          <div className="mt-4 flex items-center justify-end gap-2 text-sm text-muted-foreground">
            {(page - 1) * pageSize + 1}–{lastIndex} of {total}
            <Button size="icon-sm" variant="ghost" aria-label="Previous page" disabled={page <= 1} onClick={() => navigate({ search: { ...search, page: page - 1 } })}>
              <ChevronLeft />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Next page" disabled={lastIndex >= total} onClick={() => navigate({ search: { ...search, page: page + 1 } })}>
              <ChevronRight />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
