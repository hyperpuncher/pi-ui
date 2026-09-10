# anti-slop provenance

Vendored Oxlint plugin. This record describes how the local tree was derived and what
the repository owns.

## Installed paths

- Generic plugin entry point: `tools/oxlint/anti-slop/index.ts`
- Rules: `tools/oxlint/anti-slop/rules/`
- Shared helpers: `tools/oxlint/anti-slop/shared/`
- Oxlint configuration: `.oxlintrc.json` (`jsPlugins` + `rules`)

The optional Effect plugin is not installed. The repository has no direct `effect`
dependency, so the opt-in rules were intentionally removed in commit `4d0926f`.

## Source identity

- Source repository: unknown. The installation came from the `install-anti-slop` skill
  bundle, which carries no upstream repository URL or revision.
- Incoming snapshot: skill bundle `assets/anti-slop` as installed on 2026-09-10.
  Aggregate SHA-256 of the sorted bundle files: `304040ae36e9a83124f2e001e684998449e65665af4fa1534a0802290c636de2`.
- Pristine upstream bytes use 2-space indentation. The repository normalizes vendored
  files with oxfmt (`useTabs: true`, `printWidth: 90`) as part of `bun run fmt`.

## Recoverable base

- Base revision: git commit `041a43b52a4ce000e5f70eeb226cdbe5c96336ef`
  (`chore: update anti-slop lint plugin`), which committed the previous installation
  snapshot.
- The base is recoverable with `git show 041a43b:tools/oxlint/anti-slop/...`.
- No `UPSTREAM.md` existed before this record, so earlier installations had no recorded
  provenance.

## Adopted in this update

Diff of incoming snapshot against the base, after normalizing the incoming files with
oxfmt, contained only these additions:

- `rules/no-array-filter-map.ts` (new rule)
- `rules/no-reduce-accumulator-copy.ts` (new rule)
- `shared/array-method.ts` (new helper used by both rules)
- `index.ts` registration of `no-array-filter-map` and `no-reduce-accumulator-copy`
- `.oxlintrc.json`: enabled `anti-slop/no-array-filter-map`,
  `anti-slop/no-reduce-accumulator-copy`, and native `oxc/no-accumulating-spread` at
  `"error"`.

All other vendored files were unchanged between the base and the incoming snapshot once
formatting was normalized.

## Intentional local deviations from the incoming snapshot

- `effect/` is not installed (removed in `4d0926f`; no direct `effect` dependency).
- `shared/dictionary-types.ts` omits `isPopulatedObjectExpression`, removed in `4d0926f`
  as audited dead code. Neither adopted rule depends on it.
- Vendored files are formatted with the repository oxfmt configuration rather than the
  upstream 2-space style.

## Dependencies

- `oxlint` and `@oxlint/plugins` are both pinned to `1.82.0`; they move together.
- `@oxlint/plugins` does not export a `RuleTester`, so focused rule tests use the real
  Oxlint CLI against representative accepted and rejected sources.

## Verification

- `bunx oxlint` loads the merged plugin and reports the new rules.
- Scratch sources: `filter().map()` reports `anti-slop/no-array-filter-map`;
  `Object.assign({}, acc, ...)`, `Array.from(acc)`, and `acc.slice()` reports
  `anti-slop/no-reduce-accumulator-copy`; `[...acc, ...]` reports
  `oxc/no-accumulating-spread`. `.values().filter().map().toArray()`, `flatMap`, and
  mutating a fresh accumulator are accepted.
- `bunx oxfmt --check tools/oxlint/anti-slop .oxlintrc.json` passes.
- `bun run check` (schema check + `tsc --noEmit`) passes.
- `bun test` passes: 507 pass, 1 todo, 0 fail.
- `bunx oxlint` over the project currently reports 4 `anti-slop/no-array-filter-map`
  findings in owned source (see below). These are application cleanup requiring owner
  authorization; rule severity was not lowered.

### Pending application findings

- `src/agent/session-catalog.ts:338`
- `src/client/workspace-review-comments.ts:166`
- `src/ui/ui-renderer.ts:403`
- `src/ui/ui-renderer.ts:438`
