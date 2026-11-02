import type { SVGProps } from "react";

// Stroke icons drawn on a 24px grid, sized by the size prop.
const PATHS: Record<string, string[]> = {
	inbox: [
		"M22 12h-6l-2 3h-4l-2-3H2",
		"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
	],
	code: ["m16 18 6-6-6-6", "m8 6-6 6 6 6"],
	settings: [
		"M20 7h-9",
		"M14 17H5",
		"M17 17a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
		"M4 7a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
	],
	search: ["m21 21-4.34-4.34", "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z"],
	plus: ["M5 12h14", "M12 5v14"],
	copy: ["M8 8h12v12H8z", "M4 16V4h12"],
	external: [
		"M15 3h6v6",
		"M10 14 21 3",
		"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
	],
	trash: [
		"M3 6h18",
		"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
		"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
	],
	up: ["m18 15-6-6-6 6"],
	down: ["m6 9 6 6 6-6"],
	left: ["m15 18-6-6 6-6"],
	link: [
		"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71",
		"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
	],
	clip: [
		"m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48",
	],
	check: ["M20 6 9 17l-5-5"],
	x: ["M18 6 6 18", "m6 6 12 12"],
	refresh: ["M21 12a9 9 0 1 1-2.64-6.36L21 8", "M21 3v5h-5"],
	lock: ["M5 11h14v10H5z", "M7 11V7a5 5 0 0 1 10 0v4"],
	shield: [
		"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
	],
	shieldCheck: [
		"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
		"m9 12 2 2 4-4",
	],
	server: ["M2 3h20v8H2z", "M2 13h20v8H2z", "M6 7h.01", "M6 17h.01"],
	monitor: ["M2 3h20v14H2z", "M8 21h8", "M12 17v4"],
	phone: ["M7 2h10v20H7z", "M12 18h.01"],
	mail: ["m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7", "M2 4h20v16H2z"],
	alert: [
		"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
		"M12 9v4",
		"M12 17h.01",
	],
	clock: ["M12 6v6l4 2", "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z"],
	arrowRight: ["M5 12h14", "m12 5 7 7-7 7"],
	updown: ["m7 15 5 5 5-5", "m7 9 5-5 5 5"],
	logout: [
		"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",
		"m16 17 5-5-5-5",
		"M21 12H9",
	],
	braces: [
		"M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1",
		"M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1",
	],
	file: [
		"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z",
		"M14 2v4a2 2 0 0 0 2 2h4",
	],
	download: [
		"M12 15V3",
		"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",
		"m7 10 5 5 5-5",
	],
	more: ["M12 12h.01", "M19 12h.01", "M5 12h.01"],
	sun: [
		"M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
		"M12 2v2",
		"M12 20v2",
		"m4.93 4.93 1.41 1.41",
		"m17.66 17.66 1.41 1.41",
		"M2 12h2",
		"M20 12h2",
		"m6.34 17.66-1.41 1.41",
		"m19.07 4.93-1.41 1.41",
	],
	moon: ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"],
};

export type IconName = keyof typeof PATHS;

export function Icon({
	name,
	size = 16,
	strokeWidth = 1.75,
	...rest
}: {
	name: IconName;
	size?: number;
	strokeWidth?: number;
} & SVGProps<SVGSVGElement>) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{...rest}
		>
			{PATHS[name].map((d) => (
				<path key={d} d={d} />
			))}
		</svg>
	);
}

export function Spinner({ size = 16 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			className="spin"
			aria-hidden="true"
		>
			<circle
				cx="12"
				cy="12"
				r="9"
				fill="none"
				stroke="var(--rule-strong)"
				strokeWidth="2.5"
			/>
			<path
				d="M21 12a9 9 0 0 0-9-9"
				fill="none"
				stroke="var(--ink)"
				strokeWidth="2.5"
				strokeLinecap="round"
			/>
		</svg>
	);
}

export function Logo({ size = 26 }: { size?: number }) {
	return (
		<span
			className="inline-flex items-center justify-center rounded-md font-mono font-semibold"
			style={{
				width: size,
				height: size,
				background: "var(--hl)",
				color: "#0e0e0e",
				fontSize: size * 0.42,
				boxShadow: "inset 0 0 0 1px var(--hl-ring)",
			}}
			aria-hidden="true"
		>
			*@
		</span>
	);
}
