'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// bridgeComposer.js — a bridge is a COMPOSITION: one standard's bridging declaration (standardBridgingContract.js), one facet
// of it, one hub's bridging declaration (hubBridgingContract.js) and the pair row joining them (R3 of the hub-neutral bridge
// lane, 2026-10-21). The composer makes ORDINARY plugin modules { bridgeDeclaration, bridgeHooks, bridgeTarget } and the
// registry registers them exactly as it registers a plugin file (pluginRegistry.registerPlugin): the registry's entries, the
// run, the materialiser and the decision store keep their contracts.
//
// THE COMPOSITION MUST REPRODUCE TODAY'S DECLARATIONS BYTE FOR BYTE (canonically: keys sorted, arrays in order), because each
// one's digest is in its frozen decision block and a drifted digest refuses the materialise (plan trap T2). So every string
// that embeds the hub is DERIVED by rule rather than written, and every list keeps today's order:
//   bridgeName           <stem><facetName><Hub><basis suffix>                 (BASIS_NAME_SUFFIX_BY_MATCH_BASIS; ruling Q-R3)
//   identifierListPath   bridges/<stem><Hub>IdList.json                       (today's per-plugin list; its string is digested)
//   blindingDeclaration  the pair's blindingOrder, each { hubAnchor: i } replaced by the hub's i-th anchor name
//   remodelTableRef      the hub's remodelTableRefList[i], or null
//   declaredTargetRuleList  the hub's rules, every one ('fromHub') or only the kinds the pair row's value names, in hub order
//                        (standardBridgingContract DECLARED_TARGET_RULE_KIND_FILTER_BY_PAIR_VALUE); a filter that leaves none is refused
// <Hub> is the hub token with its first letter capitalised. A positional reference is checked against the length the pair
// declared for the hub list: a hub edit that changes the length refuses every bridge that read it by position, by name
// (SCARLET_ARROW's condition, 2026-10-21) — a hub declaration edit must never silently shift another bridge's blinding.
//
//   composePluginModuleList({ standardBridging, bridgeHooksByFacetName, hubBridgingByToken })
//     → { pluginModuleList: [{ bridgeDeclaration, bridgeHooks, bridgeTarget }] } | { error }
//     ⟪R4⟫ bridgeTarget = { targetHub: <hub token>, judgeWording: <a copy of the hub's judgeWording> }
//   derivedBridgeNameFor({ bridgeNameStem, facetName, hubToken, matchBasis }) → name | undefined (an unregistered basis)
//   BASIS_NAME_SUFFIX_BY_MATCH_BASIS

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const standardBridgingContractLib = require('./standardBridgingContract');

// the closing word of a bridgeName, by the declaration's matchBasis (the measured names of every frozen bridge, R0 census)
const BASIS_NAME_SUFFIX_BY_MATCH_BASIS = Object.freeze({
	derived: 'DerivedPlugin',
	standard: 'StandardPlugin',
	declared: 'DeclaredCorrespondence',
	// ⟪zeroBacklog lane C, 2026-10-22⟫ the composed declared-identity bridge (option A, BRONZE_CROWN ruling)
	declaredIdentity: 'DeclaredIdentity',
});
const LEGACY_IDENTIFIER_LIST_PATH_TEMPLATE = Object.freeze({ directoryName: 'bridges', fileSuffix: 'IdList.json' });

const capitalised = (token) => `${token.charAt(0).toUpperCase()}${token.slice(1)}`;
const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);

const derivedBridgeNameFor = ({ bridgeNameStem, facetName, hubToken, matchBasis }) =>
	BASIS_NAME_SUFFIX_BY_MATCH_BASIS[matchBasis] === undefined ? undefined : `${bridgeNameStem}${facetName}${capitalised(hubToken)}${BASIS_NAME_SUFFIX_BY_MATCH_BASIS[matchBasis]}`;

