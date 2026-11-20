import { fontStack } from "#src/fonts.ts";

let appliedMono: string | undefined;
let appliedSans: string | undefined;

window.piUi.fonts = {
	apply(mono, sans) {
		if (mono === appliedMono && sans === appliedSans) return;
		appliedMono = mono;
		appliedSans = sans;
		document.documentElement.style.setProperty(
			"--font-mono",
			fontStack("mono", mono),
		);
		document.documentElement.style.setProperty(
			"--font-sans",
			fontStack("sans", sans),
		);
	},
};
