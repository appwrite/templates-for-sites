import { createFileRoute } from "@tanstack/react-router";
import { handleImageDiscard, handleImageRequest } from "#/server/ai";

export const Route = createFileRoute("/api/ai/image")({
	server: {
		handlers: {
			POST: ({ request }) => handleImageRequest(request),
			DELETE: ({ request }) => handleImageDiscard(request),
		},
	},
});
