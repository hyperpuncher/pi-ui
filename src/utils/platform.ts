export type OperatingSystem = "darwin" | "linux" | "windows";

export const operatingSystem: OperatingSystem =
	process.platform === "win32"
		? "windows"
		: process.platform === "darwin"
			? "darwin"
			: "linux";
