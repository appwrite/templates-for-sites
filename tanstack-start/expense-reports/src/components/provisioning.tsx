import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowUpCircle, CheckCircle2, Circle, Cloud, Loader2, MinusCircle, Server, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { CopyValue } from '#/components/copy-value'
import { Button } from '#/components/ui/button'
import { Badge, Card, CardHeader, Spinner } from '#/components/ui/primitives'
import { cn, errorMessage } from '#/lib/utils'
import { getProvisioning, runProvisioningStep } from '#/server/setup.functions'

export type Provisioning = Awaited<ReturnType<typeof getProvisioning>>
type Step = Provisioning['steps'][number]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const isProvisioned = (steps: Step[]) => steps.length > 0 && steps.every((step) => step.state === 'ready' || step.state === 'skipped')

function StepIcon({ state, running }: { state: Step['state']; running: boolean }) {
  if (running || state === 'working') return <Loader2 className="size-4 animate-spin text-brand" />
  if (state === 'ready') return <CheckCircle2 className="size-4 text-success" />
  if (state === 'outdated') return <ArrowUpCircle className="size-4 text-warning" />
  if (state === 'failed') return <XCircle className="size-4 text-destructive" />
  if (state === 'skipped') return <MinusCircle className="size-4 text-muted-foreground/60" />
  return <Circle className="size-4 text-muted-foreground/60" />
}

