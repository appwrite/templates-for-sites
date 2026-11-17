import { createServerFn } from '@tanstack/react-start'
import { AppwriteException, ID, Query, SmtpEncryption, type Models } from 'node-appwrite'
import { z } from 'zod'
import {
  INBOUND_FUNCTION_ID,
  PROJECT_ID,
  admin,
  builtInMailDomain,
  inboundMxHost,
  getTeamPrefs,
  getWorkspace,
  inboundFunction,
  intakeSettings,
  isCloud,
  requireAdmin,
  requireAgent,
  updateInboundFunction,
  updateTeamPrefs,
} from './appwrite.server'

// The provider Mailroom creates and edits. Providers added in the Console are
// listed too, but left alone.
const MANAGED_PROVIDER_ID = 'mailroom-email'

const PROVIDERS = ['resend', 'sendgrid', 'mailgun', 'ses', 'smtp'] as const
export type EmailProviderKind = (typeof PROVIDERS)[number]

export interface EmailDomain {
  id: string
  domain: string
  status: string
  verified: boolean
  records: { type: 'MX' | 'TXT'; host: string; name: string; value: string; priority?: number }[]
}

export interface EmailProvider {
  id: string
  name: string
  provider: string
  enabled: boolean
  managed: boolean
  fromName: string
  fromEmail: string
  // Non-secret connection details, used to prefill the form. Keys and passwords never leave the server.
  details: Record<string, string | number | boolean>
}

function recordName(domain: string) {
  const labels = domain.split('.')
  return labels.length > 2 ? labels.slice(0, -2).join('.') : '@'
}

function toDomain(rule: Models.ProxyRule, mx: string): EmailDomain {
  const name = recordName(rule.domain)
  return {
    id: rule.$id,
    domain: rule.domain,
    status: String(rule.status),
    verified: String(rule.status) === 'verified',
    records: [
      { type: 'MX', host: rule.domain, name, value: mx, priority: 10 },
      { type: 'TXT', host: `_appwrite.${rule.domain}`, name: name === '@' ? '_appwrite' : `_appwrite.${name}`, value: PROJECT_ID },
    ],
  }
}

function toProvider(provider: Models.Provider): EmailProvider {
  const options = (provider.options ?? {}) as Record<string, unknown>
  const credentials = (provider.credentials ?? {}) as Record<string, unknown>
  const details: EmailProvider['details'] = {}
  for (const key of ['domain', 'isEuRegion', 'region', 'host', 'port', 'username']) {
    const value = credentials[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') details[key] = value
  }
  if (typeof options.encryption === 'string') details.encryption = options.encryption || 'none'
  if (typeof options.autoTLS === 'boolean') details.autoTLS = options.autoTLS
  return {
    id: provider.$id,
    name: provider.name,
    provider: provider.provider,
    enabled: provider.enabled,
    managed: provider.$id === MANAGED_PROVIDER_ID,
    fromName: typeof options.fromName === 'string' ? options.fromName : '',
    fromEmail: typeof options.fromEmail === 'string' ? options.fromEmail : '',
    details,
  }
}

async function listEmailProviders() {
  const { providers } = await admin().messaging.listProviders({ queries: [Query.equal('type', 'email'), Query.limit(25)] })
  return providers.map(toProvider)
}

export const getEmailSettings = createServerFn({ method: 'GET' }).handler(async () => {
  const { viewer } = await requireAgent()
  const { proxy } = admin()
  const cloud = isCloud()
  // Email triggers and email domains only exist on Appwrite Cloud.
  const [workspace, prefs, fn, providers, rules, mx] = await Promise.all([
    getWorkspace(),
    getTeamPrefs(),
    cloud ? inboundFunction() : null,
    listEmailProviders(),
    cloud
      ? proxy
          .listRules({ queries: [Query.equal('deploymentResourceId', [INBOUND_FUNCTION_ID]), Query.equal('protocol', ['smtp']), Query.limit(25)] })
          .then(({ rules }) => rules)
          .catch(() => [])
      : [],
    cloud ? inboundMxHost() : '',
  ])

  return {
    cloud,
    intakeEnabled: intakeSettings(prefs).enabled,
    canEdit: viewer.isAdmin,
    viewerEmail: viewer.email,
    workspace,
    builtInDomain: builtInMailDomain(),
    inbound: {
      functionId: INBOUND_FUNCTION_ID,
      deployed: Boolean(fn?.deploymentId),
      emailEnabled: Boolean((fn as unknown as { emailEnabled?: boolean } | null)?.emailEnabled),
    },
    domains: rules.map((rule) => toDomain(rule, mx)),
    providers,
  }
})

export const setEmailTrigger = createServerFn({ method: 'POST' })
  .validator(z.object({ enabled: z.boolean() }))
  .handler(async ({ data }) => {
    await requireAdmin()
    const fn = await inboundFunction()
    if (!fn) throw new Error(`The ${INBOUND_FUNCTION_ID} function doesn't exist yet. Create it under Settings → System.`)
    await updateInboundFunction(fn, { emailEnabled: data.enabled })
    return { ok: true }
  })

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'Enter a domain like mail.example.com.')

