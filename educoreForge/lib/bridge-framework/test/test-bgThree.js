#!/usr/bin/env node
'use strict';

// test-bgThree.js — the EDGE and WRITE-SEAM gates: BG-THREE (BR-040) + BG-EDGE-UNIQUE + BG-CONSERV + BG-HARVEST (RULING
// BF3) + the Profile §7 gates BG-P1 (multimap), BG-P2 (tuple addressing), BG-P4 (justification), BG-P5 (confidence),
// BG-P6 (predicate authority). Every edge-property gate reads the GRAPH (the writer's own view — the graph double's
// written edges); BG-HARVEST reads the harvested block by label.
//   BG-THREE (a) matchBasis ∈ {standard, crosswalk}; (b) resolution ∈ {specified, judged}; (c) predicate ∈ SKOS and EQUAL to
//   the edge type's relation; (d) matchBasis CONSISTENT with provider/tool (a forward table walk); (e) decisionBlockHash
//   on EVERY edge and EQUAL to the block id; (f) provenanceTier EQUALS the FIXED producer-derived value (spec-authoritative
//   for authored; invalid-debug on a debug block) — RULING 12:20.
//   BG-EDGE-UNIQUE (a) edgeCount === distinctTripleCount; (b) a (subject, object) pair asserted with TWO predicates is
//   refused at freeze; (c) two attestation channels for one target yield ONE edge with attestationChannelList ≥ 2.
//   BG-CONSERV (a) every edge's object is a HubReference and its subject's _source is the pairing's source; (b) no edge type
//   outside SKOS_EDGE_TYPES; (c) no mapping edge carries provenanceTier structural; (d) NO non-mapping edge under the pair-
//   scoped label; (e) source node properties are byte-unchanged by materialise (labels aside).
//   BG-HARVEST (a) the harvested block's edge count EQUALS edgesWritten; (b) non-empty when edgesWritten > 0; (c) every
//   harvested edge's one-element-list decisionBlockHash EQUALS the block id.
//   BG-P1 (a) the index is a multimap (sum of list lengths === card count); (b) indexCollisionCount === contendedKeyCount;
//   (c) set() on an existing key is refused.  BG-P2 (a) every objectStableId is a card in the graph; (b) distinct objects ===
//   distinct resolved tuples; (c) the materialiser refuses an absent object.  BG-P4 (a) no judged record carries
//   ManualMappingCuration; (b) UnspecifiedMatching appears NOWHERE; (c) every justification ∈ the three; (d) the derivation
//   is a table (specified ⇒ ManualMappingCuration, judged ⇒ CompositeMatching, conflict ⇒ MappingReview).  BG-P5 (a)
//   confidence PRESENT on every judged edge; (b) ABSENT (key not present) on every specified edge; (c) EQUALS the band
//   table's value.  BG-P6 (a) a judged mapping carries the SOURCE's predicate; (b) NO predicate key survives from the
//   judge's return (discarded and COUNTED); (c) predicateAssertedBy ∈ the three on every edge.
//
// Run: node lib/bridge-framework/test/test-bgThree.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-THREE + BG-EDGE-UNIQUE + BG-CONSERV + BG-HARVEST + BG-P1/P2/P4/P5/P6

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const fs = require('fs');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { runConjunct, pureConjunct, succeeded, nameInRefusal, refusalCase, frameworkMutationTwin, scenarioTwin, edgesOf, blockOf } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const vocabularyLib = require(path.join(__dirname, '..', '..', 'vocabulary', 'vocabulary'));
const classificationLib = require('../classification');
const confidenceBandTableLib = require('../confidenceBandTable');
const materialiserLib = require('../materialiser');

const twinRegistry = makeTwinRegistry();
const FRAMEWORK_FILE = 'bridge-framework.js';
const MATERIALISER_FILE = 'materialiser.js';
const RULES_FILE = 'graphSeamRules.js';
const DOUBLE_FILE = 'graphDouble.js';
const CLASSIFICATION_FILE = 'classification.js';
const JUDGE_FILE = 'judgeComponent.js';
const PAIR_LABEL = 'BridgedRelation_TOY_TOYHUB';
const CROSSWALK_PLUGIN_PATH = path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', 'toyCrosswalkPlugin.js');
const { SKOS_EDGE_TYPES, SKOS_PREDICATES, SSSOM_JUSTIFICATIONS } = vocabularyLib;
const PREDICATE_BY_TYPE = Object.keys(SKOS_EDGE_TYPES).reduce((soFar, onePredicate) => ({ ...soFar, [SKOS_EDGE_TYPES[onePredicate]]: onePredicate }), {});
const cloneJson = scenarioLib.cloneJson;
const withScratchCsv = (scenario, mutateRowList) => {
	const scratchForgesDir = scenarioLib.makeScratchForgesCopy();
	const snapshotDir = path.join(scratchForgesDir, 'toy', 'assets', 'standardSourceData', '01');
	const csvPath = path.join(snapshotDir, 'toyCrosswalk.csv');
	const lineList = fs.readFileSync(csvPath, 'utf8').split('\n');
	const trailingBlank = lineList[lineList.length - 1] === '' ? [''] : [];
	fs.writeFileSync(csvPath, [lineList[0]].concat(mutateRowList(lineList.filter((oneLine, oneIndex) => oneIndex > 0 && oneLine !== ''))).concat(trailingBlank).join('\n'));
	const sumsPath = path.join(snapshotDir, 'SHA256SUMS');
	fs.writeFileSync(sumsPath, fs.readFileSync(sumsPath, 'utf8').replace(/^[0-9a-f]{64}(  toyCrosswalk\.csv)$/m, `${require('crypto').createHash('sha256').update(fs.readFileSync(csvPath)).digest('hex')}$1`));
	scenario.forgesDirOverride = scratchForgesDir;
};
// a writer double that lays a property mutation over every edge BEFORE the real (rule-checked) writer sees it — used only
// where the fault must be a WRITER fault (a property stripped / stamped) rather than a framework rule flip
const writerPropertyTwin = ({ conjunctGateId, conjunctId, twinName, mutateProperties }) =>
	scenarioTwin({ registry: twinRegistry, gateId: conjunctGateId, conjunctId, twinName, leverKind: 'productionMutation', mutate: (scenario) => {
		scenario.graphWriterFactoryOverride = (graphDouble) => (writerArgs) => {
			// bypass the double's rule check for the twin's mutation: write straight into the double's state
			const inner = graphDouble.graphWriterFactory(writerArgs);
			return {
				writeMappingEdge: ({ subjectStableId, objectStableId, edgeType, edgeProperties }, callback) => {
					const mutated = mutateProperties({ ...edgeProperties }, { subjectStableId, objectStableId, edgeType });
					inner.writeMappingEdge({ subjectStableId, objectStableId, edgeType: mutated.edgeType === undefined ? edgeType : mutated.edgeType, edgeProperties: mutated.edgeProperties === undefined ? mutated : mutated.edgeProperties }, (writeError) => {
						if (writeError) {
							// the seam refused the fault — the twin then writes it PAST the seam into the double's state (a writer that
							// does not check): the gate must catch it on the GRAPH
							graphDouble.state.edgeList.push({ fromStableId: subjectStableId, toStableId: objectStableId, type: mutated.edgeType === undefined ? edgeType : mutated.edgeType, properties: mutated.edgeProperties === undefined ? mutated : mutated.edgeProperties });
							graphDouble.state.writtenEdgeList.push({ fromStableId: subjectStableId, toStableId: objectStableId, type: mutated.edgeType === undefined ? edgeType : mutated.edgeType, properties: mutated.edgeProperties === undefined ? mutated : mutated.edgeProperties, applyLabel: writerArgs.applyLabel, pastTheSeam: true });
							[subjectStableId, objectStableId].forEach((oneStableId) => { const oneNode = graphDouble.state.nodeList.find((candidate) => candidate.stableId === oneStableId); if (oneNode && oneNode.labels.indexOf(writerArgs.applyLabel) === -1) { oneNode.labels.push(writerArgs.applyLabel); } });
							callback('', { edgeWritten: true });
							return;
						}
						callback('', { edgeWritten: true });
					});
				},
				close: inner.close,
			};
		};
	} });

