import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Globe, Inbox, Plus, RefreshCw, Send, Trash2, Webhook } from 'lucide-react'
import { toast } from 'sonner'
import { CopyValue } from '#/components/copy-value'
import { Button, buttonVariants } from '#/components/ui/button'
import { Field, Input, Select } from '#/components/ui/field'
import { Badge, Card, CardHeader, Spinner, Switch } from '#/components/ui/primitives'
import { useAction } from '#/lib/use-action'
import { cn, errorMessage } from '#/lib/utils'
import {
  addEmailDomain,
  getEmailSettings,
  getTestEmailStatus,
  removeEmailDomain,
  removeEmailProvider,
  saveEmailProvider,
  sendTestEmail,
  setEmailTrigger,
  setSupportAddress,
  verifyEmailDomain,
  type EmailProvider,
  type EmailProviderKind,
} from '#/server/email.functions'

export const Route = createFileRoute('/_app/settings/email')({
  loader: () => getEmailSettings(),
  head: () => ({ meta: [{ title: 'Email settings · Mailroom' }] }),
  component: EmailSettings,
})

function Step({ done, title, children }: { done: boolean; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      {done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" /> : <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground/60" />}
      <div className="min-w-0">
        <p className={cn('text-sm font-medium', done && 'text-muted-foreground line-through decoration-muted-foreground/40')}>{title}</p>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </li>
  )
}

