'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// standardBridgingContract.js — the STANDARD HALF of every bridge from a standard, declared once per standard in
// forges/<standard>/bridges/<standard>Bridging.js (R3 of the hub-neutral bridge lane, 2026-10-21). With a hub's half
// (hubBridgingContract.js) it composes, by bridgeComposer.js, into the ordinary plugin declarations the registry, the run and
// the materialiser already take. House form: frozen tables, ONE kind-checker registry, unknown key FIRST, every key required
// (an empty value is stated, never omitted).
//
// A bridging file exports exactly { standardBridging, bridgeHooksByFacetName }:
//   standardBridging = {
//     standardKey        the bundle directory (BR-009)
//     bridgeNameStem     the camel-case stem every derived name starts with (pescCollegeTranscript1v8v0, edfi, sif260928)
//     facetList          one row per subject family: { facetName, declarationTemplate, subjectRenderingAllowList, pairByHubToken }
//   }
//   facetName                ''  for a standard's only family, else a capitalised word ('OptionSet') that joins the bridgeName
//   declarationTemplate      every plugin declaration key EXCEPT the composed ones (COMPOSED_DECLARATION_KEY_LIST)
//   subjectRenderingAllowList  the source fields a judge may see; null when the basis renders nothing (declared, standard)
//   pairByHubToken           one row per hub this facet bridges to; a pairing exists only when declared here
//   bridgeHooksByFacetName   { <facetName>: <the plugin's bridgeHooks object> } for every facet ({} for a derived basis)
//
// A PAIR ROW (exact key set PAIR_ROW_KEY_LIST, every key stated):
//   candidateRetrieval           the pair's retrieval settings WITHOUT embeddingModelVersion (the hub's); null: no retrieval
//   candidateRenderingAllowList  null: the hub's list; a list: a pair override (ruled for pesc260805, SCARLET_ARROW 2026-10-21)
//   promptIdentifierScan         'fromHubWithLegacyListPath' (the hub's patterns, the list at bridges/<stem><Hub>IdList.json —
//                                today's per-plugin path, kept because the path string is in the declaration digest) or null
//   blindingOrder                today's blinding list IN TODAY'S ORDER: a standard's own name as a string, a hub anchor name
//                                as { hubAnchor: <index into the hub's sourceAnchorBlindingNameList> }
//   hubAnchorListLength          the length the hub's anchor list had when blindingOrder was written (required when any
//                                hubAnchor is referenced, else null): a hub edit that changes it is REFUSED, never a silent shift
//   declaredTargetRuleList       'fromHub' (the hub's declared-target rules) or null
//   remodelTableRef              null, or { hubRemodelTable: <index into the hub's remodelTableRefList> }
//   hubRemodelTableListLength    as hubAnchorListLength, for remodelTableRef
// ⟪R3⟫ a bridge created AFTER the refactor declares instead: blindingOrder { standardBlindingNameList, pairedHubAnchors:
//   'union' } (the union over every hub the standard pairs with; hubAnchorListLength null), and promptIdentifierScan 'fromHub'
//   (the pair hub's own patterns and list). Every existing pair keeps the array form and 'fromHubWithLegacyListPath'.
//
//   validateStandardBridging({ standardBridging, bridgeHooksByFacetName, bundleDirName }) → Error | null

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

