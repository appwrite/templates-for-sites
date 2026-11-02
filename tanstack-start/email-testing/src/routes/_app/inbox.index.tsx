import { createFileRoute } from "@tanstack/react-router";

// The list itself renders in the /inbox layout.
export const Route = createFileRoute("/_app/inbox/")({
	component: () => null,
});
