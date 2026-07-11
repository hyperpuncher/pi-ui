export type CodexUsageRequestModel = {
	provider?: string;
	id?: string;
};

export type CodexUsageRequestIdentity = {
	generation: number;
	runtime: object;
	session: object;
	provider: string | undefined;
	modelId: string | undefined;
};

type CodexUsageRequestContext = {
	generation: number;
	runtime: object;
	session: object;
	model: CodexUsageRequestModel | undefined;
};

export function matchesCodexUsageRequest(
	request: CodexUsageRequestIdentity,
	current: CodexUsageRequestContext,
): boolean {
	return (
		request.generation === current.generation &&
		request.runtime === current.runtime &&
		request.session === current.session &&
		request.provider === current.model?.provider &&
		request.modelId === current.model?.id
	);
}

export class CodexUsageRequestTracker {
	private generation = 0;
	private active: CodexUsageRequestIdentity | undefined;

	begin(
		runtime: object,
		session: object,
		model: CodexUsageRequestModel | undefined,
	): CodexUsageRequestIdentity {
		this.generation += 1;
		const request = {
			generation: this.generation,
			runtime,
			session,
			provider: model?.provider,
			modelId: model?.id,
		};
		this.active = request;
		return request;
	}

	invalidate(): void {
		this.generation += 1;
		this.active = undefined;
	}

	owns(
		request: CodexUsageRequestIdentity,
		runtime: object,
		session: object,
		model: CodexUsageRequestModel | undefined,
	): boolean {
		return (
			this.active === request &&
			matchesCodexUsageRequest(request, {
				generation: this.generation,
				runtime,
				session,
				model,
			})
		);
	}

	release(
		request: CodexUsageRequestIdentity,
		runtime: object,
		session: object,
		model: CodexUsageRequestModel | undefined,
	): boolean {
		if (!this.owns(request, runtime, session, model)) return false;
		this.active = undefined;
		return true;
	}

	get loading(): boolean {
		return this.active !== undefined;
	}
}
