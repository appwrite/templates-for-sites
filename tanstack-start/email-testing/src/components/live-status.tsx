import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { fetchRealtimeToken } from "#/functions/realtime";
import { LiveConnection, type LiveStatus } from "#/lib/live";

const LABELS: Record<LiveStatus, string> = {
	connecting: "Connecting",
	live: "Live",
	reconnecting: "Reconnecting",
	offline: "Offline",
	"signed-out": "Signed out",
};

const HINTS: Record<LiveStatus, string> = {
	connecting: "Connecting to Appwrite Realtime.",
	live: "New mail shows up here as it arrives.",
	reconnecting:
		"Lost the connection to Appwrite Realtime. Trying again. Mail that arrives meanwhile shows up once it's back.",
	offline:
		"This device is offline. Mail that arrives meanwhile shows up once it's back.",
	"signed-out": "Your session ended. Sign in again to keep receiving mail.",
};

export function LiveIndicator({
	status,
	label,
	className = "",
}: {
	status: LiveStatus;
	// Replaces "Live" when connected, for example "Waiting for mail".
	label?: string;
	className?: string;
}) {
	return (
		<output
			className={`flex items-center gap-1.5 text-[13px] text-graphite ${className}`}
			title={HINTS[status]}
			aria-live="polite"
		>
			<span className="live-dot shrink-0" data-state={status} />
			{status === "live" && label ? label : LABELS[status]}
		</output>
	);
}

// Subscribes the page to new mail while it is mounted. `onChange` runs for every row event and
// after a reconnect, when events may have been missed.
export function useLiveInbox(onChange: () => void): LiveStatus {
	const router = useRouter();
	const [status, setStatus] = useState<LiveStatus>("connecting");
	const latest = useRef(onChange);
	latest.current = onChange;

	useEffect(() => {
		const live = new LiveConnection({
			fetchToken: () => fetchRealtimeToken(),
			onEvent: () => latest.current(),
			// Also on the first connect: mail can land between the page loading and the socket
			// subscribing.
			onConnected: () => latest.current(),
			onStatus: (next) => {
				setStatus(next);
				// Run the loaders again. They send a signed-out person to the sign-in page.
				if (next === "signed-out") router.invalidate();
			},
		});
		const onVisibility = () => {
			if (document.visibilityState === "visible") live.check();
		};
		const onPageShow = (event: PageTransitionEvent) => {
			if (event.persisted) live.check();
		};
		const onOnline = () => live.online();
		const onOffline = () => live.offline();
		document.addEventListener("visibilitychange", onVisibility);
		window.addEventListener("pageshow", onPageShow);
		window.addEventListener("online", onOnline);
		window.addEventListener("offline", onOffline);
		live.start();
		return () => {
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("pageshow", onPageShow);
			window.removeEventListener("online", onOnline);
			window.removeEventListener("offline", onOffline);
			live.stop();
		};
	}, [router]);

	return status;
}
