import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";

import { outputCommand } from "../utils/command.ts";

type ShareableSession = Pick<AgentSessionRuntime["session"], "exportToHtml">;
type CommandResult = { code: number; stdout: Uint8Array; stderr: Uint8Array };

export type SessionShareResult = {
	shareUrl: string;
	gistUrl: string;
};

export type SessionShareDependencies = {
	tempFilePath: () => string;
	removeFile: (path: string) => Promise<void>;
	runGh: (args: string[]) => Promise<CommandResult>;
	shareViewerUrl: (gistId: string) => string;
};

const decoder = new TextDecoder();

const sessionShareDependencies: SessionShareDependencies = {
	tempFilePath: () => join(tmpdir(), `pi-ui-session-${crypto.randomUUID()}.html`),
	removeFile: (path) => Bun.file(path).delete(),
	runGh: (args) => outputCommand("gh", { args }),
	shareViewerUrl: (gistId) =>
		`${process.env.PI_SHARE_VIEWER_URL ?? "https://pi.dev/session/"}#${gistId}`,
};

export async function shareSession(
	session: ShareableSession,
	dependencies: SessionShareDependencies = sessionShareDependencies,
): Promise<SessionShareResult> {
	let auth: CommandResult;
	try {
		auth = await dependencies.runGh(["auth", "status"]);
	} catch {
		throw new Error(
			"GitHub CLI (gh) is not installed. Install it from https://cli.github.com/",
		);
	}
	if (auth.code !== 0) {
		throw new Error("GitHub CLI is not logged in. Run 'gh auth login' first.");
	}

	const tempFile = dependencies.tempFilePath();
	try {
		await session.exportToHtml(tempFile);
		const result = await dependencies.runGh([
			"gist",
			"create",
			"--public=false",
			tempFile,
		]);
		if (result.code !== 0) {
			throw new Error(
				`Failed to create gist: ${decoder.decode(result.stderr).trim() || "Unknown error"}`,
			);
		}
		const gistUrl = decoder.decode(result.stdout).trim();
		const gistId = gistUrl.split("/").filter(Boolean).at(-1);
		if (!gistId) throw new Error("Failed to parse gist ID from gh output.");
		return {
			shareUrl: dependencies.shareViewerUrl(gistId),
			gistUrl,
		};
	} finally {
		await dependencies.removeFile(tempFile).catch(() => {});
	}
}