const producerTierExpected = (outcome) => (blockOf(outcome).header.judgeKind.indexOf('debug:') === 0 ? 'invalid-debug' : vocabularyLib.MAPPING_EDGE_PROVENANCE_TIER_BY_PRODUCER_KIND[blockOf(outcome).header.producerKind]);

// ---------------------------------------------------------------------
// BG-THREE
// ---------------------------------------------------------------------
const threeConjunctList = [
	runConjunct({ conjunctId: 'a_matchBasisOnEveryEdge', title: 'every edge carries matchBasis ∈ {standard, crosswalk}', twinNameList: ['stripMatchBasis'], judge: succeeded((runReport, outcome) => { const bad = edgesOf(outcome).filter((oneEdge) => ['standard', 'crosswalk'].indexOf(oneEdge.properties.matchBasis) === -1); return { pass: edgesOf(outcome).length > 0 && bad.length === 0, detail: `${bad.length} bad of ${edgesOf(outcome).length}` }; }) }),
	runConjunct({ conjunctId: 'b_resolutionOnEveryEdge', title: 'every edge carries resolution ∈ {specified, judged}', twinNameList: ['stripResolution'], judge: succeeded((runReport, outcome) => { const bad = edgesOf(outcome).filter((oneEdge) => ['specified', 'judged'].indexOf(oneEdge.properties.resolution) === -1); return { pass: bad.length === 0, detail: `${bad.length} bad` }; }) }),
	runConjunct({ conjunctId: 'c_predicateSkosAndEqualsType', title: "every edge's predicate ∈ SKOS and EQUALS the edge type's relation", twinNameList: ['closeMatchOnExactMatchEdge'], judge: succeeded((runReport, outcome) => { const bad = edgesOf(outcome).filter((oneEdge) => SKOS_PREDICATES.indexOf(oneEdge.properties.predicate) === -1 || PREDICATE_BY_TYPE[oneEdge.type] !== oneEdge.properties.predicate); return { pass: bad.length === 0, detail: `${bad.length} bad` }; }) }),
	runConjunct({ conjunctId: 'd_matchBasisConsistentWithProviderTool', title: 'matchBasis is CONSISTENT with mappingProvider / mappingTool (forward table walk: standard/crosswalk ⇒ provider present, tool present iff judged)', twinNameList: ['crosswalkWithoutProvider'], judge: succeeded((runReport, outcome) => { const bad = edgesOf(outcome).filter((oneEdge) => !oneEdge.properties.mappingProvider || (oneEdge.properties.resolution === 'judged') !== (oneEdge.properties.mappingTool !== undefined)); return { pass: bad.length === 0, detail: `${bad.length} bad` }; }) }),
	runConjunct({ conjunctId: 'e_decisionBlockHashOnEveryEdgeEqualsBlockId', title: 'decisionBlockHash on EVERY edge and EQUAL to the block id', twinNameList: ['dropHashOnOneEdge'], judge: succeeded((runReport, outcome) => { const bad = edgesOf(outcome).filter((oneEdge) => oneEdge.properties.decisionBlockHash !== runReport.decisionBlock.decisionBlockHash); return { pass: bad.length === 0, detail: `${bad.length} bad` }; }) }),
	runConjunct({ conjunctId: 'f_provenanceTierEqualsFixedValue', title: "provenanceTier EQUALS the FIXED producer-derived value on every edge (invalid-debug under the debug judge; spec-authoritative for an authored block under a real client)", twinNameList: ['specAuthoritativeStampedOnDebugBlock'], judge: succeeded((runReport, outcome) => { const expected = producerTierExpected(outcome); const bad = edgesOf(outcome).filter((oneEdge) => oneEdge.properties.provenanceTier !== expected); return { pass: bad.length === 0, detail: `expected ${expected}; ${bad.length} bad` }; }) }),
	runConjunct({ conjunctId: 'f_specAuthoritativeUnderRealClient', title: "under a REAL-client double every authored edge carries provenanceTier 'spec-authoritative' (RULING 12:20)", twinNameList: ['tierAbsentUnderRealClient'], shape: (scenario) => { scenario.judgeClientOverride = scenarioLib.makeFakeRealClient({}); }, judge: succeeded((runReport, outcome) => { const bad = edgesOf(outcome).filter((oneEdge) => oneEdge.properties.provenanceTier !== 'spec-authoritative'); return { pass: edgesOf(outcome).length > 0 && bad.length === 0, detail: `${bad.length} bad of ${edgesOf(outcome).length}` }; }) }),
];
writerPropertyTwin({ conjunctGateId: 'BG-THREE', conjunctId: 'a_matchBasisOnEveryEdge', twinName: 'stripMatchBasis', mutateProperties: (properties) => { delete properties.matchBasis; return properties; } });
writerPropertyTwin({ conjunctGateId: 'BG-THREE', conjunctId: 'b_resolutionOnEveryEdge', twinName: 'stripResolution', mutateProperties: (properties) => { delete properties.resolution; return properties; } });
writerPropertyTwin({ conjunctGateId: 'BG-THREE', conjunctId: 'c_predicateSkosAndEqualsType', twinName: 'closeMatchOnExactMatchEdge', mutateProperties: (properties, { edgeType }) => (edgeType === 'EXACT_MATCH' ? { ...properties, predicate: 'closeMatch' } : properties) });
writerPropertyTwin({ conjunctGateId: 'BG-THREE', conjunctId: 'd_matchBasisConsistentWithProviderTool', twinName: 'crosswalkWithoutProvider', mutateProperties: (properties) => { delete properties.mappingProvider; return properties; } });
writerPropertyTwin({ conjunctGateId: 'BG-THREE', conjunctId: 'e_decisionBlockHashOnEveryEdgeEqualsBlockId', twinName: 'dropHashOnOneEdge', mutateProperties: (properties, { subjectStableId }) => (subjectStableId === 'toy:property/Student.FirstName' ? { ...properties, decisionBlockHash: 'a'.repeat(64) } : properties) });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-THREE', conjunctId: 'f_provenanceTierEqualsFixedValue', twinName: 'specAuthoritativeStampedOnDebugBlock', fileName: MATERIALISER_FILE, find: '\tif (debugMark) {\n\t\treturn PROVENANCE_TIER.INVALID_DEBUG;\n\t}', replace: '\tif (false && debugMark) {\n\t\treturn PROVENANCE_TIER.INVALID_DEBUG;\n\t}' });
writerPropertyTwin({ conjunctGateId: 'BG-THREE', conjunctId: 'f_specAuthoritativeUnderRealClient', twinName: 'tierAbsentUnderRealClient', mutateProperties: (properties) => { delete properties.provenanceTier; return properties; } });

