import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "#/features/workspace/HomePage";

export const Route = createFileRoute("/_app/w/$workspaceId/")({
	loader: () => ({ title: "Home" }),
	component: HomePage,
});
