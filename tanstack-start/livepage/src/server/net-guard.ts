// Stops the Site being used to reach its own network. An AI endpoint is typed in by a workspace
// admin, and an image URL comes back from the provider, so neither can be trusted to point at the
// public internet. Addresses are checked after resolving DNS, on every request, and redirects are
// never followed (the callers pass redirect: "error").
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class BlockedAddress extends Error {}

const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata"]);

function privateV4(ip: string) {
	const [a, b, c] = ip.split(".").map(Number);
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		a >= 224 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 0 && c === 0) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19))
	);
}

function expandV6(ip: string) {
	const [head, tail] = ip.split("::");
	const left = head ? head.split(":") : [];
	const right = tail ? tail.split(":") : [];
	const missing = 8 - left.length - right.length;
	return [...left, ...Array(Math.max(missing, 0)).fill("0"), ...right];
}

function isPrivate(ip: string): boolean {
	if (isIP(ip) === 4) return privateV4(ip);
	const lower = ip.toLowerCase().split("%")[0];
	const mapped = lower.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped) return privateV4(mapped[1]);
	const groups = expandV6(lower).map((g) => Number.parseInt(g || "0", 16));
	// An IPv4 address carried in IPv6 (mapped, compatible or NAT64) is judged as that IPv4 address.
	const carriesV4 =
		(groups.slice(0, 5).every((g) => g === 0) &&
			(groups[5] === 0xffff || groups[5] === 0) &&
			(groups[6] !== 0 || groups[7] > 1)) ||
		(groups[0] === 0x64 &&
			groups[1] === 0xff9b &&
			groups.slice(2, 6).every((g) => g === 0));
	if (carriesV4)
		return privateV4(
			[groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join(
				".",
			),
		);
	if (groups.slice(0, 7).every((g) => g === 0))
		return groups[7] === 0 || groups[7] === 1; // :: and ::1
	if (groups[0] === 0xfe80 || (groups[0] & 0xffc0) === 0xfe80) return true;
	if ((groups[0] & 0xfe00) === 0xfc00) return true; // Unique local.
	return groups[0] >= 0xff00; // Multicast.
}

async function addressesOf(hostname: string) {
	if (isIP(hostname)) return [hostname];
	const found = await lookup(hostname, { all: true });
	return found.map((a) => a.address);
}

const bareHost = (url: URL) =>
	url.hostname.replace(/^\[|\]$/g, "").toLowerCase();

// Hosts allowed despite resolving to a private address: the one the Site owner chose at /setup
// (host and port, so an internal provider doesn't open every port on that machine), and any named
// by the LIVEPAGE_AI_ALLOW_PRIVATE_HOSTS env var (comma-separated host or host:port; "*" allows all).
function allowedPrivately(url: URL, allowHost?: string | null) {
	const hostPort = url.host.toLowerCase();
	if (allowHost && hostPort === allowHost.toLowerCase()) return true;
	const env = (process.env.LIVEPAGE_AI_ALLOW_PRIVATE_HOSTS || "")
		.split(",")
		.map((h) => h.trim().toLowerCase())
		.filter(Boolean);
	return (
		env.includes("*") || env.includes(hostPort) || env.includes(bareHost(url))
	);
}

// Refuses a URL that points at this network. Throws BlockedAddress.
export async function assertPublicUrl(raw: string, allowHost?: string | null) {
	const url = new URL(raw);
	if (url.protocol !== "http:" && url.protocol !== "https:")
		throw new BlockedAddress("Only http and https addresses are allowed.");
	const host = bareHost(url);
	if (allowedPrivately(url, allowHost)) return;
	if (METADATA_HOSTS.has(host))
		throw new BlockedAddress("That address isn't allowed.");
	const addresses = await addressesOf(host).catch(() => {
		throw new BlockedAddress("That address doesn't resolve.");
	});
	if (!addresses.length || addresses.some(isPrivate))
		throw new BlockedAddress("That address isn't allowed.");
}

// The host of an endpoint chosen during setup, if it's on a private network, so the Site can keep
// calling it afterwards. Null for a public endpoint (or one that doesn't resolve right now).
export async function privateHostOf(endpoint: string) {
	try {
		const url = new URL(endpoint);
		const addresses = await addressesOf(bareHost(url));
		return addresses.some(isPrivate) ? url.host.toLowerCase() : null;
	} catch {
		return null;
	}
}
