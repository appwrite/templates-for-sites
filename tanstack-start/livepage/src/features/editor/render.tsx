// Read-only rendering of a page body from ProseMirror JSON. No editor on the page: used for the
// published page (SSR) and page history.
import { Link } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";
import { PageIcon, TableIcon } from "#/components/icons";
import { safeHref } from "#/lib/links";
import { lowlightTree } from "./highlight";
import { formatBytes } from "./node-views";

// Mirrors the editor's minimum column width (CELL_MIN_WIDTH in table.ts, which SSR can't import).
const CELL_MIN_WIDTH = 120;

type PmAttrs = Record<string, string | number | boolean | null>;
export type PmMark = { type: string; attrs?: PmAttrs };
export type PmNode = {
	type: string;
	text?: string;
	attrs?: PmAttrs;
	content?: PmNode[];
	marks?: PmMark[];
};

export type RenderOptions = {
	fileHref: (fileId: string, download?: boolean) => string;
	// A published page shows a page link's title without linking into the workspace.
	links: boolean;
};

function renderMarks(text: ReactNode, marks: PmMark[] = []) {
	let out = text;
	for (const mark of marks) {
		switch (mark.type) {
			case "bold":
				out = <strong>{out}</strong>;
				break;
			case "italic":
				out = <em>{out}</em>;
				break;
			case "strike":
				out = <s>{out}</s>;
				break;
			case "underline":
				out = <u>{out}</u>;
				break;
			case "code":
				out = <code className="lp-inline-code">{out}</code>;
				break;
			case "highlight":
				out = <mark className="lp-highlight">{out}</mark>;
				break;
			case "link": {
				const href = safeHref(String(mark.attrs?.href ?? ""));
				if (href)
					out = (
						<a
							href={href}
							target="_blank"
							rel="noopener noreferrer"
							className="text-link underline"
						>
							{out}
						</a>
					);
				break;
			}
			default:
				break;
		}
	}
	return out;
}

function Inline({ nodes }: { nodes?: PmNode[] }) {
	return (
		<>
			{nodes?.map((node, i) => {
				const key = i;
				if (node.type === "text")
					return (
						<Fragment key={key}>{renderMarks(node.text, node.marks)}</Fragment>
					);
				if (node.type === "hardBreak") return <br key={key} />;
				if (node.type === "mention") {
					const kind = node.attrs?.kind;
					return (
						<span key={key} className="lp-mention">
							{kind === "person" ? "@" : ""}
							{String(node.attrs?.label ?? "")}
						</span>
					);
				}
				return null;
			})}
		</>
	);
}

export function RenderBlocks({
	nodes,
	options,
}: {
	nodes?: PmNode[];
	options: RenderOptions;
}) {
	return (
		<>
			{nodes?.map((node, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: a static render, blocks never reorder
				<RenderBlock key={i} node={node} options={options} />
			))}
		</>
	);
}

