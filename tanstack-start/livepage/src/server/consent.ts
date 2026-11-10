import { siteOrigin } from "./appwrite";

export { MCP_SCOPE } from "./access-token";

// Where the project's OAuth server sends people to approve an agent.
export function consentUrl(origin = siteOrigin()) {
	return `${origin}/consent`;
}