// the declaration keys the composer writes; a template carrying one is refused (the value would be silently overwritten)
const COMPOSED_DECLARATION_KEY_LIST = Object.freeze(['bridgeName', 'renderingAllowList', 'candidateRetrieval', 'promptIdentifierScan', 'blindingDeclaration', 'declaredTargetRuleList', 'remodelTableRef']);
const PROMPT_IDENTIFIER_SCAN_FROM_HUB = 'fromHubWithLegacyListPath';
// ⟪R3, bridges created after the refactor (Q-R6 revised)⟫ the hub's own scan, its list (if any) resolved beside the hub bundle
const PROMPT_IDENTIFIER_SCAN_HUB_OWN = 'fromHub';
const PROMPT_IDENTIFIER_SCAN_FORM_LIST = Object.freeze([PROMPT_IDENTIFIER_SCAN_FROM_HUB, PROMPT_IDENTIFIER_SCAN_HUB_OWN]);
// ⟪R3, Q-R6 revised + SCARLET_ARROW ruling on P-c⟫ a new bridge's blinding: { standardBlindingNameList, pairedHubAnchors: 'union' }
// = the standard's own names, then the sourceAnchorBlindingNameList of EVERY hub the standard pairs with (hub-token order, each
// name once) — a superset of the recipe's hubs, ruled the safer reading. Existing pairs keep their exact list (the array form).
const BLINDING_PAIRED_HUB_ANCHOR_MODE_LIST = Object.freeze(['union']);
const isUnionBlindingOrder = (candidate) => isPlainObject(candidate) && Object.keys(candidate).sort().join(',') === 'pairedHubAnchors,standardBlindingNameList' && BLINDING_PAIRED_HUB_ANCHOR_MODE_LIST.indexOf(candidate.pairedHubAnchors) !== -1 && Array.isArray(candidate.standardBlindingNameList) && candidate.standardBlindingNameList.every(isNonEmptyString);
const DECLARED_TARGET_RULES_FROM_HUB = 'fromHub';

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonEmptyString = (candidate) => typeof candidate === 'string' && candidate.trim() !== '';
const isNameList = (candidate) => Array.isArray(candidate) && candidate.every(isNonEmptyString);
const isIndexReference = (candidate, memberName) => isPlainObject(candidate) && Object.keys(candidate).join(',') === memberName && Number.isInteger(candidate[memberName]) && candidate[memberName] >= 0;

// ---- ONE registry of kind checkers: value → '' or a reason ----------------------------------------------------------------------
const KIND_CHECKER_REGISTRY = Object.freeze({
	retrievalOrNone: (value) => (value === null || (isPlainObject(value) && value.embeddingModelVersion === undefined) ? '' : 'must be null or the pair\'s retrieval settings WITHOUT embeddingModelVersion (the hub declares it)'),
	nameListOrNone: (value) => (value === null || (isNameList(value) && value.length > 0) ? '' : 'must be null or a non-empty list of field names'),
	scanFromHubOrNone: (value) => (value === null || PROMPT_IDENTIFIER_SCAN_FORM_LIST.indexOf(value) !== -1 ? '' : `must be null or one of ${PROMPT_IDENTIFIER_SCAN_FORM_LIST.map((oneForm) => `'${oneForm}'`).join(', ')}`),
	blindingOrder: (value) => ((Array.isArray(value) && value.every((oneMember) => isNonEmptyString(oneMember) || isIndexReference(oneMember, 'hubAnchor'))) || isUnionBlindingOrder(value) ? '' : `must be a list of names and { hubAnchor: <index> } references, or { standardBlindingNameList: [names], pairedHubAnchors: ${BLINDING_PAIRED_HUB_ANCHOR_MODE_LIST.map((oneMode) => `'${oneMode}'`).join(' | ')} }`),
	lengthOrNone: (value) => (value === null || (Number.isInteger(value) && value >= 0) ? '' : 'must be null or a non-negative integer'),
	rulesFromHubOrNone: (value) => (value === null || value === DECLARED_TARGET_RULES_FROM_HUB ? '' : `must be null or '${DECLARED_TARGET_RULES_FROM_HUB}'`),
	remodelRefOrNone: (value) => (value === null || isIndexReference(value, 'hubRemodelTable') ? '' : 'must be null or { hubRemodelTable: <index> }'),
});

const PAIR_ROW_CONTRACT = Object.freeze({
	candidateRetrieval: 'retrievalOrNone',
	candidateRenderingAllowList: 'nameListOrNone',
	promptIdentifierScan: 'scanFromHubOrNone',
	blindingOrder: 'blindingOrder',
	hubAnchorListLength: 'lengthOrNone',
	declaredTargetRuleList: 'rulesFromHubOrNone',
	remodelTableRef: 'remodelRefOrNone',
	hubRemodelTableListLength: 'lengthOrNone',
});
const PAIR_ROW_KEY_LIST = Object.freeze(Object.keys(PAIR_ROW_CONTRACT));
const STANDARD_BRIDGING_KEY_LIST = Object.freeze(['standardKey', 'bridgeNameStem', 'facetList']);
const FACET_KEY_LIST = Object.freeze(['facetName', 'declarationTemplate', 'subjectRenderingAllowList', 'pairByHubToken']);

