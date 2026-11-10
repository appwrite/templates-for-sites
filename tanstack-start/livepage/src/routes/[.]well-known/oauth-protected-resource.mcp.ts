import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, protectedResourceResponse } from "#/server/oauth";

// GET /.well-known/oauth-protected-resource/mcp: RFC 9728 metadata for the /mcp resource. The
// 401 from /mcp points here.
export const Route = createFileRoute(
	"/.well-known/oauth-protected-resource/mcp",
)({
	server: {
		handlers: {
			GET: () => protectedResourceResponse(),
			OPTIONS: () => new Response(null, { status: 204, headers: CORS_HEADERS }),
		},
	},
});
