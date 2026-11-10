import { createFileRoute } from "@tanstack/react-router";
import { InboxPage } from "#/features/workspace/InboxPage";

export const Route = createFileRoute("/_app/w/$workspaceId/inbox")({
	loader: () => ({ title: "Inbox" }),
	component: InboxPage,
});
