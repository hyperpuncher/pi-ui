export async function copyText(text) {
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Fall back below when clipboard API is blocked or unavailable.
		}
	}
	return copyTextFallback(text);
}

function copyTextFallback(text) {
	if (typeof document === "undefined" || !document.body) return false;
	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.setAttribute("readonly", "");
	textarea.style.position = "fixed";
	textarea.style.opacity = "0";
	textarea.style.pointerEvents = "none";
	document.body.append(textarea);
	textarea.select();
	try {
		return document.execCommand("copy");
	} catch {
		return false;
	} finally {
		textarea.remove();
	}
}

export function bindCodeCopy() {
	document.addEventListener("click", handleCodeCopy);
}

async function handleCodeCopy(event) {
	const target = event.target;
	if (!(target instanceof Element)) return;
	const button = target.closest("[data-copy-code]");
	if (!(button instanceof HTMLButtonElement)) return;
	const block = button.closest("[data-code-block]");
	const code = block?.querySelector("code");
	const text = block?.getAttribute("data-code-source") || code?.textContent;
	if (!text) return;
	if (!(await copyText(text))) {
		button.setAttribute("aria-label", "Copy failed");
		return;
	}
	button.dataset.copyState = "copied";
	button.setAttribute("aria-label", "Copied");
	setTimeout(() => {
		delete button.dataset.copyState;
		button.setAttribute("aria-label", "Copy code");
	}, 1200);
}
