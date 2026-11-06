import { type RealtimeToken, realtimeEndpoint, secondsLeft } from "#/lib/live";
import { appwriteEnv, sessionClient } from "./appwrite";
import { DATABASE_ID, MESSAGES } from "./schema";

// How long each realtime JWT lasts. The page gets a new one two minutes before it runs out.
// Appwrite allows up to 3600 seconds. A shorter life limits what a leaked JWT can do.
export const REALTIME_JWT_SECONDS = 900;

// Row events for the messages table: new mail, mail marked as read, and deletes.
export const MESSAGES_CHANNEL = `tablesdb.${DATABASE_ID}.tables.${MESSAGES}.rows`;

// Makes a JWT from the person's session (POST /v1/account/jwts) for the page's realtime socket.
// The session secret stays in its httpOnly cookie. The JWT acts as the same person, ends with
// the session, and expires on its own after REALTIME_JWT_SECONDS.
export async function createRealtimeToken(
	secret: string,
): Promise<RealtimeToken> {
	const { endpoint, projectId } = appwriteEnv();
	const client = sessionClient(secret);
	// The server SDK leaves out account.createJWT, which is a client-side method, so this calls
	// the endpoint directly with the session. client.call() sends only the headers it's given plus
	// the client's own, and the project ID isn't one of those. Without it, Appwrite treats the
	// request as a Console request and rejects the site's origin.
	const response = (await client.call(
		"post",
		new URL(`${endpoint}/account/jwts`),
		{ "X-Appwrite-Project": projectId, "content-type": "application/json" },
		{ duration: REALTIME_JWT_SECONDS },
	)) as { jwt?: string };
	const jwt = String(response?.jwt || "");
	if (!jwt) throw new Error("Appwrite did not return a JWT.");
	return {
		jwt,
		expiresIn: secondsLeft(jwt, Date.now(), REALTIME_JWT_SECONDS),
		url: realtimeEndpoint(endpoint),
		projectId,
		channels: [MESSAGES_CHANNEL],
	};
}
