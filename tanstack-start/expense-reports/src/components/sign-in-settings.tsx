import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { AuthMethodSwitch, type AuthMethod } from '#/components/auth-method-switch'
import { CodeStep } from '#/components/code-step'
import { Button } from '#/components/ui/button'
import { Field, FormError, PasswordInput } from '#/components/ui/field'
import { Card, CardHeader, Spinner } from '#/components/ui/primitives'
import { errorMessage } from '#/lib/utils'
import { changePassword, confirmSwitchToCodes, startSwitchToCodes, switchToPasswords } from '#/server/settings.functions'

const LABELS: Record<AuthMethod, string> = { otp: 'an emailed code', password: 'a password' }

// Switching never locks the admin out: passwords need theirs first, and
// emailed codes need one to arrive.
export function SignInMethodCard({
  method,
  cloud,
  canEdit,
  viewerEmail,
  viewerHasPassword,
  withoutPassword,
}: {
  method: AuthMethod
  cloud: boolean
  canEdit: boolean
  viewerEmail: string
  viewerHasPassword: boolean
  withoutPassword: number
}) {
  const router = useRouter()
  const [choice, setChoice] = useState<AuthMethod>(method)
  const [passwords, setPasswords] = useState({ password: '', confirm: '' })
  const [codeSent, setCodeSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    setChoice(method)
    setCodeSent(false)
    setError(null)
  }, [method])

  async function run(action: () => Promise<unknown>, done?: string) {
    setPending(true)
    setError(null)
    try {
      await action()
      if (done) toast.success(done)
      return true
    } catch (err) {
      setError(errorMessage(err))
      return false
    } finally {
      setPending(false)
    }
  }

  async function onSwitchToPasswords(event: FormEvent) {
    event.preventDefault()
    if (passwords.password !== passwords.confirm) return setError('The passwords don’t match.')
    const ok = await run(() => switchToPasswords({ data: { password: passwords.password || undefined } }), 'Everyone now signs in with a password')
    if (ok) await router.invalidate()
  }

  return (
    <Card>
      <CardHeader
        title="Sign-in method"
        description={canEdit ? `Everyone signs in with ${LABELS[method]}.` : `Everyone signs in with ${LABELS[method]}. Only owners and admins can change this.`}
      />
      <div className="grid gap-4 p-5">
        <AuthMethodSwitch value={choice} onChange={setChoice} cloud={cloud} disabled={!canEdit || pending || codeSent} />

        {canEdit && choice !== method && choice === 'password' ? (
          <form onSubmit={onSwitchToPasswords} className="grid gap-4 rounded-lg border bg-muted/30 p-4">
            <p className="text-sm text-muted-foreground">
              {withoutPassword > 0
                ? `${withoutPassword} teammate${withoutPassword === 1 ? '' : 's'} won’t be able to sign in until you set a password for them under Team.`
                : 'Every teammate already has a password.'}
              {viewerHasPassword ? ' Leave the fields empty to keep your current password.' : ' Choose yours first.'}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={viewerHasPassword ? 'New password' : 'Your password'} htmlFor="switch-password">
                <PasswordInput
                  id="switch-password"
                  autoComplete="new-password"
                  minLength={8}
                  required={!viewerHasPassword}
                  value={passwords.password}
                  onChange={(event) => setPasswords((current) => ({ ...current, password: event.target.value }))}
                />
              </Field>
              <Field label="Confirm password" htmlFor="switch-confirm">
                <PasswordInput
                  id="switch-confirm"
                  autoComplete="new-password"
                  minLength={8}
                  required={!viewerHasPassword || Boolean(passwords.password)}
                  value={passwords.confirm}
                  onChange={(event) => setPasswords((current) => ({ ...current, confirm: event.target.value }))}
                />
              </Field>
            </div>
            <FormError message={error} />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setChoice(method)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" variant="brand" disabled={pending}>
                {pending ? <Spinner /> : null}
                Switch to passwords
              </Button>
            </div>
          </form>
        ) : null}

        {canEdit && choice !== method && choice === 'otp' ? (
          <div className="grid gap-4 rounded-lg border bg-muted/30 p-4">
            {codeSent ? (
              <CodeStep
                email={viewerEmail}
                submitLabel="Switch to email codes"
                onVerify={async (code) => {
                  await confirmSwitchToCodes({ data: { code } })
                  toast.success('Everyone now signs in with an emailed code')
                  await router.invalidate()
                }}
                onResend={async () => {
                  await startSwitchToCodes()
                }}
                onBack={() => setCodeSent(false)}
              />
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  We’ll email a code to <span className="font-medium text-foreground">{viewerEmail}</span> to check that sign-in emails arrive.
                  {cloud ? null : ' On self-hosted Appwrite, that needs SMTP.'} Passwords stay saved if you switch back later.
                </p>
                <FormError message={error} />
                <div className="flex justify-end gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setChoice(method)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="brand"
                    disabled={pending}
                    onClick={async () => {
                      if (await run(() => startSwitchToCodes())) setCodeSent(true)
                    }}
                  >
                    {pending ? <Spinner /> : null}
                    Send code
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </Card>
  )
}

export function PasswordCard({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter()
  const [form, setForm] = useState({ current: '', password: '', confirm: '' })
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (form.password !== form.confirm) return setError('The new passwords don’t match.')
    setPending(true)
    setError(null)
    try {
      await changePassword({ data: { current: form.current || undefined, password: form.password } })
      setForm({ current: '', password: '', confirm: '' })
      toast.success('Password changed')
      await router.invalidate()
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
      <CardHeader title="Password" description={hasPassword ? 'Change the password you sign in with.' : 'You don’t have a password yet. Set one to sign in.'} />
      <form onSubmit={onSubmit} className="grid gap-4 p-5 sm:grid-cols-3">
        {hasPassword ? (
          <Field label="Current password" htmlFor="current-password">
            <PasswordInput id="current-password" autoComplete="current-password" required value={form.current} onChange={update('current')} />
          </Field>
        ) : null}
        <Field label="New password" htmlFor="new-password">
          <PasswordInput id="new-password" autoComplete="new-password" required minLength={8} value={form.password} onChange={update('password')} />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm-password">
          <PasswordInput id="confirm-password" autoComplete="new-password" required minLength={8} value={form.confirm} onChange={update('confirm')} />
        </Field>
        <div className="grid gap-3 sm:col-span-3">
          <FormError message={error} />
          <div>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? <Spinner /> : null}
              {hasPassword ? 'Change password' : 'Set password'}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  )
}
