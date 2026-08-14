import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	type AgentSessionEvent,
	type AgentSessionRuntime,
	SessionManager,
	type SessionEntry,
	type SessionStats,
} from "@earendil-works/pi-coding-agent";

type RuntimeStubOwner = { session: object } | { services: object };
type SessionManagerStubOwner = Partial<SessionManager>;
type SessionStatsStubOwner = Partial<SessionStats>;

export function agentSessionRuntimeStub<Stub extends RuntimeStubOwner>(
	stub: Stub,
): AgentSessionRuntime {
	// SAFETY: Tests provide the runtime members exercised by their controller path.
	return stub as AgentSessionRuntime;
}

export function sessionManagerStub<Stub extends SessionManagerStubOwner>(
	stub: Stub,
): SessionManager {
	// SessionManager has private state, so the test double uses its prototype and
	// supplies the public members exercised by the controller path.
	return Object.assign(Object.create(SessionManager.prototype), stub);
}

export function sessionStatsStub<Stub extends SessionStatsStubOwner>(
	stub: Stub,
): SessionStats {
	// SAFETY: Tests provide the statistics members consumed by the formatter.
	return stub as SessionStats;
}

export function agentSessionEventStub<Stub extends { type: AgentSessionEvent["type"] }>(
	stub: Stub,
): AgentSessionEvent {
	// SAFETY: Tests provide the event members exercised by their reducer path.
	return stub as AgentSessionEvent;
}

export function assistantMessageStub<
	Stub extends Partial<AssistantMessage> & { role: "assistant" },
>(stub: Stub): AssistantMessage {
	// SAFETY: Tests provide the assistant-message members exercised by cache analysis.
	return stub as AssistantMessage;
}

export function sessionEntryStub<Stub extends { type: SessionEntry["type"] }>(
	stub: Stub,
): SessionEntry {
	const entry = {
		id: crypto.randomUUID(),
		parentId: null,
		timestamp: new Date(0).toISOString(),
		...stub,
	};
	// SAFETY: The fixture supplies shared entry metadata and test-specific variant data.
	return entry as SessionEntry;
}
