import { useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { submitVerifyEmail } from "#/functions/auth";
import { errorText } from "#/lib/errors";
import { AuthFrame } from "./frame";

export function VerifyPage() {
	const { userId, secret } = useSearch({ strict: false }) as {
		userId?: string;
		secret?: string;
	};
	const [state, setState] = useState<"working" | "done" | string>("working");

	// The link's secret works once, so only one request may go out.
	const started = useRef(false);
	useEffect(() => {
		if (started.current) return;
		started.current = true;
		if (!userId || !secret) {
			setState("This link is incomplete. Open it from your email again.");
			return;
		}
		submitVerifyEmail({ data: { userId, secret } }).then(
			() => setState("done"),
			(err) => setState(errorText(err)),
		);
	}, [userId, secret]);

	if (state === "working")
		return (
			<AuthFrame title="Checking your link." intro="This only takes a moment.">
				<span />
			</AuthFrame>
		);
	if (state === "done")
		return (
			<AuthFrame
				title="Email confirmed."
				intro="Thanks. You can get back to work."
			>
				<a href="/" className="text-sm leading-4 text-link hover:underline">
					Open Livepage
				</a>
			</AuthFrame>
		);
	return (
		<AuthFrame title="This link didn't work." intro={state}>
			<a href="/login" className="text-sm leading-4 text-link hover:underline">
				Back to sign in
			</a>
		</AuthFrame>
	);
}
