import { createServerFn } from "@tanstack/react-start";
import { getVersion, listVersions, recordRestored } from "#/server/versions";

export type { Version, VersionMeta } from "#/server/versions";

export const fetchVersions = createServerFn({ method: "GET" })
	.validator((d: { pageId: string }) => d)
	.handler(({ data }) => listVersions(data.pageId));

export const fetchVersion = createServerFn({ method: "POST" })
	.validator((d: { versionId: string }) => d)
	.handler(({ data }) => getVersion(data.versionId));

export const submitRestored = createServerFn({ method: "POST" })
	.validator((d: { pageId: string; snapshot: string; title: string }) => d)
	.handler(({ data }) => recordRestored(data));
