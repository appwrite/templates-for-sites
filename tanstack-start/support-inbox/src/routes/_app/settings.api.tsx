import { useEffect, useState, type FormEvent } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Send } from 'lucide-react'
import { toast } from 'sonner'
import { CodeBlock, CopyValue } from '#/components/copy-value'
import { Button } from '#/components/ui/button'
import { Field, Textarea } from '#/components/ui/field'
import { Badge, Card, CardHeader, Spinner, Switch } from '#/components/ui/primitives'
import { useAction } from '#/lib/use-action'
import { cn, errorMessage } from '#/lib/utils'
import { getIntakeConfig, updateIntake } from '#/server/intake.functions'

export const Route = createFileRoute('/_app/settings/api')({
  loader: () => getIntakeConfig(),
  head: () => ({ meta: [{ title: 'API · Mailroom' }] }),
  component: ApiSettings,
})

const FIELDS: { name: string; required?: boolean; description: string }[] = [
  { name: 'email', required: true, description: 'The customer’s address. Replies go here. You can send from instead.' },
  { name: 'from', description: 'The sender as an email header, like Jane Doe <jane@example.com>.' },
  { name: 'name', description: 'The customer’s name, if from doesn’t include it.' },
  { name: 'subject', description: 'The ticket’s subject. Defaults to “Message from <name>”.' },
  { name: 'text', required: true, description: 'The plain text body. Send html instead, or both. message works too.' },
  { name: 'html', description: 'An HTML body, shown like an HTML email.' },
  { name: 'to', description: 'The support address it was sent to. Defaults to your workspace’s.' },
  { name: 'cc', description: 'Comma-separated addresses, shown on the message.' },
  { name: 'metadata', description: 'Any extra data, as plain text up to 64 KB. Send JSON as a string if you like. Agents see it with the ticket.' },
  { name: 'attachments', description: 'Files, with multipart/form-data. Up to 10 files of 20 MB each.' },
  { name: 'ref', description: 'An existing ticket’s 6-digit #ref. Adds the message to it if the sender is that ticket’s customer.' },
  { name: 'messageId', description: 'The message’s ID. Sending the same one again doesn’t create a duplicate.' },
  { name: 'inReplyTo, references', description: 'Email threading headers. A reply to a message Mailroom has seen joins its ticket.' },
  { name: '_redirect', description: 'Plain HTML forms only. Where to send the browser afterwards; it must be on an allowed origin.' },
  { name: '_gotcha', description: 'A hidden honeypot field. Requests that fill it are dropped.' },
]

type Example = 'fetch' | 'curl' | 'html' | 'webhook'
const EXAMPLES: { id: Example; label: string }[] = [
  { id: 'fetch', label: 'JavaScript' },
  { id: 'curl', label: 'cURL' },
  { id: 'html', label: 'HTML form' },
  { id: 'webhook', label: 'Email webhook' },
]

function exampleCode(example: Example, endpoint: string) {
  switch (example) {
    case 'fetch':
      return `const response = await fetch('${endpoint}', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: 'jane@example.com',
    name: 'Jane Doe',
    subject: 'Checkout fails with a card error',
    text: 'I get “card declined” on every card I try.',
    metadata: JSON.stringify({ plan: 'Pro', accountId: 'acc_1042', page: '/checkout' }),
  }),
})

const { id, ref } = await response.json() // ref is the ticket's #, e.g. "482913"`
    case 'curl':
      return `curl -X POST '${endpoint}' \\
  -H 'content-type: application/json' \\
  -H 'idempotency-key: order-1042-refund' \\
  -d '{
    "from": "Jane Doe <jane@example.com>",
    "subject": "Refund for order 1042",
    "text": "The order arrived damaged.",
    "metadata": "Order 1042, paid with Visa, shipped 12 Nov"
  }'`
    case 'html':
      return `<form action="${endpoint}" method="POST" enctype="multipart/form-data">
  <input name="name" placeholder="Your name">
  <input name="email" type="email" required placeholder="you@example.com">
  <input name="subject" placeholder="Subject">
  <textarea name="text" required></textarea>
  <input name="attachments" type="file" multiple>

  <!-- Optional: extra data, where to go after sending, and a honeypot for bots -->
  <input type="hidden" name="metadata" value="Sent from the pricing page">
  <input type="hidden" name="_redirect" value="https://example.com/thanks">
  <input type="text" name="_gotcha" style="display:none" tabindex="-1" autocomplete="off">

  <button type="submit">Send</button>
</form>`
    case 'webhook':
      return `# Mailgun: Receiving → Create route
Expression:  match_recipient("support@mail.example.com")
Action:      forward("${endpoint}")

# SendGrid: Settings → Inbound Parse → Add host & URL
Destination URL: ${endpoint}

# Mailroom reads the sender, subject, text, HTML, attachments and
# threading headers. Replies to support+<ref>@… join their ticket.
# Webhooks come from your provider's servers, so allowed origins don't apply.`
  }
}

