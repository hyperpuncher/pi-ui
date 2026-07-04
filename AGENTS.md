## Docs

Read relevant docs in full before implementing against them:

- Deno docs LLM index: https://docs.deno.com/llms.txt
- Deno docs repo mirror: `~/docs/deno-docs/` (https://github.com/denoland/docs)
- Deno Desktop docs: https://docs.deno.com/runtime/desktop/index.md
    - Configuration: https://docs.deno.com/runtime/desktop/configuration.md
    - Backends: https://docs.deno.com/runtime/desktop/backends.md
    - HTTP serving: https://docs.deno.com/runtime/desktop/serving.md
    - Windows/events: https://docs.deno.com/runtime/desktop/windows.md
    - Bindings: https://docs.deno.com/runtime/desktop/bindings.md
    - Menus/accelerators: https://docs.deno.com/runtime/desktop/menus.md
    - DevTools: https://docs.deno.com/runtime/desktop/devtools.md
    - Distribution: https://docs.deno.com/runtime/desktop/distribution.md
- Basecoat docs LLM index: https://basecoatui.com/llms.txt
- Datastar docs already mirrored under `~/docs/datastar-docs/`
- Datastar TypeScript SDK docs/source under `~/docs/datastar-typescript/`
- pi coding-agent docs under `~/docs/pi/packages/coding-agent/`

## Project conventions

- Runtime/windowing: Deno Desktop with CEF by default.
- Interactivity: Datastar, using `@starfederation/datastar-sdk` server-side.
- HTML rendering: Kita JSX (`@kitajs/html`), not React.
- Styling: Tailwind utilities + Basecoat Nova. Avoid custom CSS unless unavoidable.
- Prefer backend-owned UI state; use frontend signals only for local UI state and writes.
- Datastar attributes in TSX: use normal JSX attributes unless the attribute name contains a `.` and must be passed another way.
- Datastar write interactions should use signals + `@post()`, not forms.

## Validation

Before finishing code changes, run:

```sh
deno task css:build && deno task fmt && deno task lint && deno task check
```
