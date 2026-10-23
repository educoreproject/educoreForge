#!/usr/bin/env node
'use strict';

// test-pescldDeclaredIdentity.js — zeroBacklog lane C2, Docker-free: the SHIPPED PESC_LD bridge (forges/pescld/bridges/pescldBridging.js,
// composed by the tree's registry with the CTDL hub's own declaration) run over the REAL forged PESC_LD snapshot and the CTDL hub's TERM
// cards (the P6 fixture export, 993 cards), through the framework's graph double. Writes nothing.
//
// CONJUNCTS
//   a  the registry composes pescldCtdlDeclaredIdentity, basis declaredIdentity, the CTDL hub's rules taken 'fromHub'
//   b  every in-scope subject resolves: the 16 ceterms: rows and 2 ceterms: shape targets are 18 specified records, 0 orphan, 18
//      EXACT_MATCH edges, each landing on the term card whose termIri is the subject's termCurie; 13 distinct IRIs
//   c  every other term-bearing node is OUT OF THE CTDL HUB'S SCOPE: no record, listed in counts.outOfHubScopeList, and the listed
//      subject counts sum to the term-bearing nodes minus the 18
//   d  zero judge calls
//   e  an in-scope miss (a ceterms: term the hub's release does not carry) is an orphan named noCardUnderKey, not out of scope
//
// C3 (zeroBacklog lane C3, 2026-10-23): the SAME facet paired with the CEDS hub, whose rules come 'fromHubStableIdTemplateRules' (the
// hub's term-form rules only), over the CEDS term cards those keys name (forges/pescld/test/fixtures/cedsTermCardsForPescLd.json,
// exported from DEV_p9CedsTermTier):
//   f  the registry composes pescldCedsDeclaredIdentity, declaredIdentity, the CEDS hub's stableIdTemplate rules and no other kind
//   g  207 of the 212 distinct ceds: keys resolve, every one of their subjects a specified record whose EXACT_MATCH lands on the term
//      card the key expands to; the 5 the release does not hold (P001075 and four NI001075… values) are orphans, noCardUnderKey
//   h  every term-bearing node with no ceds: key is out of the CEDS hub's scope (subject counts sum)
//   i  zero judge calls

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- PESC_LD → CTDL declared identity over the real forged snapshot and the CTDL term cards (no Docker)

SYNOPSIS
     node forges/pescld/test/${moduleName}.js [-verbose] [-help]

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
const TERM_CARD_FIXTURE = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'test', 'fixtures', 'declaredBridge', 'ctdlTermCards.json'));
const BRIDGE_NAME = 'pescldCtdlDeclaredIdentity';
const SOURCE_STANDARD_NAME = 'PESCLD';
const TERM_BEARING_ROLE_LIST = ['DmeClass', 'DmeProperty', 'DmeOptionValue'];
const EXPECTED = Object.freeze({ specifiedCount: 18, distinctIriCount: 13 });
// the real snapshot (775 term-bearing nodes) outgrows the toy default of 4000 ms on a loaded machine: measured HUNG at load 30, 2026-10-22;
// the CTDL declared-bridge suite's figure
const HANG_GUARD_MS = 120000;

const CEDS_TERM_CARD_FIXTURE = require(path.join(__dirname, 'fixtures', 'cedsTermCardsForPescLd.json'));
const CEDS_BRIDGE_NAME = 'pescldCedsDeclaredIdentity';
const CEDS_TERM_IRI_PREFIX = 'https://w3id.org/CEDStandards/terms/';
const CEDS_EXPECTED = Object.freeze({
	distinctKeyCount: 212,
	resolvedKeyCount: 207,
	orphanKeyList: ['ceds:NI001075173041', 'ceds:NI001075173046', 'ceds:NI001075173047', 'ceds:NI001075173048', 'ceds:P001075'],
});
const PAIRING_BY_HUB_TOKEN = Object.freeze({
	ctdl: { bridgeName: BRIDGE_NAME, hubStandardName: 'CTDL', cardList: TERM_CARD_FIXTURE.cardList },
	ceds: { bridgeName: CEDS_BRIDGE_NAME, hubStandardName: 'CEDS', cardList: CEDS_TERM_CARD_FIXTURE.cardList },
});

const bundle = require(path.join(__dirname, '..', 'forgePescld'))({ embedder: null });

