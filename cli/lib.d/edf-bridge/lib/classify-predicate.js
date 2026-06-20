'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// classify-predicate.js — PURE SKOS matchPredicate classifier for -implied Stage-2 (Phase III).
//
// Returns one of exactMatch / closeMatch / broadMatch / narrowMatch / relatedMatch. This is the
// PRECISION axis and is INDEPENDENT of the calibrated confidence (the two axes are emitted together):
// confidence = "how sure are we this is a mapping", matchPredicate = "what KIND of mapping". A
// low-confidence pair can still be a relatedMatch; a high-confidence pair with proper subset options
// is a broad/narrowMatch.
//
// Two inputs decide it (config thresholds = DATA):
//   - name+definition EQUIVALENCE: mean of nameJaccard and descriptionEmbed (the reranker signals).
//   - option-set / range CONTAINMENT: when BOTH elements carry an enumerated option set, the token
//     sets of the option names decide broad (source ⊂ target) / narrow (target ⊂ source) / equal.
// Containment, when decisive, OVERRIDES the equivalence band (a strict subset is structurally
// broad/narrow regardless of name overlap). camelCase only; no I/O.

const { tokenize } = require('./text-similarity');

// pool the option names of one side into a single token set.
const optionTokenSet = (optionNames) => {
	const set = new Set();
	(optionNames || []).forEach((name) => {
		tokenize(name).forEach((token) => set.add(token));
	});
	return set;
};

const isSubset = (small, big) => {
	if (small.size === 0) {
		return false;
	}
	let subset = true;
	small.forEach((token) => {
		if (!big.has(token)) {
			subset = false;
		}
	});
	return subset;
};

// containment verdict from two option-name lists: 'equal' | 'sourceSubset' | 'targetSubset' |
// 'overlap' | 'none' (none = one or both sides carry no options -> containment is not decisive).
const optionContainment = (sourceOptionNames, targetOptionNames) => {
	const s = optionTokenSet(sourceOptionNames);
	const t = optionTokenSet(targetOptionNames);
	if (s.size === 0 || t.size === 0) {
		return 'none';
	}
	const sInT = isSubset(s, t);
	const tInS = isSubset(t, s);
	if (sInT && tInS) {
		return 'equal';
	}
	if (sInT) {
		return 'sourceSubset'; // source's values ⊂ target's -> target is BROADER
	}
	if (tInS) {
		return 'targetSubset'; // target's values ⊂ source's -> target is NARROWER
	}
	return 'overlap';
};

// classifyPredicate — { sourceNode, targetNode, signals, sourceOptionNames, targetOptionNames, config }
//   -> { matchPredicate, equivalence, containment, basis }
const classifyPredicate = ({ signals, sourceOptionNames, targetOptionNames, config } = {}) => {
	const s = signals || {};
	const nameEquiv = typeof s.nameJaccard === 'number' ? s.nameJaccard : 0;
	const defEquiv = typeof s.descriptionEmbed === 'number' ? s.descriptionEmbed : 0;
	const equivalence = (nameEquiv + defEquiv) / 2;

	const exactThreshold = config.predicate.exactEquivalence;
	const closeThreshold = config.predicate.closeEquivalence;
	const containment = optionContainment(sourceOptionNames, targetOptionNames);

	let matchPredicate;
	if (containment === 'sourceSubset') {
		matchPredicate = 'broadMatch'; // target is broader than source
	} else if (containment === 'targetSubset') {
		matchPredicate = 'narrowMatch'; // target is narrower than source
	} else if (equivalence >= exactThreshold && (containment === 'equal' || containment === 'none')) {
		matchPredicate = 'exactMatch';
	} else if (equivalence >= closeThreshold) {
		matchPredicate = 'closeMatch';
	} else {
		matchPredicate = 'relatedMatch';
	}

	return {
		matchPredicate,
		equivalence,
		containment,
		basis: `equivalence=${equivalence.toFixed(3)}(name=${nameEquiv.toFixed(2)},def=${defEquiv.toFixed(2)});options=${containment}`,
	};
};

module.exports = { moduleName, classifyPredicate, optionContainment, optionTokenSet };
