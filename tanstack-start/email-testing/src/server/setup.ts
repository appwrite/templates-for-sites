import {
	Account,
	type Compression,
	Functions,
	ID,
	type Models,
	Permission,
	Project,
	type ProjectKeyScopes,
	Query,
	Role,
	Runtime,
	Sites,
	Storage,
	TablesDB,
	Teams,
	TemplateReferenceType,
} from "node-appwrite";
import type {
	ScopeGroup,
	SetupLogLine,
	SetupStep,
	SetupStepId,
	SetupView,
	StepStatus,
} from "#/lib/setup-types";
import { MCP_SCOPE } from "./access-token";
import type { AgentSetup } from "./agents";
import {
	adminClient,
	appwriteEnv,
	consoleUrl,
	errorCode,
	errorMessage,
	guestClient,
	inboxDomain,
	isCloudEndpoint,
	keyScopes,
	sessionClient,
	siteKey,
} from "./appwrite";
import { AuthError, readViewer, signIn, signOut } from "./auth";
import { consentUrl, hostOf, mcpUrl } from "./oauth";
import {
	ALL_SCOPES,
	BUCKET_ID,
	CLEANUP_SCHEDULE,
	DATABASE_ID,
	DEFAULT_RETENTION_DAYS,
	FUNCTION_ID,
	FUNCTION_SCOPES,
	isPlatformScope,
	MAX_ATTACHMENT_BYTES,
	SETTINGS,
	SETTINGS_ROW,
	SETUP_ONLY_SCOPE_NAMES,
	TABLES,
	TEAM_ID,
} from "./schema";

const STEPS: { id: SetupStepId; label: string }[] = [
	{ id: "team", label: "Team with you as admin" },
	{ id: "database", label: "Database" },
	{ id: "tables", label: "Tables" },
	{ id: "bucket", label: "Storage bucket for attachments" },
	{ id: "function", label: "Function that receives mail" },
	{ id: "code", label: "Function code" },
	{ id: "trigger", label: "Email trigger" },
	{ id: "schedule", label: "Nightly cleanup schedule" },
	{ id: "agents", label: "Sign-in for AI agents" },
	{ id: "release", label: "Remove setup permissions" },
];

type SetupPrefs = {
	log?: SetupLogLine[];
	durations?: Partial<Record<SetupStepId, number>>;
	errors?: Partial<Record<SetupStepId, string>>;
	lastAt?: string;
	released?: boolean;
	admin?: { name: string; email: string };
	agents?: AgentSetup;
};

const BUILDING = ["waiting", "processing", "building"];

// The function's code is the node/email-testing-inbox template, deployed from this appwrite/templates release.
const FUNCTION_TEMPLATE_TAG = "1.5.0";

// ---------- small helpers ----------

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

const PRODUCTS: Record<string, string> = {
	teams: "Auth",
	databases: "Databases",
	tables: "Databases",
	rows: "Databases",
	buckets: "Storage",
	files: "Storage",
	functions: "Functions",
	sites: "Sites",
	project: "Project",
};

