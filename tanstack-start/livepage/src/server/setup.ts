// Setup: first person through becomes the owner, then a wizard, then a resumable build.
// Runs on the site's own key. Each step is one request (Sites time out at 30 s) and is safe to
// run twice, so refreshing, a second tab or a crash in the middle all pick up where it stopped.
// State lives in the first workspace's team prefs, readable only by its members.

import {
	Account,
	AppwriteException,
	type Compression,
	ID,
	type Models,
	Project,
	Query,
	Sites,
	Storage,
	TablesDB,
	Teams,
} from "node-appwrite";
import { type Block, snapshotFromBlocks } from "#/lib/blocks";
import { contentPermissions, pagePermissions } from "#/lib/permissions";
import type {
	AiState,
	Capabilities,
	FeatureChoice,
	ScopeGroup,
	SetupLogLine,
	SetupStep,
	SetupStepId,
	SetupView,
	Stage,
	StepStatus,
} from "#/lib/setup-types";
import {
	adminClient,
	appwriteEnv,
	consoleUrl,
	errorCode,
	errorMessage,
	errorType,
	guestClient,
	isCloudEndpoint,
	keyScopes,
	sessionClient,
	siteKey,
	siteOrigin,
} from "./appwrite";
import {
	AuthError,
	membershipRoles,
	readSession,
	signIn,
	signOut,
	workspaceRole,
} from "./auth";
import {
	type ApiResult,
	detectCapabilities,
	hostOf,
	probeOrigin,
} from "./capabilities";
import { consentUrl, MCP_SCOPE } from "./consent";
import { applySchema, schemaWork } from "./migrate";
import { privateHostOf } from "./net-guard";
import { provision, provisionSecrets } from "./provision";
import {
	AI_KEY_SECRET,
	ALL_SCOPES,
	BODIES,
	BUCKET_ID,
	DATABASE_ID,
	MAX_FILE_BYTES,
	PAGES,
	SCHEMA_VERSION,
	SECRETS,
	SETTINGS,
	SETTINGS_ROW,
	SETUP_ONLY_SCOPE_NAMES,
	TABLES,
	WORKSPACES,
} from "./schema";
import { readSettings } from "./settings";
import {
	keptScopes,
	listedModels,
	maskKey,
	missingScopeFrom,
	pickModels,
	rangeCeiling,
	vectorsFailed,
	vectorsReady,
} from "./setup-logic";
import { DEFAULT_SECTIONS, rowPermissions } from "./workspaces";

export const FIRST_WORKSPACE = "main";
export const DEFAULT_AI_ENDPOINT = "https://api.openai.com/v1";
const VECTORS_DATABASE = "vectors";
// Two people clicking Retry at once is harmless, but a stale lease from a closed tab must not
// block the next one for long.
const RUNNER_LEASE_MS = 40_000;

type SetupPrefs = {
	stage?: Stage;
	workspaceName?: string;
	signup?: "invite" | "open";
	ai?: AiState | null;
	aiSkipped?: boolean;
	features?: FeatureChoice;
	vectorsName?: string;
	startedAt?: string;
	needsWeb?: boolean;
	webDone?: boolean;
	finishedAt?: string;
	acked?: boolean;
	keptScopes?: number;
	givenBack?: number;
	vectorsStarted?: boolean;
	released?: boolean;
	log?: SetupLogLine[];
	durations?: Partial<Record<SetupStepId, number>>;
	errors?: Partial<Record<SetupStepId, string>>;
	lastAt?: string;
	runner?: { id: string; at: string };
	keyExpired?: boolean;
};

const PRODUCTS: Record<string, string> = {
	teams: "Auth",
	users: "Auth",
	databases: "Databases",
	tables: "Databases",
	rows: "Databases",
	buckets: "Storage",
	files: "Storage",
	sites: "Sites",
	project: "Project",
	platforms: "Project",
	vectorsdb: "VectorsDB",
	embeddings: "VectorsDB",
};

export function groupScopes(scopes: string[]): ScopeGroup[] {
	const groups: ScopeGroup[] = [];
	for (const scope of scopes) {
		const product = PRODUCTS[scope.split(".")[0]] || "Other";
		let group = groups.find((g) => g.product === product);
		if (!group) {
			group = { product, scopes: [] };
			groups.push(group);
		}
		group.scopes.push(scope);
	}
	return groups;
}

function missingScopesView(missing: string[]): SetupView {
	const { endpoint, siteId, siteName } = appwriteEnv();
	return {
		view: "missing-scopes",
		groups: groupScopes(missing),
		missing,
		siteName,
		consoleUrl:
			siteId && isCloudEndpoint(endpoint) ? consoleUrl("/settings") : null,
	};
}

// ---------- prefs ----------

function readPrefs(raw: Models.Preferences): SetupPrefs {
	return ((raw as Record<string, unknown>).setup as SetupPrefs) || {};
}

async function loadPrefs(secret: string): Promise<SetupPrefs> {
	return readPrefs(
		await new Teams(sessionClient(secret)).getPrefs({
			teamId: FIRST_WORKSPACE,
		}),
	);
}

async function savePrefs(secret: string, prefs: SetupPrefs) {
	const log = (prefs.log || []).slice(-40);
	await new Teams(sessionClient(secret)).updatePrefs({
		teamId: FIRST_WORKSPACE,
		prefs: { setup: { ...prefs, log } },
	});
}

function pushLog(prefs: SetupPrefs, text: string) {
	prefs.log = [...(prefs.log || []), { t: new Date().toISOString(), text }];
}

// ---------- who is here ----------

async function ownerSession() {
	const session = await readSession();
	if (session.status !== "ok") return null;
	const role = await workspaceRole(
		sessionClient(session.secret),
		session.viewer.userId,
		FIRST_WORKSPACE,
	);
	return role === "owner"
		? {
				secret: session.secret,
				owner: { name: session.viewer.name, email: session.viewer.email },
				userId: session.viewer.userId,
			}
		: null;
}

async function requireOwner() {
	const owner = await ownerSession();
	if (!owner) throw new AuthError("Only the owner can run setup.", "forbidden");
	return owner;
}

// For the steps that change what setup will build. Once it's finished they are closed.
async function requireOpenSetup() {
	const owner = await requireOwner();
	if (await isComplete())
		throw new AuthError("Setup is already finished.", "forbidden");
	return owner;
}

async function isComplete(): Promise<boolean> {
	try {
		const row = await new TablesDB(adminClient()).getRow({
			databaseId: DATABASE_ID,
			tableId: SETTINGS,
			rowId: SETTINGS_ROW,
		});
		return Boolean(row.setupCompletedAt);
	} catch (err) {
		// A table mid-creation can answer 500. The build carries on, so read that as "not yet".
		if (errorCode(err) === 404 || errorCode(err) >= 500) return false;
		throw err;
	}
}

