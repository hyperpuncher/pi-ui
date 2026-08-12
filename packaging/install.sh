#!/bin/sh
set -eu

repository="hyperpuncher/pi-ui"
install_directory="${PI_UI_INSTALL_DIR:-$HOME/.local/bin}"
mode="desktop"

if [ "${1:-}" = "--server" ]; then
	mode="server"
elif [ "$#" -ne 0 ]; then
	echo "usage: install.sh [--server]" >&2
	exit 2
fi

case "$(uname -s)" in
	Darwin)
		if ! command -v brew >/dev/null 2>&1; then
			echo "Homebrew is required on macOS: https://brew.sh" >&2
			exit 1
		fi
		if [ "$mode" = "server" ]; then
			brew install hyperpuncher/tap/pi-ui-server
			brew services start pi-ui-server
		else
			brew install --cask hyperpuncher/tap/pi-ui
		fi
		exit
		;;
	Linux) ;;
	*)
		echo "This installer supports Linux and macOS. On Windows, use https://pi-ui.app/install.ps1" >&2
		exit 1
		;;
esac

case "$(uname -m)" in
	x86_64 | amd64) architecture="x64" ;;
	aarch64 | arm64) architecture="arm64" ;;
	*)
		echo "Unsupported architecture: $(uname -m)" >&2
		exit 1
		;;
esac

mkdir -p "$install_directory"

if [ "$mode" = "server" ]; then
	asset="pi-ui-server-linux-$architecture.tar.zst"
	target="$install_directory/pi-ui-server"
else
	asset="pi-ui-linux-$architecture.AppImage"
	target="$install_directory/pi-ui"
fi

url="https://github.com/$repository/releases/latest/download/$asset"
temporary=$(mktemp "$install_directory/.pi-ui-install.XXXXXX")
trap 'rm -f "$temporary"' EXIT HUP INT TERM

echo "Downloading $asset..."
if [ "$mode" = "server" ]; then
	archive=$(mktemp "${TMPDIR:-/tmp}/pi-ui-server.XXXXXX.tar.zst")
	trap 'rm -f "$temporary" "$archive"' EXIT HUP INT TERM
	curl -fsSL --retry 3 "$url" -o "$archive"
	tar --zstd -xOf "$archive" pi-ui-server > "$temporary"
	rm -f "$archive"
else
	curl -fsSL --retry 3 "$url" -o "$temporary"
fi

chmod +x "$temporary"
mv "$temporary" "$target"
trap - EXIT HUP INT TERM

echo "Installed $target"
case ":$PATH:" in
	*:"$install_directory":*) ;;
	*) echo "Add $install_directory to PATH to run it by name." ;;
esac

if [ "$mode" = "server" ]; then
	"$target" autostart enable
	echo "Open http://127.0.0.1:31415 in your browser."
fi