function groupScopes(scopes: string[]): ScopeGroup[] {
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

function scopeSummary() {
	const have = (keyScopes() ?? ALL_SCOPES).filter((s) => !isPlatformScope(s));
	const givenBack = have.filter((s) => SETUP_ONLY_SCOPE_NAMES.includes(s));
	const kept = have.filter((s) => !SETUP_ONLY_SCOPE_NAMES.includes(s));
	return { before: have.length, after: kept.length, givenBack, kept };
}

function readPrefs(
	team: Models.Team<Models.Preferences> | Models.Preferences,
): SetupPrefs {
	const prefs = ("prefs" in team ? team.prefs : team) as Record<
		string,
		unknown
	>;
	return (prefs?.setup as SetupPrefs) || {};
}

async function loadPrefs(secret: string) {
	const prefs = await new Teams(sessionClient(secret)).getPrefs({
		teamId: TEAM_ID,
	});
	return readPrefs(prefs);
}

async function savePrefs(secret: string, setup: SetupPrefs) {
	// Team prefs hold the setup log, so the admin can close the tab and pick up later.
	const log = (setup.log || []).slice(-60);
	await new Teams(sessionClient(secret)).updatePrefs({
		teamId: TEAM_ID,
		prefs: { setup: { ...setup, log } },
	});
}

// ---------- state ----------

export async function isSetupComplete() {
	try {
		const row = await new TablesDB(adminClient()).getRow({
			databaseId: DATABASE_ID,
			tableId: SETTINGS,
			rowId: SETTINGS_ROW,
		});
		return Boolean(row.setupCompletedAt);
	} catch {
		return false;
	}
}

async function markComplete() {
	const db = new TablesDB(adminClient());
	await db.upsertRow({
		databaseId: DATABASE_ID,
		tableId: SETTINGS,
		rowId: SETTINGS_ROW,
		data: { setupCompletedAt: new Date().toISOString() },
	});
}

function missingScopesView(missing: string[]): SetupView {
	const { siteName } = appwriteEnv();
	return {
		view: "missing-scopes",
		missing: groupScopes(missing),
		missingCount: missing.length,
		total: ALL_SCOPES.length,
		keptCount: ALL_SCOPES.length - SETUP_ONLY_SCOPE_NAMES.length,
		siteName,
		consoleUrl: consoleUrl("/settings"),
	};
}

export async function getSetupView(): Promise<SetupView> {
	const { endpoint } = appwriteEnv();
	// Email triggers only exist on Appwrite Cloud. Stop before creating anything anywhere else.
	if (!isCloudEndpoint(endpoint)) return { view: "not-cloud", endpoint };
	if (!siteKey()) return { view: "no-key" };

	if (await isSetupComplete()) {
		const session = await readViewer();
		return { view: "done", signedIn: session.status === "member" };
	}

	const session = await readViewer();
	const have = keyScopes();
	const missing =
		have === null ? [] : ALL_SCOPES.filter((s) => !have.includes(s));
	if (missing.length) {
		// The last step gave the scopes back but stopped before it saved. Finish it.
		if (
			session.status === "member" &&
			session.viewer.role === "admin" &&
			missing.every((s) => SETUP_ONLY_SCOPE_NAMES.includes(s))
		) {
			const prefs = await loadPrefs(session.secret).catch(
				() => ({}) as SetupPrefs,
			);
			if (prefs.released) {
				await markComplete();
				return { view: "done", signedIn: true };
			}
		}
		return missingScopesView(missing);
	}

	const teams = new Teams(adminClient());
	if (!(await exists(() => teams.get({ teamId: TEAM_ID }))))
		return { view: "claim" };
	if (session.status !== "member" || session.viewer.role !== "admin")
		return { view: "in-progress" };
	return provisionView(session.secret, {
		name: session.viewer.name,
		email: session.viewer.email,
	});
}

async function probeSteps(prefs: SetupPrefs): Promise<SetupStep[]> {
	const client = adminClient();
	const db = new TablesDB(client);
	const storage = new Storage(client);
	const functions = new Functions(client);

	const [database, bucket, fn, project] = await Promise.all([
		exists(() => db.get({ databaseId: DATABASE_ID })),
		exists(() => storage.getBucket({ bucketId: BUCKET_ID })),
		functions.get({ functionId: FUNCTION_ID }).catch((err) => {
			if (errorCode(err) === 404) return null;
			throw err;
		}),
		new Project(client).get(),
	]);
	const agents = agentsStatus(project, prefs.agents);

	const result: Record<
		SetupStepId,
		{ status: StepStatus; detail: string; error?: string }
	> = {
		team: { status: "done", detail: TEAM_ID },
		database: { status: database ? "done" : "pending", detail: DATABASE_ID },
		tables: { status: "pending", detail: `${TABLES.length} tables` },
		bucket: { status: bucket ? "done" : "pending", detail: BUCKET_ID },
		function: { status: fn ? "done" : "pending", detail: FUNCTION_ID },
		code: { status: "pending", detail: "" },
		trigger: {
			status: fn?.emailEnabled ? "done" : "pending",
			detail: `*@${inboxDomain()}`,
		},
		schedule: {
			status: fn?.schedule === CLEANUP_SCHEDULE ? "done" : "pending",
			detail: CLEANUP_SCHEDULE,
		},
		agents: {
			status: agents.done ? "done" : "pending",
			detail: agents.detail,
		},
		release: { status: "pending", detail: "" },
	};

	if (database) {
		const tables = await Promise.all(
			TABLES.map((spec) =>
				db
					.getTable({ databaseId: DATABASE_ID, tableId: spec.id })
					.catch((err) => {
						if (errorCode(err) === 404) return null;
						throw err;
					}),
			),
		);
		const missingColumns: string[] = [];
		TABLES.forEach((spec, i) => {
			const table = tables[i];
			if (!table) return;
			const keys = new Set(
				(table.columns as { key: string }[]).map((c) => c.key),
			);
			for (const column of spec.columns)
				if (!keys.has(column.key))
					missingColumns.push(`${spec.id}.${column.key}`);
		});
		if (tables.every(Boolean) && missingColumns.length === 0)
			result.tables.status = "done";
		if (missingColumns.length) {
			result.tables.status = "failed";
			result.tables.error = `These columns are missing: ${missingColumns.join(", ")}. Delete the "${DATABASE_ID}" database in the Console and retry.`;
		}
	}

	if (fn) {
		const code = await codeStatus(functions, fn);
		result.code = {
			status: code.status,
			detail: code.detail,
			error: code.error,
		};
	}

	const summary = scopeSummary();
	result.release.detail = `${summary.before} → ${summary.after} scopes`;

	return STEPS.map(({ id, label }) => {
		const step: SetupStep = { id, label, ...result[id] };
		const savedError = prefs.errors?.[id];
		if (step.status === "pending" && savedError) {
			step.status = "failed";
			step.error = savedError;
		}
		const duration = prefs.durations?.[id];
		if (step.status === "done" && duration !== undefined)
			step.durationMs = duration;
		if (id === "agents" && step.status !== "done") {
			step.note =
				"Turns on this project's OAuth server and points it at this site's consent screen, so agents like Claude Code, Cursor and Codex can sign in to /mcp.";
		}
		if (id === "agents" && agents.elsewhere) {
			step.note = `This project's OAuth server already sends people to ${hostOf(agents.elsewhere)}. Setup left it alone, so AI agents can't sign in to Catchall. Everything else works.`;
		}
		if (id === "release" && step.status !== "done") {
			step.note = `The site updates its own scopes and gives back the ${summary.givenBack.length} it only needed to set up. Keeps ${summary.kept.length}: ${summary.kept.join(", ")}.`;
		}
		return step;
	});
}

async function codeStatus(
	functions: Functions,
	fn: Models.Function,
): Promise<{
	status: StepStatus;
	detail: string;
	error?: string;
	deployment?: Models.Deployment;
}> {
	if (fn.deploymentId) {
		const active = await functions.getDeployment({
			functionId: fn.$id,
			deploymentId: fn.deploymentId,
		});
		if (active.status === "ready")
			return { status: "done", detail: "built", deployment: active };
	}
	// Appwrite sets latestDeploymentId only once the build worker picks a deployment up.
	// Until then it's empty or names the previous build, so this lists the newest deployment instead.
	const { deployments } = await functions.listDeployments({
		functionId: fn.$id,
		queries: [Query.orderDesc("$createdAt"), Query.limit(1)],
		total: false,
	});
	const latest = deployments[0];
	if (!latest) return { status: "pending", detail: "" };
	if (BUILDING.includes(latest.status))
		return { status: "running", detail: "building", deployment: latest };
	if (latest.status === "ready")
		return { status: "pending", detail: "built", deployment: latest };
	const tail = (latest.buildLogs || "").trim().split("\n").slice(-4).join("\n");
	return {
		status: "failed",
		detail: latest.status,
		error: `The build ${latest.status === "canceled" ? "was canceled" : "failed"}.${tail ? `\n${tail}` : ""}`,
		deployment: latest,
	};
}

async function provisionView(
	secret: string,
	admin: { name: string; email: string },
): Promise<SetupView> {
	const prefs = await loadPrefs(secret).catch(() => ({}) as SetupPrefs);
	const steps = await probeSteps(prefs);
	const doneCount = steps.filter((s) => s.status === "done").length;
	const next = steps.find((s) => s.status !== "done");
	const idle = prefs.lastAt
		? Date.now() - Date.parse(prefs.lastAt) > 60_000
		: false;
	return {
		view: "provision",
		admin,
		steps,
		log: prefs.log || [],
		resumed:
			idle && next && doneCount > 1
				? { doneCount, nextLabel: next.label }
				: null,
		scopes: scopeSummary(),
		domain: inboxDomain(),
	};
}

// ---------- claiming the admin role ----------

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
	if (password.length < 8)
		throw new Error("Use a password of at least 8 characters.");
	if (password.length > 256)
		throw new Error("Use a password of 256 characters or fewer.");
	return { name, email, password };
}

