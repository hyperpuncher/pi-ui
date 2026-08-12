export type UsageRequestModel = {
	provider?: string;
	id?: string;
};

export type UsageRequestIdentity = {
	generation: number;
	runtime: object;
	session: object;
	provider: string | undefined;
	modelId: string | undefined;
};

type UsageRequestContext = {
	generation: number;
	runtime: object;
	session: object;
	model: UsageRequestModel | undefined;
};

export function matchesUsageRequest(
	request: UsageRequestIdentity,
	current: UsageRequestContext,
): boolean {
	return (
		request.generation === current.generation &&
		request.runtime === current.runtime &&
		request.session === current.session &&
		request.provider === current.model?.provider &&
		request.modelId === current.model?.id
	);
}

export class UsageRequestTracker {
	private generation = 0;
	private active: UsageRequestIdentity | undefined;

	begin(
		runtime: object,
		session: object,
		model: UsageRequestModel | undefined,
	): UsageRequestIdentity {
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
		request: UsageRequestIdentity,
		runtime: object,
		session: object,
		model: UsageRequestModel | undefined,
	): boolean {
		return (
			this.active === request &&
			matchesUsageRequest(request, {
				generation: this.generation,
				runtime,
				session,
				model,
			})
		);
	}

	release(
		request: UsageRequestIdentity,
		runtime: object,
		session: object,
		model: UsageRequestModel | undefined,
	): boolean {
		if (!this.owns(request, runtime, session, model)) return false;
		this.active = undefined;
		return true;
	}

	get loading(): boolean {
		return this.active !== undefined;
	}
}