async function markComplete() {
	const db = new TablesDB(adminClient());
	const row = {
		databaseId: DATABASE_ID,
		tableId: SETTINGS,
		rowId: SETTINGS_ROW,
	};
	const setupCompletedAt = new Date().toISOString();
	try {
		await db.updateRow({
			...row,
			data: { setupCompletedAt, schemaVersion: SCHEMA_VERSION },
		});
	} catch {
		// A build started before this column existed. Finishing setup matters more than recording
		// the version, and the update prompt can catch it up.
		await db.updateRow({ ...row, data: { setupCompletedAt } });
	}
}

// ---------- updating a finished deployment ----------

// What the update needs on the Site's key, beyond what it keeps after setup. Sites scopes
// are here so it can give the rest back when it's done.
const UPDATE_SCOPES = [
	"tables.read",
	"tables.write",
	"sites.read",
	"sites.write",
];

export async function schemaOutdated() {
	const settings = await readSettings().catch(() => null);
	if (!settings) return false;
	return (settings.schemaVersion ?? 1) < SCHEMA_VERSION;
}

async function updateView(): Promise<SetupView> {
	const have = keyScopes();
	const needed = UPDATE_SCOPES.filter((s) => have && !have.includes(s));
	if (needed.length) return missingScopesView(needed);
	const db = new TablesDB(adminClient());
	const work = await schemaWork(db);
	return { view: "update", work };
}

// One call does what fits in a request. The browser repeats it while `view` is still "update".
export async function runSchemaUpdate(): Promise<SetupView> {
	const { secret } = await requireOwner();
	if (!(await schemaOutdated())) return { view: "locked", signedIn: true };
	const db = new TablesDB(adminClient());
	await applySchema(db, Date.now() + 20_000);
	const work = await schemaWork(db);
	if (work.failed.length)
		throw new Error(`Appwrite couldn't add ${work.failed[0]}. Try again.`);
	if (
		work.tables.length ||
		work.columns.length ||
		work.indexes.length ||
		work.building
	)
		return { view: "update", work };
	await new TablesDB(adminClient()).updateRow({
		databaseId: DATABASE_ID,
		tableId: SETTINGS,
		rowId: SETTINGS_ROW,
		data: { schemaVersion: SCHEMA_VERSION },
	});
	await giveScopesBack(secret).catch(() => undefined);
	return { view: "locked", signedIn: true };
}

async function giveScopesBack(secret: string) {
	const { siteId } = appwriteEnv();
	if (!siteId) return;
	const sites = new Sites(adminClient());
	const site = await sites.get({ siteId });
	const prefs = await loadPrefs(secret).catch(() => ({}) as SetupPrefs);
	const kept = keptScopes(site.scopes, Boolean(prefs.features?.vectors));
	if (kept.length === site.scopes.length) return;
	await updateWithMaxTimeout(
		sites,
		{ ...siteParams(site), scopes: kept },
		site.timeout,
	);
}

async function firstWorkspaceExists() {
	try {
		await new Teams(adminClient()).get({ teamId: FIRST_WORKSPACE });
		return true;
	} catch (err) {
		if (errorCode(err) === 404) return false;
		throw err;
	}
}

// ---------- views ----------

export async function getSetupView(): Promise<SetupView> {
	if (!siteKey()) return { view: "no-key" };

	const session = await readSession();
	const signedIn = session.status === "ok";
	const email = session.status === "ok" ? session.viewer.email : null;

	let complete: boolean;
	try {
		complete = await isComplete();
	} catch (err) {
		if (errorType(err) === "general_unauthorized_scope")
			return missingScopesView(ALL_SCOPES);
		throw err;
	}
	if (complete) {
		const owner = await ownerSession().catch(() => null);
		if (owner) {
			if (await schemaOutdated()) return await updateView();
			const prefs = await loadPrefs(owner.secret).catch(() => null);
			if (prefs && !prefs.acked) return await doneView(prefs);
		}
		return { view: "locked", signedIn };
	}

	// Someone else got here first and hasn't finished.
	let workspace: boolean;
	try {
		workspace = await firstWorkspaceExists();
	} catch (err) {
		if (errorType(err) === "general_unauthorized_scope")
			return missingScopesView(ALL_SCOPES);
		throw err;
	}
	const owner = workspace ? await ownerSession().catch(() => null) : null;
	if (workspace && !owner) return { view: "in-progress", signedIn, email };

	const have = keyScopes();
	const missing =
		have === null ? [] : ALL_SCOPES.filter((s) => !have.includes(s));
	if (missing.length) {
		// The last step gave the scopes back but stopped before it saved. Finish it.
		if (owner && missing.every((s) => SETUP_ONLY_SCOPE_NAMES.includes(s))) {
			const prefs = await loadPrefs(owner.secret).catch(() => null);
			if (prefs?.released) {
				await markComplete();
				return await doneView(prefs);
			}
		}
		return missingScopesView(missing);
	}

	if (!workspace) return { view: "claim" };
	if (!owner) return { view: "in-progress", signedIn, email };
	try {
		return await stageView(await loadPrefs(owner.secret), owner.owner);
	} catch (err) {
		if (errorType(err) === "general_unauthorized_scope") {
			const scope = missingScopeFrom(errorMessage(err));
			if (scope) return missingScopesView([scope]);
		}
		throw err;
	}
}

async function doneView(prefs: SetupPrefs): Promise<SetupView> {
	const started = prefs.startedAt ? Date.parse(prefs.startedAt) : Date.now();
	const finished = prefs.finishedAt ? Date.parse(prefs.finishedAt) : Date.now();
	let vectorsPending = false;
	let vectorsDown = false;
	if (prefs.features?.vectors) {
		const db = await vectorsDatabase().catch(() => null);
		vectorsDown = db?.status === 200 && vectorsFailed(db.json);
		vectorsPending =
			db?.status === 200 && !vectorsDown && !vectorsReady(db.json);
	}
	return {
		view: "done",
		workspaceId: FIRST_WORKSPACE,
		workspaceName: prefs.workspaceName || "Livepage",
		seconds: Math.max(1, Math.round((finished - started) / 1000)),
		vectorsPending,
		vectorsFailed: vectorsDown,
		givenBack: prefs.givenBack ?? 0,
	};
}

async function stageView(
	prefs: SetupPrefs,
	owner: { name: string; email: string },
): Promise<SetupView> {
	const workspaceName = prefs.workspaceName || "";
	switch (prefs.stage ?? "workspace") {
		case "workspace":
			return {
				view: "workspace",
				owner,
				name: prefs.workspaceName || "",
				signup: prefs.signup ?? "invite",
			};
		case "ai":
			return {
				view: "ai",
				owner,
				workspaceName,
				ai: prefs.ai ?? null,
				skipped: Boolean(prefs.aiSkipped),
				defaultEndpoint: DEFAULT_AI_ENDPOINT,
			};
		case "features": {
			const capabilities = await capabilitiesFor(prefs);
			return {
				view: "features",
				owner,
				workspaceName,
				capabilities,
				choice: prefs.features ?? defaultChoice(capabilities),
			};
		}
		default:
			return buildView(prefs, owner);
	}
}

