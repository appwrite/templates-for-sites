import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { EnvironmentCard, ProvisionPanel, ScopesCard, type Provisioning } from '#/components/provisioning'
import { getProvisioning } from '#/server/setup.functions'

export const Route = createFileRoute('/_app/settings/system')({
  loader: () => getProvisioning(),
  head: () => ({ meta: [{ title: 'System · Outlay' }] }),
  component: SystemSettings,
})

function SystemSettings() {
  const loaded = Route.useLoaderData()
  const [data, setData] = useState<Provisioning>(loaded)
  useEffect(() => setData(loaded), [loaded])

  return (
    <>
      <ProvisionPanel
        data={data}
        onChange={setData}
        title="Resources"
        description={`What Outlay needs in this Appwrite project. After you deploy a new version of the site, update here to add new columns and redeploy the receipts function (bundled version ${data.functionVersion}).`}
      />
      <ScopesCard data={data} />
      <EnvironmentCard data={data} />
    </>
  )
}
