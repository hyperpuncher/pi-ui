import type { AgentSession } from "@earendil-works/pi-coding-agent";

import { withAgentHttpProxy } from "#src/utils/http-proxy.ts";
import type { JsonValue } from "#src/utils/json-types.ts";

const usageTimeoutMs = 15_000;

export const providerUsageTtlMs = 60 * 1000;

export function fetchProviderUsagePayload(
	session: AgentSession,
	url: string,
	providerId?: string,
): Promise<JsonValue | undefined> {
	return withAgentHttpProxy(session.modelRuntime, () =>
		fetchProviderUsagePayloadScoped(session, url, providerId),
	);
}

async function fetchProviderUsagePayloadScoped(
	session: AgentSession,
	url: string,
	providerId?: string,
): Promise<JsonValue | undefined> {
	const model = session.model;
	if (!model) return undefined;

	const resolution = providerId
		? await session.modelRuntime.getAuth(providerId)
		: await session.modelRuntime.getAuth(model);
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

	const response = await fetch(url, {
		headers,
		signal: AbortSignal.timeout(usageTimeoutMs),
	});
	if (!response.ok) {
		throw new Error(
			`Usage request failed (HTTP ${response.status})${response.status === 401 ? `; sign in to ${providerId ?? model.provider} again` : ""}`,
		);
	}
	return await response.json();
}
