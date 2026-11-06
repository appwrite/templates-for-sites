import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BACKOFF_MS,
	CONNECT_TIMEOUT_MS,
	coalesce,
	LiveConnection,
	type LiveStatus,
	PING_EVERY_MS,
	PONG_TIMEOUT_MS,
	ROTATE_BEFORE_MS,
	realtimeEndpoint,
	SLEEP_GAP_MS,
	type SocketLike,
	STABLE_MS,
	type StoredToken,
	secondsLeft,
	socketUrl,
	TICK_MS,
	type TokenResult,
} from "./live";

class FakeSocket implements SocketLike {
	readyState = 0;
	sent: unknown[] = [];
	closedWith: number | null = null;
	// A healthy Appwrite answers every ping.
	answersPings = true;
	onmessage: SocketLike["onmessage"] = null;
	onclose: SocketLike["onclose"] = null;
	onerror: SocketLike["onerror"] = null;
	constructor(readonly url: string) {}
	get jwt() {
		return new URL(this.url).searchParams.get("jwt");
	}
	send(data: string) {
		const message = JSON.parse(data);
		this.sent.push(message);
		if (message.type === "ping" && this.answersPings)
			queueMicrotask(() => this.pong());
	}
	close(code = 1000) {
		this.closedWith = code;
		this.readyState = 3;
	}
	// Appwrite's side.
	connected() {
		this.readyState = 1;
		this.frame({ type: "connected", data: { channels: [], user: null } });
	}
	event(events: string[], payload: unknown = {}) {
		this.frame({ type: "event", data: { events, channels: [], payload } });
	}
	pong() {
		this.frame({ type: "pong" });
	}
	frame(value: unknown) {
		this.onmessage?.({ data: JSON.stringify(value) });
	}
	drop(code = 1006) {
		this.readyState = 3;
		this.onclose?.({ code });
	}
}

const CHANNEL = "tablesdb.catchall.tables.messages.rows";

function setup(
	options: {
		tokens?: TokenResult[];
		online?: boolean;
		store?: { current: StoredToken | null };
	} = {},
) {
	const sockets: FakeSocket[] = [];
	const statuses: LiveStatus[] = [];
	const events: string[][] = [];
	const connects: boolean[] = [];
	let issued = 0;
	let online = options.online ?? true;
	const fetchToken = vi.fn(async (): Promise<TokenResult> => {
		const scripted = options.tokens?.shift();
		if (scripted) return scripted;
		issued++;
		return {
			status: "ok",
			jwt: `jwt-${issued}`,
			expiresIn: 900,
			url: "wss://fra.cloud.appwrite.io/v1/realtime",
			projectId: "demo",
			channels: [CHANNEL],
		};
	});
	const live = new LiveConnection({
		fetchToken,
		onEvent: (e) => events.push(e.events),
		onConnected: ({ reconnect }) => connects.push(reconnect),
		onStatus: (s) => statuses.push(s),
		createSocket: (url) => {
			const socket = new FakeSocket(url);
			sockets.push(socket);
			return socket;
		},
		isOnline: () => online,
		random: () => 0.5, // No jitter, so backoff delays are exact.
		tokenStore: options.store,
	});
	return {
		live,
		sockets,
		statuses,
		events,
		connects,
		fetchToken,
		last: () => sockets[sockets.length - 1],
		setOnline: (value: boolean) => {
			online = value;
		},
	};
}

// Lets the awaited fetchToken() resolve.
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-11-03T10:00:00Z"));
});
afterEach(() => {
	vi.useRealTimers();
});

describe("socketUrl", () => {
	it("passes the project, the JWT and each channel in the query", () => {
		const url = new URL(
			socketUrl({
				jwt: "a.b.c",
				expiresIn: 900,
				url: "wss://fra.cloud.appwrite.io/v1/realtime",
				projectId: "demo",
				channels: [CHANNEL],
			}),
		);
		expect(url.origin + url.pathname).toBe(
			"wss://fra.cloud.appwrite.io/v1/realtime",
		);
		expect(url.searchParams.get("project")).toBe("demo");
		expect(url.searchParams.get("jwt")).toBe("a.b.c");
		expect(url.searchParams.getAll("channels[]")).toEqual([CHANNEL]);
	});
});

