import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";

import type { AppStore, AppThinkingLevel } from "../state/app-store.ts";

export type ScopedModelCandidate = { id: string; provider: string; name?: string };

export class ModelController {
	constructor(
		private readonly getRuntime: () => AgentSessionRuntime,
		private readonly state: AppStore,
		private readonly onModelChanged: () => void,
	) {}

	async set(modelRef: string): Promise<boolean> {
		const model = this.find(modelRef);
		if (!model) {
			this.state.appendMessage("system", `Model not found: ${modelRef}`);
			return false;
		}
		await this.getRuntime().session.setModel(model);
		this.onModelChanged();
		return true;
	}

	async cycle(direction: "forward" | "backward" = "forward"): Promise<boolean> {
		if (!(await this.getRuntime().session.cycleModel(direction))) return false;
		this.onModelChanged();
		return true;
	}

	async toggleScoped(modelRef: string): Promise<boolean> {
		const model = this.find(modelRef);
		if (!model) {
			this.state.appendMessage("system", `Model not found: ${modelRef}`);
			return false;
		}
		const runtime = this.getRuntime();
		const session = runtime.session;
		const key = `${model.provider}/${model.id}`;
		const scoped = session.scopedModels.filter(
			(item) => `${item.model.provider}/${item.model.id}` !== key,
		);
		if (scoped.length === session.scopedModels.length) scoped.push({ model });
		const modelRuntime = runtime.services.modelRuntime;
		const configuredCount = modelRuntime
			.getModels()
			.filter((item) => modelRuntime.hasConfiguredAuth(item.provider)).length;
		const enabled =
			scoped.length === 0 || scoped.length === configuredCount
				? undefined
				: scoped.map((item) => `${item.model.provider}/${item.model.id}`);
		runtime.services.settingsManager.setEnabledModels(enabled);
		await runtime.services.settingsManager.flush();
		session.setScopedModels(enabled === undefined ? [] : scoped);
		this.sync({ reopenPicker: true });
		return true;
	}

	sync(options: { reopenPicker?: boolean } = {}): void {
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
			.sort((a, b) => {
				const aCurrent = `${a.provider}/${a.id}` === current;
				const bCurrent = `${b.provider}/${b.id}` === current;
				return aCurrent === bCurrent
					? a.provider.localeCompare(b.provider)
					: aCurrent
						? -1
						: 1;
			});
		this.state.setModels(models, current, options);
	}

	async refresh(): Promise<void> {
		const runtime = this.getRuntime();
		await runtime.services.modelRuntime.refresh();
		if (runtime === this.getRuntime()) this.sync();
	}

	setThinking(level: string): boolean {
		if (!isThinkingLevel(level)) return false;
		this.getRuntime().session.setThinkingLevel(level);
		this.syncThinking();
		return true;
	}

	cycleThinking(direction: "forward" | "backward" = "forward"): boolean {
		const session = this.getRuntime().session;
		if (direction === "forward") {
			if (!session.cycleThinkingLevel()) return false;
		} else {
			if (!session.supportsThinking()) return false;
			const levels = session.getAvailableThinkingLevels() as AppThinkingLevel[];
			if (!levels.length) return false;
			const index = levels.indexOf(session.thinkingLevel as AppThinkingLevel);
			session.setThinkingLevel(levels[index <= 0 ? levels.length - 1 : index - 1]);
		}
		this.syncThinking();
		return true;
	}

	syncThinking(): void {
		const session = this.getRuntime().session;
		this.state.setThinking(
			session.thinkingLevel as AppThinkingLevel,
			session.getAvailableThinkingLevels() as AppThinkingLevel[],
		);
	}

	private find(modelRef: string) {
		const [provider, ...parts] = modelRef.split("/");
		const id = parts.join("/");
		return provider && id
			? this.getRuntime().services.modelRuntime.getModel(provider, id)
			: undefined;
	}
}

export function resolveScopedModels<T extends ScopedModelCandidate>(
	patterns: string[],
	models: readonly T[],
): Array<{ model: T; thinkingLevel?: AppThinkingLevel }> {
	const scoped: Array<{ model: T; thinkingLevel?: AppThinkingLevel }> = [];
	const seen = new Set<string>();
	for (const pattern of patterns) {
		const parsed = parseScopedModelPattern(pattern);
		if (!parsed.modelPattern) continue;
		for (const model of models.filter((candidate) =>
			modelMatchesPattern(candidate, parsed.modelPattern),
		)) {
			const key = `${model.provider}/${model.id}`;
			if (seen.has(key)) continue;
			seen.add(key);
			scoped.push({ model, thinkingLevel: parsed.thinkingLevel });
		}
	}
	return scoped;
}

export function parseScopedModelPattern(pattern: string): {
	modelPattern: string;
	thinkingLevel?: AppThinkingLevel;
} {
	const trimmed = pattern.trim();
	const colon = trimmed.lastIndexOf(":");
	if (colon === -1 || !isThinkingLevel(trimmed.slice(colon + 1)))
		return { modelPattern: trimmed };
	return {
		modelPattern: trimmed.slice(0, colon),
		thinkingLevel: trimmed.slice(colon + 1) as AppThinkingLevel,
	};
}

export function modelMatchesPattern(
	model: ScopedModelCandidate,
	pattern: string,
): boolean {
	const normalized = pattern.toLowerCase();
	const refs = [model.id, model.name ?? "", `${model.provider}/${model.id}`].map(
		(value) => value.toLowerCase(),
	);
	if (!normalized.includes("*"))
		return refs.some((value) => value === normalized || value.includes(normalized));
	const escaped = normalized.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
	const regex = new RegExp(`^${escaped.replaceAll("*", ".*")}$`, "i");
	return refs.some((value) => regex.test(value));
}

export function isThinkingLevel(level: string): level is AppThinkingLevel {
	return ["off", "minimal", "low", "medium", "high", "xhigh"].includes(level);
}
