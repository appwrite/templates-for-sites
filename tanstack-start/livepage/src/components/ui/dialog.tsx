import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "../icons";

const FOCUSABLE =
	"button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";

// A modal with a focus trap. Closes on Escape and on a click outside.
export function Dialog({
	open,
	onClose,
	title,
	description,
	children,
	width = 440,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	description?: ReactNode;
	children: ReactNode;
	width?: number;
}) {
	const panel = useRef<HTMLDivElement>(null);
	const previous = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (!open) return;
		previous.current = document.activeElement as HTMLElement | null;
		requestAnimationFrame(() => {
			// Something inside already took focus, like a comment box opening with the dialog.
			if (panel.current?.contains(document.activeElement)) return;
			const first =
				panel.current?.querySelector<HTMLElement>("[autofocus]") ||
				panel.current?.querySelector<HTMLElement>(FOCUSABLE);
			first?.focus();
		});
		return () => {
			previous.current?.focus();
		};
	}, [open]);

	// Focus falls back to the page when the focused control goes away, as a comment composer does
	// after posting. The panel's own onKeyDown no longer sees those keys.
	useEffect(() => {
		if (!open) return;
		const onDocumentKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && document.activeElement === document.body)
				onClose();
		};
		document.addEventListener("keydown", onDocumentKey);
		return () => document.removeEventListener("keydown", onDocumentKey);
	}, [open, onClose]);

	if (!open) return null;

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			e.stopPropagation();
			onClose();
			return;
		}
		if (e.key !== "Tab" || !panel.current) return;
		const nodes = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
		if (!nodes.length) return;
		const first = nodes[0];
		const last = nodes[nodes.length - 1];
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	};

	return createPortal(
		// biome-ignore lint/a11y/noStaticElementInteractions: the overlay only catches outside clicks
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 max-md:items-end max-md:p-0"
			onMouseDown={(e) => e.target === e.currentTarget && onClose()}
			onKeyDown={onKeyDown}
		>
			<div
				ref={panel}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				className="relative flex max-h-[85dvh] w-full flex-col rounded-lg bg-paper shadow-pop max-md:max-h-[92dvh] max-md:rounded-b-none max-md:rounded-t-2xl max-md:pb-safe"
				style={{ maxWidth: width }}
			>
				<div
					aria-hidden="true"
					className="absolute left-1/2 top-2 h-1 w-9 -translate-x-1/2 rounded-full bg-rule-strong md:hidden"
				/>
				<div className="flex items-start gap-3 p-5 pb-3 max-md:pt-6">
					<div className="min-w-0 flex-1">
						<h2
							className="text-md font-semibold text-ink"
							style={{
								fontFamily: "var(--font-sans)",
								letterSpacing: "-0.01em",
							}}
						>
							{title}
						</h2>
						{description && (
							<p className="mt-1 text-sm text-graphite">{description}</p>
						)}
					</div>
					<button
						type="button"
						aria-label="Close"
						onClick={onClose}
						className="flex size-7 shrink-0 items-center justify-center rounded-md text-pencil hover:bg-wash-2 hover:text-ink coarse:-m-1.5 coarse:size-10"
					>
						<CloseIcon />
					</button>
				</div>
				<div className="overflow-auto px-5 pb-5">{children}</div>
			</div>
		</div>,
		document.body,
	);
}
