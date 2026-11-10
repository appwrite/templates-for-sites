// Browser side of the AI routes: reads the newline-delimited JSON stream and tracks AI status.
import { useEffect, useState } from "react";
import { fetchAiStatus, submitVectorRefresh } from "#/functions/ai";
import type { AiStatus } from "#/server/ai";

export type { AiStatus };

export class AiClientError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly partial = false,
	) {
		super(message);
	}
}

export type StreamEvent =
	| { start: true }
	| { delta: string }
	| { sources: AskSourceView[] }
	| { done: true }
	| { error: { code: string; message: string }; partial?: boolean };

export type AskSourceView = {
	n: number;
	id: string;
	title: string;
	parent: string | null;
};

const FALLBACK = "Something went wrong. Try again.";

export async function readError(res: Response): Promise<AiClientError> {
	const body = (await res.json().catch(() => null)) as {
		error?: { code?: string; message?: string };
	} | null;
	return new AiClientError(
		body?.error?.code ?? "provider",
		body?.error?.message ?? FALLBACK,
	);
}

export async function streamAi(
	path: string,
	body: unknown,
	onEvent: (event: StreamEvent) => void,
	signal: AbortSignal,
): Promise<void> {
	const res = await fetch(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
		signal,
	});
	if (!res.ok) throw await readError(res);
	if (!res.body) throw new AiClientError("provider", FALLBACK);
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let newline = buffer.indexOf("\n");
		while (newline >= 0) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			newline = buffer.indexOf("\n");
			if (!line) continue;
			try {
				onEvent(JSON.parse(line) as StreamEvent);
			} catch {
				// A malformed line is skipped rather than breaking the whole answer.
			}
		}
	}
}

const listeners = new Set<() => void>();

// Called after a run reports a bad key, or when settings change, so every AI surface updates.
export function refreshAiStatus() {
	for (const load of listeners) load();
}

// Several parts of the shell ask at once on every page load; one request answers them all.
let pending: { workspaceId: string; promise: Promise<AiStatus> } | null = null;
function sharedStatus(workspaceId: string) {
	if (pending?.workspaceId === workspaceId) return pending.promise;
	const promise = fetchAiStatus({ data: { workspaceId } }).finally(() => {
		if (pending?.promise === promise) pending = null;
	});
	pending = { workspaceId, promise };
	return promise;
}

export function useAiStatus(workspaceId: string): AiStatus | null {
	const [status, setStatus] = useState<AiStatus | null>(null);
	useEffect(() => {
		let live = true;
		const load = () => {
			sharedStatus(workspaceId)
				.then((next) => {
					if (live) setStatus(next);
				})
				.catch(() => undefined);
		};
		load();
		listeners.add(load);
		return () => {
			live = false;
			listeners.delete(load);
		};
	}, [workspaceId]);
	return status;
}

const refreshed = new Set<string>();

// Once per tab and workspace, gives pages that have no vector yet (or an old one) a new one, a
// batch at a time. Edits keep vectors fresh after that.
export function useVectorRefresh(workspaceId: string, status: AiStatus | null) {
	const on = Boolean(status?.vectors && status.state === "ready");
	useEffect(() => {
		if (!on || refreshed.has(workspaceId)) return;
		refreshed.add(workspaceId);
		// Runs to the end even if the screen changes: it's catch-up work, not tied to a view.
		const run = async () => {
			for (let round = 0; round < 50; round++) {
				const { embedded, remaining } = await submitVectorRefresh({
					data: { workspaceId },
				});
				if (!embedded || !remaining) return;
			}
		};
		run().catch(() => refreshed.delete(workspaceId));
	}, [on, workspaceId]);
}
