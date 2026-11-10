import { Link, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	queryEqual,
	useChannel,
	useLive,
} from "#/components/shell/live-context";
import { TopBarActions } from "#/components/shell/top-bar";
import { useWorkspace } from "#/components/shell/workspace-context";
import { Avatar, Button, Input, Skeleton, useToast } from "#/components/ui";
import { submitComment } from "#/functions/comments";
import { errorText } from "#/lib/errors";
import type { LiveEvent } from "#/lib/live";
import { NOTIFICATIONS, rowsChannel } from "#/server/schema";
import { useExtras } from "./extras";
import { clock, dayLabel } from "./format";
import { fetchNotifications, submitAllRead, submitRead } from "./functions";
import type { Notification } from "./server/activity";

type Filter = "all" | "mentions" | "assigned" | "replies";

const FILTERS: { value: Filter; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "mentions", label: "Mentions" },
	{ value: "assigned", label: "Assigned" },
	{ value: "replies", label: "Replies" },
];

function matchesFilter(item: Notification, filter: Filter) {
	if (filter === "all") return true;
	if (filter === "mentions") return item.kind === "mention";
	if (filter === "assigned") return item.kind === "assign";
	return item.kind === "reply";
}

function describe(kind: string) {
	switch (kind) {
		case "mention":
			return "mentioned you in";
		case "reply":
			return "replied to you in";
		case "assign":
			return "assigned you a task in";
		case "access_request":
			return "asked for access to";
		case "access_granted":
			return "gave you access to";
		case "invite-request":
			return "asked for an invite";
		default:
			return "updated";
	}
}

export function InboxPage() {
	const { workspace, viewer } = useWorkspace();
	const { onReconnect } = useLive();
	const { reload: reloadExtras } = useExtras();
	const toast = useToast();
	const [items, setItems] = useState<Notification[] | null>(null);
	const [filter, setFilter] = useState<Filter>("all");
	const workspaceId = workspace.id;

	const load = useCallback(() => {
		fetchNotifications({ data: { workspaceId } })
			.then(setItems)
			.catch((err) => toast.show(errorText(err), { tone: "error" }));
	}, [workspaceId, toast]);

	useEffect(load, [load]);
	useEffect(() => onReconnect(load), [onReconnect, load]);

	useChannel(
		`inbox-${viewer.userId}`,
		[rowsChannel(NOTIFICATIONS)],
		[queryEqual("userId", viewer.userId)],
		(event: LiveEvent) => {
			const row = event.payload as {
				$id: string;
				readAt: string | null;
				workspaceId: string;
			};
			if (row.workspaceId !== workspaceId) return;
			if (event.events.some((e) => e.endsWith(".create"))) load();
			else
				setItems(
					(list) =>
						list?.map((n) =>
							n.id === row.$id ? { ...n, readAt: row.readAt } : n,
						) ?? null,
				);
		},
	);

	const visible = useMemo(
		() => (items ?? []).filter((n) => matchesFilter(n, filter)),
		[items, filter],
	);

	const grouped = useMemo(() => {
		const groups = new Map<string, Notification[]>();
		for (const item of visible) {
			const label = dayLabel(item.createdAt);
			groups.set(label, [...(groups.get(label) ?? []), item]);
		}
		return [...groups.entries()];
	}, [visible]);

	const unread = (items ?? []).filter((n) => !n.readAt);

	const markAll = async () => {
		setItems(
			(list) =>
				list?.map((n) => ({
					...n,
					readAt: n.readAt ?? new Date().toISOString(),
				})) ?? null,
		);
		try {
			await submitAllRead({ data: { workspaceId } });
			reloadExtras();
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
			load();
		}
	};

	const open = (id: string) => {
		setItems(
			(list) =>
				list?.map((n) =>
					n.id === id ? { ...n, readAt: new Date().toISOString() } : n,
				) ?? null,
		);
		submitRead({ data: { ids: [id] } }).then(reloadExtras, () => undefined);
	};

	return (
		<div className="lp-hit mx-auto w-full max-w-[1096px] px-6 pb-12 pt-10 md:px-[88px] md:pt-14">
			<TopBarActions>
				{unread.length > 0 && (
					<button
						type="button"
						className="text-sm text-graphite hover:text-ink coarse:h-10"
						onClick={markAll}
					>
						Mark all as read
					</button>
				)}
				<Link
					to="/w/$workspaceId/comments"
					params={{ workspaceId }}
					className="text-sm text-graphite hover:text-ink coarse:flex coarse:h-10 coarse:items-center"
				>
					All comments
				</Link>
			</TopBarActions>
			<div className="flex items-center gap-6 max-md:flex-col max-md:items-start max-md:gap-3">
				<h1 className="min-w-0 flex-1 max-md:flex-none font-serif text-[32px] font-medium leading-[38px] tracking-[-0.02em] text-ink">
					Inbox
				</h1>
				<FilterPills value={filter} onChange={setFilter} />
			</div>
			{items === null ? (
				<div className="mt-8 flex flex-col gap-3">
					{[0, 1, 2].map((i) => (
						<Skeleton key={i} className="h-12" />
					))}
				</div>
			) : visible.length === 0 ? (
				<p className="mt-8 text-sm text-pencil">
					{filter === "all" ? "You're all caught up." : "Nothing here."}
				</p>
			) : (
				grouped.map(([label, list]) => (
					<section key={label} className="mt-8">
						<h2 className="flex h-8 items-center border-b border-rule text-sm font-semibold text-ink">
							{label}
						</h2>
						{list.map((item) => (
							<Row key={item.id} item={item} onRead={open} onReplied={load} />
						))}
					</section>
				))
			)}
		</div>
	);
}

