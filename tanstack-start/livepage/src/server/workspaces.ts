import {
	Role as AppwriteRole,
	type Client,
	ID,
	type Models,
	Permission,
	Query,
	Storage,
	TablesDB,
	Teams,
} from "node-appwrite";
import type { Role, Section, Workspace } from "#/lib/types";
import { adminClient, errorCode } from "./appwrite";
import { AuthError, requireViewer, requireWorkspace, roleFrom } from "./auth";
import { BUCKET_ID, DATABASE_ID, WORKSPACES } from "./schema";
import { readSettings } from "./settings";

type WorkspaceRow = Models.Row & {
	name: string;
	icon: string | null;
	sections: string | null;
	createdBy: string;
};

export function parseSections(raw: string | null | undefined): Section[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export const DEFAULT_SECTIONS: Section[] = [{ id: "general", name: "General" }];

// Read only. A workspace row holds its icon and sections, so it changes only through
// updateWorkspace below (or the site's own setup and delete paths), with the role checked here.
export const rowPermissions = (workspaceId: string) => [
	Permission.read(AppwriteRole.team(workspaceId)),
];

function toWorkspace(row: WorkspaceRow, role: Role): Workspace {
	return {
		id: row.$id,
		name: row.name,
		icon: row.icon || null,
		sections: parseSections(row.sections),
		role,
	};
}

// Every workspace the person belongs to, with their role in each.
export async function listWorkspaces(
	client: Client,
	userId: string,
): Promise<Workspace[]> {
	const teams = new Teams(client);
	const db = new TablesDB(client);
	const { teams: list } = await teams.list({ queries: [Query.limit(100)] });
	const rows = await Promise.all(
		list.map(async (team): Promise<Workspace | null> => {
			try {
				const [{ memberships }, row] = await Promise.all([
					teams.listMemberships({
						teamId: team.$id,
						queries: [
							Query.equal("userId", [userId]),
							Query.equal("confirm", [true]),
							Query.limit(1),
						],
					}),
					db.getRow<WorkspaceRow>({
						databaseId: DATABASE_ID,
						tableId: WORKSPACES,
						rowId: team.$id,
					}),
				]);
				// An invite that hasn't been accepted isn't membership.
				if (!memberships[0]) return null;
				return toWorkspace(row, roleFrom(memberships[0].roles));
			} catch (err) {
				// A team without a workspace row: another app's team, or one that's mid-creation.
				if ([401, 404].includes(errorCode(err))) return null;
				throw err;
			}
		}),
	);
	return rows.filter((w): w is Workspace => w !== null);
}

// Creates a workspace: a team owned by the person, plus its row.
// The site key writes the row so its permissions can name roles the person doesn't hold yet.
export async function createWorkspace(name: string): Promise<Workspace> {
	const { client, viewer } = await requireViewer();
	const trimmed = name.trim();
	if (!trimmed) throw new Error("Give the workspace a name.");
	// On an invite-only site, only someone already in a workspace can start another. A team alone
	// doesn't count: anyone can create one directly with the API, a workspace can't be forged.
	const settings = await readSettings();
	if (settings?.signup !== "open") {
		const workspaces = await listWorkspaces(client, viewer.userId);
		if (!workspaces.length)
			throw new AuthError(
				"This site is invite only. Ask a workspace admin for an invite.",
				"forbidden",
			);
	}
	const team = await new Teams(client).create({
		teamId: ID.unique(),
		name: trimmed,
		roles: ["owner", "member"],
	});
	const row = await new TablesDB(adminClient()).createRow<WorkspaceRow>({
		databaseId: DATABASE_ID,
		tableId: WORKSPACES,
		rowId: team.$id,
		data: {
			name: trimmed,
			icon: null,
			sections: JSON.stringify(DEFAULT_SECTIONS),
			createdBy: viewer.userId,
		},
		permissions: rowPermissions(team.$id),
	});
	return toWorkspace(row, "owner");
}

export async function updateWorkspace(
	workspaceId: string,
	patch: { name?: string; icon?: string | null; sections?: Section[] },
): Promise<Workspace> {
	const { role } = await requireWorkspace(workspaceId);
	if (role !== "owner" && role !== "admin")
		throw new AuthError("Only workspace admins can change this.", "forbidden");
	const data: Record<string, unknown> = {};
	if (patch.name !== undefined) data.name = patch.name.trim();
	if (patch.icon !== undefined) {
		if (patch.icon?.startsWith("file:")) {
			// A stored picture is only trusted once it's known to be this workspace's icon.
			if (!(await isWorkspaceIconFile(workspaceId, patch.icon.slice(5))))
				throw new AuthError("You can't use that file here.", "forbidden");
		}
		data.icon = patch.icon;
	}
	if (patch.sections !== undefined)
		data.sections = JSON.stringify(
			patch.sections.map((s) => ({ id: String(s.id), name: String(s.name) })),
		);
	const admin = adminClient();
	const row = await new TablesDB(admin).updateRow<WorkspaceRow>({
		databaseId: DATABASE_ID,
		tableId: WORKSPACES,
		rowId: workspaceId,
		data,
	});
	if (patch.name)
		await new Teams(admin).updateName({
			teamId: workspaceId,
			name: patch.name.trim(),
		});
	return toWorkspace(row, role);
}

// A workspace icon's file carries read("team:<id>"); a page file never does.
export async function isWorkspaceIconFile(workspaceId: string, fileId: string) {
	try {
		const file = await new Storage(adminClient()).getFile({
			bucketId: BUCKET_ID,
			fileId,
		});
		return file.$permissions.includes(`read("team:${workspaceId}")`);
	} catch (err) {
		if (errorCode(err) === 404) return false;
		throw err;
	}
}
