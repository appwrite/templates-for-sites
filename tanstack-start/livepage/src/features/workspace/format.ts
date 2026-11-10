// Plain-language time and name helpers shared by Home, Inbox, Map and Settings.

export function firstName(name: string) {
	return name.trim().split(/\s+/)[0] || name;
}

const WORDS = [
	"Zero",
	"One",
	"Two",
	"Three",
	"Four",
	"Five",
	"Six",
	"Seven",
	"Eight",
	"Nine",
	"Ten",
];

export function countWord(n: number) {
	return n <= 10 ? WORDS[n] : String(n);
}

export function joinNames(names: string[]) {
	if (names.length <= 1) return names[0] ?? "";
	if (names.length === 2) return `${names[0]} and ${names[1]}`;
	return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function timeAgo(iso: string, now = Date.now()) {
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return "";
	const seconds = Math.max(0, Math.floor((now - then) / 1000));
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60)
		return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
	const days = Math.floor(hours / 24);
	if (days === 1) return "yesterday";
	if (days < 7)
		return new Date(then).toLocaleDateString(undefined, { weekday: "long" });
	return new Date(then).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
}

export function dayLabel(iso: string, now = new Date()) {
	const date = new Date(iso);
	const startOf = (d: Date) =>
		new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
	if (days <= 0) return "Today";
	if (days === 1) return "Yesterday";
	if (days < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
	return date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

export function clock(iso: string) {
	const date = new Date(iso);
	if (date.toDateString() === new Date().toDateString()) return timeAgo(iso);
	return date.toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
	});
}

export function greeting(now = new Date()) {
	const hour = now.getHours();
	if (hour < 12) return "Good morning";
	if (hour < 18) return "Good afternoon";
	return "Good evening";
}
