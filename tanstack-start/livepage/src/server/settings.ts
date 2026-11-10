import { type Models, TablesDB } from "node-appwrite";
import {
	adminClient,
	appwriteEnv,
	errorCode,
	siteKey,
	siteOrigin,
} from "./appwrite";
import { DATABASE_ID, SETTINGS, SETTINGS_ROW } from "./schema";
import { vectorsFailed, vectorsReady } from "./setup-logic";

export type SettingsRow = Models.Row & {
	schemaVersion?: number | null;
	setupCompletedAt: string | null;
	signup: "invite" | "open";
	features: string | null;
	aiEnabled: boolean;
	aiEndpoint: string | null;
	aiTextModel: string | null;
	aiImageModel: string | null;
	aiEmbeddingModel: string | null;
	aiImages: boolean;
	vectors: boolean;
	agents: boolean;
	siteOrigin: string | null;
	aiPrivateHost: string | null;
};

export async function readSettings(): Promise<SettingsRow | null> {
	try {
		return await new TablesDB(adminClient()).getRow<SettingsRow>({
			databaseId: DATABASE_ID,
			tableId: SETTINGS,
			rowId: SETTINGS_ROW,
		});
	} catch (err) {
		// The database or table doesn't exist yet: setup hasn't run.
		if (errorCode(err) === 404) return null;
		throw err;
	}
}

// The address this Site is reached at, for anything that leaves the app (reset and invite links, the
// MCP audience). It comes from configuration, never from a client's X-Forwarded-Host header, which
// on a request that didn't go through the Sites proxy says whatever the caller wants. LIVEPAGE_SITE_URL
// wins, for Sites on a custom domain; otherwise it's what /setup recorded. Before setup has
// recorded one, nothing has been sent yet and the request's own origin is all there is.
export async function trustedOrigin() {
	const configured = process.env.LIVEPAGE_SITE_URL;
	if (configured) {
		try {
			return new URL(configured).origin;
		} catch {
			// Fall through: an unparseable value must not break sign-in.
		}
	}
	const settings = await readSettings().catch(() => null);
	return settings?.siteOrigin || siteOrigin();
}

// The id setup or Settings gave the vector database. Older sites only have the flag.
export function vectorsDatabaseName(settings: SettingsRow | null) {
	try {
		const features = JSON.parse(settings?.features || "{}") as {
			vectorsDatabase?: string | null;
		};
		return features.vectorsDatabase || "vectors";
	} catch {
		return "vectors";
	}
}

export type VectorsHealth = "off" | "starting" | "ready" | "failed";

const VECTORS_READY_FOR_MS = 30_000;
let vectorsReadyUntil = 0;

export function forgetVectorsHealth() {
	vectorsReadyUntil = 0;
}

// Whether search by meaning can really run. The `vectors` flag only records that someone opted in:
// it's set as soon as the database is requested, provisioning can take minutes or fail, and the
// database can be deleted from the Console. Anything that shows the feature asks this, not the
// flag. Only "ready" is remembered, briefly, so a database that comes up shows without waiting.
export async function vectorsHealth(
	settings: SettingsRow | null,
): Promise<VectorsHealth> {
	if (!settings?.vectors) return "off";
	if (Date.now() < vectorsReadyUntil) return "ready";
	const { endpoint, projectId } = appwriteEnv();
	const res = await fetch(
		`${endpoint}/vectorsdb/${vectorsDatabaseName(settings)}`,
		{
			headers: {
				"x-appwrite-project": projectId,
				"x-appwrite-key": siteKey() ?? "",
			},
			signal: AbortSignal.timeout(8000),
		},
	).catch(() => null);
	if (!res?.ok) return "failed";
	const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	if (vectorsFailed(json)) return "failed";
	if (!vectorsReady(json)) return "starting";
	vectorsReadyUntil = Date.now() + VECTORS_READY_FOR_MS;
	return "ready";
}

export async function isSetupComplete() {
	const settings = await readSettings();
	return Boolean(settings?.setupCompletedAt);
}

// Set by the Features step of setup. Stored in the settings row's `features` JSON.
export async function twoStepRequired() {
	const settings = await readSettings();
	try {
		return Boolean(JSON.parse(settings?.features || "{}").requireTwoStep);
	} catch {
		return false;
	}
}
