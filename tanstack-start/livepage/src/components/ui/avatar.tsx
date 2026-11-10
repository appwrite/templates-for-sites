import { useSyncExternalStore } from "react";
import { SparkleFilled } from "../icons";

// Profile photos, by user id. Filled once per workspace; every Avatar on screen picks them up.
let avatars: Record<string, string> = {};
const avatarListeners = new Set<() => void>();

export function setAvatars(next: Record<string, string>) {
	avatars = next;
	for (const fn of avatarListeners) fn();
}

function useAvatarFile(id: string) {
	return useSyncExternalStore(
		(fn) => {
			avatarListeners.add(fn);
			return () => avatarListeners.delete(fn);
		},
		() => avatars[id] ?? null,
		() => null,
	);
}

const COLORS = [
	"var(--color-coral)",
	"var(--color-violet)",
	"var(--color-green)",
	"var(--color-amber)",
	"var(--color-link)",
];

export function colorFor(id: string) {
	let hash = 0;
	for (let i = 0; i < id.length; i++)
		hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
	return COLORS[hash % COLORS.length];
}

export function initials(name: string) {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (!parts.length) return "?";
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
	id,
	name,
	size = 28,
	ring,
	title,
	ai,
}: {
	id: string;
	name: string;
	size?: number;
	ring?: boolean;
	title?: string;
	ai?: boolean;
}) {
	const label = size < 24 ? initials(name).slice(0, 1) : initials(name);
	const fileId = useAvatarFile(id);
	if (fileId && !ai)
		return (
			<img
				src={`/api/files/${fileId}`}
				alt={title ?? name}
				width={size}
				height={size}
				className="shrink-0 rounded-full object-cover"
				style={{ width: size, height: size }}
			/>
		);
	return (
		<div
			title={title ?? name}
			className="flex shrink-0 items-center justify-center rounded-full font-semibold text-paper"
			style={{
				width: size,
				height: size,
				backgroundColor: ai ? "var(--color-accent)" : colorFor(id),
				fontSize: 12,
				boxShadow: ring ? "0 0 0 2px var(--color-paper)" : undefined,
			}}
		>
			{ai ? <SparkleFilled size={size * 0.5} /> : label}
		</div>
	);
}

// Overlapping faces, up to `max`. The trailing +N says how many more.
export function AvatarStack({
	people,
	size = 28,
	max = 4,
	ringColor = "var(--color-paper)",
}: {
	people: { id: string; name: string; ai?: boolean }[];
	size?: number;
	max?: number;
	ringColor?: string;
}) {
	const shown = people.slice(0, max);
	const extra = people.length - shown.length;
	return (
		<div className="flex items-center">
			{shown.map((person, index) => (
				<div
					key={person.id}
					className="relative rounded-full"
					style={{
						marginLeft: index ? -size * 0.14 : 0,
						border: `2px solid ${ringColor}`,
					}}
				>
					<Avatar
						id={person.id}
						name={person.name}
						size={size - 4}
						ai={person.ai}
					/>
				</div>
			))}
			{extra > 0 && <span className="ml-1 text-xs text-pencil">+{extra}</span>}
		</div>
	);
}
