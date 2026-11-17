import { createFileRoute } from '@tanstack/react-router'
import { CheckCircle2 } from 'lucide-react'
import { z } from 'zod'
import { AuthLayout } from '#/components/auth-layout'

// Where a plain HTML form lands after posting to /api/tickets
// without its own _redirect.
export const Route = createFileRoute('/received')({
  validateSearch: z.object({ ref: z.string().regex(/^\d{6}$/).optional().catch(undefined) }),
  head: () => ({ meta: [{ title: 'Message received' }] }),
  component: ReceivedPage,
})

function ReceivedPage() {
  const { ref } = Route.useSearch()
  return (
    <AuthLayout title="Message received" description="Thanks for getting in touch. We’ll reply by email.">
      <div className="flex flex-col items-center gap-3 text-center">
        <CheckCircle2 className="size-8 text-success" />
        {ref ? (
          <p className="text-sm text-muted-foreground">
            Your reference is <span className="font-mono text-foreground">#{ref}</span>. Mention it if you write to us again.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">You can close this page.</p>
        )}
      </div>
    </AuthLayout>
  )
}
