// The nested, draggable page tree in the sidebar.
import { Link } from "@tanstack/react-router";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { displayName } from "#/lib/permissions";
import type { Page, Section } from "#/lib/types";
import {
	ChevronDown,
	ChevronRight,
	MoreIcon,
	PlusIcon,
	TableIcon,
	TrashIcon,
} from "../icons";
import { Menu, type MenuItem, useMenu } from "../ui";
import { useWorkspace } from "./workspace-context";

const STORAGE_KEY = "livepage-expanded";

function readExpanded() {
	if (typeof window === "undefined") return new Set<string>();
	try {
		return new Set<string>(
			JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"),
		);
	} catch {
		return new Set<string>();
	}
}

// Shared by every tree in the sidebar, so a page can be dragged between teamspaces. Private pages
// stay private: making one visible to everyone is a sharing decision, made in Share.
const dragged: { id: string | null; shared: boolean } = {
	id: null,
	shared: false,
};

type Zone = "before" | "inside" | "after";
type Drop = { id: string; zone: Zone } | null;

function sorted(pages: Page[]) {
	return [...pages].sort(
		(a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt),
	);
}

function childrenOf(
	pages: Page[],
	parentId: string | null,
	sectionId?: string | null,
) {
	return sorted(
		pages.filter(
			(p) =>
				(p.parentId ?? null) === parentId &&
				(parentId !== null || (p.sectionId ?? null) === (sectionId ?? null)),
		),
	);
}

function isDescendant(pages: Page[], ancestorId: string, id: string): boolean {
	let current = pages.find((p) => p.id === id);
	while (current?.parentId) {
		if (current.parentId === ancestorId) return true;
		current = pages.find((p) => p.id === current?.parentId);
	}
	return false;
}

function betweenPosition(siblings: Page[], index: number) {
	const previous = siblings[index - 1]?.position;
	const next = siblings[index]?.position;
	if (previous === undefined && next === undefined) return 1;
	if (previous === undefined) return (next as number) - 1;
	if (next === undefined) return previous + 1;
	return (previous + next) / 2;
}

export function PageTree({
	section,
	pages,
}: {
	section: Section | null;
	pages: Page[];
}) {
	const { activePageId } = useWorkspace();
	const [expanded, setExpanded] = useState(readExpanded);
	const [drop, setDrop] = useState<Drop>(null);
	const roots = useMemo(
		() => childrenOf(pages, null, section?.id ?? null),
		[pages, section],
	);

	// Open the path to the page being viewed, so it's always visible in the tree.
	useEffect(() => {
		if (!activePageId) return;
		const ancestors: string[] = [];
		let current = pages.find((p) => p.id === activePageId);
		while (current?.parentId) {
			ancestors.push(current.parentId);
			current = pages.find((p) => p.id === current?.parentId);
		}
		if (ancestors.length)
			setExpanded((existing) =>
				ancestors.every((id) => existing.has(id))
					? existing
					: new Set([...existing, ...ancestors]),
			);
	}, [activePageId, pages]);

	const toggle = (id: string) => {
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
			} catch {
				// Storage full or blocked: the tree still works for this session.
			}
			return next;
		});
	};

	return (
		<ul className="flex flex-col gap-px">
			{roots.map((page) => (
				<Node
					key={page.id}
					page={page}
					pages={pages}
					depth={0}
					expanded={expanded}
					toggle={toggle}
					drop={drop}
					setDrop={setDrop}
					section={section}
				/>
			))}
		</ul>
	);
}

