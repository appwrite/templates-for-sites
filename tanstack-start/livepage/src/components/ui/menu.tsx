import {
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { Popover } from "./popover";

export type MenuItem =
	| {
			type?: "item";
			id: string;
			label: string;
			icon?: ReactNode;
			hint?: ReactNode;
			danger?: boolean;
			disabled?: boolean;
			onSelect: () => void;
	  }
	| { type: "separator"; id: string }
	| { type: "label"; id: string; label: string };

const actionable = (item: MenuItem) =>
	item.type !== "separator" && item.type !== "label" && !item.disabled;

// A keyboard-navigable menu: arrows, Home/End, Enter and typing the first letters.
export function Menu({
	anchor,
	open,
	onClose,
	items,
	align,
	side,
	width = 220,
}: {
	anchor: RefObject<HTMLElement | null>;
	open: boolean;
	onClose: () => void;
	items: MenuItem[];
	align?: "start" | "end";
	side?: "bottom" | "top" | "right";
	width?: number;
}) {
	const listRef = useRef<HTMLDivElement>(null);
	const [active, setActive] = useState(-1);
	const typed = useRef({ text: "", at: 0 });

	// Only when it opens: callers build `items` fresh on every render, and a live update behind an
	// open menu mustn't move the highlight or take focus back.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see above
	useEffect(() => {
		if (open) {
			setActive(items.findIndex(actionable));
			requestAnimationFrame(() => listRef.current?.focus());
		}
	}, [open]);

	const close = useCallback(() => {
		onClose();
		anchor.current?.focus();
	}, [onClose, anchor]);

	const select = (item: MenuItem) => {
		if (!actionable(item) || item.type === "separator" || item.type === "label")
			return;
		onClose();
		item.onSelect();
	};

	const move = (dir: 1 | -1) => {
		const count = items.length;
		for (let i = 1; i <= count; i++) {
			const next = (active + dir * i + count * 2) % count;
			if (actionable(items[next])) {
				setActive(next);
				return;
			}
		}
	};

	const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			move(1);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			move(-1);
		} else if (e.key === "Home") {
			e.preventDefault();
			setActive(items.findIndex(actionable));
		} else if (e.key === "End") {
			e.preventDefault();
			for (let i = items.length - 1; i >= 0; i--)
				if (actionable(items[i])) {
					setActive(i);
					break;
				}
		} else if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			if (active >= 0) select(items[active]);
		} else if (e.key === "Escape") {
			e.stopPropagation();
			close();
		} else if (e.key === "Tab") {
			close();
		} else if (e.key.length === 1) {
			const now = Date.now();
			typed.current.text =
				now - typed.current.at > 500 ? e.key : typed.current.text + e.key;
			typed.current.at = now;
			const query = typed.current.text.toLowerCase();
			const found = items.findIndex(
				(item) =>
					item.type !== "separator" &&
					item.type !== "label" &&
					actionable(item) &&
					item.label.toLowerCase().startsWith(query),
			);
			if (found >= 0) setActive(found);
		}
	};

	return (
		<Popover
			anchor={anchor}
			open={open}
			onClose={close}
			align={align}
			side={side}
			className="p-1"
		>
			<div
				ref={listRef}
				role="menu"
				tabIndex={-1}
				onKeyDown={onKey}
				className="outline-none"
				style={{ minWidth: width }}
			>
				{items.map((item, index) => {
					if (item.type === "separator")
						return <hr key={item.id} className="my-1 h-px border-0 bg-rule" />;
					if (item.type === "label")
						return (
							<div
								key={item.id}
								className="px-2 py-1 text-xs font-medium text-pencil coarse:px-3"
							>
								{item.label}
							</div>
						);
					return (
						<button
							key={item.id}
							type="button"
							role="menuitem"
							disabled={item.disabled}
							onMouseEnter={() => setActive(index)}
							onClick={() => select(item)}
							className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm disabled:opacity-50 coarse:h-11 coarse:gap-3 coarse:px-3 coarse:text-[15px] ${item.danger ? "text-coral" : "text-ink"} ${index === active ? "bg-wash-2" : ""}`}
						>
							{item.icon}
							<span className="min-w-0 flex-1 truncate">{item.label}</span>
							{item.hint && (
								<span className="text-xs text-pencil">{item.hint}</span>
							)}
						</button>
					);
				})}
			</div>
		</Popover>
	);
}

// Toggle + anchor ref for a Menu.
export function useMenu() {
	const anchor = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	return {
		anchor,
		open,
		toggle: () => setOpen((o) => !o),
		close: () => setOpen(false),
	};
}
