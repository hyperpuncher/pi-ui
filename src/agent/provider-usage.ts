import type { AgentSession } from "@earendil-works/pi-coding-agent";

import { withAgentHttpProxy } from "../utils/http-proxy.ts";
import type { JsonValue } from "../utils/json-types.ts";

const usageTimeoutMs = 15_000;

export const providerUsageTtlMs = 60 * 1000;

export function fetchProviderUsagePayload(
	session: AgentSession,
	url: string,
): Promise<JsonValue | undefined> {
	return withAgentHttpProxy(session.modelRuntime, () =>
		fetchProviderUsagePayloadScoped(session, url),
	);
}

async function fetchProviderUsagePayloadScoped(
	session: AgentSession,
	url: string,
): Promise<JsonValue | undefined> {
	const model = session.model;
	if (!model) return undefined;

	const resolution = await session.modelRuntime.getAuth(model);
	if (!resolution) return undefined;

	const headers = new Headers();
	for (const [name, value] of Object.entries(resolution.auth.headers ?? {})) {
		if (value !== null) headers.set(name, value);
	}
	if (!headers.has("authorization")) {
		if (!resolution.auth.apiKey) return undefined;
		headers.set("Authorization", `Bearer ${resolution.auth.apiKey}`);
	}
	if (!headers.has("user-agent")) headers.set("User-Agent", "pi-ui");

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), usageTimeoutMs);
	try {
		const response = await fetch(url, {
			headers,
			signal: controller.signal,
		});
		return response.ok ? await response.json() : undefined;
	} finally {
		clearTimeout(timeout);
	}
}
