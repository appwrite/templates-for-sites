import {
	type ReactNode,
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { usePhone } from "./use-phone";

// Places content next to an anchor, in a portal, and closes on outside click or Escape.
export function Popover({
	anchor,
	open,
	onClose,
	align = "start",
	side = "bottom",
	children,
	className = "",
}: {
	anchor: RefObject<HTMLElement | null>;
	open: boolean;
	onClose: () => void;
	align?: "start" | "end";
	side?: "bottom" | "top" | "right";
	children: ReactNode;
	className?: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const phone = usePhone();
	// Fixed from the start, so the first measurement is the content's width and not the page's.
	const [style, setStyle] = useState<React.CSSProperties>({
		visibility: "hidden",
		position: "fixed",
	});

	useLayoutEffect(() => {
		if (!open || phone || !anchor.current || !ref.current) return;
		const a = anchor.current.getBoundingClientRect();
		const p = ref.current.getBoundingClientRect();
		const margin = 6;
		let left = align === "end" ? a.right - p.width : a.left;
		let top = side === "top" ? a.top - p.height - margin : a.bottom + margin;
		if (side === "right") {
			left = a.right + margin;
			top = a.top;
		}
		left = Math.min(left, window.innerWidth - p.width - 8);
		if (top + p.height > window.innerHeight - 8)
			top = Math.max(8, a.top - p.height - margin);
		setStyle({
			position: "fixed",
			left: Math.max(8, left),
			top: Math.max(8, top),
			visibility: "visible",
			zIndex: 60,
		});
	}, [open, anchor, align, side, phone]);

	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (ref.current?.contains(target) || anchor.current?.contains(target))
				return;
			// A menu opened from inside this popover lives in its own portal.
			if (target.closest?.("[data-popover]")) return;
			onClose();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open, onClose, anchor]);

	if (!open) return null;
	return createPortal(
		<>
			{phone && (
				// biome-ignore lint/a11y/noStaticElementInteractions: the scrim only catches outside taps; Escape and the close control still work
				<div
					data-popover=""
					className="lp-sheet-backdrop"
					onMouseDown={(e) => {
						e.preventDefault();
						onClose();
					}}
				/>
			)}
			<div
				ref={ref}
				data-popover=""
				style={phone ? undefined : style}
				className={
					phone
						? `lp-sheet ${className}`
						: `rounded-lg border border-rule bg-paper shadow-pop ${className}`
				}
			>
				{children}
			</div>
		</>,
		document.body,
	);
}