export const addEmailDomain = createServerFn({ method: 'POST' })
  .validator(z.object({ domain: domainSchema }))
  .handler(async ({ data }) => {
    await requireAdmin()
    if (data.domain.endsWith('.appwrite.email')) throw new Error('Use a domain you own. The built-in address already works.')
    await admin().proxy.createSMTPRule({ domain: data.domain, functionId: INBOUND_FUNCTION_ID })
    return { ok: true }
  })

export const verifyEmailDomain = createServerFn({ method: 'POST' })
  .validator(z.object({ ruleId: z.string().min(1).max(64) }))
  .handler(async ({ data }) => {
    await requireAdmin()
    const rule = await admin().proxy.updateRuleStatus({ ruleId: data.ruleId })
    return { verified: String(rule.status) === 'verified', status: String(rule.status) }
  })

export const removeEmailDomain = createServerFn({ method: 'POST' })
  .validator(z.object({ ruleId: z.string().min(1).max(64) }))
  .handler(async ({ data }) => {
    await requireAdmin()
    await admin().proxy.deleteRule({ ruleId: data.ruleId })
    return { ok: true }
  })

export const setSupportAddress = createServerFn({ method: 'POST' })
  .validator(z.object({ address: z.email().trim().toLowerCase() }))
  .handler(async ({ data }) => {
    await requireAdmin()
    const { proxy } = admin()
    const domain = data.address.split('@')[1]
    // Self-hosted workspaces receive through /api/tickets, so any address their provider routes there works.
    if (isCloud() && domain !== builtInMailDomain()) {
      const { rules } = await proxy.listRules({ queries: [Query.equal('domain', [domain]), Query.equal('protocol', ['smtp'])] })
      if (!rules.some((rule) => String(rule.status) === 'verified')) {
        throw new Error(`Verify ${domain} before using it as the support address.`)
      }
    }
    await updateTeamPrefs({ mailbox: data.address })
    return { ok: true }
  })

const sender = { fromName: z.string().trim().max(128), fromEmail: z.email().trim().toLowerCase() }
const secret = z.string().trim().max(1024).optional()

const providerInput = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('resend'), ...sender, apiKey: secret }),
  z.object({ provider: z.literal('sendgrid'), ...sender, apiKey: secret }),
  z.object({ provider: z.literal('mailgun'), ...sender, apiKey: secret, domain: z.string().trim().min(3).max(253), isEuRegion: z.boolean() }),
  z.object({ provider: z.literal('ses'), ...sender, accessKey: secret, secretKey: secret, region: z.string().trim().min(3).max(32) }),
  z.object({
    provider: z.literal('smtp'),
    ...sender,
    host: z.string().trim().min(3).max(253),
    port: z.number().int().min(1).max(65535),
    username: z.string().trim().max(256),
    password: secret,
    encryption: z.enum(['none', 'ssl', 'tls']),
  }),
])

const PROVIDER_LABELS: Record<EmailProviderKind, string> = {
  resend: 'Resend',
  sendgrid: 'SendGrid',
  mailgun: 'Mailgun',
  ses: 'Amazon SES',
  smtp: 'SMTP',
}