export async function claimAdmin(input: ClaimInput): Promise<SetupView> {
	const current = await getSetupView();
	if (current.view !== "claim") return current;
	const { name, email, password } = validateClaim(input);
	const started = Date.now();

	// No key here: Appwrite's own limits for sign-ups and sign-ins apply.
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
		// 409 means the account exists already. Signing in below proves the password.
		if (errorCode(err) !== 409) throw new Error(errorMessage(err));
	}

	let secret: string;
	try {
		secret = await signIn(email, password);
	} catch (err) {
		if (errorCode(err) === 401) {
			throw new Error(
				"An account with this email already exists in this project, and the password doesn't match it.",
			);
		}
		if (errorCode(err) === 429)
			throw new Error(
				"Too many sign-in attempts for this email. Wait an hour and try again.",
			);
		throw new Error(errorMessage(err));
	}

	// The team ID is fixed, so only one person can create it. Whoever does first becomes the admin.
	try {
		await new Teams(sessionClient(secret)).create({
			teamId: TEAM_ID,
			name: "Catchall",
			roles: ["owner"],
		});
	} catch (err) {
		if (errorCode(err) === 409) {
			await signOut();
			return { view: "in-progress" };
		}
		throw err;
	}

	const now = new Date().toISOString();
	await savePrefs(secret, {
		admin: { name, email },
		log: [{ t: now, text: `team ${TEAM_ID}, admin ${email}` }],
		durations: { team: Date.now() - started },
		lastAt: now,
	});
	return provisionView(secret, { name, email });
}

