// Icons drawn on the Paper boards. Strokes follow currentColor so they work in both themes.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({
	size = 16,
	children,
	viewBox = "0 0 16 16",
	...rest
}: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox={viewBox}
			fill="none"
			stroke="currentColor"
			strokeWidth={1.4}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			style={{ flexShrink: 0 }}
			{...rest}
		>
			{children}
		</svg>
	);
}

export const SearchIcon = (p: IconProps) => (
	<Icon {...p}>
		<circle cx="7" cy="7" r="4.5" />
		<path d="m10.5 10.5 3 3" />
	</Icon>
);
export const HomeIcon = (p: IconProps) => (
	<Icon {...p}>
		<path d="M2.5 7 8 2.5 13.5 7v6.5h-11z" />
	</Icon>
);
export const InboxIcon = (p: IconProps) => (
	<Icon {...p}>
		<path d="M2.5 9.5 4 3h8l1.5 6.5v4h-11zM2.5 9.5H6l1 1.5h2l1-1.5h3.5" />
	</Icon>
);
export const MapIcon = (p: IconProps) => (
	<Icon {...p}>
		<path d="M8 3.5 3.5 12M8 3.5l4.5 8.5M3.5 12h9" strokeWidth={1.2} />
		<circle cx="8" cy="3.5" r="2" fill="var(--color-wash)" />
		<circle cx="3.5" cy="12" r="2" fill="var(--color-wash)" />
		<circle cx="12.5" cy="12" r="2" fill="var(--color-wash)" />
	</Icon>
);
export const ChevronRight = (p: IconProps) => (
	<Icon size={12} viewBox="0 0 12 12" {...p}>
		<path d="m4.5 3 3 3-3 3" />
	</Icon>
);
export const ChevronDown = (p: IconProps) => (
	<Icon size={12} viewBox="0 0 12 12" {...p}>
		<path d="m3 4.5 3 3 3-3" />
	</Icon>
);
export const ChevronsUpDown = (p: IconProps) => (
	<Icon size={14} viewBox="0 0 14 14" {...p}>
		<path d="M4 5.5 7 2.5l3 3M4 8.5l3 3 3-3" />
	</Icon>
);
export const TableIcon = (p: IconProps) => (
	<Icon size={12} viewBox="0 0 12 12" strokeWidth={1.2} {...p}>
		<rect x="1.5" y="1.5" width="9" height="9" rx="1.5" />
		<path d="M1.5 4.5h9M4.5 4.5v6" />
	</Icon>
);
export const PageIcon = (p: IconProps) => (
	<Icon size={12} viewBox="0 0 12 12" strokeWidth={1.2} {...p}>
		<path d="M3 1.5h4l2 2v7H3z" />
		<path d="M7 1.5v2h2" />
	</Icon>
);
export const GearIcon = (p: IconProps) => (
	<Icon {...p}>
		<circle cx="8" cy="8" r="2" />
		<path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
	</Icon>
);
export const PlusIcon = (p: IconProps) => (
	<Icon {...p}>
		<path d="M8 3.5v9M3.5 8h9" />
	</Icon>
);
export const MoreIcon = (p: IconProps) => (
	<Icon {...p} stroke="none" fill="currentColor">
		<circle cx="3.5" cy="8" r="1.2" />
		<circle cx="8" cy="8" r="1.2" />
		<circle cx="12.5" cy="8" r="1.2" />
	</Icon>
);
export const TrashIcon = (p: IconProps) => (
	<Icon {...p}>
		<path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9" />
	</Icon>
);
export const StarIcon = (p: IconProps) => (
	<Icon {...p}>
		<path d="m8 2 1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z" />
	</Icon>
);
export const CloseIcon = (p: IconProps) => (
	<Icon {...p}>
		<path d="m4 4 8 8M12 4l-8 8" />
	</Icon>
);
export const CheckIcon = (p: IconProps) => (
	<Icon {...p}>
		<path d="m3.5 8.5 3 3 6-7" />
	</Icon>
);
export const LogoutIcon = (p: IconProps) => (
	<Icon {...p}>
		<path d="M6.5 2.5h-3v11h3M10 5l3 3-3 3M13 8H6" />
	</Icon>
);
export const PersonIcon = (p: IconProps) => (
	<Icon {...p}>
		<circle cx="8" cy="5.5" r="2.75" />
		<path d="M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" />
	</Icon>
);
export const TemplatesIcon = (p: IconProps) => (
	<Icon {...p}>
		<rect x="2.5" y="2.5" width="11" height="4" rx="1" />
		<rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
		<rect x="9" y="9" width="4.5" height="4.5" rx="1" />
	</Icon>
);
export const MoonIcon = (p: IconProps) => (
	<Icon {...p}>
		<path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" />
	</Icon>
);

export function SparkleFilled({ size = 14 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 14 14"
			aria-hidden="true"
			style={{ flexShrink: 0 }}
		>
			<path
				d="M7 1.5 8.3 5.7 12.5 7 8.3 8.3 7 12.5 5.7 8.3 1.5 7l4.2-1.3z"
				fill="currentColor"
			/>
		</svg>
	);
}

export function Logo({ size = 16 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="none"
			stroke="var(--color-paper)"
			strokeWidth={1.6}
			aria-hidden="true"
			style={{ flexShrink: 0 }}
		>
			<circle cx="6" cy="8" r="4" />
			<circle cx="10" cy="8" r="4" />
		</svg>
	);
}
