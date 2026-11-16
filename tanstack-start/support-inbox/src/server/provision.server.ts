import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { AppwriteException, ID, Query, Sites, type Models } from 'node-appwrite'
import { InputFile } from 'node-appwrite/file'
import functionEmailJs from '../../inbound-function/src/email.js?raw'
import functionMainJs from '../../inbound-function/src/main.js?raw'
import functionPackageJson from '../../inbound-function/package.json?raw'
import functionPackageLock from '../../inbound-function/package-lock.json?raw'
import { admin, adminClient, grantedScopes, inboundFunction, isCloud, updateInboundFunction } from './appwrite.server'
import {
  BUCKET,
  DATABASE,
  INBOUND_FUNCTION,
  SETUP_SCOPES,
  SITE_SCOPES,
  TABLE_PERMISSIONS,
  TABLE_SPECS,
  TEAM,
  type ColumnSpec,
  type IndexSpec,
  type TableSpec,
} from './schema.server'

export type StepState = 'ready' | 'missing' | 'outdated' | 'working' | 'failed' | 'skipped'

export interface StepStatus {
  id: string
  label: string
  detail: string
  state: StepState
}

// The inbound function ships inside the site, so a template deploy needs
// nothing but this repository. Its version is a hash of the bundled files.
const FUNCTION_FILES: Record<string, string> = {
  'package.json': functionPackageJson,
  'package-lock.json': functionPackageLock,
  'src/main.js': functionMainJs,
  'src/email.js': functionEmailJs,
}
export const FUNCTION_VERSION = createHash('sha256').update(JSON.stringify(FUNCTION_FILES)).digest('hex').slice(0, 12)
const VERSION_VARIABLE = 'MAILROOM_CODE_VERSION'

// A minimal ustar archive, which is all createDeployment needs.
function tarGz(files: Record<string, string>) {
  const chunks: Buffer[] = []
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8')
    const header = Buffer.alloc(512)
    header.write(name, 0, 100, 'utf8')
    header.write('0000644\0', 100)
    header.write('0000000\0', 108)
    header.write('0000000\0', 116)
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124)
    header.write('00000000000\0', 136)
    header.write('        ', 148)
    header.write('0', 156)
    header.write('ustar\0', 257)
    header.write('00', 263)
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148)
    chunks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  chunks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(chunks))
}

// Null when the key's scopes can't be read. `required` are needed while the
// site runs, `setup` only to create or upgrade resources, and `optional` only
// to add columns to existing tables.
export function missingScopes() {
  const granted = grantedScopes()
  if (!granted) return null
  const missing = (optional: boolean) =>
    SITE_SCOPES.filter((group) => Boolean(group.optional) === optional)
      .flatMap((group) => group.scopes)
      .filter((scope) => !granted.includes(scope))
  const required = missing(false)
  return {
    required: required.filter((scope) => !SETUP_SCOPES.includes(scope)),
    setup: required.filter((scope) => SETUP_SCOPES.includes(scope)),
    optional: missing(true),
  }
}

async function orNull<T>(promise: Promise<T>) {
  try {
    return await promise
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 404) return null
    throw error
  }
}

// Turns "missing scope (tables.write)" into advice that names the scope.
export function explainError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const scope = /missing scopes? \(([^)]+)\)/i.exec(message)?.[1]
  if (scope) return `The site's key is missing the ${scope} scope. Add it under the site's Settings → Scopes, then try again.`
  return message
}

type TableModel = Models.Table & {
  columns: { key: string; status: string }[]
  indexes: { key: string; status: string }[]
}

