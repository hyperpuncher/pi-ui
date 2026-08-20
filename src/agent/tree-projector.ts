import type {
	AgentSessionRuntime,
	SessionTreeNode,
} from "@earendil-works/pi-coding-agent";

import type { AppStore, AppTreeEntry } from "../state/app-store.ts";
import { formatDateTime } from "../utils/locale.ts";
import { type JsonRecord, isNumber, isRecord, isString } from "../utils/type-guards.ts";

type TreeState = Pick<AppStore, "setTreeEntries">;
type TreeOwnerToken = PropertyKey | object;

export type TreeNavigationResult =
	| { status: "success"; editorText?: string }
	| { status: "busy" }
	| { status: "cancelled" };

export class TreeProjector {
	private readonly navigations = new Map<
		TreeOwnerToken,
		{ session: AgentSessionRuntime["session"] }
	>();

	constructor(
		private readonly getRuntime: () => AgentSessionRuntime,
		private readonly state: TreeState,
		private readonly onNavigated: () => void = () => {},
		private readonly getOwnerToken: () => TreeOwnerToken = () => getRuntime().session,
	) {}

	open(): void {
		this.cancelNavigation();
		this.load();
	}

	load(): void {
		const manager = this.getRuntime().session.sessionManager;
		this.state.setTreeEntries(
			flattenTree(
				manager.getTree(),
				manager.getLeafId(),
				new Set(manager.getBranch().map((entry) => entry.id)),
			),
		);
	}
	async navigate(
		entryId: string,
		options: { summarize?: boolean; customInstructions?: string } = {},
	): Promise<TreeNavigationResult> {
		const session = this.getRuntime().session;
		const ownerToken = this.getOwnerToken();
		if (this.navigations.has(ownerToken)) return { status: "busy" };
		if (!entryId.trim()) return { status: "cancelled" };
		const navigation = { session };
		this.navigations.set(ownerToken, navigation);
		try {
			const result = await session.navigateTree(entryId, {
				summarize: options.summarize ?? false,
				customInstructions: options.customInstructions,
			});
			if (result.cancelled || this.getOwnerToken() !== ownerToken) {
				return { status: "cancelled" };
			}
			this.onNavigated();
			this.load();
			return { status: "success", editorText: result.editorText };
		} finally {
			if (this.navigations.get(ownerToken) === navigation) {
				this.navigations.delete(ownerToken);
			}
		}
	}

	cancelNavigation(): void {
		this.navigations.get(this.getOwnerToken())?.session.abortBranchSummary();
	}
}

export function flattenTree(
	roots: SessionTreeNode[],
	activeId: string | null,
	pathIds: Set<string>,
): AppTreeEntry[] {
	const rows: AppTreeEntry[] = [];
	const toolCalls = collectToolCalls(roots);
	const containsActive = new Map<SessionTreeNode, boolean>();
	const visitPostOrder = (node: SessionTreeNode): boolean => {
		const contains = node.entry.id === activeId || node.children.some(visitPostOrder);
		containsActive.set(node, contains);
		return contains;
	};
	roots.forEach(visitPostOrder);

	type StackItem = {
		node: SessionTreeNode;
		indent: number;
		justBranched: boolean;
		showConnector: boolean;
		isLast: boolean;
		gutters: boolean[];
	};
	const multipleRoots = roots.length > 1;
	const orderedRoots = orderActiveFirst(roots, containsActive);
	const stack: StackItem[] = orderedRoots.toReversed().map((node, index) => ({
		node,
		indent: multipleRoots ? 1 : 0,
		justBranched: multipleRoots,
		showConnector: multipleRoots,
		isLast: index === 0,
		gutters: [],
	}));

	while (stack.length > 0) {
		const { node, indent, justBranched, showConnector, isLast, gutters } =
			stack.pop()!;
		if (shouldDisplayTreeNode(node, activeId)) {
			rows.push({
				id: node.entry.id,
				parentId: node.entry.parentId,
				prefix: buildTreePrefix(indent, showConnector, isLast, gutters),
				label: node.label,
				active: node.entry.id === activeId,
				inPath: pathIds.has(node.entry.id),
				...formatTreeEntry(node, toolCalls),
			});
		}

		const children = orderActiveFirst(node.children, containsActive);
		const multipleChildren = children.length > 1;
		const childIndent = multipleChildren
			? indent + 1
			: justBranched && indent > 0
				? indent + 1
				: indent;
		const childGutters = [...gutters];
		if (showConnector && indent > 0) {
			childGutters[indent - 1] = !isLast;
		}
		for (let index = children.length - 1; index >= 0; index -= 1) {
			stack.push({
				node: children[index],
				indent: childIndent,
				justBranched: multipleChildren,
				showConnector: multipleChildren,
				isLast: index === children.length - 1,
				gutters: childGutters,
			});
		}
	}
	return rows;
}

function orderActiveFirst(
	nodes: SessionTreeNode[],
	containsActive: Map<SessionTreeNode, boolean>,
): SessionTreeNode[] {
	return [...nodes].sort(
		(a, b) => Number(containsActive.get(b)) - Number(containsActive.get(a)),
	);
}

function buildTreePrefix(
	indent: number,
	showConnector: boolean,
	isLast: boolean,
	gutters: boolean[],
): string {
	if (indent === 0 && !showConnector) return "";
	const parts: string[] = [];
	for (let position = 0; position < indent; position += 1) {
		if (position === indent - 1 && showConnector) {
			parts.push(isLast ? "└─ " : "├─ ");
		} else {
			parts.push(gutters[position] ? "│  " : "   ");
		}
	}
	return parts.join("");
}

type ToolCallInfo = { name: string; arguments: JsonRecord };