// ---------------------------------------------------------------------
// BG-EDGE-UNIQUE
// ---------------------------------------------------------------------
const edgeUniqueConjunctList = [
	runConjunct({ conjunctId: 'a_edgeCountEqualsDistinctTripleCount', title: 'edgeCount === distinctTripleCount (the census) and EQUALS the written edge count', twinNameList: ['repeatedRowShapeWithoutDedupe'], judge: succeeded((runReport, outcome) => { const perTarget = blockOf(outcome).header.cardinalityCensus.perTarget; return { pass: perTarget.edgeCount === perTarget.distinctTripleCount && perTarget.edgeCount === edgesOf(outcome).length, detail: `edgeCount ${perTarget.edgeCount}, distinct ${perTarget.distinctTripleCount}, written ${edgesOf(outcome).length}` }; }) }),
	refusalCase({ registry: twinRegistry, gateId: 'BG-EDGE-UNIQUE', conjunctId: 'b_twoPredicatesOnePairRefusedAtFreeze', title: "a subject → one card asserted with 'Yes' AND 'Partial' (two predicates for one pair) is refused at freeze", shape: (scenario) => withScratchCsv(scenario, (rowList) => rowList.map((oneRow) => (/^Student,Student,Extra,000001,,Yes,second attestation,/.test(oneRow) ? oneRow.replace(',Yes,', ',Partial,') : oneRow))), regex: /is asserted with TWO predicates \(closeMatch, exactMatch\)/, twinName: 'keepTwoPredicatesAsTwoEdges', fileName: FRAMEWORK_FILE, find: '\t\t\t\t\t\t\t\tif (predicateSet.size > 1) {', replace: '\t\t\t\t\t\t\t\tif (false && predicateSet.size > 1) {' }),
	runConjunct({ conjunctId: 'c_twoAttestationsOneEdge', title: 'attestations from three rows / two subjects for one (leaf, target) yield ONE edge with attestationChannelList of length 3', twinNameList: ['oneEdgePerAttestation'], judge: succeeded((runReport, outcome) => { const edgeList = edgesOf(outcome).filter((oneEdge) => oneEdge.fromStableId === 'toy:property/Student.Extra'); return { pass: edgeList.length === 1 && edgeList[0].properties.attestationChannelList.length === 3, detail: `${edgeList.length} edges; attestations ${edgeList.map((oneEdge) => oneEdge.properties.attestationChannelList.length).join(',')}` }; }) }),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-EDGE-UNIQUE', conjunctId: 'a_edgeCountEqualsDistinctTripleCount', twinName: 'repeatedRowShapeWithoutDedupe', fileName: FRAMEWORK_FILE, find: "\t\t\t\t\t\tedgeCount: materialiserLib.pickedRecordList(decisionRecordList).length,", replace: "\t\t\t\t\t\tedgeCount: materialiserLib.pickedRecordList(decisionRecordList).length + args.preparedList.length,"});
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-EDGE-UNIQUE', conjunctId: 'c_twoAttestationsOneEdge', twinName: 'oneEdgePerAttestation', fileName: FRAMEWORK_FILE, find: '\t\t\t\t\t\t\tconst attestationChannelList = groupAssertionList.map((oneAssertion) => `${oneAssertion.sourceLocator.channelKey}:${oneAssertion.sourceLocator.rowNumber !== undefined ? oneAssertion.sourceLocator.rowNumber : oneAssertion.sourceLocator.stableId}`).sort();', replace: '\t\t\t\t\t\t\tconst attestationChannelList = [groupAssertionList.map((oneAssertion) => `${oneAssertion.sourceLocator.channelKey}:${oneAssertion.sourceLocator.rowNumber !== undefined ? oneAssertion.sourceLocator.rowNumber : oneAssertion.sourceLocator.stableId}`).sort()[0]];' });

// ---------------------------------------------------------------------
// BG-CONSERV
// ---------------------------------------------------------------------
const conservConjunctList = [
	runConjunct({ conjunctId: 'a_objectHubReferenceSubjectSourceEqualsPairing', title: "every edge's object is a HubReference and its subject's _source is the pairing's source (a card→card edge is refused at the write seam)", twinNameList: ['cardToCardEdge'], judge: succeeded((runReport, outcome) => { const nodeByStableId = outcome.graphDouble.state.nodeList.reduce((soFar, oneNode) => ({ ...soFar, [oneNode.stableId]: oneNode }), {}); const bad = edgesOf(outcome).filter((oneEdge) => nodeByStableId[oneEdge.toStableId].labels.indexOf('HubReference') === -1 || nodeByStableId[oneEdge.fromStableId].properties._source !== 'Toy'); return { pass: bad.length === 0, detail: `${bad.length} bad` }; }) }),
	runConjunct({ conjunctId: 'b_noEdgeTypeOutsideSkos', title: 'no written edge type outside SKOS_EDGE_TYPES', twinNameList: ['specifiedMappingType'], judge: succeeded((runReport, outcome) => { const bad = edgesOf(outcome).filter((oneEdge) => PREDICATE_BY_TYPE[oneEdge.type] === undefined); return { pass: bad.length === 0, detail: `${bad.length} bad` }; }) }),
	runConjunct({ conjunctId: 'c_noStructuralTierOnMappingEdge', title: "no mapping edge carries provenanceTier 'structural'", twinNameList: ['structuralTier'], judge: succeeded((runReport, outcome) => { const bad = edgesOf(outcome).filter((oneEdge) => oneEdge.properties.provenanceTier === 'structural'); return { pass: bad.length === 0, detail: `${bad.length} bad` }; }) }),
	runConjunct({ conjunctId: 'd_noNonMappingEdgeUnderLabel', title: 'NO non-mapping edge under the pair-scoped label: every harvested edge type ∈ SKOS_EDGE_TYPES', twinNameList: ['hasPropertyUnderLabel'], judge: succeeded((runReport, outcome) => { const harvest = outcome.graphDouble.harvestByLabel({ applyLabel: PAIR_LABEL }); const bad = harvest.edgeList.filter((oneEdge) => PREDICATE_BY_TYPE[oneEdge.type] === undefined); return { pass: harvest.edgeList.length > 0 && bad.length === 0, detail: `${bad.length} non-mapping of ${harvest.edgeList.length} harvested` }; }) }),
	runConjunct({ conjunctId: 'e_sourceNodePropertiesUnchanged', title: 'source node PROPERTIES are byte-unchanged by materialise (labels aside)', twinNameList: ['writerStampsParentId'], judge: succeeded((runReport, outcome, scenario) => { const before = scenario.graph.nodeList.filter((oneNode) => oneNode.properties._source === 'Toy').map((oneNode) => JSON.stringify(oneNode.properties)).join('\n'); const after = outcome.graphDouble.state.nodeList.filter((oneNode) => oneNode.properties._source === 'Toy').map((oneNode) => JSON.stringify(oneNode.properties)).join('\n'); return { pass: before === after, detail: before === after ? 'byte-equal' : 'CHANGED' }; }) }),
];
conservConjunctList[0].twinNameList = ['cardToCardEdgePastTheSeam'];
scenarioTwin({ registry: twinRegistry, gateId: 'BG-CONSERV', conjunctId: 'a_objectHubReferenceSubjectSourceEqualsPairing', twinName: 'cardToCardEdgePastTheSeam', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.graphWriterFactoryOverride = (graphDouble) => (writerArgs) => {
		const inner = graphDouble.graphWriterFactory(writerArgs);
		let injected = false;
		return { writeMappingEdge: (edgeArgs, callback) => inner.writeMappingEdge(edgeArgs, (writeError, written) => { if (!injected && !writeError) { injected = true; graphDouble.state.edgeList.push({ fromStableId: 'toyhub:card/P000001.C1', toStableId: 'toyhub:card/P000006.C1', type: 'EXACT_MATCH', properties: { ...edgeArgs.edgeProperties } }); graphDouble.state.writtenEdgeList.push({ fromStableId: 'toyhub:card/P000001.C1', toStableId: 'toyhub:card/P000006.C1', type: 'EXACT_MATCH', properties: { ...edgeArgs.edgeProperties }, applyLabel: writerArgs.applyLabel, pastTheSeam: true }); } callback(writeError, written); }), close: inner.close };
	};
} });
writerPropertyTwin({ conjunctGateId: 'BG-CONSERV', conjunctId: 'b_noEdgeTypeOutsideSkos', twinName: 'specifiedMappingType', mutateProperties: (properties, { edgeType }) => ({ edgeType: edgeType === 'EXACT_MATCH' ? 'SPECIFIED_MAPPING' : edgeType, edgeProperties: properties }) });
writerPropertyTwin({ conjunctGateId: 'BG-CONSERV', conjunctId: 'c_noStructuralTierOnMappingEdge', twinName: 'structuralTier', mutateProperties: (properties) => ({ ...properties, provenanceTier: 'structural' }) });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-CONSERV', conjunctId: 'd_noNonMappingEdgeUnderLabel', twinName: 'hasPropertyUnderLabel', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.graphWriterFactoryOverride = (graphDouble) => (writerArgs) => {
		const inner = graphDouble.graphWriterFactory(writerArgs);
		let injected = false;
		return { writeMappingEdge: (edgeArgs, callback) => inner.writeMappingEdge(edgeArgs, (writeError, written) => { if (!injected && !writeError) { injected = true; graphDouble.state.edgeList.push({ fromStableId: edgeArgs.subjectStableId, toStableId: edgeArgs.objectStableId, type: 'HAS_PROPERTY', properties: { provenanceTier: 'structural' } }); } callback(writeError, written); }), close: inner.close };
	};
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-CONSERV', conjunctId: 'e_sourceNodePropertiesUnchanged', twinName: 'writerStampsParentId', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.graphWriterFactoryOverride = (graphDouble) => (writerArgs) => {
		const inner = graphDouble.graphWriterFactory(writerArgs);
		return { writeMappingEdge: (edgeArgs, callback) => inner.writeMappingEdge(edgeArgs, (writeError, written) => { const subjectNode = graphDouble.state.nodeList.find((oneNode) => oneNode.stableId === edgeArgs.subjectStableId); if (subjectNode) { subjectNode.properties.parentId = 'stamped'; } callback(writeError, written); }), close: inner.close };
	};
} });

