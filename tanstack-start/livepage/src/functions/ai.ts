// Server functions for the AI settings panel and status. The AI streams use /api/ai/* routes.
import { createServerFn } from "@tanstack/react-start";
import {
	type AiSettingsPatch,
	aiStatus,
	readAiSettings,
	readCapabilities,
	saveAiSettings,
	testAiSettings,
} from "#/server/ai";

export const fetchAiStatus = createServerFn({ method: "GET" })
	.validator((d: { workspaceId: string }) => d)
	.handler(({ data }) => aiStatus(data.workspaceId));

export const fetchAiSettings = createServerFn({ method: "GET" })
	.validator((d: { workspaceId: string }) => d)
	.handler(({ data }) => readAiSettings(data.workspaceId));

export const fetchAiCapabilities = createServerFn({ method: "GET" })
	.validator((d: { workspaceId: string }) => d)
	.handler(({ data }) => readCapabilities(data.workspaceId));

export const submitAiSettings = createServerFn({ method: "POST" })
	.validator((d: { workspaceId: string; patch: AiSettingsPatch }) => d)
	.handler(({ data }) => saveAiSettings(data.workspaceId, data.patch));

export const submitAiTest = createServerFn({ method: "POST" })
	.validator((d: { workspaceId: string; patch: AiSettingsPatch }) => d)
	.handler(({ data }) => testAiSettings(data.workspaceId, data.patch));
