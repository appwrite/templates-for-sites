import { type Client, Query, Teams } from "node-appwrite";
import { isSetupFeatureOn } from "#/features/settings/server/features";
import type { Member, Role } from "#/lib/types";
import { adminClient, errorCode } from "./appwrite";
import { AuthError, membershipRoles, requireWorkspace, roleFrom } from "./auth";
import { trustedOrigin } from "./settings";

function toMember(m: {
	$id: string;
	userId: string;
	userName: string;
	userEmail: string;
	roles: string[];
	confirm: boolean;
	joined: string;
}): Member {
	return {
		membershipId: m.$id,
		userId: m.userId,
		name: m.userName,
		email: m.userEmail,
		role: roleFrom(m.roles),
		confirmed: m.confirm,
		joinedAt: m.joined,
	};
}

// Read with the site key once the person is confirmed to belong: depending on the project's
// privacy settings, Appwrite otherwise hides everyone else's name and email from a member.
// A guest is only in for single pages, so they get what Appwrite would show them anyway.
export async function listMembers(workspaceId: string): Promise<Member[]> {
	const { client, role } = await requireWorkspace(workspaceId);
	const reader = role === "guest" ? client : adminClient();
	const { memberships } = await new Teams(reader).listMemberships({
		teamId: workspaceId,
		queries: [Query.limit(1000)],
	});
	return memberships.map(toMember);
}

async function requireManager(workspaceId: string) {
	const session = await requireWorkspace(workspaceId, "admin");
	return session;
}

// Sends an invite email. The link is built from the Site's own recorded origin, not from the request.
// Invites go through the person's own session on purpose: with the site key, Appwrite joins the
// user straight away and sends no email. Appwrite only allows a team owner to do that, so admins
// can do everything else here but not send invites.
export async function inviteMember(
	workspaceId: string,
	email: string,
	role: Role,
): Promise<Member> {
	const { client, role: myRole } = await requireManager(workspaceId);
	if (myRole !== "owner")
		throw new AuthError("Only an owner can invite people.", "forbidden");
	if (role === "guest" && !(await isSetupFeatureOn("guests")))
		throw new AuthError("Guests are turned off in Settings.", "forbidden");
	const membership = await new Teams(client).createMembership({
		teamId: workspaceId,
		email: email.trim().toLowerCase(),
		roles: membershipRoles(role),
		url: `${await trustedOrigin()}/accept`,
	});
	return toMember(membership);
}

export async function updateMemberRole(
	workspaceId: string,
	membershipId: string,
	role: Role,
): Promise<Member> {
	const { role: myRole } = await requireManager(workspaceId);
	if (role === "owner" && myRole !== "owner")
		throw new AuthError(
			"Only an owner can make someone else an owner.",
			"forbidden",
		);
	const teams = new Teams(adminClient());
	const current = toMember(
		await teams.getMembership({ teamId: workspaceId, membershipId }),
	);
	if (current.role === "owner") {
		if (myRole !== "owner")
			throw new AuthError(
				"Only an owner can change another owner.",
				"forbidden",
			);
		if (role !== "owner" && (await ownerCount(workspaceId)) < 2)
			throw new Error(
				"A workspace needs an owner. Make someone else the owner first.",
			);
	}
	// With the site key because Appwrite lets only team owners change roles, and admins can too here.
	const membership = await teams.updateMembership({
		teamId: workspaceId,
		membershipId,
		roles: membershipRoles(role),
	});
	return toMember(membership);
}

async function ownerCount(workspaceId: string) {
	const { memberships } = await new Teams(adminClient()).listMemberships({
		teamId: workspaceId,
		queries: [Query.limit(1000)],
	});
	return memberships.filter((m) => m.confirm && m.roles.includes("owner"))
		.length;
}

// Makes someone else the owner and steps the current owner down to admin, in that order.
export async function transferOwnership(
	workspaceId: string,
	membershipId: string,
): Promise<void> {
	const { viewer, role } = await requireManager(workspaceId);
	if (role !== "owner")
		throw new AuthError("Only the owner can hand over ownership.", "forbidden");
	const teams = new Teams(adminClient());
	const target = await teams.getMembership({
		teamId: workspaceId,
		membershipId,
	});
	if (!target.confirm)
		throw new Error("They need to accept their invite first.");
	await teams.updateMembership({
		teamId: workspaceId,
		membershipId,
		roles: membershipRoles("owner"),
	});
	const { memberships } = await teams.listMemberships({
		teamId: workspaceId,
		queries: [Query.equal("userId", [viewer.userId]), Query.limit(1)],
	});
	if (memberships[0])
		await teams.updateMembership({
			teamId: workspaceId,
			membershipId: memberships[0].$id,
			roles: membershipRoles("admin"),
		});
}

// Sends the invite email again. Appwrite does this when the same person is invited twice.
export async function resendInvite(workspaceId: string, membershipId: string) {
	const { client, role } = await requireManager(workspaceId);
	if (role !== "owner")
		throw new AuthError("Only an owner can resend invites.", "forbidden");
	// With the site key: depending on the project's privacy settings, Appwrite hides the address
	// from a session, and there's nothing to resend to.
	const member = await new Teams(adminClient()).getMembership({
		teamId: workspaceId,
		membershipId,
	});
	if (member.confirm) return toMember(member);
	await new Teams(client).createMembership({
		teamId: workspaceId,
		email: member.userEmail,
		roles: member.roles,
		url: `${await trustedOrigin()}/accept`,
	});
	return toMember(member);
}

export async function leaveWorkspace(workspaceId: string) {
	const { client, viewer, role } = await requireWorkspace(workspaceId);
	if (role === "owner" && (await ownerCount(workspaceId)) < 2)
		throw new Error(
			"You're the only owner. Hand over ownership first, or delete the workspace.",
		);
	const teams = new Teams(client);
	const { memberships } = await teams.listMemberships({
		teamId: workspaceId,
		queries: [Query.equal("userId", [viewer.userId]), Query.limit(1)],
	});
	if (memberships[0])
		await new Teams(adminClient()).deleteMembership({
			teamId: workspaceId,
			membershipId: memberships[0].$id,
		});
}

export async function removeMember(
	workspaceId: string,
	membershipId: string,
): Promise<void> {
	const { viewer, role: myRole } = await requireManager(workspaceId);
	const teams = new Teams(adminClient());
	const target = await teams
		.getMembership({ teamId: workspaceId, membershipId })
		.catch(() => null);
	if (target?.roles.includes("owner")) {
		if (myRole !== "owner")
			throw new AuthError("Only an owner can remove an owner.", "forbidden");
		if (target.userId === viewer.userId && (await ownerCount(workspaceId)) < 2)
			throw new Error("You're the only owner. Hand over ownership first.");
	}
	try {
		await teams.deleteMembership({
			teamId: workspaceId,
			membershipId,
		});
	} catch (err) {
		if (errorCode(err) !== 404) throw err;
	}
}

export type { Client };
