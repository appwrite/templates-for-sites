// Page history (board 16): pick a version, see what changed, restore it as a normal new edit.
import type { Editor } from "@tiptap/core";
import { yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { Button, Skeleton, useToast } from "#/components/ui";
import {
	fetchVersion,
	fetchVersions,
	submitRestored,
	type VersionMeta,
} from "#/functions/versions";
import { errorText } from "#/lib/errors";
import {
	BODY_FIELD,
	digest,
	docFromUpdates,
	fromBase64,
	TITLE_FIELD,
	toBase64,
} from "./codec";
import { type PmNode, RenderBlocks, textOf } from "./render";

function when(iso: string) {
	const date = new Date(iso);
	const now = new Date();
	const time = date.toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
	});
	if (date.toDateString() === now.toDateString()) return `Today, ${time}`;
	const yesterday = new Date(now.getTime() - 86_400_000);
	if (date.toDateString() === yesterday.toDateString())
		return `Yesterday, ${time}`;
	return `${date.toLocaleDateString(undefined, { weekday: "long" })}, ${time}`;
}

type Loaded = { blocks: PmNode[]; title: string };

function loadVersion(snapshot: string): Loaded {
	const doc = docFromUpdates([fromBase64(snapshot)]);
	const blocks = yXmlFragmentToProsemirrorJSON(
		doc.getXmlFragment(BODY_FIELD),
	) as {
		content?: PmNode[];
	};
	const title = digest(doc.getXmlFragment(TITLE_FIELD)).text.trim();
	doc.destroy();
	return { blocks: blocks.content ?? [], title };
}

type DiffRow = { kind: "same" | "added" | "removed"; node: PmNode };

// Block-level difference from the version before: same text is the same block.
function diffBlocks(older: PmNode[], newer: PmNode[]): DiffRow[] {
	const a = older.map(textOf);
	const b = newer.map(textOf);
	const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
		new Array(b.length + 1).fill(0),
	);
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--)
			dp[i][j] =
				a[i] === b[j]
					? dp[i + 1][j + 1] + 1
					: Math.max(dp[i + 1][j], dp[i][j + 1]);
	const rows: DiffRow[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			rows.push({ kind: "same", node: newer[j] });
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			rows.push({ kind: "removed", node: older[i] });
			i++;
		} else {
			rows.push({ kind: "added", node: newer[j] });
			j++;
		}
	}
	while (i < a.length) rows.push({ kind: "removed", node: older[i++] });
	while (j < b.length) rows.push({ kind: "added", node: newer[j++] });
	return rows;
}

