import { createFileRoute } from "@tanstack/react-router";
import { type Client, Storage } from "node-appwrite";
import { authorize, json, tokenFrom } from "#/server/api";
import { adminClient, errorCode, sessionClient } from "#/server/appwrite";
import { readViewer } from "#/server/auth";
import { BUCKET_ID } from "#/server/schema";

const INLINE_TYPES = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/avif",
	"application/pdf",
];

// Signed-in members download with their session. CI downloads with an API token.
export const Route = createFileRoute("/api/attachments/$fileId")({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				let client: Client;
				if (tokenFrom(request)) {
					const auth = await authorize(request);
					if ("error" in auth) return auth.error;
					client = adminClient();
				} else {
					const state = await readViewer();
					if (state.status !== "member")
						return json({ message: "Sign in to download attachments." }, 401);
					client = sessionClient(state.secret);
				}
				const storage = new Storage(client);
				try {
					const file = await storage.getFile({
						bucketId: BUCKET_ID,
						fileId: params.fileId,
					});
					const bytes = await storage.getFileDownload({
						bucketId: BUCKET_ID,
						fileId: params.fileId,
					});
					const inline =
						new URL(request.url).searchParams.has("inline") &&
						INLINE_TYPES.includes(file.mimeType);
					const name = encodeURIComponent(file.name);
					return new Response(bytes, {
						headers: {
							// Attachments come from strangers: never let one run as a page on this site.
							"content-type": inline
								? file.mimeType
								: "application/octet-stream",
							"content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
							"x-content-type-options": "nosniff",
							"content-security-policy":
								"sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
							"cache-control": "private, max-age=300",
						},
					});
				} catch (err) {
					if (errorCode(err) === 404)
						return json({ message: "No attachment with this ID." }, 404);
					throw err;
				}
			},
		},
	},
});
