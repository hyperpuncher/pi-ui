import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { truncateForDisplay } from "../live-workspace-types.ts";
import type { JsonValue } from "../utils/json-types.ts";
import { asRecord, isNumber, isString } from "../utils/type-guards.ts";
import { expandHomePath } from "../utils/workspace.ts";

/**
 * Read-only reader for the `pi-herdr-delegate` extension's delegation ledger (Live Workspace
 * depth, Round 2): one JSON file per delegation under `<delegateDir>/ledger/<id>.json` (see the
 * extension's `config.ts` `delegateDir()` and `ledger.ts`'s `parseRecord`, reimplemented here
 * rather than imported for the same no-runtime-dependency reason as the workflow journal
 * reader). Tolerates the directory or any individual file being absent or malformed — the
 * extension may not be installed, and this is another process's untrusted on-disk state.
 */

const maxDelegationsListed = 50;
const textFieldLimit = 300;
const delegationIdPattern = /^dlg-[0-9a-f]{12}$/;

export type DelegateLedgerEntry = Readonly<{
	delegationId: string;
	childName?: string;
	prompt: string;
	model?: string;
	status: string;
	delegatedAt: number;
	reportAt?: number;
	reportStatus?: string;
	reportSummary?: string;
	lastError?: string;
}>;

/** `<delegateDir>/ledger` — `PI_HERDR_DELEGATE_DIR` overrides `<delegateDir>` itself exactly like
 * the extension's `config.ts` does, falling back to `<agentDir>/pi-herdr-delegate` (which itself
 * honors `PI_CODING_AGENT_DIR`). */
export function delegateLedgerDir(env: NodeJS.ProcessEnv = process.env): string {
	const override = env.PI_HERDR_DELEGATE_DIR?.trim();
	const delegateDir = override
		? resolve(expandHomePath(override))
		: join(getAgentDir(), "pi-herdr-delegate");
	return join(delegateDir, "ledger");
}

/** The most recent delegations, newest first. Absence (no delegations yet, the extension isn't
 * installed) is expected, not an error — returns an empty list rather than throwing. */
export async function listRecentDelegations(
	env: NodeJS.ProcessEnv = process.env,
): Promise<DelegateLedgerEntry[]> {
	const dir = delegateLedgerDir(env);
	let names: string[];
	try {
		names = (await readdir(dir)).filter(
			(name) =>
				name.endsWith(".json") && delegationIdPattern.test(name.slice(0, -5)),
		);
	} catch {
		return [];
	}
	const records = await Promise.all(
		names.map(async (name) => {
			try {
				return parseDelegation(
					JSON.parse(await readFile(join(dir, name), "utf8")),
				);
			} catch {
				return undefined;
			}
		}),
	);
	return records
		.filter((entry) => entry !== undefined)
		.sort((a, b) => b.delegatedAt - a.delegatedAt)
		.slice(0, maxDelegationsListed);
}

function parseDelegation(value: JsonValue): DelegateLedgerEntry | undefined {
	const record = asRecord(value);
	if (
		!record ||
		!isString(record.delegationId) ||
		!delegationIdPattern.test(record.delegationId) ||
		!isString(record.prompt) ||
		!isNumber(record.delegatedAt)
	) {
		return undefined;
	}
	return {
		delegationId: record.delegationId,
		childName: isString(record.childName) ? record.childName : undefined,
		prompt: truncateForDisplay(record.prompt, textFieldLimit),
		model: isString(record.model) ? record.model : undefined,
		status: isString(record.status) ? record.status : "unknown",
		delegatedAt: record.delegatedAt,
		reportAt: isNumber(record.reportAt) ? record.reportAt : undefined,
		reportStatus: isString(record.reportStatus) ? record.reportStatus : undefined,
		reportSummary: isString(record.reportSummary)
			? truncateForDisplay(record.reportSummary, textFieldLimit)
			: undefined,
		lastError: isString(record.lastError)
			? truncateForDisplay(record.lastError, textFieldLimit)
			: undefined,
	};
}
