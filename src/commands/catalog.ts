export type AppCommandId =
	| "new-chat"
	| "new-temporary-chat"
	| "resume-session"
	| "session-tree"
	| "command-palette"
	| "change-code-theme"
	| "change-fonts"
	| "toggle-keybind-hints"
	| "toggle-minimal-mode"
	| "toggle-tool-output"
	| "switch-model"
	| "cycle-model"
	| "cycle-thinking"
	| "cycle-thinking-backward"
	| "toggle-thinking"
	| "change-workspace"
	| "toggle-review"
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
		id: "change-code-theme",
		title: "Change code theme",
		description: "Choose syntax colors for code and diffs.",
		shortcut: { display: "", native: "", keys: [] },
	},
	{
		id: "change-fonts",
		title: "Change fonts",
		description: "Choose fonts for the interface and code.",
		shortcut: { display: "", native: "", keys: [] },
	},
	{
		id: "toggle-keybind-hints",
		title: "Toggle keybind hints",
		description: "Show or hide keyboard shortcut labels.",
		shortcut: { display: "", native: "", keys: [] },
	},
	{
		id: "toggle-minimal-mode",
		title: "Toggle minimal mode",
		description: "Hide thinking details, keybind hints, and tool output.",
		shortcut: { display: "alt M", native: "Alt+M", keys: [] },
	},
	{
		id: "toggle-tool-output",
		title: "Toggle tool output",
		description: "Show tool calls as compact one-line entries.",
		shortcut: { display: "alt O", native: "Alt+O", keys: [] },
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
		id: "toggle-thinking",
		title: "Toggle thinking blocks",
		description: "Collapse or expand thinking blocks.",
		shortcut: {
			display: "ctrl alt T",
			native: "CmdOrCtrl+Alt+T",
			keys: [],
		},
	},
	{
		id: "toggle-review",
		title: "Toggle workspace",
		description: "Show or hide workspace files and Git history.",
		shortcut: {
			display: "ctrl G",
			native: "CmdOrCtrl+G",
			keys: ["g"],
		},
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
