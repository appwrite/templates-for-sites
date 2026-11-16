import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { explainError, FUNCTION_VERSION, inspectProject, missingScopes, runStep } from '#/server/provision.server'
import { INBOUND_FUNCTION, SETUP_SCOPES, SITE_SCOPES, TABLE_SPECS } from '#/server/schema.server'
import { startFakeAppwrite, type FakeAppwrite } from './fake-appwrite'
import { newRequest, request } from './request'

const ALL_SCOPES = SITE_SCOPES.flatMap((group) => group.scopes)
const KEPT_SCOPES = ALL_SCOPES.filter((scope) => !SETUP_SCOPES.includes(scope))

// The site as Appwrite returns it. sites.update replaces every setting, so the
// release step has to send all of these back.
const SITE = {
  $id: 'mailroom',
  name: 'Mailroom',
  framework: 'tanstack-start',
  enabled: true,
  logging: true,
  timeout: 30,
  installCommand: 'npm install',
  buildCommand: 'npm run build',
  startCommand: 'node .output/server/index.mjs',
  outputDirectory: './.output',
  buildRuntime: 'node-22',
  adapter: 'ssr',
  fallbackFile: '',
  installationId: 'installation-1',
  providerRepositoryId: 'repository-1',
  providerBranch: 'main',
  providerSilentMode: false,
  providerRootDirectory: 'tanstack-start/support-inbox',
  buildSpecification: 's-1vcpu-512mb',
  runtimeSpecification: 's-1vcpu-1gb',
  deploymentRetention: 7,
  description: '',
  scopes: ALL_SCOPES,
}

const FUNCTION_FILES = ['package.json', 'package-lock.json', 'src/main.js', 'src/email.js']

let fake: FakeAppwrite
beforeAll(async () => {
  fake = await startFakeAppwrite()
})
afterAll(() => fake.close())
beforeEach(() => {
  fake.reset()
  fake.state.sites.set(SITE.$id, structuredClone(SITE))
  newRequest(ALL_SCOPES)
})

// A later request to the site, whose key carries the site's scopes as they are now.
function nextRequest() {
  newRequest(fake.state.sites.get(SITE.$id)?.scopes as string[])
}

const states = async () => Object.fromEntries((await inspectProject()).map((step) => [step.id, step.state]))

// Reads the archive the deployment uploaded, checking each header's checksum.
function untar(archive: Buffer) {
  const tar = gunzipSync(archive)
  const files: Record<string, string> = {}
  for (let offset = 0; tar.subarray(offset, offset + 512).some((byte) => byte !== 0); ) {
    const header = tar.subarray(offset, offset + 512)
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/s, '')
    const size = Number.parseInt(header.toString('utf8', 124, 136), 8)
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0)
    expect(Number.parseInt(header.toString('utf8', 148, 156), 8), `checksum of ${name}`).toBe(checksum)
    expect(header.toString('utf8', 257, 262)).toBe('ustar')
    files[name] = tar.toString('utf8', offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files
}

function seedDeployedFunction(variable: { value: string; secret: boolean } | null, latest: { status: string; active?: boolean }) {
  fake.state.functions.set(INBOUND_FUNCTION.id, {
    $id: INBOUND_FUNCTION.id,
    name: INBOUND_FUNCTION.name,
    runtime: 'node-22',
    execute: [],
    events: [],
    schedule: '',
    timeout: INBOUND_FUNCTION.timeout,
    enabled: true,
    logging: true,
    entrypoint: INBOUND_FUNCTION.entrypoint,
    commands: INBOUND_FUNCTION.commands,
    scopes: INBOUND_FUNCTION.scopes,
    providerRepositoryId: '',
    deploymentRetention: 0,
    description: '',
    emailEnabled: true,
    deploymentId: latest.active === false ? 'previous' : 'latest',
  })
  fake.state.deployments.set(INBOUND_FUNCTION.id, [{ $id: 'latest', status: latest.status, activate: true }])
  if (variable) fake.state.variables.set(INBOUND_FUNCTION.id, [{ $id: 'version', key: 'MAILROOM_CODE_VERSION', ...variable }])
}

