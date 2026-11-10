import {
	createRootRoute,
	HeadContent,
	Link,
	Scripts,
	useRouter,
} from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { ToastProvider } from "#/components/ui";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover",
			},
			{ title: "Livepage" },
			{
				name: "description",
				content:
					"Pages, databases and live editing for your team, on Appwrite.",
			},
			{ name: "robots", content: "noindex" },
			{ name: "application-name", content: "Livepage" },
			{ name: "apple-mobile-web-app-title", content: "Livepage" },
			{ property: "og:title", content: "Livepage" },
			{
				property: "og:description",
				content: "Pages, databases and live editing for your team.",
			},
			{ property: "og:type", content: "website" },
			{
				name: "theme-color",
				media: "(prefers-color-scheme: light)",
				content: "#ffffff",
			},
			{
				name: "theme-color",
				media: "(prefers-color-scheme: dark)",
				content: "#0f0f10",
			},
		],
		links: [
			{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
			{ rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
			{ rel: "preconnect", href: "https://fonts.googleapis.com" },
			{
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossOrigin: "anonymous",
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap",
			},
			{ rel: "stylesheet", href: appCss },
		],
		// Applies a saved light or dark choice before the first paint, and remembers a button press
		// that lands before React has hydrated that button, so it isn't silently lost.
		scripts: [
			{
				children: `addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("button");if(b&&b.type!=="submit"&&!Object.keys(b).some(function(k){return k.indexOf("__reactProps$")===0}))window.__lpEarly=b},true)`,
			},
			{
				children: `try{var t=localStorage.getItem("livepage-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}var d=document.documentElement.dataset.theme,m=d==="dark"||(d!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.style.backgroundColor=m?"#0f0f10":"#ffffff";document.documentElement.style.colorScheme=m?"dark":"light"`,
			},
		],
	}),
	shellComponent: RootDocument,
	notFoundComponent: NotFound,
});

declare global {
	interface Window {
		__lpEarly?: HTMLButtonElement | null;
	}
}

function RootDocument({ children }: { children: ReactNode }) {
	// A press that landed while its button was still inert runs once React has hydrated that
	// button (React marks hydrated nodes with __reactProps$) and the router's first load has
	// settled, since a navigation started during that load is dropped. Route content can hydrate
	// seconds after this root does on a slow connection, so this keeps checking for a while.
	const router = useRouter();
	useEffect(() => {
		const started = Date.now();
		const timer = setInterval(() => {
			const early = window.__lpEarly;
			if (Date.now() - started > 30_000) {
				window.__lpEarly = null;
				clearInterval(timer);
				return;
			}
			if (!early) return;
			if (!early.isConnected) {
				window.__lpEarly = null;
				return;
			}
			const hydrated = Object.keys(early).some((k) =>
				k.startsWith("__reactProps$"),
			);
			const { status, isLoading } = router.state;
			if (!hydrated || status !== "idle" || isLoading) return;
			window.__lpEarly = null;
			early.click();
		}, 100);
		return () => clearInterval(timer);
	}, [router]);

	return (
		// The theme script above sets data-theme before React hydrates: expected, and only on this element.
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body>
				<ToastProvider>{children}</ToastProvider>
				<Scripts />
			</body>
		</html>
	);
}

function NotFound() {
	return (
		<main className="mx-auto max-w-[440px] px-6 py-24">
			<h1 className="text-xl">Nothing here</h1>
			<p className="mt-2 text-graphite">This page doesn't exist.</p>
			<Link to="/" className="mt-6 inline-block text-link">
				Go to your workspace
			</Link>
		</main>
	);
}
