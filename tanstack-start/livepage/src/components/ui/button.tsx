import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Spinner } from "./spinner";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: "primary" | "secondary" | "ghost" | "danger";
	size?: "sm" | "md";
	loading?: boolean;
	icon?: ReactNode;
	ref?: Ref<HTMLButtonElement>;
};

const VARIANTS = {
	primary: "bg-ink text-paper hover:opacity-90",
	secondary: "bg-paper text-ink border border-rule-strong hover:bg-wash",
	ghost: "text-graphite hover:bg-wash-2 hover:text-ink",
	danger: "bg-coral text-paper hover:opacity-90",
};

export function Button({
	variant = "secondary",
	size = "md",
	loading,
	disabled,
	icon,
	children,
	className = "",
	type = "button",
	...rest
}: ButtonProps) {
	const sizing =
		size === "sm"
			? "h-[26px] px-2 text-xs gap-1 coarse:h-10 coarse:px-3 coarse:text-sm"
			: "h-[30px] px-3 text-sm gap-1.5 coarse:h-10 coarse:px-4 coarse:text-[15px]";
	return (
		<button
			type={type}
			disabled={disabled || loading}
			className={`inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${sizing} ${VARIANTS[variant]} ${className}`}
			{...rest}
		>
			{loading ? <Spinner size={12} /> : icon}
			{children}
		</button>
	);
}
