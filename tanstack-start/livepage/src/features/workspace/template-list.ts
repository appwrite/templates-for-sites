// What the template gallery shows. The content itself lives on the server (server/templates.ts).
export type TemplateMeta = {
	id: string;
	category: "meetings" | "projects" | "databases";
	title: string;
	description: string;
};

export const TEMPLATE_META: TemplateMeta[] = [
	{
		id: "meeting-notes",
		category: "meetings",
		title: "Meeting notes",
		description: "Agenda, notes and who does what next.",
	},
	{
		id: "project-brief",
		category: "projects",
		title: "Project brief",
		description: "The goal, the scope, owners and dates.",
	},
	{
		id: "roadmap",
		category: "databases",
		title: "Roadmap",
		description: "Projects by owner, status and target date.",
	},
	{
		id: "launch-plan",
		category: "projects",
		title: "Launch plan",
		description: "Phases, milestones and the launch checklist.",
	},
	{
		id: "task-board",
		category: "databases",
		title: "Task board",
		description: "Move work across columns as it moves along.",
	},
	{
		id: "team-calendar",
		category: "databases",
		title: "Team calendar",
		description: "Reviews, ship dates and time off on one month.",
	},
	{
		id: "weekly-review",
		category: "meetings",
		title: "Weekly review",
		description: "What shipped, what's stuck, what's next.",
	},
];
