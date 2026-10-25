#!/usr/bin/env node
'use strict';

// test-sedmDeclaredIdentity.js — nextStandards-102326 wave 2 lane G, Docker-free: the SHIPPED SEDM declared-identity bridge
// (forges/sedm/bridges/sedmBridging.js facet '', composed by the tree's registry with the CEDS hub's own declaration) run over the REAL
// forged SEDM snapshot and the CEDS hub's TERM cards (fixtures/cedsTermCardsForSedm.json, exported from GOLD_EVAL_261024_wave1),
// through the framework's graph double, the PESC_LD C3 form (forges/pescld/test/test-pescldDeclaredIdentity.js). Writes nothing.
//
// CONJUNCTS
//   a  the registry composes sedmCedsDeclaredIdentity, basis declaredIdentity, the CEDS hub's stableIdTemplate rules and no other kind
//   b  the walk: the 230 elements whose Global ID is six digits are subjects; the 3 'Proposed' are dropped as the declared sentinel;
//      the 88 with no Global ID are not rows of the channel; nothing is out of the hub's scope (every CURIE is the property-term form)
//   c  217 subjects resolve: each a specified record whose ONE EXACT_MATCH lands on the card P<its six digits>, 169 distinct cards
//   d  the 13 others are orphans, noCardUnderKey, over the 10 named ids the release does not hold as property terms
//   e  no edge reaches the CLASS card C001066 (SEDM's 001066 is a property; a property is never mapped to a class card)
//   f  zero judge calls
//   g  a Global ID cell of neither form is REFUSED by name, before anything is resolved

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- SEDM -> CEDS declared identity over the real forged snapshot and the CEDS term cards (no Docker)

SYNOPSIS
     node forges/sedm/test/${moduleName}.js [-verbose] [-help]

EXIT STATUS
     0 every conjunct passed;  1 otherwise.