const frozenBlockOf = (result) => {
	const row = result.stores && result.stores.decisionStore.rowList[result.stores.decisionStore.rowList.length - 1];
	return row === undefined ? null : decisionBlockLib.parseFrozenText(row.frozenText).block;
};
const failureTextOf = (result) => String(result.runError || result.constructionError || result.thrownFromRun || '');
const graphNodeOf = (forgedNode) => ({ stableId: forgedNode.stableId, labels: forgedNode.labels.slice(), properties: { ...forgedNode.properties, stableId: forgedNode.stableId } });

const scenarioFor = ({ forgedNodeList, hubToken = 'ctdl' }) => {
	const pairing = PAIRING_BY_HUB_TOKEN[hubToken];
	if (pairing === undefined) {
		throw new Error(`${moduleName}: no pairing for hub token '${hubToken}' (known: ${Object.keys(PAIRING_BY_HUB_TOKEN).join(', ')})`);
	}
	const scenario = toyBridgeScenario.makeScenario();
	scenario.hangGuardMs = HANG_GUARD_MS;
	scenario.forgesDirOverride = FORGES_DIR_PATH;
	scenario.graph = { nodeList: pairing.cardList.map((oneCard) => JSON.parse(JSON.stringify(oneCard))).concat(forgedNodeList.map(graphNodeOf)), edgeList: [] };
	scenario.spec = {
		inGraph: { graphName: 'DEV_pescldDeclaredIdentityDouble' },
		bridge: pairing.bridgeName,
		source: 'pescld',
		hub: hubToken,
		applyLabel: 'BridgedRelation',
		rebridge: true,
		config: { limit: undefined, offset: undefined, sourceStandard: 'pescld', sourceStandardName: SOURCE_STANDARD_NAME, sourceVersion: '0.0.2', hubVersion: pairing.cardList[0].properties.hubVersion, hubStandardName: pairing.hubStandardName, pairWith: undefined, pairWithVersion: undefined, familyStandards: ['pescld'] },
	};
	return scenario;
};

