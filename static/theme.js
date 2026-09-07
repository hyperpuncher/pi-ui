window.addEventListener("pi-ui-theme-mode-changed", () => {
	const dark = document.documentElement.classList.contains("dark");
	// Match --surface-canvas in tokens.css (light: --gray-1, dark: black).
	document.querySelector('meta[name="theme-color"]').content = dark
		? "black"
		: "oklch(95% 0 none)";
});

try {
	const media = matchMedia("(prefers-color-scheme: dark)");
	const apply = () => {
		const stored = localStorage.getItem("themeMode");
		const dark = stored ? stored === "dark" : media.matches;
		document.documentElement.classList.toggle("dark", dark);
		window.dispatchEvent(new Event("pi-ui-theme-mode-changed"));
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
