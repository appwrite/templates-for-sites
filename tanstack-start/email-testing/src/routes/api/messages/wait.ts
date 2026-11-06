import { createFileRoute } from "@tanstack/react-router";
import { authorize, json } from "#/server/api";
import { apiMessage, findLatest, getMessageWithKey } from "#/server/messages";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// GET /api/messages/wait?to=signup-8f3a&since=2026-11-02T14:00:00Z&timeout=20
// Holds the request until a message for "to" arrives, then returns it. 404 when none arrives in time.
export const Route = createFileRoute("/api/messages/wait")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const auth = await authorize(request);
				if ("error" in auth) return auth.error;
				const url = new URL(request.url);
				const to = (url.searchParams.get("to") || "").trim();
				if (!to)
					return json(
						{ message: "Add ?to= with an address or the part before the @." },
						400,
					);
				const since = url.searchParams.get("since");
				if (since && Number.isNaN(Date.parse(since)))
					return json({ message: "since must be an ISO 8601 date." }, 400);
				const timeout = Math.min(
					Math.max(Number(url.searchParams.get("timeout") || 20), 0),
					25,
				);
				const deadline = Date.now() + timeout * 1000;
				do {
					const id = await findLatest(
						to,
						since ? new Date(since).toISOString() : null,
					);
					if (id)
						return json(apiMessage(await getMessageWithKey(id), auth.origin));
					if (Date.now() >= deadline) break;
					await sleep(1000);
				} while (Date.now() < deadline);
				return json(
					{ message: `No message for ${to} after ${timeout} s.` },
					404,
				);
			},
		},
	},
});
