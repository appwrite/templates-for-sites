// The signed-in person: profile, sessions, photo. Runs with their own session, except deleting
// the account and reading other people's photos, which need the site key.
import {
	Account,
	ID,
	type Models,
	Query,
	Storage,
	TablesDB,
	Users,
} from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import { adminClient, errorCode } from "#/server/appwrite";
import { requireViewer, requireWorkspace, roleFrom } from "#/server/auth";
import { BUCKET_ID, DATABASE_ID, WORKSPACES } from "#/server/schema";
import { isWorkspaceIconFile } from "#/server/workspaces";

export type Profile = {
	name: string;
	email: string;
	passwordUpdatedAt: string;
	avatar: string | null;
};

export async function loadProfile(): Promise<Profile> {
	const { client } = await requireViewer();
	const user = await new Account(client).get();
	const prefs = user.prefs as { avatar?: string };
	return {
		name: user.name,
		email: user.email,
		passwordUpdatedAt: user.passwordUpdate,
		avatar: prefs.avatar || null,
	};
}

export async function saveName(name: string) {
	const { client } = await requireViewer();
	const trimmed = name.trim();
	if (!trimmed) throw new Error("Give yourself a name.");
	await new Account(client).updateName({ name: trimmed });
}

export async function saveEmail(email: string, password: string) {
	const { client } = await requireViewer();
	try {
		await new Account(client).updateEmail({
			email: email.trim().toLowerCase(),
			password,
		});
	} catch (err) {
		if (errorCode(err) === 401) throw new Error("That password isn't right.");
		if (errorCode(err) === 409)
			throw new Error("Another account already uses that email.");
		throw err;
	}
}

export async function savePassword(password: string, oldPassword: string) {
	const { client } = await requireViewer();
	try {
		await new Account(client).updatePassword({ password, oldPassword });
	} catch (err) {
		if (errorCode(err) === 401)
			throw new Error("Your current password isn't right.");
		throw err;
	}
}

export async function saveAvatar(file: File) {
	const { client, viewer } = await requireViewer();
	if (!file.type.startsWith("image/")) throw new Error("Pick an image file.");
	if (file.size > 5 * 1024 * 1024) throw new Error("Use an image under 5 MB.");
	const account = new Account(client);
	const before = (await account.getPrefs()) as { avatar?: string };
	const stored = await new Storage(adminClient()).createFile({
		bucketId: BUCKET_ID,
		fileId: ID.unique(),
		file: InputFile.fromBuffer(
			new Uint8Array(await file.arrayBuffer()),
			file.name,
		),
		permissions: [
			'read("users")',
			`update("user:${viewer.userId}")`,
			`delete("user:${viewer.userId}")`,
		],
	});
	await account.updatePrefs({ prefs: { ...before, avatar: stored.$id } });
	// With the person's own session: prefs are theirs to write, so the id can name anything, and only
	// their own avatar files carry delete for them.
	if (before.avatar)
		await new Storage(client)
			.deleteFile({ bucketId: BUCKET_ID, fileId: before.avatar })
			.catch(() => undefined);
	return stored.$id;
}

export async function removeAvatar() {
	const { client } = await requireViewer();
	const account = new Account(client);
	const before = (await account.getPrefs()) as { avatar?: string };
	if (before.avatar)
		await new Storage(client)
			.deleteFile({ bucketId: BUCKET_ID, fileId: before.avatar })
			.catch(() => undefined);
	await account.updatePrefs({ prefs: { ...before, avatar: "" } });
}

// The stored picture a workspace uses, if it has one.
export async function workspaceIconFileId(workspaceId: string) {
	const row = await new TablesDB(adminClient())
		.getRow<Models.Row & { icon: string | null }>({
			databaseId: DATABASE_ID,
			tableId: WORKSPACES,
			rowId: workspaceId,
		})
		.catch(() => null);
	return row?.icon?.startsWith("file:") ? row.icon.slice(5) : null;
}

export async function removeIconFile(workspaceId: string, fileId: string) {
	if (!(await isWorkspaceIconFile(workspaceId, fileId))) return;
	await new Storage(adminClient())
		.deleteFile({ bucketId: BUCKET_ID, fileId })
		.catch(() => undefined);
}