export const saveEmailProvider = createServerFn({ method: 'POST' })
  .validator(providerInput)
  .handler(async ({ data }) => {
    await requireAdmin()
    const { messaging } = admin()
    let existing: Models.Provider | null = null
    try {
      existing = await messaging.getProvider({ providerId: MANAGED_PROVIDER_ID })
    } catch (error) {
      if (!(error instanceof AppwriteException && error.code === 404)) throw error
    }

    // Switching services replaces the provider; a blank secret keeps the saved one.
    if (existing && existing.provider !== data.provider) {
      await messaging.deleteProvider({ providerId: MANAGED_PROVIDER_ID })
      existing = null
    }

    const requireSecret = (value: string | undefined, label: string) => {
      if (!existing && !value) throw new Error(`Enter the ${label}.`)
      return value || undefined
    }

    const common = {
      providerId: MANAGED_PROVIDER_ID,
      name: `${PROVIDER_LABELS[data.provider]} (Mailroom)`,
      fromName: data.fromName,
      fromEmail: data.fromEmail,
      enabled: true,
    }

    switch (data.provider) {
      case 'resend': {
        const apiKey = requireSecret(data.apiKey, 'Resend API key')
        if (existing) await messaging.updateResendProvider({ ...common, apiKey })
        else await messaging.createResendProvider({ ...common, apiKey })
        break
      }
      case 'sendgrid': {
        const apiKey = requireSecret(data.apiKey, 'SendGrid API key')
        if (existing) await messaging.updateSendgridProvider({ ...common, apiKey })
        else await messaging.createSendgridProvider({ ...common, apiKey })
        break
      }
      case 'mailgun': {
        const apiKey = requireSecret(data.apiKey, 'Mailgun API key')
        const fields = { ...common, apiKey, domain: data.domain, isEuRegion: data.isEuRegion }
        if (existing) await messaging.updateMailgunProvider(fields)
        else await messaging.createMailgunProvider(fields)
        break
      }
      case 'ses': {
        const accessKey = requireSecret(data.accessKey, 'AWS access key')
        const secretKey = requireSecret(data.secretKey, 'AWS secret key')
        const fields = { ...common, accessKey, secretKey, region: data.region }
        if (existing) await messaging.updateSesProvider(fields)
        else await messaging.createSesProvider(fields)
        break
      }
      case 'smtp': {
        const fields = {
          ...common,
          host: data.host,
          port: data.port,
          username: data.username,
          password: data.password || undefined,
          encryption: data.encryption as SmtpEncryption,
          autoTLS: data.encryption !== 'none',
        }
        if (existing) await messaging.updateSmtpProvider(fields)
        else await messaging.createSmtpProvider({ ...fields, password: data.password ?? '' })
        break
      }
    }

    const saved = toProvider(await messaging.getProvider({ providerId: MANAGED_PROVIDER_ID }))
    if (!saved.enabled) throw new Error('The provider was saved but is incomplete, so Appwrite left it disabled. Check every field.')
    return saved
  })

export const removeEmailProvider = createServerFn({ method: 'POST' }).handler(async () => {
  await requireAdmin()
  await admin().messaging.deleteProvider({ providerId: MANAGED_PROVIDER_ID })
  return { ok: true }
})

export const sendTestEmail = createServerFn({ method: 'POST' }).handler(async () => {
  const { viewer } = await requireAdmin()
  const workspace = await getWorkspace()
  const message = await admin().messaging.createEmail({
    messageId: ID.unique(),
    subject: `Mailroom test email`,
    content: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;font-size:14px;line-height:1.6;color:#19191c"><p style="margin:0 0 14px">This is a test from <strong>${workspace.name}</strong>. Replies to customers are sent the same way.</p><p style="margin:0;color:#6b6b70">Reply-to is set to ${workspace.mailbox}, so answering this email should open a conversation in Mailroom.</p></div>`,
    html: true,
    emails: [viewer.email],
    replyToEmail: workspace.mailbox,
    replyToName: workspace.replyToName || workspace.name,
  })
  return { messageId: message.$id, status: message.status }
})

export const getTestEmailStatus = createServerFn({ method: 'GET' })
  .validator(z.object({ messageId: z.string().min(1).max(36) }))
  .handler(async ({ data }) => {
    await requireAdmin()
    const message = await admin().messaging.getMessage({ messageId: data.messageId })
    return { status: message.status, errors: message.deliveryErrors ?? [] }
  })
