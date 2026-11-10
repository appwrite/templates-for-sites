import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "#/features/settings/SettingsPage";

export const Route = createFileRoute("/_app/w/$workspaceId/settings/$section")({
	loader: () => ({ hideTopBar: true, hideSidebar: true }),
	component: Section,
});

function Section() {
	const { section } = Route.useParams();
	return <SettingsPage section={section} />;
}