`;

const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const harness = require(path.join(TREE_ROOT, 'test', 'testLib', 'harness'))(moduleName);
const toyBridgeScenario = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'test', 'testSupport', 'toyBridgeScenario'));
const decisionBlockLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'decisionBlock'));
const pluginRegistryLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'pluginRegistry'));

const FORGES_DIR_PATH = path.join(TREE_ROOT, 'forges');
const SNAPSHOT_DIR_PATH = path.join(__dirname, '..', 'assets', 'standardSourceData', '01');
const CEDS_TERM_CARD_FIXTURE = require(path.join(__dirname, 'fixtures', 'cedsTermCardsForSedm.json'));
const BRIDGE_NAME = 'sedmCedsDeclaredIdentity';
const CEDS_TERM_IRI_PREFIX = 'https://w3id.org/CEDStandards/terms/';
const CLASS_CARD_TERM_IRI = `${CEDS_TERM_IRI_PREFIX}C001066`;
// the real snapshot outgrows the toy default of 4000 ms on a loaded machine (the PESC_LD suite's figure)
const HANG_GUARD_MS = 120000;
const EXPECTED = Object.freeze({
	sixDigitSubjectCount: 230,
	sentinelSubjectCount: 3,
	specifiedCount: 217,
	distinctCardCount: 169,
	orphanSubjectCount: 13,
	orphanKeyList: ['000016', '000020', '000034', '000144', '000192', '000301', '000973', '001066', '001070', '001071'].map((globalIdText) => `ceds:P${globalIdText}`),
});

const bundle = require(path.join(__dirname, '..', 'forgeSedm'))({ embedder: null });

const frozenBlockOf = (result) => {
	const row = result.stores && result.stores.decisionStore.rowList[result.stores.decisionStore.rowList.length - 1];
	return row === undefined ? null : decisionBlockLib.parseFrozenText(row.frozenText).block;
};
const failureTextOf = (result) => String(result.runError || result.constructionError || result.thrownFromRun || '');
const graphNodeOf = (forgedNode) => ({ stableId: forgedNode.stableId, labels: forgedNode.labels.slice(), properties: { ...forgedNode.properties, stableId: forgedNode.stableId } });
const scenarioFor = ({ forgedNodeList }) => {
	const scenario = toyBridgeScenario.makeScenario();
	scenario.hangGuardMs = HANG_GUARD_MS;
	scenario.forgesDirOverride = FORGES_DIR_PATH;
	scenario.graph = { nodeList: CEDS_TERM_CARD_FIXTURE.cardList.map((oneCard) => JSON.parse(JSON.stringify(oneCard))).concat(forgedNodeList.map(graphNodeOf)), edgeList: [] };
	scenario.spec = {
		inGraph: { graphName: 'DEV_sedmDeclaredIdentityDouble' },
		bridge: BRIDGE_NAME,
		source: 'sedm',
		hub: 'ceds',
		applyLabel: 'BridgedRelation',
		rebridge: true,
		config: { limit: undefined, offset: undefined, sourceStandard: 'sedm', sourceStandardName: 'SEDM', sourceVersion: 'unknown', hubVersion: CEDS_TERM_CARD_FIXTURE.cardList[0].properties.hubVersion, hubStandardName: 'CEDS', pairWith: undefined, pairWithVersion: undefined, familyStandards: ['sedm'] },
	};
	return scenario;
};

// the two git-ignored working documents (01/README_PROVENANCE.md has the acquisition recipe): absent, the suite refuses BY NAME
const fs = require('fs');
const sourceProfile = require(path.join(__dirname, '..', 'lib', 'sedmSourceProfile.json'));
const absentSourceFileList = [sourceProfile.csvFileName, sourceProfile.structuresFileName].filter((oneFileName) => !fs.existsSync(path.join(SNAPSHOT_DIR_PATH, oneFileName)));

if (absentSourceFileList.length !== 0) {
	harness.section('SECTION 1 — the shipped bridge, composed');
	harness.accepts('the two git-ignored source files are present (else run the recipe in forges/sedm/assets/standardSourceData/01/README_PROVENANCE.md)', absentSourceFileList.map((oneFileName) => `absent: ${oneFileName}`));
	harness.report();
} else bundle.forge({ sourcePath: SNAPSHOT_DIR_PATH, owner: 'test', skipEmbedding: true }, (forgeError, forgeResult) => {
	harness.section('SECTION 1 — the shipped bridge, composed');
	harness.accepts('the snapshot forges', forgeError ? [forgeError] : []);
	if (forgeError) {
		harness.report();
		return;
	}
	const registry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: FORGES_DIR_PATH });
	const entry = registry.entryByBridgeName ? registry.entryByBridgeName[BRIDGE_NAME] : undefined;
	const cedsHubRuleList = require(path.join(FORGES_DIR_PATH, 'ceds', 'lib', 'cedsHubBridging')).hubBridging.declaredTargetRuleList;
	harness.ok('a: the registry composes sedmCedsDeclaredIdentity, declaredIdentity', entry !== undefined && entry.bridgeDeclaration.matchBasis === 'declaredIdentity', registry.error ? registry.error.message : `entry ${entry === undefined ? 'absent' : 'present'}`);
	harness.equal('a: its rules are the CEDS hub\'s stableIdTemplate rules, in the hub\'s order, and no other kind', JSON.stringify(entry && entry.bridgeDeclaration.declaredTargetRuleList), JSON.stringify(cedsHubRuleList.filter((oneRule) => oneRule.ruleKind === 'stableIdTemplate')));

	const forgedNodeList = forgeResult.nodes.filter((oneNode) => oneNode.role !== 'DmeEmbedText');
	const elementNodeList = forgedNodeList.filter((oneNode) => oneNode.role === 'DmeProperty');
	const sixDigitNodeList = elementNodeList.filter((oneNode) => /^\d{6}$/.test(oneNode.properties.globalIdText || ''));
	const keyBySubject = sixDigitNodeList.reduce((byId, oneNode) => ({ ...byId, [oneNode.stableId]: `ceds:P${oneNode.properties.globalIdText}` }), {});
	harness.equal('b: 230 elements carry a six-digit Global ID, 3 the sentinel Proposed', `${sixDigitNodeList.length} ${elementNodeList.filter((oneNode) => oneNode.properties.globalIdText === 'Proposed').length}`, `${EXPECTED.sixDigitSubjectCount} ${EXPECTED.sentinelSubjectCount}`);

	toyBridgeScenario.runScenario(scenarioFor({ forgedNodeList }), (unusedError, result) => {
		harness.section('SECTION 2 — SEDM → CEDS over the real forged snapshot and the CEDS term cards');
		harness.equal('the run completes', failureTextOf(result), '');
		const block = frozenBlockOf(result);
		const recordList = block === null ? [] : block.decisionRecordList;
		const specifiedList = recordList.filter((oneRecord) => oneRecord.resolution === 'specified');
		const orphanList = recordList.filter((oneRecord) => oneRecord.classification === 'orphan');
		const writtenEdgeList = result.graphDouble ? result.graphDouble.state.writtenEdgeList : [];
		const termIriByCardStableId = CEDS_TERM_CARD_FIXTURE.cardList.reduce((byId, oneCard) => ({ ...byId, [oneCard.stableId]: oneCard.properties.termIri }), {});
		const outOfHubScopeList = result.runReport && result.runReport.counts ? result.runReport.counts.outOfHubScopeList : undefined;
		harness.equal('b: nothing is out of the CEDS hub\'s scope', JSON.stringify(outOfHubScopeList), '[]');
		harness.ok('b: no record on an element without a six-digit Global ID', recordList.every((oneRecord) => keyBySubject[oneRecord.subjectStableId] !== undefined));
		harness.equal('c: 217 specified records', specifiedList.length, EXPECTED.specifiedCount);
		harness.equal('c: one EXACT_MATCH per specified record, and no other edge', `${writtenEdgeList.filter((oneEdge) => oneEdge.type === 'EXACT_MATCH').length} ${writtenEdgeList.length}`, `${EXPECTED.specifiedCount} ${EXPECTED.specifiedCount}`);
		harness.equal('c: every edge lands on the card P<its own six digits>', writtenEdgeList.filter((oneEdge) => termIriByCardStableId[oneEdge.toStableId] !== `${CEDS_TERM_IRI_PREFIX}${(keyBySubject[oneEdge.fromStableId] || '').replace(/^ceds:/, '')}`).length, 0);
		harness.equal('c: 169 distinct cards', new Set(writtenEdgeList.map((oneEdge) => oneEdge.toStableId)).size, EXPECTED.distinctCardCount);
		harness.ok('c: every edge is declaredIdentity, authored', writtenEdgeList.length > 0 && writtenEdgeList.every((oneEdge) => oneEdge.properties.matchBasis === 'declaredIdentity' && oneEdge.properties.mappingKind === 'authored'));
		harness.equal('d: 13 orphan subjects', orphanList.length, EXPECTED.orphanSubjectCount);
		harness.equal('d: the orphans are the 10 named keys, each noCardUnderKey', JSON.stringify([...new Set(orphanList.map((oneRecord) => `${keyBySubject[oneRecord.subjectStableId]} ${oneRecord.reason}`))].sort()), JSON.stringify(EXPECTED.orphanKeyList.map((oneKey) => `${oneKey} noCardUnderKey`)));
		harness.equal('e: no edge reaches the class card C001066', writtenEdgeList.filter((oneEdge) => termIriByCardStableId[oneEdge.toStableId] === CLASS_CARD_TERM_IRI).length, 0);
		harness.ok('e: the fixture does hold the class card (so e is not vacuous)', CEDS_TERM_CARD_FIXTURE.cardList.some((oneCard) => oneCard.properties.termIri === CLASS_CARD_TERM_IRI));
		harness.equal('f: zero judge calls', result.stores ? result.stores.judgmentCache.getCallCount : -1, 0);

		const malformedNodeList = forgedNodeList.map((oneNode) => (oneNode.stableId === sixDigitNodeList[0].stableId ? { ...oneNode, properties: { ...oneNode.properties, globalIdText: '12345' } } : oneNode));
		toyBridgeScenario.runScenario(scenarioFor({ forgedNodeList: malformedNodeList }), (unusedMalformedError, malformedResult) => {
			harness.section('SECTION 3 — a Global ID of neither form is refused by name');
			harness.match('g: refused, naming the cell and the pattern', failureTextOf(malformedResult), /globalIdText "12345" matches neither \^\(\\d\{6\}\)\$ nor a declared sentinel/);
			harness.report();
		});
	});
});
