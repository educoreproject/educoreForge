#!/usr/bin/env node
'use strict';

// test-bridgeComposer.js — R3 of the hub-neutral bridge lane (2026-10-21): bridges composed as standard × hub must be the
// SAME bridges. The migration gate for EVERY registered bridge (the recipes of record are P-a1's; this covers all fifteen,
// including the ones in no recipe of record), plus the composer's own refusals.
//
// PROVES:
//   (a) every bridge registered at the R3 start (graphBuilder.ini [noRebuildProof] baselineDirectoryPath/
//       pluginDigestsAtR3Start.json) is registered now under the same bridgeName, standardKey and target hub, with the SAME
//       declarationDigest and the same hook names — whether it still comes from a plugin file or is now composed
//   (b) every bridgeName frozen in any decision store (R0 census) is registered now, or is named in the retired list below
//   (c) the composer refuses by name: a hub anchor referenced out of range; a hub anchor list whose length changed since the
//       pair row was written (SCARLET_ARROW's condition: no silent shift); the same for remodel tables; a template carrying a
//       composed key; a facet without hooks; an unknown pair key; a pair whose hub was not loaded
//   (d) derived strings: the bridgeName rule reproduces every registered composed name; the legacy id-list path rule too
//   (e) the composer and its contract name no hub
//   (f) never-rendered names: RENDERING_NEVER_NAME_LIST names no hub's identifier properties; they reach each bridge through its
//       composed blindingDeclaration, and BOTH nets (the declaration contract, the renderer) refuse an allow-listed blinded name

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: composed bridges are the same bridges (R3), and the composer refuses by name
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
FILES
     graphBuilder.ini [noRebuildProof] baselineDirectoryPath — pluginDigestsAtR3Start.json, frozenPairKeyCensus/
EXIT STATUS
     0 all assertions passed;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);
const { getConfig } = process.global;

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const FORGES_DIR_PATH = path.join(TREE_ROOT, 'forges');
const composerLib = require('../bridgeComposer');
const pluginRegistryLib = require('../pluginRegistry');
const hubBridgingLoaderLib = require('../hubBridgingLoader');

// frozen bridgeNames that are no longer registered, each with its reason (R0 census: 16 frozen names)
const RETIRED_FROZEN_BRIDGE_NAME_REASON = Object.freeze({
	edfiCedsCrosswalkPlugin: 'retired before this lane (forges/edfi/retiredBridges/); the AEM crosswalk was withdrawn as an answer key; no recipe names it',
});

const proofConfig = getConfig('noRebuildProof') || {};
const baselineDirectoryPath = proofConfig.baselineDirectoryPath;
const digestFilePath = typeof baselineDirectoryPath === 'string' ? path.join(baselineDirectoryPath, 'pluginDigestsAtR3Start.json') : '';
harness.ok('graphBuilder.ini [noRebuildProof] baselineDirectoryPath holds pluginDigestsAtR3Start.json', digestFilePath !== '' && fs.existsSync(digestFilePath), `got ${JSON.stringify(baselineDirectoryPath)}; there is no default and the gate does not skip`);

const registry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: FORGES_DIR_PATH });
const sha256Hex = (text) => crypto.createHash('sha256').update(text).digest('hex');

if (digestFilePath !== '' && fs.existsSync(digestFilePath)) {
	harness.section('(a) every bridge at the R3 start is the same bridge now');
	const atStart = JSON.parse(fs.readFileSync(digestFilePath, 'utf8')).pluginByBridgeName;
	Object.keys(atStart).sort().forEach((bridgeName) => {
		const entry = registry.entryByBridgeName[bridgeName];
		const was = atStart[bridgeName];
		const nowText = entry === undefined ? 'NOT REGISTERED' : `${entry.standardKey} → ${entry.targetHub} ${sha256Hex(entry.declarationCanonicalText)} hooks[${Object.keys(entry.bridgeHooks).sort().join(',')}]`;
		harness.equal(`${bridgeName}${entry !== undefined && entry.pluginFilePath !== path.join(TREE_ROOT, was.pluginFile) ? ' (now composed from ' + path.relative(TREE_ROOT, entry.pluginFilePath) + ')' : ''}`, nowText, `${was.standardKey} → ${was.targetHub} ${was.declarationDigest} hooks[${was.hookNameList.join(',')}]`);
	});
	harness.equal('no bridge registered now that was not registered at the start', Object.keys(registry.entryByBridgeName).filter((bridgeName) => atStart[bridgeName] === undefined).join(','), '');
}

