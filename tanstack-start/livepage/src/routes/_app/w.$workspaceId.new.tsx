import { createFileRoute } from "@tanstack/react-router";
import { NewPage } from "#/features/workspace/NewPage";

export const Route = createFileRoute("/_app/w/$workspaceId/new")({
	loader: () => ({ title: "New page" }),
	component: NewPage,
});
