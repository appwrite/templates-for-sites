import { useState } from "react";
import { Icon } from "./icons";

export function useCopy() {
	const [copied, setCopied] = useState<string | null>(null);
	const copy = async (value: string, key = value) => {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(key);
			setTimeout(
				() => setCopied((current) => (current === key ? null : current)),
				1500,
			);
		} catch {
			// Clipboard blocked: nothing to do.
		}
	};
	return { copied, copy };
}

export function CopyButton({
	value,
	label,
	className = "",
	size = 14,
}: {
	value: string;
	label?: string;
	className?: string;
	size?: number;
}) {
	const { copied, copy } = useCopy();
	return (
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				e.preventDefault();
				copy(value);
			}}
			className={`inline-flex items-center gap-1.5 text-graphite hover:text-ink ${className}`}
			aria-label={label ? undefined : "Copy"}
			title="Copy"
		>
			{label ? <span>{copied ? "Copied" : label}</span> : null}
			<Icon name={copied ? "check" : "copy"} size={size} />
		</button>
	);
}
