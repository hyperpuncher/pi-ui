window.piUiTheme = (() => {
	function currentPreference() {
		const scheme = document.querySelector('meta[name="color-scheme"]')?.content;
		return scheme === "light" || scheme === "dark" ? scheme : "system";
	}

	function currentMode() {
		try {
			const scheme = getComputedStyle(document.documentElement).colorScheme;
			if (scheme === "dark" || scheme === "light") return scheme;
		} catch {
			// Fall through to the system preference below.
		}
		try {
			return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
		} catch {
			return "light";
		}
	}

	function apply() {
		window.dispatchEvent(new Event("pi-ui-theme-mode-changed"));
	}

	function setMode(preference) {
		if (currentPreference() === preference) return;
		const meta = document.querySelector('meta[name="color-scheme"]');
		if (meta) meta.content = preference === "system" ? "light dark" : preference;
		apply();
	}

	window.addEventListener("pi-ui-theme-mode-changed", () => {
		// Match --surface-canvas in tokens.css (light: --gray-1, dark: black).
		document.querySelector('meta[name="theme-color"]').content =
			currentMode() === "dark" ? "black" : "oklch(95% 0 none)";
	});

	try {
		apply();
		matchMedia("(prefers-color-scheme: dark)").addEventListener("change", apply);
	} catch {
		// Keep first paint working if media queries are unavailable.
	}

	return {
		apply,
		currentMode,
		currentPreference,
		setMode,
	};
})();