function FilterPills({
	value,
	onChange,
}: {
	value: Filter;
	onChange: (f: Filter) => void;
}) {
	return (
		<div
			className="flex items-center gap-1"
			role="tablist"
			aria-label="Filter inbox"
		>
			{FILTERS.map((f) => (
				<button
					key={f.value}
					type="button"
					role="tab"
					aria-selected={value === f.value}
					onClick={() => onChange(f.value)}
					className={`rounded-md px-2.5 py-1.5 text-sm leading-4 ${value === f.value ? "bg-link-soft font-medium text-link" : "text-graphite hover:bg-wash-2"}`}
				>
					{f.label}
				</button>
			))}
		</div>
	);
}

function Row({
	item,
	onRead,
	onReplied,
}: {
	item: Notification;
	onRead: (id: string) => void;
	onReplied: () => void;
}) {
	const router = useRouter();
	const toast = useToast();
	const [replying, setReplying] = useState(false);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);

	const go = () => {
		onRead(item.id);
		if (item.pageId)
			router.navigate({ to: "/p/$pageId", params: { pageId: item.pageId } });
		else if (item.kind === "invite-request")
			router.navigate({
				to: "/w/$workspaceId/settings/$section",
				params: { workspaceId: item.workspaceId, section: "members" },
			});
	};

	const send = async () => {
		if (!text.trim() || !item.pageId) return;
		setBusy(true);
		try {
			await submitComment({ data: { pageId: item.pageId, body: text.trim() } });
			onRead(item.id);
			setReplying(false);
			setText("");
			onReplied();
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
		} finally {
			setBusy(false);
		}
	};

	const replyable = item.kind === "mention" || item.kind === "reply";

	return (
		<div className="border-b border-rule py-[14px]">
			<div className="flex gap-3">
				<span className="mt-[11px] w-2 shrink-0" aria-hidden="true">
					{!item.readAt && (
						<span className="block size-2 rounded-full bg-accent" />
					)}
				</span>
				<Avatar id={item.actorId ?? item.id} name={item.actorName} size={28} />
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline gap-3">
						<button
							type="button"
							onClick={go}
							className="min-w-0 flex-1 truncate text-left text-sm leading-[18px]"
						>
							<strong className="font-semibold text-ink">
								{item.actorName}
							</strong>{" "}
							<span className="text-graphite">{describe(item.kind)}</span>{" "}
							{item.kind !== "invite-request" && (
								<span className="text-link">{item.title || "a page"}</span>
							)}
						</button>
						<span className="shrink-0 text-sm text-pencil">
							{clock(item.createdAt)}
						</span>
					</div>
					{item.body && (
						<p className="mt-1 text-base leading-5 text-ink">{item.body}</p>
					)}
					{replyable && item.pageId && !replying && (
						<button
							type="button"
							className="mt-1.5 text-sm text-graphite hover:text-ink"
							onClick={() => setReplying(true)}
						>
							Reply
						</button>
					)}
					{replying && (
						<form
							className="mt-2 flex gap-2"
							onSubmit={(e) => {
								e.preventDefault();
								void send();
							}}
						>
							<Input
								autoFocus
								value={text}
								aria-label="Reply"
								onChange={(e) => setText(e.target.value)}
								placeholder="Write a reply"
							/>
							<Button type="submit" variant="primary" loading={busy}>
								Reply
							</Button>
						</form>
					)}
				</div>
			</div>
		</div>
	);
}
