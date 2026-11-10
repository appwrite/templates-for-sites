import { createFileRoute } from "@tanstack/react-router";
import { ConsentPage } from "#/features/auth/ConsentPage";
import { fetchConsent } from "#/functions/consent";

export const Route = createFileRoute("/consent")({
	loader: ({ location }) =>
		fetchConsent({ data: { query: location.searchStr } }),
	// Never inside another site's frame, so nobody can trick a click on Allow.
	headers: () => ({
		"x-frame-options": "DENY",
		"content-security-policy": "frame-ancestors 'none'",
		"referrer-policy": "no-referrer",
		"cache-control": "no-store",
	}),
	head: () => ({ meta: [{ title: "Connect an agent · Livepage" }] }),
	component: ConsentPage,
});
