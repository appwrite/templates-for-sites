import { createFileRoute } from "@tanstack/react-router";
import { DatabaseView, RowProperties } from "#/features/database";
import { PageEditor, PageNotFound, RequestAccess } from "#/features/editor";
import { PublicMissing } from "#/features/editor/PublicMissing";
import { fetchPageResolution } from "#/functions/body";

export const Route = createFileRoute("/_app/p/$pageId")({
	// The shell uses workspaceId and pageId from here to mount the right sidebar.
	loader: async ({ params, context }) => {
		const resolution = await fetchPageResolution({
			data: { pageId: params.pageId },
		});
		if (resolution.status === "ok")
			return {
				resolution,
				workspaceId: resolution.access.page.workspaceId,
				pageId: resolution.access.page.id,
			};
		const fallback =
			resolution.status === "forbidden"
				? resolution.workspaceId
				: context.workspaces[0]?.id;
		return {
			resolution,
			workspaceId: fallback,
			pageId: null,
			hideTopBar: true,
		};
	},
	component: PageRoute,
});

function PageRoute() {
	const { resolution, workspaceId } = Route.useLoaderData();
	if (resolution.status === "missing")
		return workspaceId ? <PageNotFound /> : <PublicMissing signedIn />;
	if (resolution.status === "forbidden")
		return (
			<RequestAccess
				pageId={resolution.pageId}
				ownerName={resolution.ownerName}
			/>
		);
	const { access } = resolution;
	if (access.page.kind === "database")
		return <DatabaseView key={access.page.id} page={access.page} />;
	return (
		<PageEditor
			key={access.page.id}
			access={access}
			header={
				access.page.kind === "row" ? (
					<RowProperties page={access.page} />
				) : undefined
			}
		/>
	);
}
