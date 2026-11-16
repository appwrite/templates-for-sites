// Every Appwrite resource Outlay needs. /setup creates whatever is missing
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
  // Lowercase, as createIndex expects. Inline indexes in createTable get them uppercased.
  orders?: ('asc' | 'desc')[]
}

export interface TableSpec {
  id: string
  name: string
  permissions: string[]
  rowSecurity: boolean
  columns: ColumnSpec[]
  indexes: IndexSpec[]
}

export const DATABASE = { id: 'outlay', name: 'Outlay' }

export const TEAM = { id: 'workspace', name: 'Outlay workspace' }

// Approvers and admins read every expense; members read their own rows through row permissions.
const REVIEWERS = ['owner', 'admin', 'approver'].map((role) => `read("team:${TEAM.id}/${role}")`)
const STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'reimbursed']

export const TABLE_SPECS: TableSpec[] = [
  {
    id: 'expenses',
    name: 'Expenses',
    permissions: REVIEWERS,
    rowSecurity: true,
    columns: [
      { key: 'ownerId', type: 'varchar', size: 36, required: true },
      { key: 'ownerName', type: 'varchar', size: 255 },
      { key: 'merchant', type: 'varchar', size: 255, required: true },
      { key: 'amount', type: 'integer', required: true, min: 0 },
      { key: 'currency', type: 'varchar', size: 3, required: true },
      { key: 'spentAt', type: 'datetime', required: true },
      { key: 'categoryId', type: 'varchar', size: 36 },
      { key: 'categoryName', type: 'varchar', size: 64 },
      { key: 'description', type: 'text' },
      { key: 'status', type: 'enum', elements: STATUSES, default: 'draft' },
      { key: 'reportId', type: 'varchar', size: 36 },
      { key: 'receiptFileId', type: 'varchar', size: 36 },
      { key: 'receiptName', type: 'varchar', size: 255 },
      { key: 'receiptType', type: 'varchar', size: 128 },
      { key: 'source', type: 'enum', elements: ['manual', 'email'], default: 'manual' },
      { key: 'emailSubject', type: 'varchar', size: 512 },
      { key: 'emailHtml', type: 'mediumtext' },
      { key: 'emailText', type: 'mediumtext' },
      { key: 'overLimit', type: 'boolean', default: false },
    ],
    indexes: [
      { key: 'owner_status', type: 'key', columns: ['ownerId', 'status', 'spentAt'], orders: ['asc', 'asc', 'desc'] },
      { key: 'report', type: 'key', columns: ['reportId'] },
      { key: 'status_spent', type: 'key', columns: ['status', 'spentAt'], orders: ['asc', 'desc'] },
      { key: 'spent', type: 'key', columns: ['spentAt'], orders: ['desc'] },
      { key: 'merchant_search', type: 'fulltext', columns: ['merchant'] },
    ],
  },
  {
    id: 'reports',
    name: 'Reports',
    permissions: REVIEWERS,
    rowSecurity: true,
    columns: [
      { key: 'title', type: 'varchar', size: 255, required: true },
      { key: 'ownerId', type: 'varchar', size: 36, required: true },
      { key: 'ownerName', type: 'varchar', size: 255 },
      { key: 'status', type: 'enum', elements: STATUSES, default: 'draft' },
      { key: 'totals', type: 'varchar', size: 512 },
      { key: 'expenseCount', type: 'integer', default: 0, min: 0 },
      { key: 'approverId', type: 'varchar', size: 36 },
      { key: 'approverName', type: 'varchar', size: 255 },
      { key: 'comment', type: 'text' },
      { key: 'submittedAt', type: 'datetime' },
      { key: 'decidedAt', type: 'datetime' },
      { key: 'reimbursedAt', type: 'datetime' },
    ],
    indexes: [
      { key: 'owner_status', type: 'key', columns: ['ownerId', 'status'] },
      { key: 'status_submitted', type: 'key', columns: ['status', 'submittedAt'], orders: ['asc', 'desc'] },
    ],
  },
  {
    id: 'events',
    name: 'Audit trail',
    permissions: REVIEWERS,
    rowSecurity: true,
    columns: [
      { key: 'reportId', type: 'varchar', size: 36 },
      { key: 'expenseId', type: 'varchar', size: 36 },
      { key: 'actorId', type: 'varchar', size: 36 },
      { key: 'actorName', type: 'varchar', size: 255 },
      { key: 'action', type: 'varchar', size: 32, required: true },
      { key: 'fromStatus', type: 'varchar', size: 16 },
      { key: 'toStatus', type: 'varchar', size: 16 },
      { key: 'comment', type: 'text' },
    ],
    indexes: [
      { key: 'report', type: 'key', columns: ['reportId'] },
      { key: 'expense', type: 'key', columns: ['expenseId'] },
    ],
  },
  {
    id: 'categories',
    name: 'Categories',
    permissions: [`read("team:${TEAM.id}")`],
    rowSecurity: false,
    columns: [
      { key: 'name', type: 'varchar', size: 64, required: true },
      { key: 'limit', type: 'integer', default: 0, min: 0 },
      { key: 'archived', type: 'boolean', default: false },
    ],
    indexes: [{ key: 'name_unique', type: 'unique', columns: ['name'] }],
  },
]

// Receipts are only served through the site's authenticated file route, so the bucket grants nobody direct access.
export const BUCKET = {
  id: 'receipts',
  name: 'Receipts',
  permissions: [] as string[],
  maximumFileSize: 20 * 1024 * 1024,
}

export const RECEIPTS_FUNCTION = {
  id: process.env.OUTLAY_RECEIPTS_FUNCTION_ID || 'receipts',
  name: 'Receipts by email',
  entrypoint: 'src/main.js',
  commands: 'npm install --omit=dev',
  // The email trigger waits for the function before accepting a message.
  timeout: 60,
  scopes: ['users.read', 'teams.read', 'rows.read', 'rows.write', 'files.read', 'files.write'],
}

// The scopes the site's ephemeral key needs, grouped for the setup page. New
// tables are created with their columns in one request, so the column and index
// scopes are only needed later, to add columns when a new version needs them.
export const SITE_SCOPES: { group: string; scopes: string[]; optional?: boolean }[] = [
  { group: 'Auth', scopes: ['users.read', 'users.write', 'teams.read', 'teams.write'] },
  { group: 'Database', scopes: ['databases.read', 'databases.write', 'tables.read', 'tables.write', 'rows.read', 'rows.write'] },
  { group: 'Storage', scopes: ['buckets.read', 'buckets.write', 'files.read', 'files.write'] },
  { group: 'Functions', scopes: ['functions.read', 'functions.write'] },
  { group: 'Sites', scopes: ['sites.read', 'sites.write'] },
  { group: 'Upgrades', scopes: ['columns.read', 'columns.write', 'indexes.read', 'indexes.write'], optional: true },
]

// Only needed to create or upgrade resources. The last setup step removes them
// from the site, and Settings → System asks for them again when an update needs them.
export const SETUP_SCOPES = ['databases.write', 'tables.write', 'columns.write', 'indexes.write', 'buckets.write', 'sites.read', 'sites.write']
