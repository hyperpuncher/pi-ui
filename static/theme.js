window.piUiTheme = (() => {
	function readStored() {
		try {
			const stored = localStorage.getItem("color-scheme");
			return stored === "light" || stored === "dark" ? stored : null;
		} catch {
			return null;
		}
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
		const stored = readStored();
		const meta = document.querySelector('meta[name="color-scheme"]');
		if (meta) meta.content = stored ?? "light dark";
		window.dispatchEvent(new Event("pi-ui-theme-mode-changed"));
	}

	function setMode(preference) {
		try {
			if (preference === "system") localStorage.removeItem("color-scheme");
			else localStorage.setItem("color-scheme", preference);
		} catch {
			// Theme editing still works when storage is unavailable.
		}
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
		window.addEventListener("storage", (event) => {
			if (event.key === "color-scheme") apply();
		});
	} catch {
		// Keep first paint working if storage or media queries are unavailable.
	}

	return {
		apply,
		currentMode,
		currentPreference: () => readStored() ?? "system",
		setMode,
	};
})();
