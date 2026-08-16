#!/usr/bin/env node
'use strict';

// test-bgBolt.js — BG-BOLT (RULING BR1, B2 review remediation 2026-08-16): STRUCTURAL PARITY between the two bolt files
// (graphReader.js / graphWriter.js — the only framework code that ever touches a real Neo4j) and the corresponding
// half of graphDouble.js. The reviewer removed the object-endpoint label stamp, unblinded forEvidence() and dropped
// the _source scope from the bolt files and every suite stayed green, because no gate executed them. This family
// EXECUTES them: each bolt file is compiled through moduleDouble with its ONE `require('neo4j-driver')` swapped
// for testSupport/boltDriverDouble.js, whose interpreter runs the Cypher the bolt file EMITS against the same
// in-memory state graphDouble holds. Every conjunct compares the bolt half to the double half on the toy graph;
// every twin is a production mutation of the BOLT FILE, compiled through the same double.
//   (a) the writer's Cypher stamps the pair-scoped label on BOTH endpoints — after one write through the bolt writer,
//       subject AND object carry applyLabel, EQUAL to the double's writer on the same state
//   (b) the reader's forEvidence() routes through blindedRecordFor — no declared name on any evidence node, records
//       EQUAL to the double's forEvidence()
//   (c) readSubjectNodes / readSourceRecords keep the _source scope — the bolt reader returns EXACTLY the source
//       nodes the double returns (a hub card never becomes a subject)
//   (d) the writer routes every edge through graphSeamRules.mappingEdgeRefusal at the ENDPOINT lookup — an object
//       that is not a HubReference is refused by name and nothing is written
//   (d') …and at the SHAPE check before any session opens — a stray property is refused by name
//   (e) forEvidence() edges are blinded on the bolt reader too (BR6's bolt half): no declared name on any edge
//   (f) readEdgesAmongSource keeps the _source scope on BOTH endpoints — a mapping edge just written (source → hub
//       card) is NOT among-source
// A containerised smoke gate over a real DEV_ graph (BG-BOLT-LIVE) is B3's — named in its brief.
//
// Run: node lib/bridge-framework/test/test-bgBolt.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-BOLT: bolt-file ↔ graph-double parity through a driver double (RULING BR1)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { frameworkMutationTwin, frameworkFile } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const boltDriverDouble = require('./testSupport/boltDriverDouble');
const graphDoubleLib = require('../graphDouble');
const vocabularyLib = require(path.join(__dirname, '..', '..', 'vocabulary', 'vocabulary'));

const twinRegistry = makeTwinRegistry();
const GATE_ID = 'BG-BOLT';
const READER_FILE = 'graphReader.js';
const WRITER_FILE = 'graphWriter.js';
const DRIVER_DOUBLE_PATH = path.join(__dirname, 'testSupport', 'boltDriverDouble.js');
const toyGraphLib = scenarioLib.toyGraphLib;
const cloneJson = scenarioLib.cloneJson;

const SOURCE_STANDARD_NAME = toyGraphLib.SOURCE_STANDARD_NAME;
const HUB_NAME = toyGraphLib.HUB_NAME;
const BLINDING_DECLARATION = ['hubAnchorId', 'crossRefs', 'hubAnchorOriginalPropertyName', 'hubOptionCode', 'hubOptionOriginalPropertyName'];
const APPLY_LABEL = 'BridgedRelation_TOY_TOYHUB';
const IN_GRAPH = { boltUrl: 'bolt://double.invalid:7687', password: 'double', containerName: 'DEV_bgBolt_double' };

// the driver swap — the harness lever (NOT a twin): the bolt file's one require of neo4j-driver becomes the double
const readerDriverSwap = { modulePath: frameworkFile(READER_FILE), find: "\tconst neo4j = require('neo4j-driver'); // the ONE sanctioned require of the driver in the framework's read path", replace: `\tconst neo4j = require(${JSON.stringify(DRIVER_DOUBLE_PATH)}).neo4j; // BG-BOLT driver double` };
const writerDriverSwap = { modulePath: frameworkFile(WRITER_FILE), find: "\tconst neo4j = require('neo4j-driver'); // the ONE sanctioned require of the driver in the framework's write path", replace: `\tconst neo4j = require(${JSON.stringify(DRIVER_DOUBLE_PATH)}).neo4j; // BG-BOLT driver double` };