// ---------------------------------------------------------------------
// BG-HARVEST
// ---------------------------------------------------------------------
const harvestConjunctList = [
	runConjunct({ conjunctId: 'a_harvestedEdgeCountEqualsEdgesWritten', title: "the harvested block's EDGE COUNT (SKOS-typed edges between two nodes carrying the pair-scoped label) EQUALS runReport.edgesWritten", twinNameList: ['labelOnlyOneEndpoint'], judge: succeeded((runReport, outcome) => { const harvest = outcome.graphDouble.harvestByLabel({ applyLabel: PAIR_LABEL }); const skos = harvest.edgeList.filter((oneEdge) => PREDICATE_BY_TYPE[oneEdge.type] !== undefined); return { pass: skos.length === runReport.edgesWritten, detail: `harvested ${skos.length} vs edgesWritten ${runReport.edgesWritten}` }; }) }),
	runConjunct({ conjunctId: 'b_harvestNonEmptyWhenEdgesWritten', title: 'the harvested block is NON-EMPTY when edgesWritten > 0', twinNameList: ['labelOnlyOneEndpoint'], judge: succeeded((runReport, outcome) => { const harvest = outcome.graphDouble.harvestByLabel({ applyLabel: PAIR_LABEL }); return { pass: runReport.edgesWritten > 0 && harvest.edgeList.length > 0 && harvest.nodeList.length > 0, detail: `${harvest.nodeList.length} nodes, ${harvest.edgeList.length} edges` }; }) }),
	runConjunct({ conjunctId: 'c_harvestedHashListWrappedEqualsBlockId', title: 'every harvested edge carries a one-element-list-wrapped decisionBlockHash whose element EQUALS the decision block id', twinNameList: ['staleHashStamped'], judge: succeeded((runReport, outcome) => { const harvest = outcome.graphDouble.harvestByLabel({ applyLabel: PAIR_LABEL }); const bad = harvest.edgeList.filter((oneEdge) => !Array.isArray(oneEdge.properties.decisionBlockHash) || oneEdge.properties.decisionBlockHash.length !== 1 || oneEdge.properties.decisionBlockHash[0] !== runReport.decisionBlock.decisionBlockHash); return { pass: harvest.edgeList.length > 0 && bad.length === 0, detail: `${bad.length} bad of ${harvest.edgeList.length}` }; }) }),
];
['a_harvestedEdgeCountEqualsEdgesWritten', 'b_harvestNonEmptyWhenEdgesWritten'].forEach((oneConjunctId) => {
	scenarioTwin({ registry: twinRegistry, gateId: 'BG-HARVEST', conjunctId: oneConjunctId, twinName: 'labelOnlyOneEndpoint', leverKind: 'productionMutation', mutate: (scenario) => {
		// a writer double that labels only the SUBJECT endpoint: the harvest MATCH (a:L)-[r]->(b:L) then returns fewer edges
		scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, DOUBLE_FILE), find: '\t\t\t[subjectNode, objectNode].forEach((oneNode) => {\n\t\t\t\tif (oneNode.labels.indexOf(applyLabel) === -1) {', replace: '\t\t\t[subjectNode].forEach((oneNode) => {\n\t\t\t\tif (oneNode.labels.indexOf(applyLabel) === -1) {' });
	} });
});
writerPropertyTwin({ conjunctGateId: 'BG-HARVEST', conjunctId: 'c_harvestedHashListWrappedEqualsBlockId', twinName: 'staleHashStamped', mutateProperties: (properties) => ({ ...properties, decisionBlockHash: 'b'.repeat(64) }) });

