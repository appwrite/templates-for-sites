import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { ErrorView } from "./components/error-view";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	return createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: false,
		defaultErrorComponent: ErrorView,
	});
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