const boltReaderLib = (scenario) => moduleDouble.loadWithMutations({ modulePath: frameworkFile(READER_FILE), mutationList: [readerDriverSwap].concat(scenario.frameworkMutationList) });
const boltWriterLib = (scenario) => moduleDouble.loadWithMutations({ modulePath: frameworkFile(WRITER_FILE), mutationList: [writerDriverSwap].concat(scenario.frameworkMutationList) });

// twoStates — a fresh toy state for the BOLT half (bound into the driver double) and an identical fresh graphDouble
const twoStates = () => {
	const graph = toyGraphLib.toyGraph();
	const boltState = { nodeList: cloneJson(graph.nodeList), edgeList: cloneJson(graph.edgeList) };
	boltDriverDouble.useState(boltState);
	const graphDouble = graphDoubleLib.graphDoubleFrom(graph);
	return { boltState, graphDouble };
};
const readerArgs = { inGraph: IN_GRAPH, dependencyStandardNameList: [HUB_NAME, SOURCE_STANDARD_NAME], sourceStandardName: SOURCE_STANDARD_NAME, blindingDeclaration: BLINDING_DECLARATION };
const writerArgs = { inGraph: IN_GRAPH, applyLabel: APPLY_LABEL, sourceStandardName: SOURCE_STANDARD_NAME };
const canonicalRecordList = (recordList) => JSON.stringify(recordList.map((oneRecord) => ({ stableId: oneRecord.stableId, properties: Object.keys(oneRecord.properties).sort().reduce((soFar, oneName) => ({ ...soFar, [oneName]: oneRecord.properties[oneName] }), {}) })).sort((leftRecord, rightRecord) => (leftRecord.stableId < rightRecord.stableId ? -1 : 1)));

// a VALID mapping edge on the toy graph (Student.FirstName → card P000001.C1)
const validEdge = () => ({
	subjectStableId: 'toy:property/Student.FirstName',
	objectStableId: 'toyhub:card/P000001.C1',
	edgeType: 'EXACT_MATCH',
	edgeProperties: {
		[vocabularyLib.MAPPING_PROPERTIES.PREDICATE]: 'exactMatch',
		[vocabularyLib.MAPPING_PROPERTIES.MAPPING_JUSTIFICATION]: 'semapv:ManualMappingCuration',
		[vocabularyLib.MAPPING_PROPERTIES.MATCH_BASIS]: 'crosswalk',
		[vocabularyLib.MAPPING_PROPERTIES.RESOLUTION]: 'specified',
		[vocabularyLib.MAPPING_PROPERTIES.MAPPING_PROVIDER]: 'https://toy.example/crosswalk',
		[vocabularyLib.MAPPING_PROPERTIES.SUBJECT_MATCH_FIELD]: 'toyCrosswalk:HubGlobalId',
		[vocabularyLib.MAPPING_PROPERTIES.OBJECT_MATCH_FIELD]: 'EDUcoreHub:canonicalKey',
		[vocabularyLib.MAPPING_PROPERTIES.SOURCE_LABEL]: 'Yes',
		[vocabularyLib.MAPPING_PROPERTIES.PREDICATE_ASSERTED_BY]: 'labelTable',
		[vocabularyLib.MAPPING_PROPERTIES.ATTESTATION_CHANNEL_LIST]: ['crosswalk:2'],
		[vocabularyLib.MAPPING_PROPERTIES.DECISION_BLOCK_HASH]: 'c'.repeat(64),
		[vocabularyLib.MAPPING_PROPERTIES.MATCH_ID]: 'd'.repeat(64),
		[vocabularyLib.MAPPING_PROPERTIES.PROVENANCE_TIER]: 'spec-authoritative',
		[vocabularyLib.MAPPING_PROPERTIES.SUBJECT_SOURCE]: 'Toy',
		[vocabularyLib.MAPPING_PROPERTIES.SUBJECT_VERSION]: '1.2.3',
		[vocabularyLib.MAPPING_PROPERTIES.OBJECT_SOURCE]: 'ToyHub',
		[vocabularyLib.MAPPING_PROPERTIES.OBJECT_VERSION]: '1.0',
	},
});

// writeThroughBoth — the same edge through the bolt writer (over boltState) and the double's writer (over graphDouble)
const writeThroughBoth = (scenario, edge, callback) => {
	const { boltState, graphDouble } = twoStates();
	let boltWriter;
	try {
		boltWriter = boltWriterLib(scenario).graphWriterFactory(writerArgs);
	} catch (constructionThrow) {
		callback('', { boltError: constructionThrow.message, boltState, graphDouble });
		return;
	}
	boltWriter.writeMappingEdge(edge, (boltError) => {
		const doubleWriter = graphDouble.graphWriterFactory(writerArgs);
		doubleWriter.writeMappingEdge(edge, (doubleError) => {
			callback('', { boltError: boltError || '', doubleError: doubleError || '', boltState, graphDouble });
		});
	});
};
const labelsOf = (state, stableId) => (state.nodeList.find((oneNode) => oneNode.stableId === stableId) || { labels: [] }).labels.slice().sort();

