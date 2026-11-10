// Screens shown instead of a page: boards 88 (request access) and 89 (page not found).
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SearchIcon } from "#/components/icons";
import { useWorkspace } from "#/components/shell/workspace-context";
import { Avatar, Button, useToast } from "#/components/ui";
import { fetchAccessRequest, submitAccessRequest } from "#/functions/body";
import { errorText } from "#/lib/errors";

function StateHeader({ children }: { children: React.ReactNode }) {
	return (
		<header className="flex h-12 items-center gap-2 border-b border-rule pl-6 pr-4 text-sm font-medium text-ink">
			{children}
		</header>
	);
}

export function RequestAccess({
	pageId,
	ownerName,
}: {
	pageId: string;
	ownerName: string;
}) {
	const { workspace } = useWorkspace();
	const toast = useToast();
	const [note, setNote] = useState("");
	const [sending, setSending] = useState(false);
	const [sent, setSent] = useState<string | null>(null);

	useEffect(() => {
		fetchAccessRequest({ data: { pageId } }).then(setSent, () => undefined);
	}, [pageId]);

	const send = async () => {
		setSending(true);
		try {
			await submitAccessRequest({ data: { pageId, note: note.trim() } });
			setSent("pending");
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
		} finally {
			setSending(false);
		}
	};

	return (
		<div className="flex min-h-full flex-col">
			<StateHeader>
				<svg
					width="14"
					height="14"
					viewBox="0 0 14 14"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.3"
					aria-hidden="true"
				>
					<rect x="2.5" y="6" width="9" height="6.500" rx="1.500" />
					<path d="M4.500 6V4.500a2.500 2.500 0 0 1 5 0V6" />
				</svg>
				Private page
			</StateHeader>
			<div className="w-full max-w-[568px] pl-[88px] pt-[80px] pr-6 pb-24">
				<h1 className="text-[48px] leading-[54px]">You can't see this page.</h1>
				<p className="mt-3 text-[16px] leading-[26px] text-graphite">
					Ask its owner for access and we'll let you know in your inbox when
					they answer.
				</p>
				<div className="mt-4 flex items-center gap-2.5">
					<Avatar id={ownerName} name={ownerName} size={26} />
					<span className="text-sm text-ink">{ownerName} owns this page</span>
				</div>
				{sent ? (
					<p className="mt-6 text-[14px] text-graphite">
						{sent === "pending"
							? "Your request is with them. You'll see their answer in your inbox."
							: sent === "approved"
								? "You've been given access. Reload to open this page."
								: "They didn't give you access to this page."}
					</p>
				) : (
					<>
						<label className="mt-5 block">
							<span className="mb-2 block text-[13px] font-medium text-ink">
								Add a note{" "}
								<span className="font-normal text-pencil">(optional)</span>
							</span>
							<textarea
								value={note}
								onChange={(e) => setNote(e.target.value)}
								rows={3}
								placeholder="Why you need it"
								className="block w-full resize-none rounded-md border border-rule-strong bg-paper px-3 py-2.5 text-[14px] leading-[21px] text-ink outline-none placeholder:text-pencil focus:border-link"
							/>
						</label>
						<div className="mt-4 flex items-center gap-2">
							<Button
								variant="primary"
								className="h-10 px-4"
								onClick={send}
								loading={sending}
							>
								Ask for access
							</Button>
							<Link to="/w/$workspaceId" params={{ workspaceId: workspace.id }}>
								<Button className="h-10 px-4">Go home</Button>
							</Link>
						</div>
					</>
				)}
			</div>
		</div>
	);
}

export function PageNotFound() {
	const { workspace, pages } = useWorkspace();
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const recent = pages
		.filter((p) => p.kind !== "row")
		.filter((p) =>
			query.trim()
				? p.title.toLowerCase().includes(query.trim().toLowerCase())
				: true,
		)
		.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
		.slice(0, 5);
	return (
		<div className="flex min-h-full flex-col">
			<StateHeader>Page not found</StateHeader>
			<div className="w-full max-w-[568px] pl-[88px] pt-[80px] pr-6 pb-24">
				<h1 className="text-[48px] leading-[54px]">This page isn't here.</h1>
				<p className="mt-3 text-[16px] leading-[26px] text-graphite">
					It may have moved or been deleted, or the link may be wrong.
				</p>
				<div className="mt-6 flex h-10 items-center gap-2 rounded-md border border-rule-strong px-3">
					<SearchIcon size={15} className="text-pencil" />
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search for it"
						aria-label="Search for a page"
						className="h-full w-full bg-transparent text-[16px] outline-none placeholder:text-pencil"
					/>
				</div>
				<h2 className="mt-7 text-[13px] font-medium text-ink">Recent pages</h2>
				<ul className="mt-2">
					{recent.map((page) => {
						const parent = pages.find((p) => p.id === page.parentId);
						return (
							<li key={page.id}>
								<Link
									to="/p/$pageId"
									params={{ pageId: page.id }}
									className="flex h-9 items-center justify-between border-b border-rule text-[14px] text-ink hover:text-link"
								>
									<span className="truncate">{page.title || "Untitled"}</span>
									<span className="text-[13px] text-pencil">
										{parent?.title ?? ""}
									</span>
								</Link>
							</li>
						);
					})}
					{!recent.length && (
						<li className="py-2 text-sm text-pencil">Nothing matches that.</li>
					)}
				</ul>
				<div className="mt-6 flex items-center gap-2">
					<Link to="/w/$workspaceId" params={{ workspaceId: workspace.id }}>
						<Button variant="primary" className="h-10 px-4">
							Go home
						</Button>
					</Link>
					<Button
						className="h-10 px-4"
						onClick={() =>
							navigate({
								to: "/w/$workspaceId/settings/$section",
								params: { workspaceId: workspace.id, section: "trash" },
							})
						}
					>
						Look in Trash
					</Button>
				</div>
			</div>
		</div>
	);
}
