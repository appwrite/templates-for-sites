import { createFileRoute } from "@tanstack/react-router";
import { CommentsPage } from "#/features/workspace/CommentsPage";

export const Route = createFileRoute("/_app/w/$workspaceId/comments")({
	loader: () => ({ title: "All comments" }),
	component: CommentsPage,
});
