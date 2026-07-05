try {
	const stored = localStorage.getItem("themeMode");
	const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
	if (stored ? stored === "dark" : prefersDark) {
		document.documentElement.classList.add("dark");
	}
} catch {
	// Keep first paint working if storage or media queries are unavailable.
}
