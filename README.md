# pi-ui

keyboard-first minimal gui for [`pi`](https://pi.dev)

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

## features

- background sessions
- git review with commit history and inline comments
- markdown, syntax highlighting, and rich diffs
- file attachments with image previews

## built with

- [`datastar`](https://data-star.dev/)
- [`kita-jsx`](https://github.com/kitajs/html)
- [`pierre-diffs`](https://diffs.com/)

## try

> requires bun 1.4+

```sh
bunx @hyperpuncher/pi-ui
```

## install

### quick install

> the quick installers start pi-ui in the background and at login

#### linux and macos

```sh
curl -fsSL https://pi-ui.app/install | sh
```

#### windows

```powershell
irm https://pi-ui.app/install.ps1 | iex
```

open [http://127.0.0.1:31415](http://127.0.0.1:31415) in your browser

### package managers

#### bun

> requires bun 1.4+

```sh
bun i -g @hyperpuncher/pi-ui
```

#### arch

```sh
paru -S pi-ui-bin
```

#### homebrew

```sh
brew install hyperpuncher/tap/pi-ui
```

> package-manager installs must be started with `pi-ui` or configured as a background service below

## background service

start pi-ui now and at login:

```sh
pi-ui service install
```

stop pi-ui and remove the service:

```sh
pi-ui service uninstall
```

### homebrew

homebrew manages the service separately:

```sh
brew services start pi-ui
brew services stop pi-ui
```

## development

> requires bun 1.4+

```sh
bun ci
bun run dev
```

## configuration

pi-ui stores its configuration in:

- linux: `~/.config/pi-ui/config.json`
- macos: `~/.config/pi-ui/config.json`
- windows: `%APPDATA%\pi-ui\config.json`

all options with their defaults:

```json
{
	"$schema": "https://pi-ui.app/config.schema.json",
	"autoTitle": {
		"enabled": true,
		"models": [
			"openai-codex/gpt-5.6-luna:minimal",
			"opencode-go/deepseek-v4-flash:off"
		],
		"prompt": "use lowercase"
	},
	"codeTheme": {
		"dark": "pierre-dark-soft",
		"light": "pierre-light"
	},
	"fonts": {
		"mono": "system",
		"sans": "system"
	},
	"gitView": {
		"changesRatio": 0.5,
		"gitPaneRatio": 0.5,
		"layout": "split",
		"mode": "all",
		"reviewSidebarWidth": 272,
		"tab": "git",
		"wrap": true
	},
	"keybindHints": true,
	"minimalMode": false,
	"toolOutputHidden": false
}
```

## keybinds

| key                                                        | action                      |
| ---------------------------------------------------------- | --------------------------- |
| <kbd>ctrl/⌘</kbd> <kbd>k</kbd>                             | command palette             |
| <kbd>ctrl/⌘</kbd> <kbd>b</kbd>                             | toggle session sidebar      |
| <kbd>ctrl/⌘</kbd> <kbd>1–9</kbd>                           | switch session              |
| <kbd>ctrl/⌘</kbd> <kbd>o</kbd>                             | new session                 |
| <kbd>ctrl/⌘</kbd> <kbd>alt</kbd> <kbd>o</kbd>              | temporary chat              |
| <kbd>ctrl/⌘</kbd> <kbd>r</kbd>                             | session picker              |
| <kbd>ctrl/⌘</kbd> <kbd>/</kbd>                             | workspace picker            |
| <kbd>ctrl/⌘</kbd> <kbd>g</kbd>                             | toggle workspace            |
| <kbd>alt</kbd> <kbd>p</kbd>                                | focus prompt                |
| <kbd>alt</kbd> <kbd>c</kbd>                                | focus conversation          |
| <kbd>alt</kbd> <kbd>f</kbd>                                | focus workspace files       |
| <kbd>alt</kbd> <kbd>g</kbd>                                | focus git changes           |
| <kbd>alt</kbd> <kbd>e</kbd>                                | focus file or diff          |
| <kbd>alt</kbd> <kbd>s</kbd>                                | focus sessions              |
| <kbd>alt</kbd> <kbd>m</kbd>                                | toggle minimal mode         |
| <kbd>alt</kbd> <kbd>o</kbd>                                | toggle tool output          |
| <kbd>ctrl/⌘</kbd> <kbd>l</kbd>                             | model picker                |
| <kbd>ctrl/⌘</kbd> <kbd>p</kbd>                             | cycle favorite model        |
| <kbd>ctrl/⌘</kbd> <kbd>shift</kbd> <kbd>p</kbd>            | cycle favorite model back   |
| <kbd>alt</kbd> <kbd>t</kbd>                                | cycle thinking level        |
| <kbd>alt</kbd> <kbd>shift</kbd> <kbd>t</kbd>               | cycle thinking back         |
| <kbd>ctrl/⌘</kbd> <kbd>alt</kbd> <kbd>t</kbd>              | toggle thinking blocks      |
| <kbd>/</kbd>                                               | slash commands              |
| <kbd>@</kbd>                                               | file picker                 |
| <kbd>alt</kbd> <kbd>enter</kbd>                            | queue follow-up             |
| <kbd>alt</kbd> <kbd>↑</kbd>                                | restore queued text         |
| <kbd>j</kbd> / <kbd>k</kbd> or <kbd>↑</kbd> / <kbd>↓</kbd> | move or scroll focused pane |
| <kbd>gg</kbd> / <kbd>G</kbd>                               | top / bottom                |

## license

mit
