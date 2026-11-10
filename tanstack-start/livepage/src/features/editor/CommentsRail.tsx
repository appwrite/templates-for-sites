// Margin threads beside the page, each next to the text it's about (boards 10 and 79).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, MoreIcon, TrashIcon } from "#/components/icons";
import { useWorkspace } from "#/components/shell/workspace-context";
import { Avatar, Button, Menu, type MenuItem, useToast } from "#/components/ui";
import {
	type Comment,
	submitComment,
	submitCommentDelete,
	submitCommentEdit,
	submitThreadResolved,
} from "#/functions/comments";
import { errorText } from "#/lib/errors";
import type { Thread } from "./useComments";

function relativeTime(iso: string) {
	const diff = Date.now() - Date.parse(iso);
	if (diff < 60_000) return "now";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
	return new Date(iso).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
}

export type MentionPerson = { id: string; name: string; here: boolean };

// Plain textarea plus a people list that appears after "@". The chosen ids travel beside the text.
export function MentionInput({
	value,
	onChange,
	onSubmit,
	onCancel,
	placeholder,
	people,
	mentions,
	autoFocus,
	label,
}: {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	onCancel?: () => void;
	placeholder: string;
	people: MentionPerson[];
	mentions: React.RefObject<Map<string, string>>;
	autoFocus?: boolean;
	label: string;
}) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const [query, setQuery] = useState<string | null>(null);
	const [selected, setSelected] = useState(0);
	const matches = useMemo(() => {
		if (query === null) return [];
		const q = query.toLowerCase();
		return people
			.filter((p) => p.name.toLowerCase().includes(q))
			.sort((a, b) => Number(b.here) - Number(a.here))
			.slice(0, 6);
	}, [query, people]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: focus once on mount
	useEffect(() => {
		if (autoFocus) ref.current?.focus();
	}, []);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
	});

	const onInput = (next: string) => {
		onChange(next);
		const caret = ref.current?.selectionStart ?? next.length;
		const before = next.slice(0, caret);
		const at = before.lastIndexOf("@");
		const text = at >= 0 ? before.slice(at + 1) : "";
		if (
			at >= 0 &&
			(at === 0 || /\s/.test(before[at - 1])) &&
			!/[\n@]/.test(text)
		) {
			setQuery(text);
			setSelected(0);
		} else setQuery(null);
	};

	const caretAfterPick = useRef<number | null>(null);
	const pick = (person: MentionPerson) => {
		const el = ref.current;
		if (!el) return;
		const caret = el.selectionStart;
		const before = value.slice(0, caret);
		const at = before.lastIndexOf("@");
		const inserted = `@${person.name} `;
		const next = `${before.slice(0, at)}${inserted}${value.slice(caret)}`;
		mentions.current.set(person.name, person.id);
		onChange(next);
		setQuery(null);
		caretAfterPick.current = at + inserted.length;
	};

	// Runs in the same commit as the new value, so a key pressed right after picking isn't misplaced.
	// biome-ignore lint/correctness/useExhaustiveDependencies: placed after each change of the value
	useLayoutEffect(() => {
		const pos = caretAfterPick.current;
		const el = ref.current;
		if (pos === null || !el) return;
		caretAfterPick.current = null;
		el.focus();
		el.setSelectionRange(pos, pos);
	}, [value]);

	return (
		<div className="relative">
			<textarea
				ref={ref}
				rows={1}
				value={value}
				aria-label={label}
				placeholder={placeholder}
				onChange={(e) => onInput(e.target.value)}
				onKeyDown={(e) => {
					if (matches.length) {
						if (e.key === "ArrowDown") {
							e.preventDefault();
							setSelected((s) => (s + 1) % matches.length);
							return;
						}
						if (e.key === "ArrowUp") {
							e.preventDefault();
							setSelected((s) => (s - 1 + matches.length) % matches.length);
							return;
						}
						if (e.key === "Enter" || e.key === "Tab") {
							e.preventDefault();
							pick(matches[selected]);
							return;
						}
					}
					if (e.key === "Escape") {
						e.stopPropagation();
						if (query !== null) setQuery(null);
						else onCancel?.();
					}
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						onSubmit();
					}
				}}
				className="block w-full resize-none rounded-md border border-rule-strong bg-paper px-2.5 py-1.5 text-sm outline-none placeholder:text-pencil focus:border-link"
			/>
			{matches.length > 0 && (
				<div className="absolute top-full right-0 left-0 z-20 mt-1 rounded-lg border border-rule bg-paper p-1 shadow-pop">
					{matches.map((p, i) => (
						<button
							key={p.id}
							type="button"
							onMouseDown={(e) => e.preventDefault()}
							onMouseEnter={() => setSelected(i)}
							onClick={() => pick(p)}
							className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm ${i === selected ? "bg-wash-2" : ""}`}
						>
							<Avatar id={p.id} name={p.name} size={20} />
							<span className="min-w-0 flex-1 truncate">{p.name}</span>
							{p.here && <span className="text-xs text-green">Here now</span>}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

// One comment, with its edit and delete controls. Used by the rail, the sheet and the All comments page.
export function CommentRow({
	comment,
	canComment,
	people,
	onChanged,
}: {
	comment: Comment;
	canComment: boolean;
	people: MentionPerson[];
	onChanged: () => void;
}) {
	const { viewer, workspace } = useWorkspace();
	const toast = useToast();
	const menuAnchor = useRef<HTMLButtonElement>(null);
	const [menu, setMenu] = useState(false);
	const [editing, setEditing] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const mentions = useRef(new Map<string, string>());

	if (comment.deletedAt)
		return (
			<p className="text-[13px] italic text-pencil">
				This comment was deleted.
			</p>
		);

	const mine = comment.createdBy === viewer.userId;
	const canEdit = mine && canComment;
	const canDelete =
		workspace.role === "owner" ||
		workspace.role === "admin" ||
		(mine && canComment);

	const startEdit = () => {
		setDraft(comment.body);
		setEditing(true);
	};

	const save = async () => {
		const body = draft.trim();
		if (!body || busy) return;
		if (body === comment.body) {
			setEditing(false);
			return;
		}
		setBusy(true);
		try {
			await submitCommentEdit({
				data: {
					commentId: comment.id,
					body,
					mentions: [
						...people
							.filter((p) => body.includes(`@${p.name}`))
							.map((p) => p.id),
						...[...mentions.current.entries()]
							.filter(([name]) => body.includes(`@${name}`))
							.map(([, id]) => id),
					],
				},
			});
			setEditing(false);
			onChanged();
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		setBusy(true);
		try {
			await submitCommentDelete({ data: { commentId: comment.id } });
			onChanged();
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
			setBusy(false);
		}
	};

	const items: MenuItem[] = [
		...(canEdit
			? [{ id: "edit", label: "Edit", onSelect: startEdit } as MenuItem]
			: []),
		...(canDelete
			? [
					{
						id: "delete",
						label: "Delete",
						danger: true,
						icon: <TrashIcon size={14} />,
						onSelect: () => setConfirming(true),
					} as MenuItem,
				]
			: []),
	];

	return (
		<div className="group/comment flex flex-col gap-1.5">
			<div className="flex items-center gap-2">
				<Avatar id={comment.createdBy} name={comment.authorName} size={22} />
				<span className="text-[13px] font-semibold leading-4 text-ink">
					{comment.authorName}
				</span>
				<span className="text-[13px] leading-4 text-pencil">
					{relativeTime(comment.createdAt)}
					{comment.editedAt ? " · edited" : ""}
				</span>
				{items.length > 0 && !editing && !confirming && (
					<>
						<button
							ref={menuAnchor}
							type="button"
							aria-label="Comment options"
							title="Comment options"
							onClick={(e) => {
								e.stopPropagation();
								setMenu(true);
							}}
							className={`ml-auto flex size-6 items-center justify-center rounded-md text-graphite hover:bg-wash-2 focus-visible:opacity-100 coarse:size-9 coarse:opacity-100 ${menu ? "opacity-100" : "opacity-0 group-hover/comment:opacity-100"}`}
						>
							<MoreIcon size={14} />
						</button>
						<Menu
							anchor={menuAnchor}
							open={menu}
							onClose={() => setMenu(false)}
							items={items}
							align="end"
							width={140}
						/>
					</>
				)}
			</div>
			{editing ? (
				<div className="flex flex-col gap-2">
					<MentionInput
						value={draft}
						onChange={setDraft}
						onSubmit={save}
						onCancel={() => setEditing(false)}
						placeholder="Edit your comment"
						people={people}
						mentions={mentions}
						autoFocus
						label="Edit comment"
					/>
					<div className="flex items-center justify-end gap-2">
						<Button variant="ghost" onClick={() => setEditing(false)}>
							Cancel
						</Button>
						<Button
							variant="primary"
							onClick={save}
							loading={busy}
							disabled={!draft.trim()}
						>
							Save
						</Button>
					</div>
				</div>
			) : (
				<p className="whitespace-pre-wrap text-[14px] leading-[21px] text-ink">
					{comment.body}
				</p>
			)}
			{confirming && (
				<div className="flex items-center justify-between gap-2">
					<span className="text-[13px] text-graphite">
						Delete this comment?
					</span>
					<div className="flex gap-2">
						<Button variant="ghost" onClick={() => setConfirming(false)}>
							Cancel
						</Button>
						<Button variant="danger" onClick={remove} loading={busy}>
							Delete
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

function ThreadCard({
	thread,
	active,
	onActivate,
	pageId,
	canComment,
	people,
	mentionsFor,
	onReplied,
}: {
	thread: Thread;
	active: boolean;
	onActivate: () => void;
	pageId: string;
	canComment: boolean;
	people: MentionPerson[];
	mentionsFor: (text: string) => string[];
	onReplied: () => void;
}) {
	const toast = useToast();
	const [reply, setReply] = useState("");
	const [sending, setSending] = useState(false);
	const replyMentions = useRef(new Map<string, string>());

	const send = async () => {
		const body = reply.trim();
		if (!body) return;
		setSending(true);
		try {
			await submitComment({
				data: {
					pageId,
					threadId: thread.id,
					body,
					mentions: [...replyMentions.current.entries()]
						.filter(([name]) => body.includes(`@${name}`))
						.map(([, id]) => id)
						.concat(mentionsFor(body)),
				},
			});
			setReply("");
			replyMentions.current.clear();
			onReplied();
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
		} finally {
			setSending(false);
		}
	};

	const resolve = async () => {
		try {
			await submitThreadResolved({
				data: { pageId, threadId: thread.id, resolved: !thread.resolved },
			});
			onReplied();
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
		}
	};

	const count = 1 + thread.replies.length;
	return (
		<article
			onClick={onActivate}
			onKeyDown={(e) => {
				if (e.key === "Enter") onActivate();
			}}
			className={`flex flex-col gap-2.5 ${active ? "rounded-lg border border-rule-strong bg-paper p-3 shadow-pop" : "cursor-pointer"}`}
			data-thread-card={thread.id}
		>
			{active && (
				<div className="flex items-center justify-between">
					<span className="text-[13px] text-pencil">
						{count} {count === 1 ? "comment" : "comments"}
					</span>
					{canComment && (
						<Button size="sm" icon={<CheckIcon size={12} />} onClick={resolve}>
							{thread.resolved ? "Reopen" : "Resolve"}
						</Button>
					)}
				</div>
			)}
			<CommentRow
				comment={thread.root}
				canComment={canComment}
				people={people}
				onChanged={onReplied}
			/>
			{thread.replies.map((c) => (
				<CommentRow
					key={c.id}
					comment={c}
					canComment={canComment}
					people={people}
					onChanged={onReplied}
				/>
			))}
			{canComment && active && (
				<div className="flex flex-col gap-2">
					<MentionInput
						value={reply}
						onChange={setReply}
						onSubmit={send}
						onCancel={() => setReply("")}
						placeholder="Reply, or @mention someone"
						people={people}
						mentions={replyMentions}
						label="Reply"
					/>
					{reply.trim() && (
						<div className="flex items-center justify-between">
							<span className="text-[13px] text-pencil">Esc to cancel</span>
							<Button variant="primary" onClick={send} loading={sending}>
								Reply
							</Button>
						</div>
					)}
				</div>
			)}
			{!active && canComment && (
				<div className="h-[34px] rounded-md border border-rule-strong px-2.5 text-[13px] leading-[34px] text-pencil">
					Reply, or @mention someone
				</div>
			)}
		</article>
	);
}

export function ThreadComposer({
	people,
	onSubmit,
	onCancel,
	quote,
}: {
	people: MentionPerson[];
	onSubmit: (body: string, mentions: string[]) => Promise<void>;
	onCancel: () => void;
	quote: string;
}) {
	const [body, setBody] = useState("");
	const [sending, setSending] = useState(false);
	const mentions = useRef(new Map<string, string>());
	const toast = useToast();
	const submit = async () => {
		const text = body.trim();
		if (!text) return;
		setSending(true);
		try {
			await onSubmit(
				text,
				[...mentions.current.entries()]
					.filter(([name]) => text.includes(`@${name}`))
					.map(([, id]) => id),
			);
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
			setSending(false);
		}
	};
	return (
		<div className="flex flex-col gap-2 rounded-lg border border-rule-strong bg-paper p-3 shadow-pop">
			{quote && (
				<p className="line-clamp-2 border-l-2 border-violet pl-2 text-[13px] text-graphite">
					{quote}
				</p>
			)}
			<MentionInput
				value={body}
				onChange={setBody}
				onSubmit={submit}
				onCancel={onCancel}
				placeholder="Add a comment, or @mention someone"
				people={people}
				mentions={mentions}
				autoFocus
				label="Comment"
			/>
			<div className="flex items-center justify-between">
				<span className="text-[13px] text-pencil">Esc to cancel</span>
				<Button
					variant="primary"
					onClick={submit}
					loading={sending}
					disabled={!body.trim()}
				>
					Comment
				</Button>
			</div>
		</div>
	);
}

export type RailThread = Thread & { top: number | null };

// Keeps threads near their text without letting them overlap.
export function placeThreads(
	items: { id: string; top: number; height: number }[],
	gap = 12,
) {
	const sorted = [...items].sort((a, b) => a.top - b.top);
	const out = new Map<string, number>();
	let bottom = -Infinity;
	for (const item of sorted) {
		const top = Math.max(item.top, bottom + gap);
		out.set(item.id, top);
		bottom = top + item.height;
	}
	return out;
}

export function CommentsRail({
	threads,
	activeId,
	onActivate,
	pageId,
	canComment,
	people,
	composer,
	composerTop,
	onChanged,
	lineTop,
	flow = false,
}: {
	threads: RailThread[];
	activeId: string | null;
	onActivate: (id: string | null) => void;
	pageId: string;
	canComment: boolean;
	people: MentionPerson[];
	composer: React.ReactNode;
	composerTop: number | null;
	onChanged: () => void;
	lineTop: number | null;
	// In the comments sheet, cards stack normally instead of lining up with their text.
	flow?: boolean;
}) {
	const refs = useRef(new Map<string, HTMLDivElement>());
	const [offsets, setOffsets] = useState(new Map<string, number>());

	useLayoutEffect(() => {
		const items = threads
			.filter((t) => t.top !== null)
			.map((t) => ({
				id: t.id,
				top: t.top as number,
				height: refs.current.get(t.id)?.offsetHeight ?? 100,
			}));
		if (composerTop !== null)
			items.push({ id: "__composer", top: composerTop, height: 150 });
		setOffsets(placeThreads(items));
	}, [threads, composerTop]);

	const mentionsFor = (text: string) =>
		people.filter((p) => text.includes(`@${p.name}`)).map((p) => p.id);

	useEffect(() => {
		if (!activeId) return;
		refs.current.get(activeId)?.scrollIntoView({ block: "nearest" });
	}, [activeId]);

	return (
		<>
			{lineTop !== null && (
				<div
					aria-hidden="true"
					className="absolute right-full h-px w-[122px] bg-violet"
					style={{ top: lineTop + 12 }}
				/>
			)}
			{composer !== null && composerTop !== null && (
				<div
					className="absolute right-5 left-5"
					style={{ top: offsets.get("__composer") ?? composerTop }}
				>
					{composer}
				</div>
			)}
			{threads
				.filter((t) => t.top !== null)
				.map((t) => (
					<div
						key={t.id}
						ref={(el) => {
							if (el) refs.current.set(t.id, el);
							else refs.current.delete(t.id);
						}}
						className={flow ? undefined : "absolute right-5 left-5"}
						style={
							flow ? undefined : { top: offsets.get(t.id) ?? (t.top as number) }
						}
					>
						<ThreadCard
							thread={t}
							active={activeId === t.id}
							onActivate={() => onActivate(t.id)}
							pageId={pageId}
							canComment={canComment}
							people={people}
							mentionsFor={mentionsFor}
							onReplied={onChanged}
						/>
					</div>
				))}
		</>
	);
}
