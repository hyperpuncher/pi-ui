import {
	normalizeWorkspaceReviewPreferences,
	type WorkspaceReviewPreferences,
} from "../workspace-review-types.ts";
import { readAppConfig, updateAppConfig } from "./app-config.ts";

export async function readWorkspaceReviewPreferences(
	path?: string,
): Promise<WorkspaceReviewPreferences> {
	const config = await readAppConfig(path);
	return normalizeWorkspaceReviewPreferences(config.gitView);
}

export async function writeWorkspaceReviewPreferences(
	preferences: WorkspaceReviewPreferences,
	path?: string,
): Promise<void> {
	await updateAppConfig((config) => {
		config.gitView = normalizeWorkspaceReviewPreferences(preferences);
	}, path);
}