export function EnvironmentCard({ data }: { data: Provisioning }) {
  const { platform, variables } = data
  return (
    <Card>
      <CardHeader
        title="Environment"
        description="What this site detected about the Appwrite project it runs in, and the variables it reads."
        action={
          <Badge tone={platform.cloud ? 'brand' : 'neutral'}>
            {platform.cloud ? <Cloud /> : <Server />}
            {platform.cloud ? 'Appwrite Cloud' : 'Self-hosted'}
          </Badge>
        }
      />
      <dl className="grid gap-x-6 gap-y-3 px-5 py-4 text-sm sm:grid-cols-[9rem_1fr]">
        <dt className="text-muted-foreground">Project</dt>
        <dd className="min-w-0">
          <CopyValue value={platform.projectId || 'unknown'} />
        </dd>
        <dt className="text-muted-foreground">API endpoint</dt>
        <dd className="min-w-0 truncate font-mono text-xs leading-6">{platform.endpoint || 'unknown'}</dd>
        {platform.region || platform.version ? (
          <>
            <dt className="text-muted-foreground">{platform.cloud ? 'Region' : 'Version'}</dt>
            <dd className="font-mono text-xs leading-6">{platform.cloud ? platform.region : platform.version}</dd>
          </>
        ) : null}
      </dl>
      {platform.publicEndpointWarning ? (
        <p className="mx-5 mb-4 flex gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Browsers can’t reach <span className="font-mono text-xs">{platform.endpoint}</span>. Set{' '}
            <span className="font-mono text-xs">APPWRITE_PUBLIC_ENDPOINT</span> to your Appwrite’s public URL so live updates work, then redeploy.
          </span>
        </p>
      ) : null}
      <div className="border-t">
        <p className="eyebrow px-5 pt-4 pb-1">Environment variables</p>
        <ul className="divide-y">
          {variables.map((variable) => (
            <li key={variable.name} className="flex items-start gap-3 px-5 py-3">
              {variable.set ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              ) : variable.required ? (
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              ) : (
                <MinusCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />
              )}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-medium">{variable.name}</span>
                  <span className="text-xs text-muted-foreground">{variable.required ? 'Required' : 'Optional'}</span>
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">{variable.description}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="border-t bg-muted/30 px-5 py-3 text-xs text-muted-foreground">
          Change variables in the Appwrite Console under this site’s Settings → Environment variables, then redeploy the site.
        </p>
      </div>
    </Card>
  )
}

// True when a resource step (not the scope release) still has work to do.
const needsResources = (data: Provisioning) =>
  data.steps.some((step) => step.id !== 'release' && step.state !== 'ready' && step.state !== 'skipped')

// The Create button waits for every scope the remaining work needs.
export function scopesBlocking(data: Provisioning) {
  const { scopes } = data
  return scopes.known && (scopes.missing.length > 0 || (scopes.setup.length > 0 && needsResources(data)))
}

export function ScopesCard({ data }: { data: Provisioning }) {
  const { scopes } = data
  const blocking = scopesBlocking(data)
  if (scopes.known && !blocking) return null
  const needed = new Set([...scopes.missing, ...(needsResources(data) ? scopes.setup : [])])
  return (
    <Card className={cn(blocking && 'border-warning/40')}>
      <CardHeader
        title={scopes.known ? 'Add scopes to this site' : 'Site scopes'}
        description={
          scopes.known
            ? needsResources(data) && scopes.missing.length === 0
              ? 'Setup gave back the scopes it only needed to create resources. To apply this update, add the highlighted ones again under the site’s Settings → Build → Scopes in the Appwrite Console, then check again. The update gives them back when it’s done.'
              : 'The site acts on your project with its own short-lived key. Give it the highlighted scopes under the site’s Settings → Build → Scopes in the Appwrite Console, then check again. You don’t need to redeploy.'
            : 'This key’s scopes can’t be read, which is normal in local development. If a step fails for a missing scope, the error names it.'
        }
      />
      <div className="grid gap-3 px-5 py-4">
        {scopes.groups.map((group) => (
          <div key={group.group} className="grid gap-1.5 sm:grid-cols-[6rem_1fr]">
            <span className="pt-0.5 text-xs text-muted-foreground">
              {group.group}
              {group.optional ? <span className="block text-[10px] uppercase tracking-wide">Optional</span> : null}
            </span>
            <span className="flex flex-wrap gap-1.5">
              {group.scopes.map((scope) => {
                const missing = scopes.missing.includes(scope) || scopes.setup.includes(scope) || scopes.optional.includes(scope)
                return (
                  <Badge
                    key={scope}
                    tone={!scopes.known ? 'outline' : !missing ? 'success' : needed.has(scope) ? 'warning' : 'outline'}
                    className="font-mono"
                  >
                    {scope}
                  </Badge>
                )
              })}
            </span>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          Setup removes {data.setupScopes.join(', ')} from the site when it finishes, since it only needs them to create resources.
        </p>
      </div>
    </Card>
  )
}

// Runs every step that isn't done, one at a time, waiting on the ones Appwrite
// finishes in the background (columns, indexes and the function build).
export function ProvisionPanel({
  data,
  onChange,
  title = 'Resources',
  description,
}: {
  data: Provisioning
  onChange: (data: Provisioning) => void
  title?: string
  description?: string
}) {
  const [running, setRunning] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const cancelled = useRef(false)
  useEffect(() => () => void (cancelled.current = true), [])

  const blocked = scopesBlocking(data)
  const pending = data.steps.filter((step) => step.state !== 'ready' && step.state !== 'skipped')
  const done = data.steps.length - pending.length

  async function refresh() {
    const next = await getProvisioning()
    if (!cancelled.current) onChange(next)
    return next
  }

  async function runAll() {
    setErrors({})
    let current = data
    for (const step of data.steps) {
      const latest = current.steps.find((item) => item.id === step.id)
      if (!latest || latest.state === 'ready' || latest.state === 'skipped') continue
      setRunning(step.id)
      try {
        // Function builds can take several minutes on a cold start, so wait up to 10.
        for (let attempt = 0; attempt < 200 && !cancelled.current; attempt++) {
          const { retry } = await runProvisioningStep({ data: { id: step.id, polling: attempt > 0 } })
          if (!retry) break
          await sleep(3000)
        }
        current = await refresh()
        const after = current.steps.find((item) => item.id === step.id)
        if (after?.state === 'failed') throw new Error(after.detail)
        // Later steps depend on this one, so stop rather than run them early.
        if (after?.state === 'working') throw new Error('Appwrite is still working on this. Select Check again in a minute, then continue.')
      } catch (error) {
        setErrors((existing) => ({ ...existing, [step.id]: errorMessage(error) }))
        setRunning(null)
        toast.error(`${step.label}: ${errorMessage(error)}`)
        return
      }
    }
    setRunning(null)
    if (isProvisioned(current.steps)) toast.success('Everything is set up')
  }

  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        action={<span className="font-mono text-xs text-muted-foreground tabular-nums">{done}/{data.steps.length}</span>}
      />
      {data.inspectError ? (
        <p className="mx-5 mt-4 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {data.inspectError}
        </p>
      ) : null}
      <ul className="divide-y">
        {data.steps.map((step) => (
          <li key={step.id} className="flex items-start gap-3 px-5 py-3">
            <span className="mt-0.5">
              <StepIcon state={step.state} running={running === step.id} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn('text-sm font-medium', step.state === 'skipped' && 'text-muted-foreground')}>{step.label}</p>
              <p className={cn('text-sm text-muted-foreground', errors[step.id] && 'text-destructive')}>{errors[step.id] ?? step.detail}</p>
            </div>
            {step.state === 'outdated' ? <Badge tone="warning">Update</Badge> : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-5 py-3">
        <p className="text-xs text-muted-foreground">
          {data.inspectError
            ? 'Fix the error above, then check again.'
            : blocked
              ? 'Add the missing scopes first.'
              : pending.length
                ? 'Safe to run more than once. Nothing that exists is changed.'
                : 'Every resource matches what Outlay needs.'}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={Boolean(running)} onClick={() => refresh().catch((error) => toast.error(errorMessage(error)))}>
            Check again
          </Button>
          {pending.length ? (
            <Button size="sm" variant="brand" disabled={blocked || Boolean(running)} onClick={runAll}>
              {running ? <Spinner /> : null}
              {done === 0 ? 'Create resources' : 'Update resources'}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  )
}
