// Decision tables for /setup's capability detection. The specification responses are real, recorded
// from local Cloud on 2026-11-09. The self-hosted shapes come from Appwrite's route code (the
// specifications path resolves to /vectorsdb/:databaseId there) and were not run live.
import { describe, expect, it } from "vitest";
import {
	decideAgents,
	decideEmbeddings,
	decideOrigin,
	decideVectors,
	summarize,
} from "./capabilities";
import {
	keptScopes,
	listedModels,
	maskKey,
	missingScopeFrom,
	pickModels,
	rangeCeiling,
	vectorsFailed,
	vectorsReady,
} from "./setup-logic";

// Real response from GET /v1/vectorsdb/specifications on a Pro org (local Cloud).
const proSpecs = {
	specifications: [
		{
			slug: "s-1vcpu-1gb",
			name: "Starter",
			price: 10,
			cpu: 1000,
			memory: 1024,
			includedStorage: 10,
			enabled: true,
		},
		{
			slug: "s-2vcpu-2gb",
			name: "Standard",
			price: 20,
			cpu: 2000,
			memory: 2048,
			includedStorage: 25,
			enabled: true,
		},
		{
			slug: "s-4vcpu-16gb",
			name: "Business",
			price: 160,
			cpu: 4000,
			memory: 16384,
			includedStorage: 500,
			enabled: false,
		},
	],
};

const ok = (json: Record<string, unknown>) => ({ status: 200, type: "", json });
const err = (status: number, type: string) => ({ status, type, json: {} });

describe("decideVectors", () => {
	it("Cloud Pro offers only the specs the plan enables, with live prices", () => {
		const result = decideVectors(ok(proSpecs), null);
		expect(result.kind).toBe("paid");
		if (result.kind !== "paid") return;
		expect(result.specs.map((s) => s.name)).toEqual(["Starter", "Standard"]);
		expect(result.specs[0]).toMatchObject({
			cpu: 1,
			memoryGb: 1,
			storageGb: 10,
			price: 10,
		});
	});

	it("Cloud Free: every spec disabled means free plan", () => {
		const specs = {
			specifications: proSpecs.specifications.map((s) => ({
				...s,
				enabled: false,
			})),
		};
		expect(decideVectors(ok(specs), null).kind).toBe("free-plan");
	});

	it("self-hosted with VectorsDB off: the route answers service disabled", () => {
		expect(decideVectors(err(403, "general_service_disabled"), null).kind).toBe(
			"self-off",
		);
	});

	it("self-hosted with VectorsDB on: 404 from the id route, then the list works", () => {
		const result = decideVectors(
			err(404, "database_not_found"),
			ok({ total: 0 }),
		);
		expect(result.kind).toBe("self-on");
	});

	it("self-hosted with VectorsDB off through the list path", () => {
		expect(
			decideVectors(
				err(404, "general_route_not_found"),
				err(403, "general_service_disabled"),
			).kind,
		).toBe("self-off");
	});

	it("an unexpected answer keeps the feature off and says why", () => {
		const result = decideVectors(err(500, "general_unknown"), err(500, ""));
		expect(result.kind).toBe("unknown");
	});
});

describe("decideAgents", () => {
	const ours = "https://x.example/consent";

	it("self-hosted projects have no OAuth server attribute", () => {
		expect(decideAgents({}, ours).kind).toBe("self-hosted");
	});

	it("available when off, or when already pointed here", () => {
		expect(decideAgents({ oAuth2ServerEnabled: false }, ours).kind).toBe(
			"available",
		);
		expect(
			decideAgents(
				{ oAuth2ServerEnabled: true, oAuth2ServerAuthorizationUrl: ours },
				ours,
			),
		).toEqual({ kind: "available", ours: true });
	});

	it("leaves another app's consent URL alone", () => {
		const r = decideAgents(
			{
				oAuth2ServerEnabled: true,
				oAuth2ServerAuthorizationUrl: "https://consent.acme.dev/approve",
			},
			ours,
		);
		expect(r).toEqual({ kind: "in-use", host: "consent.acme.dev" });
	});
});

describe("decideEmbeddings", () => {
	it("prefers the AI provider, then Appwrite, else none", () => {
		expect(decideEmbeddings(true, null)).toBe("provider");
		expect(decideEmbeddings(false, ok({}))).toBe("appwrite");
		expect(decideEmbeddings(false, err(403, "general_service_disabled"))).toBe(
			"none",
		);
		expect(decideEmbeddings(false, null)).toBe("none");
	});
});

describe("decideOrigin", () => {
	it("only general_unknown_origin blocks; unrelated errors don't", () => {
		expect(decideOrigin(err(403, "general_unknown_origin"))).toBe("blocked");
		expect(decideOrigin(err(401, ""))).toBe("allowed");
		expect(decideOrigin(ok({}))).toBe("allowed");
	});
});