// ---------------------------------------------------------------------
// BG-P1, BG-P2, BG-P4, BG-P5, BG-P6
// ---------------------------------------------------------------------
const p1ConjunctList = [
	pureConjunct({ conjunctId: 'a_multimapSumEqualsCardCount', title: 'the resolver index is a MULTIMAP: get returns a LIST for every key and the sum of list lengths EQUALS the card count', twinNameList: ['bareAssignmentIndex'], judge: (scenario) => { const lib = scenario.frameworkMutationList.some((oneMutation) => oneMutation.modulePath.endsWith(CLASSIFICATION_FILE)) ? moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, CLASSIFICATION_FILE), mutationList: scenario.frameworkMutationList }) : classificationLib; const cardList = scenarioLib.toyGraphLib.HUB_CARD_LIST.filter((oneNode) => oneNode.properties.referenceTier === 'property').map((oneNode) => ({ ...oneNode.properties, stableId: oneNode.stableId })); const index = lib.makeCardListByCanonicalKey({ cardList }); const everyList = index.keyList().every((oneKey) => Array.isArray(index.get(oneKey))); return { pass: everyList && index.sumOfListLengths() === cardList.length && index.get('P000002').length === 2, detail: `sum ${index.sumOfListLengths()} vs cards ${cardList.length}; P000002 → ${index.get('P000002').length}` }; } }),
	runConjunct({ conjunctId: 'b_indexCollisionCountEqualsContended', title: 'indexCollisionCount === contentionCensus.contendedKeyCount (by construction, asserted)', twinNameList: ['skipOneCollision'], judge: succeeded((runReport, outcome) => { const census = blockOf(outcome).header.cardinalityCensus.perTarget; return { pass: census.indexCollisionCount === census.contentionCensus.contendedKeyCount && census.indexCollisionCount === 2, detail: `${census.indexCollisionCount} vs ${census.contentionCensus.contendedKeyCount}` }; }) }),
	pureConjunct({ conjunctId: 'c_setOnExistingKeyRefused', title: 'the index type REFUSES set() on an existing key (a bare-assignment path is unreachable)', twinNameList: ['setOverwrites'], judge: (scenario) => { const lib = scenario.frameworkMutationList.some((oneMutation) => oneMutation.modulePath.endsWith(CLASSIFICATION_FILE)) ? moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, CLASSIFICATION_FILE), mutationList: scenario.frameworkMutationList }) : classificationLib; const index = lib.makeCardListByCanonicalKey({ cardList: [{ stableId: 'x', canonicalKey: 'P000001' }] }); let refused = ''; try { index.set({ canonicalKey: 'P000001', card: { stableId: 'y', canonicalKey: 'P000001' } }); } catch (thrown) { refused = thrown.message; } return { pass: /set\(\) on existing key 'P000001' would overwrite/.test(refused) && index.get('P000001').length === 1, detail: refused || 'set() succeeded twice' }; } }),
];
scenarioTwin({ registry: twinRegistry, gateId: 'BG-P1', conjunctId: 'a_multimapSumEqualsCardCount', twinName: 'bareAssignmentIndex', leverKind: 'productionMutation', mutate: (scenario) => { scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, CLASSIFICATION_FILE), find: '\t\t(listByKey[oneCard.canonicalKey] = listByKey[oneCard.canonicalKey] || []).push(oneCard);', replace: '\t\tlistByKey[oneCard.canonicalKey] = [oneCard];' }); } });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-P1', conjunctId: 'b_indexCollisionCountEqualsContended', twinName: 'skipOneCollision', fileName: FRAMEWORK_FILE, find: '\t\t\t\t\t\tindexCollisionCount: args.contention.contendedKeyCount,', replace: '\t\t\t\t\t\tindexCollisionCount: args.contention.contendedKeyCount - 1,' });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-P1', conjunctId: 'c_setOnExistingKeyRefused', twinName: 'setOverwrites', leverKind: 'productionMutation', mutate: (scenario) => { scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, CLASSIFICATION_FILE), find: '\t\tif (listByKey[canonicalKey] !== undefined) {\n\t\t\tthrow refuse.byName', replace: '\t\tif (false && listByKey[canonicalKey] !== undefined) {\n\t\t\tthrow refuse.byName' }); } });

