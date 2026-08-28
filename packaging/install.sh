#!/bin/sh
set -eu

repository="hyperpuncher/pi-ui"
install_directory="${PI_UI_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
	Darwin)
		if ! command -v brew >/dev/null 2>&1; then
			echo "Homebrew is required on macOS: https://brew.sh" >&2
			exit 1
		fi
		if brew list --formula pi-ui-server >/dev/null 2>&1; then
			brew upgrade hyperpuncher/tap/pi-ui-server
		else
			brew install hyperpuncher/tap/pi-ui-server
		fi
		brew services restart pi-ui-server
		exit
		;;
	Linux) ;;
	*)
		echo "This installer supports Linux and macOS. On Windows, use https://pi-ui.app/install.ps1" >&2
		exit 1
		;;
esac

if [ -f /etc/arch-release ]; then
	if command -v paru >/dev/null 2>&1; then
		aur_helper="paru"
	elif command -v yay >/dev/null 2>&1; then
		aur_helper="yay"
	else
		echo "Arch Linux installs are managed through the AUR." >&2
		echo "Install paru or yay, then rerun this installer." >&2
		exit 1
	fi

	"$aur_helper" -S --needed pi-ui-server-bin </dev/tty
	pi-ui-server autostart enable
	echo "Open http://127.0.0.1:31415 in your browser."
	exit
fi

case "$(uname -m)" in
	x86_64 | amd64) architecture="x64" ;;
	aarch64 | arm64) architecture="arm64" ;;
	*)
		echo "Unsupported architecture: $(uname -m)" >&2
		exit 1
		;;
esac

mkdir -p "$install_directory"
asset="pi-ui-server-linux-$architecture.tar.zst"
target="$install_directory/pi-ui-server"
url="https://github.com/$repository/releases/latest/download/$asset"
archive=$(mktemp "${TMPDIR:-/tmp}/pi-ui-server.XXXXXX.tar.zst")
temporary=$(mktemp "$install_directory/.pi-ui-install.XXXXXX")
trap 'rm -f "$archive" "$temporary"' EXIT HUP INT TERM

curl -fsSL --retry 3 "$url" -o "$archive"
tar --zstd -xOf "$archive" pi-ui-server > "$temporary"
chmod +x "$temporary"
mv "$temporary" "$target"
trap - EXIT HUP INT TERM
rm -f "$archive"

echo "Installed $target"
case ":$PATH:" in
	*:"$install_directory":*) ;;
	*) echo "Add $install_directory to PATH to run it by name." ;;
esac

"$target" autostart enable
echo "Open http://127.0.0.1:31415 in your browser."
