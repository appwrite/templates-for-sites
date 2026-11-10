// A brand-new database: quick first row, suggested columns, and ways to bring data in (board 67).
import { useRef, useState } from "react";
import { SparkleFilled } from "#/components/icons";
import { ImportDialog } from "./import";
import type { DatabaseStore } from "./store";
import type { PropertyType } from "./types";
import { DEFAULT_STATUS_CHOICES } from "./types";
import { Chip, nextPropertyName } from "./ui";

const SUGGESTIONS: {
	label: string;
	hint: string;
	type: PropertyType;
	name: string;
	preview: string;
}[] = [
	{
		label: "Status",
		hint: "Where each item is",
		type: "status",
		name: "Status",
		preview: "In progress",
	},
	{
		label: "Owner",
		hint: "Who is following up",
		type: "person",
		name: "Owner",
		preview: "",
	},
	{
		label: "Due date",
		hint: "When it's due",
		type: "date",
		name: "Due date",
		preview: "Mar 12",
	},
	{
		label: "Notes",
		hint: "A short description",
		type: "text",
		name: "Notes",
		preview: "Text",
	},
];

export function EmptyDatabase({
	store,
	onImport,
}: {
	store: DatabaseStore;
	onImport: (mode: "file" | "paste") => void;
}) {
	const [name, setName] = useState("");
	const [dragOver, setDragOver] = useState(false);
	const [dropped, setDropped] = useState<string | null>(null);
	const fileRef = useRef<HTMLInputElement>(null);

	const addFirst = () => {
		const title = name.trim();
		if (!title) return;
		store.createRow({ title });
		setName("");
	};

	const addColumn = (s: (typeof SUGGESTIONS)[number]) => {
		void store.createProperty({
			name: nextPropertyName(store, s.name),
			type: s.type,
			options: s.type === "status" ? { choices: DEFAULT_STATUS_CHOICES } : {},
		});
	};

	const onFile = async (file: File | undefined) => {
		if (!file) return;
		setDropped(await file.text());
	};

	if (dropped !== null)
		return (
			<ImportDialog
				store={store}
				initialText={dropped}
				onClose={() => setDropped(null)}
			/>
		);

	return (
		<div className="min-h-0 flex-1 overflow-auto px-4 md:px-8 pt-1 pb-10">
			<div className="flex h-9 items-center border-b border-rule text-sm text-pencil">
				<span className="w-[280px]">Name</span>
			</div>
			<div className="flex h-11 items-center border-b border-rule">
				<input
					aria-label="First row name"
					placeholder="Type a name to add the first row"
					className="h-full w-full bg-transparent text-base text-ink outline-none placeholder:text-pencil"
					value={name}
					onChange={(e) => setName(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") addFirst();
					}}
				/>
			</div>
			<div className="flex h-11 items-center border-b border-rule">
				<div className="h-1.5 w-40 rounded-sm bg-wash-2" />
			</div>
			<div className="flex h-11 items-center border-b border-rule">
				<div className="h-1.5 w-28 rounded-sm bg-wash" />
			</div>

			<div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
				<section>
					<h2 className="font-serif text-[22px] leading-7 font-medium">
						Suggested columns
					</h2>
					<p className="mt-0.5 text-base text-graphite">
						Add any you like, or skip them.
					</p>
					<div className="mt-3 border-t border-rule">
						{SUGGESTIONS.map((s) => (
							<div
								key={s.label}
								className="flex h-13 items-center gap-3 border-b border-rule py-2"
							>
								<div className="w-[92px] shrink-0 text-sm text-graphite">
									{s.type === "status" ? (
										<Chip color="green">{s.preview}</Chip>
									) : (
										s.preview
									)}
								</div>
								<div className="min-w-0 flex-1">
									<div className="text-base">{s.label}</div>
									<div className="truncate text-sm text-graphite">{s.hint}</div>
								</div>
								<button
									type="button"
									className="text-sm text-link hover:underline"
									onClick={() => addColumn(s)}
								>
									+ Add
								</button>
							</div>
						))}
						{store.aiEnabled && (
							<div className="flex h-13 items-center gap-3 border-b border-rule py-2">
								<div className="flex w-[92px] shrink-0 items-center gap-1.5 text-sm text-link">
									<SparkleFilled size={12} /> AI
								</div>
								<div className="min-w-0 flex-1">
									<div className="text-base">Theme, filled by AI</div>
									<div className="truncate text-sm text-graphite">
										Pulls one theme from each note.
									</div>
								</div>
								<button
									type="button"
									className="text-sm text-link hover:underline"
									onClick={() =>
										void store.createProperty({
											name: nextPropertyName(store, "Theme"),
											type: "ai",
											options: {
												prompt: "In one or two words, the theme of this row.",
												sources: store.properties.map((p) => p.id),
												refill: true,
											},
										})
									}
								>
									+ Add
								</button>
							</div>
						)}
					</div>
				</section>
				<section>
					<h2 className="font-serif text-[22px] leading-7 font-medium">
						Bring it in
					</h2>
					<p className="mt-0.5 text-base text-graphite">
						Already keeping this somewhere else?
					</p>
					<label
						className={`mt-3 flex h-[140px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed text-base ${dragOver ? "border-link bg-link-soft" : "border-rule-strong"}`}
						onDragOver={(e) => {
							e.preventDefault();
							setDragOver(true);
						}}
						onDragLeave={() => setDragOver(false)}
						onDrop={(e) => {
							e.preventDefault();
							setDragOver(false);
							void onFile(e.dataTransfer.files?.[0]);
						}}
					>
						<span className="font-medium">Drop a spreadsheet here</span>
						<span className="text-sm text-graphite">CSV, or choose a file</span>
						<input
							ref={fileRef}
							type="file"
							hidden
							accept=".csv,.tsv,text/csv,text/tab-separated-values"
							aria-label="Choose a spreadsheet"
							onChange={(e) => void onFile(e.target.files?.[0])}
						/>
					</label>
					<button
						type="button"
						onClick={() => onImport("paste")}
						className="flex h-11 w-full items-center justify-between border-b border-rule text-left text-base"
					>
						Paste from Google Sheets <span className="text-pencil">›</span>
					</button>
					<button
						type="button"
						onClick={() => onImport("file")}
						className="flex h-11 w-full items-center justify-between border-b border-rule text-left text-base"
					>
						Bring in a Notion database <span className="text-pencil">›</span>
					</button>
				</section>
			</div>
		</div>
	);
}
