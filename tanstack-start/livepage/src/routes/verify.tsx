type Search = { userId?: string; secret?: string };

import { createFileRoute } from "@tanstack/react-router";
import { VerifyPage } from "#/features/auth/VerifyPage";

export const Route = createFileRoute("/verify")({
	validateSearch: (search: Record<string, unknown>): Search => ({
		userId: typeof search.userId === "string" ? search.userId : undefined,
		secret: typeof search.secret === "string" ? search.secret : undefined,
	}),
	component: VerifyPage,
});