describe('setup on a new Appwrite Cloud project', () => {
  it('creates every resource, deploys the function once and gives back the setup scopes', async () => {
    expect(Object.values(await states()).every((state) => state === 'missing')).toBe(true)

    for (const step of ['database', ...TABLE_SPECS.map((spec) => `table:${spec.id}`), 'bucket', 'team', 'function']) {
      expect(await runStep(step), step).toEqual({ retry: false })
    }

    // Each table, with its columns and indexes, in one request that only needs tables.write.
    expect(fake.callsTo('POST', '/tablesdb/mailroom/tables')).toHaveLength(TABLE_SPECS.length)
    expect(fake.callsTo('POST', /\/(columns|indexes)/)).toHaveLength(0)
    const conversations = fake.state.tables.get('conversations')
    expect(conversations?.columns.find((column) => column.key === 'spamScore')?.type).toBe('double')
    expect(conversations?.indexes.find((index) => index.key === 'status_last')?.orders).toEqual(['ASC', 'DESC'])
    expect(fake.state.functions.get(INBOUND_FUNCTION.id)).toMatchObject({ runtime: 'node-22', scopes: INBOUND_FUNCTION.scopes, timeout: 60 })

    // The deployment starts once. Polls only watch it.
    expect(await runStep('deployment')).toEqual({ retry: true })
    expect(await runStep('deployment', true)).toEqual({ retry: true })
    fake.finishBuild(INBOUND_FUNCTION.id)
    expect(await runStep('deployment', true)).toEqual({ retry: false })
    expect(fake.callsTo('POST', '/functions/inbound/deployments')).toHaveLength(1)
    expect(fake.state.variables.get(INBOUND_FUNCTION.id)).toEqual([
      expect.objectContaining({ key: 'MAILROOM_CODE_VERSION', value: FUNCTION_VERSION, secret: false }),
    ])

    expect(await runStep('trigger')).toEqual({ retry: false })
    expect(fake.state.functions.get(INBOUND_FUNCTION.id)).toMatchObject({
      emailEnabled: true,
      deploymentId: fake.state.deployments.get(INBOUND_FUNCTION.id)?.[0].$id,
      providerRepositoryId: '',
    })

    // The release step removes the setup scopes and sends every other setting back.
    expect(await runStep('release')).toEqual({ retry: true })
    expect(fake.state.sites.get(SITE.$id)).toEqual({ ...SITE, scopes: KEPT_SCOPES })
    // Until a request starts with the new key, the poll keeps waiting without updating again.
    expect(await runStep('release', true)).toEqual({ retry: true })
    expect(fake.callsTo('PUT', '/sites/mailroom')).toHaveLength(1)
    nextRequest()
    expect(await runStep('release', true)).toEqual({ retry: false })

    expect(await states()).toEqual(Object.fromEntries((await inspectProject()).map((step) => [step.id, 'ready'])))
  })

  it('deploys the function code bundled with the site', async () => {
    await runStep('function')
    await runStep('deployment')

    const [deployment] = fake.state.deployments.get(INBOUND_FUNCTION.id) ?? []
    expect(deployment).toMatchObject({ activate: true, entrypoint: 'src/main.js', commands: 'npm install --omit=dev' })
    const files = untar(fake.state.uploads.get(deployment.$id) as Buffer)
    expect(Object.keys(files).sort()).toEqual([...FUNCTION_FILES].sort())
    for (const name of FUNCTION_FILES) {
      expect(files[name], name).toBe(readFileSync(new URL(`../inbound-function/${name}`, import.meta.url), 'utf8'))
    }
  })

  it('picks the newest Node.js runtime when Node 22 is not available', async () => {
    fake.state.runtimes = ['node-18.0', 'node-20.0', 'node-21.0', 'python-3.12']
    await runStep('function')
    expect(fake.state.functions.get(INBOUND_FUNCTION.id)?.runtime).toBe('node-21.0')

    fake.reset()
    fake.state.runtimes = ['node-16.0', 'python-3.12']
    await expect(runStep('function')).rejects.toThrow('no Node.js 18+ runtime')
  })
})

