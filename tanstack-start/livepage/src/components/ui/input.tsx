import {
	type InputHTMLAttributes,
	type ReactNode,
	type TextareaHTMLAttributes,
	useId,
} from "react";

const BASE =
	"w-full rounded-md border border-rule-strong bg-paper px-2.5 text-sm text-ink placeholder:text-pencil hover:border-pencil focus:border-link focus:outline-none disabled:opacity-50";

export function Input({
	className = "",
	...rest
}: InputHTMLAttributes<HTMLInputElement>) {
	return (
		<input className={`h-[34px] coarse:h-11 ${BASE} ${className}`} {...rest} />
	);
}

export function Textarea({
	className = "",
	...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
	return <textarea className={`py-2 ${BASE} ${className}`} {...rest} />;
}

// A label, its control, and a hint or error underneath.
export function Field({
	label,
	hint,
	error,
	children,
}: {
	label: string;
	hint?: ReactNode;
	error?: string | null;
	children: (id: string) => ReactNode;
}) {
	const id = useId();
	return (
		<div className="flex flex-col gap-1.5">
			<label htmlFor={id} className="text-sm font-medium text-ink">
				{label}
			</label>
			{children(id)}
			{error ? (
				<p className="text-xs text-coral" role="alert">
					{error}
				</p>
			) : hint ? (
				<p className="text-xs text-pencil">{hint}</p>
			) : null}
		</div>
	);
}
