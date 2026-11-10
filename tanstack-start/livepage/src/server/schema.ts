// IDs, table shapes and scopes for Livepage. This file has no imports, so other scripts can load it directly.

export const DATABASE_ID = "livepage";
export const BUCKET_ID = "files";
export const MAX_FILE_BYTES = 30 * 1024 * 1024;

export const SETTINGS = "settings";
export const SETTINGS_ROW = "settings";
// Row id in the secrets table that holds the AI provider key.
export const AI_KEY_SECRET = "aiKey";
export const SECRETS = "secrets";
export const WORKSPACES = "workspaces";
export const PAGES = "pages";
export const BODIES = "bodies";
export const UPDATES = "updates";
export const VERSIONS = "versions";
export const PROPERTIES = "properties";
export const VIEWS = "views";
export const CELLS = "cells";
export const COMMENTS = "comments";
export const NOTIFICATIONS = "notifications";
export const LINKS = "links";
export const FAVORITES = "favorites";
export const VISITS = "visits";
export const ACCESS_REQUESTS = "accessRequests";
export const TOKENS = "tokens";
export const AI_USAGE = "aiUsage";

// Realtime channels for row events.
export const rowsChannel = (table: string) =>
	`tablesdb.${DATABASE_ID}.tables.${table}.rows`;

// ---------- Scopes ----------

