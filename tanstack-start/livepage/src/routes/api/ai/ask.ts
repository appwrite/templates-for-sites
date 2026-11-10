import { createFileRoute } from "@tanstack/react-router";
import { handleAskRequest } from "#/server/ai";

export const Route = createFileRoute("/api/ai/ask")({
	server: { handlers: { POST: ({ request }) => handleAskRequest(request) } },
});