const refusal = (whatText, whereText) => refuse.byName({ moduleName, what: whatText, where: whereText });
const exactKeyRefusal = ({ value, keyList, whatName }) => {
	const unknownName = Object.keys(value).find((oneName) => keyList.indexOf(oneName) === -1);
	if (unknownName !== undefined) {
		return refusal(`${whatName} carries unknown key '${unknownName}'`, `it names exactly ${keyList.join(', ')}`);
	}
	const missingName = keyList.find((oneName) => !Object.prototype.hasOwnProperty.call(value, oneName));
	return missingName === undefined ? null : refusal(`${whatName} is missing required key '${missingName}'`, `it names exactly ${keyList.join(', ')}; an empty value is stated, never omitted`);
};

const pairRowRefusal = ({ pairRow, whatName }) => {
	if (!isPlainObject(pairRow)) {
		return refusal(`${whatName} is not an object`, 'a pair row is { ' + PAIR_ROW_KEY_LIST.join(', ') + ' }');
	}
	const keyError = exactKeyRefusal({ value: pairRow, keyList: PAIR_ROW_KEY_LIST, whatName });
	if (keyError) {
		return keyError;
	}
	const badName = PAIR_ROW_KEY_LIST.find((oneName) => KIND_CHECKER_REGISTRY[PAIR_ROW_CONTRACT[oneName]](pairRow[oneName]) !== '');
	if (badName !== undefined) {
		return refusal(`${whatName}.${badName} ${KIND_CHECKER_REGISTRY[PAIR_ROW_CONTRACT[badName]](pairRow[badName])}`, 'standardBridgingContract PAIR_ROW_CONTRACT');
	}
	const referencesAnchor = Array.isArray(pairRow.blindingOrder) && pairRow.blindingOrder.some((oneMember) => isPlainObject(oneMember));
	if (referencesAnchor !== (pairRow.hubAnchorListLength !== null)) {
		return refusal(`${whatName}.hubAnchorListLength is ${JSON.stringify(pairRow.hubAnchorListLength)} but blindingOrder ${referencesAnchor ? 'references' : 'references no'} hub anchor`, 'state the hub anchor list length exactly when an anchor is referenced by position');
	}
	if ((pairRow.remodelTableRef !== null) !== (pairRow.hubRemodelTableListLength !== null)) {
		return refusal(`${whatName}.hubRemodelTableListLength is ${JSON.stringify(pairRow.hubRemodelTableListLength)} but remodelTableRef is ${JSON.stringify(pairRow.remodelTableRef)}`, 'state the hub remodel list length exactly when a remodel table is referenced by position');
	}
	return null;
};

