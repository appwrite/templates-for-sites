import { useRef, useState } from "react";
import { useWorkspace } from "#/components/shell/workspace-context";
import { Button, useToast } from "#/components/ui";
import { errorText } from "#/lib/errors";
import type { ImportItem, ImportTooLong } from "./server/transfer";
import {
	type ImportResume,
	importUnits,
	itemsFromFiles,
	runExport,
	runImport,
	type SourceFile,
	saveFile,
} from "./transfer-client";
import { Group, PanelTitle, Row, TextLink } from "./ui";

type Job =
	| {
			kind: "import";
			name: string;
			done: number;
			total: number;
			retry?: () => void;
	  }
	| { kind: "export"; done: number };

function describeTooLong(list: ImportTooLong[]) {
	const named = list
		.slice(0, 3)
		.map((t) => `${t.row || "Untitled"}: ${t.column}`);
	const rest = list.length - named.length;
	return `${list.length} ${list.length === 1 ? "cell was" : "cells were"} too long and shortened (${named.join(", ")}${rest ? `, and ${rest} more` : ""}).`;
}

export function TransferPanel() {
	const { workspace } = useWorkspace();
	const toast = useToast();
	const [job, setJob] = useState<Job | null>(null);
	const cancel = useRef(false);
	const notionRef = useRef<HTMLInputElement>(null);
	const markdownRef = useRef<HTMLInputElement>(null);
	const folderRef = useRef<HTMLInputElement>(null);
	const guest = workspace.role === "guest";

	const importFiles = async (list: FileList) => {
		cancel.current = false;
		const name = list.length === 1 ? list[0].name : `${list.length} files`;
		setJob({ kind: "import", name, done: 0, total: 0 });
		try {
			const sources: SourceFile[] = await Promise.all(
				[...list].map(async (file) => ({
					path: file.webkitRelativePath || file.name,
					data: new Uint8Array(await file.arrayBuffer()),
				})),
			);
			const items = itemsFromFiles(sources);
			if (!items.length) {
				toast.show("There are no Markdown or CSV files in that.", {
					tone: "error",
				});
				setJob(null);
				return;
			}
			setJob({ kind: "import", name, done: 0, total: items.length });
			await runImportJob(items, name);
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
			setJob(null);
		}
	};

	const runImportJob = async (
		items: ImportItem[],
		name: string,
		resume?: ImportResume,
	) => {
		const total = importUnits(items);
		setJob({ kind: "import", name, done: resume?.done ?? 0, total });
		try {
			const { done, tooLong } = await runImport(
				workspace.id,
				items,
				(count) => setJob({ kind: "import", name, done: count, total }),
				() => cancel.current,
				resume,
			);
			setJob(null);
			toast.show(
				cancel.current
					? `Stopped after ${done} of ${total}.`
					: `Imported ${done} ${done === 1 ? "item" : "items"}.`,
			);
			if (tooLong.length)
				toast.show(describeTooLong(tooLong), { tone: "error" });
		} catch (err) {
			const state = (err as { resume?: ImportResume }).resume;
			setJob(
				state
					? {
							kind: "import",
							name,
							done: state.done,
							total,
							retry: () => void runImportJob(items, name, state),
						}
					: null,
			);
			toast.show(errorText(err), { tone: "error" });
		}
	};

	const exportAll = async () => {
		cancel.current = false;
		setJob({ kind: "export", done: 0 });
		try {
			const result = await runExport(
				workspace.id,
				(done) => setJob({ kind: "export", done }),
				() => cancel.current,
			);
			if (result)
				saveFile(result.zip, `${workspace.name}.zip`, "application/zip");
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
		} finally {
			setJob(null);
		}
	};

	const pick = (input: HTMLInputElement) => {
		const files = input.files;
		if (files?.length) void importFiles(files);
		input.value = "";
	};

	const percent =
		job?.kind === "import" && job.total
			? Math.round((job.done / job.total) * 100)
			: 0;

	return (
		<>
			<PanelTitle title="Import and export" />
			<Group title="Import">
				{job?.kind === "import" && (
					<div className="border-b border-rule py-3">
						<div className="flex items-baseline justify-between">
							<span className="truncate text-base font-medium text-ink">
								Importing {job.name}
							</span>
							<button
								type="button"
								onClick={() => (cancel.current = true)}
								className="text-sm text-graphite hover:text-ink"
							>
								Cancel
							</button>
						</div>
						<div
							className="mt-2 h-1.5 overflow-hidden rounded-full bg-wash-2"
							role="progressbar"
							aria-valuenow={percent}
							aria-valuemin={0}
							aria-valuemax={100}
						>
							<div
								className="h-full rounded-full bg-accent transition-[width]"
								style={{ width: `${percent}%` }}
							/>
						</div>
						<p className="mt-1.5 text-sm text-graphite">
							{job.total
								? `${job.done.toLocaleString()} of ${job.total.toLocaleString()}.`
								: "Reading the file."}{" "}
							{job.retry ? (
								<>
									Stopped before it finished.{" "}
									<button
										type="button"
										onClick={job.retry}
										className="text-accent hover:underline"
									>
										Try again
									</button>
								</>
							) : (
								"Keep this tab open."
							)}
						</p>
					</div>
				)}
				<Row
					title="Notion export"
					detail="The .zip file you get from Notion's export. Pages and databases come across. Images and page links don't."
				>
					<Button
						disabled={guest || Boolean(job)}
						onClick={() => notionRef.current?.click()}
					>
						Choose file
					</Button>
					<input
						ref={notionRef}
						type="file"
						accept=".zip"
						hidden
						aria-label="Choose a Notion export"
						onChange={(e) => pick(e.target)}
					/>
				</Row>
				<Row
					title="Markdown"
					detail={
						<>
							One or more .md files, or{" "}
							<TextLink
								disabled={guest || Boolean(job)}
								onClick={() => folderRef.current?.click()}
							>
								a folder of them
							</TextLink>
							.
						</>
					}
				>
					<Button
						disabled={guest || Boolean(job)}
						onClick={() => markdownRef.current?.click()}
					>
						Choose files
					</Button>
					<input
						ref={markdownRef}
						type="file"
						accept=".md,.markdown,.csv,.zip"
						multiple
						hidden
						aria-label="Choose Markdown files"
						onChange={(e) => pick(e.target)}
					/>
					<input
						ref={(el) => {
							folderRef.current = el;
							el?.setAttribute("webkitdirectory", "");
						}}
						type="file"
						hidden
						aria-label="Choose a folder"
						onChange={(e) => pick(e.target)}
					/>
				</Row>
			</Group>
			<Group title="Export">
				<Row
					title="Export the workspace"
					detail="Every page as Markdown with its images, and every database as a spreadsheet, in one .zip."
				>
					{job?.kind === "export" ? (
						<div className="flex items-center gap-3">
							<span className="text-sm text-graphite">{job.done} pages</span>
							<button
								type="button"
								onClick={() => (cancel.current = true)}
								className="text-sm text-graphite hover:text-ink"
							>
								Cancel
							</button>
						</div>
					) : (
						<Button
							variant="primary"
							disabled={Boolean(job)}
							onClick={exportAll}
						>
							Export
						</Button>
					)}
				</Row>
			</Group>
		</>
	);
}
