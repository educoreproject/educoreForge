'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// definitionDigest.js — the content digest of one PESC definition, as written (DESIGN-pescForge.md §2.3).
//
//   definitionDigestOf(modelValue) → sha256 hex over a canonical JSON of the parser's model of it
//
// Canonical means: object keys sorted, every string trimmed (the rule the expander uses for its
// library diffs ignores whitespace), and every 'documentPosition' left out, because a definition's
// place in its file is not its content: CoreMain 1.17.0's NoteMessageType and the same type moved
// down a page are one definition. Positions INSIDE a definition (sequencePosition, attributePosition,
// the compositor tree's element pointers) are content and stay. Comments never reach the model.
//
// The caller decides what one digest covers. For an element, the walk hands { element, resolvedType }:
// the declaration and its resolved type's own definition (one level, not the type's whole subtree),
// so "byte-identical definition" between two releases is a property comparison, never a parse.

const crypto = require('crypto');

const OMITTED_PROPERTY_NAME_LIST = Object.freeze(['documentPosition']);

const canonicalValueOf = (modelValue) => {
	if (typeof modelValue === 'string') {
		return modelValue.trim();
	}
	if (Array.isArray(modelValue)) {
		return modelValue.map(canonicalValueOf);
	}
	if (modelValue !== null && typeof modelValue === 'object') {
		return Object.keys(modelValue)
			.filter((onePropertyName) => OMITTED_PROPERTY_NAME_LIST.indexOf(onePropertyName) === -1)
			.sort()
			.reduce((soFar, onePropertyName) => ({ ...soFar, [onePropertyName]: canonicalValueOf(modelValue[onePropertyName]) }), {});
	}
	return modelValue;
};

const definitionDigestOf = (modelValue) => crypto.createHash('sha256').update(JSON.stringify(canonicalValueOf(modelValue)), 'utf8').digest('hex');

module.exports = { definitionDigestOf, canonicalValueOf, OMITTED_PROPERTY_NAME_LIST, moduleName };
