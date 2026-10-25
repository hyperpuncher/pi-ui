export type UsageRequestModel = {
	provider?: string;
	id?: string;
};

export type UsageRequestIdentity<Runtime extends object, Session extends object> = {
	runtime: Runtime;
	session: Session;
	provider: string | undefined;
	modelId: string | undefined;
};

export class UsageRequestTracker {
	private active: UsageRequestIdentity<object, object> | undefined;

	begin<Runtime extends object, Session extends object>(
		runtime: Runtime,
		session: Session,
		model: UsageRequestModel | undefined,
	): UsageRequestIdentity<Runtime, Session> {
		const request = {
			runtime,
			session,
			provider: model?.provider,
			modelId: model?.id,
		};
		this.active = request;
		return request;
	}

	invalidate(): void {
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
			request.runtime === runtime &&
			request.session === session &&
			request.provider === model?.provider &&
			request.modelId === model?.id
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