function collectToolCalls(roots: SessionTreeNode[]): Map<string, ToolCallInfo> {
	const calls = new Map<string, ToolCallInfo>();
	const stack = [...roots];
	while (stack.length > 0) {
		const node = stack.pop()!;
		stack.push(...node.children);
		if (node.entry.type !== "message") continue;
		const message = node.entry.message;
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const block of message.content) {
			if (!isRecord(block) || block.type !== "toolCall") continue;
			if (!isString(block.id) || !isString(block.name)) continue;
			calls.set(block.id, {
				name: block.name,
				arguments: isRecord(block.arguments) ? block.arguments : {},
			});
		}
	}
	return calls;
}

function shouldDisplayTreeNode(node: SessionTreeNode, activeId: string | null): boolean {
	const entry = node.entry;
	if (
		entry.type === "label" ||
		entry.type === "custom" ||
		entry.type === "model_change" ||
		entry.type === "thinking_level_change" ||
		entry.type === "session_info"
	)
		return false;
	if (
		entry.type === "message" &&
		entry.message.role === "assistant" &&
		entry.id !== activeId &&
		!normalizeTreeText(extractTreeText(entry.message.content)) &&
		(entry.message.stopReason === "stop" ||
			entry.message.stopReason === "toolUse" ||
			!entry.message.stopReason)
	)
		return false;
	return true;
}

function formatTreeEntry(
	node: SessionTreeNode,
	toolCalls: Map<string, ToolCallInfo>,
): Pick<AppTreeEntry, "kind" | "role" | "text" | "meta" | "metaTimestamp"> {
	const entry = node.entry;
	const timestamp = new Date(entry.timestamp);
	const metadata = {
		meta: formatDateTime(timestamp),
		metaTimestamp: timestamp.toISOString(),
	};
	if (entry.type === "message") {
		const message = entry.message;
		if (message.role === "user") {
			return {
				kind: "user",
				role: "user",
				text: normalizeTreeText(extractTreeText(message.content)),
				...metadata,
			};
		}
		if (message.role === "assistant") {
			const text = normalizeTreeText(extractTreeText(message.content));
			const fallback =
				message.stopReason === "aborted"
					? "(aborted)"
					: message.errorMessage || "(no content)";
			return {
				kind: "assistant",
				role: "assistant",
				text: text || fallback,
				...metadata,
			};
		}
		if (message.role === "toolResult") {
			const toolCall = toolCalls.get(message.toolCallId);
			return {
				kind: "tool",
				role: toolCall?.name ?? message.toolName ?? "tool",
				text: toolCall ? formatToolDetail(toolCall.name, toolCall.arguments) : "",
				...metadata,
			};
		}
		if (message.role === "bashExecution") {
			return {
				kind: "tool",
				role: "bash",
				text: normalizeTreeText(message.command),
				...metadata,
			};
		}
		return { kind: "other", role: message.role, text: "", ...metadata };
	}
	if (entry.type === "custom_message") {
		return {
			kind: "other",
			role: entry.customType,
			text: normalizeTreeText(extractTreeText(entry.content)),
			...metadata,
		};
	}
	if (entry.type === "compaction") {
		return {
			kind: "other",
			role: "compaction",
			text: `${Math.round(entry.tokensBefore / 1000)}k tokens`,
			...metadata,
		};
	}
	if (entry.type === "branch_summary") {
		return {
			kind: "summary",
			role: "summary",
			text: normalizeTreeText(entry.summary),
			...metadata,
		};
	}
	if (entry.type === "model_change") {
		return { kind: "other", role: "model", text: entry.modelId, ...metadata };
	}
	if (entry.type === "thinking_level_change") {
		return {
			kind: "other",
			role: "thinking",
			text: entry.thinkingLevel,
			...metadata,
		};
	}
	if (entry.type === "custom") {
		return { kind: "other", role: "custom", text: entry.customType, ...metadata };
	}
	if (entry.type === "label") {
		return {
			kind: "other",
			role: "label",
			text: entry.label ?? "(cleared)",
			...metadata,
		};
	}
	return {
		kind: "other",
		role: "title",
		text: entry.name ?? "(empty)",
		...metadata,
	};
}

function formatToolDetail(name: string, args: JsonRecord): string {
	const path = String(args.path || args.file_path || "");
	switch (name) {
		case "read": {
			const offset = isNumber(args.offset) ? args.offset : undefined;
			const limit = isNumber(args.limit) ? args.limit : undefined;
			const range =
				offset !== undefined || limit !== undefined
					? `:${offset ?? 1}${limit !== undefined ? `-${(offset ?? 1) + limit - 1}` : ""}`
					: "";
			return `${path}${range}`;
		}
		case "write":
		case "edit":
			return path;
		case "bash": {
			const command = String(args.command || "")
				.replace(/[\n\t]+/g, " ")
				.trim();
			return `${command.slice(0, 80)}${command.length > 80 ? "..." : ""}`;
		}
		case "grep":
			return `/${String(args.pattern || "")}/ in ${path || "."}`;
		case "find":
			return `${String(args.pattern || "")} in ${path || "."}`;
		case "ls":
			return path || ".";
		default: {
			const serialized = JSON.stringify(args);
			return `${serialized.slice(0, 60)}${serialized.length > 60 ? "..." : ""}`;
		}
	}
}

function extractTreeText<Content>(content: Content): string {
	if (isString(content)) return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(item): item is { type: "text"; text: string } =>
				isRecord(item) && item.type === "text" && isString(item.text),
		)
		.map((item) => item.text)
		.join(" ");
}

function normalizeTreeText(text: string): string {
	return text
		.replace(/[\n\t]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 240);
}
