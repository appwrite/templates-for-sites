import { createServerFn } from "@tanstack/react-start";
import type { TokenResult } from "#/lib/live";
import { readViewer } from "#/server/auth";
import { createRealtimeToken } from "#/server/realtime";

// A short-lived JWT for the inbox's realtime socket. POST, so nothing caches it.
export const fetchRealtimeToken = createServerFn({ method: "POST" }).handler(
	async (): Promise<TokenResult> => {
		const state = await readViewer();
		// Signed out, or no longer in the team: the page sends the person back to sign in.
		if (state.status !== "member") return { status: "signed-out" };
		return { status: "ok", ...(await createRealtimeToken(state.secret)) };
	},
);
