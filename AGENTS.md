## Docs

Read relevant docs in full before implementing against them:

- Bun docs: https://bun.sh/docs
- Bun docs repo mirror: `~/docs/bun/` (https://github.com/oven-sh/bun)
- Datastar docs under `~/docs/datastar-docs/` (`tao.md` and `opinions.md` set the defaults), source under `~/docs/datastar/`, Pro and Rocket under `~/docs/datastar-pro/` and `~/docs/datastar-rocket/`
- Kita docs/source under `~/docs/kita-docs/` and `~/docs/kitajs-html/`
- Open Props docs/source under `~/docs/open-props/`
- Modern web guidance under `~/docs/modern-web-guidance/skills/modern-web-guidance/guides/`
- pi coding-agent docs under `~/docs/pi/packages/coding-agent/`

## Project conventions

- Runtime: Bun server with a browser UI.
- Browser target: Baseline newly available. Prefer native platform features; do not add non-Baseline features or polyfills for unsupported browsers.
- Interactivity: Datastar. The server writes the SSE protocol directly in `src/server/datastar.ts`; do not add an SDK.
- HTML rendering: Kita JSX (`@kitajs/html`), not React.
- Markdown rendering: `@pierre/words` with Pierre Highlights (`@pierre/words/highlights`) for code highlighting and Pele for Mermaid diagrams.
- Styling: project-owned semantic CSS over selective Open Props primitive packs, with central foundations and colocated feature styles.
- Project-owned UI colors use OKLCH, including translucent overlays and shadows; externally supplied code-highlighting themes are exempt.
- Shared controls use native HTML plus semantic classes and `data-*` variants or sizes; do not wrap basic elements in Kita components solely for styling.
- Distribution: compile standalone executables with `bun build --compile`; release workflows build on each target platform.
- Prefer backend-owned UI state; use frontend signals only for local UI state and writes.
- Datastar attributes in TSX: use normal JSX attributes unless the attribute name contains a `.` and must be passed another way.
- Datastar write interactions send signals with `@post()`. Use `<form>` only for native validation, and never for form-encoded submission.

## Validation

Run targeted checks during development. Before committing code changes, run:

```sh
bun run assets:build && bun run fmt && bun run lint && bun run check && bun test
```
