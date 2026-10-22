#!/usr/bin/env node
'use strict';

// test-hubBridging.js — R2 of the hub-neutral bridge lane (2026-10-21): each hub declares the HUB HALF of every bridge toward it
// once, in a file of its own (forges/<hub>/lib/<hub>HubBridging.js, located by the hub descriptor's hubBridgingModule key), and
// the contract (lib/bridge-framework/hubBridgingContract.js) refuses anything it does not name. Nothing reads it yet; R3 does.
//
// PROVES:
//   (a) the contract: both shipped declarations validate; an unknown key, every missing required key and a wrong kind are each
//       refused BY NAME (the key is named in the refusal)
//   (b) the loader finds the file by the hub bundle's DECLARED location (parserDescriptor hubBridgingModule), never by a
//       hub-name switch: it loads both shipped hubs, refuses a hub whose descriptor declares no bridging module, refuses an
//       unknown hub token, and refuses a file whose hubToken is not its bundle's
//   (c) the CEDS values are COPIED, not invented: each equals what today's CEDS-targeting plugins carry (read from the
//       plugins in this test); the ruled exception (pesc260805's two plugins keep a 5-field candidate list as a pair
//       override, SCARLET_ARROW 2026-10-21) is asserted to still DIFFER, so the exception cannot go stale silently
//   (d) ONE hub id list: the CEDS hub's identifier list is byte-equal (sha256) to every one of the ten per-plugin copies
//   (e) the hub module never requires the bridging file (plan T4: the forged hub output cannot move)
//   (f) the CTDL values equal what today's CTDL-targeting plugin carries
//   (g) the framework files name no hub

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: hub bridging declarations, their contract and loader (R2)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const FORGES_DIR_PATH = path.join(TREE_ROOT, 'forges');
const contractLib = require('../hubBridgingContract');
const loaderLib = require('../hubBridgingLoader');
const pluginRegistryLib = require('../pluginRegistry');
const { canonicalJsonText } = require('../bridgePluginContract');

const sameText = (leftValue, rightValue) => canonicalJsonText(leftValue) === canonicalJsonText(rightValue);
const sha256OfFile = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

harness.section('(b) the loader, by declared location');
const cedsLoaded = loaderLib.loadHubBridging({ forgesDirPath: FORGES_DIR_PATH, hubToken: 'ceds' });
const ctdlLoaded = loaderLib.loadHubBridging({ forgesDirPath: FORGES_DIR_PATH, hubToken: 'ctdl' });
harness.ok('the CEDS hub bridging declaration loads', cedsLoaded.error === undefined, cedsLoaded.error && cedsLoaded.error.message);
harness.ok('the CTDL hub bridging declaration loads', ctdlLoaded.error === undefined, ctdlLoaded.error && ctdlLoaded.error.message);
if (cedsLoaded.error || ctdlLoaded.error) {
	harness.report();
	return;
}
const cedsHubBridging = cedsLoaded.hubBridging;
const ctdlHubBridging = ctdlLoaded.hubBridging;
harness.match('a hub whose descriptor declares no bridging module is refused by name', String((loaderLib.loadHubBridging({ forgesDirPath: FORGES_DIR_PATH, hubToken: 'edfi' }).error || {}).message), /declares no hubBridgingModule/);
harness.match('an unknown hub token is refused by name', String((loaderLib.loadHubBridging({ forgesDirPath: FORGES_DIR_PATH, hubToken: 'nosuchhub' }).error || {}).message), /no forge bundle 'nosuchhub'/);
// a scratch forges tree whose bridging file names the wrong hubToken
const scratchForgesDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'testHubBridging-'));
fs.mkdirSync(path.join(scratchForgesDirPath, 'toyhub', 'lib'), { recursive: true });
fs.writeFileSync(path.join(scratchForgesDirPath, 'toyhub', 'parserDescriptor.ini'), '[parserDescriptor]\nstandardName=TOYHUB\nentryModule=forgeToyhub.js\nhubModule=hubToyhub.js\nhubNamespace=https://example.org/toyhub/\nhubBridgingModule=lib/toyhubHubBridging.js\n');
fs.writeFileSync(path.join(scratchForgesDirPath, 'toyhub', 'lib', 'toyhubHubBridging.js'), `module.exports = ${JSON.stringify({ hubBridging: { ...ctdlHubBridging, hubToken: 'otherhub' } })};\n`);
harness.match('a bridging file whose hubToken is not its bundle\'s is refused by name', String((loaderLib.loadHubBridging({ forgesDirPath: scratchForgesDirPath, hubToken: 'toyhub' }).error || {}).message), /declares hubToken 'otherhub' but sits in bundle 'toyhub'/);
fs.rmSync(scratchForgesDirPath, { recursive: true, force: true });

