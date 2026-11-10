import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 767px)";

function subscribe(fn: () => void) {
	const list = window.matchMedia(QUERY);
	list.addEventListener("change", fn);
	return () => list.removeEventListener("change", fn);
}

// True on phone-width screens, where popovers become bottom sheets. False during server render.
export function usePhone() {
	return useSyncExternalStore(
		subscribe,
		() => window.matchMedia(QUERY).matches,
		() => false,
	);
}
