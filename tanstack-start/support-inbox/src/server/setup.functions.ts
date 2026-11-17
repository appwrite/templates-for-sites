import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { ENDPOINT, PROJECT_ID, PUBLIC_ENDPOINT, builtInMailDomain, isCloud, needsSetup } from './appwrite.server'
import { FUNCTION_VERSION, explainError, inspectProject, missingScopes, runStep } from './provision.server'
import { SETUP_SCOPES, SITE_SCOPES } from './schema.server'
import { SETUP_TOKEN_VARIABLE, requireProvisioningAccess, setupTokenConfigured, setupUnlocked, unlockSetup } from './setup.server'

export interface SetupVariable {
  name: string
  required: boolean
  set: boolean
  value: string | null
  description: string
}

// Hostnames a browser can't reach, such as a Docker service name.
function looksInternal(endpoint: string) {
  try {
    const host = new URL(endpoint).hostname
    return !host.includes('.') || host === 'localhost' || /^(127|10)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)
  } catch {
    return true
  }
}

export const getSetupGate = createServerFn({ method: 'GET' }).handler(async () => {
  let open = true
  try {
    open = await needsSetup()
  } catch {
    // The key may be missing scopes; the setup page explains which.
  }
  return { open, tokenVariable: SETUP_TOKEN_VARIABLE, tokenConfigured: setupTokenConfigured(), unlocked: setupUnlocked() }
})

export const unlock = createServerFn({ method: 'POST' })
  .validator(z.object({ token: z.string().min(1, 'Enter the setup token.').max(512) }))
  .handler(async ({ data }) => {
    unlockSetup(data.token)
    return { ok: true }
  })

export const getProvisioning = createServerFn({ method: 'GET' }).handler(async () => {
  await requireProvisioningAccess()
  const cloud = isCloud()
  const missing = missingScopes()

  const variables: SetupVariable[] = [
    {
      name: SETUP_TOKEN_VARIABLE,
      required: true,
      set: setupTokenConfigured(),
      value: null,
      description: 'Any passphrase. Whoever opens this page has to enter it before they can set up the workspace.',
    },
    {
      name: 'APPWRITE_PUBLIC_ENDPOINT',
      required: false,
      set: Boolean(process.env.APPWRITE_PUBLIC_ENDPOINT),
      value: PUBLIC_ENDPOINT,
      description: 'Self-hosted only. The Appwrite endpoint browsers use for live updates, when the site reaches Appwrite on an internal address.',
    },
  ]

  let steps: Awaited<ReturnType<typeof inspectProject>> = []
  let inspectError: string | null = null
  try {
    steps = await inspectProject()
  } catch (error) {
    inspectError = explainError(error)
  }

  const domain = builtInMailDomain()
  return {
    platform: {
      cloud,
      endpoint: ENDPOINT,
      publicEndpoint: PUBLIC_ENDPOINT,
      publicEndpointWarning: !process.env.APPWRITE_PUBLIC_ENDPOINT && looksInternal(ENDPOINT),
      projectId: PROJECT_ID,
      region: process.env.APPWRITE_REGION ?? null,
      version: process.env.APPWRITE_VERSION ?? null,
      siteId: process.env.APPWRITE_SITE_ID ?? null,
    },
    scopes: {
      known: missing !== null,
      missing: missing?.required ?? [],
      setup: missing?.setup ?? [],
      optional: missing?.optional ?? [],
      groups: SITE_SCOPES,
    },
    setupScopes: SETUP_SCOPES,
    variables,
    email: { trigger: cloud, address: domain ? `support@${domain}` : null },
    functionVersion: FUNCTION_VERSION,
    steps,
    inspectError,
  }
})

export const runProvisioningStep = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1).max(64), polling: z.boolean().default(false) }))
  .handler(async ({ data }) => {
    await requireProvisioningAccess()
    try {
      return await runStep(data.id, data.polling)
    } catch (error) {
      throw new Error(explainError(error))
    }
  })
