## Docs

Read relevant docs in full before implementing against them:

- Bun docs: https://bun.sh/docs
- Bun docs repo mirror: `~/docs/bun/` (https://github.com/oven-sh/bun)
- Datastar docs already mirrored under `~/docs/datastar-docs/`
- Datastar TypeScript SDK docs/source under `~/docs/datastar-typescript/`
- Open Props docs/source under `~/docs/open-props/`
- pi coding-agent docs under `~/docs/pi/packages/coding-agent/`

## Project conventions

- Runtime: Bun server with a browser UI.
- Interactivity: Datastar, using `@starfederation/datastar-sdk` server-side.
- HTML rendering: Kita JSX (`@kitajs/html`), not React.
- Markdown rendering: Bun Markdown with HTMLRewriter sanitization plus Shiki for finalized code highlighting.
- Styling: project-owned semantic CSS over selective Open Props primitive packs, with central foundations and colocated feature styles.
- Project-owned UI colors use OKLCH, including translucent overlays and shadows; externally supplied code-highlighting themes are exempt.
- Shared controls use native HTML plus semantic classes and `data-*` variants or sizes; do not wrap basic elements in Kita components solely for styling.
- Distribution: compile standalone executables with `bun build --compile`; release workflows build on each target platform.
- Prefer backend-owned UI state; use frontend signals only for local UI state and writes.
- Datastar attributes in TSX: use normal JSX attributes unless the attribute name contains a `.` and must be passed another way.
- Datastar write interactions should use signals + `@post()`, not forms.

## Validation

Before finishing code changes, run:

```sh
bun run css:build && bun run fmt && bun run lint && bun run check && bun test
```
