import type {
	AgentSessionRuntime,
	SessionTreeNode,
} from "@earendil-works/pi-coding-agent";

import type { AppStore, AppTreeEntry } from "../state/app-store.ts";
import { formatDateTime } from "../utils/locale.ts";
import { isRecord } from "../utils/type-guards.ts";

type TreeState = Pick<AppStore, "setTreeEntries">;

export type TreeNavigationResult =
	| { status: "success"; editorText?: string }
	| { status: "busy" }
	| { status: "cancelled" };

export class TreeProjector {
	private readonly navigations = new Map<
		unknown,
		{ session: AgentSessionRuntime["session"] }
	>();

	constructor(
		private readonly getRuntime: () => AgentSessionRuntime,
		private readonly state: TreeState,
		private readonly onNavigated: () => void = () => {},
		private readonly getOwnerToken: () => unknown = () => getRuntime().session,
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
		rows.push({
			id: node.entry.id,
			parentId: node.entry.parentId,
			prefix: buildTreePrefix(indent, showConnector, isLast, gutters),
			continuationPrefix: buildTreeContinuationPrefix(
				indent,
				showConnector,
				isLast,
				gutters,
			),
			label: node.label,
			active: node.entry.id === activeId,
			inPath: pathIds.has(node.entry.id),
			...formatTreeEntry(node),
		});

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

function buildTreeContinuationPrefix(
	indent: number,
	showConnector: boolean,
	isLast: boolean,
	gutters: boolean[],
): string {
	if (indent === 0 && !showConnector) return "";
	const parts: string[] = [];
	for (let position = 0; position < indent; position += 1) {
		if (position === indent - 1 && showConnector) {
			parts.push(isLast ? "   " : "│  ");
		} else {
			parts.push(gutters[position] ? "│  " : "   ");
		}
	}
	return parts.join("");
}

function formatTreeEntry(
	node: SessionTreeNode,
): Pick<AppTreeEntry, "role" | "text" | "meta"> {
	const entry = node.entry;
	const meta = formatDateTime(new Date(entry.timestamp));
	if (entry.type === "message") {
		const message = entry.message;
		if (message.role === "user") {
			return {
				role: "user: ",
				text: normalizeTreeText(extractTreeText(message.content)),
				meta,
			};
		}
		if (message.role === "assistant") {
			const text = normalizeTreeText(extractTreeText(message.content));
			return { role: "assistant: ", text: text || "(no text)", meta };
		}
		if (message.role === "toolResult") {
			return { role: "tool: ", text: message.toolName ?? "tool", meta };
		}
		if (message.role === "bashExecution") {
			return { role: "bash: ", text: normalizeTreeText(message.command), meta };
		}
		return { role: `${message.role}: `, text: "", meta };
	}
	if (entry.type === "custom_message") {
		return {
			role: `${entry.customType}: `,
			text: normalizeTreeText(extractTreeText(entry.content)),
			meta,
		};
	}
	if (entry.type === "compaction") {
		return {
			role: "compaction: ",
			text: `${Math.round(entry.tokensBefore / 1000)}k tokens`,
			meta,
		};
	}
	if (entry.type === "branch_summary") {
		return { role: "branch summary: ", text: normalizeTreeText(entry.summary), meta };
	}
	if (entry.type === "model_change") {
		return { role: "model: ", text: entry.modelId, meta };
	}
	if (entry.type === "thinking_level_change") {
		return { role: "thinking: ", text: entry.thinkingLevel, meta };
	}
	if (entry.type === "custom") {
		return { role: "custom: ", text: entry.customType, meta };
	}
	if (entry.type === "label") {
		return { role: "label: ", text: entry.label ?? "(cleared)", meta };
	}
	return { role: "title: ", text: entry.name ?? "(empty)", meta };
}

function extractTreeText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(item): item is { type: "text"; text: string } =>
				isRecord(item) && item.type === "text" && typeof item.text === "string",
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
