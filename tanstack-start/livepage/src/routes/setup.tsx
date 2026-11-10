import { createFileRoute, redirect } from "@tanstack/react-router";
import { SetupPage } from "#/features/setup/SetupPage";
import { fetchSetupView } from "#/functions/setup";

export const Route = createFileRoute("/setup")({
	loader: async () => {
		const view = await fetchSetupView();
		if (view.view === "locked")
			throw redirect({ to: view.signedIn ? "/" : "/login" });
		return view;
	},
	head: () => ({ meta: [{ title: "Set up Livepage" }] }),
	component: SetupPage,
});
