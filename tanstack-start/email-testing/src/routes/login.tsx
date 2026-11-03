import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AuthFrame } from "#/components/auth-frame";
import { SignInForm } from "#/components/sign-in-form";
import { fetchLoginState, submitSignOut } from "#/functions/session";

export const Route = createFileRoute("/login")({
	loader: async () => {
		const state = await fetchLoginState();
		if (state.status === "member")
			throw redirect({ to: state.setupComplete ? "/inbox" : "/setup" });
		return state;
	},
	head: () => ({ meta: [{ title: "Sign in · Catchall" }] }),
	component: LoginPage,
});

function LoginPage() {
	const state = Route.useLoaderData();
	const navigate = useNavigate();
	const [host, setHost] = useState("");
	useEffect(() => setHost(window.location.host), []);

	if (state.status === "no-team") {
		return (
			<AuthFrame
				title="No access yet"
				intro={`You're signed in as ${state.email}, but you're not a member of this inbox. Ask an admin for an invite.`}
				host={host}
			>
				<button
					type="button"
					className="btn btn-lg w-full"
					onClick={async () => {
						await submitSignOut();
						window.location.reload();
					}}
				>
					Sign out
				</button>
			</AuthFrame>
		);
	}

	return (
		<AuthFrame
			title="Sign in"
			intro="Your team's test inbox. Ask an admin for an invite if you don't have an account yet."
			host={host}
		>
			<SignInForm
				onSignedIn={async (result) => {
					await navigate({ to: result.setupComplete ? "/inbox" : "/setup" });
				}}
			/>
		</AuthFrame>
	);
}
