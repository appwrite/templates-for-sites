// Who can open a page: people and roles, the whole workspace, or the public web (boards 14 and 72).

import {
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ChevronDown } from "#/components/icons";
import { useWorkspace } from "#/components/shell/workspace-context";
import {
	Avatar,
	Button,
	Input,
	Menu,
	type MenuItem,
	Popover,
	Skeleton,
	Switch,
	useMenu,
	useToast,
} from "#/components/ui";
import { copyText } from "#/lib/browser";
import { errorText } from "#/lib/errors";
import { displayName } from "#/lib/permissions";
import type { Share } from "#/lib/types";
import {
	fetchShareState,
	submitAccessStep,
	submitDecideRequest,
	submitInviteAndShare,
	submitPublish,
	submitShares,
	submitVisibility,
} from "./functions";
import type { AccessJob } from "./server/access";
import { WorkspaceMark } from "./WorkspaceSwitcher";

const jobKey = (pageId: string) => `livepage:access-job:${pageId}`;

function saveJob(pageId: string, job: AccessJob) {
	try {
		localStorage.setItem(jobKey(pageId), JSON.stringify(job));
	} catch {
		// Private windows can refuse storage. The job still runs while this tab is open.
	}
}

function readJob(pageId: string): AccessJob | null {
	try {
		const raw = localStorage.getItem(jobKey(pageId));
		return raw ? (JSON.parse(raw) as AccessJob) : null;
	} catch {
		return null;
	}
}

function clearJob(pageId: string) {
	try {
		localStorage.removeItem(jobKey(pageId));
	} catch {
		// Nothing stored.
	}
}

type Level = Share["level"];
type State = Awaited<ReturnType<typeof fetchShareState>>;

const LEVELS: { value: Level; label: string }[] = [
	{ value: "edit", label: "Can edit" },
	{ value: "comment", label: "Can comment" },
	{ value: "view", label: "Can view" },
];
const levelLabel = (level: Level) =>
	LEVELS.find((l) => l.value === level)?.label ?? "";

const looksLikeEmail = (text: string) => {
	const at = text.indexOf("@");
	return (
		at > 0 &&
		at === text.lastIndexOf("@") &&
		text.indexOf(".", at) > at + 1 &&
		!text.includes(" ")
	);
};

