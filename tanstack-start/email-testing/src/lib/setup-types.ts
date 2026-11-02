export type SetupStepId =
	| "team"
	| "database"
	| "tables"
	| "bucket"
	| "function"
	| "code"
	| "trigger"
	| "schedule"
	| "release";

export type StepStatus = "done" | "running" | "pending" | "failed";

export type SetupStep = {
	id: SetupStepId;
	label: string;
	status: StepStatus;
	detail: string;
	durationMs?: number;
	error?: string;
	note?: string;
};

export type SetupLogLine = {
	t: string;
	text: string;
	kind?: "pause";
	resumedAt?: string;
};

export type ScopeGroup = { product: string; scopes: string[] };

export type SetupView =
	| { view: "not-cloud"; endpoint: string }
	| { view: "no-key" }
	| {
			view: "missing-scopes";
			missing: ScopeGroup[];
			missingCount: number;
			total: number;
			keptCount: number;
			siteName: string;
			consoleUrl: string;
	  }
	| { view: "done"; signedIn: boolean }
	| { view: "in-progress" }
	| { view: "claim" }
	| {
			view: "provision";
			admin: { name: string; email: string };
			steps: SetupStep[];
			log: SetupLogLine[];
			resumed: { doneCount: number; nextLabel: string } | null;
			scopes: {
				before: number;
				after: number;
				givenBack: string[];
				kept: string[];
			};
			domain: string;
	  }
	| {
			view: "complete";
			admin: { name: string; email: string };
			domain: string;
			scopes: {
				before: number;
				after: number;
				givenBack: string[];
				kept: string[];
			};
			log: SetupLogLine[];
	  };
