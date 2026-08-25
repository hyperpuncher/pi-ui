import { fontStack } from "../fonts.ts";

window.piUi.fonts = {
	apply(mono, sans) {
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