function tableStatus(spec: TableSpec, table: TableModel | null): StepStatus {
  const base = { id: `table:${spec.id}`, label: `${spec.name} table` }
  if (!table) return { ...base, state: 'missing', detail: `${spec.columns.length} columns, ${spec.indexes.length} indexes` }

  const failed = [...table.columns, ...table.indexes].find((item) => item.status === 'failed' || item.status === 'stuck')
  if (failed) return { ...base, state: 'failed', detail: `Appwrite couldn't create ${failed.key}. Delete it in the Console and run this again.` }
  if ([...table.columns, ...table.indexes].some((item) => item.status !== 'available')) {
    return { ...base, state: 'working', detail: 'Appwrite is building columns and indexes' }
  }

  const columns = spec.columns.filter((column) => !table.columns.some((item) => item.key === column.key)).length
  const indexes = spec.indexes.filter((index) => !table.indexes.some((item) => item.key === index.key)).length
  if (columns || indexes) {
    const parts = [columns ? `${columns} column${columns === 1 ? '' : 's'}` : '', indexes ? `${indexes} index${indexes === 1 ? '' : 'es'}` : '']
    return { ...base, state: 'outdated', detail: `${parts.filter(Boolean).join(' and ')} to add` }
  }
  return { ...base, state: 'ready', detail: `${spec.columns.length} columns` }
}

async function functionState() {
  const { functions } = admin()
  const fn = await inboundFunction()
  if (!fn) return { fn: null, version: null, latest: null }
  const [variables, deployments] = await Promise.all([
    functions.listVariables({ functionId: fn.$id }),
    functions.listDeployments({ functionId: fn.$id, queries: [Query.orderDesc('$createdAt'), Query.limit(1)] }),
  ])
  return {
    fn,
    version: variables.variables.find((variable) => variable.key === VERSION_VARIABLE) ?? null,
    latest: deployments.deployments[0] ?? null,
  }
}

function configDrift(fn: Models.Function) {
  const scopes = INBOUND_FUNCTION.scopes.filter((scope) => !fn.scopes.includes(scope))
  if (scopes.length) return `Missing the ${scopes.join(', ')} scope${scopes.length === 1 ? '' : 's'}`
  if (fn.entrypoint !== INBOUND_FUNCTION.entrypoint || fn.commands !== INBOUND_FUNCTION.commands) return 'Build settings changed'
  if (fn.timeout < INBOUND_FUNCTION.timeout) return `Timeout is below ${INBOUND_FUNCTION.timeout} seconds`
  if (fn.providerRepositoryId) return 'Still deploys from Git instead of this site'
  if (!fn.enabled) return 'The function is disabled'
  return null
}

export async function inspectProject(): Promise<StepStatus[]> {
  const steps = await inspectResources()
  return [...steps, releaseStatus()]
}

async function inspectResources(): Promise<StepStatus[]> {
  const { db, storage, teams } = admin()
  const [database, tables, bucket, team, fnState] = await Promise.all([
    orNull(db.get({ databaseId: DATABASE.id })),
    Promise.all(TABLE_SPECS.map((spec) => orNull(db.getTable({ databaseId: DATABASE.id, tableId: spec.id }) as Promise<TableModel>))),
    orNull(storage.getBucket({ bucketId: BUCKET.id })),
    orNull(teams.get({ teamId: TEAM.id })),
    isCloud() ? functionState() : null,
  ])

  const steps: StepStatus[] = [
    database
      ? { id: 'database', label: 'Database', detail: DATABASE.id, state: 'ready' }
      : { id: 'database', label: 'Database', detail: DATABASE.id, state: 'missing' },
    ...TABLE_SPECS.map((spec, index) =>
      database ? tableStatus(spec, tables[index]) : tableStatus(spec, null),
    ),
    { id: 'bucket', label: 'Attachments bucket', detail: BUCKET.id, state: bucket ? 'ready' : 'missing' },
    { id: 'team', label: 'Agents team', detail: TEAM.id, state: team ? 'ready' : 'missing' },
  ]

  if (!fnState) {
    const detail = 'Email triggers are only on Appwrite Cloud. Create tickets with POST /api/tickets instead.'
    steps.push(
      { id: 'function', label: 'Inbound function', detail, state: 'skipped' },
      { id: 'deployment', label: 'Function code', detail, state: 'skipped' },
      { id: 'trigger', label: 'Email trigger', detail, state: 'skipped' },
    )
    return steps
  }

  const { fn, version, latest } = fnState
  const drift = fn ? configDrift(fn) : null
  steps.push({
    id: 'function',
    label: 'Inbound function',
    detail: fn ? drift ?? `${fn.$id} on ${fn.runtime}` : `${INBOUND_FUNCTION.id}, runs for every email`,
    state: !fn ? 'missing' : drift ? 'outdated' : 'ready',
  })

  let deployment: StepStatus = { id: 'deployment', label: 'Function code', detail: `Version ${FUNCTION_VERSION}`, state: 'ready' }
  if (!fn) deployment = { ...deployment, state: 'missing' }
  else if (latest && ['waiting', 'processing', 'building'].includes(latest.status)) {
    deployment = { ...deployment, state: 'working', detail: `Building version ${version?.value ?? FUNCTION_VERSION}` }
  } else if (latest?.status === 'failed' && latest.$id !== fn.deploymentId) {
    deployment = { ...deployment, state: 'failed', detail: 'The last build failed. Check its logs under the function in the Console, then retry.' }
  } else if (!fn.deploymentId) deployment = { ...deployment, state: 'missing' }
  else if (version?.value !== FUNCTION_VERSION) {
    deployment = { ...deployment, state: 'outdated', detail: `Version ${FUNCTION_VERSION} is available` }
  }
  steps.push(deployment)

  const emailEnabled = Boolean((fn as unknown as { emailEnabled?: boolean } | null)?.emailEnabled)
  steps.push({
    id: 'trigger',
    label: 'Email trigger',
    detail: emailEnabled ? 'Receiving email' : 'Turns on once the code is deployed',
    state: emailEnabled ? 'ready' : 'missing',
  })
  return steps
}

