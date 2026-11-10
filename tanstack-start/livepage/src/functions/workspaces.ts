import { createServerFn } from "@tanstack/react-start";
import type { Role } from "#/lib/types";
import { inviteMember } from "#/server/members";
import { createWorkspace } from "#/server/workspaces";

export const submitCreateWorkspace = createServerFn({ method: "POST" })
	.validator((d: { name: string }) => d)
	.handler(({ data }) => createWorkspace(data.name));

export const submitInvite = createServerFn({ method: "POST" })
	.validator(
		(d: {
			workspaceId: string;
			email: string;
			role: Role;
			acceptUrl: string;
		}) => d,
	)
	.handler(({ data }) => inviteMember(data.workspaceId, data.email, data.role));
