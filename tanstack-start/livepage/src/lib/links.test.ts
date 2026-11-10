import { describe, expect, it } from "vitest";
import { safeHref } from "./links";

describe("safeHref", () => {
	it.each([
		"javascript:alert(1)",
		"JaVaScRiPt:alert(1)",
		"data:text/html,<script>1</script>",
		"vbscript:x",
		"file:///etc/passwd",
		"//evil.example",
	])("blocks %s", (href) => {
		expect(safeHref(href)).toBeNull();
	});
	it.each([
		["https://example.com/a", "https://example.com/a"],
		["http://example.com", "http://example.com"],
		["mailto:me@x.io", "mailto:me@x.io"],
		["/p/abc", "/p/abc"],
		["#anchor", "#anchor"],
		["example.com", "https://example.com"],
	])("allows %s", (href, expected) => {
		expect(safeHref(href)).toBe(expected);
	});
	it("treats empty as no link", () => {
		expect(safeHref("")).toBeNull();
		expect(safeHref(null)).toBeNull();
	});
});
