import { createFileRoute } from "@tanstack/react-router";
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
					const html =
						message.html ||
						`<pre style="white-space:pre-wrap;font:14px/1.5 monospace">${escapeHtml(message.text)}</pre>`;
					return new Response(
						`<!doctype html><meta charset="utf-8"><base target="_blank">${html}`,
						{
							headers: {
								"content-type": "text/html; charset=utf-8",
								"content-security-policy":
									"sandbox allow-popups allow-popups-to-escape-sandbox; script-src 'none'",
								"x-content-type-options": "nosniff",
								"cache-control": "no-store",
							},
						},
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

function escapeHtml(value: string) {
	return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
