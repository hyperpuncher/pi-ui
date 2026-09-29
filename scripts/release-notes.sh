#!/usr/bin/env bash
# Render grouped release notes for the current tag to stdout.
set -euo pipefail

repository_url="${REPOSITORY_URL:-${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-hyperpuncher/pi-ui}}"
current_ref="${GITHUB_REF_NAME:-$(git describe --tags --abbrev=0)}"
previous_tag=$(git describe --tags --match "v[0-9]*" --abbrev=0 "${current_ref}^" 2>/dev/null || true)
# Kept in a variable: an unquoted pattern with parens trips bash's `[[ =~ ]]` parser.
type_pattern='^([A-Za-z]+)(\([^)]*\))?!?:[[:space:]]*(.+)$'

rank_commits() {
	local raw_subject type text rank
	while IFS=$'\x1f' read -r raw_subject full short; do
		type="other"
		text="$raw_subject"
		if [[ "$raw_subject" =~ $type_pattern ]]; then
			type="${BASH_REMATCH[1],,}"
			text="${BASH_REMATCH[3]}"
		fi
		case "$type" in
			feat) rank=1 ;;
			fix) rank=2 ;;
			perf) rank=3 ;;
			refactor) rank=4 ;;
			style) rank=5 ;;
			docs) rank=6 ;;
			build) rank=7 ;;
			test) rank=8 ;;
			ci) rank=9 ;;
			chore) rank=10 ;;
			revert) rank=11 ;;
			*) rank=99 ;;
		esac
		printf '%s\t%s\t%s\t%s\t%s\n' "$rank" "$type" "$text" "$short" "$full"
	done
}

print_groups() {
	local rank type text short full current=""
	while IFS=$'\t' read -r rank type text short full; do
		if [[ "$type" != "$current" ]]; then
			[[ -z "$current" ]] || echo
			echo "#### $type"
			current="$type"
		fi
		echo "- $text [\`$short\`](${repository_url}/commit/${full})"
	done
}

range="${previous_tag:+${previous_tag}..}${current_ref}"

echo "### what's changed"
echo
git log --reverse --format="%s%x1f%H%x1f%h" "$range" |
	rank_commits | sort -s -t$'\t' -k1,1n -k2,2 | print_groups
echo
if [[ -n "$previous_tag" ]]; then
	echo "**full changelog:** [${previous_tag}...${current_ref}](${repository_url}/compare/${previous_tag}...${current_ref})"
fi
