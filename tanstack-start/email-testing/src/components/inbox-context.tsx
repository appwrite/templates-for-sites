import { createContext, useContext } from "react";
import type { LiveStatus } from "#/lib/live";
import type { InboxCounts, InboxFilter, MessageSummary } from "#/lib/types";

export type InboxSearch = {
	filter?: InboxFilter;
	q?: string;
	mailbox?: string;
};

export type InboxState = {
	messages: MessageSummary[];
	total: number;
	counts: InboxCounts | null;
	retentionDays: number | null;
	domain: string;
	now: number;
	// Whether new mail shows up on its own right now.
	live: LiveStatus;
	search: InboxSearch;
	markRead: (id: string) => void;
	remove: (id: string) => void;
};

export const InboxContext = createContext<InboxState | null>(null);

export function useInbox() {
	const ctx = useContext(InboxContext);
	if (!ctx) throw new Error("useInbox must be used inside the inbox layout.");
	return ctx;
}
