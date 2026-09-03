/** @type {import("stylelint").Config} */
export default {
	extends: ["stylelint-config-standard"],
	ignoreFiles: ["static/**"],
	reportDescriptionlessDisables: true,
	reportInvalidScopeDisables: true,
	reportNeedlessDisables: true,
	rules: {
		"at-rule-empty-line-before": null,
		"color-no-hex": true,
		"custom-property-empty-line-before": null,
		"declaration-block-no-redundant-longhand-properties": null,
		"declaration-no-important": true,
		"font-family-name-quotes": null,
		"import-notation": null,
		"max-nesting-depth": 1,
		"no-descending-specificity": null,
		"no-duplicate-selectors": true,
		"selector-max-compound-selectors": 5,
		"rule-empty-line-before": null,
		"value-keyword-case": null,
	},
};
