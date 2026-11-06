// Keeps the inbox subscribed to Appwrite Realtime.
//
// The page never sees the session secret. It asks the server for a short-lived JWT made from the
// session, opens `wss://<endpoint>/realtime?project=…&jwt=…&channels[]=…` with it, and asks for a
// new one before it runs out. Appwrite ends a JWT connection at its first message after the JWT
// expires, and a socket can't swap its credentials for another JWT, so a new token means a new
// socket. The new socket opens first and the old one closes once the new one is subscribed, so no
// event falls in between.

export type RealtimeToken = {
	jwt: string;
	// Seconds the JWT has left. The browser works out its own expiry from this, so clock skew
	// between the browser and Appwrite doesn't matter.
	expiresIn: number;
	// wss://…/v1/realtime, without the query.
	url: string;
	projectId: string;
	channels: string[];
};

export type TokenResult =
	| ({ status: "ok" } & RealtimeToken)
	| { status: "signed-out" };

export type LiveStatus =
	| "connecting"
	| "live"
	| "reconnecting"
	| "offline"
	| "signed-out";

export type LiveEvent = {
	events: string[];
	channels: string[];
	payload: unknown;
};

// The parts of a browser WebSocket this uses, so tests can pass a fake one.
export type SocketLike = {
	readonly readyState: number;
	send(data: string): void;
	close(code?: number, reason?: string): void;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: ((event: { code: number; reason?: string }) => void) | null;
	onerror: ((event: unknown) => void) | null;
};

export type LiveOptions = {
	fetchToken: () => Promise<TokenResult>;
	onEvent: (event: LiveEvent) => void;
	// Called when a socket is subscribed. After a drop, `reconnect` is true and the page should
	// fetch again, because events sent while it was away are not replayed.
	onConnected: (info: { reconnect: boolean }) => void;
	onStatus: (status: LiveStatus) => void;
	// Holds the JWT for the next connection in this tab, so a page that mounts again reuses it
	// while it has time left instead of asking Appwrite for another.
	tokenStore?: { current: StoredToken | null };
	createSocket?: (url: string) => SocketLike;
	now?: () => number;
	isOnline?: () => boolean;
	random?: () => number;
};

const OPEN = 1;

// Get a new JWT this long before the current one expires.
export const ROTATE_BEFORE_MS = 2 * 60_000;
// Appwrite's own SDKs ping every 20 seconds, and Appwrite answers each ping with a pong.
export const PING_EVERY_MS = 20_000;
// A ping with no frame back for this long means the socket is dead, even if it says it's open.
export const PONG_TIMEOUT_MS = 10_000;
// How often the connection checks on itself.
export const TICK_MS = 5_000;
// Browsers run a hidden tab's timers as little as once a minute, so only a gap well past that
// means the computer slept or the tab was frozen. Events may have been missed then, so the page
// reconnects and fetches again.
export const SLEEP_GAP_MS = 3 * 60_000;
// Never rotate more often than this, even if Appwrite hands out a JWT that is about to expire.
const MIN_ROTATE_MS = 5_000;
// A token request or a socket handshake that takes longer than this is given up and retried.
export const CONNECT_TIMEOUT_MS = 15_000;
export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
// A socket has to stay subscribed this long before a drop retries at the shortest wait again.
// Otherwise one that Appwrite closes soon after subscribing would reconnect, get a JWT and
// refetch the inbox about once a second.
export const STABLE_MS = 60_000;

// Appwrite closes with 1008 (policy violation) when the JWT is expired or invalid.
const CLOSE_POLICY = 1008;

export function socketUrl(token: RealtimeToken) {
	const params = new URLSearchParams();
	params.set("project", token.projectId);
	params.set("jwt", token.jwt);
	for (const channel of token.channels) params.append("channels[]", channel);
	return `${token.url}?${params.toString()}`;
}

// https://fra.cloud.appwrite.io/v1 -> wss://fra.cloud.appwrite.io/v1/realtime
export function realtimeEndpoint(endpoint: string) {
	const url = new URL(endpoint);
	url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
	url.pathname = `${url.pathname.replace(/\/+$/, "")}/realtime`;
	url.search = "";
	url.hash = "";
	return url.toString();
}

// Seconds until a JWT's `exp`, read without checking the signature (Appwrite checks it).
export function secondsLeft(jwt: string, nowMs: number, fallback: number) {
	try {
		const part = jwt.split(".")[1] || "";
		const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
		const exp = Number(JSON.parse(json).exp);
		if (!Number.isFinite(exp)) return fallback;
		return Math.max(0, Math.min(fallback, Math.floor(exp - nowMs / 1000)));
	} catch {
		return fallback;
	}
}

