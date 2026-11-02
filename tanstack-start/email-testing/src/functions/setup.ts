import { createServerFn } from "@tanstack/react-start";
import type { SetupStepId } from "#/lib/setup-types";
import {
	type ClaimInput,
	claimAdmin,
	getSetupView,
	runStep,
} from "#/server/setup";

export const fetchSetupView = createServerFn({ method: "GET" }).handler(() =>
	getSetupView(),
);

export const submitClaim = createServerFn({ method: "POST" })
	.validator((data: ClaimInput) => data)
	.handler(({ data }) => claimAdmin(data));

export const runSetupStep = createServerFn({ method: "POST" })
	.validator((data: { step: SetupStepId }) => data)
	.handler(({ data }) => runStep(data.step));
