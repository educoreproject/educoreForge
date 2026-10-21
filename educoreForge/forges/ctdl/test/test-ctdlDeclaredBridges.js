#!/usr/bin/env node
'use strict';

// test-ctdlDeclaredBridges.js — ⟪ctdlHub-101926 P6 step 5⟫ the two REAL declared-correspondence plugins over REAL data, through the
// bridge framework and its graph double. PURE: the CTDL and CTDL-ASN snapshots are forged in process (no graph, no embedding); the
// CEDS targets are the base nodes the seam names, exported from DEV_p5TwoHubs (lib/bridge-framework/test/fixtures/declaredBridge/
// cedsSeamTargets.json: the three option sets and EVERY value under them, so an ambiguous notation could not hide).
//
// CONJUNCTS
//   a  CTDL → CEDS: resolved / 53 is 53 / 53; 53 DECLARED_CORRESPONDENCE edges, one per declared entry, each to the CEDS base node
//      the stated rule names; by predicate exactly owl:equivalentClass 26, skos:narrowMatch 22, skos:relatedMatch 5
//   b  CTDL-ASN → CTDL: exactly 4, all owl:equivalentProperty, from ceasn:codedNotation, conceptKeyword, conceptTerm,
//      educationLevelType to ceterms:codedNotation, keyword, subject, audienceLevelType
//   c  every edge: sourcePredicate verbatim (the assertion's own), declaredBy the source, provenanceTier spec-authoritative,
//      matchBasis declared; ZERO EXACT/CLOSE/BROAD/NARROW/RELATED match edges; no object is a hub card
//   d  no subject is a foreign (A5) entry: every subject is a native term node of the source
//   e  zero judge calls (no judged record; the judgment cache never consulted)
//   f  an unresolvable target is a NAMED orphan: a ceds: element no option set carries resolves to nothing and is listed, nothing dropped
// RED TWINS: (a) under 'notationRuleDropped' (the member rule removed from the declaration) the 51 value targets orphan; (c) under
// 'declaredShapeWritesMatchEdge' (the declared edge shape typed EXACT_MATCH) the write seam refuses, so the run cannot finish green.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- ctdlHub P6: CTDL→CEDS and CTDL-ASN→CTDL declared correspondence over the real snapshots

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const FRAMEWORK_TEST_DIR = path.join(TREE_ROOT, 'lib', 'bridge-framework', 'test');
const toyBridgeScenario = require(path.join(FRAMEWORK_TEST_DIR, 'testSupport', 'toyBridgeScenario'));
const decisionBlockLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'decisionBlock'));
const FORGES_DIR = path.join(TREE_ROOT, 'forges');
const CEDS_TARGET_FIXTURE = JSON.parse(fs.readFileSync(path.join(FRAMEWORK_TEST_DIR, 'fixtures', 'declaredBridge', 'cedsSeamTargets.json'), 'utf8'));
const MATERIALISER_PATH = path.join(TREE_ROOT, 'lib', 'bridge-framework', 'materialiser.js');
const MATCH_EDGE_TYPE_LIST = Object.freeze(['EXACT_MATCH', 'CLOSE_MATCH', 'BROAD_MATCH', 'NARROW_MATCH', 'RELATED_MATCH']);
const HANG_GUARD_MS = 120000;

const forgeOf = ({ token, entryFileName, sourceFileName }, callback) => {
	const bundle = require(path.join(FORGES_DIR, token, entryFileName))({ embedder: null });
	bundle.forge({ sourcePath: path.join(FORGES_DIR, token, 'assets', 'standardSourceData', '01', sourceFileName), owner: moduleName, skipEmbedding: true }, callback);
};
// a forged node as the graph double holds it: its labels and properties, stableId on both
const doubleNodeOf = (oneNode) => ({ stableId: oneNode.stableId, labels: oneNode.labels.slice(), properties: { ...oneNode.properties, stableId: oneNode.stableId } });
const doubleEdgeOf = (oneEdge) => ({ fromStableId: oneEdge.fromRef.id, toStableId: oneEdge.toRef.id, type: oneEdge.type, properties: { ...(oneEdge.properties || {}) } });

