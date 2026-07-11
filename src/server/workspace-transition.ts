export type WorkspaceResource = {
	dispose(): void;
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
};

/** Prepares a complete replacement before committing and releasing current resources. */
export async function transitionWorkspaceResources<
	Host extends WorkspaceResource,
	FileSearch extends WorkspaceResource,
>({
	current,
	prepareHost,
	prepareFileSearch,
	commit,
}: WorkspaceTransitionOptions<Host, FileSearch>): Promise<
	WorkspaceResources<Host, FileSearch>
> {
	let host: Host | undefined;
	let fileSearch: FileSearch | undefined;
	try {
		host = await prepareHost();
		fileSearch = await prepareFileSearch();
	} catch (error) {
		fileSearch?.dispose();
		host?.dispose();
		throw error;
	}

	const replacement = { host, fileSearch };
	try {
		commit(replacement);
	} catch (error) {
		fileSearch.dispose();
		host.dispose();
		throw error;
	}
	current.host?.dispose();
	current.fileSearch.dispose();
	return replacement;
}
