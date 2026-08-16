'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// transformRegistry.js — the CLOSED tuple-field transform registry (SPEC-bridgeFramework-v1.md §4.1
// tupleFieldColumnMap; RULINGS BF13, BF14). A plugin NAMES a transform; it never supplies a function.
// Every transform is PURE (raw string → { value } | { error }) and REFUSES a raw value it cannot shape —
// never a coerced answer:
//   identity                the raw cell as-is (SIF's cedsId is already `P` + six digits)
//   globalIdToPrefixedKey   'P' + six digits from a six-digit id (renamed from the standard-named
//                           form so the framework tree passes its own token ban, RULING BF14)
//   uriFragment             the fragment after '#' (a URI without '#' is refused)
//   verbatim                the raw cell, for a consistency check against a card property
// A transform receives a NON-EMPTY string: an empty cell is ABSENT (BG-INPUT c) and never reaches one.

const TRANSFORM_REGISTRY = Object.freeze({
	identity: (rawValue) => ({ value: rawValue }),
	globalIdToPrefixedKey: (rawValue) => (/^\d{6}$/.test(rawValue) ? { value: `P${rawValue}` } : { error: `globalIdToPrefixedKey: '${rawValue}' is not six digits` }),
	uriFragment: (rawValue) => {
		const hashIndex = rawValue.lastIndexOf('#');
		return hashIndex === -1 || hashIndex === rawValue.length - 1
			? { error: `uriFragment: '${rawValue}' carries no '#fragment'` }
			: { value: rawValue.slice(hashIndex + 1) };
	},
	verbatim: (rawValue) => ({ value: rawValue }),
});
const TRANSFORM_NAME_LIST = Object.freeze(Object.keys(TRANSFORM_REGISTRY));

// applyTransform({ transformName, rawValue }) → { value } | { error } — refuses an unknown name and a non-string
const applyTransform = ({ transformName, rawValue } = {}) => {
	const transform = TRANSFORM_REGISTRY[transformName];
	if (transform === undefined) {
		return { error: `${moduleName}: transform '${transformName}' is not in TRANSFORM_REGISTRY (${TRANSFORM_NAME_LIST.join(', ')})` };
	}
	if (typeof rawValue !== 'string' || rawValue.length === 0) {
		return { error: `${moduleName}: transform '${transformName}' received ${JSON.stringify(rawValue)}; a transform takes a NON-EMPTY string (an empty cell is ABSENT, never transformed)` };
	}
	return transform(rawValue);
};

module.exports = { TRANSFORM_REGISTRY, TRANSFORM_NAME_LIST, applyTransform, moduleName };
