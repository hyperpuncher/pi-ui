import {
	normalizeWorkspaceReviewPreferences,
	type WorkspaceReviewPreferences,
} from "../workspace-review-types.ts";
import { updateAppConfig } from "./app-config.ts";

export async function writeWorkspaceReviewPreferences(
	preferences: WorkspaceReviewPreferences,
	path?: string,
): Promise<void> {
	await updateAppConfig((config) => {
		config.gitView = normalizeWorkspaceReviewPreferences(preferences);
	}, path);
}
