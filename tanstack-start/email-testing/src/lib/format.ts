export function relativeTime(iso: string, now = Date.now()) {
	const diff = Math.max(0, now - Date.parse(iso));
	const s = Math.floor(diff / 1000);
	if (s < 10) return "now";
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h`;
	const d = Math.floor(h / 24);
	if (d === 1) return "Yesterday";
	if (d < 7) return `${d}d`;
	return new Date(iso).toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
	});
}

// "just now", "4m ago", "yesterday", "on 2 Nov"
export function ago(iso: string, now = Date.now()) {
	const r = relativeTime(iso, now);
	if (r === "now") return "just now";
	if (/^\d+[smhd]$/.test(r)) return `${r} ago`;
	return r === "Yesterday" ? "yesterday" : `on ${r}`;
}

export function longDate(iso: string) {
	const date = new Date(iso);
	return date.toLocaleString(undefined, {
		weekday: "short",
		day: "numeric",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

export function clock(iso: string) {
	return new Date(iso).toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});
}

export function shortDate(iso: string) {
	return new Date(iso).toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

export function daysLeft(iso: string, now = Date.now()) {
	return Math.ceil((Date.parse(iso) - now) / 86_400_000);
}

export function bytes(n: number) {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name: string, email = "") {
	const source = name.trim() || email;
	const parts = source.split(/[\s@._-]+/).filter(Boolean);
	return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

// Splits "inbox-6720…appwrite.email" before ".appwrite.email" so the sidebar wraps at a sensible place.
export function splitDomain(domain: string) {
	const i = domain.indexOf(".appwrite.email");
	return i > 0 ? [domain.slice(0, i), domain.slice(i)] : [domain, ""];
}

export function randomMailbox(prefix = "test") {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	let out = "";
	for (let i = 0; i < 4; i++)
		out += chars[Math.floor(Math.random() * chars.length)];
	return `${prefix}-${out}`;
}
