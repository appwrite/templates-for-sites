import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "#/components/icons";
import { useWorkspace } from "#/components/shell/workspace-context";
import {
	Avatar,
	Button,
	Dialog,
	Field,
	Input,
	Menu,
	type MenuItem,
	Select,
	useMenu,
	useToast,
} from "#/components/ui";
import { timeAgo } from "#/features/workspace/format";
import {
	fetchFeatures,
	fetchMembers,
	type MemberRow,
	submitInvite,
	submitLeaveWorkspace,
	submitMemberRole,
	submitRemoveMember,
	submitResendInvite,
	submitTransferOwnership,
} from "#/functions/settings";
import { errorText } from "#/lib/errors";
import type { Role } from "#/lib/types";
import { ConfirmDialog, PanelError, PanelSkeleton, PanelTitle } from "./ui";

const ROLE_LABEL: Record<Role, string> = {
	owner: "Owner",
	admin: "Admin",
	member: "Member",
	guest: "Guest",
};
const INVITE_ROLES: { value: Role; label: string }[] = [
	{ value: "member", label: "Member" },
	{ value: "admin", label: "Admin" },
	{ value: "guest", label: "Guest" },
];

// Guests are an optional feature. Someone who is one already keeps the label.
const rolesFor = (guests: boolean, current: Role) =>
	guests || current === "guest"
		? INVITE_ROLES
		: INVITE_ROLES.filter((r) => r.value !== "guest");