export function ShareDialog({
	pageId,
	anchor,
	onClose,
}: {
	pageId: string;
	anchor: RefObject<HTMLElement | null>;
	onClose: () => void;
}) {
	const { workspace, peers } = useWorkspace();
	const toast = useToast();
	const [state, setState] = useState<State | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState<{
		done: number;
		total: number;
		failed: boolean;
		retry?: () => void;
	} | null>(null);

	const load = useCallback(() => {
		fetchShareState({ data: { pageId } })
			.then((next) => {
				setState(next);
				setError(null);
			})
			.catch((err) => setError(errorText(err)));
	}, [pageId]);

	useEffect(load, [load]);

	const here = useMemo(
		() =>
			new Set(peers.filter((p) => p.pageId === pageId).map((p) => p.userId)),
		[peers, pageId],
	);

	// A change on a large database continues step by step from here. Saved after each step, so if
	// this closes partway, opening Share on the page again finishes the job.
	const follow = useCallback(
		async (start: AccessJob | null) => {
			let job = start;
			try {
				while (job) {
					saveJob(pageId, job);
					setProgress({ done: job.done, total: job.total, failed: false });
					job = (await submitAccessStep({ data: { job } })).job;
				}
				clearJob(pageId);
				setProgress(null);
				load();
			} catch (err) {
				setProgress((p) =>
					p ? { ...p, failed: true, retry: () => void follow(job) } : p,
				);
				toast.show(errorText(err), { tone: "error" });
			}
		},
		[pageId, load, toast],
	);

	// Finishes a change an earlier visit didn't get to complete.
	const resumed = useRef(false);
	useEffect(() => {
		if (resumed.current) return;
		resumed.current = true;
		const job = readJob(pageId);
		if (job) void follow(job);
	}, [pageId, follow]);

	const run = async (action: () => Promise<unknown>, failure = true) => {
		setBusy(true);
		try {
			const result = (await action()) as { job?: AccessJob | null };
			if (result?.job) await follow(result.job);
			load();
			return true;
		} catch (err) {
			if (failure) toast.show(errorText(err), { tone: "error" });
			load();
			return false;
		} finally {
			setBusy(false);
		}
	};

	const page = state?.page;
	const canManage = state?.canManage ?? false;
	const shares = page?.shares ?? [];
	const owner = state?.members.find((m) => m.userId === page?.createdBy);

	const setLevel = (userId: string, level: Level | null) => {
		if (!page || !state) return;
		const next = shares.filter((s) => s.userId !== userId);
		if (level) next.push({ userId, level });
		setState({ ...state, page: { ...page, shares: next } });
		void run(() => submitShares({ data: { pageId, shares: next } }));
	};

	const setEveryone = (on: boolean) => {
		if (!page || !state) return;
		const visibility = on
			? "workspace"
			: shares.length
				? "restricted"
				: "private";
		setState({ ...state, page: { ...page, visibility } });
		void run(() => submitVisibility({ data: { pageId, visibility } }));
	};

	const term = query.trim().toLowerCase();
	const suggestions = useMemo(() => {
		if (!term || !state) return [];
		const taken = new Set([page?.createdBy, ...shares.map((s) => s.userId)]);
		return state.members
			.filter(
				(m) =>
					m.confirmed &&
					!taken.has(m.userId) &&
					(m.name.toLowerCase().includes(term) ||
						m.email.toLowerCase().includes(term)),
			)
			.slice(0, 5);
	}, [term, state, page, shares]);

	const invite = async () => {
		if (!state || !page || !term) return;
		const known = state.members.find((m) => m.email.toLowerCase() === term);
		if (known) {
			setLevel(known.userId, "edit");
			setQuery("");
			return;
		}
		if (suggestions.length === 1) {
			setLevel(suggestions[0].userId, "edit");
			setQuery("");
			return;
		}
		if (!state.canInviteGuests) {
			toast.show(
				state.role === "owner"
					? `No one here matches "${query.trim()}". Guests are turned off, so turn them on in Settings to add someone from outside.`
					: `No one here matches "${query.trim()}". Ask the workspace owner to invite them.`,
				{ tone: "error" },
			);
			return;
		}
		if (!looksLikeEmail(term)) {
			toast.show("Enter a full email address to invite someone new.", {
				tone: "error",
			});
			return;
		}
		const ok = await run(() =>
			submitInviteAndShare({
				data: {
					pageId,
					email: term,
					level: "edit",
					acceptUrl: `${window.location.origin}/accept`,
				},
			}),
		);
		if (ok) {
			setQuery("");
			toast.show(`Invited ${term}.`);
		}
	};

	const publicUrl = page?.publishedSlug
		? `${window.location.origin}/public/${page.publishedSlug}`
		: null;

	const copy = async (text: string, done: string) => {
		try {
			await copyText(text);
			toast.show(done);
		} catch {
			toast.show("Your browser blocked copying.", { tone: "error" });
		}
	};

	return (
		<Popover
			anchor={anchor}
			open
			onClose={onClose}
			align="end"
			className="w-[520px] max-w-[calc(100vw-32px)] rounded-[14px] border border-rule bg-paper shadow-[0_20px_60px_rgb(0_0_0/0.14)]"
		>
			<div
				role="dialog"
				aria-label={page ? `Share ${displayName(page)}` : "Share"}
			>
				{error && !state ? (
					<p className="p-5 text-sm text-coral">{error}</p>
				) : !state || !page ? (
					<div className="flex flex-col gap-3 p-5">
						<Skeleton className="h-5 w-1/2" />
						<Skeleton className="h-10" />
						<Skeleton className="h-8" />
						<Skeleton className="h-8" />
					</div>
				) : (
					<>
						<div className="border-b border-rule p-5">
							<h2 className="truncate text-md font-semibold text-ink">
								Share {displayName(page)}
							</h2>
							{progress && (
								<output className="mt-3 block" data-access-job>
									<div
										className="h-1.5 overflow-hidden rounded-full bg-wash-2"
										role="progressbar"
										aria-valuemin={0}
										aria-valuemax={100}
										aria-valuenow={Math.round(
											(Math.min(progress.done, progress.total) /
												Math.max(progress.total, 1)) *
												100,
										)}
									>
										<div
											className="h-full rounded-full bg-accent transition-[width]"
											style={{
												width: `${Math.round((Math.min(progress.done, progress.total) / Math.max(progress.total, 1)) * 100)}%`,
											}}
										/>
									</div>
									<p className="mt-1.5 flex items-baseline justify-between text-sm text-graphite">
										<span>
											{progress.failed
												? "Stopped before it finished. Nothing was lost."
												: `Updating access: ${Math.min(progress.done, progress.total).toLocaleString()} of ${progress.total.toLocaleString()}. Keep this tab open.`}
										</span>
										{progress.retry && (
											<button
												type="button"
												onClick={progress.retry}
												className="text-accent hover:underline"
											>
												Try again
											</button>
										)}
									</p>
								</output>
							)}
							{canManage ? (
								<form
									className="relative mt-3 flex gap-2"
									onSubmit={(e) => {
										e.preventDefault();
										void invite();
									}}
								>
									<Input
										autoFocus
										value={query}
										onChange={(e) => setQuery(e.target.value)}
										placeholder={
											state.canInviteGuests
												? "Add people by name or email"
												: "Add people by name"
										}
										aria-label="Add people"
										className="h-[38px] flex-1"
									/>
									<Button
										type="submit"
										variant="primary"
										className="h-[38px]"
										loading={busy}
										disabled={!term}
									>
										Invite
									</Button>
									{suggestions.length > 0 && (
										<div className="absolute left-0 top-[44px] z-10 w-[calc(100%-84px)] rounded-md border border-rule bg-paper p-1 shadow-[0_8px_24px_rgb(0_0_0/0.1)]">
											{suggestions.map((m) => (
												<button
													key={m.userId}
													type="button"
													onClick={() => {
														setLevel(m.userId, "edit");
														setQuery("");
													}}
													className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-wash"
												>
													<Avatar id={m.userId} name={m.name} size={22} />
													<span className="truncate text-base text-ink">
														{m.name}
													</span>
													<span className="truncate text-sm text-pencil">
														{m.email}
													</span>
												</button>
											))}
										</div>
									)}
								</form>
							) : (
								<p className="mt-1 text-sm text-graphite">
									Only people with full access can change this.
								</p>
							)}
						</div>
						<div className="flex max-h-[300px] flex-col overflow-auto border-b border-rule py-2">
							<Person
								mark={<WorkspaceMark workspace={workspace} size={28} />}
								name={`Everyone at ${workspace.name}`}
								level={
									<LevelButton
										disabled={!canManage}
										label={
											page.visibility === "workspace" ? "Can edit" : "No access"
										}
										items={[
											{
												id: "edit",
												label: "Can edit",
												onSelect: () => setEveryone(true),
											},
											{
												id: "none",
												label: "No access",
												onSelect: () => setEveryone(false),
											},
										]}
									/>
								}
							/>
							{owner && (
								<Person
									mark={
										<Avatar id={owner.userId} name={owner.name} size={28} />
									}
									name={owner.name}
									here={here.has(owner.userId)}
									level={
										<span className="px-1.5 text-sm text-graphite">Owner</span>
									}
								/>
							)}
							{shares.map((share) => {
								const member = state.members.find(
									(m) => m.userId === share.userId,
								);
								const name = member?.name || member?.email || "Someone";
								return (
									<Person
										key={share.userId}
										mark={<Avatar id={share.userId} name={name} size={28} />}
										name={name}
										here={here.has(share.userId)}
										level={
											<LevelButton
												disabled={!canManage}
												label={levelLabel(share.level)}
												items={[
													...LEVELS.map(
														(l): MenuItem => ({
															id: l.value,
															label: l.label,
															onSelect: () => setLevel(share.userId, l.value),
														}),
													),
													{ type: "separator", id: "sep" },
													{
														id: "remove",
														label: "Remove",
														danger: true,
														onSelect: () => setLevel(share.userId, null),
													},
												]}
											/>
										}
									/>
								);
							})}
						</div>
						{state.requests.length > 0 && (
							<div className="border-b border-rule p-5">
								<h3 className="text-sm font-semibold text-ink">
									Asking for access
								</h3>
								<div className="mt-2 flex flex-col gap-2">
									{state.requests.map((request) => (
										<div key={request.id} className="flex items-center gap-2">
											<Avatar
												id={request.userId}
												name={request.userName}
												size={24}
											/>
											<div className="min-w-0 flex-1">
												<div className="truncate text-base text-ink">
													{request.userName}
												</div>
												{request.note && (
													<div className="truncate text-sm text-graphite">
														{request.note}
													</div>
												)}
											</div>
											<Button
												size="sm"
												variant="ghost"
												onClick={() =>
													void run(() =>
														submitDecideRequest({
															data: {
																requestId: request.id,
																approve: false,
																level: "view",
															},
														}),
													)
												}
											>
												Deny
											</Button>
											<Button
												size="sm"
												variant="primary"
												onClick={() =>
													void run(() =>
														submitDecideRequest({
															data: {
																requestId: request.id,
																approve: true,
																level: "edit",
															},
														}),
													)
												}
											>
												Approve
											</Button>
										</div>
									))}
								</div>
							</div>
						)}
						<div className="flex items-center gap-4 border-b border-rule px-5 py-4">
							<div className="min-w-0 flex-1 text-sm text-graphite">
								Only people above can open this link.
							</div>
							<Button
								onClick={() =>
									copy(`${window.location.origin}/p/${pageId}`, "Link copied.")
								}
							>
								Copy link
							</Button>
						</div>
						{state.publishEnabled && canManage && (
							<PublishRow
								slug={page.publishedSlug}
								url={publicUrl}
								busy={busy}
								onToggle={(on) =>
									void run(() =>
										submitPublish({ data: { pageId, published: on } }),
									)
								}
								onSlug={(slug) =>
									run(() =>
										submitPublish({ data: { pageId, published: true, slug } }),
									)
								}
								onCopy={() =>
									publicUrl && copy(publicUrl, "Public link copied.")
								}
							/>
						)}
					</>
				)}
			</div>
		</Popover>
	);
}

