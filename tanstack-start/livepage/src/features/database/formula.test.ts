import { describe, expect, it } from "vitest";
import {
	type DateVal,
	type EvalContext,
	evaluateSafe,
	parseFormula,
	type Val,
} from "./formula";

const refs = [
	{ id: "s", name: "Status" },
	{ id: "o", name: "Open tasks" },
	{ id: "t", name: "Target date" },
	{ id: "n", name: "Name" },
	{ id: "tags", name: "Tags" },
];

const row: Record<string, Val> = {
	s: "Shipped",
	o: 4,
	t: { kind: "date", start: "2026-03-20T00:00:00.000Z" } satisfies DateVal,
	n: "Offline mode",
	tags: ["a", "b", "a"],
};

const ctx: EvalContext = {
	ref: (id) => row[id] ?? null,
	now: new Date("2026-03-01T00:00:00.000Z"),
};

function run(src: string) {
	const parsed = parseFormula(src, refs);
	if (!parsed.ok) throw new Error(parsed.error.message);
	const out = evaluateSafe(parsed.ast, ctx);
	if (!out.ok) throw new Error(out.error);
	return out.value;
}

describe("parser", () => {
	it("respects precedence and grouping", () => {
		expect(run("1 + 2 * 3")).toBe(7);
		expect(run("(1 + 2) * 3")).toBe(9);
		expect(run("2 ^ 3 ^ 2")).toBe(512);
		expect(run("-2 ^ 2")).toBe(4);
		expect(run("10 % 3")).toBe(1);
		expect(run("1 < 2 and 2 < 3")).toBe(true);
		expect(run("not false")).toBe(true);
		expect(run("!(1 > 2)")).toBe(true);
	});

	it("handles ternaries, strings and escapes", () => {
		expect(run('true ? "yes" : "no"')).toBe("yes");
		expect(run('"a\\"b"')).toBe('a"b');
		expect(run("'single'")).toBe("single");
	});

	it("reads multi-word column names bare and through prop", () => {
		expect(run("Open tasks + 1")).toBe(5);
		expect(run('prop("Open tasks") * 2')).toBe(8);
		expect(run('Status == "Shipped"')).toBe(true);
	});

	it("reports an unknown column with a suggestion and position", () => {
		const parsed = parseFormula("if(Status == 1,\n  Target day, 2)", refs);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.error.message).toBe("There's no column called Target day");
		expect(parsed.error.suggestion).toBe("Target date");
		expect(parsed.error.line).toBe(2);
	});

	it("reports wrong argument counts and unknown functions", () => {
		const a = parseFormula("if(1, 2)", refs);
		expect(!a.ok && a.error.message).toContain("if takes 3 values");
		const b = parseFormula("rond(1)", refs);
		expect(!b.ok && b.error.message).toBe("There's no function called rond");
		expect(!b.ok && b.error.suggestion).toBe("round");
	});

	it("reports unbalanced brackets and stray tokens", () => {
		expect(parseFormula("(1 + 2", refs).ok).toBe(false);
		expect(parseFormula("1 2", refs).ok).toBe(false);
		expect(parseFormula('"open', refs).ok).toBe(false);
		expect(parseFormula("1 +", refs).ok).toBe(false);
		expect(parseFormula("", refs).ok).toBe(false);
	});

	it("collects dependencies", () => {
		const parsed = parseFormula("Open tasks + 1 + Status", refs);
		expect(parsed.ok && parsed.refs.sort()).toEqual(["o", "s"]);
	});
});

describe("evaluate", () => {
	it("runs board 66's expression", () => {
		const src = `if( Status == "Shipped", "Done",\n  dateBetween(Target date, now(), "days")\n  + " days left")`;
		expect(run(src)).toBe("Done");
		row.s = "Planned";
		expect(run(src)).toBe("19 days left");
		row.s = "Shipped";
	});

	it("covers logic and numbers", () => {
		expect(run('ifs(false, 1, 1 > 2, 2, "else")')).toBe("else");
		expect(run("round(1.456, 2)")).toBe(1.46);
		expect(run("floor(1.9) + ceil(1.1)")).toBe(3);
		expect(run("sum(1, 2, 3)")).toBe(6);
		expect(run("average(2, 4)")).toBe(3);
		expect(run("median(1, 2, 9)")).toBe(2);
		expect(run("min(1, 5) + max(1, 5)")).toBe(6);
		expect(run("abs(-1) + mod(7, 3) + pow(2, 3) + sqrt(9)")).toBe(13);
		expect(run('empty("")')).toBe(true);
		expect(run('toNumber("12")')).toBe(12);
	});

	it("covers text and lists", () => {
		expect(run('concat("a", 1, true)')).toBe("a1true");
		expect(run('"n=" + 1')).toBe("n=1");
		expect(run('upper("ab") + lower("CD")')).toBe("ABcd");
		expect(run('contains(Name, "OFFLINE")')).toBe(true);
		expect(run('contains(Tags, "b")')).toBe(true);
		expect(run('replace("a-b-c", "-", "+")')).toBe("a+b+c");
		expect(run('length("abcd")')).toBe(4);
		expect(run('slice("abcd", 1, 3)')).toBe("bc");
		expect(run('join(", ", Tags)')).toBe("a, b, a");
		expect(run("unique(Tags)")).toEqual(["a", "b"]);
		expect(run("first(Tags)")).toBe("a");
		expect(run("last(Tags)")).toBe("a");
		expect(run("at(Tags, 1)")).toBe("b");
		expect(run("count(Tags)")).toBe(3);
	});

	it("covers dates", () => {
		expect(run('dateBetween(Target date, now(), "days")')).toBe(19);
		expect(
			run("year(Target date) + month(Target date) + day(Target date)"),
		).toBe(2026 + 3 + 20);
		expect(run('formatDate(Target date, "MMM DD, YYYY")')).toBe("Mar 20, 2026");
		expect(
			run('formatDate(dateAdd(Target date, 1, "months"), "YYYY-MM-DD")'),
		).toBe("2026-04-20");
		expect(
			run('formatDate(dateSubtract(Target date, 1, "weeks"), "YYYY-MM-DD")'),
		).toBe("2026-03-13");
		expect(run("Target date > now()")).toBe(true);
	});

	it("shows runtime errors instead of throwing", () => {
		const parsed = parseFormula('"x" * 2', refs);
		if (!parsed.ok) throw new Error("parse");
		const out = evaluateSafe(parsed.ast, ctx);
		expect(out.ok).toBe(false);
		expect(!out.ok && out.error).toContain("needs a number");
		const div = parseFormula("1 / 0", refs);
		if (!div.ok) throw new Error("parse");
		const zero = evaluateSafe(div.ast, ctx);
		expect(!zero.ok && zero.error).toBe("Can't divide by zero.");
	});

	it("treats empty columns as empty", () => {
		const parsed = parseFormula("Open tasks + 1", refs);
		if (!parsed.ok) throw new Error("parse");
		const out = evaluateSafe(parsed.ast, { ref: () => null });
		expect(out).toEqual({ ok: true, value: 1 });
	});
});
