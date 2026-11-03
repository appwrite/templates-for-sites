import { describe, expect, it } from "vitest";
import {
	isDesignedHtml,
	previewDocument,
	READING_CSS,
	textPreviewDocument,
} from "./email-preview";

// The HTML part Gmail sends for a short reply with a signature.
const GMAIL_REPLY = `<div dir="ltr">something<br clear="all"><div><br></div><span class="gmail_signature_prefix">-- </span><br><div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature"><div dir="ltr"><div>Eldad Flux, Founder and CEO</div><div><a href="https://appwrite.io" target="_blank">appwrite.io</a></div><div><a href="https://www.linkedin.com/in/eldadfux/" target="_blank">linkedin</a></div></div></div></div>`;

const APPLE_MAIL = `<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"></head><body style="overflow-wrap: break-word; -webkit-nbsp-mode: space; line-break: after-white-space;">Sounds good, see you then.<div><br></div></body></html>`;

const OUTLOOK_WEB = `<html><head><style type="text/css" style="display:none;"> P {margin-top:0;margin-bottom:0;} </style></head><body dir="ltr"><div style="font-family: Calibri, Arial, Helvetica, sans-serif; font-size: 12pt;">Approved.</div></body></html>`;

const SIGNATURE_TABLE = `<div>Thanks</div><table cellpadding="0" cellspacing="0" style="font-size:medium;font-family:Arial"><tr><td>Jane Doe</td></tr></table>`;

const NEWSLETTER = `<!doctype html><html><head><style>body{margin:0;background:#f4f4f5}.wrap{max-width:600px;margin:0 auto}@media (max-width:600px){.wrap{padding:0 12px}}</style></head><body><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><div class="wrap">Issue #12</div></td></tr></table></body></html>`;

const REACT_EMAIL = `<body style="background-color:#f6f9fc;font-family:-apple-system,sans-serif"><table align="center" width="100%" role="presentation" cellspacing="0" cellpadding="0" border="0" style="max-width:37.5em"><tbody><tr><td>Confirm your email</td></tr></tbody></table></body>`;

describe("isDesignedHtml", () => {
	it.each([
		["a Gmail reply", GMAIL_REPLY],
		["an Apple Mail reply", APPLE_MAIL],
		["an Outlook reply with its one-line style block", OUTLOOK_WEB],
		["a reply with a small signature table", SIGNATURE_TABLE],
	])("treats %s as plain", (_, html) => {
		expect(isDesignedHtml(html)).toBe(false);
	});

	it.each([
		["a newsletter with a style block", NEWSLETTER],
		["a React Email layout without a style block", REACT_EMAIL],
		[
			"a table with a background colour",
			'<table bgcolor="#eee"><tr><td>x</td></tr></table>',
		],
		[
			"a fixed-width layout table",
			'<table width="600"><tr><td>x</td></tr></table>',
		],
	])("treats %s as designed", (_, html) => {
		expect(isDesignedHtml(html)).toBe(true);
	});
});

describe("previewDocument", () => {
	it("keeps a designed email's frame exactly as it was", () => {
		expect(previewDocument(NEWSLETTER, { frame: true })).toBe(
			`<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{margin:0}</style>${NEWSLETTER}`,
		);
		expect(previewDocument(NEWSLETTER, { frame: false })).toBe(
			`<!doctype html><meta charset="utf-8"><base target="_blank">${NEWSLETTER}`,
		);
	});

	it("puts the reading styles before a plain email's own HTML", () => {
		const doc = previewDocument(GMAIL_REPLY, { frame: true });
		expect(doc.indexOf(READING_CSS)).toBeGreaterThan(0);
		expect(doc.indexOf(READING_CSS)).toBeLessThan(doc.indexOf(GMAIL_REPLY));
	});

	it("keeps the reading styles in a layer, so the email's own rules win", () => {
		expect(READING_CSS.startsWith("@layer catchall{")).toBe(true);
		expect(READING_CSS).toContain("img{max-width:100%");
		expect(READING_CSS).toContain("font-size:15px;line-height:1.6");
	});
});

describe("textPreviewDocument", () => {
	it("sets a text-only message with the same reading styles", () => {
		const doc = textPreviewDocument("Hi\n-- \nJane");
		expect(doc).toContain(READING_CSS);
		expect(doc).toContain('<div class="catchall-signature">');
	});
});
