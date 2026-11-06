import type { ReactNode } from "react";
import { Logo } from "./icons";

export function AuthFrame({
	title,
	intro,
	children,
	host,
	top,
}: {
	title: string;
	intro?: ReactNode;
	children?: ReactNode;
	host?: string;
	// Shown above the title, for example the two logos on the consent screen.
	top?: ReactNode;
}) {
	return (
		<div className="relative flex min-h-screen flex-col">
			<header className="flex items-center justify-between px-6 py-5 sm:px-8">
				<span className="flex items-center gap-2.5">
					<Logo />
					<span className="text-[17px] font-semibold tracking-tight">
						Catchall
					</span>
				</span>
				{host ? (
					<span className="mono hidden text-[12px] text-graphite sm:inline">
						{host}
					</span>
				) : null}
			</header>
			<main
				className={`relative z-10 mx-auto w-full max-w-[408px] flex-1 px-6 ${top ? "pt-10 sm:pt-[72px]" : "pt-16 sm:pt-[110px]"}`}
			>
				{top}
				<h1 className="text-[32px] font-semibold leading-[38px] tracking-display">
					{title}
				</h1>
				{intro ? (
					<p className="mt-2.5 text-[15px] leading-[22px] text-graphite">
						{intro}
					</p>
				) : null}
				<div className="mt-8">{children}</div>
				<p className="mt-8 pb-40 text-center text-[12px] text-pencil">
					Powered by{" "}
					<a
						href="https://appwrite.io"
						className="hover:text-ink"
						target="_blank"
						rel="noreferrer"
					>
						Appwrite
					</a>
				</p>
			</main>
			<div
				className="dither-band-up pointer-events-none absolute inset-x-0 bottom-0 h-[210px]"
				aria-hidden="true"
			/>
		</div>
	);
}

export function FormError({ children }: { children: ReactNode }) {
	if (!children) return null;
	return (
		<p
			className="rounded-md bg-red-soft px-3 py-2.5 text-[14px] text-red"
			role="alert"
		>
			{children}
		</p>
	);
}
