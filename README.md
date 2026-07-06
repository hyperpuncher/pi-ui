# pi-ui

keyboard-first desktop gui for [pi](https://pi.dev).

<div>
	<picture>
		<source
			srcset=".github/assets/screenshot-dark.png"
			media="(prefers-color-scheme: dark)"
		>
		<source
			srcset=".github/assets/screenshot-light.png"
			media="(prefers-color-scheme: light)"
		>
		<img src=".github/assets/screenshot-dark.png" alt="pi-ui screenshot">
	</picture>
</div>

same power as the pi tui, packaged as a normy-friendly desktop app:

- agent runtime, sessions, and session tree
- tools, skills, slash commands, and `@` files
- workspaces, models, thinking levels, and compaction

built with:

- [deno desktop](https://docs.deno.com/runtime/desktop/)
- [datastar](https://data-star.dev/)
- [kita jsx](https://github.com/kitajs/html)
- [sätteri](https://github.com/bruits/satteri)
- [shiki](https://shiki.style/)
- [basecoat](https://basecoatui.com/)

## install

### arch

```sh
paru -S pi-ui-bin
```

### mac

```sh
brew install --cask hyperpuncher/tap/pi-ui
```

## keybinds

| key          | action               |
| ------------ | -------------------- |
| `ctrl/cmd+k` | command menu         |
| `ctrl/cmd+o` | new session          |
| `ctrl/cmd+r` | session picker       |
| `ctrl/cmd+l` | model picker         |
| `alt+t`      | cycle thinking level |
| `/`          | slash commands       |
| `@`          | file picker          |
| `j` / `k`    | scroll messages      |
| `gg` / `G`   | top / bottom         |
| `gi`         | focus prompt         |

## license

mit