export function HistoryView({
	pageId,
	editor,
	titleEditor,
	doc,
	canEdit,
	fileHref,
	onClose,
}: {
	pageId: string;
	editor: Editor;
	titleEditor: Editor;
	doc: Y.Doc;
	canEdit: boolean;
	fileHref: (fileId: string, download?: boolean) => string;
	onClose: () => void;
}) {
	const toast = useToast();
	const [versions, setVersions] = useState<VersionMeta[] | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [selected, setSelected] = useState<Loaded | null>(null);
	const [previous, setPrevious] = useState<Loaded | null>(null);
	const [loading, setLoading] = useState(false);
	const [restoring, setRestoring] = useState(false);

	useEffect(() => {
		fetchVersions({ data: { pageId } }).then(
			(list) => {
				setVersions(list);
				setSelectedId(list[0]?.id ?? null);
			},
			(err) => toast.show(errorText(err), { tone: "error" }),
		);
	}, [pageId, toast]);

	useEffect(() => {
		if (!selectedId || !versions) return;
		const index = versions.findIndex((v) => v.id === selectedId);
		const older = versions[index + 1];
		let stale = false;
		setLoading(true);
		Promise.all([
			fetchVersion({ data: { versionId: selectedId } }),
			older ? fetchVersion({ data: { versionId: older.id } }) : null,
		])
			.then(([current, prior]) => {
				if (stale) return;
				setSelected(loadVersion(current.snapshot));
				setPrevious(prior ? loadVersion(prior.snapshot) : null);
			})
			.catch((err) => toast.show(errorText(err), { tone: "error" }))
			.finally(() => {
				if (!stale) setLoading(false);
			});
		return () => {
			stale = true;
		};
	}, [selectedId, versions, toast]);

	const rows = useMemo(
		() =>
			selected
				? previous
					? diffBlocks(previous.blocks, selected.blocks)
					: selected.blocks.map((node) => ({ kind: "same" as const, node }))
				: [],
		[selected, previous],
	);

	const restore = async () => {
		if (!selected) return;
		setRestoring(true);
		try {
			editor.commands.setContent(
				{ type: "doc", content: selected.blocks },
				{ emitUpdate: true },
			);
			titleEditor.commands.setContent(
				{
					type: "doc",
					content: [
						{
							type: "paragraph",
							content: selected.title
								? [{ type: "text", text: selected.title }]
								: [],
						},
					],
				},
				{ emitUpdate: true },
			);
			await submitRestored({
				data: {
					pageId,
					snapshot: toBase64(Y.encodeStateAsUpdate(doc)),
					title: selected.title,
				},
			});
			toast.show("Restored as a new version");
			onClose();
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
		} finally {
			setRestoring(false);
		}
	};

	const active = versions?.find((v) => v.id === selectedId) ?? null;
	return (
		<div className="flex min-h-full max-lg:flex-col-reverse">
			<div className="min-w-0 flex-1 px-[72px] pt-[68px] pb-24 max-lg:px-5 max-lg:pt-6">
				{active && (
					<p className="mb-1.5 text-[13px] text-pencil">
						Viewing {when(active.createdAt)}
					</p>
				)}
				{versions !== null && versions.length === 0 ? (
					<div className="max-w-[420px] pt-2">
						<h1 className="text-[28px] leading-8">Nothing to compare yet</h1>
						<p className="mt-2 text-base leading-[22px] text-graphite">
							Keep writing. A version is saved every few minutes, and this is
							where you can look back and restore one.
						</p>
					</div>
				) : !selected || loading ? (
					<Skeleton className="mt-2 h-40 w-full" />
				) : (
					<>
						<h1 className="text-[40px] leading-[46px]">
							{selected.title || "Untitled"}
						</h1>
						<div className="lp-prose mt-6">
							{rows.map((row, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: a static render of one version
								<div key={i} className={`lp-diff lp-diff-${row.kind}`}>
									<RenderBlocks
										nodes={[row.node]}
										options={{ fileHref, links: false }}
									/>
								</div>
							))}
						</div>
					</>
				)}
			</div>
			<aside className="sticky top-0 flex h-[calc(100dvh-48px)] w-[320px] shrink-0 flex-col border-l border-rule max-lg:static max-lg:h-auto max-lg:max-h-[40dvh] max-lg:w-full max-lg:border-b max-lg:border-l-0">
				<div className="flex items-center justify-between px-5 pt-[22px] pb-3">
					<h2 className="text-sm font-semibold text-ink">History</h2>
					<Button size="sm" variant="ghost" onClick={onClose}>
						Close
					</Button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-3">
					{versions === null ? (
						<Skeleton className="h-24 w-full" />
					) : versions.length === 0 ? (
						<p className="px-2 py-3 text-sm text-pencil">
							No history yet. Versions appear after a few minutes of editing.
						</p>
					) : (
						versions.map((v) => {
							const on = v.id === selectedId;
							return (
								<button
									key={v.id}
									type="button"
									onClick={() => setSelectedId(v.id)}
									className={`mb-0.5 flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left ${on ? "bg-link-soft" : "hover:bg-wash"}`}
								>
									<span
										className={`text-sm font-medium ${on ? "text-link" : "text-ink"}`}
									>
										{when(v.createdAt)}
										{v.kind === "restored" ? ", restored" : ""}
									</span>
									<span className="truncate text-[13px] text-pencil">
										{v.editors.join(", ") || "Edited"}
									</span>
								</button>
							);
						})
					)}
				</div>
				{canEdit && (
					<div className="p-3">
						<Button
							variant="primary"
							className="h-[38px] w-full"
							onClick={restore}
							loading={restoring}
							disabled={!selected || loading}
						>
							Restore this version
						</Button>
					</div>
				)}
			</aside>
		</div>
	);
}