export function MembersPanel() {
	const { workspace, viewer, peers } = useWorkspace();
	const router = useRouter();
	const toast = useToast();
	const [members, setMembers] = useState<MemberRow[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [inviting, setInviting] = useState(false);
	const [leaving, setLeaving] = useState(false);
	const [removing, setRemoving] = useState<MemberRow | null>(null);
	const [transferring, setTransferring] = useState<MemberRow | null>(null);
	const [guests, setGuests] = useState(false);
	const isOwner = workspace.role === "owner";
	const manager = isOwner || workspace.role === "admin";
	const workspaceId = workspace.id;

	const load = useCallback(() => {
		fetchMembers({ data: { workspaceId } })
			.then((rows) => {
				setMembers(rows);
				setError(null);
			})
			.catch((err) => setError(errorText(err)));
	}, [workspaceId]);

	useEffect(load, [load]);

	useEffect(() => {
		fetchFeatures({ data: { workspaceId } })
			.then((f) => setGuests(f.flags.guests))
			.catch(() => undefined);
	}, [workspaceId]);

	const here = useMemo(() => new Set(peers.map((p) => p.userId)), [peers]);
	const acceptUrl = () => `${window.location.origin}/accept`;

	const changeRole = async (member: MemberRow, role: Role) => {
		setMembers(
			(list) =>
				list?.map((m) =>
					m.membershipId === member.membershipId ? { ...m, role } : m,
				) ?? list,
		);
		try {
			await submitMemberRole({
				data: { workspaceId, membershipId: member.membershipId, role },
			});
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
			load();
		}
	};

	const resend = async (member: MemberRow) => {
		try {
			await submitResendInvite({
				data: {
					workspaceId,
					membershipId: member.membershipId,
					acceptUrl: acceptUrl(),
				},
			});
			toast.show(`Sent another invite to ${member.email}.`);
			load();
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
		}
	};

	if (error && !members) return <PanelError message={error} onRetry={load} />;
	if (!members) return <PanelSkeleton />;

	return (
		<>
			<PanelTitle
				title="Members"
				action={
					isOwner ? (
						<Button
							variant="primary"
							className="h-[34px]"
							onClick={() => setInviting(true)}
						>
							Invite people
						</Button>
					) : undefined
				}
			/>
			{!isOwner && (
				<p className="text-sm text-graphite">
					Only the workspace owner can invite people.
				</p>
			)}
			<div className="w-full overflow-x-auto">
				<table className="w-full min-w-[560px] border-collapse">
					<thead>
						<tr className="border-b border-rule text-left text-sm text-graphite">
							<th className="pb-2 font-normal">Person</th>
							<th className="w-[120px] pb-2 font-normal">Role</th>
							<th className="w-[140px] pb-2 font-normal">Last seen</th>
							<th className="w-[60px] pb-2 font-normal" aria-label="Actions" />
						</tr>
					</thead>
					<tbody>
						{members.map((member) => {
							const self = member.userId === viewer.userId;
							const label = member.confirmed
								? member.name || member.email
								: member.email;
							const canEdit =
								manager &&
								!self &&
								member.role !== "owner" &&
								(isOwner || member.role !== "admin");
							const actions: MenuItem[] = [
								...(isOwner &&
								member.confirmed &&
								!self &&
								member.role !== "guest"
									? [
											{
												id: "transfer",
												label: "Make owner",
												onSelect: () => setTransferring(member),
											},
										]
									: []),
								...(canEdit
									? [
											{
												id: "remove",
												label: member.confirmed ? "Remove" : "Cancel invite",
												danger: true,
												onSelect: () => setRemoving(member),
											},
										]
									: []),
								...(self && !isOwner
									? [
											{
												id: "leave",
												label: "Leave workspace",
												danger: true,
												onSelect: () => setLeaving(true),
											},
										]
									: []),
							];
							return (
								<tr key={member.membershipId} className="border-b border-rule">
									<td className="py-2">
										<div className="flex items-center gap-2.5">
											<Avatar id={member.userId} name={label} size={30} />
											<div className="min-w-0">
												<div className="truncate text-base font-medium leading-[18px] text-ink">
													{label}
												</div>
												<div className="truncate text-sm leading-4 text-graphite">
													{member.confirmed
														? member.email
														: `Invited ${timeAgo(member.joinedAt)}`}
												</div>
											</div>
										</div>
									</td>
									<td>
										{canEdit ? (
											<RoleMenu
												value={member.role}
												guests={guests}
												onChange={(role) => changeRole(member, role)}
											/>
										) : (
											<span className="text-base text-graphite">
												{ROLE_LABEL[member.role]}
											</span>
										)}
									</td>
									<td className="text-base text-graphite">
										{!member.confirmed ? (
											isOwner ? (
												<button
													type="button"
													onClick={() => void resend(member)}
													className="text-link hover:underline"
												>
													Resend invite
												</button>
											) : (
												"Invited"
											)
										) : here.has(member.userId) || self ? (
											<span className="text-green">Here now</span>
										) : member.accessedAt ? (
											timeAgo(member.accessedAt)
										) : (
											"Never"
										)}
									</td>
									<td className="text-right">
										{actions.length > 0 && (
											<MemberActions items={actions} name={label} />
										)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			<InviteDialog
				open={inviting}
				onClose={() => setInviting(false)}
				onDone={() => {
					setInviting(false);
					load();
				}}
				workspaceId={workspaceId}
				guests={guests}
			/>
			{removing && (
				<ConfirmDialog
					open
					onClose={() => setRemoving(null)}
					title={`Remove ${removing.name || removing.email}?`}
					description="They lose access to this workspace right away. Pages they wrote stay."
					action="Remove"
					onConfirm={async () => {
						await submitRemoveMember({
							data: { workspaceId, membershipId: removing.membershipId },
						});
						load();
					}}
				/>
			)}
			{transferring && (
				<ConfirmDialog
					open
					onClose={() => setTransferring(null)}
					title={`Make ${transferring.name} the owner?`}
					description="You'll become an admin. Only the new owner can give ownership back."
					action="Make owner"
					onConfirm={async () => {
						await submitTransferOwnership({
							data: { workspaceId, membershipId: transferring.membershipId },
						});
						await router.invalidate();
						load();
					}}
				/>
			)}
			<ConfirmDialog
				open={leaving}
				onClose={() => setLeaving(false)}
				title={`Leave ${workspace.name}?`}
				description="You'll lose access until someone invites you again."
				action="Leave workspace"
				onConfirm={async () => {
					await submitLeaveWorkspace({ data: { workspaceId } });
					window.location.assign("/");
				}}
			/>
		</>
	);
}

function RoleMenu({
	value,
	guests,
	onChange,
}: {
	value: Role;
	guests: boolean;
	onChange: (role: Role) => void;
}) {
	const menu = useMenu();
	return (
		<>
			<button
				ref={menu.anchor}
				type="button"
				aria-haspopup="menu"
				onClick={menu.toggle}
				className="flex items-center gap-1 text-base text-graphite hover:text-ink coarse:min-h-10"
			>
				{ROLE_LABEL[value]}
				<ChevronDown size={12} />
			</button>
			<Menu
				anchor={menu.anchor}
				open={menu.open}
				onClose={menu.close}
				width={140}
				items={rolesFor(guests, value).map((r) => ({
					id: r.value,
					label: r.label,
					hint: r.value === value ? "✓" : undefined,
					onSelect: () => onChange(r.value),
				}))}
			/>
		</>
	);
}

function MemberActions({ items, name }: { items: MenuItem[]; name: string }) {
	const menu = useMenu();
	return (
		<>
			<button
				ref={menu.anchor}
				type="button"
				aria-haspopup="menu"
				aria-label={`More for ${name}`}
				onClick={menu.toggle}
				className="rounded-sm px-1.5 py-0.5 text-graphite hover:bg-wash-2 hover:text-ink coarse:min-h-10 coarse:min-w-10"
			>
				…
			</button>
			<Menu
				anchor={menu.anchor}
				open={menu.open}
				onClose={menu.close}
				items={items}
				align="end"
				width={170}
			/>
		</>
	);
}

function InviteDialog({
	open,
	onClose,
	onDone,
	workspaceId,
	guests,
}: {
	open: boolean;
	onClose: () => void;
	onDone: () => void;
	workspaceId: string;
	guests: boolean;
}) {
	const toast = useToast();
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<Role>("member");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	return (
		<Dialog
			open={open}
			onClose={onClose}
			title="Invite people"
			description="They'll get an email with a link to join."
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={async (e) => {
					e.preventDefault();
					setBusy(true);
					setError(null);
					try {
						await submitInvite({
							data: {
								workspaceId,
								email: email.trim().toLowerCase(),
								role,
								acceptUrl: `${window.location.origin}/accept`,
							},
						});
						toast.show(`Invited ${email}.`);
						setEmail("");
						onDone();
					} catch (err) {
						setError(errorText(err));
					} finally {
						setBusy(false);
					}
				}}
			>
				<Field label="Email" error={error}>
					{(id) => (
						<Input
							id={id}
							type="email"
							autoFocus
							required
							value={email}
							onChange={(e) => setEmail(e.target.value)}
						/>
					)}
				</Field>
				<div className="flex flex-col gap-1.5">
					<span className="text-sm font-medium text-ink">Role</span>
					<Select
						value={role}
						options={rolesFor(guests, role)}
						onChange={setRole}
						label="Role"
					/>
				</div>
				<div className="flex justify-end gap-2">
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" variant="primary" loading={busy}>
						Send invite
					</Button>
				</div>
			</form>
		</Dialog>
	);
}