harness.section('(a) the contract');
harness.ok('the CEDS declaration validates', contractLib.validateHubBridging({ hubBridging: cedsHubBridging }) === null);
harness.ok('the CTDL declaration validates', contractLib.validateHubBridging({ hubBridging: ctdlHubBridging }) === null);
const refusalTextOf = (hubBridging) => String((contractLib.validateHubBridging({ hubBridging }) || {}).message);
harness.match('an unknown key is refused by name', refusalTextOf({ ...cedsHubBridging, hubColour: 'blue' }), /unknown key 'hubColour'/);
contractLib.HUB_BRIDGING_KEY_LIST.forEach((keyName) => {
	const withoutKey = { ...cedsHubBridging };
	delete withoutKey[keyName];
	harness.match(`a missing '${keyName}' is refused by name`, refusalTextOf(withoutKey), new RegExp(`missing required key '${keyName}'`));
});
harness.match('a wrong kind is refused naming the key (candidateRenderingAllowList)', refusalTextOf({ ...cedsHubBridging, candidateRenderingAllowList: 'name' }), /'candidateRenderingAllowList'/);
harness.match('a wrong kind is refused naming the key (termKeyForm)', refusalTextOf({ ...cedsHubBridging, termKeyForm: 'urn' }), /'termKeyForm'.*absoluteIri, curie/);
harness.match('a wrong kind is refused naming the key (retrievalTier)', refusalTextOf({ ...cedsHubBridging, retrievalTier: 'galaxy' }), /'retrievalTier'/);
harness.match('a malformed identifier pattern row is refused naming the key', refusalTextOf({ ...cedsHubBridging, promptIdentifierScan: { ...cedsHubBridging.promptIdentifierScan, identifierPatternList: [{ patternName: 'broken' }] } }), /'promptIdentifierScan'/);
harness.match('a null where null is not declared is refused (embeddingModelVersion)', refusalTextOf({ ...cedsHubBridging, embeddingModelVersion: null }), /'embeddingModelVersion'/);

harness.section('(c) CEDS: copied, not invented — each value equals today\'s CEDS-targeting plugins');
const registry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: FORGES_DIR_PATH });
const pluginEntryList = Object.keys(registry.entryByBridgeName).sort().map((bridgeName) => registry.entryByBridgeName[bridgeName]);
const towardHub = (hubToken) => pluginEntryList.filter((oneEntry) => oneEntry.targetHub === hubToken);
const cedsEntryList = towardHub(cedsHubBridging.hubToken);
// SCARLET_ARROW 2026-10-21: the two older pesc260805 plugins keep their own 5-field candidate list as a declared pair override (R3)
const CANDIDATE_LIST_PAIR_OVERRIDE_BRIDGE_NAME_LIST = Object.freeze(['pescCedsDerivedPlugin', 'pescOptionSetCedsDerivedPlugin']);
const withCandidateList = cedsEntryList.filter((oneEntry) => oneEntry.bridgeDeclaration.renderingAllowList !== undefined);
const candidateMismatchList = withCandidateList.filter((oneEntry) => !sameText(oneEntry.bridgeDeclaration.renderingAllowList.candidate, cedsHubBridging.candidateRenderingAllowList)).map((oneEntry) => oneEntry.bridgeName).sort();
harness.equal('candidate rendering list = every judged CEDS plugin\'s, except the ruled pair overrides', candidateMismatchList.join(','), CANDIDATE_LIST_PAIR_OVERRIDE_BRIDGE_NAME_LIST.slice().sort().join(','));
harness.equal('the candidate list is shared by the ten current-generation plugins', withCandidateList.length - candidateMismatchList.length, 10);
const withScan = cedsEntryList.filter((oneEntry) => oneEntry.bridgeDeclaration.promptIdentifierScan !== undefined);
harness.equal('identifier pattern list = every scanning CEDS plugin\'s (10)', withScan.filter((oneEntry) => sameText(oneEntry.bridgeDeclaration.promptIdentifierScan.identifierPatternList, cedsHubBridging.promptIdentifierScan.identifierPatternList)).length, 10);
const withRetrieval = cedsEntryList.filter((oneEntry) => oneEntry.bridgeDeclaration.candidateRetrieval !== undefined);
harness.equal('embedding model = every retrieving CEDS plugin\'s (12)', withRetrieval.filter((oneEntry) => oneEntry.bridgeDeclaration.candidateRetrieval.embeddingModelVersion === cedsHubBridging.embeddingModelVersion).length, 12);
// the hub's anchor names, read off each plugin's blinding list in ITS order: the names a source stamps when it carries this hub's anchors
const hubAnchorNameSet = new Set(cedsHubBridging.sourceAnchorBlindingNameList);
const anchorBlindingMismatchList = cedsEntryList
	.filter((oneEntry) => oneEntry.bridgeDeclaration.blindingDeclaration.some((oneName) => hubAnchorNameSet.has(oneName)))
	.filter((oneEntry) => !sameText(oneEntry.bridgeDeclaration.blindingDeclaration.filter((oneName) => hubAnchorNameSet.has(oneName)), cedsHubBridging.sourceAnchorBlindingNameList))
	.map((oneEntry) => oneEntry.bridgeName);