export async function deleteWorkspaceIconFile(workspaceId: string) {
	const fileId = await workspaceIconFileId(workspaceId);
	if (fileId) await removeIconFile(workspaceId, fileId);
}

// A workspace icon is a file everyone in the workspace can read. It's stored as "file:<id>" so the
// icon column can still tell a picture from the letter badge.
export async function saveWorkspaceIcon(workspaceId: string, file: File) {
	const { role, viewer } = await requireWorkspace(workspaceId);
	if (role !== "owner" && role !== "admin")
		throw new Error("Only owners and admins can change the icon.");
	if (!file.type.startsWith("image/")) throw new Error("Pick an image file.");
	if (file.size > 5 * 1024 * 1024) throw new Error("Use an image under 5 MB.");
	const previous = await workspaceIconFileId(workspaceId);
	const stored = await new Storage(adminClient()).createFile({
		bucketId: BUCKET_ID,
		fileId: ID.unique(),
		file: InputFile.fromBuffer(
			new Uint8Array(await file.arrayBuffer()),
			file.name,
		),
		permissions: [
			`read("team:${workspaceId}")`,
			`update("user:${viewer.userId}")`,
			`delete("user:${viewer.userId}")`,
		],
	});
	if (previous) await removeIconFile(workspaceId, previous);
	return `file:${stored.$id}`;
}

// userId to avatar file, for everyone in a workspace.
export async function workspaceAvatars(workspaceId: string) {
	const { client } = await requireWorkspace(workspaceId);
	const { Teams } = await import("node-appwrite");
	const { memberships } = await new Teams(client).listMemberships({
		teamId: workspaceId,
		queries: [Query.limit(1000)],
	});
	const ids = memberships.map((m) => m.userId);
	const out: Record<string, string> = {};
	const users = new Users(adminClient());
	for (let i = 0; i < ids.length; i += 100) {
		const { users: batch } = await users.list({
			queries: [Query.equal("$id", ids.slice(i, i + 100)), Query.limit(100)],
		});
		for (const user of batch) {
			const avatar = (user.prefs as { avatar?: string }).avatar;
			if (avatar) out[user.$id] = avatar;
		}
	}
	return out;
}

export async function listDevices() {
	const { client } = await requireViewer();
	const { sessions } = await new Account(client).listSessions();
	return sessions.map((s) => ({
		id: s.$id,
		current: s.current,
		clientName: s.clientName || "Unknown browser",
		osName: s.osName || "unknown device",
		deviceModel: s.deviceModel,
		countryName: s.countryName,
		updatedAt: s.$updatedAt,
	}));
}

export async function signOutDevice(sessionId: string) {
	const { client } = await requireViewer();
	await new Account(client).deleteSession({ sessionId });
}

export async function signOutEverywhereElse() {
	const { client } = await requireViewer();
	const account = new Account(client);
	const { sessions } = await account.listSessions();
	await Promise.all(
		sessions
			.filter((s) => !s.current)
			.map((s) => account.deleteSession({ sessionId: s.$id })),
	);
}

export async function deleteAccount(confirmation: string) {
	const { client, viewer } = await requireViewer();
	if (confirmation.trim().toLowerCase() !== viewer.email.toLowerCase())
		throw new Error("Type your email address to confirm.");
	const { Teams } = await import("node-appwrite");
	const teams = new Teams(client);
	const { teams: list } = await teams.list({ queries: [Query.limit(100)] });
	for (const team of list) {
		const { memberships } = await teams.listMemberships({
			teamId: team.$id,
			queries: [Query.limit(1000)],
		});
		const mine = memberships.find((m) => m.userId === viewer.userId);
		const owners = memberships.filter(
			(m) => m.confirm && m.roles.includes("owner"),
		);
		if (mine && roleFrom(mine.roles) === "owner" && owners.length < 2)
			throw new Error(
				`You're the only owner of ${team.name}. Hand over ownership or delete it first.`,
			);
	}
	await new Users(adminClient()).delete({ userId: viewer.userId });
	const { clearSession } = await import("#/server/auth");
	clearSession();
}
