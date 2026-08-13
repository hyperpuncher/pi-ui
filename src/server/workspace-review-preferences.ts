import {
	normalizeWorkspaceReviewPreferences,
	type WorkspaceReviewPreferences,
} from "../workspace-review-types.ts";
import { readAppConfig, updateAppConfig } from "./app-config.ts";

type AppConfig = Record<string, unknown> & {
	gitView?: WorkspaceReviewPreferences;
};

export async function readWorkspaceReviewPreferences(
	path?: string,
): Promise<WorkspaceReviewPreferences> {
	const config = (await readAppConfig(path)) as AppConfig;
	return normalizeWorkspaceReviewPreferences(config.gitView);
}

export async function writeWorkspaceReviewPreferences(
	preferences: WorkspaceReviewPreferences,
	path?: string,
): Promise<void> {
	await updateAppConfig((config: AppConfig) => {
		config.gitView = normalizeWorkspaceReviewPreferences(preferences);
	}, path);
}
