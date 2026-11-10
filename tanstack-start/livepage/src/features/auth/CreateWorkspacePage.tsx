import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { submitCreateWorkspace, submitInvite } from "#/functions/workspaces";
import { errorText } from "#/lib/errors";
import {
	AuthFrame,
	authFieldClass,
	Field,
	FormError,
	SubmitButton,
} from "./frame";

const routeApi = getRouteApi("/_app/");

// Board 8A: a signed-in person with no workspace yet.
export function CreateWorkspacePage() {
	const { signup } = routeApi.useLoaderData() as { signup: "invite" | "open" };
	return signup === "open" ? <CreateForm /> : <InviteOnlyNote />;
}

function InviteOnlyNote() {
	return (
		<AuthFrame
			title="No workspace yet."
			intro="This site is invite only, and you aren't in a workspace. Ask a workspace admin to invite you."
		>
			<span />
		</AuthFrame>
	);
}

function CreateForm() {
	const [name, setName] = useState("");
	const [emails, setEmails] = useState<string[]>([]);
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const addDraft = () => {
		const next = draft.trim().replace(/,$/, "");
		if (next && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next))
			setEmails((list) => (list.includes(next) ? list : [...list, next]));
		setDraft("");
	};

	return (
		<AuthFrame title="Start a workspace.">
			<form
				className="flex flex-col gap-4"
				onSubmit={async (e) => {
					e.preventDefault();
					setBusy(true);
					setError(null);
					try {
						const created = await submitCreateWorkspace({ data: { name } });
						for (const email of emails) {
							await submitInvite({
								data: {
									workspaceId: created.id,
									email,
									role: "member",
									acceptUrl: `${window.location.origin}/accept`,
								},
							}).catch(() => undefined);
						}
						window.location.assign(`/w/${created.id}`);
					} catch (err) {
						setError(errorText(err));
						setBusy(false);
					}
				}}
			>
				<div className="flex gap-3">
					<div className="flex shrink-0 flex-col gap-[6px]">
						<div className="text-sm font-medium leading-4 text-ink">Icon</div>
						<div className="flex size-[40px] items-center justify-center rounded-md bg-accent text-[15px] font-semibold text-white">
							{(name.trim()[0] ?? "L").toUpperCase()}
						</div>
					</div>
					<div className="flex grow flex-col gap-[6px]">
						<Field label="Name" htmlFor="workspace-name">
							<input
								id="workspace-name"
								className={authFieldClass}
								required
								maxLength={128}
								value={name}
								onChange={(e) => setName(e.target.value)}
							/>
						</Field>
					</div>
				</div>
				<Field
					label={
						<>
							Invite people{" "}
							<span className="font-normal text-pencil">(optional)</span>
						</>
					}
					htmlFor="workspace-invites"
				>
					<div className="flex h-[80px] flex-wrap content-start gap-[6px] overflow-auto rounded-md border border-rule-strong p-2 focus-within:border-[1.5px] focus-within:border-link">
						{emails.map((email) => (
							<span
								key={email}
								className="flex h-[26px] items-center rounded-sm bg-wash-2 px-2 text-sm leading-4 text-ink"
							>
								{email}
							</span>
						))}
						<input
							id="workspace-invites"
							className="h-[26px] min-w-[140px] flex-1 bg-transparent px-1 text-sm leading-4 text-ink outline-none placeholder:text-pencil"
							placeholder="Add another email"
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							onBlur={addDraft}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === "," || e.key === " ") {
									e.preventDefault();
									addDraft();
								}
							}}
						/>
					</div>
				</Field>
				<FormError message={error} />
				<SubmitButton loading={busy}>Create workspace</SubmitButton>
			</form>
		</AuthFrame>
	);
}
