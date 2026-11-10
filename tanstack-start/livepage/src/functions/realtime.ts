import { createServerFn } from "@tanstack/react-start";
import type { TokenResult } from "#/lib/live";
import { realtimeEndpoint, secondsLeft } from "#/lib/live";
import { appwriteEnv, publicEndpoint, sessionClient } from "#/server/appwrite";
import { readSession } from "#/server/auth";
import { twoStepRequired } from "#/server/settings";

// How long each JWT lasts. The browser gets a new one two minutes before it runs out.
const JWT_SECONDS = 900;

// A short-lived JWT for Realtime and direct row writes. POST, so nothing caches it.
export const fetchToken = createServerFn({ method: "POST" }).handler(
	async (): Promise<TokenResult> => {
		const state = await readSession();
		if (state.status !== "ok") return { status: "signed-out" };
		if (!state.viewer.mfa && (await twoStepRequired()))
			return { status: "signed-out" };
		const { endpoint, projectId } = appwriteEnv();
		// Same reason as Catchall: client.call() only sends the headers it's given, and the project ID
		// isn't one of them, so without this Appwrite treats it as a Console request.
		const response = (await sessionClient(state.secret).call(
			"post",
			new URL(`${endpoint}/account/jwts`),
			{ "X-Appwrite-Project": projectId, "content-type": "application/json" },
			{ duration: JWT_SECONDS },
		)) as { jwt?: string };
		const jwt = String(response?.jwt || "");
		if (!jwt) throw new Error("Appwrite did not return a JWT.");
		return {
			status: "ok",
			jwt,
			expiresIn: secondsLeft(jwt, Date.now(), JWT_SECONDS),
			url: realtimeEndpoint(publicEndpoint()),
			endpoint: publicEndpoint(),
			projectId,
		};
	},
);
