type Search = { userId?: string; secret?: string };

import { createFileRoute } from "@tanstack/react-router";
import { ResetPage } from "#/features/auth/ResetPage";

export const Route = createFileRoute("/reset")({
	validateSearch: (search: Record<string, unknown>): Search => ({
		userId: typeof search.userId === "string" ? search.userId : undefined,
		secret: typeof search.secret === "string" ? search.secret : undefined,
	}),
	head: () => ({ meta: [{ title: "Reset password · Livepage" }] }),
	component: ResetPage,
});
