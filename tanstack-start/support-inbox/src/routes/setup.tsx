import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { ArrowRight, CheckCircle2, KeyRound, Lock, Mail, Webhook } from 'lucide-react'
import { AuthMethodSwitch, type AuthMethod } from '#/components/auth-method-switch'
import { BrandMark } from '#/components/brand'
import { CodeStep } from '#/components/code-step'
import { CopyValue } from '#/components/copy-value'
import { EnvironmentCard, ProvisionPanel, ScopesCard, isProvisioned, type Provisioning } from '#/components/provisioning'
import { Button } from '#/components/ui/button'
import { Field, FormError, Input, PasswordInput } from '#/components/ui/field'
import { Card, CardHeader, Spinner } from '#/components/ui/primitives'
import { cn, errorMessage } from '#/lib/utils'
import { completeSetup, startSetup } from '#/server/auth.functions'
import { getProvisioning, getSetupGate, unlock } from '#/server/setup.functions'

export const Route = createFileRoute('/setup')({
  beforeLoad: async () => {
    const gate = await getSetupGate()
    if (!gate.open) throw redirect({ to: '/login' })
    return { gate }
  },
  loader: async ({ context }) => ({
    gate: context.gate,
    provisioning: context.gate.unlocked ? await getProvisioning() : null,
  }),
  head: () => ({ meta: [{ title: 'Set up · Mailroom' }] }),
  component: SetupPage,
})

function SetupPage() {
  const { gate, provisioning: loaded } = Route.useLoaderData()
  const [provisioning, setProvisioning] = useState<Provisioning | null>(loaded)
  useEffect(() => setProvisioning(loaded), [loaded])

  const provisioned = provisioning ? isProvisioned(provisioning.steps) : false
  const stage = !gate.unlocked ? 0 : provisioned ? 2 : 1

  return (
    <div className="brand-glow relative min-h-dvh px-4 py-10 sm:py-14">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:56px_56px] opacity-40 [mask-image:radial-gradient(ellipse_at_top,black,transparent_60%)]"
      />
      <div className="relative mx-auto grid w-full max-w-2xl gap-6">
        <header className="flex flex-col items-center text-center">
          <BrandMark className="mb-5 size-10 rounded-xl" />
          <p className="eyebrow">First run</p>
          <h1 className="mt-1 font-display text-2xl font-medium tracking-tight">Set up Mailroom</h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            This site creates everything it needs in your Appwrite project, then makes you the workspace owner.
          </p>
        </header>

        <ol className="grid grid-cols-3 gap-2" aria-label="Setup progress">
          {['Unlock', 'Create resources', 'Owner account'].map((label, index) => (
            <li key={label} className="grid gap-2">
              <span className={cn('h-1 rounded-full bg-muted', index < stage && 'bg-success', index === stage && 'bg-brand')} />
              <span className={cn('text-xs', index === stage ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                <span className="font-mono">{index + 1}</span> · {label}
              </span>
            </li>
          ))}
        </ol>

        {!gate.unlocked ? (
          <UnlockStep tokenVariable={gate.tokenVariable} configured={gate.tokenConfigured} />
        ) : provisioning ? (
          <>
            <EnvironmentCard data={provisioning} />
            <ScopesCard data={provisioning} />
            <EmailCard data={provisioning} />
            <ProvisionPanel
              data={provisioning}
              onChange={setProvisioning}
              title="Resources"
              description="The database, tables, storage bucket and team Mailroom uses, plus the function that receives email on Appwrite Cloud."
            />
            {provisioned ? <OwnerStep cloud={provisioning.platform.cloud} /> : null}
          </>
        ) : null}

        <p className="text-center text-xs text-muted-foreground">This page closes for good once the workspace has an owner.</p>
      </div>
    </div>
  )
}

function UnlockStep({ tokenVariable, configured }: { tokenVariable: string; configured: boolean }) {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await unlock({ data: { token } })
      await router.invalidate()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPending(false)
    }
  }

  if (!configured) {
    return (
      <Card>
        <CardHeader title="Add a setup token" description="A new deploy is public, so setup asks for a passphrase that only someone with access to your Appwrite project can set." />
        <ol className="grid gap-3 px-5 py-4 text-sm">
          <Instruction n={1}>In the Appwrite Console, open this site and go to Settings → Environment variables.</Instruction>
          <Instruction n={2}>
            Create a variable named <CopyValue value={tokenVariable} className="mx-0.5 align-middle" /> with any passphrase as its value, and mark it secret.
          </Instruction>
          <Instruction n={3}>Redeploy the site, then reload this page.</Instruction>
        </ol>
        <div className="flex justify-end border-t bg-muted/30 px-5 py-3">
          <Button size="sm" variant="outline" onClick={() => router.invalidate()}>
            Check again
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Lock className="size-4 text-muted-foreground" />
            Unlock setup
          </span>
        }
        description={
          <>
            Enter the value of the <span className="font-mono text-xs text-foreground">{tokenVariable}</span> variable you set when you deployed this site.
          </>
        }
      />
      <form onSubmit={onSubmit} className="grid gap-4 px-5 py-5">
        <Field label="Setup token" htmlFor="token">
          <Input id="token" type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" autoFocus required />
        </Field>
        <FormError message={error} />
        <div className="flex justify-end">
          <Button type="submit" variant="brand" disabled={pending || !token}>
            {pending ? <Spinner /> : <KeyRound />}
            Unlock
          </Button>
        </div>
      </form>
    </Card>
  )
}

