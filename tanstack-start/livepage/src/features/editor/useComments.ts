import { useCallback, useEffect, useRef, useState } from "react";
import {
	queryEqual,
	useChannel,
	useLive,
} from "#/components/shell/live-context";
import { type Comment, fetchComments } from "#/functions/comments";
import { coalesce, type LiveEvent } from "#/lib/live";
import { COMMENTS, rowsChannel } from "#/server/schema";

export type Thread = {
	id: string;
	root: Comment;
	replies: Comment[];
	resolved: boolean;
};

export function groupThreads(comments: Comment[]): Thread[] {
	const roots = comments.filter((c) => c.threadId === c.id);
	return roots.map((root) => ({
		id: root.id,
		root,
		replies: comments.filter((c) => c.threadId === root.id && c.id !== root.id),
		resolved: Boolean(root.resolvedAt),
	}));
}

export function useComments(pageId: string) {
	const [comments, setComments] = useState<Comment[]>([]);
	const [loaded, setLoaded] = useState(false);
	const { onReconnect } = useLive();

	const load = useCallback(async () => {
		const rows = await fetchComments({ data: { pageId } });
		setComments(rows as Comment[]);
		setLoaded(true);
	}, [pageId]);

	const reload = useRef(coalesce(load, 150));
	useEffect(() => {
		reload.current = coalesce(load, 150);
		void load();
		const cancel = reload.current;
		return () => cancel.cancel();
	}, [load]);

	useEffect(() => onReconnect(() => reload.current()), [onReconnect]);

	useChannel(
		`comments-${pageId}`.slice(0, 36),
		[rowsChannel(COMMENTS)],
		[queryEqual("pageId", pageId)],
		(_event: LiveEvent) => reload.current(),
	);

	return { comments, setComments, loaded, reload: load };
}
