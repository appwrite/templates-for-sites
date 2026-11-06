import http from "node:http";
import type { AddressInfo } from "node:net";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { ALL_SCOPES, SETUP_ONLY_SCOPE_NAMES } from "./schema";

// Setup runs against a fake Appwrite API on localhost, as a signed-in admin. The site key's scopes
// come from the fake site, so releasing them changes the key, as it does on Appwrite.
const request = vi.hoisted(() => ({ key: "" }));
vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeader: (name: string) =>
		name === "x-appwrite-key" ? request.key : undefined,
	getRequestUrl: () => new URL("http://site.local/setup"),
	getCookie: () => "session-secret",
	setCookie: () => {},
	deleteCookie: () => {},
}));
// Setup stops on anything but Cloud. The fake stands in for it.
vi.mock("./appwrite", async (original) => ({
	...(await original<typeof import("./appwrite")>()),
	isCloudEndpoint: () => true,
}));

const { getSetupView, runStep } = await import("./setup");

type Deployment = {
	$id: string;
	$createdAt: string;
	status: string;
	buildLogs: string;
	buildDuration: number;
};

const keyFor = (scopes: string[]) =>
	`ephemeral_x.${Buffer.from(JSON.stringify({ scopes })).toString("base64url")}.sig`;

let clock = Date.parse("2026-11-03T12:00:00Z");
const state = {
	prefs: {} as Record<string, unknown>,
	failPrefs: false,
	failUpsert: false,
	settings: null as Record<string, unknown> | null,
	siteScopes: [] as string[],
	siteUpdates: 0,
	fn: { deploymentId: "", latestDeploymentId: "" },
	deployments: [] as Deployment[],
	templatePosts: [] as Record<string, unknown>[],
	activations: [] as string[],
};

function reset() {
	Object.assign(state, {
		prefs: { setup: { log: [] } },
		failPrefs: false,
		failUpsert: false,
		settings: null,
		siteScopes: [...ALL_SCOPES],
		siteUpdates: 0,
		fn: { deploymentId: "", latestDeploymentId: "" },
		deployments: [],
		templatePosts: [],
		activations: [],
	});
	request.key = keyFor(state.siteScopes);
}

const site = () => ({
	$id: "site1",
	name: "Catchall",
	framework: "tanstack-start",
	enabled: true,
	logging: true,
	timeout: 30,
	buildRuntime: "node-22",
	adapter: "ssr",
	scopes: state.siteScopes,
});

const fn = () => ({
	$id: "inbox",
	name: "Inbox",
	emailEnabled: false,
	schedule: "",
	...state.fn,
});

function respond(
	res: http.ServerResponse,
	status: number,
	body: unknown = { message: `fake ${status}`, code: status, type: "fake" },
) {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}

function route(method: string, url: URL, body: Record<string, unknown>) {
	const path = url.pathname.replace(/^\/v1/, "");
	const deployment = path.match(/^\/functions\/inbox\/deployments\/([^/]+)$/);
	switch (`${method} ${path}`) {
		case "GET /account":
			return [200, { $id: "u1", name: "Admin", email: "admin@example.com" }];
		case "GET /teams/catchall/memberships":
			return [
				200,
				{
					total: 1,
					memberships: [
						{ $id: "m1", userId: "u1", confirm: true, roles: ["owner"] },
					],
				},
			];
		case "GET /teams/catchall":
			return [200, { $id: "catchall", name: "Catchall" }];
		case "GET /teams/catchall/prefs":
			return [200, state.prefs];
		case "PUT /teams/catchall/prefs":
			if (state.failPrefs) return [500];
			state.prefs = body.prefs as Record<string, unknown>;
			return [200, state.prefs];
		case "GET /tablesdb/catchall/tables/settings/rows/settings":
			return state.settings ? [200, state.settings] : [404];
		case "PUT /tablesdb/catchall/tables/settings/rows/settings":
			if (state.failUpsert) return [503];
			state.settings = { $id: "settings", ...(body.data as object) };
			return [200, state.settings];
		case "GET /project":
			return [200, { $id: "test", name: "Test", oAuth2ServerEnabled: false }];
		case "GET /sites/site1":
			return [200, site()];
		case "PUT /sites/site1":
			state.siteUpdates++;
			state.siteScopes = body.scopes as string[];
			request.key = keyFor(state.siteScopes);
			return [200, site()];
		case "GET /functions/inbox":
			return [200, fn()];
		case "GET /functions/inbox/deployments": {
			const newest = [...state.deployments].sort((a, b) =>
				b.$createdAt.localeCompare(a.$createdAt),
			);
			return [200, { total: 0, deployments: newest.slice(0, 1) }];
		}
		case "POST /functions/inbox/deployments/template": {
			state.templatePosts.push(body);
			clock += 1000;
			const created = {
				$id: `d${state.deployments.length + 1}`,
				$createdAt: new Date(clock).toISOString(),
				status: "waiting",
				buildLogs: "",
				buildDuration: 0,
			};
			state.deployments.push(created);
			return [202, created];
		}
		case "PATCH /functions/inbox/deployment":
			state.activations.push(body.deploymentId as string);
			state.fn.deploymentId = body.deploymentId as string;
			return [200, fn()];
	}
	if (method === "GET" && deployment) {
		const found = state.deployments.find((d) => d.$id === deployment[1]);
		return found ? [200, found] : [404];
	}
	return [404];
}

