import { useMemo } from "react";
import { EMAIL_FONT_STACK } from "#/lib/email-preview";
import {
	parsePlainText,
	type TextBlock,
	type TextLine,
} from "#/lib/plain-text";

// A plain-text part set like a mail client shows it: same font as the HTML preview,
// line breaks kept, links clickable, quotes indented and the signature dimmed.
export function PlainTextView({ text }: { text: string }) {
	const parsed = useMemo(() => parsePlainText(text), [text]);
	return (
		<div
			className="max-w-[720px] whitespace-pre-wrap text-[15px] leading-[24px] [overflow-wrap:anywhere]"
			style={{ fontFamily: EMAIL_FONT_STACK }}
		>
			<Blocks blocks={parsed.body} />
			{parsed.signature ? (
				<div className={`text-graphite ${parsed.body.length ? "mt-5" : ""}`}>
					<p className="mb-1 select-none text-pencil" aria-hidden="true">
						--
					</p>
					<Blocks blocks={parsed.signature} />
				</div>
			) : null}
		</div>
	);
}

function Blocks({ blocks }: { blocks: TextBlock[] }) {
	return blocks.map((block, i) =>
		block.kind === "quote" ? (
			<blockquote
				// biome-ignore lint/suspicious/noArrayIndexKey: blocks never reorder
				key={i}
				className="mb-4 border-l-2 border-rule-strong pl-3 text-graphite"
			>
				<Lines lines={block.lines} />
			</blockquote>
		) : (
			// biome-ignore lint/suspicious/noArrayIndexKey: blocks never reorder
			<p key={i} className="mb-4 last:mb-0">
				<Lines lines={block.lines} />
			</p>
		),
	);
}

function Lines({ lines }: { lines: TextLine[] }) {
	return lines.map((line, i) => (
		// biome-ignore lint/suspicious/noArrayIndexKey: lines never reorder
		<span key={i}>
			{i > 0 ? <br /> : null}
			{line.map((part, j) =>
				part.kind === "link" ? (
					<a
						// biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
						key={j}
						href={part.href}
						target="_blank"
						rel="noreferrer noopener"
						className="link"
					>
						{part.text}
					</a>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
					<span key={j}>{part.text}</span>
				),
			)}
		</span>
	));
}
