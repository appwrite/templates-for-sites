import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { InboxFilter } from "#/lib/types";
import { errorCode, inboxDomain } from "#/server/appwrite";
import { AuthError, requireMember } from "#/server/auth";
import {
	countMessages,
	deleteMessage,
	getMessage,
	type ListInput,
	listMessages,
	recentMailboxes,
} from "#/server/messages";
import { getRetention } from "#/server/team";

async function member() {
	try {
		return await requireMember();
	} catch (err) {
		if (err instanceof AuthError) throw redirect({ to: "/login" });
		throw err;
	}
}

export const fetchInbox = createServerFn({ method: "GET" })
	.validator((data: ListInput & { withCounts?: boolean }) => data)
	.handler(async ({ data }) => {
		const { client } = await member();
		const [list, counts, mailboxes, retentionDays] = await Promise.all([
			listMessages(client, data),
			data.withCounts ? countMessages(client) : Promise.resolve(null),
			data.withCounts ? recentMailboxes(client) : Promise.resolve(null),
			data.withCounts ? getRetention() : Promise.resolve(null),
		]);
		return {
			...list,
			counts,
			mailboxes,
			retentionDays,
			domain: inboxDomain(),
			now: new Date().toISOString(),
		};
	});

export const fetchMessage = createServerFn({ method: "GET" })
	.validator((data: { id: string }) => data)
	.handler(async ({ data }) => {
		const { client } = await member();
		try {
			return await getMessage(client, data.id);
		} catch (err) {
			// Deleted by someone else, or by the cleanup, while it was open.
			if (errorCode(err) === 404) return null;
			throw err;
		}
	});

export const removeMessage = createServerFn({ method: "POST" })
	.validator((data: { id: string }) => data)
	.handler(async ({ data }) => {
		const { client } = await member();
		await deleteMessage(client, data.id);
		return { ok: true };
	});

export type { InboxFilter };
