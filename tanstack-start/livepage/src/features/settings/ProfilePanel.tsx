import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "#/components/shell/workspace-context";
import {
	Avatar,
	Button,
	Dialog,
	Field,
	Input,
	useToast,
} from "#/components/ui";
import { timeAgo } from "#/features/workspace/format";
import { submitSignOut } from "#/functions/session";
import {
	fetchProfile,
	submitAvatar,
	submitDeleteAccount,
	submitEmail,
	submitName,
	submitPassword,
	submitRemoveAvatar,
} from "#/functions/settings";
import { errorText } from "#/lib/errors";
import { applyTheme, readTheme, type Theme } from "#/lib/theme";
import {
	ConfirmDialog,
	DangerButton,
	PanelError,
	PanelSkeleton,
	PanelTitle,
	TextLink,
} from "./ui";

type Profile = Awaited<ReturnType<typeof fetchProfile>>;

const THEMES: { value: Theme; label: string }[] = [
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
	{ value: "system", label: "Match system" },
];

export function ProfilePanel() {
	const { viewer } = useWorkspace();
	const router = useRouter();
	const toast = useToast();
	const [profile, setProfile] = useState<Profile | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [theme, setTheme] = useState<Theme>("system");
	const [changing, setChanging] = useState<"email" | "password" | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [leaving, setLeaving] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	const load = useCallback(() => {
		fetchProfile()
			.then((next) => {
				setProfile(next);
				setName(next.name);
				setError(null);
			})
			.catch((err) => setError(errorText(err)));
	}, []);

	useEffect(load, [load]);
	useEffect(() => setTheme(readTheme()), []);

	if (error && !profile) return <PanelError message={error} onRetry={load} />;
	if (!profile) return <PanelSkeleton />;

	const saveName = async () => {
		const next = name.trim();
		if (!next || next === profile.name) return;
		try {
			await submitName({ data: { name: next } });
			setProfile({ ...profile, name: next });
			await router.invalidate();
			toast.show("Saved.");
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
		}
	};

	const upload = async (file: File) => {
		setUploading(true);
		try {
			const form = new FormData();
			form.set("file", file);
			const avatar = await submitAvatar({ data: form });
			setProfile({ ...profile, avatar });
			window.dispatchEvent(new CustomEvent("livepage:avatars"));
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
		} finally {
			setUploading(false);
		}
	};

	const removePhoto = async () => {
		try {
			await submitRemoveAvatar();
			setProfile({ ...profile, avatar: null });
			window.dispatchEvent(new CustomEvent("livepage:avatars"));
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
		}
	};

	const signOut = async () => {
		setLeaving(true);
		try {
			await submitSignOut();
			window.location.assign("/login");
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
			setLeaving(false);
		}
	};

	return (
		<>
			<PanelTitle title="Profile" />
			<div className="flex w-full max-w-[480px] flex-col gap-[22px]">
				<div className="flex flex-col gap-[6px]">
					<span className="text-sm font-medium text-ink">Photo</span>
					<div className="flex items-center gap-[14px]">
						{profile.avatar ? (
							<img
								src={`/api/files/${profile.avatar}`}
								alt=""
								className="size-12 rounded-full object-cover"
							/>
						) : (
							<Avatar id={viewer.userId} name={profile.name} size={48} />
						)}
						<TextLink
							disabled={uploading}
							onClick={() => fileRef.current?.click()}
						>
							{uploading ? "Uploading" : "Upload"}
						</TextLink>
						{profile.avatar && (
							<button
								type="button"
								onClick={removePhoto}
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
							aria-label="Upload a photo"
							onChange={(e) => {
								const file = e.target.files?.[0];
								if (file) void upload(file);
								e.target.value = "";
							}}
						/>
					</div>
				</div>
				<Field label="Name">
					{(id) => (
						<Input
							id={id}
							value={name}
							onChange={(e) => setName(e.target.value)}
							onBlur={saveName}
							onKeyDown={(e) => e.key === "Enter" && void saveName()}
							maxLength={128}
							className="h-[40px] text-base"
						/>
					)}
				</Field>
				<ValueRow
					label="Email"
					value={profile.email}
					onChange={() => setChanging("email")}
				/>
				<ValueRow
					label="Password"
					value={
						profile.passwordUpdatedAt
							? `Changed ${timeAgo(profile.passwordUpdatedAt)}`
							: "Set"
					}
					muted
					onChange={() => setChanging("password")}
				/>
				<div className="flex flex-col gap-[6px]">
					<span className="text-sm font-medium text-ink">Theme</span>
					<fieldset className="flex gap-1" aria-label="Theme">
						{THEMES.map((option) => (
							<button
								key={option.value}
								type="button"
								aria-pressed={theme === option.value}
								onClick={() => {
									setTheme(option.value);
									applyTheme(option.value);
								}}
								className={`h-8 rounded-md px-3 text-base ${theme === option.value ? "bg-link-soft font-medium text-link" : "text-graphite hover:bg-wash-2"}`}
							>
								{option.label}
							</button>
						))}
					</fieldset>
				</div>
			</div>
			<div className="flex w-full max-w-[620px] items-center justify-between gap-6 border-t border-rule pt-[18px]">
				<div>
					<div className="text-base font-medium text-ink">Sign out</div>
					<div className="text-sm text-graphite">
						Signs you out on this device.
					</div>
				</div>
				<Button loading={leaving} onClick={signOut}>
					Sign out
				</Button>
			</div>
			<div className="flex w-full max-w-[620px] items-center justify-between gap-6 border-t border-rule pt-[18px]">
				<div>
					<div className="text-base font-medium text-coral">Delete account</div>
					<div className="text-sm text-graphite">
						Removes your account and signs you out everywhere. This can't be
						undone.
					</div>
				</div>
				<DangerButton onClick={() => setDeleting(true)}>Delete</DangerButton>
			</div>
			<ChangeDialog
				kind={changing}
				onClose={() => setChanging(null)}
				onDone={(email) => {
					setChanging(null);
					if (email) {
						setProfile({ ...profile, email });
						void router.invalidate();
					} else load();
					toast.show("Saved.");
				}}
			/>
			<ConfirmDialog
				open={deleting}
				onClose={() => setDeleting(false)}
				title="Delete your account?"
				description="If you own a workspace, hand it to someone else or delete it first."
				phrase={profile.email}
				phraseLabel={`Type ${profile.email} to confirm`}
				action="Delete account"
				onConfirm={async () => {
					await submitDeleteAccount({ data: { confirmation: profile.email } });
					window.location.assign("/login");
				}}
			/>
		</>
	);
}

function ValueRow({
	label,
	value,
	muted,
	onChange,
}: {
	label: string;
	value: string;
	muted?: boolean;
	onChange: () => void;
}) {
	return (
		<div className="flex flex-col gap-[6px]">
			<span className="text-sm font-medium text-ink">{label}</span>
			<div className="flex h-[40px] items-center justify-between rounded-md border border-rule-strong px-3 text-base">
				<span className={`truncate ${muted ? "text-graphite" : "text-ink"}`}>
					{value}
				</span>
				<button
					type="button"
					onClick={onChange}
					aria-label={`Change ${label.toLowerCase()}`}
					className="text-sm text-link hover:underline"
				>
					Change
				</button>
			</div>
		</div>
	);
}

function ChangeDialog({
	kind,
	onClose,
	onDone,
}: {
	kind: "email" | "password" | null;
	onClose: () => void;
	onDone: (email?: string) => void;
}) {
	const [value, setValue] = useState("");
	const [password, setPassword] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		if (kind) {
			setValue("");
			setPassword("");
			setError(null);
		}
	}, [kind]);
	if (!kind) return null;
	const isEmail = kind === "email";
	return (
		<Dialog
			open
			onClose={onClose}
			title={isEmail ? "Change email" : "Change password"}
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={async (e) => {
					e.preventDefault();
					setBusy(true);
					setError(null);
					try {
						if (isEmail)
							await submitEmail({ data: { email: value, password } });
						else
							await submitPassword({
								data: { password: value, oldPassword: password },
							});
						onDone(isEmail ? value.trim().toLowerCase() : undefined);
					} catch (err) {
						setError(errorText(err));
					} finally {
						setBusy(false);
					}
				}}
			>
				<Field label={isEmail ? "New email" : "New password"}>
					{(id) => (
						<Input
							id={id}
							autoFocus
							type={isEmail ? "email" : "password"}
							autoComplete={isEmail ? "email" : "new-password"}
							required
							minLength={isEmail ? undefined : 8}
							value={value}
							onChange={(e) => setValue(e.target.value)}
						/>
					)}
				</Field>
				<Field label="Current password" error={error}>
					{(id) => (
						<Input
							id={id}
							type="password"
							autoComplete="current-password"
							required
							value={password}
							onChange={(e) => setPassword(e.target.value)}
						/>
					)}
				</Field>
				<div className="flex justify-end gap-2">
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" variant="primary" loading={busy}>
						Save
					</Button>
				</div>
			</form>
		</Dialog>
	);
}
