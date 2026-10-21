'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// hubBridgingContract.js — the HUB HALF of a bridge, declared once per hub (R2 of the hub-neutral bridge lane, 2026-10-21).
// Today every plugin copies the hub's half into its own declaration: which card fields the judge may see, the hub's identifier
// patterns and id list, the names of the hub anchors a source stamps (blinded), the judge's word for a hub candidate, how a
// declared target expands to a hub stableId, the hub's term key form, the model of its card vectors, its remodel tables and the
// card tier retrieval reads. A hub declares them in forges/<hub>/lib/<hub>HubBridging.js, a file of its OWN: the hub module never
// requires it, so the forged hub output, and so the hub block ids, cannot move (plan trap T4). R3 composes plugins from it.
//
// House form (hubDeclarationContract.js): ONE frozen contract table, ONE registry of kind checkers, the unknown-key walk FIRST,
// then the required/kind walk. Every key is required; a hub that has no value for one says so with that kind's declared empty
// value ([] or null where the kind admits it), never by leaving the key out.
//
//   HUB_BRIDGING_CONTRACT                       the table
//   HUB_BRIDGING_KEY_LIST                       its key names, in table order
//   validateHubBridging({ hubBridging })        → Error | null

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { REFERENCE_TIER } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const promptIdentifierScanLib = require('./promptIdentifierScan');

const TERM_KEY_FORM_LIST = Object.freeze(['absoluteIri', 'curie']);
const REFERENCE_TIER_LIST = Object.freeze(Object.values(REFERENCE_TIER));

const HUB_BRIDGING_CONTRACT = Object.freeze({
	hubToken: Object.freeze({ kind: 'bundleToken', whatItIs: 'the hub bundle directory name, which is the recipe hub token' }),
	candidateRenderingAllowList: Object.freeze({ kind: 'nonEmptyNameList', whatItIs: 'the hub card fields a judge may be shown, in rendering order (a plugin\'s renderingAllowList.candidate)' }),
	promptIdentifierScan: Object.freeze({ kind: 'promptIdentifierScanOrNone', whatItIs: 'the hub identifier patterns and the bundle-relative path of its one id list, scanned out of every prompt; null declares that this hub has none' }),
	sourceAnchorBlindingNameList: Object.freeze({ kind: 'nameList', whatItIs: 'the property names a source stamps when it carries this hub\'s anchors, in the order the plugins blind them ([] when no source stamps any)' }),
	judgeWording: Object.freeze({ kind: 'judgeWording', whatItIs: 'the judge\'s words for this hub: { toolCandidateNoun } (R4 renders them)' }),
	declaredTargetRuleList: Object.freeze({ kind: 'ruleList', whatItIs: 'how a declared target in a source expands to this hub\'s stableId (the declared basis); [] when none' }),
	termKeyForm: Object.freeze({ kind: 'oneOf', allowedList: TERM_KEY_FORM_LIST, whatItIs: 'how this hub\'s term cards are keyed' }),
	embeddingModelVersion: Object.freeze({ kind: 'nonEmptyString', whatItIs: 'the model of this hub\'s card vectors; retrieval must embed with the same' }),
	remodelTableRefList: Object.freeze({ kind: 'nameList', whatItIs: 'the remodel tables this hub owns that a plugin may reference ([] when none)' }),
	retrievalTier: Object.freeze({ kind: 'oneOf', allowedList: REFERENCE_TIER_LIST, whatItIs: 'the card tier a retrieved pool is read from' }),
});
const HUB_BRIDGING_KEY_LIST = Object.freeze(Object.keys(HUB_BRIDGING_CONTRACT));

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonEmptyString = (candidate) => typeof candidate === 'string' && candidate.trim() !== '';
const nameListReason = (value) => (!Array.isArray(value) || value.some((oneName) => !isNonEmptyString(oneName)) ? `must be a list of non-empty strings (got ${JSON.stringify(value)})` : '');
// ---- ONE registry of kind checkers: (value, contractEntry) → '' or a reason -----------------------------------------------
const KIND_CHECKER_REGISTRY = Object.freeze({
	bundleToken: (value) => (typeof value === 'string' && /^[a-z][a-z0-9]*$/.test(value) ? '' : `must be a lower-case bundle token (got ${JSON.stringify(value)})`),
	nonEmptyString: (value) => (isNonEmptyString(value) ? '' : `must be a non-empty string (got ${JSON.stringify(value)})`),
	nameList: nameListReason,
	nonEmptyNameList: (value) => nameListReason(value) || (value.length === 0 ? 'must name at least one field' : ''),
	oneOf: (value, contractEntry) => (contractEntry.allowedList.indexOf(value) === -1 ? `must be one of ${contractEntry.allowedList.join(', ')} (got ${JSON.stringify(value)})` : ''),
	// the plugin contract's own shape rule for the same object (promptIdentifierScan.declarationReason), so a hub and a plugin
	// cannot disagree about what a scan declaration is; like it, it does not second-guess the values (a pattern that does not
	// compile fails loudly the first time a run reaches it)
	promptIdentifierScanOrNone: (value) => (value === null ? '' : promptIdentifierScanLib.declarationReason(value)),
	judgeWording: (value) => (isPlainObject(value) && Object.keys(value).join(',') === 'toolCandidateNoun' && isNonEmptyString(value.toolCandidateNoun) ? '' : `must be exactly { toolCandidateNoun: <non-empty string> } (got ${JSON.stringify(value)})`),
	ruleList: (value) => (Array.isArray(value) && value.every((oneRule) => isPlainObject(oneRule) && isNonEmptyString(oneRule.ruleKind)) ? '' : 'must be a list of rule objects, each naming its ruleKind'),
});

