import { createFileRoute } from "@tanstack/react-router";
import { handleEmbedRequest } from "#/server/ai";

export const Route = createFileRoute("/api/ai/embed")({
	server: { handlers: { POST: ({ request }) => handleEmbedRequest(request) } },
});
