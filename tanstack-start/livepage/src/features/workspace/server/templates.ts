// Built-in templates: real pages and databases, written the same way the editor and database
// views write them, so everything here can be edited together the moment it's created.
import { TablesDB } from "node-appwrite";
import type { Block, Inline } from "#/lib/blocks";
import { snapshotFromBlocks } from "#/lib/blocks";
import type { Page } from "#/lib/types";
import { adminClient } from "#/server/appwrite";
import { createProperty, createRows, createView } from "#/server/database";
import { createPage } from "#/server/pages";
import { BODIES, DATABASE_ID } from "#/server/schema";

const t = (text: string): Inline[] => [{ text }];
const p = (text: string): Block => ({ type: "paragraph", content: t(text) });
const h2 = (text: string): Block => ({
	type: "heading",
	level: 2,
	content: t(text),
});
const bullets = (...items: string[]): Block => ({
	type: "bulletList",
	items: items.map((text) => ({ content: t(text) })),
});
const tasks = (...items: string[]): Block => ({
	type: "taskList",
	items: items.map((text) => ({ content: t(text), checked: false })),
});

type Choice = {
	id: string;
	name: string;
	color: "gray" | "green" | "amber" | "blue" | "violet" | "coral";
};
type Prop = {
	key: string;
	name: string;
	type: string;
	choices?: Choice[];
	format?: string;
};

const today = () => new Date();
const addDays = (days: number) => {
	const d = today();
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
};

type PageTemplate = {
	id: string;
	kind: "page";
	category: "meetings" | "projects" | "databases";
	title: string;
	description: string;
	blocks: () => Block[];
};

type DatabaseTemplate = {
	id: string;
	kind: "database";
	category: "projects" | "databases";
	title: string;
	description: string;
	properties: Prop[];
	rows: () => { title: string; values: Record<string, unknown> }[];
	views: {
		name: string;
		type: "table" | "board" | "calendar" | "timeline" | "gallery";
		groupBy?: string;
		date?: string;
	}[];
};

export type Template = PageTemplate | DatabaseTemplate;

const STATUS_CHOICES: Choice[] = [
	{ id: "planned", name: "Planned", color: "gray" },
	{ id: "progress", name: "In progress", color: "blue" },
	{ id: "review", name: "In review", color: "amber" },
	{ id: "done", name: "Shipping", color: "green" },
];

const BOARD_CHOICES: Choice[] = [
	{ id: "todo", name: "To do", color: "gray" },
	{ id: "doing", name: "Doing", color: "blue" },
	{ id: "done", name: "Done", color: "green" },
];

const KIND_CHOICES: Choice[] = [
	{ id: "review", name: "Review", color: "violet" },
	{ id: "ship", name: "Ship date", color: "blue" },
	{ id: "off", name: "Time off", color: "amber" },
];

