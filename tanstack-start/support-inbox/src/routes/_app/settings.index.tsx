import type { FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Field, Input, Textarea } from '#/components/ui/field'
import { PasswordCard, SignInMethodCard } from '#/components/sign-in-settings'
import { Card, CardHeader, Spinner } from '#/components/ui/primitives'
import { useAction } from '#/lib/use-action'
import { cn } from '#/lib/utils'
import { getSettings, updateProfile, updateWorkspace } from '#/server/settings.functions'

export const Route = createFileRoute('/_app/settings/')({
  loader: () => getSettings(),
  head: () => ({ meta: [{ title: 'Settings · Mailroom' }] }),
  component: GeneralSettings,
})

function GeneralSettings() {
  const { viewer, workspace, authMethod, cloud, viewerHasPassword, agents } = Route.useLoaderData()
  const workspaceAction = useAction()
  const profileAction = useAction()

  async function onWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await workspaceAction.run(
      () => updateWorkspace({ data: { name: String(form.get('name')), replyToName: String(form.get('replyToName')) } }),
      'Workspace updated',
    )
  }

  async function onProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await profileAction.run(
      () => updateProfile({ data: { name: String(form.get('name')), signature: String(form.get('signature')) } }),
      'Profile updated',
    )
  }

  return (
    <>
      <Card>
        <CardHeader title="Your profile" description="Your name appears on replies. The signature is added below every reply you send." />
        <form onSubmit={onProfile} className="grid gap-4 p-5">
          <Field label="Name" htmlFor="profile-name">
            <Input id="profile-name" name="name" defaultValue={viewer.name} required maxLength={128} />
          </Field>
          <Field label="Signature" htmlFor="profile-signature">
            <Textarea
              id="profile-signature"
              name="signature"
              defaultValue={viewer.signature}
              rows={3}
              maxLength={2000}
              placeholder={`${viewer.name}\n${workspace.name}`}
            />
          </Field>
          <div>
            <Button type="submit" size="sm" disabled={profileAction.pending}>
              {profileAction.pending ? <Spinner /> : null}
              Save profile
            </Button>
          </div>
        </form>
      </Card>

      <Card className={cn(!viewer.isAdmin && 'opacity-80')}>
        <CardHeader
          title="Workspace"
          description={viewer.isAdmin ? 'Customers see the reply-to name on every email you send.' : 'Only owners and admins can change these.'}
        />
        <form onSubmit={onWorkspace} className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Workspace name" htmlFor="workspace-name">
            <Input id="workspace-name" name="name" defaultValue={workspace.name} required maxLength={64} disabled={!viewer.isAdmin} />
          </Field>
          <Field label="Reply-to name" htmlFor="workspace-reply" hint="Defaults to the workspace name.">
            <Input id="workspace-reply" name="replyToName" defaultValue={workspace.replyToName} maxLength={128} disabled={!viewer.isAdmin} />
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
        withoutPassword={agents.filter((agent) => !agent.hasPassword && agent.id !== viewer.id).length}
      />
    </>
  )
}
