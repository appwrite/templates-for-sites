import { type KeyboardEvent, type ReactNode, useId, useState } from "react";
import { CopyButton } from "#/components/copy-button";

export type CodeTab = {
	id: string;
	label: string;
	files: { path: string; code: string }[];
	// A line under the code, for what to do after pasting it.
	note?: ReactNode;
};

// Dark code panel with a tab per tool, used for test-runner and AI-agent setup snippets.
export function CodeTabs({
	tabs,
	className = "",
}: {
	tabs: CodeTab[];
	className?: string;
}) {
	const [active, setActive] = useState(tabs[0].id);
	const current = tabs.find((t) => t.id === active) || tabs[0];
	const base = useId();
	// Arrow keys move between tabs, as in any tab list.
	function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		const step =
			event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
		if (!step) return;
		event.preventDefault();
		const index = tabs.findIndex((t) => t.id === current.id);
		const next = tabs[(index + step + tabs.length) % tabs.length];
		setActive(next.id);
		document.getElementById(`${base}-${next.id}`)?.focus();
	}
	return (
		<div
			className={`overflow-hidden rounded-[10px] bg-[var(--code-bg)] text-[var(--code-ink)] ${className}`}
		>
			<div
				role="tablist"
				onKeyDown={onKeyDown}
				className="flex gap-5 overflow-x-auto border-b border-white/10 px-4 [scrollbar-width:none]"
			>
				{tabs.map((t) => (
					<button
						key={t.id}
						id={`${base}-${t.id}`}
						type="button"
						role="tab"
						aria-selected={t.id === current.id}
						aria-controls={`${base}-panel`}
						tabIndex={t.id === current.id ? 0 : -1}
						onClick={() => setActive(t.id)}
						className={`-mb-px h-11 shrink-0 whitespace-nowrap border-b-2 text-[14px] ${t.id === current.id ? "border-[var(--hl)] font-medium text-white" : "border-transparent text-white/60 hover:text-white"}`}
					>
						{t.label}
					</button>
				))}
			</div>
			<div
				role="tabpanel"
				id={`${base}-panel`}
				aria-labelledby={`${base}-${current.id}`}
			>
				{current.files.map((file) => (
					<div
						key={file.path}
						className="border-b border-white/10 last:border-0"
					>
						<div className="flex items-center justify-between px-5 pt-4">
							<span className="mono text-[12px] text-white/50">
								{file.path}
							</span>
							<CopyButton
								value={file.code}
								label="Copy"
								className="!text-white/60 text-[12px] hover:!text-white"
								size={13}
							/>
						</div>
						<pre className="mono overflow-x-auto px-5 pb-5 pt-3 text-[13px] leading-[22px]">
							{file.code}
						</pre>
					</div>
				))}
				{current.note ? (
					<p className="border-t border-white/10 px-5 py-3.5 text-[13px] leading-[20px] text-white/70">
						{current.note}
					</p>
				) : null}
			</div>
		</div>
	);
}