describe("realtimeEndpoint", () => {
	it("swaps the scheme and adds /realtime", () => {
		expect(realtimeEndpoint("https://fra.cloud.appwrite.io/v1")).toBe(
			"wss://fra.cloud.appwrite.io/v1/realtime",
		);
		expect(realtimeEndpoint("http://localhost/v1/")).toBe(
			"ws://localhost/v1/realtime",
		);
	});
});

describe("secondsLeft", () => {
	const jwt = (payload: object) =>
		`x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;
	it("reads exp from the JWT", () => {
		const now = Date.parse("2026-11-03T10:00:00Z");
		expect(secondsLeft(jwt({ exp: now / 1000 + 600 }), now, 900)).toBe(600);
	});
	it("never says more than the requested duration or less than zero", () => {
		const now = Date.parse("2026-11-03T10:00:00Z");
		expect(secondsLeft(jwt({ exp: now / 1000 + 9999 }), now, 900)).toBe(900);
		expect(secondsLeft(jwt({ exp: now / 1000 - 5 }), now, 900)).toBe(0);
	});
	it("falls back when the JWT can't be read", () => {
		expect(secondsLeft("not-a-jwt", Date.now(), 900)).toBe(900);
	});
});

describe("LiveConnection", () => {
	it("connects with a JWT and reports live", async () => {
		const t = setup();
		t.live.start();
		await flush();
		expect(t.sockets).toHaveLength(1);
		expect(t.last().jwt).toBe("jwt-1");
		expect(t.statuses).toEqual([]);
		expect(t.live.current).toBe("connecting");
		t.last().connected();
		expect(t.live.current).toBe("live");
		expect(t.connects).toEqual([false]);
		t.live.stop();
	});

	it("passes row events on", async () => {
		const t = setup();
		t.live.start();
		await flush();
		t.last().connected();
		t.last().event([
			`databases.catchall.tables.messages.rows.m1.create`,
			"tablesdb.catchall.tables.messages.rows.m1.create",
		]);
		expect(t.events).toHaveLength(1);
		t.live.stop();
	});

	it("rotates the JWT before it expires, opening the new socket before closing the old", async () => {
		const t = setup();
		t.live.start();
		await flush();
		const first = t.last();
		first.connected();
		await vi.advanceTimersByTimeAsync(900_000 - ROTATE_BEFORE_MS - 1_000);
		expect(t.sockets).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(t.fetchToken).toHaveBeenCalledTimes(2);
		expect(t.sockets).toHaveLength(2);
		const second = t.last();
		expect(second.jwt).toBe("jwt-2");
		// The old socket keeps delivering until the new one is subscribed.
		expect(first.closedWith).toBeNull();
		first.event(["x.create"]);
		expect(t.events).toHaveLength(1);
		second.connected();
		expect(first.closedWith).toBe(1000);
		// Frames from the retired socket are ignored.
		first.event(["late.create"]);
		expect(t.events).toHaveLength(1);
		second.event(["y.create"]);
		expect(t.events).toHaveLength(2);
		// No refetch and no status change for a rotation.
		expect(t.connects).toEqual([false]);
		expect(t.statuses).toEqual(["live"]);
		t.live.stop();
	});

	it("lets a rotation's socket take over when the old one closes first", async () => {
		const t = setup();
		t.live.start();
		await flush();
		const first = t.last();
		first.connected();
		await vi.advanceTimersByTimeAsync(900_000 - ROTATE_BEFORE_MS);
		const second = t.last();
		expect(t.sockets).toHaveLength(2);
		// The old JWT runs out while the new socket is still handshaking.
		first.drop(1008);
		expect(t.live.current).toBe("reconnecting");
		second.connected();
		expect(t.live.current).toBe("live");
		// Events may have gone missing in between, so the page fetches again.
		expect(t.connects).toEqual([false, true]);
		// No retry opens a third socket, and the new JWT is still the one in use.
		await vi.advanceTimersByTimeAsync(
			BACKOFF_MS[BACKOFF_MS.length - 1] + TICK_MS,
		);
		expect(t.sockets).toHaveLength(2);
		expect(second.closedWith).toBeNull();
		t.live.check();
		await flush();
		expect(t.sockets).toHaveLength(2);
		expect(t.fetchToken).toHaveBeenCalledTimes(2);
		t.live.stop();
	});

	it("retries when the taken-over socket never finishes its handshake", async () => {
		const t = setup();
		t.live.start();
		await flush();
		const first = t.last();
		first.connected();
		await vi.advanceTimersByTimeAsync(900_000 - ROTATE_BEFORE_MS);
		const second = t.last();
		first.drop(1006);
		await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS + TICK_MS);
		expect(second.closedWith).toBe(1000);
		await vi.advanceTimersByTimeAsync(BACKOFF_MS[1] * 2);
		expect(t.sockets.length).toBeGreaterThanOrEqual(3);
		t.last().connected();
		expect(t.live.current).toBe("live");
		t.live.stop();
	});

	it("keeps the old socket when a rotation fails, and tries again", async () => {
		const t = setup();
		t.live.start();
		await flush();
		const first = t.last();
		first.connected();
		t.fetchToken.mockRejectedValueOnce(new Error("network"));
		await vi.advanceTimersByTimeAsync(900_000 - ROTATE_BEFORE_MS);
		expect(t.sockets).toHaveLength(1);
		expect(first.closedWith).toBeNull();
		await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]);
		expect(t.sockets).toHaveLength(2);
		t.live.stop();
	});

	it("reconnects with backoff after a drop, reusing a JWT that still has time", async () => {
		const t = setup();
		t.live.start();
		await flush();
		t.last().connected();
		t.last().drop(1006);
		expect(t.live.current).toBe("reconnecting");
		await vi.advanceTimersByTimeAsync(BACKOFF_MS[0] - 1);
		expect(t.sockets).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(t.sockets).toHaveLength(2);
		expect(t.last().jwt).toBe("jwt-1");
		expect(t.fetchToken).toHaveBeenCalledTimes(1);
		// Fails again: the wait doubles.
		t.last().drop(1006);
		await vi.advanceTimersByTimeAsync(BACKOFF_MS[1] - 1);
		expect(t.sockets).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(t.sockets).toHaveLength(3);
		t.last().connected();
		expect(t.live.current).toBe("live");
		// Back after a drop: the page refetches what it missed.
		expect(t.connects).toEqual([false, true]);
		t.live.stop();
	});

	it("backs off when Appwrite keeps closing the socket soon after subscribing", async () => {
		const t = setup();
		t.live.start();
		await flush();
		for (const wait of BACKOFF_MS.slice(0, 3)) {
			t.last().connected();
			t.last().drop(1011);
			const before = t.sockets.length;
			await vi.advanceTimersByTimeAsync(wait - 1);
			expect(t.sockets).toHaveLength(before);
			await vi.advanceTimersByTimeAsync(1);
			expect(t.sockets).toHaveLength(before + 1);
		}
		// One refetch per reconnect, at the growing waits, not one a second.
		expect(t.connects).toEqual([false, true, true]);
		// A socket that stays up a while earns the shortest wait back.
		t.last().connected();
		await vi.advanceTimersByTimeAsync(STABLE_MS);
		t.last().drop(1011);
		await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]);
		expect(t.sockets).toHaveLength(5);
		expect(t.fetchToken).toHaveBeenCalledTimes(1);
		t.live.stop();
	});

	it("reuses the tab's JWT when the inbox mounts again", async () => {
		const store = { current: null as StoredToken | null };
		const first = setup({ store });
		first.live.start();
		await flush();
		first.last().connected();
		first.live.stop();
		// Settings, then back to the inbox ten minutes later.
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		const second = setup({ store });
		second.live.start();
		await flush();
		expect(second.fetchToken).not.toHaveBeenCalled();
		expect(second.last().jwt).toBe("jwt-1");
		second.last().connected();
		// It rotates on the first JWT's schedule: 13 minutes after that JWT was made.
		await vi.advanceTimersByTimeAsync(3 * 60_000 - ROTATE_BEFORE_MS / 2);
		expect(second.fetchToken).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(ROTATE_BEFORE_MS / 2);
		expect(second.fetchToken).toHaveBeenCalledOnce();
		second.live.stop();
	});

	it("forgets the tab's JWT once Appwrite rejects it", async () => {
		const store = { current: null as StoredToken | null };
		const t = setup({ store });
		t.live.start();
		await flush();
		t.last().connected();
		expect(store.current?.jwt).toBe("jwt-1");
		t.last().drop(1008);
		expect(store.current).toBeNull();
		t.live.stop();
	});

	it("gets a new JWT when Appwrite rejects the old one", async () => {
		const t = setup();
		t.live.start();
		await flush();
		t.last().connected();
		t.last().frame({
			type: "error",
			data: { code: 1008, message: "Failed to verify JWT." },
		});
		t.last().drop(1008);
		await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]);
		expect(t.fetchToken).toHaveBeenCalledTimes(2);
		expect(t.last().jwt).toBe("jwt-2");
		t.live.stop();
	});

	it("pings, and reconnects when a ping goes unanswered", async () => {
		const t = setup();
		t.live.start();
		await flush();
		const socket = t.last();
		socket.connected();
		await vi.advanceTimersByTimeAsync(PING_EVERY_MS);
		expect(socket.sent).toEqual([{ type: "ping" }]);
		socket.answersPings = false;
		await vi.advanceTimersByTimeAsync(PING_EVERY_MS);
		expect(socket.sent).toHaveLength(2);
		// No pong this time.
		await vi.advanceTimersByTimeAsync(PONG_TIMEOUT_MS + TICK_MS);
		expect(socket.closedWith).toBe(1000);
		expect(t.live.current).toBe("reconnecting");
		await flush();
		expect(t.sockets).toHaveLength(2);
		t.live.stop();
	});

	it("doesn't reconnect a hidden tab whose timers run once a minute", async () => {
		const t = setup();
		t.live.start();
		await flush();
		const socket = t.last();
		socket.connected();
		// Each tick is a minute late, but every ping gets its pong.
		for (let i = 0; i < 5; i++) {
			vi.setSystemTime(Date.now() + 60_000);
			await vi.advanceTimersByTimeAsync(TICK_MS);
		}
		expect(socket.sent.length).toBeGreaterThanOrEqual(5);
		expect(t.sockets).toHaveLength(1);
		expect(t.live.current).toBe("live");
		t.live.stop();
	});

	it("reconnects and refetches after the computer sleeps", async () => {
		const t = setup();
		t.live.start();
		await flush();
		t.last().connected();
		// Asleep for an hour: no timers ran, and the JWT has expired.
		vi.setSystemTime(Date.now() + 60 * 60_000);
		await vi.advanceTimersByTimeAsync(TICK_MS);
		expect(t.sockets[0].closedWith).toBe(1000);
		expect(t.sockets).toHaveLength(2);
		expect(t.fetchToken).toHaveBeenCalledTimes(2);
		t.last().connected();
		expect(t.connects).toEqual([false, true]);
		expect(SLEEP_GAP_MS).toBeLessThan(60 * 60_000);
		t.live.stop();
	});

	it("reconnects at once when the tab comes back with an expired JWT", async () => {
		const t = setup();
		t.live.start();
		await flush();
		t.last().connected();
		// The tab was frozen past the JWT's expiry. Its socket still claims to be open.
		vi.setSystemTime(Date.now() + 901_000);
		t.live.check();
		await flush();
		expect(t.sockets).toHaveLength(2);
		expect(t.last().jwt).toBe("jwt-2");
		t.live.stop();
	});

	it("just pings when the tab comes back and all is well", async () => {
		const t = setup();
		t.live.start();
		await flush();
		t.last().connected();
		await vi.advanceTimersByTimeAsync(1_000);
		t.live.check();
		expect(t.sockets).toHaveLength(1);
		expect(t.last().sent).toEqual([{ type: "ping" }]);
		t.live.stop();
	});

	it("waits while offline and reconnects as soon as the network is back", async () => {
		const t = setup();
		t.live.start();
		await flush();
		t.last().connected();
		t.setOnline(false);
		t.live.offline();
		expect(t.live.current).toBe("offline");
		expect(t.sockets[0].closedWith).toBe(1000);
		t.fetchToken.mockRejectedValue(new Error("offline"));
		await vi.advanceTimersByTimeAsync(BACKOFF_MS[0] + BACKOFF_MS[1]);
		expect(t.live.current).toBe("offline");
		t.fetchToken.mockReset();
		t.fetchToken.mockResolvedValue({
			status: "ok",
			jwt: "jwt-back",
			expiresIn: 900,
			url: "wss://fra.cloud.appwrite.io/v1/realtime",
			projectId: "demo",
			channels: [CHANNEL],
		});
		t.setOnline(true);
		t.live.online();
		await flush();
		const socket = t.last();
		expect(socket.readyState).toBe(0);
		socket.connected();
		expect(t.live.current).toBe("live");
		expect(t.connects).toEqual([false, true]);
		t.live.stop();
	});

	it("stops when the session has ended", async () => {
		const t = setup({ tokens: [{ status: "signed-out" }] });
		t.live.start();
		await flush();
		expect(t.sockets).toHaveLength(0);
		expect(t.live.current).toBe("signed-out");
		await vi.advanceTimersByTimeAsync(120_000);
		expect(t.fetchToken).toHaveBeenCalledTimes(1);
	});

	it("retries when the first token request fails", async () => {
		const t = setup();
		t.fetchToken.mockRejectedValueOnce(new Error("500"));
		t.live.start();
		await flush();
		expect(t.sockets).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]);
		expect(t.sockets).toHaveLength(1);
		t.live.stop();
	});

	it("gives up on a token request that hangs, and the network coming back wins", async () => {
		const t = setup();
		t.live.start();
		await flush();
		t.last().connected();
		// The JWT is rejected, then the network goes down mid-request: the request never answers.
		t.last().frame({ type: "error", data: { code: 1008 } });
		t.fetchToken.mockImplementationOnce(() => new Promise(() => undefined));
		t.last().drop(1008);
		await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]);
		expect(t.fetchToken).toHaveBeenCalledTimes(2);
		expect(t.sockets).toHaveLength(1);
		// The network is back before the request times out: a new attempt starts at once.
		t.live.online();
		await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
		await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]);
		expect(t.sockets.length).toBeGreaterThanOrEqual(2);
		t.last().connected();
		expect(t.live.current).toBe("live");
		t.live.stop();
	});

	it("retries a handshake that never finishes", async () => {
		const t = setup();
		t.live.start();
		await flush();
		const stuck = t.last();
		// No "connected" frame and no close.
		await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS + TICK_MS);
		expect(stuck.closedWith).toBe(1000);
		await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]);
		expect(t.sockets).toHaveLength(2);
		t.last().connected();
		expect(t.live.current).toBe("live");
		t.live.stop();
	});

	it("shares one token request between overlapping reconnects", async () => {
		const t = setup();
		t.live.start();
		await flush();
		t.last().connected();
		t.last().frame({ type: "error", data: { code: 1008 } });
		let answer: (value: TokenResult) => void = () => undefined;
		t.fetchToken.mockImplementationOnce(
			() =>
				new Promise<TokenResult>((resolve) => {
					answer = resolve;
				}),
		);
		t.live.online();
		t.live.check();
		t.live.online();
		await flush();
		expect(t.fetchToken).toHaveBeenCalledTimes(2);
		answer({
			status: "ok",
			jwt: "jwt-shared",
			expiresIn: 900,
			url: "wss://fra.cloud.appwrite.io/v1/realtime",
			projectId: "demo",
			channels: [CHANNEL],
		});
		await flush();
		expect(t.sockets).toHaveLength(2);
		expect(t.last().jwt).toBe("jwt-shared");
		t.live.stop();
	});

	it("leaves nothing running after stop", async () => {
		const t = setup();
		t.live.start();
		await flush();
		const socket = t.last();
		socket.connected();
		t.live.stop();
		expect(socket.closedWith).toBe(1000);
		await vi.advanceTimersByTimeAsync(3_600_000);
		expect(t.sockets).toHaveLength(1);
		expect(t.fetchToken).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("coalesce", () => {
	it("runs once for a burst", async () => {
		const fn = vi.fn(async () => undefined);
		const run = coalesce(fn, 250);
		for (let i = 0; i < 50; i++) run();
		await vi.advanceTimersByTimeAsync(250);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("runs again after a call that came in while it was running", async () => {
		let release: () => void = () => undefined;
		const fn = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		const run = coalesce(fn, 250);
		run();
		await vi.advanceTimersByTimeAsync(250);
		expect(fn).toHaveBeenCalledTimes(1);
		run();
		await vi.advanceTimersByTimeAsync(250);
		expect(fn).toHaveBeenCalledTimes(1);
		release();
		await vi.advanceTimersByTimeAsync(250);
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("keeps going after a failed run", async () => {
		const fn = vi
			.fn<() => Promise<void>>()
			.mockRejectedValueOnce(new Error("500"))
			.mockResolvedValue(undefined);
		const run = coalesce(fn, 10);
		run();
		await vi.advanceTimersByTimeAsync(10);
		run();
		await vi.advanceTimersByTimeAsync(10);
		expect(fn).toHaveBeenCalledTimes(2);
	});
});