describe('function deployment', () => {
  it('replaces a secret version variable instead of redeploying on every check', async () => {
    // Appwrite made variables secret by default, so the version read back empty.
    seedDeployedFunction({ value: FUNCTION_VERSION, secret: true }, { status: 'ready' })
    expect((await states()).deployment).toBe('outdated')

    expect(await runStep('deployment')).toEqual({ retry: true })
    fake.finishBuild(INBOUND_FUNCTION.id)
    expect(await runStep('deployment', true)).toEqual({ retry: false })

    expect(fake.state.variables.get(INBOUND_FUNCTION.id)).toEqual([
      expect.objectContaining({ key: 'MAILROOM_CODE_VERSION', value: FUNCTION_VERSION, secret: false }),
    ])
    expect((await states()).deployment).toBe('ready')
    expect(await runStep('deployment')).toEqual({ retry: false })
    expect(fake.callsTo('POST', '/functions/inbound/deployments')).toHaveLength(1)
  })

  it('leaves an up-to-date deployment alone', async () => {
    seedDeployedFunction({ value: FUNCTION_VERSION, secret: false }, { status: 'ready' })
    expect(await runStep('deployment')).toEqual({ retry: false })
    expect(fake.callsTo('POST', /deployments$/)).toHaveLength(0)
  })

  it('redeploys when the bundled code changed', async () => {
    seedDeployedFunction({ value: 'old-version', secret: false }, { status: 'ready' })
    expect((await states()).deployment).toBe('outdated')
    expect(await runStep('deployment')).toEqual({ retry: true })
    expect(fake.state.variables.get(INBOUND_FUNCTION.id)?.[0]).toMatchObject({ $id: 'version', value: FUNCTION_VERSION, secret: false })
  })

  it('never starts a build from a poll, and reports a failed one', async () => {
    seedDeployedFunction({ value: FUNCTION_VERSION, secret: false }, { status: 'failed' })
    await expect(runStep('deployment', true)).rejects.toThrow('The function build failed')
    expect(fake.callsTo('POST', /deployments$/)).toHaveLength(0)

    // Running the step again retries the build.
    expect(await runStep('deployment')).toEqual({ retry: true })
    expect(fake.callsTo('POST', /deployments$/)).toHaveLength(1)
  })

  it('waits while a build is running', async () => {
    seedDeployedFunction({ value: 'old-version', secret: false }, { status: 'building' })
    expect((await states()).deployment).toBe('working')
    expect(await runStep('deployment')).toEqual({ retry: true })
    expect(fake.callsTo('POST', /deployments$/)).toHaveLength(0)
  })

  it('activates a finished build that is not live yet', async () => {
    seedDeployedFunction({ value: FUNCTION_VERSION, secret: false }, { status: 'ready', active: false })
    expect(await runStep('deployment', true)).toEqual({ retry: false })
    expect(fake.callsTo('PATCH', '/functions/inbound/deployment')[0]?.body).toEqual({ deploymentId: 'latest' })
    expect(fake.state.functions.get(INBOUND_FUNCTION.id)?.deploymentId).toBe('latest')
  })

  it('turns on the email trigger only once the code is deployed', async () => {
    await runStep('function')
    await expect(runStep('trigger')).rejects.toThrow('Deploy the function code first.')
  })
})

