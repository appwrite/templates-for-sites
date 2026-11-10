import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, protectedResourceResponse } from "#/server/oauth";

// GET /.well-known/oauth-protected-resource: metadata for /mcp, for clients that look at the root.
export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
	server: {
		handlers: {
			GET: () => protectedResourceResponse(),
			OPTIONS: () => new Response(null, { status: 204, headers: CORS_HEADERS }),
		},
	},
});