describe("summarize", () => {
	it("names the project kind", () => {
		const agents = { kind: "available" as const, ours: false };
		expect(summarize({ kind: "paid", specs: [] }, agents)).toBe(
			"Appwrite Cloud, on a paid plan.",
		);
		expect(summarize({ kind: "free-plan" }, agents)).toBe(
			"Appwrite Cloud, on the Free plan.",
		);
		expect(summarize({ kind: "self-off" }, agents)).toBe(
			"self-hosted Appwrite.",
		);
		expect(summarize({ kind: "self-on" }, agents)).toBe(
			"self-hosted Appwrite, with VectorsDB on.",
		);
	});
});

describe("setup logic", () => {
	it("masks a key and keeps only its tail", () => {
		const masked = maskKey("sk-proj-abcdefghijklmnopqrstuvwxyz1234");
		expect(masked.startsWith("sk-proj-")).toBe(true);
		expect(masked.endsWith("1234")).toBe(true);
		expect(masked).not.toContain("abcdef");
	});

	it("picks models of each kind and honours overrides", () => {
		const ids = [
			"gpt-image-2.6",
			"gpt-6-chat-thinking",
			"gpt-6-luna",
			"text-embedding-3-small",
			"whisper-1",
		];
		const auto = pickModels(ids);
		expect(auto.imageModel).toBe("gpt-image-2.6");
		expect(auto.embeddingModel).toBe("text-embedding-3-small");
		expect(auto.textModel).toBe("gpt-6-luna");
		expect(pickModels(ids, { textModel: "other" }).textModel).toBe("other");
		expect(pickModels(["gpt-6-luna"]).imageModel).toBe("");
	});

	it("picks the newest model from a real provider list", () => {
		// GET /models from CLIProxyAPI, 2026-11-09.
		const picked = pickModels(
			"gpt-image-2.6 gpt-6-chat-thinking gpt-5.6-sol gpt-image-2.5 gpt-image-2.6-sunburst gpt-6-sol gpt-image-2.5-sunburst gpt-image-2.6-flare gpt-6-astra gpt-6.1-sol gpt-6-luna gpt-5.6-luna gpt-image-2.5-flare gpt-6.1-terra gpt-5.6-terra codex-auto-review gpt-image-1.5 gpt-image-2".split(
				" ",
			),
		);
		expect(picked.textModel).toBe("gpt-6.1-sol");
		expect(picked.imageModel).toBe("gpt-image-2.6");
		expect(picked.embeddingModel).toBe("");
	});

	it("reads the model list shapes providers really send", () => {
		// Together answers GET /models with the bare array and labels each model.
		const together = [
			{ id: "moonshotai/Kimi-K3", type: "chat" },
			{ id: "black-forest-labs/FLUX.2-dev", type: "image" },
			{ id: "Wan-AI/Wan2.6-t2v", type: "video" },
			{ id: "BAAI/bge-base-en-v1.5", type: "embedding" },
			{ id: "mixedbread-ai/Mxbai-Rerank-Large-V2", type: "rerank" },
		];
		const models = listedModels(together);
		expect(models?.length).toBe(5);
		expect(listedModels({ data: [{ id: "gpt-6-luna" }] })?.[0].id).toBe(
			"gpt-6-luna",
		);
		expect(listedModels({ error: "nope" })).toBeNull();
		const picked = pickModels(models ?? []);
		expect(picked.textModel).toBe("moonshotai/Kimi-K3");
		expect(picked.imageModel).toBe("black-forest-labs/FLUX.2-dev");
		expect(picked.embeddingModel).toBe("BAAI/bge-base-en-v1.5");
	});

	it("reads Appwrite's range error for the timeout ceiling", () => {
		expect(
			rangeCeiling(
				"Invalid `timeout` param: Value must be a valid range between 1 and 30",
			),
		).toBe(30);
		expect(rangeCeiling("something else")).toBeNull();
	});

	it("reads the scope name out of a missing-scope error", () => {
		expect(
			missingScopeFrom(
				'app.x (role: applications) missing scopes (["tables.write"])',
			),
		).toBe("tables.write");
		expect(missingScopeFrom("nope")).toBeNull();
	});

	it("gives back setup-only scopes, keeping vector ones when search by meaning is on", () => {
		const all = [
			"rows.read",
			"tables.write",
			"vectorsdb.read",
			"embeddings.write",
		];
		expect(keptScopes(all, false)).toEqual(["rows.read"]);
		expect(keptScopes(all, true)).toEqual([
			"rows.read",
			"vectorsdb.read",
			"embeddings.write",
		]);
	});

	it("treats a settled compute status as ready", () => {
		expect(vectorsReady({ status: "ready" })).toBe(true);
		expect(vectorsReady({})).toBe(true);
		expect(vectorsReady({ status: "provisioning" })).toBe(false);
		expect(vectorsFailed({ status: "failed" })).toBe(true);
		expect(vectorsFailed({ status: "provisioning" })).toBe(false);
	});
});