// The last step: the site removes the scopes it only needed for setup from itself.
function releaseStatus(): StepStatus {
  const base = { id: 'release', label: 'Give back setup scopes' }
  const granted = grantedScopes()
  if (!granted || !process.env.APPWRITE_SITE_ID) {
    return { ...base, state: 'skipped', detail: 'Only on Appwrite Sites, where the site can read its own key.' }
  }
  const held = SETUP_SCOPES.filter((scope) => granted.includes(scope))
  if (!held.length) return { ...base, state: 'ready', detail: 'The site keeps only the scopes it uses every day.' }
  return { ...base, state: 'missing', detail: `Removes ${held.length} scopes only setup needs: ${held.join(', ')}` }
}

function inlineColumn(column: ColumnSpec) {
  return {
    key: column.key,
    type: column.type,
    required: column.required ?? false,
    ...(column.size ? { size: column.size } : {}),
    ...(column.array ? { array: true } : {}),
    ...(column.elements ? { elements: column.elements } : {}),
    ...(column.min !== undefined ? { min: column.min } : {}),
    ...(!column.required && column.default !== undefined ? { default: column.default } : {}),
  }
}

// Inline indexes take uppercase orders, unlike createIndex.
function inlineIndex(index: IndexSpec) {
  return {
    key: index.key,
    type: index.type,
    attributes: index.columns,
    ...(index.orders ? { orders: index.orders.map((order) => order.toUpperCase()) } : {}),
  }
}

async function createColumn(tableId: string, column: ColumnSpec) {
  const { db } = admin()
  const base = { databaseId: DATABASE.id, tableId, key: column.key, required: column.required ?? false, array: column.array }
  const xdefault = column.required ? undefined : column.default
  switch (column.type) {
    case 'varchar':
      return db.createVarcharColumn({ ...base, size: column.size ?? 255, xdefault: xdefault as string | undefined })
    case 'text':
      return db.createTextColumn({ ...base, xdefault: xdefault as string | undefined })
    case 'mediumtext':
      return db.createMediumtextColumn({ ...base, xdefault: xdefault as string | undefined })
    case 'enum':
      return db.createEnumColumn({ ...base, elements: column.elements ?? [], xdefault: xdefault as string | undefined })
    case 'integer':
      return db.createIntegerColumn({ ...base, min: column.min, xdefault: xdefault as number | undefined })
    case 'double':
      return db.createFloatColumn({ ...base, min: column.min, xdefault: xdefault as number | undefined })
    case 'boolean':
      return db.createBooleanColumn({ ...base, xdefault: xdefault as boolean | undefined })
    case 'datetime':
      return db.createDatetimeColumn({ ...base, xdefault: xdefault as string | undefined })
  }
}

