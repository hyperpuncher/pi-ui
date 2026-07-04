export type AppCommandId =
	| "new-chat"
	| "resume-session"
	| "command-palette"
	| "switch-model";

export type AppCommand = {
	id: AppCommandId;
	title: string;
	description: string;
	shortcut: {
		display: string;
		native: string;
		keys: string[];
	};
};

export const appCommands: AppCommand[] = [
	{
		id: "new-chat",
		title: "New chat",
		description: "Start a fresh pi session.",
		shortcut: { display: "Ctrl O", native: "CmdOrCtrl+O", keys: ["o"] },
	},
	{
		id: "resume-session",
		title: "Resume session",
		description: "Browse recent pi sessions for this project.",
		shortcut: { display: "Ctrl R", native: "CmdOrCtrl+R", keys: ["r"] },
	},
	{
		id: "command-palette",
		title: "Command palette",
		description: "Open the keyboard command launcher.",
		shortcut: { display: "Ctrl K", native: "CmdOrCtrl+K", keys: ["k"] },
	},
	{
		id: "switch-model",
		title: "Switch model",
		description: "Focus the model picker.",
		shortcut: { display: "Ctrl M", native: "CmdOrCtrl+M", keys: ["m"] },
	},
];

export function command(id: AppCommandId): AppCommand {
	const found = appCommands.find((item) => item.id === id);
	if (!found) {
		throw new Error(`Unknown command: ${id}`);
	}
	return found;
}

export function shortcutKeys(): string[] {
	return appCommands.flatMap((item) => item.shortcut.keys);
}
