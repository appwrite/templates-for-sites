import { createFileRoute } from "@tanstack/react-router";
import { MapPage } from "#/features/workspace/MapPage";

export const Route = createFileRoute("/_app/w/$workspaceId/map")({
	loader: () => ({ title: "Map" }),
	component: MapPage,
});