// ---------- running steps ----------

type StepResult = {
	status: StepStatus;
	log?: string;
	durationMs?: number;
	agents?: AgentSetup;
};

// Appwrite always offers these OpenID Connect scopes and adds them back on every update.
const BUILT_IN_SCOPES = ["openid", "profile", "email", "phone"];

function agentsStatus(project: Models.Project, saved: AgentSetup | undefined) {
	const ours = consentUrl();
	const theirs = project.oAuth2ServerAuthorizationUrl || "";
	const enabled = Boolean(project.oAuth2ServerEnabled);
	if (enabled && theirs && theirs !== ours)
		return {
			done: saved?.status === "elsewhere" && saved.authorizationUrl === theirs,
			detail: `used by ${hostOf(theirs)}`,
			elsewhere: theirs,
		};
	return {
		done:
			enabled &&
			theirs === ours &&
			(project.oAuth2ServerScopes ?? []).includes(MCP_SCOPE),
		detail: `${hostOf(ours)}/consent`,
		elsewhere: null,
	};
}

// The SDK's update methods are overloaded, so these build plain objects and the calls cast them.
type Params = Record<string, unknown>;

function functionUpdate(fn: Models.Function): Params {
	const params: Params = {
		functionId: fn.$id,
		name: fn.name,
		runtime: fn.runtime,
		execute: fn.execute,
		events: fn.events,
		schedule: fn.schedule,
		timeout: fn.timeout,
		enabled: fn.enabled,
		logging: fn.logging,
		entrypoint: fn.entrypoint,
		commands: fn.commands,
		scopes: fn.scopes,
		installationId: fn.installationId,
		providerRepositoryId: fn.providerRepositoryId,
		providerBranch: fn.providerBranch,
		providerSilentMode: fn.providerSilentMode,
		providerRootDirectory: fn.providerRootDirectory,
		buildSpecification: fn.buildSpecification,
		runtimeSpecification: fn.runtimeSpecification,
		deploymentRetention: fn.deploymentRetention,
		description: fn.description,
		emailEnabled: fn.emailEnabled,
	};
	if (fn.providerBranches?.length)
		params.providerBranches = fn.providerBranches;
	if (fn.providerPaths?.length) params.providerPaths = fn.providerPaths;
	// Appwrite rejects an interval next to a schedule, so it only goes back when it's the one in use.
	if (fn.interval && !fn.schedule) params.interval = fn.interval;
	return params;
}

