import { createServerFn } from "@tanstack/react-start";
import {
	compactPage,
	createAccessRequest,
	listPeople,
	loadBody,
	ownAccessRequest,
	resolvePage,
	saveUpdate,
} from "#/server/body";

export const fetchPageResolution = createServerFn({ method: "GET" })
	.validator((d: { pageId: string }) => d)
	.handler(({ data }) => resolvePage(data.pageId));

export const fetchBody = createServerFn({ method: "POST" })
	.validator((d: { pageId: string }) => d)
	.handler(({ data }) => loadBody(data.pageId));

export const submitUpdate = createServerFn({ method: "POST" })
	.validator(
		(d: {
			pageId: string;
			rowId: string;
			data: string;
			clientId: string;
			cursor: string | null;
		}) => d,
	)
	.handler(({ data }) => saveUpdate(data));

export const submitCompact = createServerFn({ method: "POST" })
	.validator((d: { pageId: string }) => d)
	.handler(({ data }) => compactPage(data.pageId));

export const submitAccessRequest = createServerFn({ method: "POST" })
	.validator((d: { pageId: string; note: string }) => d)
	.handler(({ data }) => createAccessRequest(data.pageId, data.note));

export const fetchAccessRequest = createServerFn({ method: "GET" })
	.validator((d: { pageId: string }) => d)
	.handler(({ data }) => ownAccessRequest(data.pageId));

export const fetchPeople = createServerFn({ method: "GET" })
	.validator((d: { workspaceId: string }) => d)
	.handler(({ data }) => listPeople(data.workspaceId));
