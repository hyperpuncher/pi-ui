export type AppCommandId =
	| "new-chat"
	| "resume-session"
	| "session-tree"
	| "command-palette"
	| "switch-model"
	| "cycle-thinking"
	| "change-workspace";

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
		shortcut: { display: "ctrl O", native: "CmdOrCtrl+O", keys: ["o"] },
	},
	{
		id: "resume-session",
		title: "Resume session",
		description: "Browse recent pi sessions for this project.",
		shortcut: { display: "ctrl R", native: "CmdOrCtrl+R", keys: ["r"] },
	},
	{
		id: "session-tree",
		title: "Session tree",
		description: "Navigate and branch within the current session.",
		shortcut: { display: "", native: "", keys: [] },
	},
	{
		id: "command-palette",
		title: "Command palette",
		description: "Open the keyboard command launcher.",
		shortcut: { display: "ctrl K", native: "CmdOrCtrl+K", keys: ["k"] },
	},
	{
		id: "switch-model",
		title: "Switch model",
		description: "Open the model picker.",
		shortcut: { display: "ctrl L", native: "CmdOrCtrl+L", keys: ["l"] },
	},
	{
		id: "cycle-thinking",
		title: "Cycle thinking",
		description: "Cycle through available thinking levels.",
		shortcut: { display: "alt T", native: "Alt+T", keys: [] },
	},
	{
		id: "change-workspace",
		title: "Change workspace",
		description: "Set the cwd used by pi sessions and tools.",
		shortcut: { display: "", native: "", keys: [] },
	},
];