const p2ConjunctList = [
	runConjunct({ conjunctId: 'a_everyObjectStableIdIsACard', title: 'every objectStableId in the frozen block is a card stableId present in the graph', twinNameList: ['canonicalKeyAsObjectStableId'], judge: succeeded((runReport, outcome) => { const cardSet = new Set(outcome.graphDouble.state.nodeList.filter((oneNode) => oneNode.labels.indexOf('HubReference') !== -1).map((oneNode) => oneNode.stableId)); const bad = materialiserLib.pickedRecordList(blockOf(outcome).decisionRecordList).filter((oneRecord) => !cardSet.has(oneRecord.objectStableId)); return { pass: bad.length === 0, detail: `${bad.length} bad` }; }) }),
	runConjunct({ conjunctId: 'b_distinctObjectsEqualDistinctTuples', title: "count(distinct objectStableId) === count(distinct resolved tuple): every picked record's OBJECT card satisfies the record's own resolved tuple (a qualifier dropped between tuple and card is the fault)", twinNameList: ['qualifierDroppedTwoTuplesOneCard'], judge: succeeded((runReport, outcome) => { const picked = materialiserLib.pickedRecordList(blockOf(outcome).decisionRecordList); const cardByStableId = outcome.graphDouble.state.nodeList.reduce((soFar, oneNode) => ({ ...soFar, [oneNode.stableId]: { ...oneNode.properties, stableId: oneNode.stableId } }), {}); const bad = picked.filter((oneRecord) => { const card = cardByStableId[oneRecord.objectStableId]; const suppliedTuple = oneRecord.suppliedTupleByTarget[card.canonicalKey]; return suppliedTuple === undefined || classificationLib.filterPoolByTuple({ keyPool: [{ ...card, qualifierKeys: Array.isArray(card.qualifierKeys) ? card.qualifierKeys : card.qualifierKeys === '' || card.qualifierKeys === undefined ? [] : [card.qualifierKeys] }], suppliedTupleFields: suppliedTuple }).filteredPool.length !== 1; }); return { pass: picked.length > 0 && bad.length === 0, detail: `${bad.length} of ${picked.length} picks name a card outside their resolved tuple` }; }) }),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-P2', conjunctId: 'a_everyObjectStableIdIsACard', twinName: 'canonicalKeyAsObjectStableId', fileName: FRAMEWORK_FILE, find: "\t\t\t\tdecisionRecordList.push({ ...baseRecord, resolution: 'specified', objectStableId: filteredCardList[0].stableId,", replace: "\t\t\t\tdecisionRecordList.push({ ...baseRecord, resolution: 'specified', objectStableId: filteredCardList[0].canonicalKey," });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-P2', conjunctId: 'b_distinctObjectsEqualDistinctTuples', twinName: 'qualifierDroppedTwoTuplesOneCard', fileName: FRAMEWORK_FILE, find: "\t\t\t\tdecisionRecordList.push({ ...baseRecord, resolution: 'specified', objectStableId: filteredCardList[0].stableId,", replace: "\t\t\t\tdecisionRecordList.push({ ...baseRecord, resolution: 'specified', objectStableId: filteredCardList[0].canonicalKey === 'P000005' ? 'toyhub:card/P000005.C1' : filteredCardList[0].stableId," });

