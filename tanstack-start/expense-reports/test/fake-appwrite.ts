import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Agent, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from 'undici'

// A small in-memory Appwrite API: enough for setup, sign-in and filing tickets.
// Every request the tests make, through node-appwrite or fetch, goes to this
// local server instead of the network, so the real server code runs unchanged.
// It follows Appwrite where the code depends on it: 404s and 409s, secret
// variables reading back empty, and builds that finish only when a test says so.

export interface Call {
  method: string
  path: string
  query: URLSearchParams
  headers: Record<string, string>
  body: Record<string, unknown>
}

export class ApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly type = 'general_error',
  ) {
    super(message)
  }
}

// A response with its own status and headers, such as a session cookie.
export class Reply {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly headers: Record<string, string | string[]> = {},
  ) {}
}

export type Doc = Record<string, unknown> & { $id: string }
type Handler = (call: Call, params: Record<string, string>) => unknown

function freshState() {
  return {
    databases: new Map<string, Doc>(),
    tables: new Map<string, Doc & { columns: Doc[]; indexes: Doc[] }>(),
    rows: new Map<string, Map<string, Doc>>(),
    buckets: new Map<string, Doc>(),
    files: new Map<string, Doc & { data: Buffer }>(),
    teams: new Map<string, Doc & { prefs: Record<string, unknown>; memberships: Doc[] }>(),
    users: new Map<string, Doc & { prefs: Record<string, unknown> }>(),
    // Session secret → user ID.
    sessions: new Map<string, string>(),
    functions: new Map<string, Doc>(),
    variables: new Map<string, Doc[]>(),
    // Oldest first, like the order they were created in.
    deployments: new Map<string, Doc[]>(),
    uploads: new Map<string, Buffer>(),
    sites: new Map<string, Doc>(),
    runtimes: ['node-16.0', 'node-18.0', 'node-20.0', 'node-22', 'node-23', 'python-3.12'],
    // False acts like an older Appwrite that can't create columns along with a table.
    inlineTables: true,
  }
}
export type FakeState = ReturnType<typeof freshState>

const notFound = (what: string) => new ApiError(404, `${what} could not be found.`, `${what.toLowerCase()}_not_found`)
const conflict = (what: string) => new ApiError(409, `${what} with the requested ID already exists.`, `${what.toLowerCase()}_already_exists`)
const now = () => new Date().toISOString()
const id = (value: unknown) => (typeof value === 'string' && value !== 'unique()' ? value : randomUUID().replaceAll('-', '').slice(0, 20))

function get<T>(map: Map<string, T>, key: string, what: string) {
  const value = map.get(key)
  if (!value) throw notFound(what)
  return value
}

// Supports the queries the app sends: equal and limit. Others are ignored.
function query(items: Doc[], call: Call) {
  let limit = Number.POSITIVE_INFINITY
  let matches = items
  for (const [key, value] of call.query.entries()) {
    if (!key.startsWith('queries')) continue
    const { method, attribute, values = [] } = JSON.parse(value) as { method: string; attribute?: string; values?: unknown[] }
    if (method === 'equal' && attribute) matches = matches.filter((item) => values.includes(item[attribute]))
    if (method === 'limit') limit = Number(values[0])
  }
  return { total: matches.length, items: matches.slice(0, limit) }
}

