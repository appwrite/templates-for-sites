import { useState, type FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { KeyRound, Plus, Trash2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { generatePassword } from '#/components/auth-method-switch'
import { Button } from '#/components/ui/button'
import { Field, FormError, Input, PasswordInput, Select } from '#/components/ui/field'
import { Dialog, DialogContent, DialogTrigger } from '#/components/ui/menu'
import { Avatar, Badge, Card, CardHeader } from '#/components/ui/primitives'
import { useAction } from '#/lib/use-action'
import { errorMessage } from '#/lib/utils'
import { addAgent, getSettings, removeAgent, setAgentPassword } from '#/server/settings.functions'

export const Route = createFileRoute('/_app/settings/team')({
  loader: () => getSettings(),
  head: () => ({ meta: [{ title: 'Team · Mailroom' }] }),
  component: TeamSettings,
})

// A password field with a button that fills in a strong one and copies it.
function NewPassword({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex gap-2">
      <div className="min-w-0 flex-1">
        <PasswordInput id={id} value={value} onChange={(event) => onChange(event.target.value)} autoComplete="new-password" required minLength={8} />
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-9"
        onClick={async () => {
          const generated = generatePassword()
          onChange(generated)
          await navigator.clipboard.writeText(generated).catch(() => undefined)
          toast.success('Generated and copied a password')
        }}
      >
        <Wand2 />
        Generate
      </Button>
    </div>
  )
}

function TeamSettings() {
  const { viewer, agents, authMethod } = Route.useLoaderData()
  const teamAction = useAction()
  const passwords = authMethod === 'password'
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [invitePassword, setInvitePassword] = useState('')
  const [resetFor, setResetFor] = useState<{ id: string; name: string } | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetError, setResetError] = useState<string | null>(null)

  async function onInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setInviteError(null)
    try {
      await addAgent({
        data: {
          name: String(form.get('name')),
          email: String(form.get('email')),
          role: form.get('role') === 'admin' ? 'admin' : 'agent',
          password: passwords ? invitePassword : undefined,
        },
      })
      setInviteOpen(false)
      setInvitePassword('')
      await teamAction.run(async () => undefined, passwords ? 'Teammate added. Share their password with them.' : 'Teammate added')
    } catch (error) {
      setInviteError(errorMessage(error))
    }
  }

  async function onReset(event: FormEvent) {
    event.preventDefault()
    if (!resetFor) return
    setResetError(null)
    try {
      await setAgentPassword({ data: { userId: resetFor.id, password: resetPassword } })
      setResetFor(null)
      setResetPassword('')
      await teamAction.run(async () => undefined, `Password set for ${resetFor.name}`)
    } catch (error) {
      setResetError(errorMessage(error))
    }
  }

  return (
    <Card>
      <CardHeader
        title="Team"
        description="Everyone here can read and answer every conversation. Admins can also change email and workspace settings."
        action={
          viewer.isAdmin ? (
            <Dialog
              open={inviteOpen}
              onOpenChange={(open) => {
                setInviteOpen(open)
                setInviteError(null)
                setInvitePassword('')
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Plus />
                  Add teammate
                </Button>
              </DialogTrigger>
              <DialogContent
                title="Add a teammate"
                description={
                  passwords
                    ? 'Set a password for them and share it. They can change it in Settings → General.'
                    : 'They sign in at this site with a one-time code sent to their email. No password to share.'
                }
              >
                <form onSubmit={onInvite} className="grid gap-4">
                  <Field label="Name" htmlFor="invite-name">
                    <Input id="invite-name" name="name" required maxLength={128} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
                    <Field label="Email" htmlFor="invite-email">
                      <Input id="invite-email" name="email" type="email" required />
                    </Field>
                    <Field label="Role" htmlFor="invite-role">
                      <Select id="invite-role" name="role" defaultValue="agent">
                        <option value="agent">Agent</option>
                        <option value="admin">Admin</option>
                      </Select>
                    </Field>
                  </div>
                  {passwords ? (
                    <Field label="Password" htmlFor="invite-password" hint="At least 8 characters.">
                      <NewPassword id="invite-password" value={invitePassword} onChange={setInvitePassword} />
                    </Field>
                  ) : null}
                  <FormError message={inviteError} />
                  <div className="flex justify-end">
                    <Button type="submit" variant="brand" size="sm" disabled={teamAction.pending}>
                      Add teammate
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          ) : null
        }
      />
      <ul className="divide-y">
        {agents.map((agent) => {
          const canReset = viewer.isAdmin && agent.id !== viewer.id && (!agent.roles.includes('owner') || viewer.roles.includes('owner'))
          return (
            <li key={agent.membershipId} className="flex items-center gap-3 px-5 py-3">
              <Avatar name={agent.name} email={agent.id} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {agent.name || agent.email}
                  {agent.id === viewer.id ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">{agent.email}</p>
              </div>
              {passwords && !agent.hasPassword ? (
                <Badge tone="warning" title="They can't sign in until they have a password.">
                  No password
                </Badge>
              ) : null}
              {agent.roles.map((role) => (
                <Badge key={role} tone={role === 'owner' ? 'brand' : 'outline'} className="capitalize">
                  {role}
                </Badge>
              ))}
              {passwords && canReset ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Set a password for ${agent.name || agent.email}`}
                  title="Set password"
                  disabled={teamAction.pending}
                  onClick={() => {
                    setResetFor({ id: agent.id, name: agent.name || agent.email })
                    setResetPassword('')
                    setResetError(null)
                  }}
                >
                  <KeyRound />
                </Button>
              ) : null}
              {viewer.isAdmin && agent.id !== viewer.id && !agent.roles.includes('owner') ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${agent.name}`}
                  disabled={teamAction.pending}
                  onClick={() => {
                    if (window.confirm(`Remove ${agent.name || agent.email} from the team?`)) {
                      void teamAction.run(() => removeAgent({ data: { membershipId: agent.membershipId } }), 'Teammate removed')
                    }
                  }}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </li>
          )
        })}
      </ul>

      <Dialog open={Boolean(resetFor)} onOpenChange={(open) => (open ? null : setResetFor(null))}>
        <DialogContent
          title={`Set a password for ${resetFor?.name ?? ''}`}
          description="It replaces their current password. Share it with them; they can change it in Settings → General."
        >
          <form onSubmit={onReset} className="grid gap-4">
            <Field label="New password" htmlFor="reset-password" hint="At least 8 characters.">
              <NewPassword id="reset-password" value={resetPassword} onChange={setResetPassword} />
            </Field>
            <FormError message={resetError} />
            <div className="flex justify-end">
              <Button type="submit" variant="brand" size="sm" disabled={teamAction.pending}>
                Set password
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
