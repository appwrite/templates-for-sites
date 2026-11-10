import { createFileRoute } from "@tanstack/react-router";
import { handleColumnRequest } from "#/server/ai";

export const Route = createFileRoute("/api/ai/column")({
	server: { handlers: { POST: ({ request }) => handleColumnRequest(request) } },
});