function Person({
	mark,
	name,
	level,
	here,
}: {
	mark: React.ReactNode;
	name: string;
	level: React.ReactNode;
	here?: boolean;
}) {
	return (
		<div className="flex h-[47px] items-center gap-3 px-5">
			{mark}
			<span className="min-w-0 flex-1 truncate text-base font-medium text-ink">
				{name}
			</span>
			{here && (
				<span className="flex items-center gap-1 text-sm text-green">
					<span className="size-1.5 rounded-full bg-green" />
					Here now
				</span>
			)}
			{level}
		</div>
	);
}

function LevelButton({
	label,
	items,
	disabled,
}: {
	label: string;
	items: MenuItem[];
	disabled?: boolean;
}) {
	const menu = useMenu();
	if (disabled)
		return <span className="px-1.5 text-sm text-graphite">{label}</span>;
	return (
		<>
			<button
				ref={menu.anchor}
				type="button"
				aria-haspopup="menu"
				onClick={menu.toggle}
				className="flex items-center gap-1 rounded-sm px-1.5 py-1 text-sm text-graphite hover:bg-wash-2 hover:text-ink"
			>
				{label}
				<ChevronDown size={12} />
			</button>
			<Menu
				anchor={menu.anchor}
				open={menu.open}
				onClose={menu.close}
				items={items}
				align="end"
				width={170}
			/>
		</>
	);
}