function routes(state: () => FakeState): [string, string, Handler][] {
  const s = () => state()
  const table = (params: Record<string, string>) => {
    get(s().databases, params.databaseId, 'Database')
    return get(s().tables, params.tableId, 'Table')
  }
  const rows = (tableId: string) => {
    const map = s().rows.get(tableId) ?? new Map<string, Doc>()
    s().rows.set(tableId, map)
    return map
  }
  const team = (teamId: string) => get(s().teams, teamId, 'Team')
  const fn = (functionId: string) => get(s().functions, functionId, 'Function')
  const list = <T>(map: Map<string, T[]>, key: string) => {
    const items = map.get(key) ?? []
    map.set(key, items)
    return items
  }

  return [
    // TablesDB
    ['GET', '/tablesdb/{databaseId}', (_, p) => get(s().databases, p.databaseId, 'Database')],
    [
      'POST',
      '/tablesdb',
      ({ body }) => {
        if (s().databases.has(String(body.databaseId))) throw conflict('Database')
        const database = { $id: String(body.databaseId), name: body.name, enabled: true }
        s().databases.set(database.$id, database)
        return database
      },
    ],
    ['GET', '/tablesdb/{databaseId}/tables/{tableId}', (_, p) => table(p)],
    [
      'POST',
      '/tablesdb/{databaseId}/tables',
      ({ body }, p) => {
        get(s().databases, p.databaseId, 'Database')
        if (s().tables.has(String(body.tableId))) throw conflict('Table')
        if ((body.columns || body.indexes) && !s().inlineTables) {
          throw new ApiError(400, 'Param "columns" is not supported.', 'general_argument_invalid')
        }
        const created = {
          $id: String(body.tableId),
          name: body.name,
          $permissions: body.permissions,
          rowSecurity: body.rowSecurity,
          enabled: body.enabled,
          columns: ((body.columns as Doc[] | undefined) ?? []).map((column) => ({ ...column, status: 'available' })),
          indexes: ((body.indexes as Doc[] | undefined) ?? []).map((index) => ({ ...index, status: 'available' })),
        }
        s().tables.set(created.$id, created)
        return created
      },
    ],
    [
      'POST',
      '/tablesdb/{databaseId}/tables/{tableId}/columns/{type}',
      ({ body }, p) => {
        const target = table(p)
        if (target.columns.some((column) => column.key === body.key)) throw conflict('Column')
        const column = { ...body, $id: String(body.key), type: p.type === 'float' ? 'double' : p.type, status: 'available' }
        target.columns.push(column)
        return column
      },
    ],
    [
      'POST',
      '/tablesdb/{databaseId}/tables/{tableId}/indexes',
      ({ body }, p) => {
        const target = table(p)
        if (target.indexes.some((index) => index.key === body.key)) throw conflict('Index')
        const index = { ...body, $id: String(body.key), attributes: body.columns, status: 'available' }
        target.indexes.push(index)
        return index
      },
    ],
    [
      'GET',
      '/tablesdb/{databaseId}/tables/{tableId}/rows',
      (call, p) => {
        table(p)
        const { total, items } = query([...rows(p.tableId).values()], call)
        return { total, rows: items }
      },
    ],
    [
      'POST',
      '/tablesdb/{databaseId}/tables/{tableId}/rows',
      ({ body }, p) => {
        table(p)
        const rowId = id(body.rowId)
        if (rows(p.tableId).has(rowId)) throw conflict('Row')
        const row = { ...(body.data as Record<string, unknown>), $id: rowId, $tableId: p.tableId, $createdAt: now(), $updatedAt: now() }
        rows(p.tableId).set(rowId, row)
        return row
      },
    ],
    ['GET', '/tablesdb/{databaseId}/tables/{tableId}/rows/{rowId}', (_, p) => get(rows(table(p).$id), p.rowId, 'Row')],
    [
      'PATCH',
      '/tablesdb/{databaseId}/tables/{tableId}/rows/{rowId}',
      ({ body }, p) => {
        const row = get(rows(table(p).$id), p.rowId, 'Row')
        Object.assign(row, body.data, { $updatedAt: now() })
        return row
      },
    ],
    [
      'PATCH',
      '/tablesdb/{databaseId}/tables/{tableId}/rows/{rowId}/{column}/increment',
      ({ body }, p) => {
        const row = get(rows(table(p).$id), p.rowId, 'Row')
        row[p.column] = Number(row[p.column] ?? 0) + Number(body.value ?? 1)
        return row
      },
    ],

    // Storage
    ['GET', '/storage/buckets/{bucketId}', (_, p) => get(s().buckets, p.bucketId, 'Bucket')],
    [
      'POST',
      '/storage/buckets',
      ({ body }) => {
        if (s().buckets.has(String(body.bucketId))) throw conflict('Bucket')
        const { bucketId, ...rest } = body
        const bucket = { ...rest, $id: String(bucketId) }
        s().buckets.set(bucket.$id, bucket)
        return bucket
      },
    ],
    [
      'POST',
      '/storage/buckets/{bucketId}/files',
      async ({ body }, p) => {
        get(s().buckets, p.bucketId, 'Bucket')
        const fileId = id(body.fileId)
        if (s().files.has(fileId)) throw conflict('File')
        const upload = body.file as File
        const data = Buffer.from(await upload.arrayBuffer())
        const file = { $id: fileId, bucketId: p.bucketId, name: upload.name, mimeType: upload.type, sizeOriginal: upload.size, data }
        s().files.set(fileId, file)
        const { data: _, ...metadata } = file
        return metadata
      },
    ],
    [
      'GET',
      '/storage/buckets/{bucketId}/files/{fileId}',
      (_, p) => {
        const { data: _data, ...metadata } = get(s().files, p.fileId, 'File')
        return metadata
      },
    ],
    ['GET', '/storage/buckets/{bucketId}/files/{fileId}/download', (_, p) => new Reply(200, get(s().files, p.fileId, 'File').data)],

    // Teams
    ['GET', '/teams/{teamId}', (_, p) => team(p.teamId)],
    [
      'POST',
      '/teams',
      ({ body }) => {
        if (s().teams.has(String(body.teamId))) throw conflict('Team')
        const created = { $id: String(body.teamId), name: body.name, prefs: {}, memberships: [] }
        s().teams.set(created.$id, created)
        return created
      },
    ],
    [
      'GET',
      '/teams/{teamId}/memberships',
      (call, p) => {
        const { total, items } = query(team(p.teamId).memberships, call)
        return { total, memberships: items }
      },
    ],
    ['GET', '/teams/{teamId}/prefs', (_, p) => team(p.teamId).prefs],
    [
      'PUT',
      '/teams/{teamId}/prefs',
      ({ body }, p) => {
        team(p.teamId).prefs = body.prefs as Record<string, unknown>
        return team(p.teamId).prefs
      },
    ],

    // Users
    ['GET', '/users/{userId}/prefs', (_, p) => get(s().users, p.userId, 'User').prefs],
    [
      'PATCH',
      '/users/{userId}/prefs',
      ({ body }, p) => {
        get(s().users, p.userId, 'User').prefs = body.prefs as Record<string, unknown>
        return body.prefs
      },
    ],

    // Functions. Runtimes come first, so "runtimes" isn't read as a function ID.
    ['GET', '/functions/runtimes', () => ({ total: s().runtimes.length, runtimes: s().runtimes.map(($id) => ({ $id, name: $id })) })],
    ['GET', '/functions/{functionId}', (_, p) => fn(p.functionId)],
    [
      'POST',
      '/functions',
      ({ body }) => {
        if (s().functions.has(String(body.functionId))) throw conflict('Function')
        const { functionId, ...config } = body
        const created = {
          events: [],
          schedule: '',
          deploymentRetention: 0,
          description: '',
          providerRepositoryId: '',
          ...config,
          $id: String(functionId),
          deploymentId: '',
          emailEnabled: false,
        }
        s().functions.set(created.$id, created)
        return created
      },
    ],
    [
      'PUT',
      '/functions/{functionId}',
      ({ body }, p) => {
        // Replaces every setting; only the active deployment stays.
        const updated = { ...body, $id: p.functionId, deploymentId: fn(p.functionId).deploymentId }
        s().functions.set(p.functionId, updated)
        return updated
      },
    ],
    [
      'PATCH',
      '/functions/{functionId}/deployment',
      ({ body }, p) => {
        fn(p.functionId).deploymentId = body.deploymentId
        return fn(p.functionId)
      },
    ],
    [
      'GET',
      '/functions/{functionId}/variables',
      (_, p) => {
        fn(p.functionId)
        // Secret values never come back.
        const variables = list(s().variables, p.functionId).map((variable) => (variable.secret ? { ...variable, value: '' } : variable))
        return { total: variables.length, variables }
      },
    ],
    [
      'POST',
      '/functions/{functionId}/variables',
      ({ body }, p) => {
        fn(p.functionId)
        const variables = list(s().variables, p.functionId)
        if (variables.some((variable) => variable.key === body.key)) throw conflict('Variable')
        // Appwrite makes variables secret unless told otherwise.
        const variable = { $id: id(body.variableId), key: body.key, value: body.value, secret: body.secret ?? true }
        variables.push(variable)
        return variable
      },
    ],
    [
      'PUT',
      '/functions/{functionId}/variables/{variableId}',
      ({ body }, p) => {
        const variable = list(s().variables, p.functionId).find((item) => item.$id === p.variableId)
        if (!variable) throw notFound('Variable')
        Object.assign(variable, { key: body.key, value: body.value, ...(body.secret === undefined ? {} : { secret: body.secret }) })
        return variable
      },
    ],
    [
      'DELETE',
      '/functions/{functionId}/variables/{variableId}',
      (_, p) => {
        const variables = list(s().variables, p.functionId)
        const index = variables.findIndex((item) => item.$id === p.variableId)
        if (index < 0) throw notFound('Variable')
        variables.splice(index, 1)
      },
    ],
    [
      'GET',
      '/functions/{functionId}/deployments',
      (call, p) => {
        fn(p.functionId)
        const { total, items } = query([...list(s().deployments, p.functionId)].reverse(), call)
        return { total, deployments: items }
      },
    ],
    [
      'POST',
      '/functions/{functionId}/deployments',
      async ({ body }, p) => {
        fn(p.functionId)
        const code = body.code as File
        const deployment = {
          $id: id(undefined),
          $createdAt: now(),
          status: 'waiting',
          activate: String(body.activate) === 'true',
          entrypoint: body.entrypoint,
          commands: body.commands,
        }
        list(s().deployments, p.functionId).push(deployment)
        s().uploads.set(deployment.$id, Buffer.from(await code.arrayBuffer()))
        return deployment
      },
    ],

    // Sites
    ['GET', '/sites/{siteId}', (_, p) => get(s().sites, p.siteId, 'Site')],
    [
      'PUT',
      '/sites/{siteId}',
      ({ body }, p) => {
        get(s().sites, p.siteId, 'Site')
        const updated = { ...body, $id: p.siteId }
        s().sites.set(p.siteId, updated)
        return updated
      },
    ],

    // Account. GET /account answers for the session a request carries; tests replace the sign-in routes with fake.on().
    [
      'GET',
      '/account',
      ({ headers }) => {
        const userId = s().sessions.get(headers['x-appwrite-session'] ?? '')
        if (!userId) throw new ApiError(401, 'User (role: guests) missing scopes (["account"])', 'general_unauthorized_scope')
        return get(s().users, userId, 'User')
      },
    ],
    ['POST', '/account/tokens/email', ({ body }) => ({ $id: id(undefined), userId: body.userId, secret: '', expire: now() })],
    [
      'POST',
      '/account/sessions/email',
      () => {
        throw new ApiError(401, 'Invalid credentials. Please check the email and password.', 'user_invalid_credentials')
      },
    ],
    [
      'POST',
      '/account/sessions/token',
      () => {
        throw new ApiError(401, 'Invalid token passed in the request.', 'user_invalid_token')
      },
    ],
  ]
}

