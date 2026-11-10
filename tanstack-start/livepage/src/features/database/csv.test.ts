import { describe, expect, it } from "vitest";
import { inferType, parseCsv, parseNumber, toCsv } from "./csv";

describe("parseCsv", () => {
	it("reads quotes, doubled quotes, embedded commas and newlines", () => {
		const { headers, rows } = parseCsv(
			'name,note\n"Ada, Lovelace","said ""hi""\nline two"\nBob,plain\n',
		);
		expect(headers).toEqual(["name", "note"]);
		expect(rows).toEqual([
			["Ada, Lovelace", 'said "hi"\nline two'],
			["Bob", "plain"],
		]);
	});

	it("handles BOM, CRLF, blank lines and short rows", () => {
		const { headers, rows } = parseCsv("﻿a,b\r\n1\r\n\r\n3,4");
		expect(headers).toEqual(["a", "b"]);
		expect(rows).toEqual([
			["1", ""],
			["3", "4"],
		]);
	});

	it("detects tabs and semicolons", () => {
		expect(parseCsv("a\tb\n1\t2").rows).toEqual([["1", "2"]]);
		expect(parseCsv("a;b\n1;2").headers).toEqual(["a", "b"]);
	});

	it("round trips", () => {
		const headers = ["Name", "Note"];
		const rows = [['A "x"', "b,c\nd"]];
		expect(parseCsv(toCsv(headers, rows))).toEqual({ headers, rows });
	});
});

describe("inferType", () => {
	it("picks types", () => {
		expect(inferType(["1", "2.5"])).toBe("number");
		expect(inferType(["yes", "no"])).toBe("checkbox");
		expect(inferType(["https://a.co"])).toBe("url");
		expect(inferType(["a@b.co"])).toBe("email");
		expect(inferType(["2026-03-01", "2026-04-01"])).toBe("date");
		expect(inferType(["a", "b", "a", "b", "a", "a"])).toBe("select");
		expect(inferType(["some long text", "other text"])).toBe("text");
	});
	it("strips number formatting", () => {
		expect(parseNumber("$1,200.50")).toBe(1200.5);
		expect(parseNumber("x")).toBeNull();
	});
});

describe("toCsv neutralizes spreadsheet formulas", () => {
	it.each([
		'=HYPERLINK("http://evil")',
		"+1+1",
		"-2+3",
		"@SUM(1)",
		"\tcmd",
		"\rcmd",
	])("prefixes %j", (value) => {
		const csv = toCsv(["a"], [[value]]);
		expect(
			csv.split("\r\n")[1].startsWith("\"'") ||
				csv.split("\r\n")[1].startsWith("'"),
		).toBe(true);
	});
	it("leaves plain negative numbers and ordinary text alone", () => {
		expect(toCsv(["a"], [["-12.5"]]).split("\r\n")[1]).toBe("-12.5");
		expect(toCsv(["a"], [["hello"]]).split("\r\n")[1]).toBe("hello");
	});
});