function Instruction({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] text-muted-foreground">{n}</span>
      <span className="text-muted-foreground">{children}</span>
    </li>
  )
}

function EmailCard({ data }: { data: Provisioning }) {
  return (
    <Card>
      <div className="flex items-start gap-3 px-5 py-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
          {data.email.trigger ? <Mail className="size-4" /> : <Webhook className="size-4" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{data.email.trigger ? 'Email arrives through the email trigger' : 'Tickets arrive over HTTP'}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.email.trigger ? (
              data.email.address ? (
                <>
                  Setup turns the trigger on, so <span className="font-mono text-xs text-foreground">{data.email.address}</span> works right away. You can add
                  your own domain later.
                </>
              ) : (
                'Setup turns the trigger on. This project’s ID can’t form a built-in address, so add a custom email domain afterwards.'
              )
            ) : (
              'Email triggers are only on Appwrite Cloud. After setup, turn on the tickets API under Settings → API to create tickets from forms, your backend, or email forwarded by your provider.'
            )}
          </p>
        </div>
      </div>
    </Card>
  )
}

function OwnerStep({ cloud }: { cloud: boolean }) {
  const router = useRouter()
  const [method, setMethod] = useState<AuthMethod>(cloud ? 'otp' : 'password')
  const [form, setForm] = useState({ workspaceName: '', name: '', email: '', password: '', confirm: '' })
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const landing = cloud ? '/settings/email' : '/settings/api'

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (method === 'password' && form.password !== form.confirm) {
      setError('The passwords don’t match.')
      return
    }
    setPending(true)
    try {
      const { workspaceName, name, email, password } = form
      const result = await startSetup({
        data: { workspaceName, name, email, authMethod: method, password: method === 'password' ? password : undefined },
      })
      if (result.signedIn) await router.navigate({ to: landing })
      else setSent(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPending(false)
    }
  }

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }))

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-success" />
            {sent ? 'Confirm your email' : 'Create the owner account'}
          </span>
        }
        description={
          sent
            ? 'Enter the code we emailed you. Your account becomes the workspace owner once it’s confirmed.'
            : 'Choose how your team signs in, then create your account. You can switch methods later in Settings → General.'
        }
      />
      <div className="px-5 py-5">
        {sent ? (
          <CodeStep
            email={form.email.trim().toLowerCase()}
            submitLabel="Create workspace"
            onVerify={async (code) => {
              await completeSetup({ data: { code } })
              await router.navigate({ to: landing })
            }}
            onResend={async () => {
              const { workspaceName, name, email } = form
              await startSetup({ data: { workspaceName, name, email, authMethod: 'otp' } })
            }}
            onBack={() => setSent(false)}
          />
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <p className="text-sm font-medium">Sign-in method</p>
              <AuthMethodSwitch value={method} onChange={setMethod} cloud={cloud} />
            </div>
            <Field label="Workspace name" htmlFor="workspaceName" hint="Used as the reply-to name on emails, e.g. “Acme Support”.">
              <Input id="workspaceName" value={form.workspaceName} onChange={update('workspaceName')} required maxLength={64} placeholder="Acme Support" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Your name" htmlFor="name">
                <Input id="name" value={form.name} onChange={update('name')} autoComplete="name" required maxLength={128} placeholder="Jane Doe" />
              </Field>
              <Field label="Work email" htmlFor="email">
                <Input id="email" type="email" value={form.email} onChange={update('email')} autoComplete="email" required placeholder="you@company.com" />
              </Field>
            </div>
            {method === 'password' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Password" htmlFor="password" hint="At least 8 characters.">
                  <PasswordInput id="password" value={form.password} onChange={update('password')} autoComplete="new-password" required minLength={8} />
                </Field>
                <Field label="Confirm password" htmlFor="confirm">
                  <PasswordInput id="confirm" value={form.confirm} onChange={update('confirm')} autoComplete="new-password" required minLength={8} />
                </Field>
              </div>
            ) : null}
            <FormError message={error} />
            <div className="flex justify-end">
              <Button type="submit" variant="brand" disabled={pending}>
                {pending ? <Spinner /> : null}
                {method === 'password' ? 'Create workspace' : 'Email me a code'}
                {pending ? null : <ArrowRight />}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  )
}