function compile(method: string, pattern: string, handler: Handler) {
  const names: string[] = []
  const regex = new RegExp(`^${pattern.replace(/\{(\w+)\}/g, (_, name: string) => (names.push(name), '([^/]+)'))}$`)
  return { method, regex, names, handler }
}

// Sends every request to the fake, whichever host it was meant for.
class ToFake extends Agent {
  private readonly target: string
  constructor(target: string) {
    super()
    this.target = target
  }
  dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandlers) {
    return super.dispatch({ ...options, origin: this.target }, handler)
  }
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks)
  const type = req.headers['content-type'] ?? ''
  if (type.includes('application/json') && raw.length) return JSON.parse(raw.toString('utf8')) as Record<string, unknown>
  if (!type.includes('multipart/form-data')) return {}
  const body: Record<string, unknown> = {}
  for (const [key, value] of await new Response(raw, { headers: { 'content-type': type } }).formData()) body[key] = value
  return body
}

export async function startFakeAppwrite() {
  let state = freshState()
  const calls: Call[] = []
  const base = routes(() => state).map(([method, pattern, handler]) => compile(method, pattern, handler))
  let overrides: ReturnType<typeof compile>[] = []

  async function respond(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://fake')
    const call: Call = {
      method: req.method ?? 'GET',
      path: url.pathname.replace(/^\/v1/, ''),
      query: url.searchParams,
      headers: Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, String(value)])),
      body: await readBody(req),
    }
    calls.push(call)

    let reply: Reply
    try {
      const route = [...overrides, ...base].find((item) => item.method === call.method && item.regex.test(call.path))
      if (!route) throw new ApiError(404, `The fake Appwrite has no route for ${call.method} ${call.path}.`, 'general_route_not_found')
      const values = route.regex.exec(call.path)?.slice(1) ?? []
      const params = Object.fromEntries(route.names.map((name, index) => [name, decodeURIComponent(values[index])]))
      const result = await route.handler(call, params)
      reply = result instanceof Reply ? result : result === undefined ? new Reply(204, null) : new Reply(call.method === 'POST' ? 201 : 200, result)
    } catch (error) {
      reply =
        error instanceof ApiError
          ? new Reply(error.code, { message: error.message, code: error.code, type: error.type, version: '1.8.0' })
          : new Reply(500, { message: String(error), code: 500, type: 'general_unknown', version: '1.8.0' })
    }
    const raw = Buffer.isBuffer(reply.body)
    const type = reply.body === null ? {} : { 'content-type': raw ? 'application/octet-stream' : 'application/json' }
    res.writeHead(reply.status, { ...type, ...reply.headers })
    res.end(reply.body === null ? undefined : raw ? reply.body : JSON.stringify(reply.body))
  }

  const server = createServer((req, res) => void respond(req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const previous = getGlobalDispatcher()
  const agent = new ToFake(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  setGlobalDispatcher(agent)

  return {
    calls,
    get state() {
      return state
    },
    // Empties the project and forgets calls and route overrides.
    reset() {
      state = freshState()
      calls.length = 0
      overrides = []
    },
    // Replaces a route until the next reset().
    on(method: string, pattern: string, handler: Handler) {
      overrides.unshift(compile(method, pattern, handler))
    },
    callsTo(method: string, path: string | RegExp) {
      return calls.filter((call) => call.method === method && (typeof path === 'string' ? call.path === path : path.test(call.path)))
    },
    // Finishes the newest build. A ready build that was deployed with activate goes live.
    finishBuild(functionId: string, status: 'ready' | 'failed' = 'ready') {
      const deployment = state.deployments.get(functionId)?.at(-1)
      if (!deployment) throw new Error(`No deployment to finish for ${functionId}`)
      deployment.status = status
      if (status === 'ready' && deployment.activate) get(state.functions, functionId, 'Function').deploymentId = deployment.$id
    },
    async close() {
      setGlobalDispatcher(previous)
      await agent.close()
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

export type FakeAppwrite = Awaited<ReturnType<typeof startFakeAppwrite>>
