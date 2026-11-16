import { useState, type FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { KeyRound, Plus, Trash2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { generatePassword } from '#/components/auth-method-switch'
import { Button } from '#/components/ui/button'
import { Field, FormError, Input, PasswordInput, Select } from '#/components/ui/field'
import { Dialog, DialogContent, DialogTrigger } from '#/components/ui/menu'
import { Avatar, Badge, Card, CardHeader } from '#/components/ui/primitives'
import type { Role } from '#/lib/types'
import { useAction } from '#/lib/use-action'
import { ROLE_LABELS, errorMessage } from '#/lib/utils'
import { addMember, getSettings, removeMember, setMemberPassword, updateMemberRole } from '#/server/settings.functions'

export const Route = createFileRoute('/_app/settings/team')({
  loader: () => getSettings(),
  head: () => ({ meta: [{ title: 'Team · Outlay' }] }),
  component: TeamSettings,
})

const ASSIGNABLE = ['member', 'approver', 'admin'] as const

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
  const { viewer, members, authMethod } = Route.useLoaderData()
  const action = useAction()
  const passwords = authMethod === 'password'
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [resetFor, setResetFor] = useState<{ id: string; name: string } | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetError, setResetError] = useState<string | null>(null)

  async function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError(null)
    try {
      await addMember({
        data: {
          name: String(form.get('name')),
          email: String(form.get('email')),
          role: String(form.get('role')) as (typeof ASSIGNABLE)[number],
          password: passwords ? newPassword : undefined,
        },
      })
      setOpen(false)
      setNewPassword('')
      await action.run(async () => undefined, passwords ? 'Teammate added. Share their password with them.' : 'Teammate added')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function onReset(event: FormEvent) {
    event.preventDefault()
    if (!resetFor) return
    setResetError(null)
    try {
      await setMemberPassword({ data: { userId: resetFor.id, password: resetPassword } })
      setResetFor(null)
      setResetPassword('')
      await action.run(async () => undefined, `Password set for ${resetFor.name}`)
    } catch (err) {
      setResetError(errorMessage(err))
    }
  }

  return (
    <Card>
      <CardHeader
        title="Team"
        description="Members submit expenses. Approvers review reports. Admins also manage settings and mark reports reimbursed."
        action={
          viewer.isAdmin ? (
            <Dialog open={open} onOpenChange={(next) => (setOpen(next), setError(null), setNewPassword(''))}>
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
                    : 'They sign in with a code sent to their email.'
                }
              >
                <form onSubmit={onAdd} className="grid gap-4">
                  <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
                    <Field label="Name" htmlFor="member-name">
                      <Input id="member-name" name="name" required maxLength={128} />
                    </Field>
                    <Field label="Role" htmlFor="member-role">
                      <Select id="member-role" name="role" defaultValue="member">
                        {ASSIGNABLE.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <Field label="Work email" htmlFor="member-email" hint="Receipts they forward from this address are filed for them.">
                    <Input id="member-email" name="email" type="email" required />
                  </Field>
                  {passwords ? (
                    <Field label="Password" htmlFor="member-password" hint="At least 8 characters.">
                      <NewPassword id="member-password" value={newPassword} onChange={setNewPassword} />
                    </Field>
                  ) : null}
                  <FormError message={error} />
                  <div className="flex justify-end">
                    <Button type="submit" size="sm" variant="brand" disabled={action.pending}>
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
        {members.map((member) => {
          const editable = viewer.isAdmin && member.id !== viewer.id && member.role !== 'owner'
          const canReset = viewer.isAdmin && member.id !== viewer.id && (member.role !== 'owner' || viewer.role === 'owner')
          return (
            <li key={member.membershipId} className="flex items-center gap-3 px-5 py-3">
              <Avatar name={member.name} email={member.email} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {member.name}
                  {member.id === viewer.id ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">{member.email}</p>
              </div>
              {passwords && !member.hasPassword ? (
                <Badge tone="warning" title="They can't sign in until they have a password.">
                  No password
                </Badge>
              ) : null}
              {editable ? (
                <Select
                  aria-label={`Role for ${member.name}`}
                  value={member.role}
                  disabled={action.pending}
                  onChange={(event) =>
                    action.run(
                      () => updateMemberRole({ data: { membershipId: member.membershipId, role: event.target.value as (typeof ASSIGNABLE)[number] } }),
                      'Role updated',
                    )
                  }
                  className="h-8 w-32 text-xs"
                >
                  {ASSIGNABLE.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </Select>
              ) : (
                <Badge tone={member.role === 'owner' ? 'brand' : 'outline'}>{ROLE_LABELS[member.role as Role]}</Badge>
              )}
              {passwords && canReset ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Set a password for ${member.name}`}
                  title="Set password"
                  disabled={action.pending}
                  onClick={() => {
                    setResetFor({ id: member.id, name: member.name || member.email })
                    setResetPassword('')
                    setResetError(null)
                  }}
                >
                  <KeyRound />
                </Button>
              ) : null}
              {editable ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${member.name}`}
                  disabled={action.pending}
                  onClick={() => {
                    if (window.confirm(`Remove ${member.name} from the workspace?`)) {
                      void action.run(() => removeMember({ data: { membershipId: member.membershipId } }), 'Teammate removed')
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

      <Dialog open={Boolean(resetFor)} onOpenChange={(next) => (next ? null : setResetFor(null))}>
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
              <Button type="submit" size="sm" variant="brand" disabled={action.pending}>
                Set password
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
