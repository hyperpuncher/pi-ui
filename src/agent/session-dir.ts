import { resolve } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { expandHomePath } from "../utils/workspace.ts";

// Mirrors pi's session storage override (`PI_CODING_AGENT_SESSION_DIR`): a single
// directory holding session files directly, taking precedence over the default
// per-workspace layout under `<agentDir>/sessions`.
export function sessionDirOverride(): string | undefined {
	const configured = process.env.PI_CODING_AGENT_SESSION_DIR?.trim();
	return configured ? resolve(expandHomePath(configured)) : undefined;
}

export function resolveSessionDir(agentDir = getAgentDir()): string {
	return sessionDirOverride() ?? resolve(agentDir, "sessions");
}
