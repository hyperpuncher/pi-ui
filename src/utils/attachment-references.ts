export function splitLeadingAttachmentReferences(text: string): {
	prompt: string;
	paths: string[];
} {
	const paths: string[] = [];
	let prompt = text;
	while (true) {
		const match = prompt.match(/^@((?:\/|[A-Za-z]:[\\/])[^\r\n]+)(?:\r?\n|$)/);
		if (!match) break;
		paths.push(match[1]);
		prompt = prompt.slice(match[0].length);
	}
	return { prompt, paths };
}

export function attachmentDisplayName(path: string): string {
	const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
	return name.replace(/^file-[a-f0-9]+-/i, "");
}
