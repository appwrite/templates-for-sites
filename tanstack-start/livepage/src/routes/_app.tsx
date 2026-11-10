import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "#/components/shell/app-shell";
import { fetchAppState } from "#/functions/session";

export const Route = createFileRoute("/_app")({
	beforeLoad: async () => {
		const state = await fetchAppState();
		if (state.status === "setup") throw redirect({ to: "/setup" });
		if (state.status !== "ok") throw redirect({ to: "/login" });
		if (state.twoStepRequired) throw redirect({ to: "/two-step" });
		return {
			viewer: state.viewer,
			workspaces: state.workspaces,
			schemaUpdate: Boolean(state.schemaUpdate),
		};
	},
	component: AppRoute,
});

function AppRoute() {
	const { viewer, workspaces, schemaUpdate } = Route.useRouteContext();
	return (
		<AppShell
			viewer={viewer}
			workspaces={workspaces}
			schemaUpdate={schemaUpdate}
		/>
	);
}
