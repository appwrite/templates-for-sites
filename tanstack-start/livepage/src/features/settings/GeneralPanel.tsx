import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "#/components/shell/workspace-context";
import { Button, Field, Input, useToast } from "#/components/ui";
import { WorkspaceMark } from "#/features/workspace/WorkspaceSwitcher";
import {
	fetchFeatures,
	submitDeleteWorkspaceStep,
	submitGeneral,
	submitSignup,
	submitWorkspaceIcon,
} from "#/functions/settings";
import { errorText } from "#/lib/errors";
import { ConfirmDialog, DangerButton, PanelTitle, TextLink } from "./ui";

export function GeneralPanel() {
	const { workspace, workspaces } = useWorkspace();
	const router = useRouter();
	const toast = useToast();
	const manager = workspace.role === "owner" || workspace.role === "admin";
	const [name, setName] = useState(workspace.name);
	const [saving, setSaving] = useState(false);
	const savingRef = useRef(false);
	const [uploading, setUploading] = useState(false);
	const [signup, setSignup] = useState<"invite" | "open" | null>(null);
	const [canChangeSignup, setCanChangeSignup] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [progress, setProgress] = useState<string | null>(null);
	const fileRef = useRef<HTMLInputElement>(null);

	useEffect(() => setName(workspace.name), [workspace.name]);

	useEffect(() => {
		fetchFeatures({ data: { workspaceId: workspace.id } })
			.then((f) => {
				setSignup(f.signup === "open" ? "open" : "invite");
				setCanChangeSignup(f.canChange);
			})
			.catch(() => setSignup(null));
	}, [workspace.id]);

	const save = async () => {
		const trimmed = name.trim();
		if (!trimmed) {
			setName(workspace.name);
			toast.show("Give the workspace a name.", { tone: "error" });
			return;
		}
		if (trimmed === workspace.name || savingRef.current) return;
		savingRef.current = true;
		setSaving(true);
		try {
			await submitGeneral({
				data: { workspaceId: workspace.id, name: trimmed },
			});
			await router.invalidate();
			toast.show("Saved.");
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
		} finally {
			savingRef.current = false;
			setSaving(false);
		}
	};

	const uploadIcon = async (file: File) => {
		setUploading(true);
		try {
			const form = new FormData();
			form.set("file", file);
			form.set("workspaceId", workspace.id);
			await submitWorkspaceIcon({ data: form });
			await router.invalidate();
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
		} finally {
			setUploading(false);
		}
	};

	const removeIcon = async () => {
		try {
			await submitGeneral({ data: { workspaceId: workspace.id, icon: null } });
			await router.invalidate();
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
		}
	};

	const changeSignup = async (next: "invite" | "open") => {
		const before = signup;
		setSignup(next);
		try {
			await submitSignup({ data: { signup: next } });
		} catch (err) {
			setSignup(before);
			toast.show(errorText(err), { tone: "error" });
		}
	};

	const deleteWorkspace = async () => {
		let cursor: string | undefined;
		let steps = 0;
		for (;;) {
			const step = await submitDeleteWorkspaceStep({
				data: { workspaceId: workspace.id, cursor },
			});
			if (step.done) break;
			cursor = step.cursor;
			steps++;
			setProgress(`Deleting, step ${steps}`);
		}
		const next = workspaces.find((w) => w.id !== workspace.id);
		window.location.assign(next ? `/w/${next.id}` : "/");
	};

	return (
		<>
			<PanelTitle title="General" />
			<div className="flex w-full max-w-[480px] flex-col gap-[22px]">
				<Field label="Name">
					{(id) => (
						<Input
							id={id}
							value={name}
							disabled={!manager}
							onChange={(e) => setName(e.target.value)}
							onBlur={save}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									void save();
								}
							}}
							maxLength={128}
							className="h-[40px] text-base"
						/>
					)}
				</Field>
				<div className="flex flex-col gap-[6px]">
					<span className="text-sm font-medium text-ink">Icon</span>
					<div className="flex items-center gap-[14px]">
						<WorkspaceMark workspace={workspace} size={44} />
						{manager && (
							<>
								<TextLink
									disabled={uploading}
									onClick={() => fileRef.current?.click()}
								>
									{uploading ? "Uploading" : "Upload"}
								</TextLink>
								{workspace.icon && (
									<button
										type="button"
										onClick={removeIcon}
										className="text-sm text-graphite hover:text-ink"
									>
										Remove
									</button>
								)}
								<input
									ref={fileRef}
									type="file"
									accept="image/*"
									hidden
									aria-label="Upload an icon"
									onChange={(e) => {
										const file = e.target.files?.[0];
										if (file) void uploadIcon(file);
										e.target.value = "";
									}}
								/>
							</>
						)}
					</div>
				</div>
				{signup && canChangeSignup && (
					<fieldset className="flex flex-col gap-1.5">
						<legend className="mb-1.5 text-sm font-medium text-ink">
							Who can join
						</legend>
						{(
							[
								["invite", "Only people you invite"],
								["open", "Anyone who signs up"],
							] as const
						).map(([value, label]) => (
							<label
								key={value}
								className={`flex h-[40px] cursor-pointer items-center gap-2.5 rounded-md px-3 text-base ${signup === value ? "bg-link-soft font-medium text-link" : "text-ink"}`}
							>
								<input
									type="radio"
									name="signup"
									checked={signup === value}
									onChange={() => void changeSignup(value)}
									className="accent-[var(--color-link)]"
								/>
								{label}
							</label>
						))}
					</fieldset>
				)}
				{manager && name.trim() !== workspace.name && (
					<div>
						<Button variant="primary" loading={saving} onClick={save}>
							Save
						</Button>
					</div>
				)}
			</div>
			{workspace.role === "owner" && (
				<div className="flex w-full max-w-[620px] items-center justify-between gap-6 border-t border-rule pt-[18px]">
					<div>
						<div className="text-base font-medium text-coral">
							Delete workspace
						</div>
						<div className="text-sm text-graphite">
							{progress ??
								"Removes every page and database for everyone. This can't be undone."}
						</div>
					</div>
					<DangerButton onClick={() => setDeleting(true)}>Delete</DangerButton>
				</div>
			)}
			<ConfirmDialog
				open={deleting}
				onClose={() => setDeleting(false)}
				title={`Delete ${workspace.name}?`}
				description="Every page, database, comment and file goes, for everyone. There's no way back."
				phrase={workspace.name}
				phraseLabel={`Type "${workspace.name}" to confirm`}
				action="Delete workspace"
				onConfirm={deleteWorkspace}
			/>
		</>
	);
}