function ApiSettings() {
  const config = Route.useLoaderData()
  const router = useRouter()
  const action = useAction()
  const [enabled, setEnabled] = useState(config.enabled)
  const [origins, setOrigins] = useState(config.origins.join('\n'))
  const [example, setExample] = useState<Example>('fetch')
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    setEnabled(config.enabled)
    setOrigins(config.origins.join('\n'))
  }, [config.enabled, config.origins])

  const originList = origins
    .split(/[\s,]+/)
    .map((origin) => origin.trim())
    .filter(Boolean)
  const dirty = enabled !== config.enabled || originList.join('\n') !== config.origins.join('\n')

  async function onSave(event: FormEvent) {
    event.preventDefault()
    await action.run(() => updateIntake({ data: { enabled, origins: originList } }), 'API settings saved')
  }

  async function sendTest() {
    setTesting(true)
    try {
      const response = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          email: config.viewerEmail,
          name: config.viewerName,
          subject: 'Test ticket from the API',
          text: 'This came in through POST /api/tickets. Close it whenever you like.',
          metadata: `Sent from Settings → API at ${new Date().toISOString()}`,
        }),
      })
      const result = (await response.json()) as { ok: boolean; ref?: string; id?: string; error?: string }
      if (!result.ok) throw new Error(result.error ?? `The endpoint answered ${response.status}.`)
      toast.success(`Created ticket #${result.ref}`, {
        action: { label: 'Open', onClick: () => router.navigate({ to: '/c/$conversationId', params: { conversationId: result.id! } }) },
      })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <Card className="overflow-hidden">
        <div className="brand-glow border-b px-5 py-5">
          <p className="eyebrow">Tickets API</p>
          <h2 className="mt-1 font-display text-xl font-medium tracking-tight">Create tickets over HTTP</h2>
          <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
            Open a ticket from anywhere: a contact form, your app’s backend, an alert, or an email provider’s inbound webhook. It takes
            everything an email has, plus a metadata field for anything else.
            {config.cloud ? null : ' On self-hosted Appwrite, this is how tickets reach Mailroom.'}
          </p>
        </div>
        <form onSubmit={onSave} className="divide-y">
          <div className="flex items-start justify-between gap-6 px-5 py-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                Accept tickets
                {config.enabled ? <Badge tone="success">On</Badge> : <Badge tone="warning">Off</Badge>}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">No API key needed. While it’s off, the endpoint answers 403.</p>
            </div>
            <Switch label="Accept tickets" checked={enabled} disabled={!config.canEdit} onCheckedChange={setEnabled} />
          </div>

          <div className="grid gap-2 px-5 py-4">
            <p className="text-sm font-medium">Endpoint</p>
            <div className="flex min-w-0 items-center gap-2">
              <Badge tone="brand" className="font-mono">
                POST
              </Badge>
              <CopyValue value={config.endpoint} className="min-w-0" />
            </div>
          </div>

          <div className="px-5 py-4">
            <Field
              label="Allowed origins"
              htmlFor="origins"
              hint="One per line, like https://example.com. Browsers on other sites are refused. Leave empty to accept any site. Servers and webhooks aren’t affected."
            >
              <Textarea
                id="origins"
                value={origins}
                onChange={(event) => setOrigins(event.target.value)}
                disabled={!config.canEdit}
                placeholder="https://example.com"
                className="min-h-16 font-mono text-xs"
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/30 px-5 py-3">
            <Button type="button" size="sm" variant="outline" disabled={!config.enabled || testing} onClick={sendTest}>
              {testing ? <Spinner /> : <Send />}
              Create a test ticket
            </Button>
            {config.canEdit ? (
              <Button type="submit" size="sm" variant="brand" disabled={!dirty || action.pending}>
                {action.pending ? <Spinner /> : null}
                Save
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">Only owners and admins can change these settings.</p>
            )}
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title="Fields"
          description="Send JSON, multipart/form-data or a URL-encoded form. Field names aren’t case-sensitive, and fields not listed here are ignored."
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y">
              {FIELDS.map((field) => (
                <tr key={field.name} className="align-top">
                  <td className="w-44 py-3 pr-4 pl-5">
                    <span className="font-mono text-xs">{field.name}</span>
                    {field.required ? <span className="ml-1.5 text-xs text-brand">required</span> : null}
                  </td>
                  <td className="py-3 pr-5 text-muted-foreground">{field.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t px-5 py-3 text-sm text-muted-foreground">
          Send an <span className="font-mono text-xs text-foreground">Idempotency-Key</span> header to make retries safe: the same key creates
          the ticket once.
        </p>
      </Card>

      <Card>
        <CardHeader title="Examples" description="Copy one into your site or backend. The endpoint above is already filled in." />
        <div className="grid gap-4 px-5 py-4">
          <div role="tablist" aria-label="Example" className="flex w-fit flex-wrap gap-1 rounded-lg border bg-muted/40 p-1">
            {EXAMPLES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={example === item.id}
                onClick={() => setExample(item.id)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground',
                  example === item.id && 'bg-background text-foreground shadow-xs',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <CodeBlock code={exampleCode(example, config.endpoint)} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Responses" description="JSON for API calls. Browsers posting a plain HTML form are redirected instead." />
        <div className="grid gap-4 px-5 py-4">
          <CodeBlock
            code={`HTTP/1.1 201 Created
{ "ok": true, "id": "c3f…", "ref": "482913", "created": true, "duplicate": false }`}
          />
          <ul className="grid gap-2 text-sm">
            {[
              ['200', 'The message joined an existing ticket (created is false), or it was a duplicate.'],
              ['403', 'The endpoint is off, or the browser’s origin isn’t allowed.'],
              ['413', 'The request, a file or metadata is too large.'],
              ['422', 'A required field is missing or invalid. The error says which.'],
              ['429', 'More than 10 requests from one IP address in 10 minutes.'],
            ].map(([status, text]) => (
              <li key={status} className="flex gap-3">
                <span className="w-10 shrink-0 font-mono text-xs leading-5 text-muted-foreground">{status}</span>
                <span className="text-muted-foreground">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </>
  )
}
