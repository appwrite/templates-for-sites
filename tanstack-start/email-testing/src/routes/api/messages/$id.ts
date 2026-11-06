import { createFileRoute } from "@tanstack/react-router";
import { authorize, json } from "#/server/api";
import { errorCode } from "#/server/appwrite";
import { apiMessage, getMessageWithKey } from "#/server/messages";

export const Route = createFileRoute("/api/messages/$id")({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const auth = await authorize(request);
				if ("error" in auth) return auth.error;
				try {
					return json(
						apiMessage(await getMessageWithKey(params.id), auth.origin),
					);
				} catch (err) {
					if (errorCode(err) === 404)
						return json({ message: "No message with this ID." }, 404);
					throw err;
				}
			},
		},
	},
});
