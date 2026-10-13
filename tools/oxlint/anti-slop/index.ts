import { eslintCompatPlugin } from "@oxlint/plugins";

import { noArrayFilterMapRule } from "#tools/oxlint/anti-slop/rules/no-array-filter-map.ts";
import { noChainedTypeAssertionsRule } from "#tools/oxlint/anti-slop/rules/no-chained-type-assertions.ts";
import { noConditionalEmptyObjectSpreadRule } from "#tools/oxlint/anti-slop/rules/no-conditional-empty-object-spread.ts";
import { noKnownValueWideningRule } from "#tools/oxlint/anti-slop/rules/no-known-value-widening.ts";
import { noModuleMockingRule } from "#tools/oxlint/anti-slop/rules/no-module-mocking.ts";
import { noObjectParametersRule } from "#tools/oxlint/anti-slop/rules/no-object-parameters.ts";
import { noReduceAccumulatorCopyRule } from "#tools/oxlint/anti-slop/rules/no-reduce-accumulator-copy.ts";
import { noReflectApplyRule } from "#tools/oxlint/anti-slop/rules/no-reflect-apply.ts";
import { noReflectGetRule } from "#tools/oxlint/anti-slop/rules/no-reflect-get.ts";
import { noRuntimeTypeofRule } from "#tools/oxlint/anti-slop/rules/no-runtime-typeof.ts";
import { noForbiddenTermInSymbolNamesRule } from "#tools/oxlint/anti-slop/rules/no-shape-in-symbol-names.ts";
import { noUnknownParametersRule } from "#tools/oxlint/anti-slop/rules/no-unknown-parameters.ts";
import { noUnknownReturnsRule } from "#tools/oxlint/anti-slop/rules/no-unknown-returns.ts";
import { noUnknownTypeAliasesRule } from "#tools/oxlint/anti-slop/rules/no-unknown-type-aliases.ts";
import { noUnsafeDictionaryTypeRule } from "#tools/oxlint/anti-slop/rules/no-unsafe-dictionary-type.ts";
import { noWidenThenAssertRule } from "#tools/oxlint/anti-slop/rules/no-widen-then-assert.ts";
import { requireSafetyCommentForTypeAssertionRule } from "#tools/oxlint/anti-slop/rules/require-safety-comment-for-type-assertion.ts";

/** Generic Oxlint rules that reject low-evidence and low-signal implementation patterns. */
const antiSlopPlugin = eslintCompatPlugin({
	meta: { name: "anti-slop" },
	rules: {
		"no-array-filter-map": noArrayFilterMapRule,
		"no-chained-type-assertions": noChainedTypeAssertionsRule,
		"no-conditional-empty-object-spread": noConditionalEmptyObjectSpreadRule,
		"no-known-value-widening": noKnownValueWideningRule,
		"no-module-mocking": noModuleMockingRule,
		"no-object-parameters": noObjectParametersRule,
		"no-reduce-accumulator-copy": noReduceAccumulatorCopyRule,
		"no-reflect-apply": noReflectApplyRule,
		"no-reflect-get": noReflectGetRule,
		"no-runtime-typeof": noRuntimeTypeofRule,
		"no-unsafe-dictionary-type": noUnsafeDictionaryTypeRule,
		"no-shape-in-symbol-names": noForbiddenTermInSymbolNamesRule,
		"no-unknown-parameters": noUnknownParametersRule,
		"no-unknown-returns": noUnknownReturnsRule,
		"no-unknown-type-aliases": noUnknownTypeAliasesRule,
		"no-widen-then-assert": noWidenThenAssertRule,
		"require-safety-comment-for-type-assertion":
			requireSafetyCommentForTypeAssertionRule,
	},
});

export default antiSlopPlugin;
