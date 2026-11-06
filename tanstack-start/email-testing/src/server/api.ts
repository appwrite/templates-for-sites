import { siteOrigin } from "./appwrite";
import { verifyToken } from "./tokens";

export function json(
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
) {
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
			...headers,
		},
	});
}

export const TOKEN_HEADER = "x-catchall-token";

// CI requests send "Authorization: Bearer ctk_..." (or the token alone in X-Catchall-Token).
// On Appwrite Sites the runtime appends its own credentials, so the header arrives as
// "Bearer ctk_..., Basic ..." and the token is picked out of it.
export function tokenFrom(request: Request): string | null {
	const direct = request.headers.get(TOKEN_HEADER)?.trim();
	if (direct?.startsWith("ctk_")) return direct;
	const bearer = request.headers
		.get("authorization")
		?.match(/(?:^|,)\s*Bearer\s+(ctk_[A-Za-z0-9]+)/);
	return bearer ? bearer[1] : null;
}

// Returns a 401 response when the token is missing, unknown or expired.
export async function authorize(request: Request) {
	const token = await verifyToken(tokenFrom(request));
	if (!token) {
		return {
			error: json(
				{
					message:
						'Send a valid API token as "Authorization: Bearer ctk_...". Tokens expire after 90 days.',
				},
				401,
			),
		};
	}
	return { token, origin: siteOrigin() };
}
