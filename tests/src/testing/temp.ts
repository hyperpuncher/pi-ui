import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function makeTempDir(options: { prefix?: string } = {}): Promise<string> {
	return mkdtemp(join(tmpdir(), options.prefix ?? "pi-ui-test-"));
}

export async function makeTempFile(
	options: { prefix?: string; suffix?: string } = {},
): Promise<string> {
	const path = join(
		tmpdir(),
		`${options.prefix ?? "pi-ui-test-"}${crypto.randomUUID()}${options.suffix ?? ""}`,
	);
	await Bun.write(path, "");
	return path;
}