function EmailSettings() {
  const settings = Route.useLoaderData()
  const { canEdit, inbound, providers, domains, workspace, builtInDomain, cloud } = settings
  const sending = providers.some((provider) => provider.enabled)
  const receiving = cloud ? inbound.deployed && inbound.emailEnabled : settings.intakeEnabled
  const steps = Number(receiving) + Number(sending)

  return (
    <>
      <Card className="overflow-hidden">
        <div className="brand-glow border-b px-5 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="eyebrow">Email channel</p>
              <h2 className="mt-1 font-display text-xl font-medium tracking-tight">
                {steps === 2 ? 'Your inbox is ready' : 'Finish connecting email'}
              </h2>
            </div>
            <span className="font-mono text-sm text-muted-foreground tabular-nums">{steps}/2</span>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(steps / 2) * 100}%` }} />
          </div>
        </div>
        <ul className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <Step done={receiving} title={cloud ? 'Receive email' : 'Receive tickets'}>
            {cloud
              ? 'Turn on the email trigger so mail to your support address opens conversations.'
              : 'Turn on the tickets API under Settings → API for forms, your backend and forwarded email.'}
          </Step>
          <Step done={sending} title="Send replies">
            Connect an email provider so replies reach customers.
          </Step>
        </ul>
        {!canEdit ? (
          <p className="border-t bg-muted/40 px-5 py-3 text-sm text-muted-foreground">Only owners and admins can change email settings.</p>
        ) : null}
      </Card>

      {cloud && builtInDomain !== null ? (
        <InboundCard canEdit={canEdit} inbound={inbound} mailbox={workspace.mailbox} builtInDomain={builtInDomain} domains={domains} />
      ) : (
        <SelfHostedInboundCard canEdit={canEdit} mailbox={workspace.mailbox} intakeEnabled={settings.intakeEnabled} />
      )}
      <OutboundCard canEdit={canEdit} providers={providers} viewerEmail={settings.viewerEmail} mailbox={workspace.mailbox} />
    </>
  )
}

type Settings = Awaited<ReturnType<typeof getEmailSettings>>

// Self-hosted Appwrite has no email triggers, so messages arrive through
// /api/tickets and the support address is only used as the reply-to.
function SelfHostedInboundCard({ canEdit, mailbox, intakeEnabled }: { canEdit: boolean; mailbox: string; intakeEnabled: boolean }) {
  const addressAction = useAction()
  const [address, setAddress] = useState(mailbox)
  useEffect(() => setAddress(mailbox), [mailbox])

  return (
    <Card>
      <CardHeader title="Receiving" description="Email triggers are only available on Appwrite Cloud. On self-hosted Appwrite, tickets reach Mailroom over HTTP." />
      <div className="divide-y">
        <div className="flex items-start justify-between gap-6 px-5 py-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Webhook className="size-4 text-muted-foreground" />
              Tickets API
              {intakeEnabled ? <Badge tone="success">On</Badge> : <Badge tone="warning">Off</Badge>}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create tickets from forms or your backend, or point your email provider’s inbound webhook at it, such as Mailgun Routes or SendGrid Inbound Parse.
            </p>
          </div>
          <Link to="/settings/api" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Settings → API
            <ArrowRight />
          </Link>
        </div>
        <div className="grid gap-3 px-5 py-4">
          <div>
            <p className="text-sm font-medium">Support address</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Replies use support+&lt;ref&gt;@ this address as their reply-to. Route it to the endpoint at your email provider so customer replies
              thread back into the conversation.
            </p>
          </div>
          {canEdit ? (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void addressAction.run(() => setSupportAddress({ data: { address } }), 'Support address updated')
              }}
            >
              <Input
                type="email"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="support@example.com"
                aria-label="Support address"
                className="font-mono text-xs"
              />
              <Button type="submit" size="sm" variant="outline" disabled={addressAction.pending || !address || address === mailbox}>
                Save
              </Button>
            </form>
          ) : mailbox ? (
            <CopyValue value={mailbox} className="w-fit" />
          ) : (
            <p className="text-sm text-muted-foreground">No support address yet.</p>
          )}
        </div>
      </div>
    </Card>
  )
}

function InboundCard({
  canEdit,
  inbound,
  mailbox,
  builtInDomain,
  domains,
}: {
  canEdit: boolean
  inbound: Settings['inbound']
  mailbox: string
  builtInDomain: string
  domains: Settings['domains']
}) {
  const trigger = useAction()
  const domainAction = useAction()
  const addressAction = useAction()
  const [newDomain, setNewDomain] = useState('')
  const [local, setLocal] = useState(mailbox.split('@')[0] ?? 'support')
  const [domain, setDomain] = useState(mailbox.split('@')[1] ?? builtInDomain)

  useEffect(() => {
    setLocal(mailbox.split('@')[0] ?? 'support')
    setDomain(mailbox.split('@')[1] ?? builtInDomain)
  }, [mailbox, builtInDomain])

  const domainOptions = [builtInDomain, ...domains.filter((item) => item.verified).map((item) => item.domain)]
  const address = `${local.trim().toLowerCase()}@${domain}`

  async function onAddDomain(event: FormEvent) {
    event.preventDefault()
    const ok = await domainAction.run(() => addEmailDomain({ data: { domain: newDomain } }), 'Domain added. Add the DNS records below.')
    if (ok) setNewDomain('')
  }

  async function verify(ruleId: string, name: string) {
    await domainAction.run(async () => {
      const result = await verifyEmailDomain({ data: { ruleId } })
      if (result.verified) toast.success(`${name} is verified`)
      else toast.message(`${name} isn't verified yet`, { description: 'DNS changes can take a while to propagate. Try again in a few minutes.' })
    })
  }

  return (
    <Card>
      <CardHeader title="Receiving" description="Email to your support address runs the inbound function, which files it into a conversation." />
      <div className="divide-y">
        <div className="flex items-start justify-between gap-6 px-5 py-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium">
              Email trigger
              {inbound.emailEnabled ? <Badge tone="success">On</Badge> : <Badge tone="warning">Off</Badge>}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {inbound.deployed ? (
                <>
                  Runs <span className="font-mono text-xs text-foreground">{inbound.functionId}</span> for every delivery. While it's off,
                  mail servers bounce email sent to your address.
                </>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-warning">
                  <AlertTriangle className="size-4" />
                  The {inbound.functionId} function has no active deployment yet.
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            {trigger.pending ? <Spinner className="text-muted-foreground" /> : null}
            <Switch
              label="Email trigger"
              checked={inbound.emailEnabled}
              disabled={!canEdit || !inbound.deployed || trigger.pending}
              onCheckedChange={(enabled) =>
                trigger.run(() => setEmailTrigger({ data: { enabled } }), enabled ? 'Email trigger turned on' : 'Email trigger turned off')
              }
            />
          </div>
        </div>

        <div className="grid gap-3 px-5 py-4">
          <div>
            <p className="text-sm font-medium">Support address</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Share this address with customers. Any name before the @ reaches the same inbox, and replies use it as their reply-to.
            </p>
          </div>
          {canEdit ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void addressAction.run(() => setSupportAddress({ data: { address } }), 'Support address updated')
              }}
            >
              <Input
                value={local}
                onChange={(event) => setLocal(event.target.value.replace(/[^a-zA-Z0-9._-]/g, ''))}
                aria-label="Address name"
                className="w-32 font-mono text-xs"
              />
              <span className="text-muted-foreground">@</span>
              <Select value={domain} onChange={(event) => setDomain(event.target.value)} aria-label="Address domain" className="w-auto min-w-0 flex-1 font-mono text-xs">
                {domainOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
              <Button type="submit" size="sm" variant="outline" disabled={addressAction.pending || address === mailbox || !local}>
                Save
              </Button>
            </form>
          ) : null}
          <CopyValue value={mailbox} className="w-fit" />
        </div>

        <div className="grid gap-4 px-5 py-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium">
              <Globe className="size-4 text-muted-foreground" />
              Custom domains
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Receive email on your own domain, like support@mail.example.com. Use a subdomain you don't use for other email, and one
              without a CNAME record.
            </p>
          </div>

          {domains.map((item) => (
            <div key={item.id} className="rounded-lg border">
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
                <span className="font-mono text-sm">{item.domain}</span>
                {item.verified ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Waiting for DNS</Badge>}
                {canEdit ? (
                  <div className="ml-auto flex items-center gap-1">
                    {!item.verified ? (
                      <Button size="xs" variant="outline" disabled={domainAction.pending} onClick={() => verify(item.id, item.domain)}>
                        <RefreshCw />
                        Verify
                      </Button>
                    ) : null}
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label={`Remove ${item.domain}`}
                      disabled={domainAction.pending}
                      onClick={() => {
                        if (window.confirm(`Stop receiving email on ${item.domain}?`)) {
                          void domainAction.run(() => removeEmailDomain({ data: { ruleId: item.id } }), 'Domain removed')
                        }
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ) : null}
              </div>
              {!item.verified ? (
                <div className="overflow-x-auto px-4 py-3">
                  <p className="mb-2 text-xs text-muted-foreground">Add these records at your DNS provider, then verify. Propagation can take up to 48 hours.</p>
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-muted-foreground">
                        <th className="eyebrow py-1.5 pr-4 font-normal">Type</th>
                        <th className="eyebrow py-1.5 pr-4 font-normal">Name</th>
                        <th className="eyebrow py-1.5 pr-4 font-normal">Value</th>
                        <th className="eyebrow py-1.5 font-normal">Priority</th>
                      </tr>
                    </thead>
                    <tbody>
                      {item.records.map((record) => (
                        <tr key={record.type} className="border-t align-middle">
                          <td className="py-2 pr-4 font-mono">{record.type}</td>
                          <td className="py-2 pr-4">
                            <CopyValue value={record.name} />
                          </td>
                          <td className="py-2 pr-4">
                            <CopyValue value={record.value} />
                          </td>
                          <td className="py-2 font-mono">{record.priority ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Names are relative to your DNS zone. If your provider wants full hostnames, use {item.records.map((record) => record.host).join(' and ')}.
                  </p>
                </div>
              ) : null}
            </div>
          ))}

          {canEdit ? (
            <form onSubmit={onAddDomain} className="flex gap-2">
              <Input
                value={newDomain}
                onChange={(event) => setNewDomain(event.target.value)}
                placeholder="mail.example.com"
                aria-label="Domain"
                className="font-mono text-xs"
              />
              <Button type="submit" size="sm" variant="outline" disabled={!newDomain.trim() || domainAction.pending}>
                <Plus />
                Add domain
              </Button>
            </form>
          ) : domains.length === 0 ? (
            <p className="text-sm text-muted-foreground">No custom domains yet.</p>
          ) : null}
        </div>
      </div>
    </Card>
  )
}

interface ProviderField {
  key: string
  label: string
  type?: 'text' | 'password' | 'number' | 'checkbox' | 'select'
  placeholder?: string
  options?: { value: string; label: string }[]
  hint?: string
  secret?: boolean
}

const PROVIDERS: Record<EmailProviderKind, { label: string; blurb: string; fields: ProviderField[] }> = {
  resend: {
    label: 'Resend',
    blurb: 'API key from resend.com → API Keys.',
    fields: [{ key: 'apiKey', label: 'API key', type: 'password', placeholder: 're_…', secret: true }],
  },
  sendgrid: {
    label: 'SendGrid',
    blurb: 'API key with Mail Send access.',
    fields: [{ key: 'apiKey', label: 'API key', type: 'password', placeholder: 'SG.…', secret: true }],
  },
  mailgun: {
    label: 'Mailgun',
    blurb: 'Private API key and your sending domain.',
    fields: [
      { key: 'apiKey', label: 'API key', type: 'password', secret: true },
      { key: 'domain', label: 'Sending domain', placeholder: 'mg.example.com' },
      { key: 'isEuRegion', label: 'Domain is in the EU region', type: 'checkbox' },
    ],
  },
  ses: {
    label: 'Amazon SES',
    blurb: 'IAM access key with ses:SendEmail permission.',
    fields: [
      { key: 'accessKey', label: 'Access key ID', type: 'password', secret: true },
      { key: 'secretKey', label: 'Secret access key', type: 'password', secret: true },
      { key: 'region', label: 'Region', placeholder: 'us-east-1' },
    ],
  },
  smtp: {
    label: 'SMTP',
    blurb: 'Any SMTP server, such as Postmark, Brevo or Google Workspace.',
    fields: [
      { key: 'host', label: 'Host', placeholder: 'smtp.example.com' },
      { key: 'port', label: 'Port', type: 'number', placeholder: '587' },
      { key: 'username', label: 'Username' },
      { key: 'password', label: 'Password', type: 'password', secret: true },
      {
        key: 'encryption',
        label: 'Encryption',
        type: 'select',
        options: [
          { value: 'tls', label: 'TLS (STARTTLS)' },
          { value: 'ssl', label: 'SSL' },
          { value: 'none', label: 'None' },
        ],
      },
    ],
  },
}

const KINDS = Object.keys(PROVIDERS) as EmailProviderKind[]

function initialValues(kind: EmailProviderKind, managed: EmailProvider | undefined) {
  const same = managed?.provider === kind
  const values: Record<string, string | boolean> = {
    fromName: managed?.fromName ?? '',
    fromEmail: managed?.fromEmail ?? '',
  }
  for (const field of PROVIDERS[kind].fields) {
    const saved = same && !field.secret ? managed?.details[field.key] : undefined
    if (field.type === 'checkbox') values[field.key] = Boolean(saved)
    else if (saved !== undefined) values[field.key] = String(saved)
    else values[field.key] = field.key === 'port' ? '587' : field.key === 'encryption' ? 'tls' : ''
  }
  return values
}

function OutboundCard({
  canEdit,
  providers,
  viewerEmail,
  mailbox,
}: {
  canEdit: boolean
  providers: EmailProvider[]
  viewerEmail: string
  mailbox: string
}) {
  const managed = providers.find((provider) => provider.managed)
  const others = providers.filter((provider) => !provider.managed)
  const startKind = (KINDS.includes(managed?.provider as EmailProviderKind) ? managed?.provider : 'resend') as EmailProviderKind
  const [kind, setKind] = useState<EmailProviderKind>(startKind)
  const [values, setValues] = useState(() => initialValues(startKind, managed))
  const save = useAction()
  const remove = useAction()
  const [test, setTest] = useState<{ state: 'idle' | 'sending' | 'sent' | 'failed'; detail?: string }>({ state: 'idle' })

  const managedKey = useMemo(() => JSON.stringify(managed ?? null), [managed])
  useEffect(() => setValues(initialValues(kind, managed)), [kind, managedKey])

  const hasSavedSecrets = managed?.provider === kind
  const anyEnabled = providers.some((provider) => provider.enabled)

  function set(key: string, value: string | boolean) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  async function onSave(event: FormEvent) {
    event.preventDefault()
    const text = (key: string) => String(values[key] ?? '')
    const payload =
      kind === 'mailgun'
        ? { provider: kind, fromName: text('fromName'), fromEmail: text('fromEmail'), apiKey: text('apiKey'), domain: text('domain'), isEuRegion: Boolean(values.isEuRegion) }
        : kind === 'ses'
          ? { provider: kind, fromName: text('fromName'), fromEmail: text('fromEmail'), accessKey: text('accessKey'), secretKey: text('secretKey'), region: text('region') }
          : kind === 'smtp'
            ? {
                provider: kind,
                fromName: text('fromName'),
                fromEmail: text('fromEmail'),
                host: text('host'),
                port: Number(text('port') || 587),
                username: text('username'),
                password: text('password'),
                encryption: text('encryption') as 'tls' | 'ssl' | 'none',
              }
            : { provider: kind, fromName: text('fromName'), fromEmail: text('fromEmail'), apiKey: text('apiKey') }
    await save.run(() => saveEmailProvider({ data: payload }), `${PROVIDERS[kind].label} connected`)
  }

  async function onTest() {
    setTest({ state: 'sending' })
    try {
      const { messageId } = await sendTestEmail()
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        const result = await getTestEmailStatus({ data: { messageId } })
        if (result.status === 'sent') return setTest({ state: 'sent', detail: `Delivered to ${viewerEmail}. Reply to it to see the loop end to end.` })
        if (result.status === 'failed') return setTest({ state: 'failed', detail: result.errors.join('; ') || 'The provider rejected the email.' })
      }
      setTest({ state: 'sent', detail: `Queued for ${viewerEmail}. It can take a minute to arrive.` })
    } catch (error) {
      setTest({ state: 'failed', detail: errorMessage(error) })
    }
  }

  return (
    <Card>
      <CardHeader
        title="Sending"
        description="Replies go out through Appwrite Messaging. Each reply's reply-to is a tracked support address, so customer answers thread back automatically."
      />

      {others.length > 0 ? (
        <div className="border-b px-5 py-4">
          <p className="eyebrow mb-2">Added in the Appwrite Console</p>
          <ul className="grid gap-2">
            {others.map((provider) => (
              <li key={provider.id} className="flex items-center gap-3 text-sm">
                <span className="font-medium">{provider.name}</span>
                <span className="text-muted-foreground">{provider.fromEmail}</span>
                {provider.enabled ? <Badge tone="success" className="ml-auto">Enabled</Badge> : <Badge tone="outline" className="ml-auto">Disabled</Badge>}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canEdit ? (
        <form onSubmit={onSave} className="grid gap-5 p-5">
          <div className="grid gap-2">
            <p className="text-sm font-medium">Provider</p>
            <div role="radiogroup" aria-label="Email provider" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {KINDS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={kind === option}
                  onClick={() => setKind(option)}
                  className={cn(
                    'relative rounded-lg border px-3 py-2.5 text-left text-sm transition hover:border-ring',
                    kind === option ? 'border-brand bg-brand/5 font-medium ring-1 ring-brand' : 'text-muted-foreground',
                  )}
                >
                  {PROVIDERS[option].label}
                  {managed?.provider === option && managed.enabled ? (
                    <span className="absolute top-2 right-2 size-1.5 rounded-full bg-success" aria-label="Connected" />
                  ) : null}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{PROVIDERS[kind].blurb}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {PROVIDERS[kind].fields.map((field) =>
              field.type === 'checkbox' ? (
                <label key={field.key} className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={Boolean(values[field.key])}
                    onChange={(event) => set(field.key, event.target.checked)}
                    className="size-4 rounded accent-brand"
                  />
                  {field.label}
                </label>
              ) : field.type === 'select' ? (
                <Field key={field.key} label={field.label} htmlFor={`provider-${field.key}`}>
                  <Select id={`provider-${field.key}`} value={String(values[field.key] ?? '')} onChange={(event) => set(field.key, event.target.value)}>
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <Field
                  key={field.key}
                  label={field.label}
                  htmlFor={`provider-${field.key}`}
                  hint={field.secret && hasSavedSecrets ? 'Saved. Leave blank to keep it.' : field.hint}
                >
                  <Input
                    id={`provider-${field.key}`}
                    type={field.type ?? 'text'}
                    value={String(values[field.key] ?? '')}
                    onChange={(event) => set(field.key, event.target.value)}
                    placeholder={field.secret && hasSavedSecrets ? '••••••••' : field.placeholder}
                    autoComplete="off"
                    className={cn(field.secret && 'font-mono')}
                  />
                </Field>
              ),
            )}
          </div>

          <div className="grid gap-4 border-t pt-5 sm:grid-cols-2">
            <Field label="Sender name" htmlFor="provider-fromName">
              <Input id="provider-fromName" value={String(values.fromName ?? '')} onChange={(event) => set('fromName', event.target.value)} placeholder="Acme Support" maxLength={128} />
            </Field>
            <Field label="Sender email" htmlFor="provider-fromEmail" hint="Must be on a domain verified with your provider.">
              <Input
                id="provider-fromEmail"
                type="email"
                required
                value={String(values.fromEmail ?? '')}
                onChange={(event) => set('fromEmail', event.target.value)}
                placeholder="support@example.com"
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="brand" size="sm" disabled={save.pending}>
              {save.pending ? <Spinner /> : null}
              {managed ? 'Save provider' : `Connect ${PROVIDERS[kind].label}`}
            </Button>
            {managed ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto text-destructive hover:text-destructive"
                disabled={remove.pending}
                onClick={() => {
                  if (window.confirm('Disconnect this provider? Replies will stop being delivered.')) {
                    void remove.run(() => removeEmailProvider(), 'Provider disconnected')
                  }
                }}
              >
                <Trash2 />
                Disconnect
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="p-5 text-sm text-muted-foreground">
          {anyEnabled ? `Sending with ${providers.filter((p) => p.enabled).map((p) => p.name).join(', ')}.` : 'No email provider is connected yet.'}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t bg-muted/30 px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Send a test email</p>
          <p className="text-sm text-muted-foreground">
            Sends to <span className="text-foreground">{viewerEmail}</span> with reply-to {mailbox}.
          </p>
          {test.state === 'sent' || test.state === 'failed' ? (
            <p className={cn('mt-2 flex items-start gap-1.5 text-sm', test.state === 'sent' ? 'text-success' : 'text-destructive')}>
              {test.state === 'sent' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
              {test.detail}
            </p>
          ) : null}
        </div>
        <Button variant="outline" size="sm" disabled={!canEdit || !anyEnabled || test.state === 'sending'} onClick={onTest}>
          {test.state === 'sending' ? <Spinner /> : anyEnabled ? <Send /> : <Inbox />}
          {test.state === 'sending' ? 'Sending…' : 'Send test'}
        </Button>
      </div>
    </Card>
  )
}
