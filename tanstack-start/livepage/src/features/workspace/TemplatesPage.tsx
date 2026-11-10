import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useWorkspace } from "#/components/shell/workspace-context";
import { Spinner, useToast } from "#/components/ui";
import { errorText } from "#/lib/errors";
import { submitCreateFromTemplate } from "./functions";
import { NewPageAction } from "./TopBarNew";
import { TEMPLATE_META } from "./template-list";
import { TemplatePreview } from "./template-previews";

type Filter = "all" | "meetings" | "projects" | "databases";

const FILTERS: { value: Filter; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "meetings", label: "Meetings" },
	{ value: "projects", label: "Projects" },
	{ value: "databases", label: "Databases" },
];

export function TemplatesPage() {
	const { workspace, pages } = useWorkspace();
	const router = useRouter();
	const toast = useToast();
	const [filter, setFilter] = useState<Filter>("all");
	const [creating, setCreating] = useState<string | null>(null);
	const list = TEMPLATE_META.filter(
		(t) => filter === "all" || t.category === filter,
	);

	const pick = async (templateId: string) => {
		setCreating(templateId);
		try {
			const page = await submitCreateFromTemplate({
				data: {
					workspaceId: workspace.id,
					templateId,
					sectionId: workspace.sections[0]?.id ?? null,
					position: Math.max(0, ...pages.map((p) => p.position)) + 1,
				},
			});
			router.navigate({ to: "/p/$pageId", params: { pageId: page.id } });
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
			setCreating(null);
		}
	};

	const guest = workspace.role === "guest";

	return (
		<div className="lp-hit mx-auto w-full max-w-[1112px] px-6 pb-12 pt-10 md:pt-14">
			{!guest && <NewPageAction />}
			<div className="flex flex-wrap items-end gap-4">
				<div className="min-w-0 flex-1 basis-[260px] max-md:basis-full">
					<h1 className="font-serif text-[32px] font-medium leading-[38px] tracking-[-0.02em] text-ink">
						Templates
					</h1>
					<p className="mt-2 text-base text-graphite">
						Pick one and it becomes a page you can edit together.
					</p>
				</div>
				<div className="flex items-center gap-1">
					{FILTERS.map((f) => (
						<button
							key={f.value}
							type="button"
							onClick={() => setFilter(f.value)}
							className={`rounded-md px-2.5 py-1.5 text-sm leading-4 ${filter === f.value ? "bg-link-soft font-medium text-link" : "text-graphite hover:bg-wash-2"}`}
						>
							{f.label}
						</button>
					))}
				</div>
			</div>
			<div className="mt-7 grid grid-cols-1 gap-x-6 gap-y-[30px] sm:grid-cols-2 lg:grid-cols-3">
				{list.map((tpl) => (
					<button
						key={tpl.id}
						type="button"
						disabled={guest || Boolean(creating)}
						onClick={() => pick(tpl.id)}
						className="group text-left disabled:cursor-not-allowed"
					>
						<TemplatePreview id={tpl.id} />
						<div className="mt-[10px] flex items-center gap-2 text-base font-medium text-ink">
							{tpl.title}
							{creating === tpl.id && <Spinner size={12} />}
						</div>
						<p className="mt-0.5 text-sm text-graphite">{tpl.description}</p>
					</button>
				))}
			</div>
			{guest && (
				<p className="mt-6 text-sm text-pencil">
					Guests can't create pages. Ask a workspace member to do it.
				</p>
			)}
		</div>
	);
}
