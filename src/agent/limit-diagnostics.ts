import { describeLimitWindow } from "#src/agent/usage-format.ts";
import type { AppUsageLimits, AppUsageLimitWindow } from "#src/state/app-store.ts";
import {
	isJsonObject,
	isNumber,
	isString,
	type JsonObject,
	type JsonValue,
} from "#src/utils/type-guards.ts";

export type MessageLimits = {
	status?: string;
	windows: AppUsageLimitWindow[];
};

type MessageWithDiagnostics = {
	role: string;
	diagnostics?: readonly { type: string; details?: JsonValue }[];
};

/**
 * Reads the newest `<provider>.rate-limit` diagnostic an extension attached to a message,
 * so limits cost no extra request and survive a reload through the session transcript.
 */
export function limitsFromMessages(
	messages: readonly MessageWithDiagnostics[],
	providerId: string,
): AppUsageLimits | undefined {
	const diagnosticType = `${providerId}.rate-limit`;
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role !== "assistant") continue;
		const diagnostic = message.diagnostics?.findLast(
			(item) => item.type === diagnosticType,
		);
		if (!diagnostic) continue;
		const details = diagnostic.details;
		if (!isJsonObject(details)) return undefined;
		const limits = parseLimitWindows(details);
		if (!limits) return undefined;
		const label = isString(details.label) ? details.label.trim() : "";
		return {
			...limits,
			label:
				label ||
				(providerId === "claude-code" ? "Claude limits" : `${providerId} limits`),
		};
	}
	return undefined;
}

export function parseLimitWindows(
	details: JsonValue | undefined,
): MessageLimits | undefined {
	if (!isJsonObject(details) || !isJsonObject(details.unifiedWindows)) {
		return undefined;
	}

	const windows = Object.entries(details.unifiedWindows)
		.flatMap(([name, value]) => {
			if (!isJsonObject(value) || !isNumber(value.utilization)) return [];
			const { label, order } = windowInfo(name);
			const resetsAtMs = isNumber(value.resetsAt)
				? value.resetsAt * 1_000
				: undefined;
			const expired = resetsAtMs !== undefined && resetsAtMs <= Date.now();
			// Utilization is a 0..1 fraction of the window, like Anthropic's headers.
			const usedPercent = expired
				? 0
				: value.utilization <= 1
					? value.utilization * 100
					: value.utilization;
			return [
				{ order, window: describeLimitWindow(label, usedPercent, resetsAtMs) },
			];
		})
		.sort((left, right) => left.order - right.order)
		.map((item) => item.window);

	return windows.length > 0 ? { status: usageStatus(details), windows } : undefined;
}

function usageStatus(details: JsonObject): string | undefined {
	if (details.isUsingOverage === true) return "using extra usage";
	const status = isString(details.status) ? details.status : undefined;
	return status && status !== "allowed" ? status : undefined;
}

function windowInfo(name: string) {
	switch (name) {
		case "five_hour":
			return { label: "5 hours", order: 0 };
		case "seven_day":
			return { label: "Weekly", order: 1 };
		case "seven_day_overage_included":
			return { label: "Weekly (extra usage)", order: 2 };
		case "thirty_day":
			return { label: "Monthly", order: 3 };
		default:
			return { label: name.replaceAll("_", " "), order: 4 };
	}
}