export type StoredToken = RealtimeToken & { expiresAt: number };
type Token = StoredToken;

export class LiveConnection {
	private readonly options: Required<LiveOptions>;
	private socket: SocketLike | null = null;
	// During a rotation: the new socket, until Appwrite confirms its subscription.
	private next: SocketLike | null = null;
	private token: Token | null = null;
	private status: LiveStatus = "connecting";
	private attempt = 0;
	private connectedOnce = false;
	private stopped = false;
	// Each connect attempt takes a number. An attempt that finishes after a newer one started
	// (say a token request that hung while the network was down) is thrown away.
	private attemptId = 0;
	private rotating = false;
	private tokenRequest: Promise<Token | "signed-out"> | null = null;
	private socketOpenedAt = 0;
	private nextOpenedAt = 0;
	// When the current socket was subscribed, or 0.
	private liveSince = 0;
	private lastFrameAt = 0;
	private lastPingAt = 0;
	private lastTickAt = 0;
	private retryTimer: ReturnType<typeof setTimeout> | null = null;
	private rotateTimer: ReturnType<typeof setTimeout> | null = null;
	private tickTimer: ReturnType<typeof setInterval> | null = null;

	constructor(options: LiveOptions) {
		this.options = {
			createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
			now: () => Date.now(),
			isOnline: () =>
				typeof navigator === "undefined" ? true : navigator.onLine !== false,
			random: Math.random,
			...options,
			tokenStore: options.tokenStore ?? { current: null },
		};
	}

	get current() {
		return this.status;
	}

	start() {
		this.stopped = false;
		this.token ??= this.options.tokenStore.current;
		this.lastTickAt = this.now();
		this.tickTimer = setInterval(() => this.tick(), TICK_MS);
		void this.open();
	}

	stop() {
		this.stopped = true;
		this.attemptId++;
		this.clearTimer("retry");
		this.clearTimer("rotate");
		if (this.tickTimer) clearInterval(this.tickTimer);
		this.tickTimer = null;
		this.drop(this.socket);
		this.drop(this.next);
		this.socket = null;
		this.next = null;
	}

	// The tab became visible or the network came back: make sure the socket is alive and its JWT
	// has time left, and reconnect now if not.
	check() {
		if (this.stopped) return;
		const now = this.now();
		// Appwrite drops the first event after the JWT expires and closes the socket, so an expired
		// JWT means a reconnect, and the page fetches what it missed.
		if (!this.isAlive(now) || !this.token || this.token.expiresAt <= now) {
			this.reconnectNow();
			return;
		}
		if (this.token.expiresAt - now <= ROTATE_BEFORE_MS) {
			void this.rotate();
			return;
		}
		// Looks fine. A ping proves it: no pong within PONG_TIMEOUT_MS and the next tick reconnects.
		this.ping();
	}

	online() {
		if (this.stopped) return;
		this.attempt = 0;
		this.check();
	}

	offline() {
		if (this.stopped) return;
		this.clearTimer("retry");
		this.drop(this.socket);
		this.drop(this.next);
		this.socket = null;
		this.next = null;
		this.setStatus("offline");
		this.scheduleRetry();
	}

	private isAlive(now: number) {
		if (this.status !== "live" || this.socket?.readyState !== OPEN)
			return false;
		const unanswered = this.lastPingAt > this.lastFrameAt;
		return !(unanswered && now - this.lastPingAt >= PONG_TIMEOUT_MS);
	}

	// ---------- sockets ----------

	private async open() {
		if (this.stopped) return;
		const id = ++this.attemptId;
		this.clearTimer("retry");
		let token: Token | "signed-out";
		try {
			token = await this.getToken(false);
		} catch {
			if (id === this.attemptId) this.scheduleRetry();
			return;
		}
		if (this.stopped || id !== this.attemptId) return;
		if (token === "signed-out") {
			this.setStatus("signed-out");
			this.stop();
			return;
		}
		this.drop(this.socket);
		this.socket = this.connect(token);
		this.socketOpenedAt = this.now();
	}

