export type AppCommandId =
	| "new-chat"
	| "new-temporary-chat"
	| "resume-session"
	| "session-tree"
	| "command-palette"
	| "switch-model"
	| "cycle-model"
	| "cycle-thinking"
	| "cycle-thinking-backward"
	| "change-workspace"
	| "login"
	| "logout";

export type AppCommandMetadata = {
	id: AppCommandId;
	title: string;
	description: string;
	shortcut: {
		display: string;
		native: string;
		keys: string[];
	};
};

export const appCommandCatalog: AppCommandMetadata[] = [
	{
		id: "new-chat",
		title: "New chat",
		description: "Start a fresh pi session.",
		shortcut: { display: "ctrl O", native: "CmdOrCtrl+O", keys: ["o"] },
	},
	{
		id: "new-temporary-chat",
		title: "New temporary chat",
		description: "Start a temporary chat that is not saved.",
		shortcut: { display: "ctrl alt O", native: "CmdOrCtrl+Alt+O", keys: ["o"] },
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
		id: "cycle-model",
		title: "Cycle model",
		description: "Cycle through scoped models.",
		shortcut: { display: "ctrl P", native: "CmdOrCtrl+P", keys: [] },
	},
	{
		id: "cycle-thinking",
		title: "Cycle thinking",
		description: "Cycle through available thinking levels.",
		shortcut: { display: "alt T", native: "Alt+T", keys: [] },
	},
	{
		id: "cycle-thinking-backward",
		title: "Cycle thinking backward",
		description: "Cycle backward through available thinking levels.",
		shortcut: { display: "alt shift T", native: "Alt+Shift+T", keys: [] },
	},
	{
		id: "login",
		title: "Log in",
		description: "Add a subscription or API key.",
		shortcut: { display: "", native: "", keys: [] },
	},
	{
		id: "logout",
		title: "Log out",
		description: "Remove stored provider credentials.",
		shortcut: { display: "", native: "", keys: [] },
	},
	{
		id: "change-workspace",
		title: "Change workspace",
		description: "Set the cwd used by pi sessions and tools.",
		shortcut: { display: "ctrl /", native: "CmdOrCtrl+/", keys: ["/"] },
	},
];
