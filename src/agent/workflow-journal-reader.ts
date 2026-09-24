import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { truncateForDisplay } from "../live-workspace-types.ts";
import type { JsonValue } from "../utils/json-types.ts";
import { asRecord, isNumber, isString } from "../utils/type-guards.ts";

/**
 * Read-only reader for the `workflows` extension's run journals (Live Workspace depth, Round
 * 2): `~/.pi/workflows/projects/<slug>-<hash>/<runId>.json` (see the extension's `config.ts`
 * `PROJECTS_DIR`/`projectDir` and `journal.ts`'s `JournalOptions.dir` — reimplemented here as a
 * pure function rather than imported, so pi-ui has no runtime dependency on an extension that
 * may not be installed). Every read tolerates the directory or file being absent — the
 * extension may never have run for this workspace — and every field is defensively coerced,
 * since the journal is untrusted on-disk state another process (or an older version of the
 * extension) wrote.
 */

const maxAgentsSummarized = 100;
const maxPhasesSummarized = 50;
const textFieldLimit = 300;

export type WorkflowJournalAgentSummary = Readonly<{
	id: number;
	label: string;
	status: string;
	model?: string;
	tokens?: number;
	startedAt?: string;
	endedAt?: string;
	error?: string;
}>;

export type WorkflowJournalSummary = Readonly<{
	runId: string;
	workflowName: string;
	status: string;
	phases: readonly string[];
	agents: readonly WorkflowJournalAgentSummary[];
	startedAt?: string;
	updatedAt?: string;
	completedAt?: string;
}>;

/** `~/.pi/workflows/projects/<slug>` for a working directory — mirrors the `workflows`
 * extension's `config.ts` `projectDir()` exactly (same slug + hash algorithm), independently,
 * so a mismatch there cannot silently point pi-ui at the wrong directory. */
export function workflowProjectDir(cwd: string): string {
	const base =
		cwd
			.replace(/[\\/]+$/, "")
			.split(/[\\/]/)
			.pop() || "project";
	const slug =
		base
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "") || "project";
	return join(homedir(), ".pi", "workflows", "projects", `${slug}-${shortHash(cwd)}`);
}

function shortHash(input: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < input.length; index++) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The most recently updated run journal for a workspace, or `undefined` if none exists —
 * absence (no directory, no runs yet, the extension isn't installed) is expected, not an error. */
export async function readLatestWorkflowJournal(
	cwd: string,
): Promise<WorkflowJournalSummary | undefined> {
	const dir = workflowProjectDir(cwd);
	let entries: string[];
	try {
		entries = (await readdir(dir)).filter((name) => name.endsWith(".json"));
	} catch {
		return undefined;
	}
	if (entries.length === 0) return undefined;
	const withMtime = await Promise.all(
		entries.map(async (name) => {
			try {
				const stats = await stat(join(dir, name));
				return { mtimeMs: stats.mtimeMs, name };
			} catch {
				return undefined;
			}
		}),
	);
	const newest = withMtime
		.filter((entry) => entry !== undefined)
		.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
	if (!newest) return undefined;
	try {
		const raw = await readFile(join(dir, newest.name), "utf8");
		return summarizeJournal(JSON.parse(raw));
	} catch {
		return undefined;
	}
}

function summarizeJournal(value: JsonValue): WorkflowJournalSummary | undefined {
	const record = asRecord(value);
	if (!record || !isString(record.runId) || !isString(record.workflowName))
		return undefined;
	const phases = Array.isArray(record.phases)
		? record.phases.filter(isString).slice(0, maxPhasesSummarized)
		: [];
	const agents = Array.isArray(record.agents)
		? record.agents
				.slice(0, maxAgentsSummarized)
				.map(summarizeAgent)
				.filter((agent) => agent !== undefined)
		: [];
	return {
		runId: record.runId,
		workflowName: truncateForDisplay(record.workflowName, textFieldLimit),
		status: isString(record.status) ? record.status : "unknown",
		phases,
		agents,
		startedAt: isString(record.startedAt) ? record.startedAt : undefined,
		updatedAt: isString(record.updatedAt) ? record.updatedAt : undefined,
		completedAt: isString(record.completedAt) ? record.completedAt : undefined,
	};
}

function summarizeAgent(value: JsonValue): WorkflowJournalAgentSummary | undefined {
	const record = asRecord(value);
	if (!record || !isNumber(record.id)) return undefined;
	const usage = asRecord(record.usage);
	return {
		id: record.id,
		label: truncateForDisplay(
			isString(record.label) ? record.label : `agent ${record.id}`,
			textFieldLimit,
		),
		status: isString(record.status) ? record.status : "unknown",
		model: isString(record.model) ? record.model : undefined,
		tokens: isNumber(record.tokens)
			? record.tokens
			: usage && isNumber(usage.total)
				? usage.total
				: undefined,
		startedAt: isString(record.startedAt) ? record.startedAt : undefined,
		endedAt: isString(record.endedAt) ? record.endedAt : undefined,
		error: isString(record.error)
			? truncateForDisplay(record.error, textFieldLimit)
			: undefined,
	};
}