function defaultChoice(cap: Capabilities): FeatureChoice {
	return {
		vectors: false,
		vectorsSpec:
			cap.vectors.kind === "paid" ? (cap.vectors.specs[0]?.slug ?? null) : null,
		agents: cap.agents.kind === "available",
		twoStep: false,
	};
}

async function capabilitiesFor(prefs: SetupPrefs): Promise<Capabilities> {
	const project = (await new Project(
		adminClient(),
	).get()) as unknown as Parameters<typeof detectCapabilities>[0];
	return detectCapabilities(
		project,
		consentUrl(),
		Boolean(prefs.ai?.supports.embeddings),
	);
}

// ---------- claiming the owner role ----------

export type ClaimInput = { name: string; email: string; password: string };

export function validateClaim(input: ClaimInput) {
	const name = String(input.name || "").trim();
	const email = String(input.email || "")
		.trim()
		.toLowerCase();
	const password = String(input.password || "");
	if (!name) throw new Error("Enter your name.");
	if (name.length > 128)
		throw new Error("Use a name of 128 characters or fewer.");
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
		throw new Error("Enter a valid email address.");
	if (password.length < 12)
		throw new Error("Use a password of at least 12 characters.");
	if (password.length > 256)
		throw new Error("Use a password of 256 characters or fewer.");
	return { name, email, password };
}

export async function claimOwner(input: ClaimInput): Promise<SetupView> {
	const current = await getSetupView();
	if (current.view !== "claim") return current;
	const { name, email, password } = validateClaim(input);
	const started = Date.now();

	// No key: Appwrite's own sign-up and sign-in limits apply.
	try {
		await new Account(guestClient()).create({
			userId: ID.unique(),
			email,
			password,
			name,
		});
	} catch (err) {
		if (errorCode(err) === 429)
			throw new Error(
				"Too many sign-up attempts from this site. Wait an hour and try again.",
			);
		if (errorType(err) === "password_personal_data")
			throw new Error(
				"Use a password that doesn't include your name or email.",
			);
		// 409 means the account exists already; signing in below proves the password.
		if (errorCode(err) !== 409) throw new Error(errorMessage(err));
	}

	let secret: string;
	try {
		secret = await signIn(email, password);
	} catch (err) {
		if (errorCode(err) === 401)
			throw new Error(
				"An account with this email already exists in this project, and the password doesn't match it.",
			);
		if (errorCode(err) === 429)
			throw new Error(
				"Too many sign-in attempts for this email. Wait an hour and try again.",
			);
		throw new Error(errorMessage(err));
	}

	// The ID is fixed, so only one person can create this team: whoever does is the owner.
	try {
		await new Teams(sessionClient(secret)).create({
			teamId: FIRST_WORKSPACE,
			name: "Livepage",
			roles: membershipRoles("owner"),
		});
	} catch (err) {
		if (errorCode(err) === 409) {
			await signOut();
			return { view: "in-progress", signedIn: false, email: null };
		}
		throw err;
	}

	const prefs: SetupPrefs = {
		stage: "workspace",
		durations: { team: Date.now() - started },
		log: [{ t: new Date().toISOString(), text: `owner ${email}` }],
		lastAt: new Date().toISOString(),
	};
	await savePrefs(secret, prefs);
	return stageView(prefs, { name, email });
}

// ---------- the wizard ----------

export async function saveWorkspace(input: {
	name: string;
	signup: "invite" | "open";
}): Promise<SetupView> {
	const { secret, owner } = await requireOpenSetup();
	const prefs = await loadPrefs(secret);
	const name = String(input.name || "").trim();
	if (!name) throw new Error("Give the workspace a name.");
	if (name.length > 128)
		throw new Error("Use a name of 128 characters or fewer.");
	if (name !== prefs.workspaceName)
		await new Teams(sessionClient(secret)).updateName({
			teamId: FIRST_WORKSPACE,
			name,
		});
	const next: SetupPrefs = {
		...prefs,
		workspaceName: name,
		signup: input.signup === "open" ? "open" : "invite",
		stage: "ai",
	};
	await savePrefs(secret, next);
	return stageView(next, owner);
}

export async function goToStage(stage: Stage): Promise<SetupView> {
	const { secret, owner } = await requireOpenSetup();
	const prefs = await loadPrefs(secret);
	// The build can't be undone, so the wizard is only re-enterable before it starts.
	if (prefs.stage === "build" || stage === "build")
		return stageView(prefs, owner);
	const next = { ...prefs, stage };
	await savePrefs(secret, next);
	return stageView(next, owner);
}

export type VerifyAiInput = {
	key: string;
	endpoint: string;
	textModel: string;
	imageModel: string;
	embeddingModel: string;
};

export type VerifyAiResult =
	| { ok: true; view: SetupView }
	| {
			ok: false;
			kind: "rejected" | "unreachable" | "forbidden";
			message: string;
	  };

