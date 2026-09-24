import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fileSymlinkSupport: boolean | undefined;

/**
 * Whether this OS user can create a real *file* symlink without elevation.
 * On Windows that requires either an elevated process or Developer Mode's
 * `SeCreateSymbolicLinkPrivilege`; lacking both, `fs.symlink` throws `EPERM`
 * for every symlink type. Unlike a directory symlink (see {@link symlinkDir}),
 * there is no privilege-free NTFS equivalent for a *file* reparse point, so
 * tests that must create one skip themselves on a host that lacks the
 * capability, via `test.skipIf(!hasFileSymlinkSupport())`, rather than
 * failing on an environment limitation the test isn't exercising.
 */
export function hasFileSymlinkSupport(): boolean {
	if (fileSymlinkSupport !== undefined) return fileSymlinkSupport;
	if (process.platform !== "win32") {
		fileSymlinkSupport = true;
		return true;
	}
	const dir = mkdtempSync(join(tmpdir(), "pi-ui-symlink-probe-"));
	try {
		const target = join(dir, "target.txt");
		writeFileSync(target, "");
		symlinkSync(target, join(dir, "link.txt"), "file");
		fileSymlinkSupport = true;
	} catch {
		fileSymlinkSupport = false;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	return fileSymlinkSupport;
}

/**
 * Creates a directory symlink at `path` pointing at `target`, falling back to
 * an NTFS junction on Windows when the process lacks
 * `SeCreateSymbolicLinkPrivilege`. A junction is a privilege-free reparse
 * point that Node reports as `isSymbolicLink()` and resolves via
 * `realpath`/`readlink` exactly like a real directory symlink, so it is a
 * faithful, portable stand-in for tests that only ever target a directory —
 * unlike a file symlink (see {@link hasFileSymlinkSupport}), which has no
 * privilege-free Windows equivalent. `target` must be absolute: junctions
 * do not support relative targets.
 */
export async function symlinkDir(target: string, path: string): Promise<void> {
	if (process.platform !== "win32") {
		await symlink(target, path, "dir");
		return;
	}
	try {
		await symlink(target, path, "dir");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
		await symlink(target, path, "junction");
	}
}
