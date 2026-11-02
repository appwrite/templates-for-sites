import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { Logo } from "./icons";

export function ErrorView({ error }: ErrorComponentProps) {
	const router = useRouter();
	return (
		<main className="mx-auto max-w-[560px] px-6 py-24">
			<Logo />
			<h1 className="mt-8 text-[28px] font-semibold leading-[34px] tracking-display">
				Something went wrong
			</h1>
			<p className="mt-3 whitespace-pre-wrap text-[15px] leading-[22px] text-graphite">
				{error instanceof Error ? error.message : String(error)}
			</p>
			<button
				type="button"
				className="btn mt-6"
				onClick={() => router.invalidate()}
			>
				Try again
			</button>
		</main>
	);
}
