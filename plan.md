# pi-ui plan

## Vision

Build **pi GUI**: a keyboard-first, normy-friendly desktop app for pi as a general agent runtime.

This is not an IDE first. Coding is a killer workflow, but the app should feel useful for chat, writing, research, local automation, files, terminal work, and custom agent workflows.

## Product principles

- **Pi-native**: use pi sessions, models, providers, skills, prompts, extensions, tools, trust, and config.
- **Keyboard-first**: every action is reachable without mouse; keybindings are user-configurable.
- **Normy-friendly by default**: hide internals behind clear labels and progressive disclosure.
- **Power-user deep**: command palette, vim-like navigation, slash commands, custom workflows, inspectable tool calls.
- **Desktop-consistent**: use CEF for consistent rendering on macOS, Windows, and Linux.
- **Great Linux support**: Wayland, scaling, IME, clipboard, GPU, and window behavior are release gates.
- **Backend-owned UI**: Datastar + SSE, with frontend signals only for local interaction.

## Current progress

- Deno 2.9.1 confirmed with `deno desktop` available.
- Initial Deno app shell created.
- CEF desktop task added.
- Datastar SSE patch helper added.
- Keyboard-first shell started with command palette, new chat, and model picker shortcuts.
- Initial app command registry added for shared shortcut/menu metadata.
- Pi SDK npm import smoke test passes in Deno.
- `AgentHost` now creates a real pi `AgentSessionRuntime`.
- Prompt route is wired to `session.prompt()` with preflight acceptance.
- Basic pi event rendering is wired: user/assistant/tool/system messages.
- Default model is `opencode-go/deepseek-v4-flash` with thinking off for tests.
- Tool messages now have structured running/success/error card states.
- Inspector removed; UI simplified to topbar, transcript, floating composer, and command palette.
- Tailwind CSS and Basecoat are installed via Deno npm imports.
- Basecoat Nova is the default style pack.
- New chat starts a fresh pi session via `runtime.newSession()`.
- UI rendering migrated to Kita JSX v5 (`@kitajs/html@next`).
- Datastar interactions now avoid forms for prompt/model writes and use signals + `@post()`.
- Datastar TypeScript SDK is used for SSE streams, signal reads, and patch responses.
- Datastar browser bundle is self-hosted from `static/vendor/datastar.js` for desktop/offline use.
- Custom CSS reduced to Tailwind/Basecoat imports; layout lives in TSX classes.

## Stack

- Runtime/windowing: `deno desktop`
- Web engine: CEF backend by default
- Interactivity: Datastar + `@starfederation/datastar-sdk`
- Styling/components: Tailwind CSS + Basecoat Nova + Kita JSX components
- Agent runtime: `@earendil-works/pi-coding-agent` SDK
- Deno tasks:
    - `check`: `deno check src/main.ts`
    - `css:build`: `deno run -A @tailwindcss/cli -i src/ui/styles.css -o static/app.css --minify`
    - `dev`: `deno task css:build && deno run -A --watch src/main.ts`
    - `desktop`: `deno task css:build && deno desktop -A --backend cef --hmr src/main.ts`
    - `desktop:build:linux`: `deno task css:build && deno desktop -A --backend cef --output dist/pi-ui.AppImage src/main.ts`
    - `fmt`: `~/projects/dsfmt/target/release/dsfmt --write . ; deno run -A npm:oxfmt`
    - `lint`: `deno run -A npm:oxlint`

## Architecture

```txt
Deno desktop process
├─ CEF BrowserWindow
├─ Deno.serve HTTP app
├─ AgentHost
│  ├─ createAgentSessionRuntime()
│  ├─ active AgentSession
│  ├─ extension UI bridge
│  └─ event → view-model reducer
├─ Datastar SSE streams
└─ server-rendered HTML fragments
```

### Current modules

- `main.ts`: starts `Deno.serve()`.
- `server/app.ts`: routes and static files.
- `server/datastar.ts`: thin Datastar SDK wrapper for streams, signal reads, and write responses.
- `agent/host.ts`: pi SDK runtime wrapper and event reducer.
- `agent/sdk-smoke.ts`: pi SDK import smoke test.
- `state/app-state.ts`: UI state and SSE patch broadcast.
- `ui/page.tsx`: initial shell render with Kita JSX.
- `ui/fragments.tsx`: server-rendered UI fragments with Kita JSX.
- `ui/styles.css`: Tailwind + Basecoat Nova imports.
- `static/app.css`: generated CSS output.
- `static/app.js`: small browser helpers for composer focus/autosize, transcript autoscroll, and palette focus.

## Current UI direction

Minimal, Chatski-like shell:

```txt
┌ topbar: commands/status/new-chat ┐
│                                  │
│             transcript           │
│                                  │
│      floating composer card      │
│      tools | model | abort | send│
└──────────────────────────────────┘
```

