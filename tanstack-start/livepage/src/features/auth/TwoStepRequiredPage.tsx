import { getRouteApi } from "@tanstack/react-router";
import { TwoStepEnroll } from "./TwoStepSettings";

const routeApi = getRouteApi("/two-step");

// Everyone lands here when the site requires two-step sign-in and they haven't set it up yet.
export function TwoStepRequiredPage() {
	const { email } = routeApi.useRouteContext();
	return (
		<main className="flex min-h-dvh items-center justify-center bg-paper px-6 py-12 antialiased">
			<div className="w-full max-w-[1000px]">
				<TwoStepEnroll
					email={email}
					onDone={() => window.location.assign("/")}
				/>
			</div>
		</main>
	);
}
