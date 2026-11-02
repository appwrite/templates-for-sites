import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { AuthFrame, FormError } from "#/components/auth-frame";
import { Spinner } from "#/components/icons";
import { submitAcceptInvite } from "#/functions/session";

type Search = {
	teamId?: string;
	membershipId?: string;
	userId?: string;
	secret?: string;
};

const str = (value: unknown) => (typeof value === "string" ? value : undefined);

export const Route = createFileRoute("/accept")({
	validateSearch: (search: Record<string, unknown>): Search => ({
		teamId: str(search.teamId),
		membershipId: str(search.membershipId),
		userId: str(search.userId),
		secret: str(search.secret),
	}),
	head: () => ({ meta: [{ title: "Join · Catchall" }] }),
	component: AcceptPage,
});

function AcceptPage() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const complete =
		search.teamId && search.membershipId && search.userId && search.secret;

	if (!complete) {
		return (
			<AuthFrame
				title="This invite link is incomplete"
				intro="Open the link from the invite email again, or ask an admin for a new invite."
			/>
		);
	}

	const submit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const form = new FormData(e.currentTarget);
		setBusy(true);
		setError(null);
		try {
			await submitAcceptInvite({
				data: {
					teamId: search.teamId as string,
					membershipId: search.membershipId as string,
					userId: search.userId as string,
					secret: search.secret as string,
					name: String(form.get("name") || ""),
					password: String(form.get("password") || ""),
				},
			});
			await navigate({ to: "/inbox" });
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setBusy(false);
		}
	};

	return (
		<AuthFrame
			title="Join the inbox"
			intro="Set your name and a password. You'll use them to sign in from now on."
		>
			<form className="space-y-4" onSubmit={submit}>
				<div>
					<label className="label" htmlFor="name">
						Name
					</label>
					<input
						className="input"
						id="name"
						name="name"
						autoComplete="name"
						maxLength={128}
					/>
				</div>
				<div>
					<label className="label" htmlFor="password">
						Password
					</label>
					<input
						className="input"
						id="password"
						name="password"
						type="password"
						autoComplete="new-password"
						minLength={8}
						required
					/>
					<p className="mt-1.5 text-[13px] text-pencil">
						At least 8 characters.
					</p>
				</div>
				<FormError>{error}</FormError>
				<button
					className="btn btn-primary btn-lg w-full"
					type="submit"
					disabled={busy}
				>
					{busy ? <Spinner size={15} /> : null} Join and open the inbox
				</button>
			</form>
		</AuthFrame>
	);
}