function Node({
	page,
	pages,
	depth,
	expanded,
	toggle,
	drop,
	setDrop,
	section,
}: {
	page: Page;
	pages: Page[];
	depth: number;
	expanded: Set<string>;
	toggle: (id: string) => void;
	drop: Drop;
	setDrop: (d: Drop) => void;
	section: Section | null;
}) {
	const { activePageId, createPage, updatePage, trashPage, workspace } =
		useWorkspace();
	const children = useMemo(() => childrenOf(pages, page.id), [pages, page.id]);
	const isOpen = expanded.has(page.id);
	const menu = useMenu();
	const [renaming, setRenaming] = useState(false);
	const renameEnding = useRef(false);
	const clickedAway = useRef(false);
	const hasChildren = children.length > 0;
	const active = activePageId === page.id;
	const isDatabase = page.kind === "database";

	// The first click of a double click opens the page, and the editor then takes focus. That
	// mustn't end the rename; only Enter, Escape, Tab or clicking elsewhere does.
	useEffect(() => {
		if (!renaming) return;
		renameEnding.current = false;
		clickedAway.current = false;
		const onPointer = (e: PointerEvent) => {
			if (!(e.target as HTMLElement).closest('[aria-label="Page name"]'))
				clickedAway.current = true;
		};
		window.addEventListener("pointerdown", onPointer, true);
		return () => window.removeEventListener("pointerdown", onPointer, true);
	}, [renaming]);

	const siblings = useMemo(
		() =>
			page.parentId
				? childrenOf(pages, page.parentId)
				: childrenOf(pages, null, page.sectionId),
		[pages, page],
	);

	const addingChild = useRef(false);
	const addChild = async () => {
		// A double click still makes one page.
		if (addingChild.current) return;
		addingChild.current = true;
		if (!isOpen) toggle(page.id);
		const last = children[children.length - 1];
		await createPage({
			parentId: page.id,
			position: last ? last.position + 1 : 1,
			visibility: page.visibility,
		});
		addingChild.current = false;
	};

	const moveTo = (id: string, zone: Zone) => {
		if (id === page.id || isDescendant(pages, id, page.id)) return;
		if (zone === "inside") {
			const last = children[children.length - 1];
			updatePage(id, {
				parentId: page.id,
				sectionId: null,
				position: last ? last.position + 1 : 1,
			});
			if (!isOpen) toggle(page.id);
			return;
		}
		const others = siblings.filter((p) => p.id !== id);
		const index = others.findIndex((p) => p.id === page.id);
		updatePage(id, {
			parentId: page.parentId,
			sectionId: page.parentId ? null : page.sectionId,
			position: betweenPosition(others, zone === "before" ? index : index + 1),
		});
	};

	const onDragOver = (e: DragEvent<HTMLDivElement>) => {
		const id = dragged.id;
		if (
			!id ||
			id === page.id ||
			dragged.shared !== (page.visibility === "workspace") ||
			isDescendant(pages, id, page.id)
		)
			return;
		e.preventDefault();
		const box = e.currentTarget.getBoundingClientRect();
		const y = (e.clientY - box.top) / box.height;
		const zone: Zone = y < 0.25 ? "before" : y > 0.75 ? "after" : "inside";
		if (drop?.id !== page.id || drop.zone !== zone)
			setDrop({ id: page.id, zone });
	};

	const items: MenuItem[] = [
		{
			id: "add",
			label: "Add page inside",
			icon: <PlusIcon size={14} />,
			onSelect: () => void addChild(),
		},
		{ id: "rename", label: "Rename", onSelect: () => setRenaming(true) },
		{ type: "separator", id: "s0" },
		{
			id: "up",
			label: "Move up",
			disabled: siblings[0]?.id === page.id,
			onSelect: () => {
				const i = siblings.findIndex((p) => p.id === page.id);
				updatePage(page.id, {
					position: betweenPosition(
						siblings.filter((p) => p.id !== page.id),
						i - 1,
					),
				});
			},
		},
		{
			id: "down",
			label: "Move down",
			disabled: siblings[siblings.length - 1]?.id === page.id,
			onSelect: () => {
				const others = siblings.filter((p) => p.id !== page.id);
				const i = siblings.findIndex((p) => p.id === page.id);
				updatePage(page.id, { position: betweenPosition(others, i + 1) });
			},
		},
		{
			id: "indent",
			label: "Move into page above",
			disabled: siblings[0]?.id === page.id,
			onSelect: () => {
				const i = siblings.findIndex((p) => p.id === page.id);
				const parent = siblings[i - 1];
				const kids = childrenOf(pages, parent.id);
				updatePage(page.id, {
					parentId: parent.id,
					sectionId: null,
					position: (kids[kids.length - 1]?.position ?? 0) + 1,
				});
				if (!expanded.has(parent.id)) toggle(parent.id);
			},
		},
		{
			id: "outdent",
			label: "Move out of parent",
			disabled: !page.parentId,
			onSelect: () => {
				const parent = pages.find((p) => p.id === page.parentId);
				if (!parent) return;
				updatePage(page.id, {
					parentId: parent.parentId,
					sectionId: parent.parentId ? null : parent.sectionId,
					position: parent.position + 0.5,
				});
			},
		},
		...(page.visibility === "workspace" && workspace.sections.length > 1
			? workspace.sections
					.filter((s) => s.id !== section?.id)
					.map(
						(s): MenuItem => ({
							id: `to-${s.id}`,
							label: `Move to ${s.name}`,
							onSelect: () =>
								updatePage(page.id, {
									parentId: null,
									sectionId: s.id,
									position:
										Math.max(
											0,
											...childrenOf(pages, null, s.id).map((p) => p.position),
										) + 1,
								}),
						}),
					)
			: []),
		{ type: "separator", id: "s1" },
		{
			id: "trash",
			label: "Move to Trash",
			danger: true,
			icon: <TrashIcon size={14} />,
			onSelect: () => trashPage(page.id),
		},
	];

	return (
		<li>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: the row is a drag target; its link and buttons are keyboard reachable */}
			<div
				draggable={!renaming}
				onDragStart={(e) => {
					dragged.id = page.id;
					dragged.shared = page.visibility === "workspace";
					e.dataTransfer.effectAllowed = "move";
				}}
				onDragEnd={() => {
					dragged.id = null;
					setDrop(null);
				}}
				onDragOver={onDragOver}
				onDragLeave={() => drop?.id === page.id && setDrop(null)}
				onDrop={(e) => {
					e.preventDefault();
					if (dragged.id && drop) moveTo(dragged.id, drop.zone);
					setDrop(null);
				}}
				className={`group relative flex h-8 items-center gap-1 rounded-md pr-1 coarse:h-10 ${active ? "bg-link-soft" : "hover:bg-wash-2"} ${drop?.id === page.id && drop.zone === "inside" ? "ring-1 ring-link" : ""}`}
				style={{ paddingLeft: 8 + depth * 20 }}
			>
				{drop?.id === page.id && drop.zone !== "inside" && (
					<div
						className={`absolute inset-x-1 h-0.5 rounded-full bg-accent ${drop.zone === "before" ? "top-0" : "bottom-0"}`}
					/>
				)}
				{hasChildren ? (
					<button
						type="button"
						aria-label={isOpen ? "Collapse" : "Expand"}
						aria-expanded={isOpen}
						onClick={() => toggle(page.id)}
						className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-pencil hover:bg-wash-2 coarse:-my-3 coarse:-ml-1 coarse:h-10 coarse:w-8"
					>
						{isOpen ? <ChevronDown /> : <ChevronRight />}
					</button>
				) : (
					<span className="flex h-4 w-4 shrink-0 items-center justify-center text-pencil">
						{isDatabase && <TableIcon />}
					</span>
				)}
				{renaming ? (
					<input
						ref={(el) => el?.focus()}
						defaultValue={page.title}
						aria-label="Page name"
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								renameEnding.current = true;
								e.currentTarget.blur();
							}
							if (e.key === "Escape") setRenaming(false);
						}}
						onBlur={(e) => {
							if (
								!renameEnding.current &&
								!clickedAway.current &&
								!e.relatedTarget
							) {
								e.currentTarget.focus();
								return;
							}
							setRenaming(false);
							const value = e.currentTarget.value.trim();
							if (value !== page.title) updatePage(page.id, { title: value });
						}}
						className="min-w-0 flex-1 rounded-sm border border-rule-strong bg-paper px-1 text-base text-ink outline-none"
					/>
				) : (
					<Link
						to="/p/$pageId"
						params={{ pageId: page.id }}
						className={`min-w-0 flex-1 truncate text-base leading-[18px] coarse:flex coarse:h-10 coarse:items-center coarse:text-[15px] ${active ? "font-medium text-link" : "text-graphite"}`}
						onDoubleClick={(e) => {
							e.preventDefault();
							setRenaming(true);
						}}
					>
						{displayName(page)}
					</Link>
				)}
				<span className="hidden items-center gap-0.5 group-focus-within:flex group-hover:flex coarse:flex">
					<button
						ref={menu.anchor}
						type="button"
						aria-label={`Options for ${displayName(page)}`}
						aria-haspopup="menu"
						onClick={menu.toggle}
						className="flex h-6 w-6 items-center justify-center rounded-sm text-pencil hover:bg-wash coarse:h-10 coarse:w-10"
					>
						<MoreIcon size={14} />
					</button>
					<button
						type="button"
						aria-label={`Add page inside ${displayName(page)}`}
						onClick={() => void addChild()}
						className="flex h-6 w-6 items-center justify-center rounded-sm text-pencil hover:bg-wash coarse:hidden"
					>
						<PlusIcon size={14} />
					</button>
				</span>
				<Menu
					anchor={menu.anchor}
					open={menu.open}
					onClose={menu.close}
					items={items}
					align="start"
					side="right"
				/>
			</div>
			{isOpen && hasChildren && (
				<ul className="flex flex-col gap-px">
					{children.map((child) => (
						<Node
							key={child.id}
							page={child}
							pages={pages}
							depth={depth + 1}
							expanded={expanded}
							toggle={toggle}
							drop={drop}
							setDrop={setDrop}
							section={section}
						/>
					))}
				</ul>
			)}
		</li>
	);
}