const validateHubBridging = ({ hubBridging } = {}) => {
	if (!isPlainObject(hubBridging)) {
		return refuse.byName({ moduleName, what: `hubBridging is ${hubBridging === null ? 'null' : Array.isArray(hubBridging) ? 'an array' : typeof hubBridging}`, where: 'a hub bridging file exports { hubBridging: { … } }' });
	}
	// unknown key FIRST — a typo must not become a silently ignored declaration
	const unknownName = Object.keys(hubBridging).find((oneName) => HUB_BRIDGING_KEY_LIST.indexOf(oneName) === -1);
	if (unknownName !== undefined) {
		return refuse.byName({ moduleName, what: `the hub bridging declaration carries unknown key '${unknownName}'`, where: `HUB_BRIDGING_CONTRACT names ${HUB_BRIDGING_KEY_LIST.join(', ')}` });
	}
	for (let nameIndex = 0; nameIndex < HUB_BRIDGING_KEY_LIST.length; nameIndex++) {
		const propertyName = HUB_BRIDGING_KEY_LIST[nameIndex];
		const contractEntry = HUB_BRIDGING_CONTRACT[propertyName];
		if (!Object.prototype.hasOwnProperty.call(hubBridging, propertyName)) {
			return refuse.byName({ moduleName, what: `the hub bridging declaration is missing required key '${propertyName}'`, where: `${propertyName} is ${contractEntry.whatItIs}; a hub with no value says so with the kind's declared empty value, never by omission` });
		}
		const reason = KIND_CHECKER_REGISTRY[contractEntry.kind](hubBridging[propertyName], contractEntry);
		if (reason !== '') {
			return refuse.byName({ moduleName, what: `hub bridging key '${propertyName}' ${reason}`, where: `${propertyName} is ${contractEntry.whatItIs}` });
		}
	}
	return null;
};

module.exports = { HUB_BRIDGING_CONTRACT, HUB_BRIDGING_KEY_LIST, TERM_KEY_FORM_LIST, validateHubBridging, moduleName };
