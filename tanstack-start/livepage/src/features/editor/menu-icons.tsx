// Icons for the block menu and bubble toolbar (board 77). They follow the text colour.
import type { ReactNode } from "react";

function Line({ size = 14, children }: { size?: number; children: ReactNode }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			style={{ flexShrink: 0 }}
		>
			{children}
		</svg>
	);
}

export const TurnIcon = () => (
	<Line>
		<path d="M3 6.5A3.5 3.5 0 0 1 6.5 3H12M10 1l2 2-2 2M13 9.5A3.5 3.5 0 0 1 9.5 13H4m2 2-2-2 2-2" />
	</Line>
);

export const CopyIcon = () => (
	<Line>
		<rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
		<path d="M10.5 3.5A1.5 1.5 0 0 0 9 2H4a2 2 0 0 0-2 2v5a1.5 1.5 0 0 0 1.5 1.5" />
	</Line>
);

export const MoveIcon = () => (
	<Line>
		<path d="M2 8h9M8 4.5 11.5 8 8 11.5M14 3v10" />
	</Line>
);

export const CommentIcon = () => (
	<Line>
		<path d="M2.5 4A1.5 1.5 0 0 1 4 2.5h8A1.5 1.5 0 0 1 13.5 4v6a1.5 1.5 0 0 1-1.5 1.5H6.5L3.5 14v-2.5A1 1 0 0 1 2.5 10.5z" />
	</Line>
);

export const LinkIcon = () => (
	<Line>
		<path d="M6.5 9.5a3 3 0 0 0 4.3 0l2.2-2.2a3 3 0 0 0-4.3-4.3L7.8 4M9.5 6.5a3 3 0 0 0-4.3 0L3 8.7A3 3 0 0 0 7.3 13l.9-1" />
	</Line>
);

export const DateIcon = () => (
	<Line size={15}>
		<rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
		<path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
	</Line>
);

export const Sparkle = ({ size = 14 }: { size?: number }) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 14 14"
		fill="currentColor"
		aria-hidden="true"
		style={{ flexShrink: 0 }}
	>
		<path d="M7 1.5 8.3 5.7 12.5 7 8.3 8.3 7 12.5 5.7 8.3 1.5 7l4.2-1.3z" />
	</svg>
);
