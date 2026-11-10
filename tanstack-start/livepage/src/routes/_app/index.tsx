import { createFileRoute, redirect } from "@tanstack/react-router";
import { CreateWorkspacePage } from "#/features/auth/CreateWorkspacePage";
import { fetchLoginState } from "#/functions/auth";

export const Route = createFileRoute("/_app/")({
	beforeLoad: ({ context }) => {
		const first = context.workspaces[0];
		if (first)
			throw redirect({
				to: "/w/$workspaceId",
				params: { workspaceId: first.id },
			});
	},
	loader: async () => ({ signup: (await fetchLoginState()).signup }),
	component: CreateWorkspacePage,
});
