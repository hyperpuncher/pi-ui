export type WorkspaceResource = {
	dispose(): void | Promise<void>;
};

export type WorkspaceResources<
	Host extends WorkspaceResource,
	FileSearch extends WorkspaceResource,
> = {
	host: Host;
	fileSearch: FileSearch;
};

type WorkspaceTransitionOptions<
	Host extends WorkspaceResource,
	FileSearch extends WorkspaceResource,
> = {
	current: {
		host: Host | undefined;
		fileSearch: FileSearch;
	};
	prepareHost: () => Host | Promise<Host>;
	prepareFileSearch: () => FileSearch | Promise<FileSearch>;
	commit: (replacement: WorkspaceResources<Host, FileSearch>) => void;
	onCurrentDisposeError?: (error: AggregateError) => void;
};

async function disposeResources(
	resources: Array<WorkspaceResource | undefined>,
	primaryError?: { value: unknown },
): Promise<void> {
	const results = await Promise.allSettled(
		resources
			.filter((resource) => resource !== undefined)
			.map((resource) => Promise.resolve().then(() => resource.dispose())),
	);
	if (primaryError !== undefined) throw primaryError.value;
	const errors = results.flatMap((result) =>
		result.status === "rejected" ? [result.reason] : [],
	);
	if (errors.length > 0) {
		throw new AggregateError(errors, "Failed to dispose workspace resources");
	}
}

/** Prepares a complete replacement before committing and releasing current resources. */
export async function transitionWorkspaceResources<
	Host extends WorkspaceResource,
	FileSearch extends WorkspaceResource,
>({
	current,
	prepareHost,
	prepareFileSearch,
	commit,
	onCurrentDisposeError,
}: WorkspaceTransitionOptions<Host, FileSearch>): Promise<
	WorkspaceResources<Host, FileSearch>
> {
	const previous = { ...current };
	let host: Host | undefined;
	let fileSearch: FileSearch | undefined;
	try {
		host = await prepareHost();
		fileSearch = await prepareFileSearch();
	} catch (error) {
		await disposeResources([fileSearch, host], { value: error });
		throw error;
	}

	const replacement = { host, fileSearch };
	try {
		commit(replacement);
	} catch (error) {
		await disposeResources([fileSearch, host], { value: error });
		throw error;
	}
	try {
		await disposeResources([previous.host, previous.fileSearch]);
	} catch (error) {
		if (!(error instanceof AggregateError) || !onCurrentDisposeError) throw error;
		onCurrentDisposeError(error);
	}
	return replacement;
}