const conjunctList = [
	{
		conjunctId: 'a_writerStampsBothEndpoints',
		title: "the bolt writer's Cypher stamps the pair-scoped label on BOTH endpoints: after one write, subject AND object carry applyLabel, and the endpoint label sets EQUAL the double's",
		twinNameList: ['objectStampDropped'],
		evaluate: (scenario, callback) => {
			writeThroughBoth(scenario, validEdge(), (unusedError, outcome) => {
				if (outcome.boltError || outcome.doubleError) {
					callback('', { pass: false, detail: `bolt: ${outcome.boltError || 'ok'}; double: ${outcome.doubleError || 'ok'}` });
					return;
				}
				const edge = validEdge();
				const boltSubject = labelsOf(outcome.boltState, edge.subjectStableId);
				const boltObject = labelsOf(outcome.boltState, edge.objectStableId);
				const doubleSubject = labelsOf(outcome.graphDouble.state, edge.subjectStableId);
				const doubleObject = labelsOf(outcome.graphDouble.state, edge.objectStableId);
				const bothStamped = boltSubject.indexOf(APPLY_LABEL) !== -1 && boltObject.indexOf(APPLY_LABEL) !== -1;
				const equal = JSON.stringify(boltSubject) === JSON.stringify(doubleSubject) && JSON.stringify(boltObject) === JSON.stringify(doubleObject);
				const boltEdge = outcome.boltState.edgeList.find((oneEdge) => oneEdge.fromStableId === edge.subjectStableId && oneEdge.toStableId === edge.objectStableId);
				callback('', { pass: bothStamped && equal && boltEdge !== undefined && boltEdge.type === edge.edgeType, detail: `bolt subject ${JSON.stringify(boltSubject)} object ${JSON.stringify(boltObject)}; double subject ${JSON.stringify(doubleSubject)} object ${JSON.stringify(doubleObject)}` });
			});
		},
	},
	{
		conjunctId: 'b_forEvidenceRoutesThroughBlindedRecordFor',
		title: "the bolt reader's forEvidence() records carry NONE of the declared names and EQUAL the double's forEvidence() records (stableId + properties)",
		twinNameList: ['evidenceViewUnblindedOnBolt'],
		evaluate: (scenario, callback) => {
			const { graphDouble } = twoStates();
			const boltReader = boltReaderLib(scenario).graphReaderFactory(readerArgs);
			const doubleReader = graphDouble.graphReaderFactory(readerArgs);
			boltReader.forEvidence().readSourceNodes({}, (boltError, boltList) => {
				if (boltError) {
					callback('', { pass: false, detail: String(boltError).slice(0, 200) });
					return;
				}
				doubleReader.forEvidence().readSourceNodes({}, (doubleError, doubleList) => {
					const leaked = boltList.reduce((soFar, oneRecord) => soFar.concat(Object.keys(oneRecord.properties).filter((oneName) => BLINDING_DECLARATION.indexOf(oneName) !== -1)), []);
					const equal = canonicalRecordList(boltList) === canonicalRecordList(doubleList);
					callback('', { pass: boltList.length > 0 && leaked.length === 0 && equal, detail: `${boltList.length} bolt / ${doubleList.length} double records; leaked ${Array.from(new Set(leaked)).join(',') || 'none'}; ${equal ? 'EQUAL' : 'DIFFER'}` });
				});
			});
		},
	},
	{
		conjunctId: 'c_readSubjectNodesKeepsSourceScope',
		title: "the bolt reader's readSubjectNodes returns EXACTLY the source-standard nodes the double returns — a hub card is never a subject (the _source scope is in the Cypher)",
		twinNameList: ['sourceScopeDropped'],
		evaluate: (scenario, callback) => {
			const { graphDouble } = twoStates();
			const boltReader = boltReaderLib(scenario).graphReaderFactory(readerArgs);
			const doubleReader = graphDouble.graphReaderFactory(readerArgs);
			boltReader.readSubjectNodes((boltError, boltList) => {
				if (boltError) {
					callback('', { pass: false, detail: String(boltError).slice(0, 200) });
					return;
				}
				doubleReader.readSubjectNodes((doubleError, doubleList) => {
					const foreign = boltList.filter((oneRecord) => oneRecord.properties._source !== SOURCE_STANDARD_NAME);
					const equal = canonicalRecordList(boltList) === canonicalRecordList(doubleList);
					callback('', { pass: boltList.length > 0 && foreign.length === 0 && equal, detail: `${boltList.length} bolt / ${doubleList.length} double; foreign ${foreign.length}; ${equal ? 'EQUAL' : 'DIFFER'}` });
				});
			});
		},
	},
	{
		conjunctId: 'd_writerRefusesNonHubObjectAtEndpointLookup',
		title: 'the bolt writer routes the edge through mappingEdgeRefusal at the ENDPOINT lookup: an object that is not a HubReference is refused by name and NOTHING is written (no label stamp, no edge)',
		twinNameList: ['endpointRefusalSkipped'],
		evaluate: (scenario, callback) => {
			const edge = { ...validEdge(), objectStableId: 'toy:property/Student.BirthDate' };
			writeThroughBoth(scenario, edge, (unusedError, outcome) => {
				const refusedByName = /is not a HubReference|object endpoint/.test(String(outcome.boltError));
				const nothingWritten = !outcome.boltState.edgeList.some((oneEdge) => oneEdge.fromStableId === edge.subjectStableId && oneEdge.toStableId === edge.objectStableId) && labelsOf(outcome.boltState, edge.subjectStableId).indexOf(APPLY_LABEL) === -1;
				callback('', { pass: refusedByName && nothingWritten && Boolean(outcome.doubleError), detail: `bolt: ${String(outcome.boltError).slice(0, 160) || 'WROTE'}; double: ${String(outcome.doubleError).slice(0, 80) || 'WROTE'}` });
			});
		},
	},
	{
		conjunctId: 'dPrime_writerRefusesStrayPropertyBeforeSession',
		title: 'the bolt writer routes the edge through mappingEdgeRefusal at the SHAPE check BEFORE any session opens: a stray property is refused by name and no Cypher runs',
		twinNameList: ['shapeRefusalSkipped'],
		evaluate: (scenario, callback) => {
			const edge = validEdge();
			edge.edgeProperties.smuggledNote = 'not a vocabulary row';
			writeThroughBoth(scenario, edge, (unusedError, outcome) => {
				const refusedByName = /edge property 'smuggledNote' is outside vocabulary\.MAPPING_PROPERTIES/.test(String(outcome.boltError));
				const boltCypherCount = boltDriverDouble.cypherLog().length;
				callback('', { pass: refusedByName && boltCypherCount === 0, detail: `bolt: ${String(outcome.boltError).slice(0, 120) || 'WROTE'}; cypher statements run before the double's write: ${boltCypherCount}` });
			});
		},
	},
	{
		conjunctId: 'e_forEvidenceEdgesBlindedOnBolt',
		title: "the bolt reader's forEvidence().readEdgesAmongSource carries NONE of the declared names (BR6's bolt half) and EQUALS the double's",
		twinNameList: ['evidenceEdgesRawOnBolt'],
		evaluate: (scenario, callback) => {
			const { graphDouble } = twoStates();
			const boltReader = boltReaderLib(scenario).graphReaderFactory(readerArgs);
			const doubleReader = graphDouble.graphReaderFactory(readerArgs);
			boltReader.forEvidence().readEdgesAmongSource({}, (boltError, boltList) => {
				if (boltError) {
					callback('', { pass: false, detail: String(boltError).slice(0, 200) });
					return;
				}
				doubleReader.forEvidence().readEdgesAmongSource({}, (doubleError, doubleList) => {
					const leaked = boltList.reduce((soFar, oneEdge) => soFar.concat(Object.keys(oneEdge.properties).filter((oneName) => BLINDING_DECLARATION.indexOf(oneName) !== -1)), []);
					const key = (oneEdge) => `${oneEdge.fromStableId}|${oneEdge.type}|${oneEdge.toStableId}|${JSON.stringify(Object.keys(oneEdge.properties).sort())}`;
					const equal = JSON.stringify(boltList.map(key).sort()) === JSON.stringify(doubleList.map(key).sort());
					callback('', { pass: boltList.length === 5 && leaked.length === 0 && equal, detail: `${boltList.length} bolt / ${doubleList.length} double edges; leaked ${leaked.join(',') || 'none'}; ${equal ? 'EQUAL' : 'DIFFER'}` });
				});
			});
		},
	},
	{
		conjunctId: 'f_readEdgesAmongSourceScopedBothEndpoints',
		title: 'the bolt readEdgesAmongSource keeps the _source scope on BOTH endpoints: a mapping edge just written (source → hub card) is NOT among-source',
		twinNameList: ['objectEndpointScopeDropped'],
		evaluate: (scenario, callback) => {
			writeThroughBoth(scenario, validEdge(), (unusedError, outcome) => {
				if (outcome.boltError) {
					callback('', { pass: false, detail: `write: ${String(outcome.boltError).slice(0, 160)}` });
					return;
				}
				const boltReader = boltReaderLib(scenario).graphReaderFactory(readerArgs);
				boltReader.forEvidence().readEdgesAmongSource({}, (readError, boltList) => {
					const crossing = boltList.filter((oneEdge) => oneEdge.toStableId === validEdge().objectStableId);
					callback('', { pass: !readError && boltList.length === 5 && crossing.length === 0, detail: readError ? String(readError).slice(0, 160) : `${boltList.length} among-source edges; ${crossing.length} crossing to the hub` });
				});
			});
		},
	},
];

frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'a_writerStampsBothEndpoints', twinName: 'objectStampDropped', fileName: WRITER_FILE, find: 'SET s:\\`${applyLabel}\\`, o:\\`${applyLabel}\\` MERGE', replace: 'SET s:\\`${applyLabel}\\` MERGE' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'b_forEvidenceRoutesThroughBlindedRecordFor', twinName: 'evidenceViewUnblindedOnBolt', fileName: READER_FILE, find: "\tconst forEvidence = () => graphSeamRulesLib.closedView(makeView({ shapeRecord: (oneRecord) => graphSeamRulesLib.blindedRecordFor({ record: oneRecord, blindingDeclaration }), shapeEdge: (oneEdge) => graphSeamRulesLib.blindedEdgeFor({ edge: oneEdge, blindingDeclaration }) }));", replace: "\tconst forEvidence = () => graphSeamRulesLib.closedView(makeView({ shapeRecord: (oneRecord) => oneRecord, shapeEdge: (oneEdge) => graphSeamRulesLib.blindedEdgeFor({ edge: oneEdge, blindingDeclaration }) }));" });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'c_readSubjectNodesKeepsSourceScope', twinName: 'sourceScopeDropped', fileName: READER_FILE, find: "{ cypher: 'MATCH (n) WHERE n._source = $sourceStandardName RETURN n ORDER BY n.stableId SKIP $skip LIMIT $limit', parameters: { sourceStandardName } },", replace: "{ cypher: 'MATCH (n) RETURN n ORDER BY n.stableId SKIP $skip LIMIT $limit', parameters: { sourceStandardName } }," });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'd_writerRefusesNonHubObjectAtEndpointLookup', twinName: 'endpointRefusalSkipped', fileName: WRITER_FILE, find: '\t\t\t\tif (endpointRefusal) {', replace: '\t\t\t\tif (false && endpointRefusal) {' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'dPrime_writerRefusesStrayPropertyBeforeSession', twinName: 'shapeRefusalSkipped', fileName: WRITER_FILE, find: '\t\tif (shapeRefusal) {', replace: '\t\tif (false && shapeRefusal) {' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'e_forEvidenceEdgesBlindedOnBolt', twinName: 'evidenceEdgesRawOnBolt', fileName: READER_FILE, find: "\tconst forEvidence = () => graphSeamRulesLib.closedView(makeView({ shapeRecord: (oneRecord) => graphSeamRulesLib.blindedRecordFor({ record: oneRecord, blindingDeclaration }), shapeEdge: (oneEdge) => graphSeamRulesLib.blindedEdgeFor({ edge: oneEdge, blindingDeclaration }) }));", replace: "\tconst forEvidence = () => graphSeamRulesLib.closedView(makeView({ shapeRecord: (oneRecord) => graphSeamRulesLib.blindedRecordFor({ record: oneRecord, blindingDeclaration }), shapeEdge: (oneEdge) => oneEdge }));" });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'f_readEdgesAmongSourceScopedBothEndpoints', twinName: 'objectEndpointScopeDropped', fileName: READER_FILE, find: 'WHERE a._source = $sourceStandardName AND b._source = $sourceStandardName${typeClause}', replace: 'WHERE a._source = $sourceStandardName${typeClause}' });

const gateDeclarationList = [{ gateId: GATE_ID, title: 'bolt file ↔ graph double parity through the driver double', conjunctList }];

runGateFamily(
	{ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 7, expectedTwinCount: 7 },
	() => harness.report(),
);