// SECTION 4 (C3): the same facet paired with the CEDS hub
const runCedsSection = ({ registry, forgedNodeList, termNodeList }, callback) => {
	harness.section('SECTION 4 — PESC_LD → CEDS (C3) over the real forged snapshot and the CEDS term cards');
	const cedsHubRuleList = require(path.join(FORGES_DIR_PATH, 'ceds', 'lib', 'cedsHubBridging')).hubBridging.declaredTargetRuleList;
	const cedsEntry = registry.entryByBridgeName ? registry.entryByBridgeName[CEDS_BRIDGE_NAME] : undefined;
	const composedRuleList = cedsEntry === undefined ? undefined : cedsEntry.bridgeDeclaration.declaredTargetRuleList;
	harness.ok('f: the registry composes pescldCedsDeclaredIdentity, declaredIdentity', cedsEntry !== undefined && cedsEntry.bridgeDeclaration.matchBasis === 'declaredIdentity', registry.error ? registry.error.message : `entry ${cedsEntry === undefined ? 'absent' : 'present'}`);
	harness.equal('f: its rules are the CEDS hub\'s stableIdTemplate rules, in the hub\'s order, and no other kind', JSON.stringify(composedRuleList), JSON.stringify(cedsHubRuleList.filter((oneRule) => oneRule.ruleKind === 'stableIdTemplate')));

	const cedsTermNodeList = termNodeList.filter((oneNode) => /^ceds:/.test(oneNode.properties.termCurie));
	const termCurieBySubject = termNodeList.reduce((byId, oneNode) => ({ ...byId, [oneNode.stableId]: oneNode.properties.termCurie }), {});
	const cardTermIriSet = new Set(CEDS_TERM_CARD_FIXTURE.cardList.map((oneCard) => oneCard.properties.termIri));
	const expandedIriOf = (termCurie) => `${CEDS_TERM_IRI_PREFIX}${termCurie.replace(/^ceds:/, '')}`;
	const distinctKeyList = [...new Set(cedsTermNodeList.map((oneNode) => oneNode.properties.termCurie))].sort();
	const resolvingSubjectList = cedsTermNodeList.filter((oneNode) => cardTermIriSet.has(expandedIriOf(oneNode.properties.termCurie)));
	harness.equal('g: the snapshot names 212 distinct ceds: keys', distinctKeyList.length, CEDS_EXPECTED.distinctKeyCount);
	harness.equal('g: the fixture holds a card for 207 of them, and not the 5 named', JSON.stringify(distinctKeyList.filter((oneKey) => !cardTermIriSet.has(expandedIriOf(oneKey)))), JSON.stringify(CEDS_EXPECTED.orphanKeyList));

	toyBridgeScenario.runScenario(scenarioFor({ forgedNodeList, hubToken: 'ceds' }), (unusedError, result) => {
		harness.equal('the CEDS run completes', failureTextOf(result), '');
		const block = frozenBlockOf(result);
		const recordList = block === null ? [] : block.decisionRecordList;
		const specifiedList = recordList.filter((oneRecord) => oneRecord.resolution === 'specified');
		const orphanList = recordList.filter((oneRecord) => oneRecord.classification === 'orphan');
		const writtenEdgeList = result.graphDouble ? result.graphDouble.state.writtenEdgeList : [];
		const termIriByCardStableId = CEDS_TERM_CARD_FIXTURE.cardList.reduce((byId, oneCard) => ({ ...byId, [oneCard.stableId]: oneCard.properties.termIri }), {});
		harness.equal('g: every subject of a held key is a specified record', specifiedList.length, resolvingSubjectList.length);
		harness.equal('g: 207 distinct keys resolve', new Set(specifiedList.map((oneRecord) => termCurieBySubject[oneRecord.subjectStableId])).size, CEDS_EXPECTED.resolvedKeyCount);
		harness.equal('g: one EXACT_MATCH per specified record', writtenEdgeList.filter((oneEdge) => oneEdge.type === 'EXACT_MATCH').length, resolvingSubjectList.length);
		harness.equal('g: every edge lands on the card its key expands to', writtenEdgeList.filter((oneEdge) => termIriByCardStableId[oneEdge.toStableId] !== expandedIriOf(termCurieBySubject[oneEdge.fromStableId] || '')).length, 0);
		harness.ok('g: every edge is declaredIdentity, authored', writtenEdgeList.length > 0 && writtenEdgeList.every((oneEdge) => oneEdge.properties.matchBasis === 'declaredIdentity' && oneEdge.properties.mappingKind === 'authored'));
		harness.equal('g: the orphans are the 5 named keys, each noCardUnderKey', JSON.stringify([...new Set(orphanList.map((oneRecord) => `${termCurieBySubject[oneRecord.subjectStableId]} ${oneRecord.reason}`))].sort()), JSON.stringify(CEDS_EXPECTED.orphanKeyList.map((oneKey) => `${oneKey} noCardUnderKey`)));
		harness.equal('g: every subject of an absent key is an orphan', orphanList.length, cedsTermNodeList.length - resolvingSubjectList.length);
		const outOfHubScopeList = result.runReport && result.runReport.counts ? result.runReport.counts.outOfHubScopeList : undefined;
		const listedSubjectTotal = Array.isArray(outOfHubScopeList) ? outOfHubScopeList.reduce((total, oneEntry) => total + oneEntry.subjectCount, 0) : -1;
		harness.equal('h: every term-bearing node with no ceds: key is out of the CEDS hub\'s scope (subject counts sum)', listedSubjectTotal, termNodeList.length - cedsTermNodeList.length);
		harness.equal('i: zero judge calls', result.stores ? result.stores.judgmentCache.getCallCount : -1, 0);
		harness.note(`ceds: subjects ${cedsTermNodeList.length} (resolving ${resolvingSubjectList.length}); out of scope ${listedSubjectTotal}`);
		callback();
	});
};

