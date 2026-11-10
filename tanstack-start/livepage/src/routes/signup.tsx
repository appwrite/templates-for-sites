import { createFileRoute, redirect } from "@tanstack/react-router";
import { SignupPage } from "#/features/auth/SignupPage";
import { fetchLoginState } from "#/functions/auth";

export const Route = createFileRoute("/signup")({
	loader: async () => {
		const state = await fetchLoginState();
		if (state.status === "ok") throw redirect({ to: "/" });
		return {
			signup: state.signup,
			workspaceName: state.workspaceName ?? "Livepage",
		};
	},
	head: () => ({ meta: [{ title: "Sign up · Livepage" }] }),
	component: SignupPage,
});
