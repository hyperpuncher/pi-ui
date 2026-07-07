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
	action: string;
};

export const appCommands: AppCommand[] = [
	{
		id: "new-chat",
		title: "New chat",
		description: "Start a fresh pi session.",
		shortcut: { display: "ctrl O", native: "CmdOrCtrl+O", keys: ["o"] },
		action: "@post('/sessions/new'); requestAnimationFrame(() => document.getElementById('prompt-input')?.focus())",
	},
	{
		id: "resume-session",
		title: "Resume session",
		description: "Browse recent pi sessions for this project.",
		shortcut: { display: "ctrl R", native: "CmdOrCtrl+R", keys: ["r"] },
		action: "@post('/sessions/list'); document.getElementById('session-dialog')?.showModal(); requestAnimationFrame(() => document.getElementById('session-input')?.focus())",
	},
	{
		id: "session-tree",
		title: "Session tree",
		description: "Navigate and branch within the current session.",
		shortcut: { display: "", native: "", keys: [] },
		action: "@post('/tree/open')",
	},
	{
		id: "command-palette",
		title: "Command palette",
		description: "Open the keyboard command launcher.",
		shortcut: { display: "ctrl K", native: "CmdOrCtrl+K", keys: ["k"] },
		action: "document.getElementById('command-input')?.focus()",
	},
	{
		id: "switch-model",
		title: "Switch model",
		description: "Open the model picker.",
		shortcut: { display: "ctrl L", native: "CmdOrCtrl+L", keys: ["l"] },
		action: "setTimeout(() => { document.getElementById('model-select-trigger')?.focus(); document.getElementById('model-select')?.toggle?.(); }, 0)",
	},
	{
		id: "cycle-thinking",
		title: "Cycle thinking",
		description: "Cycle through available thinking levels.",
		shortcut: { display: "alt T", native: "Alt+T", keys: [] },
		action: "@post('/thinking/cycle')",
	},
	{
		id: "change-workspace",
		title: "Change workspace",
		description: "Set the cwd used by pi sessions and tools.",
		shortcut: { display: "", native: "", keys: [] },
		action: "$workspacePath = ''; document.getElementById('workspace-dialog')?.showModal(); requestAnimationFrame(() => document.getElementById('workspace-input')?.focus())",
	},
];
