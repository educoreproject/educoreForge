'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// cedsHubHooks.js — H2 for the CEDS hub role. PRESENT AND EMPTY, deliberately.
//
// SPEC-hubKitRole-082826.md §4.4: "hubHooks (methods) — reserved, empty for CEDS. The contract
// admits it so a second hub can add one without a framework change."
//
// CEDS needs no hook. Every CEDS-specific thing the derivation does turned out to be expressible as
// DATA in cedsHubDeclaration.js — the four identity literals, the source-id field name, the base
// field-name map, and the two qualified-reference items. That is a FINDING about the hub role, not
// an accident: it is why the framework extraction was possible at all, and it is the strongest
// available evidence that the §4.4 declaration boundary is drawn in roughly the right place.
//
// It exists rather than being omitted so that the SEAM IS VISIBLE. A second hub author reading this
// kit sees where a method would go; an absent file would leave them guessing whether hooks are
// supported. The framework accepts an empty hooks object and refuses an unknown hook name.
//
// HONESTY CLAUSE (§4.4): a framework extracted from ONE hub is proven on one, which is proven on
// none. If CTDL's hub needs a method here, that is the boundary moving as predicted — not a defect.

// START OF moduleFunction() ============================================================

const moduleFunction = ({ moduleName } = {}) => () => ({});

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
