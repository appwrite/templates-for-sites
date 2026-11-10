// Shapes for database properties, views and values.

export type PropertyType =
	| "title"
	| "text"
	| "number"
	| "select"
	| "multi_select"
	| "status"
	| "date"
	| "person"
	| "checkbox"
	| "url"
	| "email"
	| "phone"
	| "files"
	| "relation"
	| "rollup"
	| "formula"
	| "created_time"
	| "created_by"
	| "edited_time"
	| "edited_by"
	| "ai";

export type ChipColor =
	| "gray"
	| "green"
	| "amber"
	| "blue"
	| "violet"
	| "coral";

export type Choice = { id: string; name: string; color: ChipColor };

export type NumberFormat =
	| "number"
	| "comma"
	| "percent"
	| "dollar"
	| "euro"
	| "pound"
	| "rupee";

export type RollupFn =
	| "count"
	| "count_values"
	| "unique"
	| "empty"
	| "not_empty"
	| "sum"
	| "average"
	| "median"
	| "min"
	| "max"
	| "earliest"
	| "latest"
	| "date_range"
	| "percent_checked"
	| "open_of_total"
	| "show_original";

export type PropertyOptions = {
	description?: string;
	format?: NumberFormat;
	decimals?: number;
	choices?: Choice[];
	targetDatabaseId?: string;
	pairedPropertyId?: string;
	side?: "source" | "reverse";
	relationId?: string;
	targetPropertyId?: string;
	show?: RollupFn;
	openChoiceId?: string;
	expression?: string;
	// Each column name written in the expression, with its column's id, so a rename doesn't break it.
	refs?: Record<string, string>;
	prompt?: string;
	sources?: string[];
	refill?: boolean;
};

export type Property = {
	id: string;
	databaseId: string;
	name: string;
	type: PropertyType;
	options: PropertyOptions;
	position: number;
};

export type ViewType = "table" | "board" | "calendar" | "timeline" | "gallery";

export type FilterItem = {
	id: string;
	propertyId: string;
	condition: string;
	value: unknown;
};

export type FilterGroup = {
	op: "and" | "or";
	items: (FilterItem | FilterGroup)[];
};

export type SortItem = { propertyId: string; direction: "asc" | "desc" };

export type CalcFn =
	| "count_all"
	| "count_values"
	| "count_empty"
	| "percent_empty"
	| "percent_filled"
	| "unique"
	| "sum"
	| "average"
	| "median"
	| "min"
	| "max"
	| "range"
	| "earliest"
	| "latest"
	| "checked"
	| "unchecked"
	| "percent_checked";

export type ViewConfig = {
	filter: FilterGroup;
	sorts: SortItem[];
	groupBy: string | null;
	groupOrder: string[];
	hideEmptyGroups: boolean;
	// The "No Status" group shows only while it has rows, unless this is on.
	showEmptyGroup: boolean;
	hidden: string[];
	order: string[];
	widths: Record<string, number>;
	footer: Record<string, CalcFn>;
	dateProperty: string | null;
	scale: "quarters" | "months" | "weeks";
	cover: "first-image" | "page-cover" | "none";
};

export type View = {
	id: string;
	databaseId: string;
	name: string;
	type: ViewType;
	config: ViewConfig;
	position: number;
};

export type DbRow = {
	id: string;
	title: string;
	icon: string | null;
	coverFileId: string | null;
	position: number;
	createdAt: string;
	updatedAt: string;
	createdBy: string;
	updatedBy: string;
	// Stamped by this browser's clock, so it can't be compared with server times.
	local?: boolean;
};

export type DatabaseAccess = { canEdit: boolean; direct: boolean };

export type DateValue = { start: string; end?: string };
export type FileValue = { fileId: string; name: string; mime?: string };

export const DEFAULT_CONFIG: ViewConfig = {
	filter: { op: "and", items: [] },
	sorts: [],
	groupBy: null,
	groupOrder: [],
	hideEmptyGroups: false,
	showEmptyGroup: false,
	hidden: [],
	order: [],
	widths: {},
	footer: {},
	dateProperty: null,
	scale: "quarters",
	cover: "first-image",
};

export function withDefaults(config: Partial<ViewConfig> | null | undefined) {
	return { ...DEFAULT_CONFIG, ...(config ?? {}) } as ViewConfig;
}

export function isComputed(type: PropertyType) {
	return (
		type === "formula" ||
		type === "rollup" ||
		type === "created_time" ||
		type === "created_by" ||
		type === "edited_time" ||
		type === "edited_by"
	);
}

export const CHIP_CLASSES: Record<ChipColor, string> = {
	gray: "bg-wash-2 text-graphite",
	green: "bg-green-soft text-green",
	amber: "bg-amber-soft text-amber",
	blue: "bg-link-soft text-link",
	violet: "bg-violet-soft text-violet",
	coral: "bg-coral-soft text-coral",
};

export const CHIP_SOLID: Record<ChipColor, string> = {
	gray: "var(--color-rule-strong)",
	green: "var(--color-green)",
	amber: "var(--color-amber)",
	blue: "var(--color-link)",
	violet: "var(--color-violet)",
	coral: "var(--color-coral)",
};

export const COLOR_CYCLE: ChipColor[] = [
	"gray",
	"green",
	"amber",
	"blue",
	"violet",
	"coral",
];

export const TYPE_LABELS: Record<PropertyType, string> = {
	title: "Name",
	text: "Text",
	number: "Number",
	select: "Select",
	multi_select: "Multi-select",
	status: "Status",
	date: "Date",
	person: "Person",
	checkbox: "Checkbox",
	url: "URL",
	email: "Email",
	phone: "Phone",
	files: "Files",
	relation: "Relation",
	rollup: "Rollup",
	formula: "Formula",
	created_time: "Created time",
	created_by: "Created by",
	edited_time: "Last edited time",
	edited_by: "Last edited by",
	ai: "AI",
};

export const DEFAULT_STATUS_CHOICES: Choice[] = [
	{ id: "planned", name: "Planned", color: "gray" },
	{ id: "in-progress", name: "In progress", color: "green" },
	{ id: "in-review", name: "In review", color: "amber" },
	{ id: "shipped", name: "Shipped", color: "blue" },
];
