export async function copyText(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
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
