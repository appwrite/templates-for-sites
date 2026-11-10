import { Link, useHydrated } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { SearchIcon, SparkleFilled } from "#/components/icons";
import { useWorkspace } from "#/components/shell/workspace-context";
import { Avatar, Skeleton } from "#/components/ui";
import { useAiStatus } from "#/features/ai/client";
import { errorText } from "#/lib/errors";
import { displayName } from "#/lib/permissions";
import { countWord, firstName, greeting, joinNames, timeAgo } from "./format";
import { fetchHome } from "./functions";
import type { HomeData } from "./server/activity";
import { NewPageAction } from "./TopBarNew";

export function HomePage() {
	const { workspace, viewer, peers, pages } = useWorkspace();
	const hydrated = useHydrated();
	const [data, setData] = useState<HomeData | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let live = true;
		setData(null);
		fetchHome({ data: { workspaceId: workspace.id } })
			.then((next) => live && setData(next))
			.catch((err) => live && setError(errorText(err)));
		return () => {
			live = false;
		};
	}, [workspace.id]);

	const here = useMemo(() => {
		const byPage = new Map<string, { id: string; name: string }[]>();
		for (const peer of peers) {
			if (!peer.pageId) continue;
			const list = byPage.get(peer.pageId) ?? [];
			list.push({ id: peer.userId, name: peer.name });
			byPage.set(peer.pageId, list);
		}
		return [...byPage.entries()]
			.map(([id, people]) => ({
				page: pages.find((p) => p.id === id),
				people,
			}))
			.filter((row) => row.page);
	}, [peers, pages]);

	const waiting = data?.waiting ?? [];
	const waitingList =
		data === null ? (
			<Skeleton className="h-16" />
		) : waiting.length === 0 ? (
			<p className="text-sm text-pencil">Nothing right now.</p>
		) : (
			waiting.map((item) => <WaitingItem key={item.id} item={item} />)
		);
	const peopleWorking = new Set(peers.map((p) => p.userId)).size;
	const line = summaryLine(peopleWorking, waiting.length, workspace.name);

	return (
		<div className="lp-hit flex min-h-full flex-col max-md:pb-[84px] lg:flex-row">
			{workspace.role !== "guest" && <NewPageAction />}
			<div className="flex min-w-0 flex-1 flex-col gap-11 px-5 pb-12 pt-5 md:px-[88px] md:pt-14 max-md:gap-8 max-md:pb-6">
				<div className="flex flex-col gap-2.5">
					{/* The time of day comes from the browser, so the server leaves the greeting hidden. */}
					<h1
						className={`font-serif text-[38px] font-medium leading-[44px] tracking-[-0.02em] text-ink md:text-2xl md:leading-[54px] ${hydrated ? "" : "invisible"}`}
					>
						{hydrated ? greeting() : "Hello"}, {firstName(viewer.name)}.
					</h1>
					<p className="text-md leading-6 text-graphite">{line}</p>
				</div>

				{here.length > 0 && (
					<section>
						<div className="flex h-8 items-center gap-1.5 border-b border-rule">
							<span className="size-1.5 rounded-full bg-green" />
							<h2 className="text-sm font-semibold text-ink">Live now</h2>
						</div>
						{here.map(({ page, people }) => {
							if (!page) return null;
							return (
								<div
									key={page.id}
									className="flex min-h-16 items-center gap-4 border-b border-rule py-2 max-md:items-start"
								>
									<div className="min-w-0 flex-1">
										<div className="truncate text-md font-medium leading-5 text-ink">
											{displayName(page)}
										</div>
										<div className="text-sm leading-[18px] text-graphite max-md:line-clamp-2 md:truncate">
											{joinNames(people.map((p) => firstName(p.name)))}{" "}
											{people.length === 1 ? "is" : "are"} editing.
										</div>
									</div>
									<div className="flex shrink-0 gap-1 max-md:hidden">
										{people.slice(0, 4).map((person) => (
											<Avatar
												key={person.id}
												id={person.id}
												name={person.name}
												size={28}
											/>
										))}
									</div>
									<div className="flex w-[60px] shrink-0 flex-col items-end justify-center gap-1.5">
										<div className="flex gap-1 md:hidden">
											{people.slice(0, 3).map((person) => (
												<Avatar
													key={person.id}
													id={person.id}
													name={person.name}
													size={24}
												/>
											))}
										</div>
										<Link
											to="/p/$pageId"
											params={{ pageId: page.id }}
											className="flex items-center text-base font-medium text-link coarse:h-10"
										>
											Join
										</Link>
									</div>
								</div>
							);
						})}
					</section>
				)}

				<section className="lg:hidden">
					<div className="flex h-8 items-center justify-between border-b border-rule">
						<h2 className="text-sm font-semibold text-ink">Waiting on you</h2>
						<span className="text-sm text-pencil">{waiting.length || ""}</span>
					</div>
					<div className="flex flex-col gap-4 pt-4">{waitingList}</div>
				</section>

				<section>
					<div className="flex h-8 items-center border-b border-rule">
						<h2 className="text-sm font-semibold text-ink">
							Picked up where you left off
						</h2>
					</div>
					{error ? (
						<p className="py-3 text-sm text-coral">{error}</p>
					) : data === null ? (
						<div className="flex flex-col gap-3 py-3">
							{[0, 1, 2].map((i) => (
								<Skeleton key={i} className="h-5" />
							))}
						</div>
					) : data.recents.length === 0 ? (
						<p className="py-3 text-sm text-pencil">
							Nothing yet. Pages you open show up here.
						</p>
					) : (
						data.recents.map(({ page, visitedAt }) => (
							<Link
								key={page.id}
								to="/p/$pageId"
								params={{ pageId: page.id }}
								className="flex h-11 items-center gap-3 border-b border-rule hover:bg-wash max-md:h-auto max-md:min-h-14 max-md:flex-wrap max-md:content-center max-md:gap-x-2 max-md:gap-y-0.5 max-md:py-2"
							>
								<span className="w-[280px] shrink-0 truncate text-base leading-[18px] text-ink max-md:w-full max-md:text-[15px] max-md:leading-5">
									{displayName(page)}
								</span>
								<span className="min-w-0 flex-1 truncate text-sm leading-4 text-pencil">
									{pagePath(page, pages, workspace.sections)}
								</span>
								<span className="w-[150px] shrink-0 truncate text-right text-sm leading-4 text-graphite max-md:w-auto">
									{lastActor(page, viewer.userId, data.members, visitedAt)}
								</span>
							</Link>
						))
					)}
				</section>
			</div>
			<aside className="hidden shrink-0 flex-col gap-[22px] lg:flex lg:w-[320px] lg:border-l lg:border-rule lg:px-5 lg:pb-8 lg:pt-16">
				<h2 className="text-sm font-semibold leading-4 text-ink">
					Waiting on you
				</h2>
				{waitingList}
			</aside>
			<PhoneSearchBar />
		</div>
	);
}

