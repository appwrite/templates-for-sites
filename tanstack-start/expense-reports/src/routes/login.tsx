import { useState, type FormEvent } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { AuthLayout } from '#/components/auth-layout'
import { CodeStep } from '#/components/code-step'
import { Button } from '#/components/ui/button'
import { Field, FormError, Input, PasswordInput } from '#/components/ui/field'
import { Spinner } from '#/components/ui/primitives'
import { errorMessage } from '#/lib/utils'
import { getSetupState, getSignInMethod, getViewer, requestSignInCode, signInWithPassword, verifySignInCode } from '#/server/auth.functions'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    if (await getViewer()) throw redirect({ to: '/' })
    if ((await getSetupState()).needsSetup) throw redirect({ to: '/setup' })
  },
  loader: () => getSignInMethod(),
  head: () => ({ meta: [{ title: 'Sign in · Outlay' }] }),
  component: LoginPage,
})

function LoginPage() {
  const { method } = Route.useLoaderData()
  return method === 'password' ? <PasswordLogin /> : <CodeLogin />
}

function PasswordLogin() {
  const router = useRouter()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await signInWithPassword({ data: form })
      await router.navigate({ to: '/' })
    } catch (err) {
      setError(errorMessage(err))
      setPending(false)
    }
  }

  return (
    <AuthLayout
      title="Sign in to Outlay"
      description="Use the email and password for your workspace account."
      footer="Forgot your password? Ask a workspace admin to reset it under Settings → Team."
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <Field label="Work email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={form.email}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            placeholder="you@company.com"
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <PasswordInput
            id="password"
            autoComplete="current-password"
            required
            value={form.password}
            onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
          />
        </Field>
        <FormError message={error} />
        <Button type="submit" variant="brand" className="mt-1 w-full" disabled={pending}>
          {pending ? <Spinner /> : null}
          Sign in
          {pending ? null : <ArrowRight />}
        </Button>
      </form>
    </AuthLayout>
  )
}

function CodeLogin() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await requestSignInCode({ data: { email } })
      setSent(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout
      title={sent ? 'Check your email' : 'Sign in to Outlay'}
      description={sent ? 'Enter the code to finish signing in.' : 'We’ll email you a sign-in code. No password needed.'}
      footer="Teammates are added by a workspace admin under Settings → Team."
    >
      {sent ? (
        <CodeStep
          email={email}
          submitLabel="Sign in"
          onVerify={async (code) => {
            await verifySignInCode({ data: { code } })
            await router.navigate({ to: '/' })
          }}
          onResend={async () => {
            await requestSignInCode({ data: { email } })
          }}
          onBack={() => {
            setSent(false)
            setError(null)
          }}
        />
      ) : (
        <form onSubmit={onRequest} className="grid gap-4">
          <Field label="Work email" htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
            />
          </Field>
          <FormError message={error} />
          <Button type="submit" variant="brand" className="mt-1 w-full" disabled={pending}>
            {pending ? <Spinner /> : null}
            Email me a code
            {pending ? null : <ArrowRight />}
          </Button>
          <p className="text-center text-xs text-muted-foreground">If this address is on the team, a code is on its way.</p>
        </form>
      )}
    </AuthLayout>
  )
}
