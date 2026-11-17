import { createFileRoute } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, Copy, Forward, Info, Mail, Paperclip } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, Switch } from '#/components/ui/primitives'
import { useAction } from '#/lib/use-action'
import { getReceiptSettings, setReceiptsTrigger } from '#/server/settings.functions'

export const Route = createFileRoute('/_app/settings/receipts')({
  loader: () => getReceiptSettings(),
  head: () => ({ meta: [{ title: 'Receipts by email · Outlay' }] }),
  component: ReceiptSettings,
})

function ReceiptSettings() {
  const { cloud, canEdit, address, deployed, emailEnabled } = Route.useLoaderData()
  const action = useAction()
  const ready = deployed && emailEnabled

  if (!cloud || !address) return <Unavailable cloud={cloud} />

  return (
    <>
      <Card>
        <CardHeader
          title="Receipts by email"
          description="Anyone on the team can forward a receipt to this address. Outlay saves it as a draft expense for them."
        />
        <div className="grid gap-5 p-5">
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(address)
              toast.success('Receipts address copied')
            }}
            className="group flex items-center justify-between gap-3 rounded-lg border bg-background px-4 py-3 text-left transition hover:border-ring"
          >
            <span className="min-w-0">
              <span className="eyebrow block">Forward receipts to</span>
              <span className="mt-1 block truncate font-mono text-sm">{address}</span>
            </span>
            <Copy className="size-4 shrink-0 text-muted-foreground transition group-hover:text-foreground" />
          </button>

          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              {ready ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              ) : (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              )}
              <div className="text-sm">
                <p className="font-medium">{ready ? 'Receiving receipts' : !deployed ? 'The receipts function is not deployed' : 'Email trigger is off'}</p>
                <p className="mt-1 text-muted-foreground">
                  {ready
                    ? 'Forwarded emails become draft expenses within a few seconds.'
                    : !deployed
                      ? 'Deploy it under Settings → System, then turn on the email trigger.'
                      : 'Turn on the email trigger so the address starts accepting mail.'}
                  {canEdit ? '' : ' Only owners and admins can change this.'}
                </p>
              </div>
            </div>
            <Switch
              checked={emailEnabled}
              label="Email trigger"
              disabled={!canEdit || !deployed || action.pending}
              onCheckedChange={(enabled) =>
                action.run(() => setReceiptsTrigger({ data: { enabled } }), enabled ? 'Email trigger turned on' : 'Email trigger turned off')
              }
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="How it works" />
        <ol className="grid gap-4 p-5 text-sm">
          {[
            { icon: Forward, title: 'Forward the receipt', body: 'Send it from the email address you use to sign in to Outlay. Mail from anyone else is ignored.' },
            { icon: Paperclip, title: 'One draft per receipt', body: 'Each attached image or PDF becomes its own expense. Emails without attachments keep the email itself as the receipt.' },
            { icon: Mail, title: 'Check the details', body: 'Outlay reads the merchant, total and date where it can. Expenses it couldn’t price are marked “Add amount”.' },
          ].map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground">
                <Icon className="size-4" />
              </span>
              <div>
                <p className="font-medium">{title}</p>
                <p className="mt-0.5 text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </>
  )
}

// Receipts by email runs on the Functions email trigger, which only Appwrite Cloud has.
function Unavailable({ cloud }: { cloud: boolean }) {
  return (
    <Card>
      <CardHeader title="Receipts by email" description="Forward a receipt to an address and Outlay saves it as a draft expense." />
      <div className="flex gap-3 p-5 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="font-medium">{cloud ? 'No receipts address for this project' : 'Only available on Appwrite Cloud'}</p>
          <p className="mt-1 text-muted-foreground">
            {cloud
              ? 'This project’s ID can’t form a built-in email address: it ends with a hyphen, or it’s too long together with the function ID. Everyone can still snap or upload receipts on any expense.'
              : 'It runs on the Functions email trigger, which self-hosted Appwrite doesn’t have. Everyone can still snap a photo or upload an image or PDF on any expense.'}
          </p>
        </div>
      </div>
    </Card>
  )
}
