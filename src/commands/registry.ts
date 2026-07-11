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
		id: "new-temporary-chat",
		title: "New temporary chat",
		description: "Start a temporary chat that is not saved.",
		shortcut: {
			display: "ctrl alt O",
			native: "CmdOrCtrl+Alt+O",
			keys: ["o"],
		},
		action: "@post('/sessions/new-temporary'); requestAnimationFrame(() => document.getElementById('prompt-input')?.focus())",
	},
	{
		id: "resume-session",
		title: "Resume session",
		description: "Browse recent pi sessions for this project.",
		shortcut: { display: "ctrl R", native: "CmdOrCtrl+R", keys: ["r"] },
		action: "document.getElementById('session-dialog')?.showModal(); requestAnimationFrame(() => document.getElementById('session-input')?.focus())",
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
		id: "cycle-model",
		title: "Cycle model",
		description: "Cycle through scoped models.",
		shortcut: { display: "ctrl P", native: "CmdOrCtrl+P", keys: [] },
		action: "$modelCycleDirection = 'forward'; @post('/model/cycle', { filterSignals: { include: /^modelCycleDirection$/ } })",
	},
	{
		id: "cycle-thinking",
		title: "Cycle thinking",
		description: "Cycle through available thinking levels.",
		shortcut: { display: "alt T", native: "Alt+T", keys: [] },
		action: "$thinkingCycleDirection = 'forward'; @post('/thinking/cycle', { filterSignals: { include: /^thinkingCycleDirection$/ } })",
	},
	{
		id: "cycle-thinking-backward",
		title: "Cycle thinking backward",
		description: "Cycle backward through available thinking levels.",
		shortcut: { display: "alt shift T", native: "Alt+Shift+T", keys: [] },
		action: "$thinkingCycleDirection = 'backward'; @post('/thinking/cycle', { filterSignals: { include: /^thinkingCycleDirection$/ } })",
	},
	{
		id: "login",
		title: "Log in",
		description: "Add a subscription or API key.",
		shortcut: { display: "", native: "", keys: [] },
		action: "document.getElementById('command-dialog')?.close(); @post('/auth/open-login')",
	},
	{
		id: "logout",
		title: "Log out",
		description: "Remove stored provider credentials.",
		shortcut: { display: "", native: "", keys: [] },
		action: "document.getElementById('command-dialog')?.close(); @post('/auth/open-logout')",
	},
	{
		id: "change-workspace",
		title: "Change workspace",
		description: "Set the cwd used by pi sessions and tools.",
		shortcut: { display: "ctrl /", native: "CmdOrCtrl+/", keys: ["/"] },
		action: "$workspacePath = ''; document.getElementById('command-dialog')?.close(); const dialog = document.getElementById('workspace-dialog'); if (!dialog?.open) dialog?.showModal(); requestAnimationFrame(() => document.getElementById('workspace-input')?.focus())",
	},
];
