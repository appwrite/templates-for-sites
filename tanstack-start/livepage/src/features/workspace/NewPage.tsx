import { useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
	PageIcon,
	PlusIcon,
	SparkleFilled,
	TableIcon,
} from "#/components/icons";
import { useWorkspace } from "#/components/shell/workspace-context";
import { useToast } from "#/components/ui";
import { useAiStatus } from "#/features/ai/client";
import { errorText } from "#/lib/errors";
import { submitCreateFromTemplate } from "./functions";

const CalendarIcon = () => (
	<svg
		width="16"
		height="16"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.4"
		strokeLinecap="round"
		aria-hidden="true"
	>
		<rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
		<path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
	</svg>
);

const DocIcon = () => (
	<svg
		width="16"
		height="16"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.4"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<rect x="3" y="2" width="10" height="12" rx="1.5" />
		<path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
	</svg>
);

const ImportIcon = () => (
	<svg
		width="16"
		height="16"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.4"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<path d="M8 2v8M5 7l3 3 3-3M2.5 13.5h11" />
	</svg>
);

type Row = {
	id: string;
	title: string;
	detail: string;
	icon: React.ReactNode;
	ai?: boolean;
};

// Where "New page" lands. Nothing is created until a starting point is picked, so abandoned
// new pages don't pile up.
export function NewPage() {
	const { workspace, pages, createPage } = useWorkspace();
	const router = useRouter();
	const navigate = useNavigate();
	const toast = useToast();
	const ai = useAiStatus(workspace.id);
	const [busy, setBusy] = useState<string | null>(null);
	const [title, setTitle] = useState("");

	const place = {
		sectionId: workspace.sections[0]?.id ?? null,
		position: Math.max(0, ...pages.map((p) => p.position)) + 1,
	};

	const open = (pageId: string) =>
		router.navigate({ to: "/p/$pageId", params: { pageId } });

	const blank = async (kind: "page" | "database") => {
		setBusy(kind);
		const page = await createPage({ ...place, kind, title: title.trim() });
		if (page) await open(page.id);
		setBusy(null);
	};

	const fromTemplate = async (templateId: string) => {
		setBusy(templateId);
		try {
			const page = await submitCreateFromTemplate({
				data: { workspaceId: workspace.id, templateId, ...place },
			});
			await open(page.id);
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
			setBusy(null);
		}
	};

	const writeWithAi = async () => {
		setBusy("ai");
		const page = await createPage({ ...place, kind: "page" });
		if (!page) {
			setBusy(null);
			return;
		}
		await open(page.id);
		// The editor mounts its AI layer once the page has loaded.
		let tries = 0;
		const timer = setInterval(() => {
			tries++;
			if (document.querySelector(".ProseMirror") || tries > 40) {
				clearInterval(timer);
				window.dispatchEvent(
					new CustomEvent("livepage:ai", { detail: { action: "write" } }),
				);
			}
		}, 150);
	};

	const rows: (Row & { run: () => void })[] = [
		{
			id: "page",
			title: "Blank",
			detail: "An empty page.",
			icon: <PageIcon />,
			run: () => blank("page"),
		},
		{
			id: "meeting-notes",
			title: "Meeting notes",
			detail: "Agenda, notes and who does what next.",
			icon: <CalendarIcon />,
			run: () => fromTemplate("meeting-notes"),
		},
		{
			id: "project-brief",
			title: "Project brief",
			detail: "The goal, the scope, owners and dates.",
			icon: <DocIcon />,
			run: () => fromTemplate("project-brief"),
		},
		{
			id: "database",
			title: "Database",
			detail: "Tasks or anything else, as a list, board or calendar.",
			icon: <TableIcon />,
			run: () => blank("database"),
		},
		...(ai?.state === "ready"
			? [
					{
						id: "ai",
						title: "Write with AI",
						detail: "Say what you need and AI drafts the page.",
						icon: <SparkleFilled size={14} />,
						ai: true,
						run: writeWithAi,
					},
				]
			: []),
		{
			id: "import",
			title: "Import",
			detail: "Bring in a Notion export or Markdown files.",
			icon: <ImportIcon />,
			run: () =>
				navigate({
					to: "/w/$workspaceId/settings/$section",
					params: { workspaceId: workspace.id, section: "import" },
				}),
		},
	];

	useEffect(() => {
		document.title = "New page";
	}, []);

	return (
		<div className="lp-hit mx-auto max-w-[808px] px-6 pb-12 pt-10 md:pt-14">
			<form
				onSubmit={(e) => {
					e.preventDefault();
					void blank("page");
				}}
			>
				<label className="sr-only" htmlFor="new-title">
					Page title
				</label>
				<input
					id="new-title"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder="Untitled"
					maxLength={512}
					className="w-full border-none bg-transparent font-serif text-2xl font-medium leading-[54px] tracking-[-0.02em] text-ink outline-none placeholder:text-pencil"
				/>
			</form>
			<p className="mt-2.5 text-md leading-6 text-graphite">
				Start writing, press / for blocks, or pick a starting point.
			</p>
			<section className="mt-[58px]">
				<div className="flex h-8 items-center border-b border-rule">
					<h2 className="flex-1 text-sm font-semibold text-ink">Start from</h2>
					<button
						type="button"
						className="text-sm text-link"
						onClick={() =>
							navigate({
								to: "/w/$workspaceId/templates",
								params: { workspaceId: workspace.id },
							})
						}
					>
						All templates
					</button>
				</div>
				{rows.map((row) => (
					<button
						key={row.id}
						type="button"
						disabled={Boolean(busy)}
						onClick={row.run}
						className="flex h-12 w-full items-center gap-3 border-b border-rule text-left hover:bg-wash disabled:cursor-not-allowed"
					>
						<span
							className={`w-5 shrink-0 ${row.ai ? "text-link" : "text-graphite"}`}
						>
							{row.icon}
						</span>
						<span
							className={`w-40 shrink-0 text-base font-medium ${row.ai ? "text-link" : "text-ink"}`}
						>
							{row.title}
						</span>
						<span className="min-w-0 flex-1 truncate text-base text-graphite">
							{row.detail}
						</span>
						{busy === row.id && (
							<PlusIcon size={14} className="animate-spin text-pencil" />
						)}
					</button>
				))}
			</section>
		</div>
	);
}
