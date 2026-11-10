import { createServerFn } from "@tanstack/react-start";
import { storeUpload } from "#/server/files";

export const uploadFile = createServerFn({ method: "POST" })
	.validator((d: FormData) => d)
	.handler(async ({ data }) => {
		const pageId = String(data.get("pageId") || "");
		const file = data.get("file");
		if (!pageId || !(file instanceof File))
			throw new Error("There's no file to upload.");
		return storeUpload(pageId, file);
	});
