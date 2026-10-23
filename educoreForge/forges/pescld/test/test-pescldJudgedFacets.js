#!/usr/bin/env node
'use strict';

// test-pescldJudgedFacets.js — zeroBacklog lane C4, Docker-free: the JUDGED facets of PESC_LD's bridging file (the terms PESC_LD coins
// itself, termCurie under pesc:), composed by the tree's registry with each hub's own declaration. Writes nothing.
//
// CONJUNCTS
//   a  the registry composes the four judged bridges (two facets × the hubs pescldHubPairing.json names), each derived basis, the
//      judge naming the relation (judgeSlot-v1), resolving to the instruction form of the split question (derivedJudgeSlot)
//   b  each scope file is EXACTLY the forged snapshot's pesc: subjects of its role (rows 142, shapes 17), sorted, disjoint
//   c  crossRefs is blinded in every judged bridge (a valueClass may name a hub class: an answer key)
//   d  the declared facet does not move: its two bridges keep the digests lane C3 froze (61c6c9cd, a5245e6b)
//   e  the judged facets pair with exactly the hubs the pairing data names, in no other way

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the PESC_LD judged facets compose, scope exactly the pesc: subjects, and blind crossRefs (no Docker)

SYNOPSIS
     node forges/pescld/test/${moduleName}.js [-verbose] [-help]

EXIT STATUS
     0 every conjunct passed;  1 otherwise.
