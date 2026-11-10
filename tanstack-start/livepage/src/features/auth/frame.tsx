// Layout and inputs shared by every sign-in page, from the Access and states boards.
import { useHydrated } from "@tanstack/react-router";
import { type ReactNode, type Ref, useRef } from "react";

export const authFieldClass =
	"h-[40px] w-full rounded-md border border-rule-strong bg-paper px-3 text-[15px] leading-[18px] text-ink placeholder:text-pencil hover:border-pencil focus:border-[1.5px] focus:border-link focus:outline-none disabled:opacity-50";

export function AuthFrame({
	title,
	intro,
	children,
}: {
	title: ReactNode;
	intro?: ReactNode;
	children: ReactNode;
}) {
	return (
		<main className="flex min-h-dvh items-center justify-center bg-paper px-6 py-12 antialiased">
			<div className="flex w-full max-w-[380px] flex-col gap-4">
				<div className="flex flex-col gap-2">
					<h1 className="font-serif text-[44px] font-medium leading-[50px] tracking-[-0.02em] text-ink">
						{title}
					</h1>
					{intro ? (
						<div className="text-[15px] leading-[22px] text-graphite">
							{intro}
						</div>
					) : null}
				</div>
				{children}
			</div>
		</main>
	);
}

export function Field({
	label,
	htmlFor,
	aside,
	hint,
	children,
}: {
	label: ReactNode;
	htmlFor: string;
	aside?: ReactNode;
	hint?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-[6px]">
			<div className="flex">
				<label
					htmlFor={htmlFor}
					className="grow basis-0 text-sm font-medium leading-4 text-ink"
				>
					{label}
				</label>
				{aside}
			</div>
			{children}
			{hint ? (
				<div className="text-sm leading-4 text-pencil">{hint}</div>
			) : null}
		</div>
	);
}

export function SubmitButton({
	children,
	loading,
	disabled,
	onClick,
	type = "submit",
	variant = "primary",
}: {
	children: ReactNode;
	loading?: boolean;
	disabled?: boolean;
	onClick?: () => void;
	type?: "submit" | "button";
	variant?: "primary" | "secondary";
}) {
	// Until React takes over, a disabled submit button stops the browser posting the form itself.
	const hydrated = useHydrated();
	const tone =
		variant === "primary"
			? "bg-ink text-paper hover:opacity-90"
			: "border border-rule-strong bg-paper text-ink hover:bg-wash";
	return (
		<button
			type={type}
			disabled={disabled || loading || (type === "submit" && !hydrated)}
			onClick={onClick}
			className={`flex h-[40px] w-full shrink-0 items-center justify-center gap-2 rounded-md text-base font-medium leading-[18px] disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
		>
			{loading ? (
				<span className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
			) : null}
			{children}
		</button>
	);
}

export function FormError({ message }: { message: string | null | undefined }) {
	if (!message) return null;
	return (
		<p className="text-sm leading-[19px] text-coral" role="alert">
			{message}
		</p>
	);
}

export function Note({ children }: { children: ReactNode }) {
	return <div className="text-sm leading-4 text-graphite">{children}</div>;
}

// Six boxes, one digit each, from board 84. Types, pastes and backspaces like one field.
export function CodeBoxes({
	value,
	onChange,
	onComplete,
	invalid,
	disabled,
	size = "lg",
	inputRef,
	autoFocus,
	label,
}: {
	value: string;
	onChange: (value: string) => void;
	onComplete?: (code: string) => void;
	invalid?: boolean;
	disabled?: boolean;
	size?: "lg" | "md";
	inputRef?: Ref<HTMLInputElement>;
	autoFocus?: boolean;
	label: string;
}) {
	const ref = useRef<HTMLInputElement | null>(null);
	const box = size === "lg" ? "h-[56px] text-[22px]" : "h-12 text-[18px]";
	const cells = Array.from({ length: 6 }, (_, i) => value[i] ?? "");
	return (
		<div className="relative">
			<input
				ref={(node) => {
					ref.current = node;
					if (typeof inputRef === "function") inputRef(node);
				}}
				aria-label={label}
				aria-invalid={invalid || undefined}
				className="absolute inset-0 z-10 cursor-text opacity-0"
				inputMode="numeric"
				autoComplete="one-time-code"
				// biome-ignore lint/a11y/noAutofocus: the code step has nothing else to type into
				autoFocus={autoFocus}
				disabled={disabled}
				maxLength={6}
				value={value}
				onChange={(e) => {
					const next = e.target.value.replace(/\D/g, "").slice(0, 6);
					onChange(next);
					if (next.length === 6 && value.length !== 6) onComplete?.(next);
				}}
			/>
			<div
				className={`flex ${size === "lg" ? "gap-2" : "gap-[6px]"}`}
				aria-hidden="true"
			>
				{cells.map((digit, i) => {
					const active = i === Math.min(value.length, 5) && !disabled;
					return (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed six boxes
							key={i}
							className={`flex grow basis-0 items-center justify-center rounded-md border font-mono text-ink ${box} ${
								invalid
									? "border-coral"
									: active
										? "border-link"
										: "border-rule-strong"
							}`}
						>
							{digit}
						</div>
					);
				})}
			</div>
		</div>
	);
}
