import { Account, ID, type Models, Storage } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import { contentPermissions } from "#/lib/permissions";
import { adminClient, errorCode, sessionClient } from "./appwrite";
import { AuthError, workspaceRole } from "./auth";
import { pageAccess } from "./body";
import { BUCKET_ID, MAX_FILE_BYTES } from "./schema";

// Saves bytes to the files bucket for a workspace member. The session proves who is asking; the
// write uses the site key, because a page shared with named people carries `user:` roles that the
// person uploading doesn't hold, and Appwrite only lets someone grant roles they hold.
export async function saveImageFile(
	viewerSecret: string,
	workspaceId: string,
	bytes: Uint8Array,
	name: string,
	permissions: string[],
): Promise<{ fileId: string }> {
	const session = sessionClient(viewerSecret);
	const user = await new Account(session).get();
	const role = await workspaceRole(session, user.$id, workspaceId);
	if (!role)
		throw new AuthError(
			"You don't have access to this workspace.",
			"forbidden",
		);
	const file = await new Storage(adminClient()).createFile({
		bucketId: BUCKET_ID,
		fileId: ID.unique(),
		file: InputFile.fromBuffer(bytes, name),
		permissions,
	});
	return { fileId: file.$id };
}

// A file belongs to a page's workspace or its creator if its permissions say so. Only the site key
// creates files (the bucket grants nobody create), so these roles can't be forged. Used to decide
// whether a file ID found in a user-editable value (a cover, a block in a body) may be served
// publicly or deleted with the site key.
export function fileOwnedBy(
	file: Pick<Models.File, "$permissions">,
	page: { workspaceId: string; createdBy: string },
) {
	return (
		file.$permissions.includes(`read("team:${page.workspaceId}/member")`) ||
		file.$permissions.includes(`read("user:${page.createdBy}")`)
	);
}

export async function fileBelongsTo(
	fileId: string,
	page: { workspaceId: string; createdBy: string },
) {
	try {
		const file = await new Storage(adminClient()).getFile({
			bucketId: BUCKET_ID,
			fileId,
		});
		return fileOwnedBy(file, page);
	} catch (err) {
		if (errorCode(err) === 404) return false;
		throw err;
	}
}

export type UploadedFile = {
	fileId: string;
	name: string;
	size: number;
	mimeType: string;
};

export async function storeUpload(
	pageId: string,
	file: File,
): Promise<UploadedFile> {
	const access = await pageAccess(pageId);
	if (!access.canEdit)
		throw new AuthError("You can only view this page.", "forbidden");
	if (file.size > MAX_FILE_BYTES)
		throw new Error("That file is over 30 MB. Try a smaller one.");
	const bytes = new Uint8Array(await file.arrayBuffer());
	const created = await new Storage(adminClient()).createFile({
		bucketId: BUCKET_ID,
		fileId: ID.unique(),
		file: InputFile.fromBuffer(bytes, file.name || "file"),
		permissions: contentPermissions(access.page),
	});
	return {
		fileId: created.$id,
		name: created.name,
		size: created.sizeOriginal,
		mimeType: created.mimeType,
	};
}
