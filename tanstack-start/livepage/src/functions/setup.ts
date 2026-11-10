import { createServerFn } from "@tanstack/react-start";
import type { FeatureChoice, SetupStepId, Stage } from "#/lib/setup-types";
import {
	type ClaimInput,
	claimOwner,
	continueFromAi,
	finishSetup,
	getSetupView,
	goToStage,
	runSchemaUpdate,
	runStep,
	saveFeatures,
	saveWorkspace,
	skipAi,
	skipVectors,
	type VerifyAiInput,
	verifyAi,
} from "#/server/setup";

export const fetchSetupView = createServerFn({ method: "GET" }).handler(() =>
	getSetupView(),
);

export const submitClaim = createServerFn({ method: "POST" })
	.validator((data: ClaimInput) => data)
	.handler(({ data }) => claimOwner(data));

export const submitWorkspace = createServerFn({ method: "POST" })
	.validator((data: { name: string; signup: "invite" | "open" }) => data)
	.handler(({ data }) => saveWorkspace(data));

export const submitStage = createServerFn({ method: "POST" })
	.validator((data: { stage: Stage }) => data)
	.handler(({ data }) => goToStage(data.stage));

export const submitVerifyAi = createServerFn({ method: "POST" })
	.validator((data: VerifyAiInput) => data)
	.handler(({ data }) => verifyAi(data));

export const submitContinueAi = createServerFn({ method: "POST" }).handler(() =>
	continueFromAi(),
);

export const submitSkipAi = createServerFn({ method: "POST" }).handler(() =>
	skipAi(),
);

export const submitFeatures = createServerFn({ method: "POST" })
	.validator((data: FeatureChoice) => data)
	.handler(({ data }) => saveFeatures(data));

export const submitSchemaUpdate = createServerFn({ method: "POST" }).handler(
	() => runSchemaUpdate(),
);

export const runSetupStep = createServerFn({ method: "POST" })
	.validator((data: { step: SetupStepId; runner: string }) => data)
	.handler(({ data }) => runStep(data.step, data.runner));

export const submitSkipVectors = createServerFn({ method: "POST" }).handler(
	() => skipVectors(),
);

export const submitFinish = createServerFn({ method: "POST" })
	.validator((data: { invites: string[] }) => data)
	.handler(({ data }) => finishSetup(data.invites));
