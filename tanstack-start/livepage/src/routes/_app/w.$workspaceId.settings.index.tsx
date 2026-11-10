import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "#/features/settings/SettingsPage";

export const Route = createFileRoute("/_app/w/$workspaceId/settings/")({
	loader: () => ({ hideTopBar: true, hideSidebar: true }),
	component: () => <SettingsPage section="general" />,
});
