import { useEffect, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Channel, Client, Realtime, type RealtimeSubscription } from 'appwrite'
import { toast } from 'sonner'
import { getRealtimeToken } from '#/server/auth.functions'

const REFRESH_TOKEN_MS = 50 * 60 * 1000

interface RowPayload {
  $tableId?: string
  direction?: string
  fromName?: string
  fromEmail?: string
  subject?: string
}

// Listens for row changes over Appwrite Realtime and refreshes loaders, so a new
// email shows up for every agent without polling (and without spending reads).
export function RealtimeBridge() {
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
        const client = new Client().setEndpoint(token.endpoint).setProject(token.projectId).setJWT(token.jwt)
        realtime = new Realtime(client)
        const database = Channel.tablesdb(token.databaseId)
        subscription = await realtime.subscribe(
          [database.table('conversations').row(), database.table('messages').row()],
          (event) => {
            const row = event.payload as RowPayload
            const created = event.events.some((name) => name.endsWith('.create'))
            if (created && row.$tableId === 'messages' && row.direction === 'inbound') {
              toast(`New email from ${row.fromName || row.fromEmail}`, { description: row.subject })
            }
            refresh()
          },
        )
        renew = setTimeout(reconnect, REFRESH_TOKEN_MS)
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
  }, [router])

  return null
}
