import { createFileRoute } from "@tanstack/react-router";
import { TemplatesPage } from "#/features/workspace/TemplatesPage";

export const Route = createFileRoute("/_app/w/$workspaceId/templates")({
	loader: () => ({ title: "Templates" }),
	component: TemplatesPage,
});