function siteUpdate(site: Models.Site): Params {
	const params: Params = {
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

const RUNNERS: Record<SetupStepId, () => Promise<StepResult>> = {
	async team() {
		return { status: "done" };
	},

	async database() {
		await ignoreConflict(() =>
			new TablesDB(adminClient()).create({
				databaseId: DATABASE_ID,
				name: "Catchall",
			}),
		);
		return { status: "done", log: `database ${DATABASE_ID} created` };
	},

	async tables() {
		const db = new TablesDB(adminClient());
		const created: string[] = [];
		for (const spec of TABLES) {
			if (
				await exists(() =>
					db.getTable({ databaseId: DATABASE_ID, tableId: spec.id }),
				)
			)
				continue;
			// Columns and indexes go in the same call, so a table never exists half-made.
			await db.createTable({
				databaseId: DATABASE_ID,
				tableId: spec.id,
				name: spec.name,
				permissions: spec.permissions,
				rowSecurity: false,
				columns: spec.columns,
				indexes: spec.indexes,
			});
			created.push(spec.id);
		}
		await ignoreConflict(() =>
			db.createRow<Models.DefaultRow>({
				databaseId: DATABASE_ID,
				tableId: SETTINGS,
				rowId: SETTINGS_ROW,
				data: { retentionDays: DEFAULT_RETENTION_DAYS },
			}),
		);
		return {
			status: "done",
			log: `tables ${(created.length ? created : TABLES.map((t) => t.id)).join(", ")}`,
		};
	},

	async bucket() {
		const team = Role.team(TEAM_ID);
		await ignoreConflict(() =>
			new Storage(adminClient()).createBucket({
				bucketId: BUCKET_ID,
				name: "Attachments",
				permissions: [Permission.read(team), Permission.delete(team)],
				fileSecurity: false,
				enabled: true,
				maximumFileSize: MAX_ATTACHMENT_BYTES,
				compression: "none" as Compression,
				encryption: true,
				antivirus: true,
			}),
		);
		return { status: "done", log: `bucket ${BUCKET_ID}, 25 MB limit` };
	},

	async function() {
		await ignoreConflict(() =>
			new Functions(adminClient()).create({
				functionId: FUNCTION_ID,
				name: "Inbox",
				runtime: Runtime.Node22,
				// Nobody can run it through the API. Email and the schedule still trigger it.
				execute: [],
				timeout: 60,
				enabled: true,
				logging: true,
				entrypoint: "src/main.js",
				commands: "npm install",
				scopes: FUNCTION_SCOPES as ProjectKeyScopes[],
			}),
		);
		return {
			status: "done",
			log: `function ${FUNCTION_ID}, node-22, ${FUNCTION_SCOPES.length} scopes`,
		};
	},

	async code() {
		const functions = new Functions(adminClient());
		const fn = await functions.get({ functionId: FUNCTION_ID });
		const state = await codeStatus(functions, fn);
		if (state.status === "done") {
			const seconds = state.deployment?.buildDuration ?? 0;
			return {
				status: "done",
				log: `build ready in ${seconds} s`,
				durationMs: seconds * 1000,
			};
		}
		if (state.status === "running") return { status: "running" };
		// A finished build that isn't live yet only needs activating.
		if (state.status === "pending" && state.deployment) {
			await functions.updateFunctionDeployment({
				functionId: FUNCTION_ID,
				deploymentId: state.deployment.$id,
			});
			return {
				status: "done",
				log: `build ready in ${state.deployment.buildDuration} s`,
			};
		}
		// No deployment yet, or the last build failed: deploy the template.
		// The build uses the entrypoint and build command set on the function.
		await functions.createTemplateDeployment({
			functionId: FUNCTION_ID,
			repository: "templates",
			owner: "appwrite",
			rootDirectory: "node/email-testing-inbox",
			type: TemplateReferenceType.Tag,
			reference: FUNCTION_TEMPLATE_TAG,
			activate: true,
		});
		return {
			status: "running",
			log: `deploying node/email-testing-inbox from appwrite/templates ${FUNCTION_TEMPLATE_TAG}`,
		};
	},

	async trigger() {
		const functions = new Functions(adminClient());
		const fn = await functions.get({ functionId: FUNCTION_ID });
		// functions.update replaces the whole function, so every current value goes back with the change.
		if (!fn.emailEnabled)
			await functions.update({
				...functionUpdate(fn),
				emailEnabled: true,
			} as never);
		return { status: "done", log: `email trigger *@${inboxDomain()}` };
	},

	async schedule() {
		const functions = new Functions(adminClient());
		const fn = await functions.get({ functionId: FUNCTION_ID });
		if (fn.schedule !== CLEANUP_SCHEDULE)
			await functions.update({
				...functionUpdate(fn),
				schedule: CLEANUP_SCHEDULE,
				interval: undefined,
			} as never);
		return { status: "done", log: `cleanup schedule ${CLEANUP_SCHEDULE}` };
	},

	async agents() {
		const project = new Project(adminClient());
		const current = await project.get();
		const ours = consentUrl();
		const theirs = current.oAuth2ServerAuthorizationUrl || "";
		const agents: AgentSetup = {
			status: "ready",
			mcpUrl: mcpUrl(),
			authorizationUrl: ours,
			updatedAt: new Date().toISOString(),
		};
		// Another app already uses this project's OAuth server. Taking it over would break that app.
		if (current.oAuth2ServerEnabled && theirs && theirs !== ours)
			return {
				status: "done",
				log: `OAuth server already used by ${hostOf(theirs)}, left as it is`,
				agents: { ...agents, status: "elsewhere", authorizationUrl: theirs },
			};
		const scopes = current.oAuth2ServerScopes ?? [];
		if (
			!current.oAuth2ServerEnabled ||
			theirs !== ours ||
			!scopes.includes(MCP_SCOPE)
		) {
			// The update replaces the whole OAuth server configuration, so every current value goes
			// back with the three that change: on, our consent screen, and the catchall.read scope.
			await project.updateOAuth2Server({
				enabled: true,
				authorizationUrl: ours,
				scopes: [
					...new Set([
						...scopes.filter((s) => !BUILT_IN_SCOPES.includes(s)),
						MCP_SCOPE,
					]),
				],
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
			log: `OAuth server on, consent screen at ${hostOf(ours)}/consent`,
			agents,
		};
	},

	async release() {
		const { siteId } = appwriteEnv();
		if (!siteId)
			return { status: "done", log: "no site ID, scopes left as they are" };
		const sites = new Sites(adminClient());
		const site = await sites.get({ siteId });
		const kept = site.scopes.filter((s) => !SETUP_ONLY_SCOPE_NAMES.includes(s));
		// sites.update also replaces the whole site, so this sends back everything it read.
		if (kept.length !== site.scopes.length) {
			await sites.update({ ...siteUpdate(site), scopes: kept } as never);
		}
		return {
			status: "done",
			log: `site ${site.name}: ${site.scopes.length} → ${kept.length} scopes`,
		};
	},
};

export async function runStep(stepId: SetupStepId): Promise<SetupView> {
	if (!STEPS.some((s) => s.id === stepId)) throw new Error("Unknown step.");
	const session = await readViewer();
	if (session.status !== "member" || session.viewer.role !== "admin") {
		throw new AuthError("Only the admin can run setup.", "forbidden");
	}
	if (await isSetupComplete()) return { view: "done", signedIn: true };
	const admin = { name: session.viewer.name, email: session.viewer.email };

	const prefs = await loadPrefs(session.secret).catch(() => ({}) as SetupPrefs);
	const log = [...(prefs.log || [])];
	const now = new Date();
	if (
		prefs.lastAt &&
		now.getTime() - Date.parse(prefs.lastAt) > 60_000 &&
		log.length
	) {
		log.push({
			t: prefs.lastAt,
			text: "paused",
			kind: "pause",
			resumedAt: now.toISOString(),
		});
	}

	const started = Date.now();
	let result: StepResult;
	const errors = { ...(prefs.errors || {}) };
	try {
		result = await RUNNERS[stepId]();
		delete errors[stepId];
	} catch (err) {
		const message = errorMessage(err);
		errors[stepId] = message;
		log.push({
			t: new Date().toISOString(),
			text: `${stepId} failed: ${message}`,
		});
		await savePrefs(session.secret, {
			...prefs,
			log,
			errors,
			lastAt: new Date().toISOString(),
		}).catch(() => undefined);
		return provisionView(session.secret, admin);
	}

	if (result.log) log.push({ t: new Date().toISOString(), text: result.log });
	const durations = { ...(prefs.durations || {}) };
	if (result.agents) prefs.agents = result.agents;
	if (result.status === "done")
		durations[stepId] = result.durationMs ?? Date.now() - started;
	const next: SetupPrefs = {
		...prefs,
		log,
		errors,
		durations,
		lastAt: new Date().toISOString(),
	};

	if (stepId === "release" && result.status === "done") {
		const scopes = scopeSummary();
		await savePrefs(session.secret, { ...next, released: true });
		await markComplete();
		return { view: "complete", admin, domain: inboxDomain(), scopes, log };
	}
	await savePrefs(session.secret, next).catch(() => undefined);
	return provisionView(session.secret, admin);
}
