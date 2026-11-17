export type ConversationStatus = 'open' | 'pending' | 'closed' | 'spam'
export type MessageDirection = 'inbound' | 'outbound' | 'note'

export const FOLDERS = ['unassigned', 'mine', 'open', 'pending', 'closed', 'spam'] as const
export type Folder = (typeof FOLDERS)[number]

export interface Viewer {
  id: string
  name: string
  email: string
  roles: string[]
  isAdmin: boolean
  signature: string
}

export interface Agent {
  id: string
  membershipId: string
  name: string
  email: string
  roles: string[]
}

export interface Workspace {
  name: string
  replyToName: string
  mailbox: string
}

export interface Conversation {
  id: string
  ref: string
  subject: string
  status: ConversationStatus
  mailbox: string
  customerId: string
  customerEmail: string
  customerName: string
  assigneeId: string | null
  assigneeName: string
  tags: string[]
  preview: string
  lastMessageAt: string
  lastDirection: 'inbound' | 'outbound'
  messageCount: number
  seen: boolean
  spamScore: number | null
  createdAt: string
}

export interface Attachment {
  fileId: string
  name: string
  contentType: string
  size: number
  contentId: string
  inline: boolean
}

export interface Message {
  id: string
  conversationId: string
  direction: MessageDirection
  fromEmail: string
  fromName: string
  recipients: string
  cc: string
  subject: string
  text: string
  html: string
  authorId: string
  authorName: string
  attachments: Attachment[]
  deliveryId: string
  source: string
  metadata: string
  deliveryStatus: string
  deliveryError: string
  spamVerdict: string
  createdAt: string
}

export interface Customer {
  id: string
  email: string
  name: string
  conversationCount: number
  lastContactAt: string | null
  notes: string
  createdAt: string
}

export interface SavedReply {
  id: string
  name: string
  body: string
  updatedAt: string
}

export interface FolderCounts {
  unassigned: number
  mine: number
  open: number
  pending: number
  spam: number
}