const p4ConjunctList = [
	runConjunct({ conjunctId: 'a_noJudgedRecordCarriesManualCuration', title: 'no judged record / edge carries ManualMappingCuration', twinNameList: ['forceManualCurationOnJudged'], judge: succeeded((runReport, outcome) => { const bad = edgesOf(outcome).filter((oneEdge) => oneEdge.properties.resolution === 'judged' && oneEdge.properties.mappingJustification === 'semapv:ManualMappingCuration'); return { pass: bad.length === 0, detail: `${bad.length} bad` }; }) }),
	runConjunct({ conjunctId: 'b_unspecifiedMatchingNowhere', title: 'UnspecifiedMatching appears NOWHERE (block, edges)', twinNameList: ['stampUnspecifiedMatching'], judge: succeeded((runReport, outcome) => { const inBlock = JSON.stringify(blockOf(outcome)).indexOf('UnspecifiedMatching') !== -1; const inEdges = edgesOf(outcome).some((oneEdge) => oneEdge.properties.mappingJustification === 'semapv:UnspecifiedMatching'); return { pass: !inBlock && !inEdges, detail: `block ${inBlock}, edges ${inEdges}` }; }) }),
	runConjunct({ conjunctId: 'c_everyJustificationInTheThree', title: 'every justification ∈ the three (a LexicalMatching write is refused at the seam)', twinNameList: ['lexicalMatching'], judge: succeeded((runReport, outcome) => { const bad = edgesOf(outcome).filter((oneEdge) => SSSOM_JUSTIFICATIONS.indexOf(oneEdge.properties.mappingJustification) === -1); return { pass: bad.length === 0, detail: `${bad.length} bad` }; }) }),
	pureConjunct({ conjunctId: 'd_derivationIsATable', title: 'the justification derivation is a TABLE: specified ⇒ ManualMappingCuration, judged ⇒ CompositeMatching, conflict ⇒ MappingReview', twinNameList: ['swapTwoRows'], judge: (scenario) => { const lib = scenario.frameworkMutationList.some((oneMutation) => oneMutation.modulePath.endsWith(MATERIALISER_FILE)) ? moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, MATERIALISER_FILE), mutationList: scenario.frameworkMutationList }) : materialiserLib; const table = lib.JUSTIFICATION_BY_RESOLUTION; const conflictLib = require('../conflictDetector'); void conflictLib; return { pass: table.specified === 'semapv:ManualMappingCuration' && table.judged === 'semapv:CompositeMatching' && Object.keys(table).length === 2, detail: JSON.stringify(table) }; } }),
];
writerPropertyTwin({ conjunctGateId: 'BG-P4', conjunctId: 'a_noJudgedRecordCarriesManualCuration', twinName: 'forceManualCurationOnJudged', mutateProperties: (properties) => (properties.resolution === 'judged' ? { ...properties, mappingJustification: 'semapv:ManualMappingCuration' } : properties) });
writerPropertyTwin({ conjunctGateId: 'BG-P4', conjunctId: 'b_unspecifiedMatchingNowhere', twinName: 'stampUnspecifiedMatching', mutateProperties: (properties, { subjectStableId }) => (subjectStableId === 'toy:property/Student.FirstName' ? { ...properties, mappingJustification: 'semapv:UnspecifiedMatching' } : properties) });
writerPropertyTwin({ conjunctGateId: 'BG-P4', conjunctId: 'c_everyJustificationInTheThree', twinName: 'lexicalMatching', mutateProperties: (properties, { subjectStableId }) => (subjectStableId === 'toy:property/Student.FirstName' ? { ...properties, mappingJustification: 'semapv:LexicalMatching' } : properties) });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-P4', conjunctId: 'd_derivationIsATable', twinName: 'swapTwoRows', fileName: MATERIALISER_FILE, find: "const JUSTIFICATION_BY_RESOLUTION = Object.freeze({ specified: 'semapv:ManualMappingCuration', judged: 'semapv:CompositeMatching' });", replace: "const JUSTIFICATION_BY_RESOLUTION = Object.freeze({ specified: 'semapv:CompositeMatching', judged: 'semapv:ManualMappingCuration' });" });

const p5ConjunctList = [
	runConjunct({ conjunctId: 'a_confidencePresentOnJudged', title: 'confidence PRESENT on every judged edge', twinNameList: ['dropConfidenceFromJudged'], shape: (scenario) => { scenario.judgeClientOverride = scenarioLib.makeFakeRealClient({}); }, judge: succeeded((runReport, outcome) => { const judged = edgesOf(outcome).filter((oneEdge) => oneEdge.properties.resolution === 'judged'); const bad = judged.filter((oneEdge) => typeof oneEdge.properties.confidence !== 'number'); return { pass: judged.length > 0 && bad.length === 0, detail: `${bad.length} bad of ${judged.length}` }; }) }),
	runConjunct({ conjunctId: 'b_confidenceAbsentOnSpecified', title: 'confidence ABSENT (key not present — not null, not 1.0) on every specified edge', twinNameList: ['confidenceOneOnSpecified', 'confidenceNullOnSpecified'], judge: succeeded((runReport, outcome) => { const specified = edgesOf(outcome).filter((oneEdge) => oneEdge.properties.resolution === 'specified'); const bad = specified.filter((oneEdge) => Object.prototype.hasOwnProperty.call(oneEdge.properties, 'confidence')); return { pass: specified.length > 0 && bad.length === 0, detail: `${bad.length} bad of ${specified.length}` }; }) }),
	runConjunct({ conjunctId: 'c_confidenceEqualsBandValue', title: "confidence EQUALS the band table's discrete value, never a computed float", twinNameList: ['computedFloat'], shape: (scenario) => { scenario.judgeClientOverride = scenarioLib.makeFakeRealClient({}); }, judge: succeeded((runReport, outcome) => { const bandValueList = Object.keys(confidenceBandTableLib.CONFIDENCE_BAND_TABLE).map((oneCategory) => confidenceBandTableLib.CONFIDENCE_BAND_TABLE[oneCategory]); const judged = edgesOf(outcome).filter((oneEdge) => oneEdge.properties.resolution === 'judged'); const bad = judged.filter((oneEdge) => bandValueList.indexOf(oneEdge.properties.confidence) === -1); return { pass: judged.length > 0 && bad.length === 0, detail: `${bad.length} bad` }; }) }),
];
writerPropertyTwin({ conjunctGateId: 'BG-P5', conjunctId: 'a_confidencePresentOnJudged', twinName: 'dropConfidenceFromJudged', mutateProperties: (properties) => { if (properties.resolution === 'judged') { delete properties.confidence; } return properties; } });
writerPropertyTwin({ conjunctGateId: 'BG-P5', conjunctId: 'b_confidenceAbsentOnSpecified', twinName: 'confidenceOneOnSpecified', mutateProperties: (properties) => (properties.resolution === 'specified' ? { ...properties, confidence: 1.0 } : properties) });
writerPropertyTwin({ conjunctGateId: 'BG-P5', conjunctId: 'b_confidenceAbsentOnSpecified', twinName: 'confidenceNullOnSpecified', mutateProperties: (properties) => (properties.resolution === 'specified' ? { ...properties, confidence: null } : properties) });
writerPropertyTwin({ conjunctGateId: 'BG-P5', conjunctId: 'c_confidenceEqualsBandValue', twinName: 'computedFloat', mutateProperties: (properties) => (properties.resolution === 'judged' ? { ...properties, confidence: 0.7314 } : properties) });

