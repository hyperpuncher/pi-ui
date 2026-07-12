export function bindCodeCopy() {
	document.addEventListener("click", async (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const button = target.closest("[data-copy-code]");
		if (!(button instanceof HTMLButtonElement)) return;
		const block = button.closest("[data-code-block]");
		const source = block?.querySelector("[data-code-source]");
		const code = block?.querySelector("code");
		const text = source?.textContent
			? decodeHtmlEntities(source.textContent)
			: code?.textContent;
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			button.dataset.copyState = "copied";
			button.setAttribute("aria-label", "Copied");
			setTimeout(() => {
				delete button.dataset.copyState;
				button.setAttribute("aria-label", "Copy code");
			}, 1200);
		} catch {
			button.setAttribute("aria-label", "Copy failed");
		}
	});
}

function decodeHtmlEntities(text) {
	const textarea = document.createElement("textarea");
	textarea.innerHTML = text;
	return textarea.value;
}
