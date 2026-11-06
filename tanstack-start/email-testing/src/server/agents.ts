import { type Client, Teams } from "node-appwrite";
import { TEAM_ID } from "./schema";

// What setup did with the project's OAuth server, kept in the team's prefs next to the setup
// log. The site gives back project.read after setup, so this is how Settings knows later.
export type AgentSetup = {
	// ready: agents sign in through this site. elsewhere: another app owns the OAuth server.
	status: "ready" | "elsewhere";
	mcpUrl: string;
	authorizationUrl: string;
	updatedAt: string;
};

// `client` is the signed-in person's session client. Team members can read the team's prefs.
export async function readAgentSetup(
	client: Client,
): Promise<AgentSetup | null> {
	const prefs = (await new Teams(client).getPrefs({
		teamId: TEAM_ID,
	})) as Record<string, unknown>;
	const setup = (prefs.setup || {}) as { agents?: AgentSetup };
	return setup.agents ?? null;
}
