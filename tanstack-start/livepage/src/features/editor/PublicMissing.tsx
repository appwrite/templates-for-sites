import { Link } from "@tanstack/react-router";
import { Button } from "#/components/ui";

export function PublicMissing({ signedIn }: { signedIn?: boolean }) {
	return (
		<main className="mx-auto max-w-[560px] px-6 pt-24">
			<h1 className="text-[40px] leading-[46px] text-ink">
				This page isn't here.
			</h1>
			<p className="mt-3 text-[16px] leading-[26px] text-graphite">
				{signedIn
					? "It may have moved or been deleted, or the link may be wrong."
					: "It may have been unpublished, or the link may be wrong."}
			</p>
			{signedIn ? (
				<Link to="/" className="mt-6 inline-block">
					<Button variant="primary" className="h-10 px-4">
						Go home
					</Button>
				</Link>
			) : (
				<Link to="/login" className="mt-6 inline-block text-link">
					Sign in
				</Link>
			)}
		</main>
	);
}
