// A floating list for slash commands and the mention picker. The editor keeps focus; arrows and Enter
// arrive through the Suggestion plugin's key handler, so this never steals the caret.
import type { Editor, Range } from "@tiptap/core";
import type {
	SuggestionKeyDownProps,
	SuggestionProps,
} from "@tiptap/suggestion";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { usePhone } from "#/components/ui";

// Above the editing bar and the keyboard, full width.
const PHONE_STYLE: React.CSSProperties = {
	position: "fixed",
	left: 8,
	right: 8,
	bottom: "calc(80px + env(safe-area-inset-bottom) + var(--lp-kb, 0px))",
	zIndex: 60,
};

type PopupState<T> = {
	open: boolean;
	items: T[];
	selected: number;
	rect: DOMRect | null;
	command: ((item: T) => void) | null;
	query: string;
};

export class PopupStore<T> {
	private state: PopupState<T> = {
		open: false,
		items: [],
		selected: 0,
		rect: null,
		command: null,
		query: "",
	};
	private listeners = new Set<() => void>();

	subscribe = (fn: () => void) => {
		this.listeners.add(fn);
		return () => {
			this.listeners.delete(fn);
		};
	};
	getSnapshot = () => this.state;

	set(patch: Partial<PopupState<T>>) {
		this.state = { ...this.state, ...patch };
		for (const fn of this.listeners) fn();
	}

	close() {
		if (this.state.open) this.set({ open: false });
	}
}

// Plugs a store into a Suggestion plugin's `render` option.
export function popupRender<T>(
	store: PopupStore<T>,
	onSpace?: () => boolean,
	onDismiss?: (editor: Editor, range: Range) => void,
) {
	let last: SuggestionProps<T, T> | null = null;
	const dismiss = () => {
		store.close();
		if (last) onDismiss?.(last.editor, last.range);
		last = null;
	};
	return () => ({
		onStart: (props: SuggestionProps<T, T>) => {
			last = props;
			store.set({
				open: true,
				items: props.items,
				selected: 0,
				rect: props.clientRect?.() ?? null,
				command: (item: T) => props.command(item),
				query: props.query,
			});
		},
		onUpdate: (props: SuggestionProps<T, T>) => {
			last = props;
			const current = store.getSnapshot();
			store.set({
				items: props.items,
				selected: Math.min(
					current.selected,
					Math.max(props.items.length - 1, 0),
				),
				rect: props.clientRect?.() ?? null,
				command: (item: T) => props.command(item),
				query: props.query,
			});
		},
		onKeyDown: ({ event }: SuggestionKeyDownProps) => {
			const current = store.getSnapshot();
			if (!current.open) return false;
			if (event.key === "Escape") {
				dismiss();
				return true;
			}
			if (event.key === " " && onSpace?.()) return true;
			if (!current.items.length) return false;
			if (event.key === "ArrowDown") {
				store.set({
					selected: (current.selected + 1) % current.items.length,
				});
				return true;
			}
			if (event.key === "ArrowUp") {
				store.set({
					selected:
						(current.selected - 1 + current.items.length) %
						current.items.length,
				});
				return true;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				const item = current.items[current.selected];
				if (item) current.command?.(item);
				return true;
			}
			return false;
		},
		onExit: dismiss,
	});
}

export function Popup<T>({
	store,
	width = 340,
	render,
	label,
}: {
	store: PopupStore<T>;
	width?: number;
	label: string;
	render: (
		item: T,
		index: number,
		selected: boolean,
		choose: () => void,
		hover: () => void,
	) => ReactNode;
}) {
	const state = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
	const ref = useRef<HTMLDivElement>(null);
	const phone = usePhone();
	// Starts fixed at its final width, so the first measurement isn't the full width of the page.
	const [style, setStyle] = useState<React.CSSProperties>({
		visibility: "hidden",
		position: "fixed",
		top: 0,
		left: 0,
		width,
		zIndex: 60,
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: placement depends on the caret rect and the item count
	useLayoutEffect(() => {
		if (!state.open || !state.rect || !ref.current || phone) return;
		const box = ref.current.getBoundingClientRect();
		const margin = 8;
		let top = state.rect.bottom + margin;
		if (top + box.height > window.innerHeight - margin)
			top = Math.max(margin, state.rect.top - box.height - margin);
		setStyle({
			position: "fixed",
			left: Math.max(
				margin,
				Math.min(state.rect.left, window.innerWidth - box.width - margin),
			),
			top,
			width,
			zIndex: 60,
		});
	}, [state.open, state.rect, state.items.length, width, phone]);

	useEffect(() => {
		const list = ref.current;
		if (!list || !state.open) return;
		list
			.querySelector<HTMLElement>(`[data-index="${state.selected}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [state.selected, state.open]);

	if (!state.open || !state.items.length) return null;
	return createPortal(
		<div
			ref={ref}
			role="listbox"
			aria-label={label}
			style={phone ? PHONE_STYLE : style}
			className="max-h-[380px] overflow-y-auto rounded-lg border border-rule bg-paper p-1.5 shadow-pop max-md:max-h-[42dvh] max-md:rounded-xl"
		>
			{state.items.map((item, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: the list is replaced wholesale on each keystroke
				<div key={index} data-index={index}>
					{render(
						item,
						index,
						index === state.selected,
						() => state.command?.(item),
						() => store.set({ selected: index }),
					)}
				</div>
			))}
		</div>,
		document.body,
	);
}
