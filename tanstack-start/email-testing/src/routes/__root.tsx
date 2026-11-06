import {
	createRootRoute,
	HeadContent,
	Link,
	Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "Catchall" },
			{
				name: "description",
				content: "A test inbox for your team, running on Appwrite.",
			},
			{ name: "robots", content: "noindex" },
		],
		links: [
			{ rel: "preconnect", href: "https://fonts.googleapis.com" },
			{
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossOrigin: "anonymous",
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap",
			},
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
		],
		// Applies a saved light or dark choice before the first paint.
		scripts: [
			{
				children: `try{var t=localStorage.getItem("catchall-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`,
			},
		],
	}),
	shellComponent: RootDocument,
	notFoundComponent: NotFound,
});

function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	);
}

function NotFound() {
	return (
		<main className="mx-auto max-w-[440px] px-6 py-24">
			<h1 className="text-[28px] font-semibold tracking-display">
				Nothing here
			</h1>
			<p className="mt-2 text-graphite">This page doesn't exist.</p>
			<Link to="/" className="btn mt-6">
				Go to the inbox
			</Link>
		</main>
	);
}
