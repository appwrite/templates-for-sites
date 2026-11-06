import { Query, TablesDB } from "node-appwrite";
import { adminClient, errorCode } from "./appwrite";
import type { McpBackend } from "./mcp";
import { findLatest, getMessage, toSummary } from "./messages";
import { DATABASE_ID, MESSAGES } from "./schema";

// What the MCP tools read with. The agent's user is checked first (token and team membership),
// then reads go through the site's key, the same way the CI API does. Reading through MCP never
// marks a message as read.
export function messageBackend(): McpBackend {
	return {
		async listMessages({ to, since, limit, unreadOnly }) {
			const queries = [Query.orderDesc("receivedAt"), Query.limit(limit)];
			const address = to?.trim().toLowerCase();
			if (address)
				queries.push(
					address.includes("@")
						? Query.equal("recipient", address)
						: Query.equal("mailbox", address),
				);
			if (since) queries.push(Query.greaterThan("receivedAt", since));
			if (unreadOnly) queries.push(Query.equal("read", false));
			const page = await new TablesDB(adminClient()).listRows({
				databaseId: DATABASE_ID,
				tableId: MESSAGES,
				queries,
			});
			return page.rows.map((row) =>
				toSummary(row as Parameters<typeof toSummary>[0]),
			);
		},
		async getMessage(id) {
			try {
				return await getMessage(adminClient(), id, false);
			} catch (err) {
				if (errorCode(err) === 404) return null;
				throw err;
			}
		},
		latestMessageId: (to, since) => findLatest(to, since),
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		now: () => Date.now(),
	};
}