No inspector/sidebar by default. Power-user surfaces should appear via command palette, dialogs, drawers, or optional panels only when needed.

## Keyboard system

The command system is the spine of the app.

Default shortcuts:

- `Ctrl/Cmd+K`: command palette
- `Ctrl/Cmd+L`: model picker
- `Ctrl/Cmd+O`: new chat/session
- `Ctrl/Cmd+R`: resume/search sessions
- `Enter`: send
- `Shift+Enter`: newline
- `Esc`: close modal / blur / normal mode
- `/`: slash command picker
- `@`: file/context picker
- `Ctrl/Cmd+.`: quick actions for selected item

Vim mode goals:

- normal/insert distinction for transcript navigation and composer focus
- `j/k`: next/previous message or item
- `gg/G`: first/last message
- `o/O`: open composer below/above current context where meaningful
- `Enter`: open/expand selected item
- `Space`: leader key for command groups

Keybindings should be stored in a user-editable JSON file and editable from the GUI.

## Datastar interaction model

- One long-lived stream per window/session for read-side updates.
- Short `POST` requests for commands and writes.
- Backend patches full fragments instead of micro-managing DOM.
- Frontend signals only for local UI state: composer draft, modal open state, selected tab, filters.
- Avoid optimistic updates for agent/tool state; patch from backend truth.

## Pi SDK integration

Use SDK directly first:

- `createAgentSessionRuntime()` for session replacement flows.
- Rebind event subscriptions after `newSession`, `switchSession`, `fork`, and import.
- Subscribe to `AgentSessionEvent`s and reduce into GUI state.
- Use `preflightResult` so prompt requests return after acceptance while streaming continues over SSE.
- Preserve pi project trust behavior.

RPC mode remains a fallback only if Deno npm/Node compatibility blocks SDK embedding.

## Extension UI bridge

Browser-compatible `ExtensionUIContext`:

- `select` → app picker modal
- `confirm` → app confirmation modal
- `input` → app input modal
- `editor` → app text editor modal
- `notify` → toast
- `setStatus` → topbar/status area
- `setWidget` string arrays → extension widgets panel
- terminal-only custom TUI components → unsupported initially, with clear fallback

## MVP

1. Deno desktop CEF app boots on Linux.
2. Datastar page loads and receives SSE patches.
3. Pi SDK runtime can start a persistent session.
4. User can send a prompt and stream assistant output.
5. Basic message renderers: user, assistant markdown/plain text, errors.
6. Tool cards: read, bash, edit, write.
7. Abort current run.
8. New/resume session.
9. Model picker.
10. Command palette and initial keybinding registry.
11. Extension dialogs: select/confirm/input/notify/status.
12. Linux Wayland smoke test.

## Roadmap

### Phase 0: feasibility spike

- Prove Deno can import and run `@earendil-works/pi-coding-agent`.
- Prove CEF desktop window + local `Deno.serve` + Datastar stream.
- Prove prompt streaming and one tool call.
- Document blockers.

### Phase 1: core app shell

- Window shell and layout.
- Transcript view.
- Composer.
- Command palette.
- Keybinding registry.
- Basic settings persistence.

### Phase 2: pi parity essentials

- Sessions: new, resume, fork/clone basics.
- Models and thinking levels.
- Slash commands, prompts, skills discovery.
- Project trust UI.
- Tool renderers and diff viewer.

### Phase 3: normy polish

- Friendly onboarding.
- Profiles: General, Coding, Writing, Research, Terminal.
- Better empty states and explanations.
- Rich notifications and errors.
- Theme support.

### Phase 4: power-user features

- Vim mode.
- Full custom keybindings UI.
- Session tree UI.
- Extension/package manager.
- Advanced inspect/debug panels.
- Import/export/share.

### Phase 5: distribution

- Deno desktop release builds.
- CEF backend for all platforms.
- Auto-update when ready.
- Linux AppImage first.
- macOS signing/notarization path.
- Windows installer path.

## Linux / Wayland release gates

- GNOME Wayland
- KDE Wayland
- X11 fallback
- fractional scaling
- multi-monitor DPI
- IME
- clipboard
- drag/drop files
- GPU/WebGL
- window decorations
- AppImage behavior

CEF flags to investigate:

```txt
--ozone-platform-hint=auto
--enable-wayland-ime
--enable-features=WaylandWindowDecorations
```

Prefer automatic Wayland/X11 selection, with explicit escape hatches in settings/env vars.

## Open questions

- Does Deno npm compat fully support pi SDK and its Node/runtime assumptions?
- Which Deno desktop CEF version ships with Wayland/ANGLE improvements?
- How should GUI app config map to existing `~/.pi/agent` config?
- Should non-coding sessions have no cwd, or always use a default workspace directory?
- What is the right name for the app/package?
