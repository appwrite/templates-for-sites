import { createFileRoute } from "@tanstack/react-router";
import { previewDocument, textPreviewDocument } from "#/lib/email-preview";
import { json } from "#/server/api";
import { errorCode, sessionClient } from "#/server/appwrite";
import { readViewer } from "#/server/auth";
import { getMessage } from "#/server/messages";

// Opens a message's HTML in its own tab. The sandbox policy stops any script in the email from running.
export const Route = createFileRoute("/api/preview/$id")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const state = await readViewer();
				if (state.status !== "member")
					return json({ message: "Sign in to view this message." }, 401);
				try {
					const message = await getMessage(
						sessionClient(state.secret),
						params.id,
						false,
					);
					const doc = message.html
						? previewDocument(message.html, { frame: false })
						: textPreviewDocument(message.text);
					return new Response(doc, {
						headers: {
							"content-type": "text/html; charset=utf-8",
							"content-security-policy":
								"sandbox allow-popups allow-popups-to-escape-sandbox; script-src 'none'",
							"x-content-type-options": "nosniff",
							"cache-control": "no-store",
						},
					});
				} catch (err) {
					if (errorCode(err) === 404)
						return json({ message: "No message with this ID." }, 404);
					throw err;
				}
			},
		},
	},
});
