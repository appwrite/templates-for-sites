import { createServerFn } from "@tanstack/react-start";
import type { PageDraft, PagePatch } from "#/lib/types";
import { createPage, listPages, trashPage, updatePage } from "#/server/pages";

export const fetchPages = createServerFn({ method: "GET" })
	.validator((d: { workspaceId: string }) => d)
	.handler(({ data }) => listPages(data.workspaceId));

export const submitCreatePage = createServerFn({ method: "POST" })
	.validator((d: PageDraft) => d)
	.handler(({ data }) => createPage(data));

export const submitUpdatePage = createServerFn({ method: "POST" })
	.validator((d: { pageId: string; patch: PagePatch }) => d)
	.handler(({ data }) => updatePage(data.pageId, data.patch));

export const submitTrashPage = createServerFn({ method: "POST" })
	.validator((d: { pageId: string; restore?: boolean }) => d)
	.handler(({ data }) => trashPage(data.pageId, data.restore));
