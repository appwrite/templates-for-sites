import { ID, TablesDB } from "node-appwrite";
import { adminClient, errorMessage } from "./appwrite";
import { DATABASE_ID, NOTIFICATIONS } from "./schema";

type Notice = {
	workspaceId: string;
	pageId?: string | null;
	kind: string;
	actorId: string;
	actorName: string;
	title: string;
	body?: string;
};

// Writes one notification per recipient with the site key, because a person can't grant another
// person read access to a row directly. Nobody is told about their own action.
export async function notifyUsers(userIds: string[], notice: Notice) {
	const db = new TablesDB(adminClient());
	const recipients = [...new Set(userIds)].filter(
		(id) => id && id !== notice.actorId,
	);
	await Promise.all(
		recipients.map((userId) =>
			db
				.createRow({
					databaseId: DATABASE_ID,
					tableId: NOTIFICATIONS,
					rowId: ID.unique(),
					data: {
						userId,
						workspaceId: notice.workspaceId,
						pageId: notice.pageId ?? null,
						kind: notice.kind,
						actorId: notice.actorId,
						actorName: notice.actorName.slice(0, 128),
						title: notice.title.slice(0, 512),
						body: notice.body ?? null,
						readAt: null,
					},
					permissions: [
						`read("user:${userId}")`,
						`update("user:${userId}")`,
						`delete("user:${userId}")`,
					],
				})
				.catch((err) => {
					// A notification that fails must not fail the comment that caused it.
					console.error("Notification failed:", errorMessage(err));
				}),
		),
	);
}