type Waiting = HomeData["waiting"][number];

function WaitingItem({ item }: { item: Waiting }) {
	const verb = verbFor(item.kind);
	return (
		<div className="flex items-start gap-2.5 lg:flex-col lg:gap-1.5">
			<div className="flex items-center gap-2 max-lg:pt-px">
				<Avatar id={item.actorId ?? item.id} name={item.actorName} size={22} />
				<div className="flex min-w-0 flex-1 items-center gap-1.5 max-lg:hidden">
					<span className="truncate text-sm font-semibold text-ink">
						{item.actorName}
					</span>
					<span className="truncate text-sm text-pencil">{verb}</span>
				</div>
			</div>
			<div className="flex min-w-0 flex-col gap-0.5">
				<p className="truncate text-sm text-pencil lg:hidden">
					<span className="font-semibold text-ink">{item.actorName}</span>{" "}
					{verb}
				</p>
				<p className="line-clamp-3 text-[15px] leading-[22px] text-ink lg:text-base lg:leading-5">
					{item.body || item.title}
				</p>
				{item.pageId && (
					<Link
						to="/p/$pageId"
						params={{ pageId: item.pageId }}
						className="truncate text-sm text-link coarse:flex coarse:h-8 coarse:items-center"
					>
						{item.title || "Open page"}
					</Link>
				)}
			</div>
		</div>
	);
}

// Search and Ask on a phone, where the top bar has no room for them (board 90).
function PhoneSearchBar() {
	const { workspace } = useWorkspace();
	const ai = useAiStatus(workspace.id);
	const canAsk = ai?.state === "ready" && ai.ask;
	return (
		<div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-2.5 border-t border-rule bg-paper px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 md:hidden">
			<button
				type="button"
				onClick={() =>
					window.dispatchEvent(new CustomEvent("livepage:command"))
				}
				className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-rule bg-wash px-3.5 text-left text-base text-pencil"
			>
				<SearchIcon size={16} className="shrink-0 text-graphite" />
				<span className="truncate">{canAsk ? "Search or ask" : "Search"}</span>
			</button>
			{canAsk && (
				<button
					type="button"
					onClick={() => window.dispatchEvent(new CustomEvent("livepage:ask"))}
					className="flex h-11 shrink-0 items-center gap-1.5 rounded-[10px] bg-accent px-4 text-base font-medium text-white"
				>
					<SparkleFilled size={13} />
					Ask AI
				</button>
			)}
		</div>
	);
}

function summaryLine(working: number, waiting: number, workspaceName: string) {
	const people =
		working === 0
			? `Nobody else is in ${workspaceName} right now`
			: `${countWord(working)} ${working === 1 ? "person is" : "people are"} working in ${workspaceName} right now`;
	const things =
		waiting === 0
			? "nothing is waiting on you"
			: `${countWord(waiting).toLowerCase()} ${waiting === 1 ? "thing is" : "things are"} waiting on you`;
	return `${people}, and ${things}.`;
}

function verbFor(kind: string) {
	if (kind === "mention") return "mentioned you";
	if (kind === "reply") return "replied to you";
	if (kind === "assign") return "assigned you";
	if (kind === "access_request") return "asked for access";
	return "";
}

function lastActor(
	page: { updatedBy: string; updatedAt: string },
	viewerId: string,
	members: Record<string, string>,
	visitedAt: string,
) {
	if (page.updatedBy === viewerId) return `You, ${timeAgo(visitedAt)}`;
	const name = members[page.updatedBy];
	return `${name ? firstName(name) : "Someone"}, ${timeAgo(page.updatedAt)}`;
}

export function pagePath(
	page: {
		parentId: string | null;
		sectionId: string | null;
		visibility: string;
	},
	pages: {
		id: string;
		title: string;
		parentId: string | null;
		sectionId: string | null;
	}[],
	sections: { id: string; name: string }[],
) {
	if (page.visibility !== "workspace") return "Private";
	const trail: string[] = [];
	let parent = page.parentId
		? pages.find((p) => p.id === page.parentId)
		: undefined;
	let top = page.sectionId;
	while (parent) {
		trail.unshift(parent.title.trim() || "Untitled");
		top = parent.sectionId;
		parent = parent.parentId
			? pages.find((p) => p.id === parent?.parentId)
			: undefined;
	}
	const section = sections.find((s) => s.id === top) ?? sections[0];
	return [section?.name, ...trail].filter(Boolean).join(" / ");
}
