export type OperatingSystem = "darwin" | "linux" | "windows";

const platform: string | undefined =
	globalThis.navigator?.platform ?? globalThis.process?.platform;

export const operatingSystem: OperatingSystem =
	platform === "win32" || platform?.startsWith("Win")
		? "windows"
		: platform === "darwin" || platform?.startsWith("Mac")
			? "darwin"
			: "linux";
