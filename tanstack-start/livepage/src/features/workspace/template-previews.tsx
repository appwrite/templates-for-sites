// The miniature on each template card. Static on purpose: it shows the shape of the template.

const Chip = ({ tone, children }: { tone: string; children: string }) => (
	<span className={`rounded-sm px-1.5 py-[1px] text-xs ${tone}`}>
		{children}
	</span>
);

function Meeting() {
	return (
		<>
			<div className="font-serif text-lg leading-6 tracking-[-0.02em] text-ink">
				Design review, Mar 4
			</div>
			<div className="mt-1.5 flex items-center gap-1 text-xs text-graphite">
				<span className="size-3.5 rounded-full bg-coral" />
				<span className="size-3.5 rounded-full bg-violet" />
				<span className="size-3.5 rounded-full bg-green" />
				<span className="ml-1">30 minutes</span>
			</div>
			<div className="mt-3 text-xs font-medium text-ink">Agenda</div>
			{[
				"Conflict screen, second pass",
				"Empty states on mobile",
				"Who does what next",
			].map((row, i) => (
				<div
					key={row}
					className="mt-2 flex items-center gap-2 text-xs text-ink"
				>
					<span
						className={`size-3 rounded-[3px] ${i ? "border border-rule-strong" : "bg-accent"}`}
					/>
					{row}
				</div>
			))}
		</>
	);
}

function Brief() {
	return (
		<>
			<div className="font-serif text-lg leading-6 tracking-[-0.02em] text-ink">
				Crew scheduling
			</div>
			<div className="mt-1.5 flex items-center gap-2 text-xs text-graphite">
				<Chip tone="bg-green-soft text-green">In progress</Chip>
				Ships Apr 2
			</div>
			<div className="mt-3 text-xs font-medium text-ink">Goal</div>
			<p className="mt-1 text-xs leading-4 text-graphite">
				Let dispatchers plan a full week of field work in one place, without
				phone calls.
			</p>
			<div className="mt-2 text-xs font-medium text-ink">Scope</div>
			<p className="mt-1 text-xs text-graphite">Week view, swaps, reminders.</p>
		</>
	);
}

function Roadmap() {
	const rows: [string, string, string][] = [
		["Offline mode", "Shipping", "bg-green-soft text-green"],
		["Pricing v3", "In review", "bg-amber-soft text-amber"],
		["SSO for enterprise", "Planned", "bg-wash-2 text-graphite"],
	];
	return (
		<>
			<div className="font-serif text-lg leading-6 tracking-[-0.02em] text-ink">
				Roadmap
			</div>
			<div className="mt-2 flex text-xs text-pencil">
				<span className="flex-1">Project</span>
				<span className="w-20">Status</span>
			</div>
			{rows.map(([name, status, tone]) => (
				<div
					key={name}
					className="mt-[7px] flex items-center border-t border-rule pt-[7px] text-xs text-ink"
				>
					<span className="flex-1 truncate">{name}</span>
					<span className="w-20">
						<Chip tone={tone}>{status}</Chip>
					</span>
				</div>
			))}
		</>
	);
}

function Launch() {
	const bars: [string, string, string][] = [
		["Design", "w-[52%] ml-0", "bg-violet-soft text-violet"],
		["Build", "w-[48%] ml-[18%]", "bg-link-soft text-link"],
		["Rollout", "w-[40%] ml-[46%]", "bg-green-soft text-green"],
	];
	return (
		<>
			<div className="font-serif text-lg leading-6 tracking-[-0.02em] text-ink">
				Launch plan
			</div>
			<div className="mt-2 flex justify-between text-xs text-pencil">
				<span>Mar</span>
				<span>Apr</span>
				<span>May</span>
			</div>
			{bars.map(([label, width, tone]) => (
				<div
					key={label}
					className={`mt-2 rounded-sm px-2 py-1 text-xs ${width} ${tone}`}
				>
					{label}
				</div>
			))}
		</>
	);
}

function Board() {
	const columns: [string, string[], string][] = [
		["To do", ["Low disk banner", "Audit export"], "bg-wash"],
		["Doing", ["Conflict screen"], "bg-link-soft"],
		["Done", ["Soak test", "Sync engine"], "bg-green-soft"],
	];
	return (
		<>
			<div className="font-serif text-lg leading-6 tracking-[-0.02em] text-ink">
				Task board
			</div>
			<div className="mt-2 grid grid-cols-3 gap-2">
				{columns.map(([name, cards, tone]) => (
					<div key={name}>
						<div className="text-xs text-pencil">{name}</div>
						{cards.map((card) => (
							<div
								key={card}
								className={`mt-1.5 rounded-sm px-1.5 py-1 text-xs leading-4 text-ink ${tone}`}
							>
								{card}
							</div>
						))}
					</div>
				))}
			</div>
		</>
	);
}

function Calendar() {
	const cells = [
		["2", ""],
		["3", ""],
		["4", "bg-violet-soft text-violet"],
		["5", ""],
		["6", ""],
		["9", "bg-link-soft text-link"],
		["10", ""],
		["11", ""],
		["12", "bg-amber-soft text-amber"],
		["13", ""],
		["16", ""],
		["17", ""],
		["18", "bg-green-soft text-green"],
		["19", ""],
		["20", ""],
	];
	return (
		<>
			<div className="font-serif text-lg leading-6 tracking-[-0.02em] text-ink">
				March
			</div>
			<div className="mt-2 grid grid-cols-5 gap-1">
				{cells.map(([day, tone]) => (
					<div
						key={day}
						className={`h-[30px] rounded-sm px-1.5 py-1 text-xs ${tone || "bg-wash text-graphite"}`}
					>
						{day}
					</div>
				))}
			</div>
		</>
	);
}

const PREVIEWS: Record<string, () => React.ReactNode> = {
	"meeting-notes": Meeting,
	"weekly-review": Weekly,
	"project-brief": Brief,
	"launch-plan": Launch,
	roadmap: Roadmap,
	"task-board": Board,
	"team-calendar": Calendar,
};

function Weekly() {
	return (
		<>
			<div className="font-serif text-lg leading-6 tracking-[-0.02em] text-ink">
				Week of Mar 9
			</div>
			<div className="mt-2 text-xs font-medium text-ink">What shipped</div>
			<div className="mt-1 text-xs text-graphite">Sync engine soak test</div>
			<div className="mt-2 text-xs font-medium text-ink">What's stuck</div>
			<div className="mt-1 text-xs text-graphite">Legal review on pricing</div>
			<div className="mt-2 text-xs font-medium text-ink">Next week</div>
			<div className="mt-1 flex items-center gap-2 text-xs text-ink">
				<span className="size-3 rounded-[3px] border border-rule-strong" />
				Conflict screen sign-off
			</div>
		</>
	);
}

export function TemplatePreview({ id }: { id: string }) {
	const Preview = PREVIEWS[id] ?? Brief;
	return (
		<div className="flex h-[208px] items-end justify-center overflow-hidden rounded-lg bg-wash px-6 pt-[18px]">
			<div className="h-[190px] w-[294px] rounded-t-md bg-paper px-4 pt-4">
				<Preview />
			</div>
		</div>
	);
}
