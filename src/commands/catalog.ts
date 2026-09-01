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
	| "fork-session-to-workspace"
	| "toggle-review"
	| "login"
	| "logout";

export type AppCommandMetadata = {
	id: AppCommandId;
	title: string;
	description: string;
	shortcut: string;
};

export const appCommandCatalog: AppCommandMetadata[] = [
	{
		id: "new-chat",
		title: "New chat",
		description: "Start a fresh pi session.",
		shortcut: "ctrl O",
	},
	{
		id: "new-temporary-chat",
		title: "New temporary chat",
		description: "Start a temporary chat that is not saved.",
		shortcut: "ctrl alt O",
	},
	{
		id: "resume-session",
		title: "Resume session",
		description: "Browse recent pi sessions for this project.",
		shortcut: "ctrl R",
	},
	{
		id: "session-tree",
		title: "Session tree",
		description: "Navigate and branch within the current session.",
		shortcut: "",
	},
	{
		id: "command-palette",
		title: "Command palette",
		description: "Open the keyboard command launcher.",
		shortcut: "ctrl K",
	},
	{
		id: "change-code-theme",
		title: "Change code theme",
		description: "Choose syntax colors for code and diffs.",
		shortcut: "",
	},
	{
		id: "change-fonts",
		title: "Change fonts",
		description: "Choose fonts for the interface and code.",
		shortcut: "",
	},
	{
		id: "toggle-keybind-hints",
		title: "Toggle keybind hints",
		description: "Show or hide keyboard shortcut labels.",
		shortcut: "",
	},
	{
		id: "toggle-minimal-mode",
		title: "Toggle minimal mode",
		description: "Hide thinking details, keybind hints, and tool output.",
		shortcut: "alt M",
	},
	{
		id: "toggle-tool-output",
		title: "Toggle tool output",
		description: "Show tool calls as compact one-line entries.",
		shortcut: "alt O",
	},
	{
		id: "switch-model",
		title: "Switch model",
		description: "Open the model picker.",
		shortcut: "ctrl L",
	},
	{
		id: "cycle-model",
		title: "Cycle model",
		description: "Cycle through scoped models.",
		shortcut: "ctrl P",
	},
	{
		id: "cycle-thinking",
		title: "Cycle thinking",
		description: "Cycle through available thinking levels.",
		shortcut: "alt T",
	},
	{
		id: "cycle-thinking-backward",
		title: "Cycle thinking backward",
		description: "Cycle backward through available thinking levels.",
		shortcut: "alt shift T",
	},
	{
		id: "toggle-thinking",
		title: "Toggle thinking blocks",
		description: "Collapse or expand thinking blocks.",
		shortcut: "ctrl alt T",
	},
	{
		id: "toggle-review",
		title: "Toggle workspace",
		description: "Show or hide workspace files and Git history.",
		shortcut: "ctrl G",
	},
	{
		id: "login",
		title: "Log in",
		description: "Add a subscription or API key.",
		shortcut: "",
	},
	{
		id: "logout",
		title: "Log out",
		description: "Remove stored provider credentials.",
		shortcut: "",
	},
	{
		id: "change-workspace",
		title: "Change workspace",
		description: "Set the cwd used by pi sessions and tools.",
		shortcut: "ctrl /",
	},
	{
		id: "fork-session-to-workspace",
		title: "Fork session to workspace",
		description: "Fork this session and continue it in another workspace.",
		shortcut: "",
	},
];