const server = http.createServer(async (req, res) => {
	let raw = "";
	for await (const chunk of req) raw += chunk;
	const [status, body] = route(
		req.method ?? "GET",
		new URL(req.url ?? "/", "http://fake"),
		raw ? JSON.parse(raw) : {},
	);
	respond(res, status as number, body);
});

beforeAll(async () => {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	vi.stubEnv("APPWRITE_SITE_API_ENDPOINT", `http://127.0.0.1:${port}/v1`);
	vi.stubEnv("APPWRITE_SITE_PROJECT_ID", "test");
	vi.stubEnv("APPWRITE_SITE_ID", "site1");
});
afterAll(() => {
	vi.unstubAllEnvs();
	server.close();
});
beforeEach(reset);

const setupPrefs = () => state.prefs.setup as Record<string, unknown>;

async function stepOf(view: Awaited<ReturnType<typeof runStep>>, id: string) {
	if (view.view !== "provision") throw new Error(`got the ${view.view} view`);
	const step = view.steps.find((s) => s.id === id);
	if (!step) throw new Error(`no ${id} step`);
	return step;
}

describe("the release step", () => {
	it("completes setup and gives back the setup-only scopes", async () => {
		const view = await runStep("release");
		expect(view.view).toBe("complete");
		expect(state.siteScopes.length).toBeGreaterThan(0);
		expect(
			state.siteScopes.some((s) => SETUP_ONLY_SCOPE_NAMES.includes(s)),
		).toBe(false);
		expect(setupPrefs().released).toBe(true);
		expect(state.settings?.setupCompletedAt).toBeTruthy();
	});

	it("leaves the scopes alone and shows the error when the marker can't be saved", async () => {
		state.failPrefs = true;
		const step = await stepOf(await runStep("release"), "release");
		expect(state.siteUpdates).toBe(0);
		expect(state.siteScopes).toEqual(ALL_SCOPES);
		// The error shows even though saving it failed too, so the page waits for Retry.
		expect(step.status).toBe("failed");
		expect(step.error).toMatch(/fake 500/);
	});

	it("finishes setup on the next visit when the request stops after the scopes are released", async () => {
		state.failUpsert = true;
		await expect(runStep("release")).rejects.toThrow();
		expect(state.siteUpdates).toBe(1);
		expect(setupPrefs().released).toBe(true);
		state.failUpsert = false;
		expect(await getSetupView()).toEqual({ view: "done", signedIn: true });
		expect(state.settings?.setupCompletedAt).toBeTruthy();
	});

	it("asks for the scopes when they're missing and the release never started", async () => {
		state.siteScopes = ALL_SCOPES.filter(
			(s) => !SETUP_ONLY_SCOPE_NAMES.includes(s),
		);
		request.key = keyFor(state.siteScopes);
		const view = await getSetupView();
		expect(view.view).toBe("missing-scopes");
		expect(state.settings).toBeNull();
	});
});

describe("the function code step", () => {
	it("deploys the template once and waits for the build", async () => {
		let step = await stepOf(await runStep("code"), "code");
		expect(state.templatePosts).toEqual([
			{
				repository: "templates",
				owner: "appwrite",
				rootDirectory: "node/email-testing-inbox",
				type: "tag",
				reference: "1.5.0",
				activate: true,
			},
		]);
		expect(step.status).toBe("running");
		// Appwrite sets latestDeploymentId only once a build worker picks the deployment up.
		for (const status of ["waiting", "processing", "building"]) {
			state.deployments[0].status = status;
			step = await stepOf(await runStep("code"), "code");
			expect(step.status).toBe("running");
		}
		expect(state.templatePosts).toHaveLength(1);
	});

	it("deploys again after a failed build, even while latestDeploymentId names it", async () => {
		await runStep("code");
		state.deployments[0].status = "failed";
		state.fn.latestDeploymentId = "d1";
		const step = await stepOf(await runStep("code"), "code");
		expect(state.templatePosts).toHaveLength(2);
		expect(step.status).toBe("running");
	});

	it("shows a failed build with the end of its log", async () => {
		await runStep("code");
		state.deployments[0].status = "failed";
		state.deployments[0].buildLogs =
			"npm ERR! 404 Not Found\nnpm ERR! no such tag";
		// Another step's view probes the code step without retrying it.
		const step = await stepOf(await runStep("team"), "code");
		expect(step.status).toBe("failed");
		expect(step.error).toMatch(
			/The build failed\.\nnpm ERR! 404 Not Found\nnpm ERR! no such tag/,
		);
	});

	it("activates a ready build instead of deploying again", async () => {
		await runStep("code");
		Object.assign(state.deployments[0], { status: "ready", buildDuration: 38 });
		let step = await stepOf(await runStep("code"), "code");
		expect(state.activations).toEqual(["d1"]);
		expect(step.status).toBe("done");
		step = await stepOf(await runStep("code"), "code");
		expect(step.status).toBe("done");
		expect(state.templatePosts).toHaveLength(1);
		expect(state.activations).toHaveLength(1);
	});
});
