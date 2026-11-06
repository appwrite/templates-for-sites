// IDs and table shapes that /setup creates. The inbox function (node/email-testing-inbox in appwrite/templates) uses the same IDs.

export const TEAM_ID = "catchall";
export const DATABASE_ID = "catchall";
export const BUCKET_ID = "attachments";
export const FUNCTION_ID = "inbox";
export const MESSAGES = "messages";
export const TOKENS = "tokens";
export const SETTINGS = "settings";
export const SETTINGS_ROW = "settings";
export const CLEANUP_SCHEDULE = "0 3 * * *";
export const DEFAULT_RETENTION_DAYS = 7;
export const RETENTION_CHOICES = [1, 3, 7, 14, 30];
export const TOKEN_LIFETIME_DAYS = 90;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

// The site keeps these after setup. Each one has a job at runtime.
export const RUNTIME_SCOPES = [
	{
		scope: "rows.read",
		why: "Reads messages for the CI API and checks that setup finished.",
	},
	{
		scope: "rows.write",
		why: "Saves settings and API tokens, and empties the inbox.",
	},
	{ scope: "files.read", why: "Serves attachments to the CI API." },
	{
		scope: "files.write",
		why: "Deletes attachments when you empty the inbox.",
	},
	{
		scope: "teams.read",
		why: "Checks whether an admin already exists, and that an AI agent's account is still on the team.",
	},
] as const;

// Setup needs these too, and the site gives them back in its last step.
export const SETUP_ONLY_SCOPES = [
	{ scope: "databases.read", why: "Checks the database." },
	{ scope: "databases.write", why: "Creates the database." },
	{ scope: "tables.read", why: "Checks the tables." },
	{
		scope: "tables.write",
		why: "Creates the tables with their columns and indexes.",
	},
	{ scope: "buckets.read", why: "Checks the attachments bucket." },
	{ scope: "buckets.write", why: "Creates the attachments bucket." },
	{ scope: "functions.read", why: "Checks the function and its build." },
	{
		scope: "functions.write",
		why: "Deploys the function that receives mail and turns on its email trigger.",
	},
	{
		scope: "project.read",
		why: "Reads the project's OAuth server settings, so it changes only what it needs.",
	},
	{
		scope: "project.write",
		why: "Turns on the project's OAuth server so AI agents can sign in.",
	},
	{
		scope: "sites.read",
		why: "Reads this site's settings before it changes its scopes.",
	},
	{
		scope: "sites.write",
		why: "Removes the setup scopes from this site at the end.",
	},
] as const;

export const ALL_SCOPES = [...RUNTIME_SCOPES, ...SETUP_ONLY_SCOPES].map(
	(s) => s.scope,
);
export const RUNTIME_SCOPE_NAMES: string[] = RUNTIME_SCOPES.map((s) => s.scope);
export const SETUP_ONLY_SCOPE_NAMES: string[] = SETUP_ONLY_SCOPES.map(
	(s) => s.scope,
);

// Appwrite adds these to every site key on its own (they aren't in the site's scope list), so the app ignores them.
export const PLATFORM_SCOPES: Record<string, string> = {
	"proxy.invalidations.write":
		"Added by Appwrite Sites so a site can purge its own CDN cache.",
};

export function isPlatformScope(scope: string) {
	return scope in PLATFORM_SCOPES;
}

// The function gets its own short list: it stores mail and deletes old mail, nothing else.
export const FUNCTION_SCOPES = ["rows.read", "rows.write", "files.write"];

const team = `team:${TEAM_ID}`;
export const MEMBER_READ = `read("${team}")`;
export const MEMBER_UPDATE = `update("${team}")`;
export const MEMBER_DELETE = `delete("${team}")`;

type Column = {
	key: string;
	type: string;
	size?: number;
	required: boolean;
	default?: unknown;
	array?: boolean;
};
type Index = {
	key: string;
	type: "key" | "unique";
	attributes: string[];
	orders?: ("ASC" | "DESC")[];
};
export type TableSpec = {
	id: string;
	name: string;
	permissions: string[];
	columns: Column[];
	indexes: Index[];
};

const varchar = (key: string, size: number): Column => ({
	key,
	type: "varchar",
	size,
	required: false,
});
const text = (key: string, type = "text"): Column => ({
	key,
	type,
	required: false,
});

export const TABLES: TableSpec[] = [
	{
		id: MESSAGES,
		name: "Messages",
		// Signed-in team members read, mark as read and delete messages with their own session.
		permissions: [MEMBER_READ, MEMBER_UPDATE, MEMBER_DELETE],
		columns: [
			varchar("mailbox", 128),
			varchar("recipient", 320),
			varchar("fromName", 256),
			varchar("fromAddress", 320),
			varchar("subject", 998),
			varchar("preview", 280),
			text("text", "longtext"),
			text("html", "longtext"),
			varchar("code", 32),
			text("links", "mediumtext"),
			{ key: "linkCount", type: "integer", required: false, default: 0 },
			text("attachments", "mediumtext"),
			{ key: "attachmentCount", type: "integer", required: false, default: 0 },
			{ key: "spamScore", type: "double", required: false },
			varchar("spamVerdict", 16),
			text("meta", "longtext"),
			{ key: "receivedAt", type: "datetime", required: true },
			{ key: "read", type: "boolean", required: false, default: false },
		],
		indexes: [
			{
				key: "received",
				type: "key",
				attributes: ["receivedAt"],
				orders: ["DESC"],
			},
			{
				key: "mailbox_received",
				type: "key",
				attributes: ["mailbox", "receivedAt"],
				orders: ["ASC", "DESC"],
			},
		],
	},
	{
		id: TOKENS,
		name: "API tokens",
		// Only the site's key touches tokens: the server checks the person's role first.
		permissions: [],
		columns: [
			varchar("name", 64),
			varchar("hash", 64),
			varchar("prefix", 16),
			varchar("createdBy", 36),
			varchar("createdByName", 128),
			{ key: "expiresAt", type: "datetime", required: true },
			{ key: "lastUsedAt", type: "datetime", required: false },
		],
		indexes: [
			{ key: "hash", type: "unique", attributes: ["hash"] },
			{ key: "created_by", type: "key", attributes: ["createdBy"] },
		],
	},
	{
		id: SETTINGS,
		name: "Settings",
		permissions: [],
		columns: [
			{
				key: "retentionDays",
				type: "integer",
				required: false,
				default: DEFAULT_RETENTION_DAYS,
			},
			{ key: "setupCompletedAt", type: "datetime", required: false },
		],
		indexes: [],
	},
];
