import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `bunfig.toml`'s `[test]` `preload` — runs once, before any test file is
 * imported, for the whole `bun test` process. Round 6 F5: points this app's
 * cache directory (`src/utils/app-dirs.ts`'s `PI_UI_CACHE_DIR` override) at a
 * fresh temp directory instead of the real `%LOCALAPPDATA%\pi-ui\Cache` (or
 * the XDG/macOS equivalent), so `session-summary-cache.ts`'s cache-file
 * writes — reached indirectly through `SessionCatalog.prepare()`/
 * `refreshSessionFile()` by any e2e test that spins up a real runtime without
 * threading an explicit `cachePath` override through — can never race a real
 * running pi-ui over the same file (round-5 audit finding 7, an intermittent
 * `EPERM` on rename). A test that already passes its own explicit
 * `cachePath`/`sessionsRoot` (most of `session-summary-cache_test.ts`,
 * `session-catalog_test.ts`) is unaffected either way.
 *
 * Skipped when already set (a caller running a narrower/targeted `bun test`
 * invocation with its own `PI_UI_CACHE_DIR` keeps it), and best-effort on
 * cleanup: a leftover temp directory from an interrupted run is harmless.
 * Cleanup is a global `afterAll` (a preload's hooks run once, after every test
 * file) because `bun test` fires neither `exit` nor `beforeExit` for a
 * preload's listeners, which left one temp directory behind per run.
 */
if (!process.env.PI_UI_CACHE_DIR) {
	const dir = mkdtempSync(join(tmpdir(), "pi-ui-test-cache-"));
	process.env.PI_UI_CACHE_DIR = dir;
	afterAll(() => {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// Best-effort: a file still open on Windows at exit isn't worth failing over.
		}
	});
}
