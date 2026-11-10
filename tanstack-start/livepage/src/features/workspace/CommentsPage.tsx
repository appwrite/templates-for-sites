import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	queryEqual,
	useChannel,
	useLive,
} from "#/components/shell/live-context";
import { useWorkspace } from "#/components/shell/workspace-context";
import { Button, Skeleton, Textarea, useToast } from "#/components/ui";
import { CommentRow, type MentionPerson } from "#/features/editor/CommentsRail";
import { fetchPeople } from "#/functions/body";
import {
	type Comment,
	fetchWorkspaceComments,
	submitComment,
	submitThreadResolved,
} from "#/functions/comments";
import { errorText } from "#/lib/errors";
import { COMMENTS, rowsChannel } from "#/server/schema";

type Filter = "all" | "open" | "resolved";

type Thread = {
	id: string;
	pageId: string;
	comments: Comment[];
	resolvedAt: string | null;
};

function threadsFrom(comments: Comment[]): Thread[] {
	const map = new Map<string, Comment[]>();
	for (const c of comments) {
		const id = c.threadId || c.id;
		map.set(id, [...(map.get(id) ?? []), c]);
	}
	return [...map.entries()]
		.map(([id, list]) => {
			const sorted = [...list].sort((a, b) =>
				a.createdAt.localeCompare(b.createdAt),
			);
			return {
				id,
				pageId: sorted[0].pageId,
				comments: sorted,
				resolvedAt: sorted.find((c) => c.resolvedAt)?.resolvedAt ?? null,
			};
		})
		.sort((a, b) =>
			b.comments[b.comments.length - 1].createdAt.localeCompare(
				a.comments[a.comments.length - 1].createdAt,
			),
		);
}

export function CommentsPage() {
	const { workspace, pages, viewer } = useWorkspace();
	const { onReconnect } = useLive();
	const toast = useToast();
	const [comments, setComments] = useState<Comment[] | null>(null);
	const [filter, setFilter] = useState<Filter>("open");
	const [people, setPeople] = useState<MentionPerson[]>([]);

	useEffect(() => {
		fetchPeople({ data: { workspaceId: workspace.id } }).then(
			(members) =>
				setPeople(
					members
						.filter((m) => m.userId !== viewer.userId && m.confirmed)
						.map((m) => ({
							id: m.userId,
							name: m.name || m.email,
							here: false,
						})),
				),
			() => undefined,
		);
	}, [workspace.id, viewer.userId]);

	const load = useCallback(() => {
		fetchWorkspaceComments({ data: { workspaceId: workspace.id, limit: 200 } })
			.then(setComments)
			.catch((err) => toast.show(errorText(err), { tone: "error" }));
	}, [workspace.id, toast]);

	useEffect(load, [load]);
	useEffect(() => onReconnect(load), [onReconnect, load]);
	useChannel(
		`comments-${workspace.id}`,
		[rowsChannel(COMMENTS)],
		[queryEqual("workspaceId", workspace.id)],
		load,
	);

	const threads = useMemo(() => threadsFrom(comments ?? []), [comments]);
	const shown = threads.filter((t) =>
		filter === "all"
			? true
			: filter === "open"
				? !t.resolvedAt
				: Boolean(t.resolvedAt),
	);
	const openCount = threads.filter((t) => !t.resolvedAt).length;
	const resolvedCount = threads.length - openCount;

	const pageTitle = (pageId: string) =>
		pages.find((p) => p.id === pageId)?.title?.trim() || "Untitled";

	return (
		<div className="lp-hit mx-auto w-full max-w-[760px] px-6 pb-12 pt-10 md:pt-14">
			<h1 className="font-serif text-[32px] font-medium leading-[38px] tracking-[-0.02em] text-ink">
				All comments
			</h1>
			<div className="mt-4 flex items-center gap-1">
				{(
					[
						["open", `Open, ${openCount}`],
						["resolved", `Resolved, ${resolvedCount}`],
						["all", "All"],
					] as [Filter, string][]
				).map(([value, label]) => (
					<button
						key={value}
						type="button"
						onClick={() => setFilter(value)}
						className={`rounded-md px-2.5 py-1.5 text-sm leading-4 ${filter === value ? "bg-link-soft font-medium text-link" : "text-graphite hover:bg-wash-2"}`}
					>
						{label}
					</button>
				))}
			</div>
			<div className="mt-4">
				{comments === null ? (
					<Skeleton className="h-24" />
				) : shown.length === 0 ? (
					<p className="py-6 text-sm text-pencil">
						{filter === "open" ? "No open comments." : "Nothing here yet."}
					</p>
				) : (
					shown.map((thread) => (
						<ThreadRow
							key={thread.id}
							thread={thread}
							pageTitle={pageTitle(thread.pageId)}
							people={people}
							onChange={load}
						/>
					))
				)}
			</div>
		</div>
	);
}

function ThreadRow({
	thread,
	pageTitle,
	people,
	onChange,
}: {
	thread: Thread;
	pageTitle: string;
	people: MentionPerson[];
	onChange: () => void;
}) {
	const toast = useToast();
	const [replying, setReplying] = useState(false);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const quote = thread.comments[0].anchor?.quote;

	const resolve = async (resolved: boolean) => {
		setBusy(true);
		try {
			await submitThreadResolved({
				data: { pageId: thread.pageId, threadId: thread.id, resolved },
			});
			onChange();
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
		} finally {
			setBusy(false);
		}
	};

	const reply = async () => {
		if (!text.trim()) return;
		setBusy(true);
		try {
			await submitComment({
				data: { pageId: thread.pageId, threadId: thread.id, body: text.trim() },
			});
			setText("");
			setReplying(false);
			onChange();
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
		} finally {
			setBusy(false);
		}
	};

	return (
		<article className="border-b border-rule py-4">
			<Link
				to="/p/$pageId"
				params={{ pageId: thread.pageId }}
				className="text-sm text-link"
			>
				{pageTitle}
			</Link>
			{quote && (
				<p className="mt-1 border-l-2 border-violet pl-2 text-sm text-graphite">
					{quote}
				</p>
			)}
			{thread.comments.map((comment) => (
				<div key={comment.id} className="mt-3">
					<CommentRow
						comment={comment}
						canComment
						people={people}
						onChanged={onChange}
					/>
				</div>
			))}
			{replying ? (
				<form
					className="mt-3 flex flex-col gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						void reply();
					}}
				>
					<Textarea
						autoFocus
						rows={2}
						value={text}
						aria-label="Reply"
						onChange={(e) => setText(e.target.value)}
						placeholder="Reply, or @mention someone"
					/>
					<div className="flex gap-2">
						<Button type="submit" variant="primary" loading={busy}>
							Reply
						</Button>
						<Button variant="ghost" onClick={() => setReplying(false)}>
							Cancel
						</Button>
					</div>
				</form>
			) : (
				<div className="mt-2 flex gap-4">
					<button
						type="button"
						className="text-sm font-medium text-link"
						onClick={() => setReplying(true)}
					>
						Reply
					</button>
					<button
						type="button"
						disabled={busy}
						className="text-sm text-graphite hover:text-ink"
						onClick={() => resolve(!thread.resolvedAt)}
					>
						{thread.resolvedAt ? "Reopen" : "Resolve"}
					</button>
				</div>
			)}
		</article>
	);
}
