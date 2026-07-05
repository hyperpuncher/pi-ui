try {
	const media = matchMedia("(prefers-color-scheme: dark)");
	const apply = () => {
		const stored = localStorage.getItem("themeMode");
		const dark = stored ? stored === "dark" : media.matches;
		document.documentElement.classList.toggle("dark", dark);
	};
	apply();
	media.addEventListener("change", apply);
	window.addEventListener("storage", (event) => {
		if (event.key === "themeMode") {
			apply();
		}
	});
} catch {
	// Keep first paint working if storage or media queries are unavailable.
}