const legacyIdentifierListPathFor = ({ bridgeNameStem, hubToken }) => `${LEGACY_IDENTIFIER_LIST_PATH_TEMPLATE.directoryName}/${bridgeNameStem}${capitalised(hubToken)}${LEGACY_IDENTIFIER_LIST_PATH_TEMPLATE.fileSuffix}`;

const positionalRefusal = ({ whatName, listName, declaredLength, hubList, hubToken }) =>
	declaredLength !== hubList.length
		? refuse.byName({ moduleName, what: `${whatName} reads the ${hubToken} hub's ${listName} by position, written when it had ${declaredLength} entr(ies); it now has ${hubList.length}`, where: 'a hub edit that changes a list another bridge reads by position must restate that bridge\'s pair row; nothing shifts silently' })
		: null;

// blindingNameListFor — the array form resolves anchors by position (today's exact order); the union form is the standard's names
// then every paired hub's anchors in hub-token order, each name once (pairedHubBridgingList is already in that order)
const blindingNameListFor = ({ pairRow, hubBridging, pairedHubBridgingList }) =>
	standardBridgingContractLib.isUnionBlindingOrder(pairRow.blindingOrder)
		? pairRow.blindingOrder.standardBlindingNameList.concat(...pairedHubBridgingList.map((onePairedHub) => onePairedHub.sourceAnchorBlindingNameList)).filter((oneName, oneIndex, nameList) => nameList.indexOf(oneName) === oneIndex)
		: pairRow.blindingOrder.map((oneMember) => (isPlainObject(oneMember) ? hubBridging.sourceAnchorBlindingNameList[oneMember.hubAnchor] : oneMember));

// promptIdentifierScanFor — 'fromHubWithLegacyListPath': the hub's patterns, today's per-plugin list path (digested); 'fromHub': the
// hub's own scan, its list path made relative to the source bundle so it resolves beside the hub (promptIdentifierScan.js joins
// forgesDir/<source>/<path>) and stays machine-independent in the digest
const promptIdentifierScanFor = ({ pairRow, hubBridging, bridgeNameStem, hubToken }) => ({
	identifierPatternList: hubBridging.promptIdentifierScan.identifierPatternList.map((onePattern) => ({ ...onePattern })),
	identifierListPath: pairRow.promptIdentifierScan === standardBridgingContractLib.PROMPT_IDENTIFIER_SCAN_HUB_OWN
		? (hubBridging.promptIdentifierScan.identifierListPath === null ? null : `../${hubToken}/${hubBridging.promptIdentifierScan.identifierListPath}`)
		: legacyIdentifierListPathFor({ bridgeNameStem, hubToken }),
});