	private async rotate() {
		if (this.stopped || this.next || this.rotating) return;
		if (this.socket?.readyState !== OPEN) {
			this.reconnectNow();
			return;
		}
		this.rotating = true;
		let token: Token | "signed-out";
		try {
			token = await this.getToken(true);
		} catch {
			// Keep the current socket and try again shortly. If its JWT runs out first, Appwrite
			// closes it and the normal reconnect takes over.
			this.rotating = false;
			this.scheduleRotate(this.backoff());
			return;
		}
		this.rotating = false;
		if (this.stopped) return;
		if (token === "signed-out") {
			this.setStatus("signed-out");
			this.stop();
			return;
		}
		this.next = this.connect(token);
		this.nextOpenedAt = this.now();
	}

	private connect(token: Token) {
		const socket = this.options.createSocket(socketUrl(token));
		socket.onmessage = (event) => this.onFrame(socket, event.data);
		socket.onclose = (event) => this.onClose(socket, event.code);
		socket.onerror = () => undefined; // A close event always follows.
		return socket;
	}

	private onFrame(socket: SocketLike, raw: unknown) {
		if (socket !== this.socket && socket !== this.next) return;
		this.lastFrameAt = this.now();
		let frame: { type?: string; data?: Record<string, unknown> };
		try {
			frame = JSON.parse(String(raw));
		} catch {
			return;
		}
		const data = frame.data || {};
		switch (frame.type) {
			case "connected": {
				if (socket === this.next) {
					// The rotation's socket is subscribed. Retire the old one.
					const old = this.socket;
					this.socket = socket;
					this.next = null;
					this.drop(old);
					this.clearTimer("retry");
					this.attempt = 0;
					this.lastPingAt = this.now();
					this.scheduleRotate();
					return;
				}
				const reconnect = this.connectedOnce;
				this.connectedOnce = true;
				this.liveSince = this.now();
				this.lastPingAt = this.now();
				this.setStatus("live");
				this.scheduleRotate();
				this.options.onConnected({ reconnect });
				return;
			}
			case "event":
				this.options.onEvent({
					events: Array.isArray(data.events) ? (data.events as string[]) : [],
					channels: Array.isArray(data.channels)
						? (data.channels as string[])
						: [],
					payload: data.payload,
				});
				return;
			case "error":
				// The JWT is invalid or expired. Don't reuse it, unless the error is about the old
				// socket's JWT while a rotation's socket uses the new one.
				if (
					(Number(data.code) === CLOSE_POLICY || Number(data.code) === 401) &&
					(socket === this.next || !this.next)
				)
					this.forgetToken();
				return;
			default:
				return;
		}
	}

	private onClose(socket: SocketLike, code: number) {
		if (socket === this.next) {
			// The rotation failed. Keep the old socket and try again.
			if (code === CLOSE_POLICY) this.forgetToken();
			this.next = null;
			if (!this.stopped) this.scheduleRotate(this.backoff());
			return;
		}
		if (socket !== this.socket) return;
		// A policy close means this socket's JWT is spent. During a rotation, this.token is
		// already the new socket's.
		if (code === CLOSE_POLICY && !this.next) this.forgetToken();
		this.socket = null;
		this.settleBackoff();
		if (this.stopped) return;
		this.setStatus(this.options.isOnline() ? "reconnecting" : "offline");
		if (this.next) {
			// A rotation's socket is still handshaking. It takes over instead of a retry, and once
			// it's subscribed the page fetches what it missed in between, like after any drop.
			this.socket = this.next;
			this.socketOpenedAt = this.nextOpenedAt;
			this.next = null;
			return;
		}
		this.scheduleRetry();
	}

	private reconnectNow() {
		if (this.stopped) return;
		this.settleBackoff();
		this.clearTimer("retry");
		const old = this.socket;
		this.socket = null;
		this.drop(old);
		this.drop(this.next);
		this.next = null;
		if (this.status === "live")
			this.setStatus(this.options.isOnline() ? "reconnecting" : "offline");
		void this.open();
	}

	// Closes a socket without reacting to its close event.
	private drop(socket: SocketLike | null) {
		if (!socket) return;
		socket.onmessage = null;
		socket.onclose = null;
		socket.onerror = null;
		try {
			socket.close(1000, "Catchall rotated or stopped the connection");
		} catch {
			// Already closed.
		}
	}

	// ---------- tokens ----------

	private async getToken(fresh: boolean): Promise<Token | "signed-out"> {
		const now = this.now();
		if (!fresh && this.token && this.token.expiresAt - now > ROTATE_BEFORE_MS)
			return this.token;
		// Callers that overlap share one request, so a burst of reconnects makes one JWT.
		if (!this.tokenRequest) {
			const request = this.requestToken();
			this.tokenRequest = request;
			request.then(
				() => this.clearTokenRequest(request),
				() => this.clearTokenRequest(request),
			);
		}
		return this.tokenRequest;
	}

