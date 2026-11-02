import { createContext, useContext } from "react";
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
