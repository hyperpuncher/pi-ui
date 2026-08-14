export type UsageRequestModel = {
	provider?: string;
	id?: string;
};

export type UsageRequestIdentity<Runtime extends object, Session extends object> = {
	generation: number;
	runtime: Runtime;
	session: Session;
	provider: string | undefined;
	modelId: string | undefined;
};

type UsageRequestContext<Runtime extends object, Session extends object> = {
	generation: number;
	runtime: Runtime;
	session: Session;
	model: UsageRequestModel | undefined;
};

export function matchesUsageRequest<Runtime extends object, Session extends object>(
	request: UsageRequestIdentity<Runtime, Session>,
	current: UsageRequestContext<Runtime, Session>,
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
	private active: UsageRequestIdentity<object, object> | undefined;

	begin<Runtime extends object, Session extends object>(
		runtime: Runtime,
		session: Session,
		model: UsageRequestModel | undefined,
	): UsageRequestIdentity<Runtime, Session> {
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

	owns<Runtime extends object, Session extends object>(
		request: UsageRequestIdentity<Runtime, Session>,
		runtime: Runtime,
		session: Session,
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

	release<Runtime extends object, Session extends object>(
		request: UsageRequestIdentity<Runtime, Session>,
		runtime: Runtime,
		session: Session,
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