bundle.forge({ sourcePath: SNAPSHOT_DIR_PATH, owner: 'test', skipEmbedding: true }, (forgeError, forgeResult) => {
	harness.section('SECTION 1 — the shipped bridge, composed');
	harness.accepts('the snapshot forges', forgeError ? [forgeError] : []);
	if (forgeError) {
		harness.report();
		return;
	}
	const registry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: FORGES_DIR_PATH });
	const entry = registry.entryByBridgeName ? registry.entryByBridgeName[BRIDGE_NAME] : undefined;
	harness.ok('a: the registry composes pescldCtdlDeclaredIdentity, declaredIdentity, the CTDL rules from the hub', entry !== undefined && entry.bridgeDeclaration.matchBasis === 'declaredIdentity' && JSON.stringify(entry.bridgeDeclaration.declaredTargetRuleList) === JSON.stringify(require(path.join(FORGES_DIR_PATH, 'ctdl', 'lib', 'ctdlHubBridging')).hubBridging.declaredTargetRuleList), registry.error ? registry.error.message : JSON.stringify(entry && entry.bridgeDeclaration.declaredTargetRuleList));

	const forgedNodeList = forgeResult.nodes.filter((oneNode) => oneNode.role !== 'DmeEmbedText');
	const termNodeList = forgedNodeList.filter((oneNode) => TERM_BEARING_ROLE_LIST.indexOf(oneNode.role) !== -1 && oneNode.properties.termCurie !== undefined);
	toyBridgeScenario.runScenario(scenarioFor({ forgedNodeList }), (unusedError, result) => {
		harness.section('SECTION 2 — PESC_LD → CTDL over the real forged snapshot');
		harness.equal('the run completes', failureTextOf(result), '');
		const block = frozenBlockOf(result);
		const recordList = block === null ? [] : block.decisionRecordList;
		const specifiedList = recordList.filter((oneRecord) => oneRecord.resolution === 'specified');
		const orphanList = recordList.filter((oneRecord) => oneRecord.classification === 'orphan');
		const writtenEdgeList = result.graphDouble ? result.graphDouble.state.writtenEdgeList : [];
		const termIriByCardStableId = TERM_CARD_FIXTURE.cardList.reduce((byId, oneCard) => ({ ...byId, [oneCard.stableId]: oneCard.properties.termIri }), {});
		const termCurieBySubject = termNodeList.reduce((byId, oneNode) => ({ ...byId, [oneNode.stableId]: oneNode.properties.termCurie }), {});
		harness.equal('b: 18 specified records (16 rows, 2 shape targets)', specifiedList.length, EXPECTED.specifiedCount);
		harness.equal('b: 0 orphans', JSON.stringify(orphanList.map((oneRecord) => oneRecord.targetCanonicalKeyList)), '[]');
		harness.equal('b: 18 EXACT_MATCH edges', writtenEdgeList.filter((oneEdge) => oneEdge.type === 'EXACT_MATCH').length, EXPECTED.specifiedCount);
		harness.equal('b: every edge lands on the card of its own term', writtenEdgeList.filter((oneEdge) => termIriByCardStableId[oneEdge.toStableId] !== termCurieBySubject[oneEdge.fromStableId]).length, 0);
		harness.equal('b: 13 distinct CTDL IRIs', new Set(specifiedList.map((oneRecord) => termCurieBySubject[oneRecord.subjectStableId])).size, EXPECTED.distinctIriCount);
		harness.ok('b: every edge is declaredIdentity, authored', writtenEdgeList.length > 0 && writtenEdgeList.every((oneEdge) => oneEdge.properties.matchBasis === 'declaredIdentity' && oneEdge.properties.mappingKind === 'authored'));
		const outOfHubScopeList = result.runReport && result.runReport.counts ? result.runReport.counts.outOfHubScopeList : undefined;
		const listedSubjectTotal = Array.isArray(outOfHubScopeList) ? outOfHubScopeList.reduce((total, oneEntry) => total + oneEntry.subjectCount, 0) : -1;
		harness.equal('c: every other term-bearing node is out of the CTDL hub\'s scope (subject counts sum)', listedSubjectTotal, termNodeList.length - EXPECTED.specifiedCount);
		harness.ok('c: no record on an out-of-scope subject', recordList.every((oneRecord) => /^ceterms:/.test(termCurieBySubject[oneRecord.subjectStableId])));
		harness.equal('d: zero judge calls', result.stores ? result.stores.judgmentCache.getCallCount : -1, 0);
		harness.note(`term-bearing nodes ${termNodeList.length}; out of scope ${listedSubjectTotal} over ${Array.isArray(outOfHubScopeList) ? outOfHubScopeList.length : '?'} distinct key(s)`);

		const absentNode = { ...forgedNodeList.find((oneNode) => oneNode.properties.termCurie === 'ceterms:name') };
		const absentClone = { ...absentNode, stableId: 'pescld:shape/ContactShape/ceterms:termAbsentFromTheRelease', properties: { ...absentNode.properties, termCurie: 'ceterms:termAbsentFromTheRelease', pescldStableId: 'pescld:shape/ContactShape/ceterms:termAbsentFromTheRelease' } };
		toyBridgeScenario.runScenario(scenarioFor({ forgedNodeList: forgedNodeList.concat([absentClone]) }), (unusedMissError, missResult) => {
			harness.section('SECTION 3 — an in-scope miss is an orphan, not out of scope');
			const missBlock = frozenBlockOf(missResult);
			const missOrphanList = missBlock === null ? [] : missBlock.decisionRecordList.filter((oneRecord) => oneRecord.classification === 'orphan');
			harness.equal('e: one orphan, named, reason noCardUnderKey', JSON.stringify(missOrphanList.map((oneRecord) => [oneRecord.subjectStableId, oneRecord.targetCanonicalKeyList, oneRecord.reason])), JSON.stringify([[absentClone.stableId, ['ceterms:termAbsentFromTheRelease'], 'noCardUnderKey']]));
			runCedsSection({ registry, forgedNodeList, termNodeList }, () => harness.report());
		});
	});
});
