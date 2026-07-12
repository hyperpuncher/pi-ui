export type WorkspaceResource = {
	dispose(): void | Promise<void>;
};

type WorkspaceTransitionOptions<Host extends WorkspaceResource> = {
	current: { host: Host | undefined };
	prepareHost: () => Host | Promise<Host>;
	commit: (replacement: Host) => void;
	onCurrentDisposeError?: (error: AggregateError) => void;
};

async function disposeResource(
	resource: WorkspaceResource | undefined,
	primaryError?: { value: unknown },
): Promise<void> {
	let disposalError: unknown;
	try {
		await resource?.dispose();
	} catch (error) {
		disposalError = error;
	}
	if (primaryError !== undefined) throw primaryError.value;
	if (disposalError !== undefined) {
		throw new AggregateError([disposalError], "Failed to dispose workspace resource");
	}
}

/** Prepares a replacement before committing and releasing the current host. */
export async function transitionWorkspaceResources<Host extends WorkspaceResource>({
	current,
	prepareHost,
	commit,
	onCurrentDisposeError,
}: WorkspaceTransitionOptions<Host>): Promise<Host> {
	const previous = current.host;
	const replacement = await prepareHost();

	try {
		commit(replacement);
	} catch (error) {
		await disposeResource(replacement, { value: error });
		throw error;
	}
	try {
		await disposeResource(previous);
	} catch (error) {
		if (!(error instanceof AggregateError) || !onCurrentDisposeError) throw error;
		onCurrentDisposeError(error);
	}
	return replacement;
}