const scenarioFor = ({ graph, bridge, source, hub, sourceStandardName, sourceVersion, hubStandardName, hubVersion, pluginModuleOverrides = {}, frameworkMutationList = [] }) => {
	const scenario = toyBridgeScenario.makeScenario();
	scenario.forgesDirOverride = FORGES_DIR;
	scenario.graph = graph;
	scenario.hangGuardMs = HANG_GUARD_MS;
	scenario.pluginModuleOverrides = pluginModuleOverrides;
	scenario.frameworkMutationList = frameworkMutationList;
	scenario.spec = {
		inGraph: { graphName: 'DEV_declaredCorrespondenceDouble' },
		bridge,
		source,
		hub,
		applyLabel: 'BridgedRelation',
		rebridge: true,
		config: { limit: undefined, offset: undefined, sourceStandard: source, sourceStandardName, sourceVersion, hubVersion, hubStandardName, pairWith: undefined, pairWithVersion: undefined, familyStandards: [source] },
	};
	return scenario;
};
const failureTextOf = (result) => String(result.runError || result.constructionError || result.thrownFromRun || '');
const frozenBlockOf = (result) => {
	const row = result.stores.decisionStore.rowList[result.stores.decisionStore.rowList.length - 1];
	return row === undefined ? null : decisionBlockLib.parseFrozenText(row.frozenText).block;
};
const countBy = (list, pick) => list.reduce((soFar, oneItem) => ({ ...soFar, [pick(oneItem)]: (soFar[pick(oneItem)] || 0) + 1 }), {});

// the CEDS seam rule, restated INDEPENDENTLY of the plugin (from DEVLOG-P6 §1.3) so the edge each entry should land on is known
// without trusting the code under test
const expectedCedsTargetFor = (rawTarget) => {
	const memberMatch = /^ceds:(\d{6})\/?#(.+)$/.exec(rawTarget);
	if (memberMatch) {
		const containerStableId = `https://w3id.org/CEDStandards/terms/C${memberMatch[1]}`;
		const memberStableIdList = CEDS_TARGET_FIXTURE.edgeList.filter((oneEdge) => oneEdge.fromStableId === containerStableId).map((oneEdge) => oneEdge.toStableId);
		return CEDS_TARGET_FIXTURE.nodeList.filter((oneNode) => memberStableIdList.indexOf(oneNode.stableId) !== -1 && oneNode.properties.notation === memberMatch[2]).map((oneNode) => oneNode.stableId);
	}
	const bareMatch = /^ceds:(\d{6})$/.exec(rawTarget);
	return bareMatch ? [`https://w3id.org/CEDStandards/terms/C${bareMatch[1]}`] : [];
};

const runCtdlCeds = ({ ctdlForged, pluginModuleOverrides, frameworkMutationList, extraNodeList = [] }, callback) => {
	const graph = {
		nodeList: ctdlForged.nodes.map(doubleNodeOf).concat(extraNodeList).concat(CEDS_TARGET_FIXTURE.nodeList.map((oneNode) => ({ stableId: oneNode.stableId, labels: oneNode.labels.slice(), properties: { ...oneNode.properties } }))),
		edgeList: ctdlForged.edges.map(doubleEdgeOf).concat(CEDS_TARGET_FIXTURE.edgeList.map((oneEdge) => ({ ...oneEdge, properties: {} }))),
	};
	toyBridgeScenario.runScenario(scenarioFor({ graph, bridge: 'ctdlCedsDeclaredCorrespondence', source: 'ctdl', hub: 'ceds', sourceStandardName: 'CTDL', sourceVersion: 'Release 20260327', hubStandardName: 'CEDS', hubVersion: '14.0.0.0', pluginModuleOverrides, frameworkMutationList }), (unusedError, result) => callback(result));
};

