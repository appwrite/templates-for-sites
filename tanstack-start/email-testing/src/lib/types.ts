export type Link = {
	url: string;
	label: string;
	local: boolean;
	insecure: boolean;
};

export type Attachment = {
	name: string;
	contentType: string;
	contentId: string;
	disposition: string;
	size: number;
	fileId: string | null;
	error?: string;
};

export type MessageSummary = {
	id: string;
	mailbox: string;
	recipient: string;
	fromName: string;
	fromAddress: string;
	subject: string;
	preview: string;
	code: string | null;
	firstLink: Link | null;
	linkCount: number;
	attachmentCount: number;
	spamScore: number | null;
	spamVerdict: string | null;
	receivedAt: string;
	read: boolean;
};

export type Check = {
	id: string;
	status: "pass" | "warn" | "fail";
	title: string;
	detail: string;
};

export type MessageDetail = MessageSummary & {
	text: string;
	html: string;
	links: Link[];
	attachments: Attachment[];
	headers: [string, string][];
	date: string;
	messageId: string;
	cc: string;
	replyTo: string;
	to: string;
	transport: { remoteIp?: string; helo?: string; tls?: boolean } | null;
	checks: Check[];
	rawJson: string;
};

export type InboxFilter = "all" | "code" | "link" | "attachments" | "unread";

export type InboxCounts = Record<InboxFilter, number>;

export type MailboxCount = { mailbox: string; count: number };

export type ViewerInfo = {
	userId: string;
	name: string;
	email: string;
	role: "admin" | "member";
};

export type TokenInfo = {
	id: string;
	name: string;
	prefix: string;
	createdBy: string;
	createdByName: string;
	createdAt: string;
	expiresAt: string;
	lastUsedAt: string | null;
	mine: boolean;
};

export type MemberInfo = {
	membershipId: string;
	userId: string;
	name: string;
	email: string;
	role: "admin" | "member";
	confirmed: boolean;
	joinedAt: string;
	you: boolean;
};

export type ScopeRow = {
	scope: string;
	why: string;
	state: "kept" | "setup" | "extra" | "missing" | "platform";
};