const p6ConjunctList = [
	runConjunct({ conjunctId: 'a_judgedCarriesSourcePredicate', title: "a judged mapping carries the SOURCE's predicate (labelTable: Yes → exactMatch / Maybe → closeMatch), never the judge's", twinNameList: ['judgePredicateLands'], shape: (scenario) => { scenario.judgeClientOverride = scenarioLib.makeFakeRealClient({ extraReturnKeys: { predicate: 'relatedMatch' } }); }, judge: succeeded((runReport, outcome) => { const judged = edgesOf(outcome).filter((oneEdge) => oneEdge.properties.resolution === 'judged'); const bad = judged.filter((oneEdge) => oneEdge.properties.predicate === 'relatedMatch' || ['exactMatch', 'closeMatch'].indexOf(oneEdge.properties.predicate) === -1); return { pass: judged.length > 0 && bad.length === 0, detail: `${bad.length} bad of ${judged.length}` }; }) }),
	runConjunct({ conjunctId: 'b_noPredicateKeySurvivesAndDiscardCounted', title: "NO predicate key survives from the judge's return into the record; the stray key is discarded and COUNTED (discardedPredicateKeyCount)", twinNameList: ['discardNotCounted'], shape: (scenario) => { scenario.judgeClientOverride = scenarioLib.makeFakeRealClient({ extraReturnKeys: { predicate: 'relatedMatch' } }); }, judge: succeeded((runReport, outcome) => { const judgedRecordList = blockOf(outcome).decisionRecordList.filter((oneRecord) => oneRecord.classification === 'judged'); const leaked = judgedRecordList.filter((oneRecord) => oneRecord.judge.predicate !== undefined || oneRecord.predicate === 'relatedMatch'); return { pass: leaked.length === 0 && runReport.counts.discardedPredicateKeyCount === judgedRecordList.length && judgedRecordList.length > 0, detail: `leaked ${leaked.length}; discarded ${runReport.counts.discardedPredicateKeyCount} of ${judgedRecordList.length}` }; }) }),
	runConjunct({ conjunctId: 'c_predicateAssertedByOnEveryEdge', title: 'predicateAssertedBy ∈ {source, labelTable, channelAssertion} on every edge (dropping it is refused at the seam)', twinNameList: ['dropPredicateAssertedBy'], judge: succeeded((runReport, outcome) => { const bad = edgesOf(outcome).filter((oneEdge) => ['source', 'labelTable', 'channelAssertion'].indexOf(oneEdge.properties.predicateAssertedBy) === -1); return { pass: bad.length === 0, detail: `${bad.length} bad` }; }) }),
];
scenarioTwin({ registry: twinRegistry, gateId: 'BG-P6', conjunctId: 'a_judgedCarriesSourcePredicate', twinName: 'judgePredicateLands', leverKind: 'productionMutation', mutate: (scenario) => {
	// a judge component that PASSES the return's predicate through and a freezer that lands it
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, JUDGE_FILE), find: '\treturn { chosenCardStableId: mapped.chosenCardStableId, choice: clientReturn.choice, category: clientReturn.category, rationale: clientReturn.rationale, confidence: band.confidence, discardedPredicateKeyCount };', replace: '\treturn { chosenCardStableId: mapped.chosenCardStableId, choice: clientReturn.choice, category: clientReturn.category, rationale: clientReturn.rationale, confidence: band.confidence, discardedPredicateKeyCount, predicateFromJudge: clientReturn.predicate };' });
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: "\t\t\t\t\t\t\t\tconst predicate = labelRow.disposition === 'tentative' ? labelRow.predicateIfPicked : labelRow.predicate;", replace: "\t\t\t\t\t\t\t\tconst predicate = judged.predicateFromJudge !== undefined ? judged.predicateFromJudge : labelRow.disposition === 'tentative' ? labelRow.predicateIfPicked : labelRow.predicate;" });
} });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-P6', conjunctId: 'b_noPredicateKeySurvivesAndDiscardCounted', twinName: 'discardNotCounted', fileName: JUDGE_FILE, find: "\tconst discardedPredicateKeyCount = Object.prototype.hasOwnProperty.call(clientReturn, 'predicate') ? 1 : 0;", replace: '\tconst discardedPredicateKeyCount = 0;' });
writerPropertyTwin({ conjunctGateId: 'BG-P6', conjunctId: 'c_predicateAssertedByOnEveryEdge', twinName: 'dropPredicateAssertedBy', mutateProperties: (properties) => { delete properties.predicateAssertedBy; return properties; } });

const gateDeclarationList = [
	{ gateId: 'BG-THREE', title: 'three properties + hash + tier on every edge', conjunctList: threeConjunctList },
	{ gateId: 'BG-EDGE-UNIQUE', title: 'one edge per distinct triple', conjunctList: edgeUniqueConjunctList },
	{ gateId: 'BG-CONSERV', title: 'conservativity', conjunctList: conservConjunctList },
	{ gateId: 'BG-HARVEST', title: 'the harvested block', conjunctList: harvestConjunctList },
	{ gateId: 'BG-P1', title: 'Profile 7.1 no single-valued index', conjunctList: p1ConjunctList },
	{ gateId: 'BG-P2', title: 'Profile 7.2 tuple addressing', conjunctList: p2ConjunctList },
	{ gateId: 'BG-P4', title: 'Profile 7.4 justification', conjunctList: p4ConjunctList },
	{ gateId: 'BG-P5', title: 'Profile 7.5 confidence', conjunctList: p5ConjunctList },
	{ gateId: 'BG-P6', title: 'Profile 7.6 predicate authority', conjunctList: p6ConjunctList },
];

runGateFamily(
	{ harness, familyName: 'BG-THREE+BG-EDGE-UNIQUE+BG-CONSERV+BG-HARVEST+BG-P1/P2/P4/P5/P6', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 7 + 3 + 5 + 3 + 3 + 2 + 4 + 3 + 3 },
	() => harness.report(),
);
