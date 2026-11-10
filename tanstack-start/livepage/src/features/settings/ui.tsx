// Pieces every settings panel shares.
import { type ReactNode, useState } from "react";
import { Button, Dialog, Input, Skeleton } from "#/components/ui";

export function PanelTitle({
	title,
	subtitle,
	action,
}: {
	title: string;
	subtitle?: string;
	action?: ReactNode;
}) {
	return (
		<header className="flex items-start justify-between gap-4">
			<div>
				<h1 className="font-serif text-[32px] font-medium leading-[38px] tracking-[-0.02em] text-ink">
					{title}
				</h1>
				{subtitle && (
					<p className="mt-1.5 text-base leading-5 text-graphite">{subtitle}</p>
				)}
			</div>
			{action}
		</header>
	);
}

export function PanelSkeleton() {
	return (
		<div className="flex flex-col gap-3" aria-busy="true">
			<Skeleton className="h-9 w-40" />
			<Skeleton className="h-12" />
			<Skeleton className="h-12" />
			<Skeleton className="h-12" />
		</div>
	);
}

export function PanelError({
	message,
	onRetry,
}: {
	message: string;
	onRetry?: () => void;
}) {
	return (
		<div className="flex flex-col items-start gap-2">
			<p className="text-sm text-coral">{message}</p>
			{onRetry && <Button onClick={onRetry}>Try again</Button>}
		</div>
	);
}

export function Group({
	title,
	action,
	children,
}: {
	title: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="w-full max-w-[720px]">
			<div className="flex items-baseline justify-between border-b border-rule pb-2">
				<h2 className="text-base font-semibold text-ink">{title}</h2>
				{action}
			</div>
			{children}
		</section>
	);
}

export function Row({
	title,
	detail,
	children,
}: {
	title: ReactNode;
	detail?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div className="flex min-h-[59px] flex-wrap items-center gap-x-6 gap-y-2 border-b border-rule py-2.5">
			<div className="min-w-0 flex-1 basis-[260px]">
				<div className="flex items-center gap-2 text-base font-medium text-ink">
					{title}
				</div>
				{detail && (
					<div className="mt-0.5 text-sm leading-[18px] text-graphite">
						{detail}
					</div>
				)}
			</div>
			{children}
		</div>
	);
}

export function TextLink({
	children,
	onClick,
	danger,
	disabled,
}: {
	children: ReactNode;
	onClick: () => void;
	danger?: boolean;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`text-sm hover:underline disabled:opacity-50 ${danger ? "text-coral" : "text-link"}`}
		>
			{children}
		</button>
	);
}

export function DangerButton({
	children,
	onClick,
}: {
	children: ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="inline-flex h-[30px] items-center justify-center rounded-md border border-coral px-3 text-sm font-medium text-coral hover:bg-wash"
		>
			{children}
		</button>
	);
}

export function Tag({ on, children }: { on: boolean; children: ReactNode }) {
	return (
		<span
			className={`rounded-sm px-1.5 py-px text-xs font-medium ${on ? "bg-green/10 text-green" : "bg-wash-2 text-graphite"}`}
		>
			{children}
		</span>
	);
}

// Something that can't be undone: the person types a word to confirm.
export function ConfirmDialog({
	open,
	onClose,
	title,
	description,
	phrase,
	phraseLabel,
	action,
	onConfirm,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	description: ReactNode;
	phrase?: string;
	phraseLabel?: string;
	action: string;
	onConfirm: () => Promise<unknown>;
}) {
	const [typed, setTyped] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const ready = !phrase || typed.trim() === phrase;
	return (
		<Dialog
			open={open}
			onClose={onClose}
			title={title}
			description={description}
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={async (e) => {
					e.preventDefault();
					if (!ready) return;
					setBusy(true);
					setError(null);
					try {
						await onConfirm();
						setTyped("");
						onClose();
					} catch (err) {
						setError(
							err instanceof Error
								? err.message
								: "That didn't work. Try again.",
						);
					} finally {
						setBusy(false);
					}
				}}
			>
				{phrase && (
					<label
						htmlFor="confirm-phrase"
						className="flex flex-col gap-1.5 text-sm font-medium text-ink"
					>
						{phraseLabel ?? `Type ${phrase} to confirm`}
						<Input
							id="confirm-phrase"
							autoFocus
							value={typed}
							onChange={(e) => setTyped(e.target.value)}
						/>
					</label>
				)}
				{error && (
					<p role="alert" className="text-sm text-coral">
						{error}
					</p>
				)}
				<div className="flex justify-end gap-2">
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button
						type="submit"
						variant="danger"
						loading={busy}
						disabled={!ready}
					>
						{action}
					</Button>
				</div>
			</form>
		</Dialog>
	);
}
