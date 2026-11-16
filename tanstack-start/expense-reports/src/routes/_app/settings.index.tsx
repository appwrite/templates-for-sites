import type { FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Field, Input, Select } from '#/components/ui/field'
import { PasswordCard, SignInMethodCard } from '#/components/sign-in-settings'
import { Card, CardHeader, Spinner } from '#/components/ui/primitives'
import { CURRENCIES } from '#/lib/money'
import { useAction } from '#/lib/use-action'
import { cn } from '#/lib/utils'
import { getSettings, updateProfile, updateWorkspace } from '#/server/settings.functions'

export const Route = createFileRoute('/_app/settings/')({
  loader: () => getSettings(),
  head: () => ({ meta: [{ title: 'Settings · Outlay' }] }),
  component: GeneralSettings,
})

function GeneralSettings() {
  const { viewer, workspace, authMethod, cloud, viewerHasPassword, members } = Route.useLoaderData()
  const workspaceAction = useAction()
  const profileAction = useAction()

  async function onWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await workspaceAction.run(
      () =>
        updateWorkspace({
          data: { name: String(form.get('name')), currency: String(form.get('currency')) as (typeof CURRENCIES)[number] },
        }),
      'Workspace updated',
    )
  }

  async function onProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await profileAction.run(() => updateProfile({ data: { name: String(form.get('name')) } }), 'Profile updated')
  }

  return (
    <>
      <Card>
        <CardHeader title="Your profile" description="Your name appears on your expenses and reports." />
        <form onSubmit={onProfile} className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Name" htmlFor="profile-name">
            <Input id="profile-name" name="name" defaultValue={viewer.name} required maxLength={128} />
          </Field>
          <Button type="submit" size="sm" className="h-9" disabled={profileAction.pending}>
            {profileAction.pending ? <Spinner /> : null}
            Save
          </Button>
        </form>
      </Card>

      <Card className={cn(!viewer.isAdmin && 'opacity-80')}>
        <CardHeader
          title="Workspace"
          description={
            viewer.isAdmin
              ? 'The default currency is used for new expenses, category limits and dashboard totals.'
              : 'Only owners and admins can change these.'
          }
        />
        <form onSubmit={onWorkspace} className="grid gap-4 p-5 sm:grid-cols-[1fr_9rem]">
          <Field label="Company name" htmlFor="workspace-name">
            <Input id="workspace-name" name="name" defaultValue={workspace.name} required maxLength={64} disabled={!viewer.isAdmin} />
          </Field>
          <Field label="Default currency" htmlFor="workspace-currency">
            <Select id="workspace-currency" name="currency" defaultValue={workspace.currency} disabled={!viewer.isAdmin}>
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Field>
          {viewer.isAdmin ? (
            <div className="sm:col-span-2">
              <Button type="submit" size="sm" disabled={workspaceAction.pending}>
                {workspaceAction.pending ? <Spinner /> : null}
                Save workspace
              </Button>
            </div>
          ) : null}
        </form>
      </Card>

      {authMethod === 'password' ? <PasswordCard hasPassword={viewerHasPassword} /> : null}

      <SignInMethodCard
        method={authMethod}
        cloud={cloud}
        canEdit={viewer.isAdmin}
        viewerEmail={viewer.email}
        viewerHasPassword={viewerHasPassword}
        withoutPassword={members.filter((member) => !member.hasPassword && member.id !== viewer.id).length}
      />
    </>
  )
}
