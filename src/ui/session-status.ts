import type { BackgroundSessionStatus } from "../state/app-store.ts";

export function sessionStatusLabel(
	status: BackgroundSessionStatus,
	current = false,
): string {
	return status === "running"
		? current
			? "Current session running"
			: "Background session running"
		: "Background session completed";
}
