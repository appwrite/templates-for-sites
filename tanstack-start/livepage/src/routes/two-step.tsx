import { createFileRoute, redirect } from "@tanstack/react-router";
import { TwoStepRequiredPage } from "#/features/auth/TwoStepRequiredPage";
import { fetchAppState } from "#/functions/session";

// Everyone adds a code when the site requires it (the option on the Features step of setup).
export const Route = createFileRoute("/two-step")({
	beforeLoad: async () => {
		const state = await fetchAppState();
		if (state.status === "setup") throw redirect({ to: "/setup" });
		if (state.status !== "ok") throw redirect({ to: "/login" });
		return { email: state.viewer.email };
	},
	component: TwoStepRequiredPage,
});