// Each step is idempotent and short, so the browser runs them one by one and
// can retry any of them. `retry` means "call again shortly to continue", and
// `polling` marks those follow-up calls.
export async function runStep(id: string, polling = false): Promise<{ retry: boolean }> {
  const { db, storage, teams, functions } = admin()

  if (id === 'database') {
    if (!(await orNull(db.get({ databaseId: DATABASE.id })))) await db.create({ databaseId: DATABASE.id, name: DATABASE.name })
    return { retry: false }
  }

  if (id.startsWith('table:')) {
    const spec = TABLE_SPECS.find((table) => `table:${table.id}` === id)
    if (!spec) throw new Error(`Unknown table ${id}`)
    let table = (await orNull(db.getTable({ databaseId: DATABASE.id, tableId: spec.id }))) as TableModel | null
    if (!table) {
      const base = { databaseId: DATABASE.id, tableId: spec.id, name: spec.name, permissions: TABLE_PERMISSIONS, rowSecurity: false, enabled: true }
      try {
        // One request creates the table with its columns and indexes, and only needs tables.write.
        table = (await db.createTable({ ...base, columns: spec.columns.map(inlineColumn), indexes: spec.indexes.map(inlineIndex) })) as TableModel
        return { retry: [...(table.columns ?? []), ...(table.indexes ?? [])].some((item) => item.status !== 'available') }
      } catch (error) {
        // Older servers without inline columns: create the table, then each column below.
        if (!(error instanceof AppwriteException) || error.code !== 400) throw error
        table = (await orNull(db.getTable({ databaseId: DATABASE.id, tableId: spec.id }))) as TableModel | null
        table ??= (await db.createTable(base)) as TableModel
        table.columns ??= []
        table.indexes ??= []
      }
    }
    // Upgrades add missing columns one at a time, which needs columns.write and indexes.write.
    for (const column of spec.columns) {
      if (!table.columns.some((item) => item.key === column.key)) await createColumn(spec.id, column)
    }
    const fresh = (await db.getTable({ databaseId: DATABASE.id, tableId: spec.id })) as TableModel
    const pending = spec.indexes.filter((index) => !fresh.indexes.some((item) => item.key === index.key))
    if (!pending.length) return { retry: fresh.columns.some((column) => column.status === 'processing') }
    // Indexes can only use columns Appwrite has finished creating.
    const available = new Set(fresh.columns.filter((column) => column.status === 'available').map((column) => column.key))
    let waiting = false
    for (const index of pending) {
      if (!index.columns.every((column) => available.has(column))) {
        waiting = true
        continue
      }
      await db.createIndex({
        databaseId: DATABASE.id,
        tableId: spec.id,
        key: index.key,
        type: index.type as never,
        columns: index.columns,
        orders: index.orders as never,
      })
    }
    return { retry: waiting }
  }

  if (id === 'bucket') {
    if (!(await orNull(storage.getBucket({ bucketId: BUCKET.id })))) {
      await storage.createBucket({
        bucketId: BUCKET.id,
        name: BUCKET.name,
        permissions: BUCKET.permissions,
        fileSecurity: false,
        enabled: true,
        maximumFileSize: BUCKET.maximumFileSize,
        compression: 'none' as never,
        encryption: true,
        antivirus: true,
      })
    }
    return { retry: false }
  }

  if (id === 'team') {
    // Created with the server key, so the team starts empty and setup can claim it.
    if (!(await orNull(teams.get({ teamId: TEAM.id })))) await teams.create({ teamId: TEAM.id, name: TEAM.name })
    return { retry: false }
  }

  if (id === 'release') {
    const siteId = process.env.APPWRITE_SITE_ID
    if (!siteId) return { retry: false }
    const sites = new Sites(adminClient())
    const site = await sites.get({ siteId })
    const kept = site.scopes.filter((scope) => !SETUP_SCOPES.includes(scope))
    // sites.update replaces every setting, so everything else goes back as it was.
    if (kept.length !== site.scopes.length) await sites.update({ ...siteUpdate(site), scopes: kept as never })
    return { retry: false }
  }

  if (!isCloud()) return { retry: false }

  if (id === 'function') {
    const fn = await inboundFunction()
    if (!fn) {
      await functions.create({
        functionId: INBOUND_FUNCTION.id,
        name: INBOUND_FUNCTION.name,
        runtime: (await pickRuntime()) as never,
        execute: [],
        timeout: INBOUND_FUNCTION.timeout,
        enabled: true,
        logging: true,
        entrypoint: INBOUND_FUNCTION.entrypoint,
        commands: INBOUND_FUNCTION.commands,
        scopes: INBOUND_FUNCTION.scopes as never,
      })
    } else if (configDrift(fn)) {
      await updateInboundFunction(fn, {
        enabled: true,
        entrypoint: INBOUND_FUNCTION.entrypoint,
        commands: INBOUND_FUNCTION.commands,
        timeout: Math.max(fn.timeout, INBOUND_FUNCTION.timeout),
        scopes: [...new Set([...fn.scopes, ...INBOUND_FUNCTION.scopes])],
      })
    }
    return { retry: false }
  }

  if (id === 'deployment') {
    const { fn, version, latest } = await functionState()
    if (!fn) throw new Error('Create the inbound function first.')
    if (latest && ['waiting', 'processing', 'building'].includes(latest.status)) return { retry: true }
    if (polling && latest?.status === 'failed') {
      throw new Error('The function build failed. Open the function’s deployments in the Appwrite Console for the build logs.')
    }
    if (fn.deploymentId && version?.value === FUNCTION_VERSION && latest?.status !== 'failed') return { retry: false }

    if (version) {
      await functions.updateVariable({ functionId: fn.$id, variableId: version.$id, key: VERSION_VARIABLE, value: FUNCTION_VERSION })
    } else {
      await functions.createVariable({ functionId: fn.$id, variableId: ID.unique(), key: VERSION_VARIABLE, value: FUNCTION_VERSION })
    }
    await functions.createDeployment({
      functionId: fn.$id,
      code: InputFile.fromBuffer(tarGz(FUNCTION_FILES), 'inbound.tar.gz'),
      activate: true,
      entrypoint: INBOUND_FUNCTION.entrypoint,
      commands: INBOUND_FUNCTION.commands,
    })
    return { retry: true }
  }

  if (id === 'trigger') {
    const fn = await inboundFunction()
    if (!fn?.deploymentId) throw new Error('Deploy the function code first.')
    if (!(fn as unknown as { emailEnabled?: boolean }).emailEnabled) await updateInboundFunction(fn, { emailEnabled: true })
    return { retry: false }
  }

  throw new Error(`Unknown setup step ${id}`)
}

