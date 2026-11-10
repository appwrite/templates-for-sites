// Tooltip, Skeleton, Tabs, Switch, Select.
import { type ReactNode, useId, useRef, useState } from "react";
import { CheckIcon, ChevronsUpDown } from "../icons";
import { Menu } from "./menu";

export function Tooltip({
	label,
	children,
	side = "top",
}: {
	label: string;
	children: ReactNode;
	side?: "top" | "bottom";
}) {
	const id = useId();
	return (
		<span className="group/tip relative inline-flex" aria-describedby={id}>
			{children}
			<span
				id={id}
				role="tooltip"
				className={`pointer-events-none absolute left-1/2 z-[55] -translate-x-1/2 whitespace-nowrap rounded-sm bg-ink px-1.5 py-0.5 text-xs text-paper opacity-0 transition-opacity group-hover/tip:opacity-100 group-focus-within/tip:opacity-100 ${side === "top" ? "bottom-full mb-1" : "top-full mt-1"}`}
			>
				{label}
			</span>
		</span>
	);
}

export function Skeleton({ className = "" }: { className?: string }) {
	return <div className={`animate-pulse rounded-sm bg-wash-2 ${className}`} />;
}

export function Tabs<T extends string>({
	tabs,
	value,
	onChange,
}: {
	tabs: { value: T; label: string }[];
	value: T;
	onChange: (v: T) => void;
}) {
	return (
		<div role="tablist" className="flex gap-1 border-b border-rule">
			{tabs.map((tab, index) => (
				<button
					key={tab.value}
					type="button"
					role="tab"
					tabIndex={value === tab.value ? 0 : -1}
					aria-selected={value === tab.value}
					onClick={() => onChange(tab.value)}
					onKeyDown={(e) => {
						if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
						const next =
							tabs[
								(index + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) %
									tabs.length
							];
						onChange(next.value);
						(
							e.currentTarget.parentElement?.children[tabs.indexOf(next)] as
								| HTMLElement
								| undefined
						)?.focus();
					}}
					className={`-mb-px border-b-2 px-2 pb-2 text-sm ${value === tab.value ? "border-ink font-medium text-ink" : "border-transparent text-pencil hover:text-ink"}`}
				>
					{tab.label}
				</button>
			))}
		</div>
	);
}

export function Switch({
	checked,
	onChange,
	label,
	disabled,
}: {
	checked: boolean;
	onChange: (v: boolean) => void;
	label: string;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 coarse:before:absolute coarse:before:-inset-x-2 coarse:before:-inset-y-2.5 ${checked ? "bg-accent" : "bg-rule-strong"}`}
		>
			<span
				className="inline-block h-4 w-4 rounded-full bg-white transition-transform"
				style={{ transform: `translateX(${checked ? 18 : 2}px)` }}
			/>
		</button>
	);
}

export function Select<T extends string>({
	value,
	options,
	onChange,
	label,
	disabled,
}: {
	value: T;
	options: { value: T; label: string }[];
	onChange: (v: T) => void;
	label: string;
	disabled?: boolean;
}) {
	const anchor = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const current = options.find((o) => o.value === value);
	return (
		<>
			<button
				ref={anchor}
				type="button"
				aria-label={label}
				aria-haspopup="menu"
				aria-expanded={open}
				disabled={disabled}
				onClick={() => setOpen((o) => !o)}
				className="flex h-[34px] w-full items-center gap-2 rounded-md border border-rule-strong bg-paper px-2.5 text-sm text-ink hover:border-pencil disabled:opacity-50"
			>
				<span className="min-w-0 flex-1 truncate text-left">
					{current?.label ?? ""}
				</span>
				<ChevronsUpDown className="text-pencil" />
			</button>
			<Menu
				anchor={anchor}
				open={open}
				onClose={() => setOpen(false)}
				items={options.map((option) => ({
					id: option.value,
					label: option.label,
					icon:
						option.value === value ? (
							<CheckIcon size={14} />
						) : (
							<span className="w-[14px]" />
						),
					onSelect: () => onChange(option.value),
				}))}
			/>
		</>
	);
}
