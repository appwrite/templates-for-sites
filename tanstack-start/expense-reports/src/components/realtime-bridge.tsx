import { useEffect, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Channel, Client, Realtime, type RealtimeSubscription } from 'appwrite'
import { toast } from 'sonner'
import { getRealtimeToken } from '#/server/auth.functions'

interface RowPayload {
  $tableId?: string
  source?: string
  merchant?: string
  action?: string
  actorName?: string
}

// Refreshes loaders when expenses, reports or their history change. Row
// permissions mean each person only receives events for rows they can read.
export function RealtimeBridge({ viewerId }: { viewerId: string }) {
  const router = useRouter()
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let disposed = false
    let realtime: Realtime | null = null
    let subscription: RealtimeSubscription | null = null
    let renew: ReturnType<typeof setTimeout> | null = null

    const refresh = () => {
      if (pending.current) clearTimeout(pending.current)
      pending.current = setTimeout(() => router.invalidate(), 400)
    }

    async function connect() {
      try {
        const token = await getRealtimeToken()
        if (disposed) return
        realtime = new Realtime(new Client().setEndpoint(token.endpoint).setProject(token.projectId).setJWT(token.jwt))
        const database = Channel.tablesdb(token.databaseId)
        subscription = await realtime.subscribe(
          [database.table('expenses').row(), database.table('reports').row(), database.table('events').row()],
          (event) => {
            const row = event.payload as RowPayload
            const created = event.events.some((name) => name.endsWith('.create'))
            if (created && row.$tableId === 'expenses' && row.source === 'email') {
              toast(`Receipt added: ${row.merchant}`, { description: 'Forwarded by email and saved as a draft.' })
            }
            if (created && row.$tableId === 'events' && ['approved', 'rejected', 'reimbursed'].includes(row.action ?? '')) {
              toast(`Report ${row.action} by ${row.actorName}`)
            }
            refresh()
          },
        )
        renew = setTimeout(reconnect, 50 * 60 * 1000)
      } catch {
        if (!disposed) renew = setTimeout(reconnect, 30_000)
      }
    }

    async function disconnect() {
      if (renew) clearTimeout(renew)
      await subscription?.unsubscribe().catch(() => undefined)
      await realtime?.disconnect().catch(() => undefined)
      subscription = null
      realtime = null
    }

    async function reconnect() {
      await disconnect()
      if (!disposed) await connect()
    }

    connect()
    return () => {
      disposed = true
      if (pending.current) clearTimeout(pending.current)
      void disconnect()
    }
  }, [router, viewerId])

  return null
}
