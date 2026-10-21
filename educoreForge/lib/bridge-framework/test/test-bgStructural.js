'use strict';

// test-bgStructural.js — ⟪ctdlHub-101926 P6, ruling R-3⟫ the STRUCTURAL producer shape (structuralProducerContract.js, the
// pluginRegistry's second map) and its runner (structuralRunner.js) over a three-standard TOY family (fixtures/structuralFamily:
// fama root, famb, famc). PURE: graphDouble. The real CTDL family is gated in forges/ctdl/test/test-ctdlFamilyStructure.js.
//
// CONJUNCTS
//   a  registration: { structuralDeclaration } lands in structuralEntryByName (never entryByBridgeName); an extra export, a table
//      naming one locator in BOTH lists, an absolute locatorTablePath, and a family that omits its root are refused by name
//   b  the run: a domainIncludes crossRef makes HAS_PROPERTY target→source, a rangeIncludes REFERENCES source→target; a
//      correspondence locator and an intra-standard reference make no edge; an unresolved raw makes no edge; a duplicate made by
//      a later table row keeps the earlier row's locator
//   c  blocks: one per pair WITH edges, root first then lexicographic, each with its crossSourcePair; the empty pair emits nothing
//   d  refusals at run: a locator in neither list; a recipe family that differs from the declared one; an identifier two family
//      standards both claim; a family member with no node in the graph
// RED TWIN: (b) under 'directionIgnored' (every edge written source→target) the HAS_PROPERTY edge points the wrong way.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- ctdlHub P6: the structural producer shape and runner over a toy family

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const graphDoubleLib = require('../graphDouble');
const pluginRegistryLib = require('../pluginRegistry');
const structuralProducerContractLib = require('../structuralProducerContract');
const moduleDouble = require('../../forge-framework/test/testSupport/moduleDouble');

const RUNNER_PATH = path.join(__dirname, '..', 'structuralRunner.js');
const FORGES_DIR = path.join(__dirname, 'fixtures', 'structuralFamily', 'forges');
const BUNDLE_DIR = path.join(FORGES_DIR, 'fama');
const PRODUCER_PATH = path.join(BUNDLE_DIR, 'bridges', 'famaFamilyStructure.js');
const NAME_BY_TOKEN = Object.freeze({ fama: 'FamA', famb: 'FamB', famc: 'FamC' });
const xLog = { status: () => {}, error: () => {} };

const node = (stableId, standardName, crossRefList) => ({ stableId, labels: ['ForgedNode'], properties: { stableId, uri: stableId, _source: standardName, role: 'DmeProperty', crossRefs: JSON.stringify(crossRefList || []) } });
// fama:Thing (class) has property famb:size by famb's domainIncludes; famb:size ranges over fama:Measure; famc:note is
// a domainFor of fama:Thing AND fama:Thing's own domainIncludes names it from famc's side (the duplicate); famb also states an
// owl:equivalentProperty (correspondence) and a reference to its own term (intra) and to nothing (unresolved)
const toyGraph = () => ({
	nodeList: [
		node('fama:Thing', 'FamA', [{ raw: 'famc:note', locator: 'meta:domainFor' }]),
		node('fama:Measure', 'FamA'),
		node('famb:size', 'FamB', [{ raw: 'fama:Thing', locator: 'schema:domainIncludes' }, { raw: 'fama:Measure', locator: 'schema:rangeIncludes' }, { raw: 'fama:Measure', locator: 'owl:equivalentProperty' }, { raw: 'famb:other', locator: 'schema:rangeIncludes' }, { raw: 'nowhere:atAll', locator: 'schema:rangeIncludes' }]),
		node('famb:other', 'FamB'),
		node('famc:note', 'FamC', [{ raw: 'fama:Thing', locator: 'schema:domainIncludes' }]),
		{ stableId: 'fama:card', labels: ['HubReference'], properties: { stableId: 'fama:card', _source: 'FamA', crossRefs: JSON.stringify([{ raw: 'famb:size', locator: 'schema:domainIncludes' }]) } },
	],
	edgeList: [],
});
const runToy = ({ graph, runnerLib = require(RUNNER_PATH), registry, config }, callback) => {
	const graphDouble = graphDoubleLib.graphDoubleFrom(graph);
	runnerLib.structuralRunnerFactory({ familyReaderFactory: graphDouble.familyReaderFactory, structuralWriterFactory: graphDouble.structuralWriterFactory, pluginRegistry: registry, xLog })
		.run({ inGraph: { graphName: 'DEV_structuralToy' }, bridge: 'famaFamilyStructure', source: 'fama', applyLabel: 'BridgedRelation', config: config || { familyStandards: ['fama', 'famb', 'famc'], familyStandardNameByToken: NAME_BY_TOKEN } }, (runError, runReport) => callback({ runError: String(runError || ''), runReport, graphDouble }));
};
const writtenTextList = (outcome) => outcome.graphDouble.state.writtenEdgeList.map((oneEdge) => `${oneEdge.type} ${oneEdge.fromStableId} ${oneEdge.toStableId} ${oneEdge.properties.crossRefLocator}`).sort();
const EXPECTED_WRITTEN = Object.freeze([
	'HAS_PROPERTY fama:Thing famb:size schema:domainIncludes',
	'HAS_PROPERTY fama:Thing famc:note schema:domainIncludes',
	'REFERENCES famb:size fama:Measure schema:rangeIncludes',
]);
const judgeRun = (outcome) => ({ pass: outcome.runError === '' && JSON.stringify(writtenTextList(outcome)) === JSON.stringify(EXPECTED_WRITTEN), detail: `${outcome.runError} ${JSON.stringify(outcome.runError ? [] : writtenTextList(outcome))}` });

