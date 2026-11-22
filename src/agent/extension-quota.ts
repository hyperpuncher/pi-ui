import type { AgentSession, EventBus } from "@earendil-works/pi-coding-agent";

import { parseLimitWindows } from "#src/agent/limit-diagnostics.ts";
import type { AppUsageLimits } from "#src/state/app-store.ts";
import { withAgentHttpProxy } from "#src/utils/http-proxy.ts";
import { isJsonObject, isString, type JsonValue } from "#src/utils/type-guards.ts";

export const extensionQuotaBuses = new WeakMap<
	AgentSession["resourceLoader"],
	EventBus
>();

export function requestExtensionQuota(
	session: AgentSession,
): Promise<AppUsageLimits | undefined> | undefined {
	const model = session.model;
	const bus = extensionQuotaBuses.get(session.resourceLoader);
	if (!model || !bus) return undefined;
	let response: Promise<JsonValue | undefined> | undefined;
	withAgentHttpProxy(session.modelRuntime, () =>
		bus.emit(`pi-ui:quota:${model.provider}`, {
			modelId: model.id,
			signal: AbortSignal.timeout(20_000),
			respond: (pending: Promise<JsonValue | undefined>) => {
				response ??= pending;
			},
		}),
	);
	return response?.then((details) => {
		if (!isJsonObject(details)) return undefined;
		const limits = parseLimitWindows(details);
		const label = isString(details.label) ? details.label.trim() : "";
		return limits && { ...limits, label: label || `${model.provider} limits` };
	});
}