function siteUpdate(site: Models.Site) {
  return {
    siteId: site.$id,
    name: site.name,
    framework: site.framework as never,
    enabled: site.enabled,
    logging: site.logging,
    timeout: site.timeout,
    installCommand: site.installCommand,
    buildCommand: site.buildCommand,
    startCommand: site.startCommand,
    outputDirectory: site.outputDirectory,
    buildRuntime: site.buildRuntime as never,
    adapter: site.adapter as never,
    fallbackFile: site.fallbackFile,
    installationId: site.installationId,
    providerRepositoryId: site.providerRepositoryId,
    providerBranch: site.providerBranch,
    providerSilentMode: site.providerSilentMode,
    providerRootDirectory: site.providerRootDirectory,
    buildSpecification: site.buildSpecification,
    runtimeSpecification: site.runtimeSpecification,
    deploymentRetention: site.deploymentRetention,
    description: site.description,
    ...(site.providerBranches?.length ? { providerBranches: site.providerBranches } : {}),
    ...(site.providerPaths?.length ? { providerPaths: site.providerPaths } : {}),
  }
}

// Node 22 when the instance offers it, otherwise the newest Node runtime from 18 up.
async function pickRuntime() {
  const { runtimes } = await admin().functions.listRuntimes()
  const node = runtimes
    .map((runtime) => ({ id: runtime.$id, major: Number(/^node-(\d+)/.exec(runtime.$id)?.[1] ?? 0) }))
    .filter((runtime) => runtime.major >= 18)
    .sort((a, b) => (a.major === 22 ? -1 : b.major === 22 ? 1 : b.major - a.major))
  if (!node[0]) throw new Error('This Appwrite instance has no Node.js 18+ runtime enabled for functions.')
  return node[0].id
}