const composeOne = ({ standardBridging, oneFacet, hubToken, pairRow, hubBridging, pairedHubBridgingList, bridgeHooks }) => {
	const whatName = `${standardBridging.standardKey} facet '${oneFacet.facetName}' → ${hubToken}`;
	const template = oneFacet.declarationTemplate;
	const bridgeName = derivedBridgeNameFor({ bridgeNameStem: standardBridging.bridgeNameStem, facetName: oneFacet.facetName, hubToken, matchBasis: template.matchBasis });
	if (bridgeName === undefined) {
		return { error: refuse.byName({ moduleName, what: `${whatName}: matchBasis '${template.matchBasis}' has no bridgeName suffix`, where: `BASIS_NAME_SUFFIX_BY_MATCH_BASIS names ${Object.keys(BASIS_NAME_SUFFIX_BY_MATCH_BASIS).join(', ')}` }) };
	}
	const anchorLengthError = pairRow.hubAnchorListLength === null ? null : positionalRefusal({ whatName, listName: 'sourceAnchorBlindingNameList', declaredLength: pairRow.hubAnchorListLength, hubList: hubBridging.sourceAnchorBlindingNameList, hubToken });
	if (anchorLengthError) {
		return { error: anchorLengthError };
	}
	const outOfRangeAnchor = !Array.isArray(pairRow.blindingOrder) ? undefined : pairRow.blindingOrder.find((oneMember) => isPlainObject(oneMember) && hubBridging.sourceAnchorBlindingNameList[oneMember.hubAnchor] === undefined);
	if (outOfRangeAnchor !== undefined) {
		return { error: refuse.byName({ moduleName, what: `${whatName}: blindingOrder references hub anchor ${outOfRangeAnchor.hubAnchor}, outside the ${hubToken} hub's ${hubBridging.sourceAnchorBlindingNameList.length} anchor name(s)`, where: 'a positional reference names an entry the hub declares' }) };
	}
	const remodelLengthError = pairRow.hubRemodelTableListLength === null ? null : positionalRefusal({ whatName, listName: 'remodelTableRefList', declaredLength: pairRow.hubRemodelTableListLength, hubList: hubBridging.remodelTableRefList, hubToken });
	if (remodelLengthError) {
		return { error: remodelLengthError };
	}
	if (pairRow.remodelTableRef !== null && hubBridging.remodelTableRefList[pairRow.remodelTableRef.hubRemodelTable] === undefined) {
		return { error: refuse.byName({ moduleName, what: `${whatName}: remodelTableRef references hub remodel table ${pairRow.remodelTableRef.hubRemodelTable}, outside the ${hubToken} hub's ${hubBridging.remodelTableRefList.length}`, where: 'a positional reference names an entry the hub declares' }) };
	}
	// the hub's rules this pair takes: all, or only the kinds its pair-row value names (declared in the pair row, never silent)
	const ruleKindFilter = pairRow.declaredTargetRuleList === null ? null : standardBridgingContractLib.DECLARED_TARGET_RULE_KIND_FILTER_BY_PAIR_VALUE[pairRow.declaredTargetRuleList];
	const pairRuleList = pairRow.declaredTargetRuleList === null ? null : hubBridging.declaredTargetRuleList.filter((oneRule) => ruleKindFilter === null || ruleKindFilter.indexOf(oneRule.ruleKind) !== -1);
	if (pairRuleList !== null && pairRuleList.length === 0) {
		return { error: refuse.byName({ moduleName, what: `${whatName}: declaredTargetRuleList '${pairRow.declaredTargetRuleList}' takes the ${hubToken} hub's ${ruleKindFilter.join(', ')} rules, and its list holds no ${ruleKindFilter.join(' or ')} rule`, where: 'the hub declares no rule of the kinds this pair takes; add one in the hub\'s bridging declaration or take its rules by another pair value' }) };
	}
	const bridgeDeclaration = {
		...template,
		bridgeName,
		blindingDeclaration: blindingNameListFor({ pairRow, hubBridging, pairedHubBridgingList }),
		remodelTableRef: pairRow.remodelTableRef === null ? null : hubBridging.remodelTableRefList[pairRow.remodelTableRef.hubRemodelTable],
		...(oneFacet.subjectRenderingAllowList === null ? {} : { renderingAllowList: { subject: oneFacet.subjectRenderingAllowList.slice(), candidate: (pairRow.candidateRenderingAllowList === null ? hubBridging.candidateRenderingAllowList : pairRow.candidateRenderingAllowList).slice() } }),
		...(pairRow.candidateRetrieval === null ? {} : { candidateRetrieval: { ...pairRow.candidateRetrieval, embeddingModelVersion: hubBridging.embeddingModelVersion } }),
		...(pairRow.promptIdentifierScan === null
			? {}
			: { promptIdentifierScan: promptIdentifierScanFor({ pairRow, hubBridging, bridgeNameStem: standardBridging.bridgeNameStem, hubToken }) }),
		...(pairRuleList === null ? {} : { declaredTargetRuleList: pairRuleList.map((oneRule) => ({ ...oneRule })) }),
		// ⟪zeroBacklog B2⟫ ONLY for a bridge that RENDERS candidates (it has a renderingAllowList) toward a hub that declares a rule: a
		// hub that declares null composes no key, and neither does a declared or documentary bridge, which renders nothing, so no
		// existing digest moves (P-a1)
		...(oneFacet.subjectRenderingAllowList === null || hubBridging.renderedProseIdentifierRule === null ? {} : { renderedProseIdentifierRule: { ...hubBridging.renderedProseIdentifierRule } }),
	};
	// ⟪zeroBacklog lane B, BRONZE_CROWN ruling 2026-10-23⟫ a pair row that STATES judgmentPartition decides this pairing's partition: an
	// object replaces the template's, null removes it (the plugin contract reads an absent key as "no partition"); a row that does not
	// state it leaves the template's in place, so no existing pairing's declaration moves
	if (Object.prototype.hasOwnProperty.call(pairRow, 'judgmentPartition')) {
		if (pairRow.judgmentPartition === null) {
			delete bridgeDeclaration.judgmentPartition;
		} else {
			bridgeDeclaration.judgmentPartition = { ...pairRow.judgmentPartition };
		}
	}
	return { pluginModule: { bridgeDeclaration, bridgeHooks, bridgeTarget: { targetHub: hubToken, judgeWording: { ...hubBridging.judgeWording } } } };
};

