import { createFileRoute } from "@tanstack/react-router";
import { PublicMissing } from "#/features/editor/PublicMissing";
import { PublicPage } from "#/features/editor/PublicPage";
import { fetchPublished } from "#/functions/published";

export const Route = createFileRoute("/public/$slug")({
	loader: ({ params }) => fetchPublished({ data: { slug: params.slug } }),
	head: ({ loaderData }) => {
		if (!loaderData || loaderData.status !== "ok")
			return {
				meta: [
					{ title: "Page not found" },
					{ name: "robots", content: "noindex" },
				],
			};
		const description =
			loaderData.excerpt || `A page published by ${loaderData.workspaceName}.`;
		return {
			meta: [
				{ title: loaderData.title },
				{ name: "description", content: description },
				{ name: "robots", content: "index, follow" },
				{ property: "og:type", content: "article" },
				{ property: "og:title", content: loaderData.title },
				{ property: "og:description", content: description },
				{ property: "og:site_name", content: loaderData.workspaceName },
				{ name: "twitter:card", content: "summary" },
				{ name: "twitter:title", content: loaderData.title },
				{ name: "twitter:description", content: description },
			],
		};
	},
	component: () => {
		const data = Route.useLoaderData();
		if (data.status !== "ok") return <PublicMissing signedIn={data.signedIn} />;
		return <PublicPage page={data} />;
	},
});