function normalizeEndpoint(raw: string) {
	const value = String(raw || DEFAULT_AI_ENDPOINT)
		.trim()
		.replace(/\/+$/, "");
	if (!/^https?:\/\//i.test(value)) return null;
	try {
		new URL(value);
	} catch {
		return null;
	}
	return value;
}

export async function verifyAi(input: VerifyAiInput): Promise<VerifyAiResult> {
	const { secret, owner } = await requireOpenSetup();
	const key = String(input.key || "").trim();
	const endpoint = normalizeEndpoint(input.endpoint);
	if (!endpoint)
		return {
			ok: false,
			kind: "unreachable",
			message: "Enter an endpoint URL that starts with http:// or https://.",
		};
	if (!key)
		return { ok: false, kind: "rejected", message: "Paste an API key first." };

	const isDefault = endpoint === DEFAULT_AI_ENDPOINT;
	const provider = isDefault ? "OpenAI" : "This provider";

	let res: Response;
	try {
		res = await fetch(`${endpoint}/models`, {
			headers: { authorization: `Bearer ${key}`, accept: "application/json" },
			redirect: "error",
			signal: AbortSignal.timeout(12_000),
		});
	} catch {
		return {
			ok: false,
			kind: "unreachable",
			message: `Couldn't reach ${hostOf(endpoint)}. Check the endpoint URL and that this server can reach it.`,
		};
	}

	if (res.status === 401 || res.status === 403)
		return {
			ok: false,
			kind: "rejected",
			message: isDefault
				? "OpenAI didn't accept this key. It may be revoked or mistyped. Create a new one in your OpenAI dashboard and paste it here."
				: `${provider} didn't accept this key. It may be revoked or mistyped.`,
		};
	if (res.status === 429)
		return {
			ok: false,
			kind: "unreachable",
			message: `${provider} is rate limiting requests right now. Wait a moment and try again.`,
		};
	const models = listedModels(await res.json().catch(() => null));
	if (!res.ok || !models)
		return {
			ok: false,
			kind: "unreachable",
			message: `${hostOf(endpoint)} doesn't look like an OpenAI-compatible API (GET /models answered ${res.status}).`,
		};

	const picked = pickModels(models, {
		textModel: input.textModel.trim(),
		imageModel: input.imageModel.trim(),
		embeddingModel: input.embeddingModel.trim(),
	});
	if (!picked.textModel)
		return {
			ok: false,
			kind: "unreachable",
			message: `${provider} doesn't list a text model. Choose one under Advanced, or use another provider.`,
		};

	// The key goes straight into the secrets table. It is never sent back to any browser.
	if (!(await provisionSecrets(adminClient())))
		return {
			ok: false,
			kind: "unreachable",
			message: "Still preparing storage for your key. Try again in a moment.",
		};
	await new TablesDB(adminClient()).upsertRow({
		databaseId: DATABASE_ID,
		tableId: SECRETS,
		rowId: AI_KEY_SECRET,
		data: { value: key },
	});

	const notes: string[] = [];
	if (!picked.imageModel)
		notes.push("No image model found, so image generation stays off.");
	if (!picked.embeddingModel)
		notes.push(
			"No embedding model found. Search by meaning needs one, unless Appwrite provides it.",
		);

	const ai: AiState = {
		verified: true,
		masked: maskKey(key),
		endpoint,
		defaultEndpoint: isDefault,
		textModel: picked.textModel,
		imageModel: picked.imageModel,
		embeddingModel: picked.embeddingModel,
		supports: {
			text: Boolean(picked.textModel),
			images: Boolean(picked.imageModel),
			embeddings: Boolean(picked.embeddingModel),
		},
		notes,
	};
	const prefs = await loadPrefs(secret);
	const next: SetupPrefs = { ...prefs, ai, aiSkipped: false };
	pushLog(
		next,
		`AI provider ${hostOf(endpoint)} verified, ${models.length} models`,
	);
	await savePrefs(secret, next);
	return { ok: true, view: await stageView(next, owner) };
}

export async function continueFromAi(): Promise<SetupView> {
	const { secret, owner } = await requireOpenSetup();
	const prefs = await loadPrefs(secret);
	const next = { ...prefs, stage: "features" as Stage };
	await savePrefs(secret, next);
	return stageView(next, owner);
}

export async function skipAi(): Promise<SetupView> {
	const { secret, owner } = await requireOpenSetup();
	const prefs = await loadPrefs(secret);
	if (prefs.ai) {
		await new TablesDB(adminClient())
			.deleteRow({
				databaseId: DATABASE_ID,
				tableId: SECRETS,
				rowId: AI_KEY_SECRET,
			})
			.catch(() => undefined);
	}
	const next: SetupPrefs = {
		...prefs,
		ai: null,
		aiSkipped: true,
		stage: "features",
	};
	await savePrefs(secret, next);
	return stageView(next, owner);
}

export async function saveFeatures(choice: FeatureChoice): Promise<SetupView> {
	const { secret, owner } = await requireOpenSetup();
	const prefs = await loadPrefs(secret);
	const cap = await capabilitiesFor(prefs);
	const paidSpec =
		cap.vectors.kind === "paid"
			? cap.vectors.specs.find((s) => s.slug === choice.vectorsSpec)
			: undefined;
	const vectorsOffered =
		cap.embeddings !== "none" &&
		(cap.vectors.kind === "self-on" ||
			(cap.vectors.kind === "paid" && Boolean(paidSpec)));
	const features: FeatureChoice = {
		vectors: Boolean(choice.vectors) && vectorsOffered,
		vectorsSpec: paidSpec?.slug ?? null,
		agents: Boolean(choice.agents) && cap.agents.kind === "available",
		twoStep: Boolean(choice.twoStep),
	};
	const needsWeb = (await probeOrigin()) === "blocked";
	const next: SetupPrefs = {
		...prefs,
		features,
		vectorsName: paidSpec?.name,
		needsWeb,
		stage: "build",
		startedAt: prefs.startedAt ?? new Date().toISOString(),
	};
	if (features.vectors)
		pushLog(
			next,
			paidSpec
				? `search by meaning on, plan ${paidSpec.name} at $${paidSpec.price}/mo`
				: "search by meaning on (self-hosted VectorsDB)",
		);
	await savePrefs(secret, next);
	return stageView(next, owner);
}

// ---------- the build ----------

// Only tells people about AI when this site has it.
const starterPages = (
	hasAi: boolean,
): { id: string; title: string; blocks: Block[] }[] => [
	{
		id: "getting-started",
		title: "Getting started",
		blocks: [
			{
				type: "paragraph",
				content: [
					{
						text: hasAi
							? "Type / for blocks, or press Space on an empty line to ask AI."
							: "Type / for blocks.",
					},
				],
			},
			{
				type: "taskList",
				items: [
					{
						checked: false,
						content: [{ text: "Invite someone and watch their cursor" }],
					},
					{
						checked: false,
						content: [{ text: "Type /database to add a table to a page" }],
					},
					...(hasAi
						? [
								{
									checked: false,
									content: [{ text: "Ask AI what's on this page" }],
								},
							]
						: []),
				],
			},
		],
	},
	{ id: "team-wiki", title: "Team wiki", blocks: [] },
	{ id: "projects", title: "Projects", blocks: [] },
];
const STARTER_PAGES = starterPages(false);

// Labels from the boards, in the order they run.
function planSteps(prefs: SetupPrefs): { id: SetupStepId; label: string }[] {
	const steps: { id: SetupStepId; label: string }[] = [
		{ id: "team", label: "Owner account and team" },
		{ id: "database", label: `Database and ${TABLES.length} tables` },
		{ id: "bucket", label: "Storage for files and covers" },
		{ id: "search", label: "Search index for AI answers" },
	];
	if (prefs.features?.vectors) {
		const name = prefs.vectorsName ? `, ${prefs.vectorsName}` : "";
		steps.push({ id: "vectors", label: `Vector database${name}` });
	}
	if (prefs.needsWeb) steps.push({ id: "web", label: "Browser access" });
	if (prefs.ai) {
		steps.push({
			id: "secret",
			label: prefs.ai.defaultEndpoint
				? "Saving your OpenAI key as a secret"
				: "Saving your AI key as a secret",
		});
	}
	steps.push({ id: "pages", label: "Writing your first pages" });
	if (prefs.features?.agents)
		steps.push({ id: "agents", label: "Turning on agent sign-in" });
	steps.push({ id: "release", label: "Removing setup permissions" });
	return steps;
}

async function exists(probe: () => Promise<unknown>) {
	try {
		await probe();
		return true;
	} catch (err) {
		if (errorCode(err) === 404) return false;
		throw err;
	}
}

async function ignoreConflict(action: () => Promise<unknown>) {
	try {
		await action();
	} catch (err) {
		if (errorCode(err) !== 409) throw err;
	}
}

async function vectorsDatabase(): Promise<ApiResult> {
	const { endpoint, projectId } = appwriteEnv();
	const res = await fetch(`${endpoint}/vectorsdb/${VECTORS_DATABASE}`, {
		headers: {
			"x-appwrite-project": projectId,
			"x-appwrite-key": siteKey() ?? "",
		},
		signal: AbortSignal.timeout(10_000),
	});
	const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	return { status: res.status, type: String(json.type ?? ""), json };
}

type Probe = { status: StepStatus; detail?: string; error?: string };

async function probeSteps(prefs: SetupPrefs): Promise<SetupStep[]> {
	const client = adminClient();
	const db = new TablesDB(client);
	const plan = planSteps(prefs);
	const states: Record<string, Probe> = {
		team: { status: "done", detail: FIRST_WORKSPACE },
	};

	// Database and tables.
	const database = await exists(() => db.get({ databaseId: DATABASE_ID }));
	let tables: Models.Table[] = [];
	if (database) {
		try {
			const list = await db.listTables({
				databaseId: DATABASE_ID,
				queries: [Query.limit(100)],
			});
			tables = list.tables;
		} catch (err) {
			if (errorCode(err) < 500) throw err;
		}
	}
	const byId = new Map(tables.map((t) => [t.$id, t]));
	const missingTables = TABLES.filter((t) => !byId.has(t.id));
	// A table shows up in the list before createTable has written its columns. While a step is
	// running, a table with missing columns is one being built, not a broken one.
	const building =
		prefs.runner !== undefined &&
		Date.now() - Date.parse(prefs.runner.at) < RUNNER_LEASE_MS;
	const missingColumns: string[] = [];
	// Appwrite builds these in the background. Not done, but nothing's wrong either: the database
	// step carries on with them, or the other tab already is.
	let columnsBuilding = false;
	let columnFailed: string | null = null;
	for (const spec of TABLES) {
		const table = byId.get(spec.id);
		if (!table) continue;
		const columns = table.columns as {
			key: string;
			status?: string;
			error?: string;
		}[];
		const byKey = new Map(columns.map((c) => [c.key, c]));
		for (const column of spec.columns) {
			const found = byKey.get(column.key);
			if (!found) {
				// Secrets gets its encrypted value column in a step of its own, so it can lag the table.
				if (spec.id === SECRETS || building) columnsBuilding = true;
				else missingColumns.push(`${spec.id}.${column.key}`);
			} else if (found.status === "failed" || found.status === "stuck") {
				columnFailed = found.error || `${spec.id}.${column.key} didn't build.`;
			} else if (found.status && found.status !== "available") {
				columnsBuilding = true;
			}
		}
	}
	if (missingColumns.length)
		states.database = {
			status: "failed",
			error: `These columns are missing: ${missingColumns.join(", ")}. Delete the "${DATABASE_ID}" database in the Console and retry.`,
		};
	else if (columnFailed)
		states.database = {
			status: "failed",
			error: `Appwrite couldn't build a column: ${columnFailed} Retry to build it again.`,
		};
	else if (columnsBuilding)
		states.database = { status: "pending", detail: "Building columns" };
	else if (database && missingTables.length === 0)
		states.database = { status: "done", detail: `${TABLES.length} tables` };
	else
		states.database = {
			status: "pending",
			detail: `${TABLES.length - missingTables.length} of ${TABLES.length} tables`,
		};

	// Bucket.
	states.bucket = (await exists(() =>
		new Storage(client).getBucket({ bucketId: BUCKET_ID }),
	))
		? { status: "done", detail: BUCKET_ID }
		: { status: "pending" };

	// The full-text indexes the keyword search and AI answers need.
	const pagesTable = byId.get(PAGES);
	const bodiesTable = byId.get(BODIES);
	const indexesReady = (t: Models.Table | undefined) =>
		Boolean(t) &&
		(t?.indexes as { status?: string }[]).every(
			(i) => !i.status || i.status === "available",
		);
	states.search =
		pagesTable && bodiesTable
			? indexesReady(pagesTable) && indexesReady(bodiesTable)
				? { status: "done", detail: "keyword" }
				: { status: "pending", detail: "indexing" }
			: { status: "pending" };

	// Vector database.
	if (prefs.features?.vectors) {
		let vectors = { status: 0, type: "", json: {} } as ApiResult;
		try {
			vectors = await vectorsDatabase();
		} catch {
			vectors.status = 0;
		}
		if (vectors.status === 200 && vectorsFailed(vectors.json))
			states.vectors = {
				status: "failed",
				error:
					"The vector database didn't start. Retry, or continue without search by meaning.",
			};
		else if (vectors.status === 200)
			states.vectors = vectorsReady(vectors.json)
				? { status: "done", detail: "ready" }
				: { status: "done", detail: "Starting" };
		else states.vectors = { status: "pending" };
	}

	// Saved AI key.
	if (prefs.ai) {
		let saved = false;
		try {
			await db.getRow({
				databaseId: DATABASE_ID,
				tableId: SECRETS,
				rowId: AI_KEY_SECRET,
			});
			saved = true;
		} catch (err) {
			if (errorCode(err) !== 404) throw err;
		}
		const settings = await getSettings(db);
		states.secret =
			saved && settings?.aiEnabled
				? { status: "done", detail: hostOf(prefs.ai.endpoint) }
				: {
						status: saved ? "pending" : "failed",
						error: saved
							? undefined
							: "The AI key is no longer saved. Go back to the AI step and enter it again.",
					};
	}

	// First pages.
	states.pages = (await firstPagesWritten(db))
		? { status: "done", detail: `${STARTER_PAGES.length} pages` }
		: { status: "pending" };

	// Agent sign-in.
	if (prefs.features?.agents) {
		const project = (await new Project(client).get()) as Models.Project;
		const ours = consentUrl();
		states.agents =
			project.oAuth2ServerEnabled &&
			project.oAuth2ServerAuthorizationUrl === ours
				? { status: "done", detail: `${hostOf(ours)}/consent` }
				: { status: "pending" };
	}

	if (prefs.needsWeb) {
		states.web = prefs.webDone
			? { status: "done", detail: hostOf(siteOrigin()) }
			: { status: "pending" };
	}

	states.release = { status: "pending" };

	return plan.map(({ id, label }) => {
		const probe = states[id] ?? { status: "pending" as StepStatus };
		const step: SetupStep = { id, label, ...probe };
		const saved = prefs.errors?.[id];
		if (step.status === "pending" && saved) {
			step.status = "failed";
			step.error = saved;
		}
		if (id === "vectors" && step.status === "failed") step.optional = true;
		const duration = prefs.durations?.[id];
		if (step.status === "done" && duration !== undefined)
			step.durationMs = duration;
		return step;
	});
}

async function getSettings(db: TablesDB) {
	try {
		return await db.getRow<Models.Row & Record<string, unknown>>({
			databaseId: DATABASE_ID,
			tableId: SETTINGS,
			rowId: SETTINGS_ROW,
		});
	} catch (err) {
		if (errorCode(err) === 404 || errorCode(err) >= 500) return null;
		throw err;
	}
}

async function firstPagesWritten(db: TablesDB) {
	const checks = await Promise.all(
		[
			exists(() =>
				db.getRow({
					databaseId: DATABASE_ID,
					tableId: WORKSPACES,
					rowId: FIRST_WORKSPACE,
				}),
			),
			...STARTER_PAGES.map((page) =>
				exists(() =>
					db.getRow({
						databaseId: DATABASE_ID,
						tableId: PAGES,
						rowId: page.id,
					}),
				),
			),
		].map((p) => p.catch(() => false)),
	);
	return checks.every(Boolean);
}

async function buildView(
	prefs: SetupPrefs,
	owner: { name: string; email: string },
	busy = false,
): Promise<SetupView> {
	const steps = await probeSteps(prefs);
	const vectorsPending = steps.some(
		(s) => s.id === "vectors" && s.detail === "Starting",
	);
	return {
		view: "build",
		owner,
		workspaceName: prefs.workspaceName || "Livepage",
		steps,
		log: prefs.log || [],
		watching: busy,
		keyExpired: Boolean(prefs.keyExpired),
		vectorsPending,
	};
}

// ---------- step runners ----------

type RunContext = {
	secret: string;
	prefs: SetupPrefs;
	userId: string;
};

type RunResult = { status: StepStatus; log?: string; durationMs?: number };

const RUNNERS: Record<SetupStepId, (ctx: RunContext) => Promise<RunResult>> = {
	async team() {
		return { status: "done" };
	},

	async database() {
		const result = await provision(adminClient(), {
			deadline: Date.now() + 18_000,
			bucket: false,
		});
		return {
			status: result.partial ? "running" : "done",
			log: result.createdTables.length
				? `tables ${result.createdTables.join(", ")}`
				: undefined,
		};
	},

	async bucket() {
		await ignoreConflict(() =>
			new Storage(adminClient()).createBucket({
				bucketId: BUCKET_ID,
				name: "Files",
				// No create for signed-in people: every upload goes through the site, which
				// sets the file's permissions (see fileOwnedBy in server/files.ts).
				permissions: [],
				fileSecurity: true,
				enabled: true,
				maximumFileSize: MAX_FILE_BYTES,
				compression: "none" as Compression,
				encryption: true,
				antivirus: true,
			}),
		);
		return {
			status: "done",
			log: `bucket ${BUCKET_ID}, ${MAX_FILE_BYTES / 1_048_576} MB limit`,
		};
	},

	async search() {
		const db = new TablesDB(adminClient());
		for (const tableId of [PAGES, BODIES]) {
			const table = await db.getTable({ databaseId: DATABASE_ID, tableId });
			const pending = (table.indexes as { status?: string }[]).some(
				(i) => i.status && i.status !== "available",
			);
			if (pending) return { status: "running" };
		}
		return { status: "done", log: "keyword search indexes ready" };
	},

	async vectors({ prefs }) {
		const { endpoint, projectId } = appwriteEnv();
		// A database that failed to start would answer 409 forever, so clear it before trying again.
		const existing = await vectorsDatabase().catch(() => null);
		if (existing?.status === 200 && vectorsFailed(existing.json))
			await fetch(`${endpoint}/vectorsdb/${VECTORS_DATABASE}`, {
				method: "DELETE",
				headers: {
					"x-appwrite-project": projectId,
					"x-appwrite-key": siteKey() ?? "",
				},
				signal: AbortSignal.timeout(20_000),
			});
		const body: Record<string, unknown> = {
			databaseId: VECTORS_DATABASE,
			name: "Livepage search",
		};
		if (prefs.features?.vectorsSpec)
			body.specification = prefs.features.vectorsSpec;
		const res = await fetch(`${endpoint}/vectorsdb`, {
			method: "POST",
			headers: {
				"x-appwrite-project": projectId,
				"x-appwrite-key": siteKey() ?? "",
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(25_000),
		});
		if (res.status === 409)
			return { status: "done", log: "vector database already exists" };
		if (res.status === 201 || res.status === 200)
			return { status: "done", log: "vector database starting" };
		const json = (await res.json().catch(() => ({}))) as {
			type?: string;
			message?: string;
		};
		if (json.type === "billing_payment_method_not_found")
			throw new Error(
				"This Appwrite organization has no payment method, so the vector database can't start. Add one in the Appwrite Console, then retry. Or continue without search by meaning.",
			);
		throw new Error(json.message || `Vector database failed (${res.status}).`);
	},

	async web() {
		if ((await probeOrigin()) === "allowed")
			return { status: "done", log: "browser origin already allowed" };
		const hostname = hostOf(siteOrigin()).split(":")[0];
		await ignoreConflict(() =>
			new Project(adminClient()).createWebPlatform({
				platformId: "livepage-site",
				name: "Livepage",
				hostname,
			}),
		);
		return { status: "done", log: `web platform ${hostname}` };
	},

	async secret({ prefs }) {
		const ai = prefs.ai;
		if (!ai) return { status: "done" };
		await new TablesDB(adminClient()).updateRow({
			databaseId: DATABASE_ID,
			tableId: SETTINGS,
			rowId: SETTINGS_ROW,
			data: {
				aiEnabled: true,
				aiEndpoint: ai.endpoint,
				aiTextModel: ai.textModel,
				aiImageModel: ai.imageModel,
				aiEmbeddingModel: ai.embeddingModel,
				aiImages: ai.supports.images,
				// The person running setup owns the Site, so an internal provider they chose here is
				// allowed later too. Workspace admins never get that (see server/net-guard.ts).
				aiPrivateHost: await privateHostOf(ai.endpoint),
			},
		});
		return { status: "done", log: `AI key saved (${hostOf(ai.endpoint)})` };
	},

	async pages({ userId, prefs }) {
		const db = new TablesDB(adminClient());
		const name = prefs.workspaceName || "Livepage";
		const features = {
			ownerId: userId,
			requireTwoStep: Boolean(prefs.features?.twoStep),
			vectorsDatabase: prefs.features?.vectors ? VECTORS_DATABASE : null,
		};
		await db.updateRow({
			databaseId: DATABASE_ID,
			tableId: SETTINGS,
			rowId: SETTINGS_ROW,
			data: {
				signup: prefs.signup ?? "invite",
				siteOrigin: siteOrigin(),
				features: JSON.stringify(features),
				vectors: Boolean(prefs.features?.vectors),
				vectorsSpecification: prefs.features?.vectorsSpec ?? null,
				agents: Boolean(prefs.features?.agents),
			},
		});

		await ignoreConflict(() =>
			db.createRow<Models.DefaultRow>({
				databaseId: DATABASE_ID,
				tableId: WORKSPACES,
				rowId: FIRST_WORKSPACE,
				data: {
					name,
					icon: null,
					sections: JSON.stringify(DEFAULT_SECTIONS),
					createdBy: userId,
				},
				permissions: rowPermissions(FIRST_WORKSPACE),
			}),
		);

		const access = {
			workspaceId: FIRST_WORKSPACE,
			visibility: "workspace" as const,
			createdBy: userId,
			shares: [],
		};
		for (const [index, page] of starterPages(Boolean(prefs.ai)).entries()) {
			await ignoreConflict(() =>
				db.createRow<Models.DefaultRow>({
					databaseId: DATABASE_ID,
					tableId: PAGES,
					rowId: page.id,
					data: {
						workspaceId: FIRST_WORKSPACE,
						parentId: null,
						sectionId: "general",
						kind: "page",
						title: page.title,
						icon: null,
						coverFileId: null,
						position: index + 1,
						databaseId: null,
						visibility: "workspace",
						shares: null,
						publishedSlug: null,
						trashedAt: null,
						createdBy: userId,
						updatedBy: userId,
					},
					permissions: pagePermissions(access),
				}),
			);
			const body = snapshotFromBlocks(page.id, page.title, page.blocks);
			await ignoreConflict(() =>
				db.createRow<Models.DefaultRow>({
					databaseId: DATABASE_ID,
					tableId: BODIES,
					rowId: page.id,
					data: {
						workspaceId: FIRST_WORKSPACE,
						pageId: page.id,
						snapshot: body.snapshot,
						stateVector: body.stateVector,
						snapshotAt: new Date().toISOString(),
						text: body.text || null,
					},
					permissions: contentPermissions(access),
				}),
			);
		}
		return {
			status: "done",
			log: `workspace "${name}" with ${STARTER_PAGES.length} pages`,
		};
	},

	async agents() {
		const project = new Project(adminClient());
		const current = await project.get();
		const ours = consentUrl();
		const theirs = current.oAuth2ServerAuthorizationUrl || "";
		// Another app already uses this project's OAuth server. Taking it over would break that app.
		if (current.oAuth2ServerEnabled && theirs && theirs !== ours)
			return {
				status: "done",
				log: `OAuth server already used by ${hostOf(theirs)}, left as it is`,
			};
		const scopes = (current.oAuth2ServerScopes ?? []).filter(
			(s) => !BUILT_IN_SCOPES.includes(s),
		);
		if (
			!current.oAuth2ServerEnabled ||
			theirs !== ours ||
			!scopes.includes(MCP_SCOPE)
		) {
			// The update replaces the whole OAuth server configuration, so every current value goes
			// back with the three that change.
			await project.updateOAuth2Server({
				enabled: true,
				authorizationUrl: ours,
				scopes: [...new Set([...scopes, MCP_SCOPE])],
				authorizationDetailsTypes:
					current.oAuth2ServerAuthorizationDetailsTypes ?? [],
				accessTokenDuration: current.oAuth2ServerAccessTokenDuration ?? null,
				refreshTokenDuration: current.oAuth2ServerRefreshTokenDuration ?? null,
				publicAccessTokenDuration:
					current.oAuth2ServerPublicAccessTokenDuration ?? null,
				publicRefreshTokenDuration:
					current.oAuth2ServerPublicRefreshTokenDuration ?? null,
				installationAccessTokenDuration:
					current.oAuth2ServerInstallationAccessTokenDuration ?? null,
				confidentialPkce: current.oAuth2ServerConfidentialPkce ?? null,
				verificationUrl: current.oAuth2ServerVerificationUrl || undefined,
				userCodeLength: current.oAuth2ServerUserCodeLength ?? null,
				userCodeFormat: current.oAuth2ServerUserCodeFormat || undefined,
				deviceCodeDuration: current.oAuth2ServerDeviceCodeDuration ?? null,
				defaultScopes: current.oAuth2ServerDefaultScopes ?? [],
				installationScopes: current.oAuth2ServerInstallationScopes ?? [],
			});
		}
		return {
			status: "done",
			log: `OAuth server on, consent at ${hostOf(ours)}/consent`,
		};
	},

	async release({ prefs }) {
		const { siteId } = appwriteEnv();
		if (!siteId)
			return { status: "done", log: "no site ID, scopes left as they are" };
		const sites = new Sites(adminClient());
		const site = await sites.get({ siteId });
		const kept = keptScopes(site.scopes, Boolean(prefs.features?.vectors));
		const update = { ...siteParams(site), scopes: kept };
		const timeout = await updateWithMaxTimeout(sites, update, site.timeout);
		prefs.keptScopes = kept.length;
		prefs.givenBack = site.scopes.length - kept.length;
		return {
			status: "done",
			log: `site ${site.name}: ${site.scopes.length} scopes kept ${kept.length}, timeout ${timeout} s`,
		};
	},
};

const BUILT_IN_SCOPES = ["openid", "profile", "email", "phone"];

// sites.update replaces the whole site, so every current value goes back with the change.
function siteParams(site: Models.Site): Record<string, unknown> {
	const params: Record<string, unknown> = {
		siteId: site.$id,
		name: site.name,
		framework: site.framework,
		enabled: site.enabled,
		logging: site.logging,
		timeout: site.timeout,
		installCommand: site.installCommand,
		buildCommand: site.buildCommand,
		startCommand: site.startCommand,
		outputDirectory: site.outputDirectory,
		buildRuntime: site.buildRuntime,
		adapter: site.adapter,
		fallbackFile: site.fallbackFile,
		installationId: site.installationId,
		providerRepositoryId: site.providerRepositoryId,
		providerBranch: site.providerBranch,
		providerSilentMode: site.providerSilentMode,
		providerRootDirectory: site.providerRootDirectory,
		buildSpecification: site.buildSpecification,
		runtimeSpecification: site.runtimeSpecification,
		deploymentRetention: site.deploymentRetention,
		scopes: site.scopes,
		description: site.description,
	};
	if (site.providerBranches?.length)
		params.providerBranches = site.providerBranches;
	if (site.providerPaths?.length) params.providerPaths = site.providerPaths;
	return params;
}

// Asks for the longest timeout the project allows. Appwrite answers an over-limit value with the
// allowed range, which gives the real ceiling without guessing it from the hostname.
const TIMEOUT_CEILING = 900;

async function updateWithMaxTimeout(
	sites: Sites,
	update: Record<string, unknown>,
	current: number,
) {
	try {
		await sites.update({ ...update, timeout: TIMEOUT_CEILING } as never);
		return TIMEOUT_CEILING;
	} catch (err) {
		// Only a range error means the plan caps it lower. Anything else is a real failure.
		const ceiling = rangeCeiling(errorMessage(err));
		if (ceiling === null) throw err;
		const timeout = Math.max(ceiling, current);
		await sites.update({ ...update, timeout } as never);
		return timeout;
	}
}

// ---------- running one step ----------

export async function runStep(
	stepId: SetupStepId,
	runnerId: string,
): Promise<SetupView> {
	if (!RUNNERS[stepId]) throw new Error("Unknown step.");
	const { secret, owner, userId } = await requireOwner();
	if (await isComplete()) {
		const prefs = await loadPrefs(secret).catch(() => ({}) as SetupPrefs);
		return prefs.acked
			? { view: "locked", signedIn: true }
			: await doneView(prefs);
	}

	const prefs = await loadPrefs(secret);
	const now = new Date();

	// A step is already running in another tab, so this one watches instead of doubling up.
	if (
		prefs.runner &&
		prefs.runner.id !== runnerId &&
		now.getTime() - Date.parse(prefs.runner.at) < RUNNER_LEASE_MS
	)
		return buildView(prefs, owner, true);

	const log = [...(prefs.log || [])];
	if (
		prefs.lastAt &&
		now.getTime() - Date.parse(prefs.lastAt) > 60_000 &&
		log.length
	)
		log.push({
			t: prefs.lastAt,
			text: "paused",
			kind: "pause",
			resumedAt: now.toISOString(),
		});

	const errors = { ...(prefs.errors || {}) };
	delete errors[stepId];
	const base: SetupPrefs = {
		...prefs,
		log,
		errors,
		runner: { id: runnerId, at: now.toISOString() },
		lastAt: now.toISOString(),
	};
	// Before the site gives up its setup scopes, save that this is about to happen. If the request
	// stops right after the update, the next visit knows to finish instead of asking for the scopes.
	if (stepId === "release") base.released = true;
	await savePrefs(secret, base);

	const started = Date.now();
	let result: RunResult;
	try {
		result = await RUNNERS[stepId]({ secret, prefs: base, userId });
	} catch (err) {
		return stepFailed(base, stepId, err, owner, secret);
	}

	if (result.log) pushLog(base, result.log);
	if (result.status === "done")
		base.durations = {
			...(base.durations || {}),
			[stepId]: result.durationMs ?? Date.now() - started,
		};
	if (stepId === "web" && result.status === "done") base.webDone = true;
	base.runner = undefined;
	base.keyExpired = false;

	if (stepId === "release" && result.status === "done") {
		base.finishedAt = new Date().toISOString();
		await savePrefs(secret, base).catch(() => undefined);
		await markComplete();
		return await doneView(base);
	}
	await savePrefs(secret, base).catch(() => undefined);
	return buildView(base, owner);
}

async function stepFailed(
	base: SetupPrefs,
	stepId: SetupStepId,
	err: unknown,
	owner: { name: string; email: string },
	secret: string,
): Promise<SetupView> {
	base.runner = undefined;
	const type = errorType(err);
	const message = errorMessage(err);

	// The site gave its scopes back already, and only the complete flag is left to save.
	if (
		stepId === "release" &&
		base.released &&
		type === "general_unauthorized_scope"
	) {
		base.finishedAt = base.finishedAt ?? new Date().toISOString();
		await markComplete();
		await savePrefs(secret, base).catch(() => undefined);
		return await doneView(base);
	}

	// The site's key lost a scope after setup started. Tell the owner which one.
	if (type === "general_unauthorized_scope") {
		const scope = missingScopeFrom(message);
		await savePrefs(secret, base).catch(() => undefined);
		if (scope) return missingScopesView([scope]);
	}

	// An expired key is not a broken step: the next request brings a fresh one.
	if (type === "project_key_expired") {
		base.keyExpired = true;
		pushLog(base, "site key expired, waiting for a fresh one");
		await savePrefs(secret, base).catch(() => undefined);
		return buildView(base, owner);
	}

	base.errors = {
		...(base.errors || {}),
		[stepId]: friendlyError(stepId, err),
	};
	pushLog(base, `${stepId} failed: ${friendlyError(stepId, err)}`);
	await savePrefs(secret, base).catch(() => undefined);
	return buildView(base, owner);
}

function friendlyError(stepId: SetupStepId, err: unknown): string {
	const message = errorMessage(err);
	const unreachable =
		(err instanceof AppwriteException && err.code === 0) ||
		message.toLowerCase().includes("fetch failed");
	if (unreachable)
		return "Couldn't reach Appwrite. It's usually a brief network problem, so a retry works.";
	switch (stepId) {
		case "database":
			return `Creating the database didn't finish: ${message}`;
		case "bucket":
			return `Creating the storage bucket didn't finish: ${message}`;
		case "pages":
			return `Writing your first pages didn't finish: ${message}`;
		case "agents":
			return `Turning on agent sign-in didn't finish: ${message}`;
		case "release":
			return `Giving back the setup permissions didn't finish: ${message}`;
		default:
			return message;
	}
}

// Turns search by meaning off and continues. Offered only when the vector database can't start.
export async function skipVectors(): Promise<SetupView> {
	const { secret, owner } = await requireOpenSetup();
	const prefs = await loadPrefs(secret);
	const errors = { ...(prefs.errors || {}) };
	delete errors.vectors;
	const next: SetupPrefs = {
		...prefs,
		errors,
		features: prefs.features
			? { ...prefs.features, vectors: false, vectorsSpec: null }
			: prefs.features,
	};
	pushLog(next, "continuing without search by meaning");
	await savePrefs(secret, next);
	return buildView(next, owner);
}

export async function finishSetup(
	inviteEmails: string[],
): Promise<{ failed: string[] }> {
	const { secret } = await requireOwner();
	const prefs = await loadPrefs(secret);
	const failed: string[] = [];
	const teams = new Teams(sessionClient(secret));
	for (const raw of inviteEmails) {
		const email = raw.trim().toLowerCase();
		if (!email) continue;
		try {
			await teams.createMembership({
				teamId: FIRST_WORKSPACE,
				email,
				roles: membershipRoles("member"),
				url: `${siteOrigin()}/accept`,
			});
		} catch (err) {
			if (errorCode(err) !== 409) failed.push(email);
		}
	}
	if (failed.length === 0) await savePrefs(secret, { ...prefs, acked: true });
	return { failed };
}
