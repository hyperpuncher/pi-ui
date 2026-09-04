export const attachmentFileIcons = {
	archive: {
		paths: [
			"M13.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v11.5",
			"M14 2v5a1 1 0 0 0 1 1h5M8 12v-1m0 7v-2m0-9V6",
		],
		circle: { cx: 8, cy: 20, r: 2 },
	},
	audio: {
		paths: [
			"M17.5 22h.5a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3",
			"M14 2v4a2 2 0 0 0 2 2h4M2 19a2 2 0 1 1 4 0v1a2 2 0 1 1-4 0v-4a6 6 0 0 1 12 0v4a2 2 0 1 1-4 0v-1a2 2 0 1 1 4 0",
		],
	},
	code: {
		paths: [
			"M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4",
			"M14 2v4a2 2 0 0 0 2 2h4M5 12l-3 3l3 3m4 0l3-3l-3-3",
		],
	},
	file: {
		paths: [
			"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
			"M14 2v5a1 1 0 0 0 1 1h5",
		],
	},
	pdf: {
		paths: [
			"M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4",
			"M14 2v4a2 2 0 0 0 2 2h4M2 13v-1h6v1m-3-1v6m-1 0h2",
		],
	},
	text: {
		paths: [
			"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
			"M14 2v5a1 1 0 0 0 1 1h5M10 9H8m8 4H8m8 4H8",
		],
	},
	video: {
		paths: [
			"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
			"M14 2v5a1 1 0 0 0 1 1h5m-4.967 5.44a.647.647 0 0 1 0 1.12l-4.065 2.352a.645.645 0 0 1-.968-.56v-4.704a.645.645 0 0 1 .967-.56z",
		],
	},
};

export function attachmentFileExtension(name) {
	const extension = name.includes(".") ? name.split(".").at(-1) : "";
	return extension.slice(0, 4).toLowerCase();
}

export function attachmentFileKind(name, mimeType) {
	const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
	if (mimeType === "application/pdf" || extension === "pdf") return "pdf";
	if (
		mimeType?.startsWith("audio/") ||
		["aac", "flac", "m4a", "mp3", "ogg", "wav"].includes(extension)
	)
		return "audio";
	if (
		mimeType?.startsWith("video/") ||
		["avi", "m4v", "mkv", "mov", "mp4", "webm"].includes(extension)
	)
		return "video";
	if (
		mimeType?.includes("zip") ||
		["7z", "bz2", "gz", "rar", "tar", "xz", "zip"].includes(extension)
	)
		return "archive";
	if (
		[
			"c",
			"cpp",
			"css",
			"go",
			"h",
			"html",
			"java",
			"js",
			"json",
			"jsx",
			"py",
			"rs",
			"sh",
			"sql",
			"toml",
			"ts",
			"tsx",
			"xml",
			"yaml",
			"yml",
		].includes(extension) ||
		mimeType === "application/json" ||
		mimeType?.includes("javascript") ||
		mimeType?.includes("xml")
	)
		return "code";
	if (
		mimeType?.startsWith("text/") ||
		["csv", "log", "md", "rst", "txt"].includes(extension)
	)
		return "text";
	return "file";
}
