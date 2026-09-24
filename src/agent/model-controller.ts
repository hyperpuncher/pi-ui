import type { ModelsRefreshOptions } from "@earendil-works/pi-ai";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";

import type { AppStore, AppThinkingLevel } from "../state/app-store.ts";

const thinkingLevels: ReadonlySet<string> = new Set([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

export type ScopedModelCandidate = { id: string; provider: string; name?: string };

export class ModelController {
	constructor(
		private readonly getRuntime: () => AgentSessionRuntime,
		private readonly state: AppStore,
		private readonly onModelChanged: () => void,
	) {}

	async set(modelRef: string): Promise<boolean> {
		const model = this.findOrReport(modelRef);
		if (!model) return false;
		const runtime = this.getRuntime();
		await runtime.session.setModel(model, { persist: false });
		runtime.services.settingsManager.setDefaultModelAndProvider(
			model.provider,
			model.id,
		);
		await runtime.services.settingsManager.flush();
		this.onModelChanged();
		return true;
	}

	async cycle(direction: "forward" | "backward" = "forward"): Promise<boolean> {
		const runtime = this.getRuntime();
		if (!(await runtime.session.cycleModel(direction, { persist: true })))
			return false;
		await runtime.services.settingsManager.flush();
		this.onModelChanged();
		return true;
	}

	async toggleScoped(modelRef: string): Promise<boolean> {
		const model = this.findOrReport(modelRef);
		if (!model) return false;
		const runtime = this.getRuntime();
		const session = runtime.session;
		const key = `${model.provider}/${model.id}`;
		const scoped = session.scopedModels.filter(
			(item) => `${item.model.provider}/${item.model.id}` !== key,
		);
		if (scoped.length === session.scopedModels.length) scoped.push({ model });
		const modelRuntime = runtime.services.modelRuntime;
		let configuredCount = 0;
		for (const item of modelRuntime.getModels()) {
			if (modelRuntime.hasConfiguredAuth(item.provider)) configuredCount += 1;
		}
		const enabled =
			scoped.length === 0 || scoped.length === configuredCount
				? undefined
				: scoped.map((item) => `${item.model.provider}/${item.model.id}`);
		runtime.services.settingsManager.setEnabledModels(enabled);
		await runtime.services.settingsManager.flush();
		session.setScopedModels(enabled === undefined ? [] : scoped);
		this.sync({ restorePicker: true });
		return true;
	}

	sync(options: { restorePicker?: boolean } = {}): void {
		const runtime = this.getRuntime();
		const session = runtime.session;
		const modelRuntime = runtime.services.modelRuntime;
		const current = session.model
			? `${session.model.provider}/${session.model.id}`
			: undefined;
		const scoped = new Set(
			session.scopedModels.map((item) => `${item.model.provider}/${item.model.id}`),
		);
		const models = modelRuntime
			.getModels()
			.map((model) => ({
				id: model.id,
				provider: model.provider,
				name: model.name ?? model.id,
				configured: modelRuntime.hasConfiguredAuth(model.provider),
				scoped: scoped.has(`${model.provider}/${model.id}`),
			}))
			.filter(
				(model) =>
					model.configured || `${model.provider}/${model.id}` === current,
			)
			.sort((a, b) => compareModelPickerOrder(a, b, current));
		this.state.setModels(models, current, options);
	}

	async refresh(options: ModelsRefreshOptions = {}): Promise<void> {
		const runtime = this.getRuntime();
		await runtime.services.modelRuntime.refresh(options);
		if (runtime === this.getRuntime()) this.sync();
	}

	setThinking(level: string): boolean {
		if (!isThinkingLevel(level)) return false;
		const session = this.getRuntime().session;
		// `session.setThinkingLevel` accepts any `ThinkingLevel` string without
		// checking whether the current model actually supports it — it silently
		// keeps the previous level, but still leaves callers with no way to tell
		// success from a no-op. Reject anything outside the model's own
		// available levels here so `/thinking <level>` reports failure instead
		// of a false "set" confirmation.
		const available = session.getAvailableThinkingLevels().filter(isThinkingLevel);
		if (!available.includes(level)) return false;
		session.setThinkingLevel(level);
		this.syncThinking();
		return true;
	}

	cycleThinking(direction: "forward" | "backward" = "forward"): boolean {
		const session = this.getRuntime().session;
		if (direction === "forward") {
			if (!session.cycleThinkingLevel()) return false;
		} else {
			if (!session.supportsThinking()) return false;
			const levels = session.getAvailableThinkingLevels().filter(isThinkingLevel);
			if (!levels.length) return false;
			const current = isThinkingLevel(session.thinkingLevel)
				? session.thinkingLevel
				: levels[0];
			const index = levels.indexOf(current);
			session.setThinkingLevel(levels[index <= 0 ? levels.length - 1 : index - 1]);
		}
		this.syncThinking();
		return true;
	}

	syncThinking(): void {
		const session = this.getRuntime().session;
		const levels = session.getAvailableThinkingLevels().filter(isThinkingLevel);
		const current = isThinkingLevel(session.thinkingLevel)
			? session.thinkingLevel
			: (levels[0] ?? "off");
		this.state.setThinking(current, levels);
	}

	private findOrReport(modelRef: string) {
		const [provider, ...parts] = modelRef.split("/");
		const id = parts.join("/");
		const model =
			provider && id
				? this.getRuntime().services.modelRuntime.getModel(provider, id)
				: undefined;
		if (!model) {
			this.state.appendMessage("system", `Model not found: ${modelRef}`);
		}
		return model;
	}
}

export function compareModelPickerOrder(
	a: ScopedModelCandidate & { scoped: boolean },
	b: ScopedModelCandidate & { scoped: boolean },
	current: string | undefined,
): number {
	if (a.scoped !== b.scoped) return a.scoped ? -1 : 1;
	const aCurrent = `${a.provider}/${a.id}` === current;
	const bCurrent = `${b.provider}/${b.id}` === current;
	if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
	const providerOrder = a.provider.localeCompare(b.provider);
	return providerOrder || a.id.localeCompare(b.id);
}

function isThinkingLevel(level: string): level is AppThinkingLevel {
	return thinkingLevels.has(level);
}
