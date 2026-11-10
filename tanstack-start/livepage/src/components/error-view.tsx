import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { Button } from "./ui";

export function ErrorView({ error }: ErrorComponentProps) {
	const router = useRouter();
	return (
		<main className="mx-auto max-w-[560px] px-6 py-24">
			<h1 className="text-xl">Something went wrong</h1>
			<p className="mt-3 whitespace-pre-wrap text-md text-graphite">
				{error instanceof Error ? error.message : String(error)}
			</p>
			<Button
				className="mt-6"
				variant="primary"
				onClick={() => router.invalidate()}
			>
				Try again
			</Button>
		</main>
	);
}
