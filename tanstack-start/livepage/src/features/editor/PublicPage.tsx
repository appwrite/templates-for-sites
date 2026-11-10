import { Link } from "@tanstack/react-router";
import { Logo } from "#/components/icons";
import type { PublishedPage } from "#/server/published";
import { RenderBlocks } from "./render";

// Board 57: read-only, rendered on the server.
export function PublicPage({ page }: { page: PublishedPage }) {
	// Pinned to UTC so the server and the browser render the same day.
	const updated = new Date(page.updatedAt).toLocaleDateString("en-US", {
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	});
	const fileHref = (fileId: string, download?: boolean) =>
		`/api/files/${fileId}?slug=${encodeURIComponent(page.slug)}${download ? "&download=1" : ""}`;
	return (
		<div className="flex min-h-dvh flex-col bg-paper">
			<header className="flex items-center justify-between px-6 py-4">
				<div className="flex items-center gap-2.5 text-[15px] font-semibold text-ink">
					<span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white">
						<Logo size={15} />
					</span>
					{page.workspaceName}
				</div>
				<Link
					to={page.signedIn ? "/" : "/login"}
					className="text-[14px] text-graphite hover:text-ink"
				>
					{page.signedIn ? "Go home" : "Sign in"}
				</Link>
			</header>
			{page.coverFileId && (
				<img
					src={fileHref(page.coverFileId)}
					alt=""
					className="h-[220px] w-full object-cover"
				/>
			)}
			<main className="mx-auto w-full max-w-[720px] flex-1 px-6 pt-6 pb-24">
				{page.icon && (
					<div className="mb-2 text-[44px] leading-none">{page.icon}</div>
				)}
				<h1 className="text-[48px] leading-[54px] text-ink">{page.title}</h1>
				<p className="mt-3 mb-6 text-[14px] text-graphite">
					By {page.author}. Updated {updated}.
				</p>
				<div className="lp-prose">
					<RenderBlocks
						nodes={page.content}
						options={{ fileHref, links: false }}
					/>
				</div>
			</main>
			<footer className="flex items-center justify-center gap-2 py-6 text-[13px] text-pencil">
				<svg
					width="14"
					height="14"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.6"
					aria-hidden="true"
				>
					<circle cx="6" cy="8" r="4" />
					<circle cx="10" cy="8" r="4" />
				</svg>
				Made with Livepage
			</footer>
		</div>
	);
}
