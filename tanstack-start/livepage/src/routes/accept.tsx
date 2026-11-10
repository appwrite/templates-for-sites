import { createFileRoute } from "@tanstack/react-router";
import { AcceptPage } from "#/features/auth/AcceptPage";
import { fetchInvite } from "#/functions/auth";

type Search = {
	teamId?: string;
	membershipId?: string;
	userId?: string;
	secret?: string;
};

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export const Route = createFileRoute("/accept")({
	validateSearch: (search: Record<string, unknown>): Search => ({
		teamId: str(search.teamId),
		membershipId: str(search.membershipId),
		userId: str(search.userId),
		secret: str(search.secret),
	}),
	loaderDeps: ({ search }) => search,
	loader: async ({ deps }) => {
		const { teamId, membershipId, userId, secret } = deps;
		if (!teamId || !membershipId || !userId || !secret)
			return { params: null, invite: null };
		const invite = await fetchInvite({
			data: { teamId, membershipId, userId },
		});
		return {
			params: { teamId, membershipId, userId, secret },
			invite,
		};
	},
	head: () => ({ meta: [{ title: "Join · Livepage" }] }),
	component: AcceptPage,
});
