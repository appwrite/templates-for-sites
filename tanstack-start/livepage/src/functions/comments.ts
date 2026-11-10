import { createServerFn } from "@tanstack/react-start";
import {
	type CommentAnchor,
	createComment,
	deleteComment,
	listComments,
	listWorkspaceComments,
	moveCommentAnchors,
	notifyMention,
	setThreadResolved,
	updateComment,
} from "#/server/comments";

export type { Comment, CommentAnchor } from "#/server/comments";

export const fetchComments = createServerFn({ method: "GET" })
	.validator((d: { pageId: string }) => d)
	.handler(({ data }) => listComments(data.pageId));

export const fetchWorkspaceComments = createServerFn({ method: "GET" })
	.validator((d: { workspaceId: string; limit?: number; cursor?: string }) => d)
	.handler(({ data }) =>
		listWorkspaceComments(data.workspaceId, data.limit, data.cursor),
	);

export const submitComment = createServerFn({ method: "POST" })
	.validator(
		(d: {
			pageId: string;
			threadId?: string | null;
			body: string;
			anchor?: CommentAnchor | null;
			mentions?: string[];
		}) => d,
	)
	.handler(({ data }) => createComment(data));

export const submitThreadResolved = createServerFn({ method: "POST" })
	.validator((d: { pageId: string; threadId: string; resolved: boolean }) => d)
	.handler(({ data }) =>
		setThreadResolved(data.pageId, data.threadId, data.resolved),
	);

export const submitMention = createServerFn({ method: "POST" })
	.validator((d: { pageId: string; userId: string }) => d)
	.handler(({ data }) => notifyMention(data.pageId, data.userId));

export const submitCommentEdit = createServerFn({ method: "POST" })
	.validator((d: { commentId: string; body: string; mentions?: string[] }) => d)
	.handler(({ data }) => updateComment(data));

export const submitCommentDelete = createServerFn({ method: "POST" })
	.validator((d: { commentId: string }) => d)
	.handler(({ data }) => deleteComment(data.commentId));

export const submitCommentAnchors = createServerFn({ method: "POST" })
	.validator(
		(d: {
			pageId: string;
			moves: { commentId: string; anchor: CommentAnchor }[];
		}) => d,
	)
	.handler(({ data }) => moveCommentAnchors(data.pageId, data.moves));
