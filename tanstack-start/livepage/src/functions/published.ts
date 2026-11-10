import { createServerFn } from "@tanstack/react-start";
import { getPublished } from "#/server/published";

export const fetchPublished = createServerFn({ method: "GET" })
	.validator((d: { slug: string }) => d)
	.handler(({ data }) => getPublished(data.slug));