`;

const path = require('path');
const crypto = require('crypto');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const harness = require(path.join(TREE_ROOT, 'test', 'testLib', 'harness'))(moduleName);
const pluginRegistryLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'pluginRegistry'));
const bridgePluginContractLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'bridgePluginContract'));

const FORGES_DIR_PATH = path.join(TREE_ROOT, 'forges');
const BRIDGES_DIR_PATH = path.join(__dirname, '..', 'bridges');
const SNAPSHOT_DIR_PATH = path.join(__dirname, '..', 'assets', 'standardSourceData', '01');
const HUB_PAIRING = require(path.join(BRIDGES_DIR_PATH, 'pescldHubPairing.json'));
const PESC_TERM_CURIE_PATTERN = /^pesc:/;
// facet name → the role its subjects carry, its scope file and the count measured on snapshot 01
const JUDGED_FACET_BY_NAME = Object.freeze({
	PescTermRow: { role: 'DmeProperty', scopeFileName: 'pescldPescTermRowSubjects.json', expectedSubjectCount: 142 },
	PescTermShape: { role: 'DmeClass', scopeFileName: 'pescldPescTermShapeSubjects.json', expectedSubjectCount: 17 },
});
const capitalised = (text) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
const judgedBridgeNameFor = ({ facetName, hubToken }) => `pescld${facetName}${capitalised(hubToken)}DerivedPlugin`;
const DECLARED_DIGEST_BY_BRIDGE_NAME = Object.freeze({
	pescldCtdlDeclaredIdentity: '61c6c9cda1b1f7cbca25ecf77f50bdf316c8f685d4447bcc9df5a418c7672ff7',
	pescldCedsDeclaredIdentity: 'a5245e6b402c54d1c7572da75ecd7dde6589edb5353e65c04273dff483772595',
});
const sha256Hex = (text) => crypto.createHash('sha256').update(text).digest('hex');

const bundle = require(path.join(__dirname, '..', 'forgePescld'))({ embedder: null });

bundle.forge({ sourcePath: SNAPSHOT_DIR_PATH, owner: 'test', skipEmbedding: true }, (forgeError, forgeResult) => {
	harness.accepts('the snapshot forges', forgeError ? [forgeError] : []);
	if (forgeError) {
		harness.report();
		return;
	}
	const registry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: FORGES_DIR_PATH });
	const entryByBridgeName = registry.entryByBridgeName || {};
	const hubTokenList = Object.keys(HUB_PAIRING.declaredTargetRuleListByHubToken).sort();

	harness.section('a: the four judged bridges compose');
	Object.keys(JUDGED_FACET_BY_NAME).forEach((facetName) => {
		hubTokenList.forEach((hubToken) => {
			const bridgeName = judgedBridgeNameFor({ facetName, hubToken });
			const entry = entryByBridgeName[bridgeName];
			const declaration = entry === undefined ? {} : entry.bridgeDeclaration;
			const resolved = entry === undefined ? {} : bridgePluginContractLib.judgePromptVariantFor({ bridgeDeclaration: declaration });
			harness.equal(`a: ${bridgeName}: registered, toward ${hubToken}, derived, judgeSlot-v1, variant derivedJudgeSlot`,
				entry === undefined ? `NOT REGISTERED${registry.error ? ': ' + registry.error.message : ''}` : `${entry.targetHub} ${declaration.matchBasis} ${declaration.predicateSource && declaration.predicateSource.predicateRule} ${resolved.judgePromptVariant}`,
				`${hubToken} derived judgeSlot-v1 derivedJudgeSlot`);
		});
	});

	harness.section('b: each scope file is exactly the snapshot\'s pesc: subjects of its role');
	const scopeSetByFacetName = {};
	Object.keys(JUDGED_FACET_BY_NAME).forEach((facetName) => {
		const facet = JUDGED_FACET_BY_NAME[facetName];
		const scopeStableIdList = require(path.join(BRIDGES_DIR_PATH, facet.scopeFileName));
		const forgedStableIdList = forgeResult.nodes.filter((oneNode) => oneNode.role === facet.role && PESC_TERM_CURIE_PATTERN.test(oneNode.properties.termCurie || '')).map((oneNode) => oneNode.stableId).sort();
		scopeSetByFacetName[facetName] = new Set(scopeStableIdList);
		harness.equal(`b: ${facet.scopeFileName} = the forged ${facet.role} nodes under pesc: (${facet.expectedSubjectCount})`, JSON.stringify(scopeStableIdList), JSON.stringify(forgedStableIdList));
		harness.equal(`b: ${facet.scopeFileName} holds ${facet.expectedSubjectCount}`, scopeStableIdList.length, facet.expectedSubjectCount);
	});
	harness.equal('b: the two scopes are disjoint', [...scopeSetByFacetName.PescTermRow].filter((oneStableId) => scopeSetByFacetName.PescTermShape.has(oneStableId)).length, 0);

	harness.section('c: crossRefs blinded in every judged bridge');
	const judgedEntryList = Object.keys(entryByBridgeName).filter((bridgeName) => /^pescldPescTerm.*DerivedPlugin$/.test(bridgeName)).map((bridgeName) => entryByBridgeName[bridgeName]);
	harness.equal('c: four judged bridges found', judgedEntryList.length, Object.keys(JUDGED_FACET_BY_NAME).length * hubTokenList.length);
	harness.equal('c: none lacks crossRefs in its blinding declaration', judgedEntryList.filter((oneEntry) => oneEntry.bridgeDeclaration.blindingDeclaration.indexOf('crossRefs') === -1).map((oneEntry) => oneEntry.bridgeName).join(','), '');

	harness.section('d: the declared facet does not move');
	Object.keys(DECLARED_DIGEST_BY_BRIDGE_NAME).forEach((bridgeName) => {
		const entry = entryByBridgeName[bridgeName];
		harness.equal(`d: ${bridgeName} keeps its frozen digest`, entry === undefined ? 'NOT REGISTERED' : sha256Hex(entry.declarationCanonicalText), DECLARED_DIGEST_BY_BRIDGE_NAME[bridgeName]);
	});

	harness.section('e: the judged facets pair with exactly the hubs the pairing data names');
	const judgedHubTokenList = [...new Set(judgedEntryList.map((oneEntry) => oneEntry.targetHub))].sort();
	harness.equal('e: hub tokens of the judged bridges = the pairing data\'s', JSON.stringify(judgedHubTokenList), JSON.stringify(hubTokenList));
	harness.report();
});
