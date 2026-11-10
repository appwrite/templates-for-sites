import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/w/$workspaceId")({
	// Someone else's workspace, or one that's gone: go home rather than show an empty shell.
	beforeLoad: ({ context, params }) => {
		if (!context.workspaces.some((w) => w.id === params.workspaceId))
			throw redirect({ to: "/" });
	},
	component: Outlet,
});
