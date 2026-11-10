// The side panel a row opens in (boards 23 and 74): properties and the row's own page.
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { MoreIcon } from "#/components/icons";
import {
	Avatar,
	Button,
	Menu,
	type MenuItem,
	Skeleton,
	useToast,
} from "#/components/ui";
import { PageEditor } from "#/features/editor";
import { fetchPageResolution } from "#/functions/body";
import type { PageAccess } from "#/server/body";
import { RowPropertyList } from "./RowProperties";
import type { DatabaseStore } from "./store";
import { useCellPresence } from "./ui";

const PEEK_EDITOR_CSS = `
[data-row-peek] [data-comment-rail] { display: none; }
@media (min-width: 1024px) {
	[data-row-peek] [class*="pl-[88px]"] { padding-left: 40px; padding-right: 40px; }
	[data-row-peek] [class*="-ml-[88px]"] { margin-left: -40px; margin-right: -40px; }
}
`;

export function RowPeek({
	store,
	rowId,
	onClose,
	onOpen,
}: {
	store: DatabaseStore;
	rowId: string;
	onClose: () => void;
	onOpen: (rowId: string) => void;
}) {
	const { peers, announce } = useCellPresence(store);
	const [access, setAccess] = useState<PageAccess | null>(null);
	const [error, setError] = useState<string | null>(null);
	const row = store.rows.get(rowId);
	const moreRef = useRef<HTMLButtonElement>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const toast = useToast();

	// Someone else trashing this row must not leave a blank peek behind.
	const seen = useRef(false);
	const deleting = useRef(false);
	useEffect(() => {
		if (row) seen.current = true;
		else if (seen.current && !deleting.current) {
			seen.current = false;
			onClose();
			toast.show("This row was just deleted.");
		}
	}, [row, onClose, toast]);

	// A row made a moment ago may still be on its way to the server, so wait for it first.
	useEffect(() => {
		let active = true;
		setAccess(null);
		setError(null);
		const created = store.waitForRow(rowId);
		created
			.then(() => fetchPageResolution({ data: { pageId: rowId } }))
			.then((resolution) => {
				if (!active) return;
				if (resolution.status === "ok") setAccess(resolution.access);
				else setError("You can't open this row.");
			})
			.catch(() => {
				if (active) setError("This row didn't load.");
			});
		return () => {
			active = false;
		};
	}, [rowId, store]);

	// Move focus into the peek, so typing lands in the title of a new row and not on the button
	// that opened it (where a space would press it again).
	useEffect(() => {
		(document.activeElement as HTMLElement | null)?.blur();
	}, []);
	useEffect(() => {
		if (!access || (store.rows.get(rowId)?.title ?? "")) return;
		let frames = 0;
		let handle = 0;
		const focusTitle = () => {
			const el = document.querySelector<HTMLElement>(
				'[data-row-peek] [aria-label="Page title"]',
			);
			if (el) el.focus({ preventScroll: true });
			else if (frames++ < 60) handle = requestAnimationFrame(focusTitle);
		};
		handle = requestAnimationFrame(focusTitle);
		return () => cancelAnimationFrame(handle);
	}, [access, rowId, store]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			// Popovers and menus inside the peek close first, and so does an open inline editor.
			if (document.querySelector("[data-popover],[role=dialog]")) return;
			if (document.activeElement?.closest?.("[data-row-peek] input")) return;
			onClose();
		};
		// Capture phase: this has to look before a popover's own handler closes it.
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, [onClose]);

	const peer = [...peers.values()].find((p) => p.rowId === rowId);
	const index = store.rowIds.indexOf(rowId);
	const prev = index > 0 ? store.rowIds[index - 1] : null;
	const next =
		index >= 0 && index < store.rowIds.length - 1
			? store.rowIds[index + 1]
			: null;
	const canEdit = store.access.canEdit;

	const menuItems: MenuItem[] = [
		{
			id: "duplicate",
			label: "Duplicate",
			onSelect: () => void store.duplicateRows([rowId]),
		},
		{
			id: "delete",
			label: "Delete",
			danger: true,
			onSelect: () => {
				deleting.current = true;
				void store.trashRows([rowId]).then((ok) => {
					if (ok) {
						onClose();
						toast.show("Moved 1 row to Trash", {
							action: {
								label: "Undo",
								run: () => void store.restoreRows([rowId]),
							},
						});
					}
				});
			},
		},
	];

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: backdrop catches outside clicks only
		<div
			className="fixed inset-0 z-40"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
			onKeyDown={undefined}
		>
			<div className="pointer-events-none absolute inset-0 bg-gradient-to-l from-black/8 to-transparent" />
			{/* The editor's narrow layout is keyed to the viewport, so a 606px panel on a wide screen needs it set here. */}
			<style>{PEEK_EDITOR_CSS}</style>
			<aside
				data-row-peek=""
				aria-label={row?.title || "Row"}
				className="absolute top-0 right-0 flex h-full w-full max-w-[606px] flex-col border-l border-rule bg-paper shadow-pop max-md:border-l-0"
			>
				<div className="flex h-12 shrink-0 items-center gap-3 border-b border-rule px-4 text-sm text-graphite max-md:box-content max-md:h-[52px] max-md:px-2 max-md:pt-safe">
					<button
						type="button"
						className="hover:text-ink coarse:h-10 coarse:px-2 coarse:text-[15px]"
						onClick={onClose}
					>
						Close
					</button>
					<Link
						to="/p/$pageId"
						params={{ pageId: rowId }}
						className="hover:text-ink coarse:flex coarse:h-10 coarse:items-center coarse:px-2 coarse:text-[15px]"
					>
						Open as full page
					</Link>
					<span className="flex-1" />
					{peer && <Avatar id={peer.userId} name={peer.name} size={24} />}
					{(prev || next) && (
						<span className="flex items-center gap-0.5">
							<button
								type="button"
								aria-label="Previous row"
								disabled={!prev}
								onClick={() => prev && onOpen(prev)}
								className="flex size-7 items-center justify-center rounded-md hover:bg-wash-2 hover:text-ink disabled:opacity-30 coarse:size-10"
							>
								↑
							</button>
							<button
								type="button"
								aria-label="Next row"
								disabled={!next}
								onClick={() => next && onOpen(next)}
								className="flex size-7 items-center justify-center rounded-md hover:bg-wash-2 hover:text-ink disabled:opacity-30 coarse:size-10"
							>
								↓
							</button>
						</span>
					)}
					{canEdit && (
						<>
							<button
								ref={moreRef}
								type="button"
								aria-label="Row options"
								aria-haspopup="menu"
								onClick={() => setMenuOpen((v) => !v)}
								className="flex size-7 items-center justify-center rounded-md hover:bg-wash-2 hover:text-ink coarse:size-10"
							>
								<MoreIcon size={14} />
							</button>
							<Menu
								anchor={moreRef}
								open={menuOpen}
								onClose={() => setMenuOpen(false)}
								items={menuItems}
								align="end"
							/>
						</>
					)}
				</div>
				<div className="min-h-0 flex-1 overflow-auto">
					{error ? (
						<div className="px-5 py-8 text-base text-graphite md:px-10">
							{error}
							<div className="mt-3">
								<Button onClick={onClose}>Close</Button>
							</div>
						</div>
					) : !access ? (
						<div className="px-5 pt-10 md:px-10" aria-busy="true">
							<Skeleton className="h-9 w-1/2" />
							<Skeleton className="mt-6 h-4 w-3/4" />
							<Skeleton className="mt-3 h-4 w-2/3" />
						</div>
					) : (
						<PageEditor
							key={access.page.id}
							access={access}
							header={
								<div className="mb-3">
									<RowPropertyList
										store={store}
										rowId={rowId}
										peers={peers}
										announce={announce}
									/>
								</div>
							}
						/>
					)}
				</div>
			</aside>
		</div>
	);
}