// The site keeps these after setup. Each one has a job at runtime.
export const RUNTIME_SCOPES = [
	{
		scope: "rows.read",
		why: "Reads settings and the AI key, and checks page access for agents and guests.",
	},
	{
		scope: "rows.write",
		why: "Writes things a person can't write directly: notifications, compaction, guest edits.",
	},
	{ scope: "files.read", why: "Serves images to published pages and AI." },
	{ scope: "files.write", why: "Saves generated images." },
	{
		scope: "teams.read",
		why: "Checks workspace membership and lists members.",
	},
	{
		scope: "teams.write",
		why: "Invites people to a workspace and changes their role.",
	},
	{
		scope: "users.read",
		why: "Looks up names and avatars for the people in a workspace.",
	},
	{
		scope: "users.write",
		why: "Signs agents in as the person who connected them, and removes an account when its owner deletes it.",
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
	{ scope: "buckets.read", why: "Checks the files bucket." },
	{ scope: "buckets.write", why: "Creates the files bucket." },
	{
		scope: "vectorsdb.read",
		why: "Reads which search-by-meaning plans this project can use.",
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
		why: "Reads this site's settings before it changes them.",
	},
	{
		scope: "sites.write",
		why: "Sets the site's time limit and removes the setup scopes at the end.",
	},
	{
		scope: "platforms.write",
		why: "Adds this site's address to the project if Appwrite doesn't already accept it.",
	},
	{
		scope: "vectorsdb.write",
		why: "Creates the vector database if you turn on search by meaning.",
	},
	{
		scope: "vectorsdb.collections.read",
		why: "Used by search by meaning. Kept only if you turn it on.",
	},
	{
		scope: "vectorsdb.collections.write",
		why: "Used by search by meaning. Kept only if you turn it on.",
	},
	{
		scope: "vectorsdb.documents.read",
		why: "Used by search by meaning. Kept only if you turn it on.",
	},
	{
		scope: "vectorsdb.documents.write",
		why: "Used by search by meaning. Kept only if you turn it on.",
	},
	{
		scope: "embeddings.write",
		why: "Checks and uses Appwrite's built-in text embeddings.",
	},
] as const;

export const ALL_SCOPES: string[] = [
	...RUNTIME_SCOPES,
	...SETUP_ONLY_SCOPES,
].map((s) => s.scope);
export const SETUP_ONLY_SCOPE_NAMES: string[] = SETUP_ONLY_SCOPES.map(
	(s) => s.scope,
);
// Kept after setup when search by meaning is on, because the running site uses them.
export const VECTOR_SCOPE_NAMES: string[] = [
	"vectorsdb.read",
	"vectorsdb.write",
	"vectorsdb.collections.read",
	"vectorsdb.collections.write",
	"vectorsdb.documents.read",
	"vectorsdb.documents.write",
	"embeddings.write",
];

// ---------- Table specs ----------

export type Column = {
	key: string;
	type:
		| "varchar"
		| "text"
		| "mediumtext"
		| "longtext"
		| "integer"
		| "bigint"
		| "double"
		| "boolean"
		| "datetime"
		| "enum";
	size?: number;
	required: boolean;
	default?: unknown;
	array?: boolean;
	elements?: string[];
	encrypt?: boolean;
};

export type Index = {
	key: string;
	type: "key" | "unique" | "fulltext";
	attributes: string[];
	orders?: ("ASC" | "DESC")[];
};

export type TableSpec = {
	id: string;
	name: string;
	// Table-level permissions. Row security is on for all user data, so these only grant create.
	permissions: string[];
	rowSecurity: boolean;
	columns: Column[];
	indexes: Index[];
};

// Only `updates` and `cells` take direct browser writes, so only they let a signed-in person
// create a row. Anything created this way is filtered with `isTrusted` wherever it's read.
const CREATE_SIGNED_IN = ['create("users")'];

const varchar = (key: string, size: number, required = false): Column => ({
	key,
	type: "varchar",
	size,
	required,
});
const longtext = (key: string): Column => ({
	key,
	type: "longtext",
	required: false,
});
const mediumtext = (key: string): Column => ({
	key,
	type: "mediumtext",
	required: false,
});
const text = (key: string): Column => ({
	key,
	type: "text",
	required: false,
});
const when = (key: string): Column => ({
	key,
	type: "datetime",
	required: false,
});
const flag = (key: string, def = false): Column => ({
	key,
	type: "boolean",
	required: false,
	default: def,
});
const position = (key = "position"): Column => ({
	key,
	type: "double",
	required: false,
	default: 0,
});
const enumOf = (key: string, elements: string[], def?: string): Column => ({
	key,
	type: "enum",
	elements,
	required: false,
	default: def,
});
const workspaceId = () => varchar("workspaceId", 36, true);
const pageId = () => varchar("pageId", 36, true);

// Goes up whenever TABLES below changes. A deployment that has finished setup keeps the number it was
// built with in `settings.schemaVersion`; one from before this existed has none and counts as 1.
export const SCHEMA_VERSION = 3;

export const PAGE_KINDS = ["page", "database", "row"] as const;
export const VISIBILITIES = ["workspace", "private", "restricted"] as const;

export const TABLES: TableSpec[] = [
	{
		id: SETTINGS,
		name: "Settings",
		// Only the site key reads or writes it. Non-secret, but an account with no workspace
		// (anyone can create one directly) must see nothing, and setupState is internal.
		permissions: [],
		rowSecurity: false,
		columns: [
			{ key: "schemaVersion", type: "integer", required: false },
			when("setupCompletedAt"),
			mediumtext("setupState"),
			enumOf("signup", ["invite", "open"], "invite"),
			text("features"),
			flag("aiEnabled"),
			varchar("aiEndpoint", 512),
			varchar("aiTextModel", 128),
			varchar("aiImageModel", 128),
			varchar("aiEmbeddingModel", 128),
			flag("aiImages"),
			flag("vectors"),
			varchar("vectorsSpecification", 64),
			flag("agents"),
			// The origin the Site was set up on, used for links we send (see trustedOrigin).
			varchar("siteOrigin", 256),
			// A private-network AI host the Site owner approved during /setup (see net-guard).
			varchar("aiPrivateHost", 128),
		],
		indexes: [],
	},
	{
		id: SECRETS,
		name: "Secrets",
		// No permissions at all: only the site's key can touch this table.
		permissions: [],
		rowSecurity: false,
		columns: [{ key: "value", type: "text", required: false, encrypt: true }],
		indexes: [],
	},
	{
		id: WORKSPACES,
		name: "Workspaces",
		permissions: [],
		rowSecurity: true,
		columns: [
			varchar("name", 128, true),
			varchar("icon", 64),
			mediumtext("sections"),
			varchar("createdBy", 36),
		],
		indexes: [],
	},
	{
		id: PAGES,
		name: "Pages",
		permissions: [],
		rowSecurity: true,
		columns: [
			workspaceId(),
			varchar("parentId", 36),
			varchar("sectionId", 36),
			enumOf("kind", [...PAGE_KINDS], "page"),
			varchar("title", 512),
			varchar("icon", 64),
			varchar("coverFileId", 36),
			position(),
			varchar("databaseId", 36),
			when("snapshotAt"),
			enumOf("visibility", [...VISIBILITIES], "workspace"),
			text("shares"),
			varchar("publishedSlug", 128),
			when("trashedAt"),
			varchar("createdBy", 36),
			varchar("updatedBy", 36),
		],
		indexes: [
			{
				key: "workspace",
				type: "key",
				attributes: ["workspaceId", "kind"],
				orders: ["ASC", "ASC"],
			},
			{ key: "parent", type: "key", attributes: ["parentId"] },
			{ key: "database", type: "key", attributes: ["databaseId"] },
			{ key: "slug", type: "unique", attributes: ["publishedSlug"] },
			{ key: "title_search", type: "fulltext", attributes: ["title"] },
			{ key: "trashed", type: "key", attributes: ["workspaceId", "trashedAt"] },
		],
	},
	{
		// Page bodies live apart from page metadata: Realtime sends the whole row on every change, and
		// the sidebar subscribes to pages, so a Yjs snapshot in that row would go to every open tab.
		id: BODIES,
		name: "Page bodies",
		permissions: [],
		rowSecurity: true,
		columns: [
			workspaceId(),
			pageId(),
			longtext("snapshot"),
			text("stateVector"),
			when("snapshotAt"),
			longtext("text"),
		],
		indexes: [
			{ key: "page", type: "unique", attributes: ["pageId"] },
			{ key: "text_search", type: "fulltext", attributes: ["text"] },
			{ key: "workspace", type: "key", attributes: ["workspaceId"] },
		],
	},
	{
		id: UPDATES,
		name: "Page updates",
		permissions: CREATE_SIGNED_IN,
		rowSecurity: true,
		columns: [
			workspaceId(),
			pageId(),
			mediumtext("data"),
			varchar("clientId", 36),
			varchar("cursor", 1024),
			varchar("createdBy", 36),
		],
		indexes: [
			{ key: "page", type: "key", attributes: ["pageId"] },
			{
				key: "page_created",
				type: "key",
				attributes: ["pageId", "$createdAt"],
			},
		],
	},
	{
		id: VERSIONS,
		name: "Page history",
		permissions: [],
		rowSecurity: true,
		columns: [
			workspaceId(),
			pageId(),
			longtext("snapshot"),
			varchar("title", 512),
			text("summary"),
			enumOf("kind", ["auto", "manual", "restored"], "auto"),
			varchar("createdBy", 36),
		],
		indexes: [
			{
				key: "page_created",
				type: "key",
				attributes: ["pageId", "$createdAt"],
				orders: ["ASC", "DESC"],
			},
		],
	},
	{
		id: PROPERTIES,
		name: "Database properties",
		permissions: [],
		rowSecurity: true,
		columns: [
			workspaceId(),
			varchar("databaseId", 36, true),
			varchar("name", 128, true),
			varchar("type", 32, true),
			mediumtext("options"),
			position(),
			flag("hidden"),
		],
		indexes: [{ key: "database", type: "key", attributes: ["databaseId"] }],
	},
	{
		id: VIEWS,
		name: "Database views",
		permissions: [],
		rowSecurity: true,
		columns: [
			workspaceId(),
			varchar("databaseId", 36, true),
			varchar("name", 128, true),
			varchar("type", 32, true),
			mediumtext("config"),
			position(),
		],
		indexes: [{ key: "database", type: "key", attributes: ["databaseId"] }],
	},
	{
		// One row per cell with a deterministic id (see cellRowId in lib/permissions), so two people
		// editing different cells of the same row never overwrite each other.
		id: CELLS,
		name: "Database cells",
		permissions: CREATE_SIGNED_IN,
		rowSecurity: true,
		columns: [
			workspaceId(),
			varchar("databaseId", 36, true),
			pageId(),
			varchar("propertyId", 36, true),
			text("value"),
			varchar("updatedBy", 36),
		],
		indexes: [
			{ key: "database", type: "key", attributes: ["databaseId"] },
			{ key: "page", type: "key", attributes: ["pageId"] },
			{ key: "property", type: "key", attributes: ["propertyId"] },
		],
	},
	{
		id: COMMENTS,
		name: "Comments",
		permissions: [],
		rowSecurity: true,
		columns: [
			workspaceId(),
			pageId(),
			varchar("threadId", 36),
			text("body"),
			text("anchor"),
			when("resolvedAt"),
			when("editedAt"),
			when("deletedAt"),
			varchar("createdBy", 36),
			{
				key: "mentions",
				type: "varchar",
				size: 36,
				required: false,
				array: true,
			},
		],
		indexes: [
			{
				key: "page_created",
				type: "key",
				attributes: ["pageId", "$createdAt"],
				orders: ["ASC", "DESC"],
			},
			{
				key: "workspace_created",
				type: "key",
				attributes: ["workspaceId", "$createdAt"],
				orders: ["ASC", "DESC"],
			},
			{ key: "thread", type: "key", attributes: ["threadId"] },
		],
	},
	{
		// Written with the site key, because a person can't grant another person read access directly.
		id: NOTIFICATIONS,
		name: "Notifications",
		permissions: [],
		rowSecurity: true,
		columns: [
			varchar("userId", 36, true),
			workspaceId(),
			varchar("pageId", 36),
			varchar("kind", 32, true),
			varchar("actorId", 36),
			varchar("actorName", 128),
			varchar("title", 512),
			text("body"),
			when("readAt"),
		],
		indexes: [
			{
				key: "user_created",
				type: "key",
				attributes: ["userId", "$createdAt"],
				orders: ["ASC", "DESC"],
			},
			{ key: "user_read", type: "key", attributes: ["userId", "readAt"] },
		],
	},
	{
		id: LINKS,
		name: "Page links",
		permissions: [],
		rowSecurity: true,
		columns: [
			workspaceId(),
			varchar("sourceId", 36, true),
			varchar("targetId", 36, true),
		],
		indexes: [
			{ key: "workspace", type: "key", attributes: ["workspaceId"] },
			{ key: "source", type: "key", attributes: ["sourceId"] },
			{ key: "target", type: "key", attributes: ["targetId"] },
		],
	},
	{
		id: FAVORITES,
		name: "Favorites",
		permissions: [],
		rowSecurity: true,
		columns: [varchar("userId", 36, true), workspaceId(), pageId(), position()],
		indexes: [
			{ key: "user", type: "key", attributes: ["userId", "workspaceId"] },
		],
	},
	{
		id: VISITS,
		name: "Page visits",
		permissions: [],
		rowSecurity: true,
		columns: [
			varchar("userId", 36, true),
			workspaceId(),
			pageId(),
			when("visitedAt"),
		],
		indexes: [
			{
				key: "user_visited",
				type: "key",
				attributes: ["userId", "workspaceId", "visitedAt"],
				orders: ["ASC", "ASC", "DESC"],
			},
		],
	},
	{
		id: ACCESS_REQUESTS,
		name: "Access requests",
		permissions: [],
		rowSecurity: true,
		columns: [
			workspaceId(),
			pageId(),
			varchar("userId", 36, true),
			varchar("userName", 128),
			text("note"),
			enumOf("status", ["pending", "approved", "declined"], "pending"),
			varchar("decidedBy", 36),
		],
		indexes: [
			{ key: "page", type: "key", attributes: ["pageId"] },
			{ key: "workspace", type: "key", attributes: ["workspaceId", "status"] },
		],
	},
	{
		// MCP and agent tokens. Only the site's key touches them, as in Catchall.
		id: TOKENS,
		name: "Agent tokens",
		permissions: [],
		rowSecurity: false,
		columns: [
			varchar("name", 64),
			varchar("hash", 64),
			varchar("prefix", 16),
			varchar("workspaceId", 36),
			varchar("createdBy", 36),
			varchar("createdByName", 128),
			{ key: "expiresAt", type: "datetime", required: true },
			when("lastUsedAt"),
		],
		indexes: [
			{ key: "hash", type: "unique", attributes: ["hash"] },
			{ key: "created_by", type: "key", attributes: ["createdBy"] },
			{ key: "workspace", type: "key", attributes: ["workspaceId"] },
		],
	},
	{
		// How much of the Site's AI key each person and workspace used today. Site key only.
		id: AI_USAGE,
		name: "AI usage",
		permissions: [],
		rowSecurity: false,
		columns: [
			varchar("day", 10),
			{ key: "count", type: "integer", required: false, default: 0 },
		],
		indexes: [],
	},
];