	private async requestToken(): Promise<Token | "signed-out"> {
		let timer: ReturnType<typeof setTimeout> | null = null;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(new Error("The token request timed out.")),
				CONNECT_TIMEOUT_MS,
			);
		});
		try {
			const result = await Promise.race([this.options.fetchToken(), timeout]);
			if (result.status !== "ok") return "signed-out";
			const { status: _status, ...token } = result;
			this.token = { ...token, expiresAt: this.now() + token.expiresIn * 1000 };
			this.options.tokenStore.current = this.token;
			return this.token;
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	private clearTokenRequest(request: Promise<unknown>) {
		if (this.tokenRequest === request) this.tokenRequest = null;
	}

	// Appwrite rejected the JWT, so neither this connection nor the next one should use it.
	private forgetToken() {
		if (this.options.tokenStore.current === this.token)
			this.options.tokenStore.current = null;
		this.token = null;
	}

	// ---------- timers ----------

	private tick() {
		const now = this.now();
		const gap = now - this.lastTickAt;
		this.lastTickAt = now;
		if (this.stopped) return;
		// Timers don't run while the computer sleeps or the tab is frozen.
		if (gap >= SLEEP_GAP_MS) {
			this.reconnectNow();
			return;
		}
		// Handshakes that never finished.
		if (this.next && now - this.nextOpenedAt >= CONNECT_TIMEOUT_MS) {
			this.drop(this.next);
			this.next = null;
			this.scheduleRotate(this.backoff());
		}
		if (this.status !== "live") {
			if (this.socket && now - this.socketOpenedAt >= CONNECT_TIMEOUT_MS) {
				const stuck = this.socket;
				this.socket = null;
				this.drop(stuck);
				this.setStatus(this.options.isOnline() ? "reconnecting" : "offline");
				this.scheduleRetry();
			}
			return;
		}
		if (!this.isAlive(now)) {
			this.reconnectNow();
			return;
		}
		if (now - this.lastPingAt >= PING_EVERY_MS) this.ping();
	}

	private ping() {
		if (this.socket?.readyState !== OPEN) return;
		this.lastPingAt = this.now();
		try {
			this.socket.send(JSON.stringify({ type: "ping" }));
		} catch {
			// The close event handles it.
		}
	}

	// The socket went away. Retry at the shortest wait only if it had been live a while.
	private settleBackoff() {
		if (this.liveSince && this.now() - this.liveSince >= STABLE_MS)
			this.attempt = 0;
		this.liveSince = 0;
	}

	private backoff() {
		const base = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
		this.attempt++;
		// Up to 25% either way, so many tabs don't reconnect in step.
		return Math.round(base * (0.75 + this.options.random() * 0.5));
	}

	private scheduleRetry() {
		if (this.stopped) return;
		this.clearTimer("retry");
		this.retryTimer = setTimeout(() => {
			this.retryTimer = null;
			void this.open();
		}, this.backoff());
	}

	private scheduleRotate(delay?: number) {
		this.clearTimer("rotate");
		if (this.stopped || !this.token) return;
		const wait =
			delay ??
			Math.max(
				MIN_ROTATE_MS,
				this.token.expiresAt - ROTATE_BEFORE_MS - this.now(),
			);
		this.rotateTimer = setTimeout(() => {
			this.rotateTimer = null;
			void this.rotate();
		}, wait);
	}

	private clearTimer(which: "retry" | "rotate") {
		const key = which === "retry" ? "retryTimer" : "rotateTimer";
		const timer = this[key];
		if (timer) clearTimeout(timer);
		this[key] = null;
	}

	private setStatus(status: LiveStatus) {
		if (this.status === status) return;
		this.status = status;
		this.options.onStatus(status);
	}

	private now() {
		return this.options.now();
	}
}

// Runs `fn` once for a burst of calls, `wait` ms after the last one. A call while `fn` is running
// queues one more run after it, so the newest state always gets fetched.
export function coalesce(fn: () => Promise<unknown>, wait: number) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let running = false;
	let again = false;
	const run = async () => {
		timer = null;
		if (running) {
			again = true;
			return;
		}
		running = true;
		try {
			await fn();
		} catch {
			// The next event or reconnect tries again.
		} finally {
			running = false;
			if (again) {
				again = false;
				schedule();
			}
		}
	};
	const schedule = () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(run, wait);
	};
	return Object.assign(schedule, {
		cancel() {
			if (timer) clearTimeout(timer);
			timer = null;
			again = false;
		},
	});
}
