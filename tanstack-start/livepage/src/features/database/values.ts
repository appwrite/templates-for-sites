// Reading, formatting and comparing cell values, plus view filtering, sorting, grouping and calculations.
// Pure and framework-free, so it runs against plain data in tests.
import { isDate as isDateVal, isEmptyVal, toText, type Val } from "./formula";
import type {
	CalcFn,
	Choice,
	DateValue,
	FileValue,
	FilterGroup,
	FilterItem,
	NumberFormat,
	Property,
	PropertyType,
	SortItem,
} from "./types";

export type Accessor = (rowId: string, propertyId: string) => unknown;

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

export function formatDay(iso: string) {
	const date = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
	if (Number.isNaN(date.getTime())) return iso;
	const now = new Date();
	const label = `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
	return date.getUTCFullYear() === now.getUTCFullYear()
		? label
		: `${label}, ${date.getUTCFullYear()}`;
}

export function formatDateValue(value: DateValue) {
	if (!value?.start) return "";
	return value.end
		? `${formatDay(value.start)} to ${formatDay(value.end)}`
		: formatDay(value.start);
}

export function formatDateTime(iso: string) {
	if (!iso) return "";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return `${formatDay(iso)}, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

const SYMBOLS: Partial<Record<NumberFormat, string>> = {
	dollar: "$",
	euro: "€",
	pound: "£",
	rupee: "₹",
};

export function formatNumberValue(
	value: unknown,
	format: NumberFormat = "number",
	decimals?: number,
) {
	if (value === null || value === undefined || value === "") return "";
	const n = Number(value);
	if (Number.isNaN(n)) return String(value);
	if (format === "percent") {
		return `${n.toLocaleString(undefined, { maximumFractionDigits: decimals ?? 2 })}%`;
	}
	const options =
		decimals !== undefined
			? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
			: SYMBOLS[format] && !Number.isInteger(n)
				? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
				: { maximumFractionDigits: 6 };
	if (format === "number")
		return n.toFixed(decimals ?? 0) === String(n) || decimals === undefined
			? String(n)
			: n.toFixed(decimals);
	const formatted = n.toLocaleString(undefined, options);
	const symbol = SYMBOLS[format];
	return symbol ? `${symbol}${formatted}` : formatted;
}

export function choiceById(prop: Property, id: unknown): Choice | undefined {
	return prop.options.choices?.find((c) => c.id === id);
}

export type Names = {
	person: (userId: string) => string;
	row: (databaseId: string, rowId: string) => string;
};

// The plain-text version of a value: search, CSV export, sorting text.
export function displayText(
	prop: Property,
	value: unknown,
	names: Names,
): string {
	if (value === null || value === undefined) return "";
	switch (prop.type) {
		case "number":
			return formatNumberValue(
				value,
				prop.options.format,
				prop.options.decimals,
			);
		case "select":
		case "status":
			return choiceById(prop, value)?.name ?? "";
		case "multi_select":
			return asArray(value)
				.map((id) => choiceById(prop, id)?.name ?? "")
				.filter(Boolean)
				.join(", ");
		case "date":
			return formatDateValue(value as DateValue);
		case "person":
		case "created_by":
		case "edited_by":
			return asArray(value)
				.map((id) => names.person(String(id)))
				.join(", ");
		case "checkbox":
			return value ? "Yes" : "No";
		case "files":
			return asArray(value)
				.map((f) => (f as FileValue).name)
				.join(", ");
		case "relation":
			return asArray(value)
				.map((id) => names.row(prop.options.targetDatabaseId ?? "", String(id)))
				.join(", ");
		case "created_time":
		case "edited_time":
			return formatDateTime(String(value));
		default:
			return typeof value === "object" ? toText(value as Val) : String(value);
	}
}

export function asArray(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	return value === null || value === undefined || value === "" ? [] : [value];
}

export function isEmptyValue(value: unknown) {
	if (value === null || value === undefined || value === "") return true;
	if (Array.isArray(value)) return value.length === 0;
	if (typeof value === "object" && "start" in (value as object))
		return !(value as DateValue).start;
	return false;
}

// ---------- Filters ----------

export type ConditionDef = {
	id: string;
	label: string;
	needsValue: boolean;
};

const TEXT_CONDITIONS: ConditionDef[] = [
	{ id: "is", label: "is", needsValue: true },
	{ id: "is_not", label: "is not", needsValue: true },
	{ id: "contains", label: "contains", needsValue: true },
	{ id: "not_contains", label: "does not contain", needsValue: true },
	{ id: "starts", label: "starts with", needsValue: true },
	{ id: "ends", label: "ends with", needsValue: true },
	{ id: "empty", label: "is empty", needsValue: false },
	{ id: "not_empty", label: "is not empty", needsValue: false },
];

const NUMBER_CONDITIONS: ConditionDef[] = [
	{ id: "eq", label: "=", needsValue: true },
	{ id: "neq", label: "≠", needsValue: true },
	{ id: "gt", label: ">", needsValue: true },
	{ id: "gte", label: "≥", needsValue: true },
	{ id: "lt", label: "<", needsValue: true },
	{ id: "lte", label: "≤", needsValue: true },
	{ id: "empty", label: "is empty", needsValue: false },
	{ id: "not_empty", label: "is not empty", needsValue: false },
];

const CHOICE_CONDITIONS: ConditionDef[] = [
	{ id: "is", label: "is", needsValue: true },
	{ id: "is_not", label: "is not", needsValue: true },
	{ id: "empty", label: "is empty", needsValue: false },
	{ id: "not_empty", label: "is not empty", needsValue: false },
];

const LIST_CONDITIONS: ConditionDef[] = [
	{ id: "contains", label: "contains", needsValue: true },
	{ id: "not_contains", label: "does not contain", needsValue: true },
	{ id: "empty", label: "is empty", needsValue: false },
	{ id: "not_empty", label: "is not empty", needsValue: false },
];

const DATE_CONDITIONS: ConditionDef[] = [
	{ id: "is", label: "is", needsValue: true },
	{ id: "before", label: "is before", needsValue: true },
	{ id: "after", label: "is after", needsValue: true },
	{ id: "on_or_before", label: "is on or before", needsValue: true },
	{ id: "on_or_after", label: "is on or after", needsValue: true },
	{ id: "past_week", label: "in the past week", needsValue: false },
	{ id: "next_week", label: "in the next week", needsValue: false },
	{ id: "this_month", label: "this month", needsValue: false },
	{ id: "empty", label: "is empty", needsValue: false },
	{ id: "not_empty", label: "is not empty", needsValue: false },
];

export function conditionsFor(type: PropertyType): ConditionDef[] {
	switch (type) {
		case "number":
		case "rollup":
			return NUMBER_CONDITIONS;
		case "select":
		case "status":
			return CHOICE_CONDITIONS;
		case "multi_select":
		case "person":
		case "created_by":
		case "edited_by":
		case "relation":
			return LIST_CONDITIONS;
		case "date":
		case "created_time":
		case "edited_time":
			return DATE_CONDITIONS;
		case "checkbox":
			return [{ id: "is", label: "is", needsValue: true }];
		case "files":
			return [
				{ id: "empty", label: "is empty", needsValue: false },
				{ id: "not_empty", label: "is not empty", needsValue: false },
			];
		default:
			return TEXT_CONDITIONS;
	}
}

function dateOf(value: unknown): number | null {
	if (value === null || value === undefined || value === "") return null;
	if (typeof value === "string") return Date.parse(value);
	if (typeof value === "object" && "start" in (value as object)) {
		const start = (value as DateValue).start;
		return start ? Date.parse(start) : null;
	}
	return null;
}

function testCondition(
	item: FilterItem,
	prop: Property,
	value: unknown,
	viewerId: string,
	names: Names,
): boolean {
	const target = item.value === "me" ? viewerId : item.value;
	const cond = item.condition;
	// A filter someone has only started filling in hides nothing.
	const needsValue = conditionsFor(prop.type).find(
		(c) => c.id === cond,
	)?.needsValue;
	const blank = target === "" || target === null || target === undefined;
	// A checkbox's blank value reads as "Not checked", so it is a real choice.
	if (needsValue && blank && prop.type !== "checkbox") return true;
	if (cond === "empty") return isEmptyValue(value);
	if (cond === "not_empty") return !isEmptyValue(value);
	switch (prop.type) {
		case "checkbox":
			return Boolean(value) === Boolean(target);
		case "select":
		case "status":
			if (cond === "is") return value === target;
			if (cond === "is_not") return value !== target;
			return true;
		case "multi_select":
		case "person":
		case "created_by":
		case "edited_by":
		case "relation": {
			const has = asArray(value).includes(target);
			return cond === "contains" ? has : cond === "not_contains" ? !has : true;
		}
		case "date":
		case "created_time":
		case "edited_time": {
			const at = dateOf(value);
			if (at === null) return false;
			const day = 86_400_000;
			const now = Date.now();
			const d = new Date();
			switch (cond) {
				case "past_week":
					return at >= now - 7 * day && at <= now;
				case "next_week":
					return at >= now && at <= now + 7 * day;
				case "this_month":
					return (
						new Date(at).getUTCFullYear() === d.getUTCFullYear() &&
						new Date(at).getUTCMonth() === d.getUTCMonth()
					);
				default: {
					const t = dateOf(target);
					if (t === null) return true;
					const dayOf = (ms: number) => Math.floor(ms / day);
					if (cond === "is") return dayOf(at) === dayOf(t);
					if (cond === "before") return dayOf(at) < dayOf(t);
					if (cond === "after") return dayOf(at) > dayOf(t);
					if (cond === "on_or_before") return dayOf(at) <= dayOf(t);
					if (cond === "on_or_after") return dayOf(at) >= dayOf(t);
					return true;
				}
			}
		}
		case "number":
		case "rollup": {
			const n = Number(value);
			const t = Number(target);
			if (isEmptyValue(value)) return false;
			switch (cond) {
				case "eq":
					return n === t;
				case "neq":
					return n !== t;
				case "gt":
					return n > t;
				case "gte":
					return n >= t;
				case "lt":
					return n < t;
				case "lte":
					return n <= t;
				default:
					return true;
			}
		}
		default: {
			const text = displayText(prop, value, names).toLowerCase();
			const t = String(target ?? "").toLowerCase();
			switch (cond) {
				case "is":
					return text === t;
				case "is_not":
					return text !== t;
				case "contains":
					return text.includes(t);
				case "not_contains":
					return !text.includes(t);
				case "starts":
					return text.startsWith(t);
				case "ends":
					return text.endsWith(t);
				default:
					return true;
			}
		}
	}
}

export function isGroup(item: FilterItem | FilterGroup): item is FilterGroup {
	return "items" in item;
}

// A filter whose value hasn't been entered yet is ignored, so a half-built OR doesn't match everything.
function isComplete(
	item: FilterItem | FilterGroup,
	props: Map<string, Property>,
): boolean {
	if (isGroup(item)) return item.items.some((i) => isComplete(i, props));
	const prop = props.get(item.propertyId);
	if (!prop) return false;
	const def = conditionsFor(prop.type).find((c) => c.id === item.condition);
	if (!def?.needsValue || prop.type === "checkbox") return true;
	return item.value !== "" && item.value !== null && item.value !== undefined;
}

export function countFilters(
	group: FilterGroup,
	props?: Map<string, Property>,
): number {
	return group.items.reduce((n, item) => {
		if (isGroup(item)) return n + countFilters(item, props);
		return n + (!props || isComplete(item, props) ? 1 : 0);
	}, 0);
}

export function matches(
	group: FilterGroup,
	rowId: string,
	props: Map<string, Property>,
	get: Accessor,
	viewerId: string,
	names: Names,
): boolean {
	const items = group.items.filter((item) => isComplete(item, props));
	if (!items.length) return true;
	const test = (item: FilterItem | FilterGroup) => {
		if (isGroup(item)) return matches(item, rowId, props, get, viewerId, names);
		const prop = props.get(item.propertyId);
		if (!prop) return true;
		return testCondition(item, prop, get(rowId, prop.id), viewerId, names);
	};
	return group.op === "or" ? items.some(test) : items.every(test);
}

// ---------- Sort ----------

function sortKey(prop: Property, value: unknown, names: Names) {
	switch (prop.type) {
		case "number":
			return isEmptyValue(value) ? null : Number(value);
		case "checkbox":
			return value ? 1 : 0;
		case "select":
		case "status": {
			const index = prop.options.choices?.findIndex((c) => c.id === value);
			return index === undefined || index < 0 ? null : index;
		}
		case "date":
			return dateOf(value);
		case "created_time":
		case "edited_time":
			return value ? Date.parse(String(value)) : null;
		default: {
			const text = displayText(prop, value, names);
			return text || null;
		}
	}
}

export function compareRows(
	sorts: SortItem[],
	a: string,
	b: string,
	props: Map<string, Property>,
	get: Accessor,
	names: Names,
) {
	for (const sort of sorts) {
		const prop = props.get(sort.propertyId);
		if (!prop) continue;
		const x = sortKey(prop, get(a, prop.id), names);
		const y = sortKey(prop, get(b, prop.id), names);
		let result = 0;
		if (x === null && y === null) result = 0;
		else if (x === null) result = 1;
		else if (y === null) result = -1;
		else if (typeof x === "number" && typeof y === "number") result = x - y;
		else
			result = String(x).localeCompare(String(y), undefined, {
				sensitivity: "base",
				numeric: true,
			});
		if (result !== 0)
			return x === null || y === null
				? result
				: sort.direction === "asc"
					? result
					: -result;
	}
	return 0;
}

// ---------- Groups ----------

export const EMPTY_GROUP = "__empty";

export function groupKeys(prop: Property, value: unknown): string[] {
	if (isEmptyValue(value)) return [EMPTY_GROUP];
	switch (prop.type) {
		case "multi_select":
		case "person":
			return asArray(value).map(String);
		case "checkbox":
			return [value ? "true" : "false"];
		case "date":
			return [String((value as DateValue).start).slice(0, 7)];
		case "select":
		case "status":
			return [String(value)];
		default:
			return [String(value)];
	}
}

export function groupLabel(prop: Property, key: string, names: Names) {
	if (key === EMPTY_GROUP) return `No ${prop.name}`;
	switch (prop.type) {
		case "select":
		case "status":
		case "multi_select":
			return choiceById(prop, key)?.name ?? key;
		case "person":
			return names.person(key);
		case "checkbox":
			return key === "true" ? "Checked" : "Unchecked";
		case "date": {
			const [y, m] = key.split("-");
			return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
		}
		default:
			return key;
	}
}

// ---------- Footer calculations ----------

export const CALC_LABELS: Record<CalcFn, string> = {
	count_all: "Count all",
	count_values: "Count values",
	count_empty: "Count empty",
	percent_empty: "Percent empty",
	percent_filled: "Percent not empty",
	unique: "Count unique",
	sum: "Sum",
	average: "Average",
	median: "Median",
	min: "Min",
	max: "Max",
	range: "Range",
	earliest: "Earliest date",
	latest: "Latest date",
	checked: "Checked",
	unchecked: "Unchecked",
	percent_checked: "Percent checked",
};

export function calcsFor(type: PropertyType): CalcFn[] {
	const common: CalcFn[] = [
		"count_all",
		"count_values",
		"count_empty",
		"percent_empty",
		"percent_filled",
		"unique",
	];
	if (type === "number" || type === "rollup" || type === "formula")
		return [...common, "sum", "average", "median", "min", "max", "range"];
	if (type === "date" || type === "created_time" || type === "edited_time")
		return [...common, "earliest", "latest"];
	if (type === "checkbox")
		return ["count_all", "checked", "unchecked", "percent_checked"];
	return common;
}

function numericValues(values: unknown[]) {
	const out: number[] = [];
	for (const v of values) {
		if (isEmptyValue(v)) continue;
		const n = Number(v);
		if (!Number.isNaN(n)) out.push(n);
	}
	return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function calculate(
	fn: CalcFn,
	prop: Property,
	values: unknown[],
	names: Names,
): string {
	const total = values.length;
	const filled = values.filter((v) => !isEmptyValue(v));
	const nums = numericValues(values);
	const fmt = (n: number) =>
		prop.type === "number"
			? formatNumberValue(n, prop.options.format, prop.options.decimals)
			: String(round2(n));
	switch (fn) {
		case "count_all":
			return String(total);
		case "count_values":
			return String(filled.length);
		case "count_empty":
			return String(total - filled.length);
		case "percent_empty":
			return total
				? `${Math.round(((total - filled.length) / total) * 100)}%`
				: "0%";
		case "percent_filled":
			return total ? `${Math.round((filled.length / total) * 100)}%` : "0%";
		case "unique": {
			const seen = new Set(values.map((v) => displayText(prop, v, names)));
			seen.delete("");
			return String(seen.size);
		}
		case "sum":
			return nums.length ? fmt(nums.reduce((a, b) => a + b, 0)) : "";
		case "average":
			return nums.length
				? fmt(nums.reduce((a, b) => a + b, 0) / nums.length)
				: "";
		case "median": {
			if (!nums.length) return "";
			const s = [...nums].sort((a, b) => a - b);
			const mid = Math.floor(s.length / 2);
			return fmt(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
		}
		case "min":
			return nums.length ? fmt(Math.min(...nums)) : "";
		case "max":
			return nums.length ? fmt(Math.max(...nums)) : "";
		case "range":
			return nums.length ? fmt(Math.max(...nums) - Math.min(...nums)) : "";
		case "earliest": {
			const days = filled.map(dateOf).filter((d): d is number => d !== null);
			return days.length
				? formatDay(new Date(Math.min(...days)).toISOString())
				: "";
		}
		case "latest": {
			const days = filled.map(dateOf).filter((d): d is number => d !== null);
			return days.length
				? formatDay(new Date(Math.max(...days)).toISOString())
				: "";
		}
		case "checked":
			return String(values.filter(Boolean).length);
		case "unchecked":
			return String(total - values.filter(Boolean).length);
		case "percent_checked":
			return total
				? `${Math.round((values.filter(Boolean).length / total) * 100)}%`
				: "0%";
	}
}

// ---------- Formula values ----------

// Turns a stored property value into what the formula language sees.
export function toFormulaValue(
	prop: Property,
	value: unknown,
	names: Names,
): Val {
	if (isEmptyValue(value)) return prop.type === "checkbox" ? false : null;
	switch (prop.type) {
		case "number":
			return Number(value);
		case "checkbox":
			return Boolean(value);
		case "select":
		case "status":
			return choiceById(prop, value)?.name ?? null;
		case "multi_select":
			return asArray(value).map((id) => choiceById(prop, id)?.name ?? "");
		case "person":
		case "created_by":
		case "edited_by":
			return asArray(value).map((id) => names.person(String(id)));
		case "relation":
			return asArray(value).map((id) =>
				names.row(prop.options.targetDatabaseId ?? "", String(id)),
			);
		case "files":
			return asArray(value).map((f) => (f as FileValue).name);
		case "date": {
			const v = value as DateValue;
			return {
				kind: "date",
				start: normalizeIso(v.start),
				end: v.end ? normalizeIso(v.end) : undefined,
			};
		}
		case "created_time":
		case "edited_time":
			return { kind: "date", start: String(value) };
		case "formula":
		case "rollup":
			if (Array.isArray(value)) return value as Val[];
			if (typeof value === "object" && value !== null) {
				const obj = value as { start?: string; end?: string };
				return obj.start
					? { kind: "date", start: obj.start, end: obj.end }
					: null;
			}
			return value as Val;
		default:
			return String(value);
	}
}

function normalizeIso(iso: string) {
	return iso.length === 10 ? `${iso}T00:00:00.000Z` : iso;
}

export function formatFormulaResult(value: Val, names?: Names): string {
	void names;
	if (isDateVal(value))
		return value.end
			? `${formatDay(value.start)} to ${formatDay(value.end)}`
			: formatDay(value.start);
	if (typeof value === "number") return String(Number(value.toPrecision(12)));
	if (typeof value === "boolean") return value ? "Yes" : "No";
	if (Array.isArray(value))
		return value.map((v) => formatFormulaResult(v)).join(", ");
	return value === null ? "" : String(value);
}

export { isEmptyVal };
