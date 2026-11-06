import { Client } from "node-appwrite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeader: () => undefined,
	getRequestUrl: () => new URL("https://catchall.example.com/inbox"),
}));

const { createRealtimeToken, REALTIME_JWT_SECONDS } = await import(
	"./realtime"
);

type Prepared = { uri: string; options: { headers: Record<string, string> } };
const sent: Prepared[] = [];

beforeEach(() => {
	// Nothing listens here, so no request can leave the machine.
	vi.stubEnv("APPWRITE_SITE_API_ENDPOINT", "http://127.0.0.1:9/v1");
	vi.stubEnv("APPWRITE_SITE_PROJECT_ID", "catchall-project");
	// Builds the request the SDK would send, with its real header merging, and answers it here.
	vi.spyOn(Client.prototype, "call").mockImplementation(async function (
		this: Client,
		method: string,
		url: URL,
		headers?: Record<string, string>,
		params?: Record<string, unknown>,
	) {
		sent.push(this.prepareRequest(method, url, headers, params) as Prepared);
		return { jwt: "header.e30.sig" };
	});
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	sent.length = 0;
});

it("names the project on the JWT request", async () => {
	await createRealtimeToken("session-secret");
	expect(sent).toHaveLength(1);
	const headers = new Headers(sent[0].options.headers);
	expect(sent[0].uri).toBe("http://127.0.0.1:9/v1/account/jwts");
	// Without it, Appwrite treats the call as a Console request and rejects the site's origin.
	expect(headers.get("x-appwrite-project")).toBe("catchall-project");
	expect(headers.get("x-appwrite-session")).toBe("session-secret");
	expect(sent[0].options).toMatchObject({
		body: JSON.stringify({ duration: REALTIME_JWT_SECONDS }),
	});
});
