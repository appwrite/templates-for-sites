// Teamspaces are the sidebar's sections: named groups of pages for the whole workspace.

import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useWorkspace } from "#/components/shell/workspace-context";
import { Button, Input, useToast } from "#/components/ui";
import { submitGeneral } from "#/functions/settings";
import { randomId } from "#/lib/browser";
import { errorText } from "#/lib/errors";
import type { Section } from "#/lib/types";
import { PanelTitle } from "./ui";

export function TeamspacesPanel() {
	const { workspace, pages } = useWorkspace();
	const router = useRouter();
	const toast = useToast();
	const manager = workspace.role === "owner" || workspace.role === "admin";
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);

	const save = async (sections: Section[]) => {
		setBusy(true);
		try {
			await submitGeneral({ data: { workspaceId: workspace.id, sections } });
			await router.invalidate();
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
		} finally {
			setBusy(false);
		}
	};

	const counts = new Map<string, number>();
	for (const page of pages)
		if (page.sectionId)
			counts.set(page.sectionId, (counts.get(page.sectionId) ?? 0) + 1);

	return (
		<>
			<PanelTitle
				title="Teamspaces"
				subtitle="Named groups of pages in the sidebar."
			/>
			<div className="w-full max-w-[620px]">
				{workspace.sections.map((section) => (
					<SectionRow
						key={section.id}
						section={section}
						pageCount={counts.get(section.id) ?? 0}
						editable={manager}
						busy={busy}
						onRename={(name) =>
							save(
								workspace.sections.map((s) =>
									s.id === section.id ? { ...s, name } : s,
								),
							)
						}
						onDelete={() =>
							save(workspace.sections.filter((s) => s.id !== section.id))
						}
					/>
				))}
				{!workspace.sections.length && (
					<p className="text-sm text-pencil">No teamspaces yet.</p>
				)}
				{manager && (
					<form
						className="mt-4 flex gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							const name = draft.trim();
							if (!name) return;
							setDraft("");
							void save([
								...workspace.sections,
								{
									id: randomId().replaceAll("-", "").slice(0, 16),
									name,
								},
							]);
						}}
					>
						<Input
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							placeholder="New teamspace"
							aria-label="New teamspace"
							maxLength={64}
							className="h-[34px] flex-1"
						/>
						<Button type="submit" disabled={!draft.trim()} loading={busy}>
							Add
						</Button>
					</form>
				)}
			</div>
		</>
	);
}

function SectionRow({
	section,
	pageCount,
	editable,
	busy,
	onRename,
	onDelete,
}: {
	section: Section;
	pageCount: number;
	editable: boolean;
	busy: boolean;
	onRename: (name: string) => void;
	onDelete: () => void;
}) {
	const [name, setName] = useState(section.name);
	const commit = () => {
		const next = name.trim();
		if (next && next !== section.name) onRename(next);
		else setName(section.name);
	};
	return (
		<div className="flex items-center gap-3 border-b border-rule py-2">
			{editable ? (
				<Input
					value={name}
					onChange={(e) => setName(e.target.value)}
					onBlur={commit}
					onKeyDown={(e) =>
						e.key === "Enter" && (e.target as HTMLInputElement).blur()
					}
					aria-label={`Rename ${section.name}`}
					maxLength={64}
					className="h-[32px] flex-1 border-transparent hover:border-rule"
				/>
			) : (
				<span className="flex-1 text-base text-ink">{section.name}</span>
			)}
			<span className="text-sm text-graphite">
				{pageCount} {pageCount === 1 ? "page" : "pages"}
			</span>
			{editable && (
				<button
					type="button"
					disabled={busy || pageCount > 0}
					title={pageCount > 0 ? "Move its pages out first." : undefined}
					onClick={onDelete}
					className="text-sm text-coral hover:underline disabled:cursor-not-allowed disabled:text-pencil disabled:no-underline"
				>
					Delete
				</button>
			)}
		</div>
	);
}
