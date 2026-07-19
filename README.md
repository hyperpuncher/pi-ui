# pi-ui

keyboard-first minimal gui for [`pi`](https://pi.dev).

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

feature parity with the pi tui, plus desktop niceties like background sessions,
native notifications, file paste/drop, and rich code/diff rendering.

built with:

- [`deno-desktop`](https://docs.deno.com/runtime/desktop/)
- [`datastar`](https://data-star.dev/)
- [`kita-jsx`](https://github.com/kitajs/html)
- [`sätteri`](https://github.com/bruits/satteri)
- [`pierre-diffs`](https://diffs.com/)
- [`basecoat`](https://basecoatui.com/)

## install

### arch

```sh
paru -S pi-ui-bin
```

### debian / ubuntu

download the `.deb` for your architecture from the [latest release](https://github.com/hyperpuncher/pi-ui/releases/latest), then:

```sh
sudo apt install ./pi-ui-linux-*.deb
```

### other linux

download the `.AppImage` for your architecture from the [latest release](https://github.com/hyperpuncher/pi-ui/releases/latest), then:

```sh
chmod +x pi-ui-linux-*.AppImage
./pi-ui-linux-*.AppImage
```

### mac

```sh
brew install --cask hyperpuncher/tap/pi-ui
```

### windows

```powershell
irm https://raw.githubusercontent.com/hyperpuncher/pi-ui/main/packaging/windows/install.ps1 | iex
```

## keybinds

| key                                             | action                    |
| ----------------------------------------------- | ------------------------- |
| <kbd>ctrl/⌘</kbd> <kbd>k</kbd>                  | command menu              |
| <kbd>ctrl/⌘</kbd> <kbd>o</kbd>                  | new session               |
| <kbd>ctrl/⌘</kbd> <kbd>alt</kbd> <kbd>o</kbd>   | temporary chat            |
| <kbd>ctrl/⌘</kbd> <kbd>r</kbd>                  | session picker            |
| <kbd>ctrl/⌘</kbd> <kbd>/</kbd>                  | workspace picker          |
| <kbd>ctrl/⌘</kbd> <kbd>g</kbd>                  | toggle git review         |
| <kbd>ctrl/⌘</kbd> <kbd>l</kbd>                  | model picker              |
| <kbd>ctrl/⌘</kbd> <kbd>p</kbd>                  | cycle favorite model      |
| <kbd>ctrl/⌘</kbd> <kbd>shift</kbd> <kbd>p</kbd> | cycle favorite model back |
| <kbd>alt</kbd> <kbd>t</kbd>                     | cycle thinking level      |
| <kbd>alt</kbd> <kbd>shift</kbd> <kbd>t</kbd>    | cycle thinking back       |
| <kbd>/</kbd>                                    | slash commands            |
| <kbd>@</kbd>                                    | file picker               |
| <kbd>alt</kbd> <kbd>enter</kbd>                 | queue follow-up           |
| <kbd>alt</kbd> <kbd>↑</kbd>                     | restore queued text       |
| <kbd>j</kbd> / <kbd>k</kbd>                     | scroll messages           |
| <kbd>gg</kbd> / <kbd>G</kbd>                    | top / bottom              |
| <kbd>gi</kbd>                                   | focus prompt              |

## license

mit