harness.equal('hub anchor blinding names = each blinding CEDS plugin\'s, in its order', anchorBlindingMismatchList.join(','), '');
const declaredCedsEntryList = cedsEntryList.filter((oneEntry) => oneEntry.bridgeDeclaration.declaredTargetRuleList !== undefined);
harness.equal('declared target rules = the declared CEDS plugin\'s (one plugin)', `${declaredCedsEntryList.length} ${declaredCedsEntryList.every((oneEntry) => sameText(oneEntry.bridgeDeclaration.declaredTargetRuleList, cedsHubBridging.declaredTargetRuleList))}`, '1 true');
const remodelRefList = cedsEntryList.map((oneEntry) => oneEntry.bridgeDeclaration.remodelTableRef).filter((oneRef) => oneRef !== null && oneRef !== undefined);
// ⟪zeroBacklog lane D, D3-6, 2026-10-22⟫ ceds14PropertyRemodel's one consumer, sifCedsStandardPlugin, retired with the old SIF forge, so the
// hub now declares a table no shipped plugin names; it is stated here by name (the hub declaration is lane C's file, not edited by lane D)
const REMODEL_REF_WITHOUT_SHIPPED_CONSUMER_LIST = Object.freeze(['ceds14PropertyRemodel']);
harness.equal('remodel table refs = the set the CEDS plugins name, plus the named ones whose consumer retired', canonicalJsonText(Array.from(new Set(remodelRefList.concat(REMODEL_REF_WITHOUT_SHIPPED_CONSUMER_LIST))).sort()), canonicalJsonText(cedsHubBridging.remodelTableRefList.slice().sort()));

harness.section('(d) one hub id list');
const cedsIdListPath = path.join(FORGES_DIR_PATH, cedsHubBridging.hubToken, cedsHubBridging.promptIdentifierScan.identifierListPath);
const perPluginListShaSet = new Set(withScan.map((oneEntry) => sha256OfFile(path.join(FORGES_DIR_PATH, oneEntry.standardKey, oneEntry.bridgeDeclaration.promptIdentifierScan.identifierListPath))));
harness.equal('the ten per-plugin copies are one content', perPluginListShaSet.size, 1);
harness.equal('the hub\'s one list is byte-equal to them', sha256OfFile(cedsIdListPath), Array.from(perPluginListShaSet)[0]);

harness.section('(e) the hub module never requires the bridging file');
const hubSourceFileList = ['ceds', 'ctdl'].map((hubToken) => fs.readFileSync(path.join(FORGES_DIR_PATH, hubToken, `hub${hubToken.charAt(0).toUpperCase()}${hubToken.slice(1)}.js`), 'utf8'))
	.concat(fs.readdirSync(path.join(TREE_ROOT, 'lib', 'hub-framework')).filter((fileName) => fileName.endsWith('.js')).map((fileName) => fs.readFileSync(path.join(TREE_ROOT, 'lib', 'hub-framework', fileName), 'utf8')));
harness.equal('no hub module or hub-framework file reads a HubBridging module', hubSourceFileList.filter((sourceText) => /HubBridging\b/.test(sourceText) && /require\([^)]*HubBridging/.test(sourceText)).length, 0);

harness.section('(f) CTDL: each value equals today\'s CTDL-targeting plugin');
// ⟪zeroBacklog B3⟫ the DECLARED bridges toward CTDL: B3's derived bridges toward it carry no declared target rules
const ctdlEntryList = towardHub(ctdlHubBridging.hubToken).filter((oneEntry) => oneEntry.bridgeDeclaration.matchBasis === 'declared');
harness.equal('declared target rules = the declared CTDL plugin\'s (one plugin)', `${ctdlEntryList.length} ${ctdlEntryList.every((oneEntry) => sameText(oneEntry.bridgeDeclaration.declaredTargetRuleList, ctdlHubBridging.declaredTargetRuleList))}`, '1 true');

harness.section('(g) no hub literal in the framework files');
const frameworkFileList = [require.resolve('../hubBridgingContract'), require.resolve('../hubBridgingLoader')];
harness.equal('the contract and the loader name no hub', frameworkFileList.filter((filePath) => /ceds|ctdl/i.test(fs.readFileSync(filePath, 'utf8'))).map((filePath) => path.basename(filePath)).join(','), '');

harness.report();
