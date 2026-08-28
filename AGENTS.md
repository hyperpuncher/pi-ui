## Docs

Read relevant docs in full before implementing against them:

- Bun docs: https://bun.sh/docs
- Bun docs repo mirror: `~/docs/bun/` (https://github.com/oven-sh/bun)
- Basecoat docs LLM index: https://basecoatui.com/llms.txt
- Datastar docs already mirrored under `~/docs/datastar-docs/`
- Datastar TypeScript SDK docs/source under `~/docs/datastar-typescript/`
- pi coding-agent docs under `~/docs/pi/packages/coding-agent/`

## Project conventions

- Runtime: Bun server with a browser UI.
- Interactivity: Datastar, using `@starfederation/datastar-sdk` server-side.
- HTML rendering: Kita JSX (`@kitajs/html`), not React.
- Markdown rendering: Bun Markdown with HTMLRewriter sanitization plus Shiki for finalized code highlighting.
- Styling: Tailwind utilities + Basecoat Nova. Avoid custom CSS unless unavoidable.
- Distribution: compile standalone executables with `bun build --compile`; release workflows build on each target platform.
- Prefer backend-owned UI state; use frontend signals only for local UI state and writes.
- Datastar attributes in TSX: use normal JSX attributes unless the attribute name contains a `.` and must be passed another way.
- Datastar write interactions should use signals + `@post()`, not forms.

## Validation

Before finishing code changes, run:

```sh
bun run css:build && bun run fmt && bun run lint && bun run check && bun test
```
