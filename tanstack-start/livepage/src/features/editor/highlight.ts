// Syntax highlighting for read-only code blocks.

import { common, createLowlight } from "lowlight";
import { createElement, Fragment, type ReactNode } from "react";

const lowlight = createLowlight(common);

type HastNode = {
	type: string;
	value?: string;
	tagName?: string;
	properties?: { className?: string[] };
	children?: HastNode[];
};

function toReact(node: HastNode, key: number): ReactNode {
	if (node.type === "text") return node.value ?? "";
	if (node.type === "element")
		return createElement(
			node.tagName ?? "span",
			{ key, className: node.properties?.className?.join(" ") },
			(node.children ?? []).map(toReact),
		);
	return null;
}

export function lowlightTree(code: string, language: string): ReactNode {
	try {
		const tree = lowlight.registered(language)
			? lowlight.highlight(language, code)
			: lowlight.highlightAuto(code);
		return createElement(
			Fragment,
			null,
			(tree.children as HastNode[]).map(toReact),
		);
	} catch {
		return code;
	}
}
