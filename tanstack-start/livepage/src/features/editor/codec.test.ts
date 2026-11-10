import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { isTrusted, levelFor } from "./access";
import {
	BODY_FIELD,
	digest,
	docFromUpdates,
	fromBase64,
	seedUpdate,
	toBase64,
} from "./codec";

describe("seedUpdate", () => {
	it("is identical in every browser and idempotent when applied twice", () => {
		const a = seedUpdate("page1", BODY_FIELD);
		const b = seedUpdate("page1", BODY_FIELD);
		expect(toBase64(a)).toBe(toBase64(b));
		const doc = docFromUpdates([a, b, a]);
		expect(doc.getXmlFragment(BODY_FIELD).length).toBe(1);
	});
});

describe("digest", () => {
	it("extracts text, links and files from the Yjs tree", () => {
		const doc = new Y.Doc();
		const root = doc.getXmlFragment(BODY_FIELD);
		const p = new Y.XmlElement("paragraph");
		const t = new Y.XmlText();
		t.insert(0, "hello");
		p.insert(0, [t]);
		const link = new Y.XmlElement("pageLink");
		link.setAttribute("pageId", "target1");
		link.setAttribute("title", "Other");
		const image = new Y.XmlElement("image");
		image.setAttribute("fileId", "f1");
		root.insert(0, [p, link, image]);
		const out = digest(root);
		expect(out.text).toContain("hello");
		expect(out.links).toEqual(["target1"]);
		expect(out.files).toEqual(["f1"]);
	});
});

describe("mergeUpdates through base64", () => {
	it("keeps every concurrent edit", () => {
		const seed = seedUpdate("p", BODY_FIELD);
		const a = docFromUpdates([seed]);
		const b = docFromUpdates([seed]);
		const type = (d: Y.Doc, text: string) => {
			const para = d.getXmlFragment(BODY_FIELD).get(0) as Y.XmlElement;
			const inner = new Y.XmlText();
			inner.insert(0, text);
			para.push([inner]);
		};
		type(a, "from a");
		type(b, "from b");
		const updates = [
			seed,
			Y.encodeStateAsUpdate(a),
			Y.encodeStateAsUpdate(b),
		].map((u) => fromBase64(toBase64(u)));
		const merged = docFromUpdates([Y.mergeUpdates(updates)]);
		const text = digest(merged.getXmlFragment(BODY_FIELD)).text;
		expect(text).toContain("from a");
		expect(text).toContain("from b");
	});
});

describe("permissions", () => {
	const page = {
		visibility: "workspace" as const,
		createdBy: "u1",
		workspaceId: "w",
		shares: [] as { userId: string; level: "edit" | "comment" | "view" }[],
	};
	it("derives access levels", () => {
		expect(levelFor(page, "u1", "member")).toBe("edit");
		expect(levelFor(page, "u2", "member")).toBe("edit");
		expect(levelFor(page, "u2", "guest")).toBeNull();
		expect(
			levelFor(
				{
					...page,
					visibility: "restricted",
					shares: [{ userId: "u3", level: "view" }],
				},
				"u3",
				"guest",
			),
		).toBe("view");
	});
	it("trusts only rows with roles the writer must hold", () => {
		expect(isTrusted({ $permissions: ['read("team:w/member")'] }, page)).toBe(
			true,
		);
		expect(isTrusted({ $permissions: ['read("user:u9")'] }, page)).toBe(false);
		const priv = { ...page, visibility: "private" as const };
		expect(isTrusted({ $permissions: ['read("team:w/member")'] }, priv)).toBe(
			false,
		);
		expect(isTrusted({ $permissions: ['read("user:u1")'] }, priv)).toBe(true);
	});
});
