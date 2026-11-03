import { createFileRoute } from "@tanstack/react-router";
import { json } from "#/server/api";
import { handleBody, PROTOCOL_VERSIONS, parseError } from "#/server/mcp";
import { messageBackend } from "#/server/mcp-backend";
import { authenticateMcp, CORS_HEADERS } from "#/server/oauth";

// The MCP server for AI agents (Streamable HTTP). Agents sign in with the project's Appwrite
// OAuth server; a request without a valid token gets a 401 that points at the sign-in details.
// Stateless: every POST carries its own token, and responses are plain JSON, never a stream.
export const Route = createFileRoute("/mcp")({
	server: {
		handlers: {
			OPTIONS: () => new Response(null, { status: 204, headers: CORS_HEADERS }),

			POST: async ({ request }) => {
				const auth = await authenticateMcp(request);
				if ("response" in auth) return auth.response;

				const version = request.headers.get("mcp-protocol-version");
				if (version && !PROTOCOL_VERSIONS.includes(version))
					return json(
						{
							jsonrpc: "2.0",
							id: null,
							error: {
								code: -32600,
								message: `Unsupported MCP-Protocol-Version ${version}. Supported: ${PROTOCOL_VERSIONS.join(", ")}.`,
							},
						},
						400,
						CORS_HEADERS,
					);

				let body: unknown;
				try {
					body = await request.json();
				} catch {
					return json(parseError(), 400, CORS_HEADERS);
				}
				const result = await handleBody(body, messageBackend());
				if (result.body === null)
					return new Response(null, { status: 202, headers: CORS_HEADERS });
				return json(result.body, result.status, CORS_HEADERS);
			},

			// No server-to-client stream and no sessions to end.
			GET: async ({ request }) => {
				const auth = await authenticateMcp(request);
				if ("response" in auth) return auth.response;
				return new Response(null, {
					status: 405,
					headers: { ...CORS_HEADERS, allow: "POST, OPTIONS" },
				});
			},
			DELETE: () =>
				new Response(null, {
					status: 405,
					headers: { ...CORS_HEADERS, allow: "POST, OPTIONS" },
				}),
		},
	},
});
