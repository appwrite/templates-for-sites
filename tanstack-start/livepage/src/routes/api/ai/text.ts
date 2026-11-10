import { createFileRoute } from "@tanstack/react-router";
import { handleTextRequest } from "#/server/ai";

export const Route = createFileRoute("/api/ai/text")({
	server: { handlers: { POST: ({ request }) => handleTextRequest(request) } },
});
