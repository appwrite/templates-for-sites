import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginPage } from "#/features/auth/LoginPage";
import { fetchLoginState } from "#/functions/auth";

export const Route = createFileRoute("/login")({
	loader: async () => {
		const state = await fetchLoginState();
		if (state.status === "ok") throw redirect({ to: "/" });
		return state;
	},
	head: () => ({ meta: [{ title: "Sign in · Livepage" }] }),
	component: LoginPage,
});