const judgeCtdlCeds = ({ result, ctdlForged }) => {
	const text = failureTextOf(result);
	if (text) {
		return { pass: false, detail: text };
	}
	const declaredEntryList = ctdlForged.nodes.filter((oneNode) => oneNode.properties.declaredCorrespondenceList).reduce((soFar, oneNode) => soFar.concat(JSON.parse(oneNode.properties.declaredCorrespondenceList).map((oneEntry) => ({ subjectStableId: oneNode.stableId, ...oneEntry }))), []);
	const writtenEdgeList = result.graphDouble.state.writtenEdgeList;
	const missingList = declaredEntryList.filter((oneEntry) => {
		const expectedList = expectedCedsTargetFor(oneEntry.target);
		return expectedList.length !== 1 || !writtenEdgeList.some((oneEdge) => oneEdge.fromStableId === oneEntry.subjectStableId && oneEdge.toStableId === expectedList[0] && oneEdge.properties.sourcePredicate === oneEntry.predicate);
	});
	const block = frozenBlockOf(result);
	const resolvedCount = block.decisionRecordList.filter((oneRecord) => oneRecord.resolution === 'specified').length;
	const byPredicate = countBy(writtenEdgeList, (oneEdge) => oneEdge.properties.sourcePredicate);
	const pass = declaredEntryList.length === 53 && resolvedCount === 53 && writtenEdgeList.length === 53 && missingList.length === 0 && JSON.stringify(byPredicate) === JSON.stringify({ 'owl:equivalentClass': 26, 'skos:narrowMatch': 22, 'skos:relatedMatch': 5 });
	return { pass, detail: `resolved ${resolvedCount} / ${declaredEntryList.length}; edges ${writtenEdgeList.length}; by predicate ${JSON.stringify(byPredicate)}; entries without their expected edge ${missingList.length}${missingList.length ? ` (${missingList.slice(0, 3).map((oneEntry) => oneEntry.target).join(', ')})` : ''}` };
};

const judgeEdgeShape = ({ result, sourceStandardName, nativeStableIdSet }) => {
	const text = failureTextOf(result);
	if (text) {
		return { pass: false, detail: text };
	}
	const writtenEdgeList = result.graphDouble.state.writtenEdgeList;
	const nodeByStableId = result.graphDouble.state.nodeList.reduce((soFar, oneNode) => ({ ...soFar, [oneNode.stableId]: oneNode }), {});
	const badList = writtenEdgeList.filter((oneEdge) => oneEdge.type !== 'DECLARED_CORRESPONDENCE' || oneEdge.properties.declaredBy !== sourceStandardName || oneEdge.properties.provenanceTier !== 'spec-authoritative' || oneEdge.properties.matchBasis !== 'declared' || !/^[a-z]+:[A-Za-z]+$/.test(oneEdge.properties.sourcePredicate) || nodeByStableId[oneEdge.toStableId].labels.indexOf('HubReference') !== -1);
	const matchEdgeList = result.graphDouble.state.edgeList.filter((oneEdge) => MATCH_EDGE_TYPE_LIST.indexOf(oneEdge.type) !== -1);
	const foreignSubjectList = writtenEdgeList.filter((oneEdge) => !nativeStableIdSet.has(oneEdge.fromStableId));
	return { pass: writtenEdgeList.length > 0 && badList.length === 0 && matchEdgeList.length === 0 && foreignSubjectList.length === 0, detail: `${writtenEdgeList.length} edge(s); off-shape ${badList.length}${badList.length ? ` (${JSON.stringify(badList[0])})` : ''}; match edges in the graph ${matchEdgeList.length}; subjects not a native term ${foreignSubjectList.length}` };
};
const judgeZeroJudge = (result) => {
	const block = failureTextOf(result) ? null : frozenBlockOf(result);
	return { pass: block !== null && block.decisionRecordList.every((oneRecord) => oneRecord.resolution !== 'judged') && result.stores.judgmentCache.getCallCount === 0 && block.header.judgeKind === 'none', detail: `${failureTextOf(result)} judgeKind ${block ? block.header.judgeKind : '?'}; judgment cache get() ${result.stores.judgmentCache.getCallCount}` };
};

