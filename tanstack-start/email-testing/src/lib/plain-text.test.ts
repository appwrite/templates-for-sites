import { describe, expect, it } from "vitest";
import { linkify, parsePlainText, plainTextToHtml } from "./plain-text";

const GMAIL_REPLY = `something

--
Eldad Flux, Founder and CEO
appwrite.io
linkedin <https://www.linkedin.com/in/eldadfux/>
`;

describe("parsePlainText", () => {
	it("splits the signature after the -- separator", () => {
		const { body, signature } = parsePlainText(GMAIL_REPLY);
		expect(body).toEqual([
			{ kind: "paragraph", lines: [[{ kind: "text", text: "something" }]] },
		]);
		expect(signature).toHaveLength(1);
		const lines = signature?.[0].lines ?? [];
		expect(lines.map((l) => l.map((p) => p.text).join(""))).toEqual([
			"Eldad Flux, Founder and CEO",
			"appwrite.io",
			"linkedin https://www.linkedin.com/in/eldadfux/",
		]);
		expect(lines[2][1]).toEqual({
			kind: "link",
			text: "https://www.linkedin.com/in/eldadfux/",
			href: "https://www.linkedin.com/in/eldadfux/",
		});
	});

	it("accepts a separator without the trailing space", () => {
		expect(parsePlainText("hi\n--\nJane").signature).not.toBeNull();
	});

	it("keeps line breaks inside a paragraph and splits on blank lines", () => {
		const { body } = parsePlainText(
			"Line one\nLine two\n\n\nNext paragraph\r\n",
		);
		expect(body).toHaveLength(2);
		expect(body[0].lines).toHaveLength(2);
		expect(body[1].lines[0]).toEqual([
			{ kind: "text", text: "Next paragraph" },
		]);
	});

	it("groups quoted lines, keeping blank lines inside the quote", () => {
		const { body } = parsePlainText(
			"Thanks!\n\nOn Mon, Ana wrote:\n> first\n>\n> > second\n",
		);
		expect(body.map((b) => b.kind)).toEqual([
			"paragraph",
			"paragraph",
			"quote",
		]);
		expect(body[2].lines.map((l) => l.map((p) => p.text).join(""))).toEqual([
			"first",
			"",
			"second",
		]);
	});

	it("doesn't treat a quoted separator as the signature", () => {
		expect(parsePlainText("Reply\n> -- \n> Old sig").signature).toBeNull();
	});

	it("returns no signature when nothing follows the separator", () => {
		expect(parsePlainText("Hello\n-- \n\n").signature).toBeNull();
	});
});

describe("linkify", () => {
	const links = (line: string) =>
		linkify(line)
			.filter((p) => p.kind === "link")
			.map((p) => (p.kind === "link" ? p.href : ""));

	it("drops sentence punctuation but keeps brackets the URL opened", () => {
		expect(
			links(
				"See https://example.com/a. Or (https://en.wikipedia.org/wiki/Foo_(bar)).",
			),
		).toEqual([
			"https://example.com/a",
			"https://en.wikipedia.org/wiki/Foo_(bar)",
		]);
	});

	it("links localhost and www. addresses", () => {
		expect(
			links("Open http://localhost:3000/verify?t=1, or www.example.com"),
		).toEqual(["http://localhost:3000/verify?t=1", "https://www.example.com"]);
	});

	it("keeps the text around a link exactly", () => {
		const parts = linkify("Go to <https://a.dev/x> now");
		expect(parts.map((p) => p.text).join("")).toBe("Go to https://a.dev/x now");
	});

	it("handles a lone opening bracket", () => {
		expect(linkify("(<https://a.dev")).toEqual([
			{ kind: "text", text: "(<" },
			{ kind: "link", text: "https://a.dev", href: "https://a.dev" },
		]);
	});
});

describe("plainTextToHtml", () => {
	it("escapes text and wraps the signature", () => {
		const html = plainTextToHtml('<b>"hi"</b> & bye\n-- \nJane https://j.dev');
		expect(html).toContain("&lt;b&gt;&quot;hi&quot;&lt;/b&gt; &amp; bye");
		expect(html).toContain('<div class="catchall-signature">');
		expect(html).toContain('<a href="https://j.dev">https://j.dev</a>');
	});

	it("can't be broken out of with a crafted URL", () => {
		const html = plainTextToHtml('https://x.dev/"onmouseover=alert(1)');
		expect(html).not.toContain('"onmouseover');
	});
});
