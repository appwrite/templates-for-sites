import { createFileRoute } from "@tanstack/react-router";
import { authorize, json } from "#/server/api";
import { apiMessage, findLatest, getMessageWithKey } from "#/server/messages";

// GET /api/messages?to=signup-8f3a returns the latest message for that address, or 404.
export const Route = createFileRoute("/api/messages/")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const auth = await authorize(request);
				if ("error" in auth) return auth.error;
				const to = (new URL(request.url).searchParams.get("to") || "").trim();
				if (!to)
					return json(
						{ message: "Add ?to= with an address or the part before the @." },
						400,
					);
				const id = await findLatest(to, null);
				if (!id) return json({ message: `No message for ${to}.` }, 404);
				return json(apiMessage(await getMessageWithKey(id), auth.origin));
			},
		},
	},
});