const registry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: FORGES_DIR });
harness.section('a — registration');
harness.ok('a: the producer lands in structuralEntryByName and not in entryByBridgeName', registry.structuralEntryByName.famaFamilyStructure !== undefined && registry.entryByBridgeName.famaFamilyStructure === undefined);
const loaded = require(PRODUCER_PATH);
const registerWith = (producerModule) => pluginRegistryLib.registerStructuralProducer({ producerModule, producerFilePath: PRODUCER_PATH, bundleDirPath: BUNDLE_DIR });
harness.match('a: an extra export is refused by name', String((registerWith({ ...loaded, bridgeHooks: {} }).error || {}).message), /exports \[structuralDeclaration, bridgeHooks\], not exactly \{ structuralDeclaration \}/);
harness.match('a: an absolute locatorTablePath is refused by name', String((registerWith({ structuralDeclaration: { ...loaded.structuralDeclaration, locatorTablePath: '/tmp/x.json' } }).error || {}).message), /must be a path relative to the bundle/);
harness.match('a: a family without the bundle as its root is refused by name', String((registerWith({ structuralDeclaration: { ...loaded.structuralDeclaration, familyRootStandardKey: 'famb' } }).error || {}).message), /familyRootStandardKey 'famb'/);
harness.match('a: a locator in BOTH lists is refused by name', structuralProducerContractLib.locatorTableRefusal({ structureLocatorList: [{ locator: 'schema:domainIncludes', edgeType: 'HAS_PROPERTY', direction: 'targetToSource' }], correspondenceLocatorList: ['schema:domainIncludes'] }), /is in BOTH lists/);

harness.section('b, c — the run');
runToy({ graph: toyGraph(), registry }, (outcome) => {
	const verdict = judgeRun(outcome);
	harness.ok('b: the three toy edges, each in its direction, the earlier table row\'s locator standing on the duplicate', verdict.pass, verdict.detail);
	const blockList = outcome.runError ? [] : outcome.runReport.blocks;
	harness.equal('c: one block per pair WITH edges, root first then lexicographic (famb::famc has none and emits nothing)', JSON.stringify(blockList.map((oneBlock) => [`${oneBlock.firstStandard}::${oneBlock.secondStandard}`, oneBlock.crossSourcePair.pairA, oneBlock.crossSourcePair.pairB])), JSON.stringify([['fama::famb', 'FamA', 'FamB'], ['fama::famc', 'FamA', 'FamC']]));
	harness.ok('c: the hub-layer node is no family record (its crossRef made no edge)', outcome.runError === '' && !writtenTextList(outcome).some((oneText) => /fama:card/.test(oneText)));
	harness.section('d — refusals at run');
	const neitherGraph = toyGraph();
	neitherGraph.nodeList[1].properties.crossRefs = JSON.stringify([{ raw: 'famb:size', locator: 'rdfs:seeAlso' }]);
	runToy({ graph: neitherGraph, registry }, (neitherOutcome) => {
		harness.match('d: a locator in neither list refuses the run by name', neitherOutcome.runError, /carries locator 'rdfs:seeAlso', which the family locator table lists as neither structure nor correspondence/);
		runToy({ graph: toyGraph(), registry, config: { familyStandards: ['fama', 'famb'], familyStandardNameByToken: NAME_BY_TOKEN } }, (partialOutcome) => {
			harness.match('d: a recipe family that differs from the declared one is refused by name', partialOutcome.runError, /are not the producer's family/);
			const collisionGraph = toyGraph();
			collisionGraph.nodeList.push(node('famb:sameIri', 'FamB'));
			collisionGraph.nodeList[collisionGraph.nodeList.length - 1].properties.uri = 'fama:Measure';
			runToy({ graph: collisionGraph, registry }, (collisionOutcome) => {
				harness.match('d: an identifier claimed by two family standards is refused by name', collisionOutcome.runError, /identifier 'fama:Measure' is claimed by two family standards/);
				const missingGraph = toyGraph();
				missingGraph.nodeList = missingGraph.nodeList.filter((oneNode) => oneNode.properties._source !== 'FamC');
				runToy({ graph: missingGraph, registry }, (missingOutcome) => {
					harness.match('d: a family member with no node in the graph is refused by name', missingOutcome.runError, /holds no 'FamC' node/);
					harness.section('THE TWIN SWEEP');
					const twinLib = moduleDouble.loadWithMutations({ modulePath: RUNNER_PATH, mutationList: [{ modulePath: RUNNER_PATH, find: "const [fromStableId, toStableId] = structureRow.direction === 'targetToSource' ? [oneCrossRef.raw, oneRecord.stableId] : [oneRecord.stableId, oneCrossRef.raw];", replace: 'const [fromStableId, toStableId] = [oneRecord.stableId, oneCrossRef.raw];' }] });
					runToy({ graph: toyGraph(), registry, runnerLib: twinLib }, (twinOutcome) => {
						const twinVerdict = judgeRun(twinOutcome);
						harness.ok("(b) observed RED under 'directionIgnored'", !twinVerdict.pass, twinVerdict.detail);
						harness.note(`RED-OBSERVED b twin='directionIgnored' → ${twinVerdict.detail.slice(0, 240)}`);
						harness.report();
					});
				});
			});
		});
	});
});