function PublishRow({
	slug,
	url,
	busy,
	onToggle,
	onSlug,
	onCopy,
}: {
	slug: string | null;
	url: string | null;
	busy: boolean;
	onToggle: (on: boolean) => void;
	onSlug: (slug: string) => Promise<boolean>;
	onCopy: () => void;
}) {
	const [draft, setDraft] = useState(slug ?? "");
	useEffect(() => setDraft(slug ?? ""), [slug]);
	return (
		<div className="flex flex-col gap-3 px-5 py-4">
			<div className="flex items-center gap-4">
				<div className="min-w-0 flex-1">
					<div className="text-base font-medium text-ink">
						Publish to the web
					</div>
					<div className="text-sm text-graphite">
						Anyone with the link can read it.
					</div>
				</div>
				<Switch
					checked={Boolean(slug)}
					onChange={onToggle}
					disabled={busy}
					label="Publish to the web"
				/>
			</div>
			{url && (
				<form
					className="flex items-center gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						if (draft !== slug) void onSlug(draft);
					}}
				>
					<span className="shrink-0 text-sm text-pencil">/public/</span>
					<Input
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						aria-label="Public address"
						className="h-8 flex-1 font-mono text-sm"
					/>
					{draft !== slug ? (
						<Button type="submit" size="md" loading={busy}>
							Save
						</Button>
					) : (
						<Button onClick={onCopy}>Copy</Button>
					)}
				</form>
			)}
		</div>
	);
}