const composePluginModuleList = ({ standardBridging, bridgeHooksByFacetName, hubBridgingByToken, bundleDirName } = {}) => {
	const contractError = standardBridgingContractLib.validateStandardBridging({ standardBridging, bridgeHooksByFacetName, bundleDirName });
	if (contractError) {
		return { error: contractError };
	}
	// every hub the standard pairs with, across its facets, in hub-token order: the union blinding form reads all of them
	const pairedHubTokenList = Array.from(new Set([].concat(...standardBridging.facetList.map((oneFacet) => Object.keys(oneFacet.pairByHubToken))))).sort();
	const unloadedHubToken = pairedHubTokenList.find((hubToken) => hubBridgingByToken[hubToken] === undefined);
	if (unloadedHubToken !== undefined) {
		return { error: refuse.byName({ moduleName, what: `${standardBridging.standardKey} pairs with hub '${unloadedHubToken}', whose bridging declaration was not loaded`, where: 'the registry loads every paired hub\'s declaration (hubBridgingLoader) before composing' }) };
	}
	const pairedHubBridgingList = pairedHubTokenList.map((hubToken) => hubBridgingByToken[hubToken]);
	const pluginModuleList = [];
	for (let facetIndex = 0; facetIndex < standardBridging.facetList.length; facetIndex++) {
		const oneFacet = standardBridging.facetList[facetIndex];
		const hubTokenList = Object.keys(oneFacet.pairByHubToken).sort();
		for (let pairIndex = 0; pairIndex < hubTokenList.length; pairIndex++) {
			const hubToken = hubTokenList[pairIndex];
			const hubBridging = hubBridgingByToken[hubToken];
			if (hubBridging === undefined) {
				return { error: refuse.byName({ moduleName, what: `${standardBridging.standardKey} facet '${oneFacet.facetName}' pairs with hub '${hubToken}', whose bridging declaration was not loaded`, where: 'the registry loads every paired hub\'s declaration (hubBridgingLoader) before composing' }) };
			}
			const composed = composeOne({ standardBridging, oneFacet, hubToken, pairRow: oneFacet.pairByHubToken[hubToken], hubBridging, pairedHubBridgingList, bridgeHooks: bridgeHooksByFacetName[oneFacet.facetName] });
			if (composed.error) {
				return { error: composed.error };
			}
			pluginModuleList.push(composed.pluginModule);
		}
	}
	return { pluginModuleList };
};

module.exports = { composePluginModuleList, derivedBridgeNameFor, legacyIdentifierListPathFor, BASIS_NAME_SUFFIX_BY_MATCH_BASIS, moduleName };
