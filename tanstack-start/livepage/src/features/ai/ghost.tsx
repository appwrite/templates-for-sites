// "Continue inline": the continuation shows as ghost text right at the caret, on the same line. It is
// a decoration, so nothing reaches the document or anyone else until it is accepted.
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { loadPos, type SavedPos } from "./anchors";
import { Spark } from "./spark";

export type GhostKeys = {
	accept: () => void;
	discard: () => void;
};

export type Ghost = {
	status: "streaming" | "done" | "error";
	text: string;
	anchor: SavedPos;
	context: string;
	lead: string;
	errorMessage?: string;
};

type GhostState = {
	anchor: SavedPos | null;
	decorations: DecorationSet;
	moved: boolean;
};

export const ghostKey = new PluginKey<GhostState>("lpAiGhost");

const IDLE: GhostState = {
	anchor: null,
	decorations: DecorationSet.empty,
	moved: false,
};
const MODIFIER_KEYS = new Set([
	"Shift",
	"Control",
	"Alt",
	"Meta",
	"CapsLock",
	"Fn",
]);

function decorate(
	state: EditorState,
	host: HTMLElement,
	anchor: SavedPos,
): DecorationSet {
	const pos = loadPos(state, anchor);
	if (pos == null) return DecorationSet.empty;
	const $pos = state.doc.resolve(pos);
	const decorations = [
		Decoration.widget(pos, () => host, {
			key: "lp-ai-ghost",
			side: 1,
			ignoreSelection: true,
			stopEvent: () => true,
		}),
	];
	// An empty line shows its placeholder at the same spot, which would sit under the ghost text.
	if ($pos.depth > 0 && $pos.parent.content.size === 0) {
		decorations.push(
			Decoration.node($pos.before(), $pos.after(), {
				class: "lp-ai-ghost-line",
			}),
		);
	}
	return DecorationSet.create(state.doc, decorations);
}

export function ghostPlugin(
	host: HTMLElement,
	keys: { current: GhostKeys },
): Plugin<GhostState> {
	return new Plugin<GhostState>({
		key: ghostKey,
		state: {
			init: () => IDLE,
			apply(tr, value, _old, next) {
				const meta = tr.getMeta(ghostKey) as
					| { anchor: SavedPos | null }
					| undefined;
				if (meta) {
					return meta.anchor
						? {
								anchor: meta.anchor,
								decorations: decorate(next, host, meta.anchor),
								moved: false,
							}
						: IDLE;
				}
				if (!value.anchor || (!tr.docChanged && !tr.selectionSet)) return value;
				// Other people typing must not cancel this person's ghost text.
				if (tr.getMeta(ySyncPluginKey)?.isChangeOrigin) {
					const anchor =
						"abs" in value.anchor
							? { abs: tr.mapping.map(value.anchor.abs) }
							: value.anchor;
					return {
						...value,
						anchor,
						decorations: decorate(next, host, anchor),
					};
				}
				return { ...value, moved: true };
			},
		},
		view: () => ({
			update(view, previous) {
				const state = ghostKey.getState(view.state);
				if (state?.anchor && state.moved && !ghostKey.getState(previous)?.moved)
					queueMicrotask(() => keys.current.discard());
			},
		}),
		props: {
			decorations: (state) => ghostKey.getState(state)?.decorations,
		},
	});
}

// Goes first in the plugin list, so Tab and Enter reach the ghost text before lists, slash menus
// and the rest. It is a plugin of its own because the state above must apply after Yjs's.
export const ghostKeysKey = new PluginKey("lpAiGhostKeys");

export function ghostKeysPlugin(keys: { current: GhostKeys }) {
	return new Plugin({
		key: ghostKeysKey,
		props: {
			handleKeyDown(view, event) {
				if (!ghostKey.getState(view.state)?.anchor || event.isComposing)
					return false;
				if (MODIFIER_KEYS.has(event.key)) return false;
				const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
				if (
					(event.key === "Tab" || event.key === "Enter") &&
					plain &&
					!event.shiftKey
				) {
					keys.current.accept();
					return true;
				}
				if (event.key === "Escape") {
					keys.current.discard();
					return true;
				}
				// Anything else is the person carrying on: drop the ghost and let the key through.
				keys.current.discard();
				return false;
			},
		},
	});
}

// Only the first paragraph, on one line, starting exactly where the caret is.
export function shapeGhost(raw: string, lead: string) {
	const first = raw.replace(/\r/g, "").split(/\n\s*\n/)[0] ?? "";
	const line = first.replace(/\n+/g, " ");
	const text = line.trimStart();
	if (!text) return "";
	if (!lead || /\s$/.test(lead) || /^[.,;:!?)\]}'’”]/.test(text)) return text;
	return ` ${text}`;
}

export function GhostText({
	ghost,
	onAccept,
	onDiscard,
	onRetry,
}: {
	ghost: Ghost;
	onAccept: () => void;
	onDiscard: () => void;
	onRetry: () => void;
}) {
	const streaming = ghost.status === "streaming";
	const failed = ghost.status === "error";
	// A button press must not take the caret out of the page.
	const hold = (e: React.MouseEvent) => e.preventDefault();
	return (
		<>
			{ghost.text && (
				<span
					className="text-pencil"
					style={{ whiteSpace: "pre-wrap" }}
					data-testid="ai-ghost-text"
				>
					{ghost.text}
				</span>
			)}
			{streaming && (
				<span
					aria-hidden
					className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-accent"
				/>
			)}
			<span
				data-testid="ai-ghost-bar"
				className="ml-2 inline-flex select-none items-center gap-2.5 whitespace-nowrap rounded-md bg-wash px-2 py-0.5 align-[2px] font-sans text-xs font-normal leading-4 tracking-normal text-graphite max-md:mt-1 max-md:flex max-md:w-fit max-md:ml-0"
			>
				{failed ? (
					<>
						<span className="whitespace-normal text-coral" role="alert">
							{ghost.errorMessage}
						</span>
						<button
							type="button"
							className="font-medium text-link hover:underline"
							onMouseDown={hold}
							onClick={onRetry}
						>
							Try again
						</button>
						<button
							type="button"
							className="hover:text-ink"
							onMouseDown={hold}
							onClick={onDiscard}
						>
							Discard
						</button>
					</>
				) : (
					<>
						{streaming && !ghost.text && (
							<output className="flex items-center gap-1 text-link">
								<Spark size={11} />
								AI is writing
							</output>
						)}
						{ghost.text && (
							<button
								type="button"
								className="font-medium text-link hover:underline"
								onMouseDown={hold}
								onClick={onAccept}
							>
								Accept
								<kbd className="ml-1 font-mono text-[11px] text-pencil max-md:hidden">
									Tab
								</kbd>
							</button>
						)}
						<button
							type="button"
							className="hover:text-ink"
							onMouseDown={hold}
							onClick={onDiscard}
						>
							Discard
							<kbd className="ml-1 font-mono text-[11px] text-pencil max-md:hidden">
								Esc
							</kbd>
						</button>
					</>
				)}
			</span>
		</>
	);
}