const validateStandardBridging = ({ standardBridging, bridgeHooksByFacetName, bundleDirName } = {}) => {
	if (!isPlainObject(standardBridging)) {
		return refusal('standardBridging is not an object', 'a bridging file exports { standardBridging, bridgeHooksByFacetName }');
	}
	const topError = exactKeyRefusal({ value: standardBridging, keyList: STANDARD_BRIDGING_KEY_LIST, whatName: 'standardBridging' });
	if (topError) {
		return topError;
	}
	if (standardBridging.standardKey !== bundleDirName) {
		return refusal(`standardBridging declares standardKey '${standardBridging.standardKey}' but sits under bundle '${bundleDirName}'`, 'standardKey MUST equal the bundle directory (BR-009)');
	}
	if (typeof standardBridging.bridgeNameStem !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(standardBridging.bridgeNameStem)) {
		return refusal(`bridgeNameStem ${JSON.stringify(standardBridging.bridgeNameStem)} is not a camel-case stem`, 'the stem every derived bridgeName and legacy id-list path starts with');
	}
	if (!Array.isArray(standardBridging.facetList) || standardBridging.facetList.length === 0) {
		return refusal('facetList is not a non-empty list', 'one row per subject family the standard bridges');
	}
	if (!isPlainObject(bridgeHooksByFacetName)) {
		return refusal('bridgeHooksByFacetName is not an object', 'one hooks object per facet name ({} for a derived basis)');
	}
	const facetNameList = standardBridging.facetList.map((oneFacet) => (isPlainObject(oneFacet) ? oneFacet.facetName : undefined));
	if (new Set(facetNameList).size !== facetNameList.length) {
		return refusal(`facetList repeats a facetName (${facetNameList.join(', ')})`, 'a facet name is unique; it joins the bridgeName');
	}
	const hookNameList = Object.keys(bridgeHooksByFacetName).sort();
	if (JSON.stringify(hookNameList) !== JSON.stringify(facetNameList.slice().sort())) {
		return refusal(`bridgeHooksByFacetName names ${JSON.stringify(hookNameList)} but the facets are ${JSON.stringify(facetNameList)}`, 'exactly one hooks object per facet (the facet named \'\' included)');
	}
	for (let facetIndex = 0; facetIndex < standardBridging.facetList.length; facetIndex++) {
		const oneFacet = standardBridging.facetList[facetIndex];
		const facetWhat = `facetList[${facetIndex}]`;
		if (!isPlainObject(oneFacet)) {
			return refusal(`${facetWhat} is not an object`, `a facet is { ${FACET_KEY_LIST.join(', ')} }`);
		}
		const facetError = exactKeyRefusal({ value: oneFacet, keyList: FACET_KEY_LIST, whatName: facetWhat });
		if (facetError) {
			return facetError;
		}
		if (typeof oneFacet.facetName !== 'string' || !/^([A-Z][A-Za-z0-9]*)?$/.test(oneFacet.facetName)) {
			return refusal(`${facetWhat}.facetName ${JSON.stringify(oneFacet.facetName)} is neither '' nor a capitalised word`, 'it joins the bridgeName between the stem and the hub');
		}
		if (!isPlainObject(oneFacet.declarationTemplate)) {
			return refusal(`${facetWhat}.declarationTemplate is not an object`, 'every plugin declaration key except the composed ones');
		}
		const composedKeyInTemplate = COMPOSED_DECLARATION_KEY_LIST.find((oneName) => Object.prototype.hasOwnProperty.call(oneFacet.declarationTemplate, oneName));
		if (composedKeyInTemplate !== undefined) {
			return refusal(`${facetWhat}.declarationTemplate carries '${composedKeyInTemplate}', which the composer writes`, `the composed keys are ${COMPOSED_DECLARATION_KEY_LIST.join(', ')}; the pair row and the hub supply them`);
		}
		if (KIND_CHECKER_REGISTRY.nameListOrNone(oneFacet.subjectRenderingAllowList) !== '') {
			return refusal(`${facetWhat}.subjectRenderingAllowList ${KIND_CHECKER_REGISTRY.nameListOrNone(oneFacet.subjectRenderingAllowList)}`, 'the source fields a judge may see, or null');
		}
		if (!isPlainObject(oneFacet.pairByHubToken) || Object.keys(oneFacet.pairByHubToken).length === 0) {
			return refusal(`${facetWhat}.pairByHubToken is not a non-empty object`, 'a facet bridges to at least one hub, each named by its token');
		}
		const pairHubTokenList = Object.keys(oneFacet.pairByHubToken);
		for (let pairIndex = 0; pairIndex < pairHubTokenList.length; pairIndex++) {
			const hubToken = pairHubTokenList[pairIndex];
			if (!/^[a-z][a-z0-9]*$/.test(hubToken)) {
				return refusal(`${facetWhat}.pairByHubToken names '${hubToken}', which is not a bundle token`, 'pairs are keyed by the hub\'s recipe token');
			}
			const pairError = pairRowRefusal({ pairRow: oneFacet.pairByHubToken[hubToken], whatName: `${facetWhat}.pairByHubToken.${hubToken}` });
			if (pairError) {
				return pairError;
			}
		}
	}
	return null;
};

module.exports = {
	COMPOSED_DECLARATION_KEY_LIST,
	PAIR_ROW_KEY_LIST,
	STANDARD_BRIDGING_KEY_LIST,
	FACET_KEY_LIST,
	PROMPT_IDENTIFIER_SCAN_FROM_HUB,
	PROMPT_IDENTIFIER_SCAN_HUB_OWN,
	isUnionBlindingOrder,
	DECLARED_TARGET_RULES_FROM_HUB,
	validateStandardBridging,
	moduleName,
};
