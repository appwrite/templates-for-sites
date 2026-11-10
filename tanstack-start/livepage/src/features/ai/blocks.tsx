// biome-ignore-all lint/suspicious/noArrayIndexKey: these render a static list with a stable order, and text can repeat
// Shows AI markdown as page-like blocks, and turns it into Tiptap content when accepted.
import type { Schema } from "@tiptap/pm/model";
import { Fragment, type ReactNode } from "react";
import type { Block, InlineNode } from "./markdown";

type RenderableInline = InlineNode & { render?: ReactNode };

function renderInline(
	nodes: RenderableInline[] | undefined,
	trailing?: ReactNode,
): ReactNode {
	return (
		<>
			{(nodes ?? []).map((node, i) => {
				let out: ReactNode = node.render ?? node.text;
				for (const mark of node.marks ?? []) {
					if (mark.type === "bold") out = <strong key="b">{out}</strong>;
					if (mark.type === "italic") out = <em key="i">{out}</em>;
					if (mark.type === "strike") out = <s key="s">{out}</s>;
					if (mark.type === "code")
						out = (
							<code
								key="c"
								className="rounded-sm bg-wash-2 px-1 font-mono text-[0.9em]"
							>
								{out}
							</code>
						);
				}
				return <Fragment key={`${node.text}-${i}`}>{out}</Fragment>;
			})}
			{trailing}
		</>
	);
}

function paragraphs(
	block: { content?: { content?: InlineNode[] }[] },
	trailing?: ReactNode,
) {
	const last = (block.content?.length ?? 0) - 1;
	return block.content?.map((child, i) => (
		<p key={i}>
			{renderInline(child.content, i === last ? trailing : undefined)}
		</p>
	));
}

// `trailing` is placed at the very end of the text, so the AI caret sits right after the last word.
export function BlockList({
	blocks,
	trailing,
}: {
	blocks: Block[];
	trailing?: ReactNode;
}) {
	const lastIndex = blocks.length - 1;
	if (!blocks.length) return <p>{trailing}</p>;
	return (
		<>
			{blocks.map((block, index) => {
				const tail = index === lastIndex ? trailing : undefined;
				switch (block.type) {
					case "paragraph":
						return <p key={index}>{renderInline(block.content, tail)}</p>;
					case "heading": {
						const Tag = (["h1", "h2", "h3"] as const)[block.attrs.level - 1];
						return (
							<Tag key={index} className="font-semibold text-ink">
								{renderInline(block.content, tail)}
							</Tag>
						);
					}
					case "codeBlock":
						return (
							<pre
								key={index}
								className="overflow-x-auto rounded-md bg-wash-2 p-3 font-mono text-sm"
							>
								{block.content?.[0]?.text}
								{tail}
							</pre>
						);
					case "blockquote":
						return (
							<blockquote
								key={index}
								className="border-l-2 border-rule-strong pl-3"
							>
								{paragraphs(block, tail)}
							</blockquote>
						);
					case "horizontalRule":
						return <hr key={index} className="border-rule" />;
					case "bulletList":
					case "orderedList": {
						const Tag = block.type === "bulletList" ? "ul" : "ol";
						const lastItem = block.content.length - 1;
						return (
							<Tag
								key={index}
								className={
									block.type === "bulletList"
										? "list-disc pl-5"
										: "list-decimal pl-5"
								}
							>
								{block.content.map((item, i) => (
									<li key={i}>
										{paragraphs(item, i === lastItem ? tail : undefined)}
									</li>
								))}
							</Tag>
						);
					}
					default: {
						if (block.type !== "taskList") return null;
						const lastItem = block.content.length - 1;
						return (
							<ul key={index} className="space-y-1">
								{block.content.map((item, i) => (
									<li key={i} className="flex gap-2">
										<span
											aria-hidden
											className={`mt-1.5 h-3.5 w-3.5 shrink-0 rounded-sm border ${item.attrs.checked ? "border-link bg-accent" : "border-rule-strong"}`}
										/>
										<div className="min-w-0 flex-1">
											{paragraphs(item, i === lastItem ? tail : undefined)}
										</div>
									</li>
								))}
							</ul>
						);
					}
				}
			})}
		</>
	);
}

// Keeps only what this editor's schema can hold, so accepting never throws on an unknown node.
function fitInline(nodes: InlineNode[] | undefined, schema: Schema) {
	return nodes?.map((node) => ({
		...node,
		marks: node.marks?.filter((m) => schema.marks[m.type]),
	}));
}

function fitBlock(block: Block, schema: Schema): Block | Block[] {
	const has = (name: string) => Boolean(schema.nodes[name]);
	switch (block.type) {
		case "heading":
			if (has("heading"))
				return { ...block, content: fitInline(block.content, schema) };
			return { type: "paragraph", content: fitInline(block.content, schema) };
		case "codeBlock":
			if (has("codeBlock")) return block;
			return { type: "paragraph", content: block.content };
		case "blockquote":
			return has("blockquote")
				? {
						...block,
						content: block.content.map((p) => ({
							...p,
							content: fitInline(p.content, schema),
						})),
					}
				: block.content;
		case "horizontalRule":
			return has("horizontalRule") ? block : [];
		case "bulletList":
		case "orderedList":
			if (has(block.type) && has("listItem")) return block;
			return block.content.flatMap((item) => item.content);
		case "taskList":
			if (has("taskList") && has("taskItem")) return block;
			if (has("bulletList") && has("listItem"))
				return {
					type: "bulletList",
					content: block.content.map((item) => ({
						type: "listItem",
						content: item.content,
					})),
				};
			return block.content.flatMap((item) => item.content);
		default:
			return { ...block, content: fitInline(block.content, schema) };
	}
}

export function toContent(blocks: Block[], schema: Schema) {
	return blocks.flatMap((block) => fitBlock(block, schema));
}