const ASN_EXPECTED_PAIR_LIST = Object.freeze([
	'ceasn:codedNotation owl:equivalentProperty ceterms:codedNotation',
	'ceasn:conceptKeyword owl:equivalentProperty ceterms:keyword',
	'ceasn:conceptTerm owl:equivalentProperty ceterms:subject',
	'ceasn:educationLevelType owl:equivalentProperty ceterms:audienceLevelType',
]);

forgeOf({ token: 'ctdl', entryFileName: 'forgeCtdl', sourceFileName: 'ctdl-schema.json' }, (ctdlError, ctdlForged) => {
	harness.accepts('the real CTDL snapshot forges', ctdlError ? [ctdlError] : []);
	forgeOf({ token: 'ctdlasn', entryFileName: 'forgeCtdlasn', sourceFileName: 'ctdlasn.json' }, (asnError, asnForged) => {
		harness.accepts('the real CTDL-ASN snapshot forges', asnError ? [asnError] : []);
		if (ctdlError || asnError) {
			harness.report();
			return;
		}
		const ctdlNativeSet = new Set(ctdlForged.nodes.filter((oneNode) => ['DmeClass', 'DmeProperty', 'DmeOptionSet', 'DmeOptionValue'].indexOf(oneNode.role) !== -1).map((oneNode) => oneNode.stableId));
		const asnNativeSet = new Set(asnForged.nodes.filter((oneNode) => ['DmeClass', 'DmeProperty', 'DmeOptionSet', 'DmeOptionValue'].indexOf(oneNode.role) !== -1).map((oneNode) => oneNode.stableId));
		harness.section('CTDL → CEDS');
		runCtdlCeds({ ctdlForged }, (cedsResult) => {
			const verdictA = judgeCtdlCeds({ result: cedsResult, ctdlForged });
			harness.ok('a_ctdlCedsResolved53Of53 PASS', verdictA.pass, verdictA.detail);
			harness.note(`MEASURED ${verdictA.detail}`);
			const verdictC = judgeEdgeShape({ result: cedsResult, sourceStandardName: 'CTDL', nativeStableIdSet: ctdlNativeSet });
			harness.ok('c_ctdlCedsEdgeShape PASS', verdictC.pass, verdictC.detail);
			harness.ok('d_ctdlCedsSubjectsNative PASS', verdictC.pass && /subjects not a native term 0/.test(verdictC.detail), verdictC.detail);
			const verdictE = judgeZeroJudge(cedsResult);
			harness.ok('e_ctdlCedsZeroJudgeCalls PASS', verdictE.pass, verdictE.detail);
			// f — an orphan, named: a CTDL concept declaring a ceds: element whose option set the CEDS base does not carry
			const orphanNode = { stableId: 'financialAid:SyntheticOrphanDeclaration', labels: ['ForgedNode', 'CtdlConcept', 'DmeOptionValue'], properties: { stableId: 'financialAid:SyntheticOrphanDeclaration', name: 'Synthetic', role: 'DmeOptionValue', _source: 'CTDL', declaredCorrespondenceList: JSON.stringify([{ predicate: 'skos:narrowMatch', target: 'ceds:999999#NoSuchValue' }]) } };
			runCtdlCeds({ ctdlForged, extraNodeList: [orphanNode] }, (orphanResult) => {
				const block = failureTextOf(orphanResult) ? null : frozenBlockOf(orphanResult);
				const orphanList = block ? block.decisionRecordList.filter((oneRecord) => oneRecord.classification === 'orphan') : [];
				harness.ok('f_unresolvedTargetIsANamedOrphan PASS', orphanList.length === 1 && orphanList[0].targetCanonicalKeyList[0] === 'ceds:999999#NoSuchValue' && orphanList[0].subjectStableId === orphanNode.stableId && block.decisionRecordList.filter((oneRecord) => oneRecord.resolution === 'specified').length === 53, `${failureTextOf(orphanResult)} orphans ${JSON.stringify(orphanList.map((oneRecord) => ({ subject: oneRecord.subjectStableId, target: oneRecord.targetCanonicalKeyList, reason: oneRecord.reason })))}`);
				harness.section('CTDL-ASN → CTDL');
				const asnGraph = {
					nodeList: asnForged.nodes.map(doubleNodeOf).concat(ctdlForged.nodes.map(doubleNodeOf)),
					edgeList: asnForged.edges.map(doubleEdgeOf).concat(ctdlForged.edges.map(doubleEdgeOf)),
				};
				toyBridgeScenario.runScenario(scenarioFor({ graph: asnGraph, bridge: 'ctdlasnCtdlDeclaredCorrespondence', source: 'ctdlasn', hub: 'ctdl', sourceStandardName: 'CTDLASN', sourceVersion: '20230929', hubStandardName: 'CTDL', hubVersion: 'Release 20260327' }), (unusedError, asnResult) => {
					const asnText = failureTextOf(asnResult);
					const writtenPairList = asnText ? [] : asnResult.graphDouble.state.writtenEdgeList.map((oneEdge) => `${oneEdge.fromStableId} ${oneEdge.properties.sourcePredicate} ${oneEdge.toStableId}`).sort();
					harness.ok('b_asnCtdlExactlyTheFour PASS', JSON.stringify(writtenPairList) === JSON.stringify(ASN_EXPECTED_PAIR_LIST), `${asnText} ${JSON.stringify(writtenPairList)}`);
					harness.note(`MEASURED ASN→CTDL ${writtenPairList.length}: ${writtenPairList.join(' ; ')}`);
					const asnShape = judgeEdgeShape({ result: asnResult, sourceStandardName: 'CTDLASN', nativeStableIdSet: asnNativeSet });
					harness.ok('c_asnCtdlEdgeShape PASS', asnShape.pass, asnShape.detail);
					const asnJudge = judgeZeroJudge(asnResult);
					harness.ok('e_asnCtdlZeroJudgeCalls PASS', asnJudge.pass, asnJudge.detail);
					harness.section('THE TWIN SWEEP');
					const loaded = require(path.join(FORGES_DIR, '..', 'lib', 'bridge-framework', 'test', 'testSupport', 'shippedBridge')).shippedBridgeEntryFor('ctdlCedsDeclaredCorrespondence');
					const withoutNotationRule = { bridgeDeclaration: { ...loaded.bridgeDeclaration, declaredTargetRuleList: loaded.bridgeDeclaration.declaredTargetRuleList.filter((oneRule) => oneRule.ruleKind !== 'memberByNotation') } };
					runCtdlCeds({ ctdlForged, pluginModuleOverrides: { ctdlCedsDeclaredCorrespondence: withoutNotationRule } }, (twinResult) => {
						const twinVerdict = judgeCtdlCeds({ result: twinResult, ctdlForged });
						harness.ok("(a) observed RED under 'notationRuleDropped'", !twinVerdict.pass, twinVerdict.detail);
						harness.note(`RED-OBSERVED a twin='notationRuleDropped' → ${twinVerdict.detail.slice(0, 200)}`);
						runCtdlCeds({ ctdlForged, frameworkMutationList: [{ modulePath: MATERIALISER_PATH, find: 'edgeTypeFor: () => EDGE_TYPES.DECLARED_CORRESPONDENCE,', replace: "edgeTypeFor: () => 'EXACT_MATCH'," }] }, (shapeTwinResult) => {
							const shapeTwin = judgeEdgeShape({ result: shapeTwinResult, sourceStandardName: 'CTDL', nativeStableIdSet: ctdlNativeSet });
							harness.ok("(c) observed RED under 'declaredShapeWritesMatchEdge'", !shapeTwin.pass, shapeTwin.detail);
							harness.note(`RED-OBSERVED c twin='declaredShapeWritesMatchEdge' → ${shapeTwin.detail.slice(0, 200)}`);
							harness.report();
						});
					});
				});
			});
		});
	});
});
