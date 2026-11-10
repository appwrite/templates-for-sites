import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { Avatar } from "#/components/ui";
import { submitAcceptInvite } from "#/functions/auth";
import { errorText } from "#/lib/errors";
import {
	AuthFrame,
	authFieldClass,
	Field,
	FormError,
	Note,
	SubmitButton,
} from "./frame";

const routeApi = getRouteApi("/accept");

export function AcceptPage() {
	const { params, invite } = routeApi.useLoaderData();
	const [name, setName] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	if (!params) {
		return (
			<AuthFrame
				title="This invite link is incomplete."
				intro="Open the link from the invite email again, or ask an admin for a new invite."
			>
				<span />
			</AuthFrame>
		);
	}
	if (!invite) {
		return (
			<AuthFrame
				title="This invite doesn't work anymore."
				intro="It may have expired or been cancelled. Ask an admin for a new invite."
			>
				<a
					href="/login"
					className="text-sm leading-4 text-link hover:underline"
				>
					Go to sign in
				</a>
			</AuthFrame>
		);
	}

	const heading = invite.inviterName
		? `${invite.inviterName} invited you to ${invite.workspaceName}.`
		: `You're invited to ${invite.workspaceName}.`;
	const others =
		invite.others.length > 0
			? `${invite.others.map((o) => firstName(o.name)).join(", ")}${
					invite.othersCount > 0
						? ` and ${invite.othersCount} ${invite.othersCount === 1 ? "other" : "others"}`
						: ""
				} ${invite.others.length === 1 && invite.othersCount === 0 ? "is" : "are"} here.`
			: null;

	return (
		<AuthFrame title={heading}>
			{invite.others.length ? (
				<div className="flex items-center gap-[10px]">
					<div className="flex items-center gap-1">
						{invite.others.map((other) => (
							<Avatar
								key={other.name}
								id={other.name}
								name={other.name}
								size={26}
							/>
						))}
					</div>
					<div className="text-base leading-[20px] text-graphite">{others}</div>
				</div>
			) : null}
			<form
				className="flex flex-col gap-4"
				onSubmit={async (e) => {
					e.preventDefault();
					setBusy(true);
					setError(null);
					try {
						await submitAcceptInvite({
							data: {
								...params,
								name: invite.needsPassword ? name : "",
								password: invite.needsPassword ? password : "",
							},
						});
						window.location.assign(`/w/${params.teamId}`);
					} catch (err) {
						setError(errorText(err));
						setBusy(false);
					}
				}}
			>
				{invite.needsPassword ? (
					<>
						<Field label="Your name" htmlFor="accept-name">
							<input
								id="accept-name"
								className={authFieldClass}
								required
								autoComplete="name"
								maxLength={128}
								value={name}
								onChange={(e) => setName(e.target.value)}
							/>
						</Field>
						<Field
							label="Create a password"
							htmlFor="accept-password"
							hint="At least 8 characters."
						>
							<input
								id="accept-password"
								className={authFieldClass}
								type="password"
								required
								minLength={8}
								autoComplete="new-password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
							/>
						</Field>
					</>
				) : null}
				<FormError message={error} />
				<SubmitButton loading={busy}>Join {invite.workspaceName}</SubmitButton>
				<Note>This invite is for {invite.email}.</Note>
			</form>
		</AuthFrame>
	);
}

function firstName(name: string) {
	return name.trim().split(/\s+/)[0] || name;
}
