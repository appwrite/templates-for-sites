export const STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'reimbursed'] as const
export type Status = (typeof STATUSES)[number]

export const ROLES = ['owner', 'admin', 'approver', 'member'] as const
export type Role = (typeof ROLES)[number]

export interface Viewer {
  id: string
  name: string
  email: string
  role: Role
  isAdmin: boolean
  canApprove: boolean
}

export interface Member {
  id: string
  membershipId: string
  name: string
  email: string
  role: Role
}

export interface Workspace {
  name: string
  currency: string
  // Null on self-hosted Appwrite, which has no email triggers.
  receiptsAddress: string | null
}

export interface Category {
  id: string
  name: string
  limit: number
  archived: boolean
}

export interface Receipt {
  fileId: string
  name: string
  type: string
}

export interface Expense {
  id: string
  ownerId: string
  ownerName: string
  merchant: string
  amount: number
  currency: string
  spentAt: string
  categoryId: string
  categoryName: string
  description: string
  status: Status
  reportId: string | null
  receipt: Receipt | null
  source: 'manual' | 'email'
  emailSubject: string
  overLimit: boolean
  createdAt: string
}

export interface ExpenseDetail extends Expense {
  emailHtml: string
  emailText: string
}

export interface Report {
  id: string
  title: string
  ownerId: string
  ownerName: string
  status: Status
  totals: Record<string, number>
  expenseCount: number
  approverName: string
  comment: string
  submittedAt: string | null
  decidedAt: string | null
  reimbursedAt: string | null
  createdAt: string
}

export interface AuditEvent {
  id: string
  action: string
  actorName: string
  fromStatus: string
  toStatus: string
  comment: string
  createdAt: string
}