harness.section('(b) every frozen bridgeName is registered or retired by name');
const distinctBridgeNameFilePath = typeof baselineDirectoryPath === 'string' ? path.join(baselineDirectoryPath, 'frozenPairKeyCensus', 'distinctBridgeNameAndKind.txt') : '';
if (distinctBridgeNameFilePath !== '' && fs.existsSync(distinctBridgeNameFilePath)) {
	const frozenBridgeNameList = fs.readFileSync(distinctBridgeNameFilePath, 'utf8').split('\n').map((oneLine) => oneLine.trim().split(/\s+/).pop()).filter(Boolean).map((oneText) => oneText.split('::')[0]);
	harness.equal('the R0 census names sixteen frozen bridges', frozenBridgeNameList.length, 16);
	harness.equal('each is registered or retired with a reason', frozenBridgeNameList.filter((bridgeName) => registry.entryByBridgeName[bridgeName] === undefined && RETIRED_FROZEN_BRIDGE_NAME_REASON[bridgeName] === undefined).join(','), '');
} else {
	harness.ok('the R0 frozen bridgeName census is at baselineDirectoryPath/frozenPairKeyCensus', false, 'absent; the gate does not skip');
}

harness.section('(c) the composer refuses by name');
const toyHubBridging = {
	hubToken: 'hubx',
	candidateRenderingAllowList: ['name'],
	promptIdentifierScan: { identifierPatternList: [{ patternName: 'hubxId', regexSource: 'X\\d{3}' }], identifierListPath: null },
	sourceAnchorBlindingNameList: ['hubxId', 'hubxCode'],
	judgeWording: { toolCandidateNoun: 'hubx candidate' },
	declaredTargetRuleList: [],
	termKeyForm: 'curie',
	embeddingModelVersion: 'toy-model',
	remodelTableRefList: ['hubxRemodel'],
	retrievalTier: 'property',
};
const toyPairRow = () => ({
	candidateRetrieval: { method: 'cosineTopK-v1', k: 5, floor: 0.3 },
	candidateRenderingAllowList: null,
	promptIdentifierScan: 'fromHubWithLegacyListPath',
	blindingOrder: [{ hubAnchor: 0 }, 'crossRefs', { hubAnchor: 1 }],
	hubAnchorListLength: 2,
	declaredTargetRuleList: null,
	remodelTableRef: { hubRemodelTable: 0 },
	hubRemodelTableListLength: 1,
});
const toyStandardBridging = (pairRowOverride, facetOverride) => ({
	standardKey: 'toy',
	bridgeNameStem: 'toy',
	facetList: [{ facetName: '', declarationTemplate: { standardKey: 'toy', matchBasis: 'derived' }, subjectRenderingAllowList: ['name'], pairByHubToken: { hubx: { ...toyPairRow(), ...(pairRowOverride || {}) } }, ...(facetOverride || {}) }],
});
const composeToy = ({ standardBridging, hubBridging, bridgeHooksByFacetName }) => composerLib.composePluginModuleList({ standardBridging, bridgeHooksByFacetName: bridgeHooksByFacetName || { '': {} }, hubBridgingByToken: hubBridging === null ? {} : { hubx: hubBridging || toyHubBridging }, bundleDirName: 'toy' });
const composedToy = composeToy({ standardBridging: toyStandardBridging() });
harness.ok('the clean toy composes', composedToy.error === undefined, composedToy.error && composedToy.error.message);
const toyDeclaration = composedToy.pluginModuleList[0].bridgeDeclaration;
harness.equal('bridgeName by rule', toyDeclaration.bridgeName, 'toyHubxDerivedPlugin');
harness.equal('blinding in the pair\'s order, anchors resolved by position', JSON.stringify(toyDeclaration.blindingDeclaration), JSON.stringify(['hubxId', 'crossRefs', 'hubxCode']));
harness.equal('the hub\'s embedding model joins the pair\'s retrieval', toyDeclaration.candidateRetrieval.embeddingModelVersion, 'toy-model');
harness.equal('the legacy id-list path by rule', toyDeclaration.promptIdentifierScan.identifierListPath, 'bridges/toyHubxIdList.json');
harness.equal('the remodel table resolved by position', toyDeclaration.remodelTableRef, 'hubxRemodel');
harness.equal('the target hub is the pair\'s hub', composedToy.pluginModuleList[0].bridgeTarget.targetHub, 'hubx');
const errorTextOf = (composed) => String((composed.error || {}).message);
harness.match('a hub anchor out of range is refused by name', errorTextOf(composeToy({ standardBridging: toyStandardBridging({ blindingOrder: [{ hubAnchor: 5 }] }) })), /references hub anchor 5, outside the hubx hub's 2 anchor name/);
harness.match('RED TWIN (condition): the hub\'s anchor list changed length → refused, never a silent shift', errorTextOf(composeToy({ standardBridging: toyStandardBridging(), hubBridging: { ...toyHubBridging, sourceAnchorBlindingNameList: ['hubxId', 'hubxNewName', 'hubxCode'] } })), /reads the hubx hub's sourceAnchorBlindingNameList by position, written when it had 2 entr\(ies\); it now has 3/);
harness.match('the same for the remodel list', errorTextOf(composeToy({ standardBridging: toyStandardBridging(), hubBridging: { ...toyHubBridging, remodelTableRefList: [] } })), /reads the hubx hub's remodelTableRefList by position, written when it had 1 entr\(ies\); it now has 0/);
harness.match('an anchor referenced without its declared length is refused', errorTextOf(composeToy({ standardBridging: toyStandardBridging({ hubAnchorListLength: null }) })), /hubAnchorListLength is null but blindingOrder references hub anchor/);
harness.match('a template carrying a composed key is refused', errorTextOf(composeToy({ standardBridging: toyStandardBridging(null, { declarationTemplate: { standardKey: 'toy', matchBasis: 'derived', bridgeName: 'x' } }) })), /declarationTemplate carries 'bridgeName', which the composer writes/);
harness.match('a facet without hooks is refused', errorTextOf(composeToy({ standardBridging: toyStandardBridging(), bridgeHooksByFacetName: {} })), /bridgeHooksByFacetName names \[\] but the facets are \[""\]/);
harness.match('an unknown pair key is refused', errorTextOf(composeToy({ standardBridging: toyStandardBridging({ colour: 'blue' }) })), /carries unknown key 'colour'/);
harness.match('a pair whose hub was not loaded is refused', errorTextOf(composeToy({ standardBridging: toyStandardBridging(), hubBridging: null })), /pairs with hub 'hubx', whose bridging declaration was not loaded/);

harness.section('(d) the derived strings reproduce every composed bridge');
const composedEntryList = Object.values(registry.entryByBridgeName).filter((oneEntry) => /Bridging\.js$/.test(oneEntry.pluginFilePath));
harness.note(`${composedEntryList.length} bridge(s) are composed so far`);
composedEntryList.forEach((oneEntry) => {
	const bridgingModule = require(oneEntry.pluginFilePath);
	const facet = bridgingModule.standardBridging.facetList.find((oneFacet) => composerLib.derivedBridgeNameFor({ bridgeNameStem: bridgingModule.standardBridging.bridgeNameStem, facetName: oneFacet.facetName, hubToken: oneEntry.targetHub, matchBasis: oneFacet.declarationTemplate.matchBasis }) === oneEntry.bridgeName);
	harness.ok(`${oneEntry.bridgeName}: the name rule reproduces it from its facet`, facet !== undefined);
	harness.ok(`${oneEntry.bridgeName}: its hub's declaration loads`, hubBridgingLoaderLib.loadHubBridging({ forgesDirPath: FORGES_DIR_PATH, hubToken: oneEntry.targetHub }).error === undefined);
});

harness.section('(e) no hub literal');
harness.equal('the composer and its contract name no hub', [require.resolve('../bridgeComposer'), require.resolve('../standardBridgingContract')].filter((filePath) => /ceds|ctdl/i.test(fs.readFileSync(filePath, 'utf8'))).map((filePath) => path.basename(filePath)).join(','), '');

harness.section('(f) a hub\'s identifier names are never rendered, supplied through the composer');
const bridgePluginContractLib = require('../bridgePluginContract');
const evidenceRendererLib = require('../evidenceRenderer');
const shippedHubTokenList = Array.from(new Set(Object.keys(registry.entryByBridgeName).map((bridgeName) => registry.entryByBridgeName[bridgeName].targetHub))).sort();
const hubAnchorNameList = [].concat(...shippedHubTokenList.map((hubToken) => {
	const loaded = hubBridgingLoaderLib.loadHubBridging({ forgesDirPath: FORGES_DIR_PATH, hubToken });
	return loaded.error ? [`(${hubToken}: ${loaded.error.message})`] : loaded.hubBridging.sourceAnchorBlindingNameList;
}));
harness.ok('the shipped hubs declare identifier names to blind', hubAnchorNameList.length > 0 && hubAnchorNameList.every((oneName) => !/^\(/.test(oneName)), hubAnchorNameList.join(', '));
harness.equal('RENDERING_NEVER_NAME_LIST names none of them (it is hub-neutral)', hubAnchorNameList.filter((oneName) => bridgePluginContractLib.RENDERING_NEVER_NAME_LIST.indexOf(oneName) !== -1).join(','), '');
const derivedEntryList = Object.keys(registry.entryByBridgeName).map((bridgeName) => registry.entryByBridgeName[bridgeName]).filter((oneEntry) => oneEntry.bridgeDeclaration.renderingAllowList !== undefined);
harness.equal('every rendering bridge blinds its hub\'s identifier names, so its never-rendered list holds them', derivedEntryList.filter((oneEntry) => {
	const anchorLoaded = hubBridgingLoaderLib.loadHubBridging({ forgesDirPath: FORGES_DIR_PATH, hubToken: oneEntry.targetHub });
	const neverRenderedNameList = bridgePluginContractLib.neverRenderedNameListFor(oneEntry.bridgeDeclaration.blindingDeclaration);
	return anchorLoaded.error || !anchorLoaded.hubBridging.sourceAnchorBlindingNameList.every((oneName) => neverRenderedNameList.indexOf(oneName) !== -1);
}).map((oneEntry) => oneEntry.bridgeName).join(','), '');
const edfiEntry = registry.entryByBridgeName.edfiCedsDerivedPlugin;
const blindedName = edfiEntry.bridgeDeclaration.blindingDeclaration.find((oneName) => bridgePluginContractLib.RENDERING_NEVER_NAME_LIST.indexOf(oneName) === -1);
const leakyDeclaration = JSON.parse(JSON.stringify(edfiEntry.bridgeDeclaration));
leakyDeclaration.renderingAllowList.candidate.push(blindedName);
const leakyValidated = bridgePluginContractLib.validateBridgeDeclaration({ bridgeDeclaration: leakyDeclaration, bundleDirPath: edfiEntry.bundleDirPath });
harness.match(`the contract refuses a blinded name ('${blindedName}') in the allow-list`, (leakyValidated.error && leakyValidated.error.message) || '', new RegExp(`renderingAllowList\\.candidate names '${blindedName}', which is on RENDERING_NEVER_NAME_LIST or the bridge's blindingDeclaration`));
const rendererInput = {
	sourceElement: { name: 'FirstName', material: { name: 'FirstName' } },
	candidatePool: [{ card: { stableId: 'hub:card/1', name: 'First Name', [blindedName]: 'X000001' }, seatReason: 'retrieval' }],
	globalGuidanceList: [],
	perCandidateNoteByStableId: {},
	promptSegmentList: [],
	judgePromptVariant: 'derived',
	renderingAllowList: { subject: ['name'], candidate: ['name', blindedName] },
};
harness.match('the renderer refuses an allow-list with no blindingNameList', ((evidenceRendererLib.renderQuestion(rendererInput).error) || {}).message || '', /requires blindingNameList/);
harness.match(`the renderer's own net refuses rendering the blinded name ('${blindedName}')`, ((evidenceRendererLib.renderQuestion({ ...rendererInput, blindingNameList: edfiEntry.bridgeDeclaration.blindingDeclaration }).error) || {}).message || '', new RegExp(`carries property '${blindedName}', which is on RENDERING_NEVER_NAME_LIST or the bridge's blindingDeclaration`));
harness.ok('without the name in the allow-list the same question renders', !evidenceRendererLib.renderQuestion({ ...rendererInput, renderingAllowList: { subject: ['name'], candidate: ['name'] }, blindingNameList: edfiEntry.bridgeDeclaration.blindingDeclaration }).error);

const evidenceContractsLib = require(path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'evidenceContracts'));
const toyCandidate = { stableId: 'hub:card/1', name: 'First Name', hubCode: 'P000123' };
harness.ok('the evidence gate\'s smuggling tokens include the hub\'s named identifier property', evidenceContractsLib.candidateIdentifyingTokens(toyCandidate, ['hubCode']).indexOf('P000123') !== -1);
harness.ok('and only the hub\'s: an undeclared identifier property is not a token', evidenceContractsLib.candidateIdentifyingTokens(toyCandidate, []).indexOf('P000123') === -1);
harness.match('the evidence gate refuses with no hubIdentifierNameList (no default hub)', evidenceContractsLib.evidencePackageViolation({ sourceElement: { name: 'X' }, pool: [], promptSegments: [] }), /hubIdentifierNameList undefined is not a list of names/);
harness.equal('the evidence contracts name no hub identifier property', /\bcandidate\.cedsId\b/.test(fs.readFileSync(require.resolve(path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'evidenceContracts')), 'utf8')), false);

harness.report();