describe('updating an existing project', () => {
  beforeEach(async () => {
    await runStep('database')
  })

  it('creates the columns one by one on servers without inline columns', async () => {
    fake.state.inlineTables = false
    const spec = TABLE_SPECS[0]
    expect(await runStep(`table:${spec.id}`)).toEqual({ retry: false })

    const table = fake.state.tables.get(spec.id)
    expect(table?.columns.map((column) => column.key)).toEqual(spec.columns.map((column) => column.key))
    expect(table?.indexes.map((index) => index.key)).toEqual(spec.indexes.map((index) => index.key))
    // createIndex takes lowercase orders, unlike inline indexes.
    expect(table?.indexes.find((index) => index.key === 'status_last')?.orders).toEqual(['asc', 'desc'])
  })

  it('adds the columns a newer version needs', async () => {
    await runStep('table:messages')
    const messages = fake.state.tables.get('messages')
    messages?.columns.splice(messages.columns.findIndex((column) => column.key === 'metadata'), 1)

    const step = (await inspectProject()).find((item) => item.id === 'table:messages')
    expect(step).toMatchObject({ state: 'outdated', detail: '1 column to add' })
    expect(await runStep('table:messages')).toEqual({ retry: false })
    expect(fake.callsTo('POST', /\/columns\//).map((call) => call.path)).toEqual(['/tablesdb/mailroom/tables/messages/columns/mediumtext'])
  })

  it('updates a function that still deploys from Git, keeping the email trigger on', async () => {
    seedDeployedFunction({ value: FUNCTION_VERSION, secret: false }, { status: 'ready' })
    Object.assign(fake.state.functions.get(INBOUND_FUNCTION.id) ?? {}, { providerRepositoryId: 'repository-1', installationId: 'installation-1', timeout: 15 })
    expect((await inspectProject()).find((item) => item.id === 'function')).toMatchObject({ state: 'outdated', detail: 'Timeout is below 60 seconds' })

    await runStep('function')
    expect(fake.state.functions.get(INBOUND_FUNCTION.id)).toMatchObject({ providerRepositoryId: '', installationId: '', timeout: 60, emailEnabled: true })
    expect((await states()).function).toBe('ready')
  })
})

describe('site scopes', () => {
  it('sorts missing scopes into required, setup-only and optional', () => {
    newRequest(ALL_SCOPES.filter((scope) => !['users.read', 'tables.write', 'columns.read'].includes(scope)))
    expect(missingScopes()).toEqual({ required: ['users.read'], setup: ['tables.write'], optional: ['columns.read'] })
  })

  it('cannot read the scopes of a regular API key', async () => {
    request.headers['x-appwrite-key'] = 'standard_0123456789abcdef'
    expect(missingScopes()).toBeNull()
    expect((await inspectProject()).at(-1)?.state).toBe('skipped')
  })

  it('names the missing scope in errors', () => {
    expect(explainError(new Error('app.123 (role: applications) missing scopes (["tables.write"])'))).toContain('tables.write')
    expect(explainError(new Error('Something else'))).toBe('Something else')
  })

  it('has nothing to release once the setup scopes are gone', async () => {
    newRequest(KEPT_SCOPES)
    expect(await runStep('release')).toEqual({ retry: false })
    expect(fake.callsTo('PUT', '/sites/mailroom')).toHaveLength(0)
    expect((await inspectProject()).at(-1)?.state).toBe('ready')
  })
})

describe('on self-hosted Appwrite', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('skips the email function and creates everything else', async () => {
    vi.stubEnv('APPWRITE_SITE_API_ENDPOINT', 'https://appwrite.example.com/v1')
    vi.resetModules()
    const selfHosted = await import('#/server/provision.server')

    const steps = await selfHosted.inspectProject()
    expect(steps.filter((step) => step.state === 'skipped').map((step) => step.id)).toEqual(['function', 'deployment', 'trigger'])
    for (const step of ['function', 'deployment', 'trigger']) expect(await selfHosted.runStep(step)).toEqual({ retry: false })
    expect(fake.calls.some((call) => call.path.startsWith('/functions'))).toBe(false)

    expect(await selfHosted.runStep('database')).toEqual({ retry: false })
    expect(fake.state.databases.has('mailroom')).toBe(true)
  })
})
