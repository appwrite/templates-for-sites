// Every Appwrite resource Mailroom needs. /setup creates whatever is missing
// from this list, and Settings → System repairs or upgrades an existing project.

export interface ColumnSpec {
  key: string
  type: 'varchar' | 'text' | 'mediumtext' | 'enum' | 'integer' | 'double' | 'boolean' | 'datetime'
  size?: number
  required?: boolean
  default?: string | number | boolean
  array?: boolean
  elements?: string[]
  min?: number
}

export interface IndexSpec {
  key: string
  type: 'key' | 'unique' | 'fulltext'
  columns: string[]
  orders?: ('asc' | 'desc')[]
}

export interface TableSpec {
  id: string
  name: string
  columns: ColumnSpec[]
  indexes: IndexSpec[]
}

export const DATABASE = { id: 'mailroom', name: 'Mailroom' }

export const TEAM = { id: 'agents', name: 'Support agents' }

// Agents read rows directly only for Realtime; every write goes through the server.
export const TABLE_PERMISSIONS = [`read("team:${TEAM.id}")`]

export const TABLE_SPECS: TableSpec[] = [
  {
    id: 'conversations',
    name: 'Conversations',
    columns: [
      { key: 'ref', type: 'varchar', size: 12, required: true },
      { key: 'subject', type: 'varchar', size: 512, required: true },
      { key: 'status', type: 'enum', elements: ['open', 'pending', 'closed', 'spam'], default: 'open' },
      { key: 'mailbox', type: 'varchar', size: 320 },
      { key: 'customerId', type: 'varchar', size: 36, required: true },
      { key: 'customerEmail', type: 'varchar', size: 320, required: true },
      { key: 'customerName', type: 'varchar', size: 255 },
      { key: 'assigneeId', type: 'varchar', size: 36 },
      { key: 'assigneeName', type: 'varchar', size: 255 },
      { key: 'tags', type: 'varchar', size: 48, array: true },
      { key: 'preview', type: 'varchar', size: 280 },
      { key: 'lastMessageAt', type: 'datetime', required: true },
      { key: 'lastDirection', type: 'enum', elements: ['inbound', 'outbound'], default: 'inbound' },
      { key: 'messageCount', type: 'integer', default: 0, min: 0 },
      { key: 'seen', type: 'boolean', default: false },
      { key: 'spamScore', type: 'double' },
    ],
    indexes: [
      { key: 'ref_unique', type: 'unique', columns: ['ref'] },
      { key: 'status_last', type: 'key', columns: ['status', 'lastMessageAt'], orders: ['asc', 'desc'] },
      {
        key: 'assignee_status_last',
        type: 'key',
        columns: ['assigneeId', 'status', 'lastMessageAt'],
        orders: ['asc', 'asc', 'desc'],
      },
      { key: 'customer', type: 'key', columns: ['customerId'] },
      { key: 'subject_search', type: 'fulltext', columns: ['subject'] },
    ],
  },
  {
    id: 'messages',
    name: 'Messages',
    columns: [
      { key: 'conversationId', type: 'varchar', size: 36, required: true },
      { key: 'direction', type: 'enum', elements: ['inbound', 'outbound', 'note'], required: true },
      { key: 'fromEmail', type: 'varchar', size: 320 },
      { key: 'fromName', type: 'varchar', size: 255 },
      { key: 'recipients', type: 'varchar', size: 1024 },
      { key: 'cc', type: 'varchar', size: 1024 },
      { key: 'subject', type: 'varchar', size: 512 },
      { key: 'text', type: 'mediumtext' },
      { key: 'html', type: 'mediumtext' },
      { key: 'messageId', type: 'varchar', size: 512 },
      { key: 'authorId', type: 'varchar', size: 36 },
      { key: 'authorName', type: 'varchar', size: 255 },
      { key: 'attachments', type: 'text' },
      { key: 'deliveryId', type: 'varchar', size: 64 },
      { key: 'deliveryStatus', type: 'varchar', size: 32 },
      { key: 'deliveryError', type: 'varchar', size: 1024 },
      { key: 'spamVerdict', type: 'varchar', size: 16 },
      // How an inbound message arrived: empty for the email trigger, "api" or "webhook" for POST /api/tickets.
      { key: 'source', type: 'varchar', size: 16 },
      // The plain text metadata field of POST /api/tickets, for any extra data.
      { key: 'metadata', type: 'mediumtext' },
    ],
    indexes: [
      { key: 'conversation', type: 'key', columns: ['conversationId'] },
      { key: 'message_id', type: 'key', columns: ['messageId'] },
    ],
  },
  {
    id: 'customers',
    name: 'Customers',
    columns: [
      { key: 'email', type: 'varchar', size: 320, required: true },
      { key: 'name', type: 'varchar', size: 255 },
      { key: 'conversationCount', type: 'integer', default: 0, min: 0 },
      { key: 'lastContactAt', type: 'datetime' },
      { key: 'notes', type: 'text' },
    ],
    indexes: [
      { key: 'email_unique', type: 'unique', columns: ['email'] },
      { key: 'last_contact', type: 'key', columns: ['lastContactAt'], orders: ['desc'] },
    ],
  },
  {
    id: 'saved_replies',
    name: 'Saved replies',
    columns: [
      { key: 'name', type: 'varchar', size: 128, required: true },
      { key: 'body', type: 'text', required: true },
    ],
    indexes: [],
  },
]

export const BUCKET = {
  id: 'attachments',
  name: 'Email attachments',
  permissions: [`read("team:${TEAM.id}")`],
  maximumFileSize: 25 * 1024 * 1024,
}

export const INBOUND_FUNCTION = {
  id: process.env.MAILROOM_INBOUND_FUNCTION_ID || 'inbound',
  name: 'Inbound email',
  entrypoint: 'src/main.js',
  commands: 'npm install --omit=dev',
  // The email trigger waits for the function before accepting a message.
  timeout: 60,
  scopes: ['rows.read', 'rows.write', 'files.read', 'files.write'],
}

// The scopes the site's ephemeral key needs, grouped for the setup page. New
// tables are created with their columns in one request, so the column and index
// scopes are only needed later, to add columns when a new version needs them.
export const SITE_SCOPES: { group: string; scopes: string[]; optional?: boolean }[] = [
  { group: 'Auth', scopes: ['users.read', 'users.write', 'teams.read', 'teams.write'] },
  { group: 'Database', scopes: ['databases.read', 'databases.write', 'tables.read', 'tables.write', 'rows.read', 'rows.write'] },
  { group: 'Storage', scopes: ['buckets.read', 'buckets.write', 'files.read', 'files.write'] },
  { group: 'Messaging', scopes: ['providers.read', 'providers.write', 'messages.read', 'messages.write'] },
  { group: 'Functions', scopes: ['functions.read', 'functions.write', 'rules.read', 'rules.write'] },
  { group: 'Sites', scopes: ['sites.read', 'sites.write'] },
  { group: 'Upgrades', scopes: ['columns.read', 'columns.write', 'indexes.read', 'indexes.write'], optional: true },
]

// Only needed to create or upgrade resources. The last setup step removes them
// from the site, and Settings → System asks for them again when an update needs them.
export const SETUP_SCOPES = ['databases.write', 'tables.write', 'columns.write', 'indexes.write', 'buckets.write', 'sites.read', 'sites.write']
