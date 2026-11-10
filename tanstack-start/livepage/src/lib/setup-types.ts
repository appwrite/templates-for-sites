// What the /setup page shows. The server decides; the page only renders.

export type Stage = "workspace" | "ai" | "features" | "build";

export type SetupStepId =
	| "team"
	| "database"
	| "bucket"
	| "search"
	| "vectors"
	| "web"
	| "secret"
	| "pages"
	| "agents"
	| "release";

export type StepStatus = "done" | "running" | "pending" | "failed";

export type SetupStep = {
	id: SetupStepId;
	label: string;
	status: StepStatus;
	detail?: string;
	durationMs?: number;
	error?: string;
	// Set on the vector database step when it failed because of the plan or payment method: the
	// page then offers to continue without it.
	optional?: boolean;
};

export type SetupLogLine = {
	t: string;
	text: string;
	kind?: "pause";
	resumedAt?: string;
};

export type ScopeGroup = { product: string; scopes: string[] };

// ---------- capabilities ----------

export type VectorSpec = {
	slug: string;
	name: string;
	cpu: number;
	memoryGb: number;
	storageGb: number;
	price: number;
};

export type VectorsCapability =
	| { kind: "paid"; specs: VectorSpec[] }
	| { kind: "free-plan" }
	| { kind: "self-off" }
	| { kind: "self-on" }
	| { kind: "unknown"; message: string };

export type AgentsCapability =
	| { kind: "available"; ours: boolean }
	| { kind: "self-hosted" }
	| { kind: "in-use"; host: string };

export type EmbeddingsSource = "provider" | "appwrite" | "none";

export type Capabilities = {
	vectors: VectorsCapability;
	agents: AgentsCapability;
	embeddings: EmbeddingsSource;
	// "We checked this project: <summary>".
	summary: string;
};

export type FeatureChoice = {
	vectors: boolean;
	vectorsSpec: string | null;
	agents: boolean;
	twoStep: boolean;
};

// ---------- AI step ----------

export type AiSupport = {
	text: boolean;
	images: boolean;
	embeddings: boolean;
};

export type AiState = {
	verified: true;
	masked: string;
	endpoint: string;
	defaultEndpoint: boolean;
	textModel: string;
	imageModel: string;
	embeddingModel: string;
	supports: AiSupport;
	notes: string[];
};

export type Owner = { name: string; email: string };

export type SetupView =
	| { view: "no-key" }
	| {
			view: "missing-scopes";
			groups: ScopeGroup[];
			missing: string[];
			siteName: string;
			consoleUrl: string | null;
	  }
	| {
			view: "update";
			work: {
				tables: string[];
				columns: string[];
				indexes: string[];
				building: number;
				failed: string[];
			};
	  }
	| { view: "locked"; signedIn: boolean }
	| { view: "in-progress"; signedIn: boolean; email: string | null }
	| { view: "claim" }
	| {
			view: "workspace";
			owner: Owner;
			name: string;
			signup: "invite" | "open";
	  }
	| {
			view: "ai";
			owner: Owner;
			workspaceName: string;
			ai: AiState | null;
			skipped: boolean;
			defaultEndpoint: string;
	  }
	| {
			view: "features";
			owner: Owner;
			workspaceName: string;
			capabilities: Capabilities;
			choice: FeatureChoice;
	  }
	| {
			view: "build";
			owner: Owner;
			workspaceName: string;
			steps: SetupStep[];
			log: SetupLogLine[];
			// Another tab is running a step right now, so this one only watches.
			watching: boolean;
			keyExpired: boolean;
			vectorsPending: boolean;
	  }
	| {
			view: "done";
			workspaceId: string;
			workspaceName: string;
			seconds: number;
			vectorsPending: boolean;
			vectorsFailed: boolean;
			givenBack: number;
	  };
