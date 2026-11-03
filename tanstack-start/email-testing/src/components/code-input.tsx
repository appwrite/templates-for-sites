import type { Ref } from "react";

// One field for a 6-digit app code, a 10-character recovery code, or either. Keeps only the
// characters that kind of code has, and reports a complete app code so the form can go on its own.
export function CodeInput({
	kind,
	value,
	onChange,
	onComplete,
	id,
	size = "lg",
	invalid = false,
	disabled = false,
	autoFocus = false,
	label,
	inputRef,
}: {
	kind: "totp" | "recovery" | "any";
	value: string;
	onChange: (value: string) => void;
	onComplete?: (code: string) => void;
	id: string;
	size?: "lg" | "md";
	invalid?: boolean;
	disabled?: boolean;
	autoFocus?: boolean;
	label: string;
	inputRef?: Ref<HTMLInputElement>;
}) {
	const max = kind === "totp" ? 6 : 10;
	const clean = (raw: string) => {
		const lower = raw.toLowerCase();
		const kept =
			kind === "totp"
				? lower.replace(/\D/g, "")
				: lower.replace(/[^0-9a-f]/g, "");
		return kept.slice(0, max);
	};
	// App codes are short and read digit by digit; recovery codes need to stay one word.
	const spaced = kind === "totp";
	const sizes =
		size === "lg"
			? spaced
				? "h-14 text-[26px] tracking-[0.32em] pl-[calc(12px+0.32em)]"
				: "h-14 text-[22px] tracking-[0.1em] pl-[calc(12px+0.1em)]"
			: spaced
				? "h-10 text-[17px] tracking-[0.22em] pl-[calc(12px+0.22em)]"
				: "h-10 text-[16px] tracking-[0.08em] pl-[calc(12px+0.08em)]";
	return (
		<input
			ref={inputRef}
			id={id}
			aria-label={label}
			aria-invalid={invalid || undefined}
			className={`input mono text-center tabular-nums ${sizes}`}
			value={value}
			disabled={disabled}
			// biome-ignore lint/a11y/noAutofocus: the code step has nothing else to type into
			autoFocus={autoFocus}
			inputMode={kind === "totp" ? "numeric" : "text"}
			autoComplete={kind === "totp" ? "one-time-code" : "off"}
			autoCapitalize="none"
			autoCorrect="off"
			spellCheck={false}
			placeholder={kind === "recovery" ? "a1b2c3d4e5" : "000000"}
			maxLength={max + 4}
			onChange={(e) => {
				const next = clean(e.target.value);
				onChange(next);
				if (kind === "totp" && next.length === 6 && value.length !== 6)
					onComplete?.(next);
			}}
		/>
	);
}
