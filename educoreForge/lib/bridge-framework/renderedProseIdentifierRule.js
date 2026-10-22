'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// renderedProseIdentifierRule.js — a hub's rule for its OWN prose that cites its own identifiers (zeroBacklog lane B2, R3-F2; ruling
// Q-Z10, BRONZE_CROWN 2026-10-22). A hub's definitions may cite the hub's own terms ("Subclasses of <prefix>:<Term> …"), and the
// hub's own identifier scan refuses any such identifier in a prompt (the measured case is named in the hub's own bridging file).
// The hub declares { patternSource, replacementTemplate } (e.g. the CURIE becomes its local name, "Subclasses of <Term>"); the
// composer carries it into a bridge declaration only when the hub declares one; the renderer rewrites CANDIDATE values with it.
// The subject is never rewritten and the scan still scans the whole question, so the leak audit is not weakened for any hub.
//
//   RULE_MEMBER_LIST                                    the rule's members, exactly
//   ruleReason(value)                                   → '' | a reason (the SHAPE check both contracts share)
//   rewrittenRenderedValue({ rule, renderedValue })     → the value with every match replaced: a string, or each string element of
//                                                         a list; any other value unchanged. rule null → the value unchanged.
//
// Like the identifier scan's own declaration check (promptIdentifierScan.declarationReason), the shape check does not compile the
// pattern: this is our own declaration, and a pattern that does not compile fails loudly (a thrown SyntaxError) the first time a
// question is rendered (EBONY_DREAM, B1 back-gate). The pattern is applied with the 'g' flag: every occurrence, never the first only.

const RULE_MEMBER_LIST = Object.freeze(['patternSource', 'replacementTemplate']);
const RULE_REGEX_FLAGS = 'g';

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;

const ruleReason = (value) => {
	if (!isPlainObject(value) || Object.keys(value).length !== RULE_MEMBER_LIST.length || !RULE_MEMBER_LIST.every((oneName) => Object.prototype.hasOwnProperty.call(value, oneName))) {
		return `must be exactly { ${RULE_MEMBER_LIST.join(', ')} } (got ${JSON.stringify(value)})`;
	}
	if (!isNonEmptyString(value.patternSource)) {
		return `patternSource must be a non-empty regular-expression source (got ${JSON.stringify(value.patternSource)})`;
	}
	if (typeof value.replacementTemplate !== 'string') {
		return `replacementTemplate must be a string, String.prototype.replace's template form ($1 names a group) (got ${JSON.stringify(value.replacementTemplate)})`;
	}
	return '';
};

const rewrittenRenderedValue = ({ rule, renderedValue }) => {
	if (rule === null) {
		return renderedValue;
	}
	const rewriteText = (text) => text.replace(new RegExp(rule.patternSource, RULE_REGEX_FLAGS), rule.replacementTemplate);
	if (typeof renderedValue === 'string') {
		return rewriteText(renderedValue);
	}
	if (Array.isArray(renderedValue)) {
		return renderedValue.map((oneElement) => (typeof oneElement === 'string' ? rewriteText(oneElement) : oneElement));
	}
	return renderedValue;
};

module.exports = { RULE_MEMBER_LIST, ruleReason, rewrittenRenderedValue, moduleName };
