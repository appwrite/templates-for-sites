import { createServerFn } from '@tanstack/react-start'
import { getRequestUrl } from '@tanstack/react-start/server'
import { z } from 'zod'
import { getTeamPrefs, intakeSettings, isCloud, requireAdmin, requireAgent, updateTeamPrefs } from './appwrite.server'

export const getIntakeConfig = createServerFn({ method: 'GET' }).handler(async () => {
  const { viewer } = await requireAgent()
  const settings = intakeSettings(await getTeamPrefs())
  const site = getRequestUrl({ xForwardedHost: true }).origin
  return {
    canEdit: viewer.isAdmin,
    viewerEmail: viewer.email,
    viewerName: viewer.name,
    cloud: isCloud(),
    endpoint: `${site}/api/tickets`,
    site,
    ...settings,
  }
})

const origin = z
  .string()
  .trim()
  .transform((value, context) => {
    try {
      const url = new URL(value)
      if (!/^https?:$/.test(url.protocol)) throw new Error()
      return url.origin
    } catch {
      context.addIssue({ code: 'custom', message: `${value} isn't an origin like https://example.com.` })
      return z.NEVER
    }
  })

export const updateIntake = createServerFn({ method: 'POST' })
  .validator(z.object({ enabled: z.boolean(), origins: z.array(origin).max(25) }))
  .handler(async ({ data }) => {
    await requireAdmin()
    await updateTeamPrefs({ intake: { enabled: data.enabled, origins: [...new Set(data.origins)] } })
    return { ok: true }
  })
