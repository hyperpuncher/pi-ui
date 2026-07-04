export type PiSdkSmoke = {
	ok: boolean;
	exports: string[];
	error?: string;
};

export async function smokePiSdkImport(): Promise<PiSdkSmoke> {
	try {
		const sdk = await import("npm:@earendil-works/pi-coding-agent@0.80.3");
		return {
			ok: typeof sdk.createAgentSessionRuntime === "function",
			exports: Object.keys(sdk).sort().slice(0, 24),
		};
	} catch (error) {
		return {
			ok: false,
			exports: [],
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