export const TEMPLATES: Template[] = [
	{
		id: "meeting-notes",
		kind: "page",
		category: "meetings",
		title: "Meeting notes",
		description: "Agenda, notes and who does what next.",
		blocks: () => [
			p("Date: _ · People: _"),
			h2("Agenda"),
			tasks(
				"First topic to cover",
				"Second topic to cover",
				"Who does what next",
			),
			h2("Notes"),
			p("Capture what was said and why it matters."),
			h2("Decisions"),
			bullets("What did we decide?"),
			h2("Next steps"),
			tasks("@someone does the first thing by Friday"),
		],
	},
	{
		id: "project-brief",
		kind: "page",
		category: "projects",
		title: "Project brief",
		description: "The goal, the scope, owners and dates.",
		blocks: () => [
			h2("Goal"),
			p("One sentence on what changes for people when this ships."),
			h2("Why now"),
			p("The problem today, in plain words, and what happens if we wait."),
			h2("Scope"),
			bullets(
				"What's in: the smallest version that reaches the goal",
				"What's out: what we're not doing, and why",
			),
			h2("Owners"),
			bullets("Driver:", "Design:", "Engineering:"),
			h2("Dates"),
			tasks("Kickoff", "First version in front of people", "Launch"),
		],
	},
	{
		id: "launch-plan",
		kind: "page",
		category: "projects",
		title: "Launch plan",
		description: "Phases, milestones and the launch checklist.",
		blocks: () => [
			h2("Phases"),
			tasks(
				"Design: settled by the end of the week",
				"Build: feature complete",
				"Rollout: staged to everyone",
			),
			h2("Launch checklist"),
			tasks(
				"Docs and changelog written",
				"Support briefed",
				"Metrics in place",
				"Rollback plan agreed",
			),
			h2("Risks"),
			p("What could go wrong, and what we'll do if it does."),
		],
	},
	{
		id: "weekly-review",
		kind: "page",
		category: "meetings",
		title: "Weekly review",
		description: "What shipped, what's stuck, what's next.",
		blocks: () => [
			h2("What shipped"),
			bullets("Thing that went out this week"),
			h2("What's stuck"),
			bullets("Thing that needs help, and from whom"),
			h2("Next week"),
			tasks("The one thing that matters most"),
		],
	},
	{
		id: "roadmap",
		kind: "database",
		category: "databases",
		title: "Roadmap",
		description: "Projects by owner, status and target date.",
		properties: [
			{ key: "name", name: "Project", type: "title" },
			{
				key: "status",
				name: "Status",
				type: "status",
				choices: STATUS_CHOICES,
			},
			{ key: "owner", name: "Owner", type: "person" },
			{ key: "target", name: "Target", type: "date" },
		],
		rows: () => [
			{
				title: "First project",
				values: { status: "progress", target: { start: addDays(14) } },
			},
			{
				title: "Second project",
				values: { status: "review", target: { start: addDays(30) } },
			},
			{
				title: "A later idea",
				values: { status: "planned", target: { start: addDays(60) } },
			},
		],
		views: [
			{ name: "Table", type: "table" },
			{ name: "By status", type: "board", groupBy: "status" },
			{ name: "Timeline", type: "timeline", date: "target" },
		],
	},
	{
		id: "task-board",
		kind: "database",
		category: "databases",
		title: "Task board",
		description: "Move work across columns as it moves along.",
		properties: [
			{ key: "name", name: "Task", type: "title" },
			{ key: "status", name: "Status", type: "status", choices: BOARD_CHOICES },
			{ key: "owner", name: "Owner", type: "person" },
			{ key: "due", name: "Due", type: "date" },
		],
		rows: () => [
			{
				title: "Something to start on",
				values: { status: "todo", due: { start: addDays(3) } },
			},
			{ title: "Something underway", values: { status: "doing" } },
			{
				title: "Something finished",
				values: { status: "done", due: { start: addDays(-1) } },
			},
		],
		views: [
			{ name: "Board", type: "board", groupBy: "status" },
			{ name: "Table", type: "table" },
		],
	},
	{
		id: "team-calendar",
		kind: "database",
		category: "databases",
		title: "Team calendar",
		description: "Reviews, ship dates and time off on one month.",
		properties: [
			{ key: "name", name: "Event", type: "title" },
			{ key: "kind", name: "Kind", type: "select", choices: KIND_CHOICES },
			{ key: "date", name: "Date", type: "date" },
		],
		rows: () => [
			{
				title: "Design review",
				values: { kind: "review", date: { start: addDays(2) } },
			},
			{
				title: "Ship the next release",
				values: { kind: "ship", date: { start: addDays(7) } },
			},
			{
				title: "Out of office",
				values: { kind: "off", date: { start: addDays(10) } },
			},
		],
		views: [
			{ name: "Calendar", type: "calendar", date: "date" },
			{ name: "Table", type: "table" },
		],
	},
];

export async function createFromTemplate(input: {
	workspaceId: string;
	templateId: string;
	sectionId?: string | null;
	position?: number;
}): Promise<Page> {
	const template = TEMPLATES.find((tpl) => tpl.id === input.templateId);
	if (!template) throw new Error("That template doesn't exist.");
	const page = await createPage({
		workspaceId: input.workspaceId,
		title: template.title,
		kind: template.kind,
		sectionId: input.sectionId ?? null,
		position: input.position,
	});
	const db = new TablesDB(adminClient());
	if (template.kind === "page") {
		const {
			snapshot,
			stateVector,
			text,
			links: _links,
		} = snapshotFromBlocks(page.id, template.title, template.blocks());
		await db.updateRow({
			databaseId: DATABASE_ID,
			tableId: BODIES,
			rowId: page.id,
			data: {
				snapshot,
				stateVector,
				snapshotAt: new Date().toISOString(),
				text,
			},
		});
		return page;
	}
	const propertyIds = new Map<string, string>();
	for (const [index, prop] of template.properties.entries()) {
		const { property } = await createProperty({
			databaseId: page.id,
			name: prop.name,
			type: prop.type,
			position: index,
			options: {
				...(prop.choices ? { choices: prop.choices } : {}),
			},
		});
		propertyIds.set(prop.key, property.id);
	}
	for (const [index, view] of template.views.entries()) {
		await createView({
			databaseId: page.id,
			name: view.name,
			type: view.type,
			position: index,
			config: {
				groupBy: view.groupBy ? (propertyIds.get(view.groupBy) ?? null) : null,
				dateProperty: view.date ? (propertyIds.get(view.date) ?? null) : null,
			},
		});
	}
	const { ID } = await import("node-appwrite");
	await createRows(
		page.id,
		template.rows().map((row, index) => ({
			id: ID.unique(),
			title: row.title,
			position: index,
			cells: Object.entries(row.values)
				.filter(([key]) => propertyIds.has(key))
				.map(([key, value]) => ({
					propertyId: propertyIds.get(key) as string,
					value,
				})),
		})),
	);
	return page;
}