function RenderBlock({
	node,
	options,
}: {
	node: PmNode;
	options: RenderOptions;
}) {
	const kids = <RenderBlocks nodes={node.content} options={options} />;
	const inline = <Inline nodes={node.content} />;
	switch (node.type) {
		case "paragraph":
			// An empty paragraph keeps its line, like in the editor.
			return <p>{node.content?.length ? inline : <br />}</p>;
		case "heading": {
			const level = Math.min(Number(node.attrs?.level) || 2, 3);
			const Tag = `h${level + 1}` as "h2" | "h3" | "h4";
			return <Tag>{inline}</Tag>;
		}
		case "bulletList":
			return <ul>{kids}</ul>;
		case "orderedList":
			return <ol>{kids}</ol>;
		case "listItem":
			return <li>{kids}</li>;
		case "taskList":
			return <ul data-task-list="">{kids}</ul>;
		case "taskItem":
			return (
				<li data-checked={String(Boolean(node.attrs?.checked))}>
					<span className="lp-task-box" aria-hidden="true" />
					<div>{kids}</div>
				</li>
			);
		case "blockquote":
			return <blockquote>{kids}</blockquote>;
		case "callout":
			return (
				<div className="lp-callout">
					<span className="lp-callout-icon">
						{String(node.attrs?.emoji ?? "💡")}
					</span>
					<div className="lp-callout-body">{inline}</div>
				</div>
			);
		case "codeBlock":
			return (
				<pre className="lp-code">
					<code>
						{lowlightTree(
							(node.content ?? []).map((n) => n.text ?? "").join(""),
							String(node.attrs?.language ?? ""),
						)}
					</code>
				</pre>
			);
		case "horizontalRule":
			return <hr />;
		case "table": {
			// Same column widths as the editor: stored widths, and a minimum for the rest.
			let total = 0;
			let fixed = true;
			const widths: (number | undefined)[] = [];
			for (const cell of node.content?.[0]?.content ?? []) {
				const colwidth = cell.attrs?.colwidth as unknown as number[] | null;
				const span = Number(cell.attrs?.colspan) || 1;
				for (let i = 0; i < span; i++) {
					const width = colwidth?.[i];
					widths.push(width);
					total += width || CELL_MIN_WIDTH;
					if (!width) fixed = false;
				}
			}
			return (
				<div className="lp-table-wrap">
					<table style={fixed ? { width: total } : { minWidth: total }}>
						<colgroup>
							{widths.map((width, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: columns of a static render
								<col key={i} style={width ? { width } : undefined} />
							))}
						</colgroup>
						<tbody>{kids}</tbody>
					</table>
				</div>
			);
		}
		case "tableRow":
			return <tr>{kids}</tr>;
		case "tableCell":
			return (
				<td
					colSpan={Number(node.attrs?.colspan) || undefined}
					rowSpan={Number(node.attrs?.rowspan) || undefined}
				>
					{kids}
				</td>
			);
		case "tableHeader":
			return (
				<th
					colSpan={Number(node.attrs?.colspan) || undefined}
					rowSpan={Number(node.attrs?.rowspan) || undefined}
				>
					{kids}
				</th>
			);
		case "image": {
			const fileId = String(node.attrs?.fileId ?? "");
			if (!fileId) return null;
			const width = Number(node.attrs?.width) || undefined;
			return (
				<figure className="lp-image">
					<img
						src={options.fileHref(fileId)}
						alt={String(node.attrs?.alt ?? "")}
						style={{ width }}
					/>
				</figure>
			);
		}
		case "attachment": {
			const fileId = String(node.attrs?.fileId ?? "");
			return (
				<div className="lp-attachment">
					<a href={options.fileHref(fileId, true)}>
						<PageIcon size={16} />
						<span className="truncate">
							{String(node.attrs?.name ?? "File")}
						</span>
						<span className="text-pencil">
							{formatBytes(Number(node.attrs?.size) || 0)}
						</span>
					</a>
				</div>
			);
		}
		case "pageLink":
		case "databaseEmbed": {
			const id = String(node.attrs?.pageId ?? node.attrs?.databaseId ?? "");
			const title = String(node.attrs?.title ?? "") || "Untitled";
			const Icon = node.type === "pageLink" ? PageIcon : TableIcon;
			return (
				<div className="lp-page-link">
					{options.links ? (
						<Link to="/p/$pageId" params={{ pageId: id }}>
							<Icon size={16} />
							<span className="truncate">{title}</span>
						</Link>
					) : (
						<span>
							<Icon size={16} />
							<span className="truncate">{title}</span>
						</span>
					)}
				</div>
			);
		}
		case "toggle": {
			const [title, body] = node.content ?? [];
			return (
				<details className="lp-toggle-static" open={Boolean(node.attrs?.open)}>
					<summary>
						<Inline nodes={title?.content} />
					</summary>
					<div className="lp-toggle-body">
						<RenderBlocks nodes={body?.content} options={options} />
					</div>
				</details>
			);
		}
		default:
			return kids;
	}
}

// Flat text of a node, for diffing versions and building descriptions.
export function textOf(node: PmNode): string {
	if (node.type === "text") return node.text ?? "";
	if (node.type === "mention") return String(node.attrs?.label ?? "");
	if (node.type === "image") return `[image ${node.attrs?.fileId ?? ""}]`;
	return (node.content ?? []).map(textOf).join("");
}
