#!/usr/bin/env node
'use strict';

// test-ctdlFamilyStructure.js — ⟪ctdlHub-101926 P6 step 5; rulings R-3, R-4⟫ the CTDL family-structure producer (ctdlFamilyStructure,
// run by lib/bridge-framework/structuralRunner.js) over the THREE REAL snapshots, forged in process, through the graph double —
// gated EDGE FOR EDGE against the July oracle (fixtures/julyOracleFamilyEdges.json, P0's census) plus the ruled allowance
// (fixtures/familyStructureAllowance.json, the 46 skos: edges, R-4).
//
// CONJUNCTS
//   a  per pair, the written (type, from, to) set = oracle ∪ allowance, exactly: missing 0, extra 0 outside the allowance;
//      CTDL::CTDLASN 311 + 36, CTDL::CTDLQData 178 + 0, CTDLASN::CTDLQData 17 + 10
//   b  on every oracle edge the properties differ from July's ONLY by the A3 renames: provenanceSource 'uriBridge' →
//      'ctdlFamilyStructure', owner ':golden' absent; provenanceTier, bridgeAuthored, crossRefLocator identical
//   c  no edge is intra-standard and none duplicates a forge-emitted edge (same type, same endpoints)
//   d  the pair harvest takes exactly the written edges; a LABEL harvest over the same endpoints would also take native edges
//      of the same types from inside one standard (the reason crossSourcePair exists; SCARLET_ARROW's twin (b))
//   e  a locator in neither list of the table refuses the run by name
//   f  three blocks, root first then lexicographic, each with its crossSourcePair and harvestEdgeTypeList
// RED TWINS: (a) under 'tableDropsTargetScheme' the HAS_OPTION_SET oracle edge goes missing; (b) under 'readOrderPrecedence' (the
// first emission stands, as in July, instead of the earlier table row) 85 oracle edges change crossRefLocator from
// schema:domainIncludes to meta:domainFor (measured 2026-10-21) — which is why the earlier-row rule exists.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- ctdlHub P6: the CTDL family structure against the July oracle (plus the ruled allowance)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const FORGES_DIR = path.join(TREE_ROOT, 'forges');
const graphDoubleLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'graphDouble'));
const pluginRegistryLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'pluginRegistry'));
const moduleDouble = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const RUNNER_PATH = path.join(TREE_ROOT, 'lib', 'bridge-framework', 'structuralRunner.js');
const ORACLE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'julyOracleFamilyEdges.json'), 'utf8'));
const ALLOWANCE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'familyStructureAllowance.json'), 'utf8'));
const FAMILY_SPEC_LIST = Object.freeze([
	{ token: 'ctdl', entryFileName: 'forgeCtdl', sourceFileName: 'ctdl-schema.json', standardName: 'CTDL' },
	{ token: 'ctdlasn', entryFileName: 'forgeCtdlasn', sourceFileName: 'ctdlasn.json', standardName: 'CTDLASN' },
	{ token: 'ctdlqdata', entryFileName: 'forgeCtdlqdata', sourceFileName: 'qdata.json', standardName: 'CTDLQData' },
]);
const PAIR_NAME_BY_TOKEN_PAIR = Object.freeze({ 'ctdl::ctdlasn': 'CTDL::CTDLASN', 'ctdl::ctdlqdata': 'CTDL::CTDLQData', 'ctdlasn::ctdlqdata': 'CTDLASN::CTDLQData' });
const xLog = { status: () => {}, error: (text) => process.stderr.write(`${text}\n`) };

const forgeAll = (specIndex, forgedList, callback) => {
	if (specIndex >= FAMILY_SPEC_LIST.length) {
		callback('', forgedList);
		return;
	}
	const oneSpec = FAMILY_SPEC_LIST[specIndex];
	require(path.join(FORGES_DIR, oneSpec.token, oneSpec.entryFileName))({ embedder: null }).forge({ sourcePath: path.join(FORGES_DIR, oneSpec.token, 'assets', 'standardSourceData', '01', oneSpec.sourceFileName), owner: moduleName, skipEmbedding: true }, (forgeError, forged) => (forgeError ? callback(`${oneSpec.token}: ${forgeError}`) : forgeAll(specIndex + 1, forgedList.concat([forged]), callback)));
};
const doubleGraphOf = (forgedList) => ({
	nodeList: forgedList.reduce((soFar, forged) => soFar.concat(forged.nodes.map((oneNode) => ({ stableId: oneNode.stableId, labels: oneNode.labels.slice(), properties: { ...oneNode.properties, stableId: oneNode.stableId } }))), []),
	edgeList: forgedList.reduce((soFar, forged) => soFar.concat(forged.edges.map((oneEdge) => ({ fromStableId: oneEdge.fromRef.id, toStableId: oneEdge.toRef.id, type: oneEdge.type, properties: { ...(oneEdge.properties || {}) } }))), []),
});
const runProducer = ({ graph, runnerLib, registry }, callback) => {
	const graphDouble = graphDoubleLib.graphDoubleFrom(graph);
	const runner = runnerLib.structuralRunnerFactory({ familyReaderFactory: graphDouble.familyReaderFactory, structuralWriterFactory: graphDouble.structuralWriterFactory, pluginRegistry: registry, xLog });
	runner.run({ inGraph: { graphName: 'DEV_familyStructureDouble' }, bridge: 'ctdlFamilyStructure', source: 'ctdl', applyLabel: 'BridgedRelation', config: { familyStandards: ['ctdl', 'ctdlasn', 'ctdlqdata'], familyStandardNameByToken: { ctdl: 'CTDL', ctdlasn: 'CTDLASN', ctdlqdata: 'CTDLQData' } } }, (runError, runReport) => callback({ runError, runReport, graphDouble }));
};
const identityOf = (oneEdge) => `${oneEdge.type} ${oneEdge.fromStableId || oneEdge.from} ${oneEdge.toStableId || oneEdge.to}`;
const writtenByPairOf = (outcome) => {
	const sourceByStableId = outcome.graphDouble.state.nodeList.reduce((soFar, oneNode) => ({ ...soFar, [oneNode.stableId]: oneNode.properties._source }), {});
	return outcome.graphDouble.state.writtenEdgeList.reduce((soFar, oneEdge) => {
		const sourcePair = [sourceByStableId[oneEdge.fromStableId], sourceByStableId[oneEdge.toStableId]];
		const pairName = Object.keys(ORACLE.edgeListByPair).find((onePairName) => onePairName.split('::').slice().sort().join('|') === sourcePair.slice().sort().join('|'));
		return { ...soFar, [pairName]: (soFar[pairName] || []).concat([oneEdge]) };
	}, {});
};
const judgeOracleSets = (outcome) => {
	if (outcome.runError) {
		return { pass: false, detail: String(outcome.runError) };
	}
	const writtenByPair = writtenByPairOf(outcome);
	const lineList = Object.keys(ORACLE.edgeListByPair).map((onePairName) => {
		const oracleSet = new Set(ORACLE.edgeListByPair[onePairName].map(identityOf));
		const allowedSet = new Set(ALLOWANCE.edgeListByPair[onePairName].map(identityOf));
		const writtenSet = new Set((writtenByPair[onePairName] || []).map(identityOf));
		const missingList = Array.from(oracleSet).filter((oneIdentity) => !writtenSet.has(oneIdentity));
		const unallowedList = Array.from(writtenSet).filter((oneIdentity) => !oracleSet.has(oneIdentity) && !allowedSet.has(oneIdentity));
		const allowanceUnusedList = Array.from(allowedSet).filter((oneIdentity) => !writtenSet.has(oneIdentity));
		return { onePairName, ok: missingList.length === 0 && unallowedList.length === 0 && allowanceUnusedList.length === 0, text: `${onePairName}: written ${writtenSet.size} = oracle ${oracleSet.size} + allowance ${allowedSet.size}? missing ${missingList.length}${missingList.length ? ` (${missingList.slice(0, 2).join('; ')})` : ''}, extra outside allowance ${unallowedList.length}${unallowedList.length ? ` (${unallowedList.slice(0, 2).join('; ')})` : ''}, allowance not written ${allowanceUnusedList.length}` };
	});
	return { pass: lineList.every((oneLine) => oneLine.ok), detail: lineList.map((oneLine) => oneLine.text).join(' | ') };
};
const judgePropertyRenames = (outcome) => {
	if (outcome.runError) {
		return { pass: false, detail: String(outcome.runError) };
	}
	const writtenByIdentity = outcome.graphDouble.state.writtenEdgeList.reduce((soFar, oneEdge) => ({ ...soFar, [identityOf(oneEdge)]: oneEdge }), {});
	const differenceCountByKind = {};
	Object.keys(ORACLE.edgeListByPair).forEach((onePairName) => ORACLE.edgeListByPair[onePairName].forEach((oracleEdge) => {
		const written = writtenByIdentity[identityOf(oracleEdge)];
		if (written === undefined) {
			differenceCountByKind['edge missing'] = (differenceCountByKind['edge missing'] || 0) + 1;
			return;
		}
		Array.from(new Set(Object.keys(oracleEdge.properties).concat(Object.keys(written.properties)))).sort().forEach((oneName) => {
			if (JSON.stringify(oracleEdge.properties[oneName]) !== JSON.stringify(written.properties[oneName])) {
				const kind = `${oneName}: ${JSON.stringify(oracleEdge.properties[oneName])} → ${JSON.stringify(written.properties[oneName])}`;
				differenceCountByKind[kind] = (differenceCountByKind[kind] || 0) + 1;
			}
		});
	}));
	const oracleTotal = Object.keys(ORACLE.edgeListByPair).reduce((soFar, onePairName) => soFar + ORACLE.edgeListByPair[onePairName].length, 0);
	const expected = { 'owner: ":golden" → undefined': oracleTotal, 'provenanceSource: "uriBridge" → "ctdlFamilyStructure"': oracleTotal };
	return { pass: JSON.stringify(Object.keys(differenceCountByKind).sort().reduce((soFar, oneKind) => ({ ...soFar, [oneKind]: differenceCountByKind[oneKind] }), {})) === JSON.stringify(expected), detail: `differences ${JSON.stringify(differenceCountByKind)}; ruled ${JSON.stringify(expected)}` };
};

forgeAll(0, [], (forgeError, forgedList) => {
	harness.accepts('the three real CTDL-family snapshots forge', forgeError ? [forgeError] : []);
	if (forgeError) {
		harness.report();
		return;
	}
	const graph = doubleGraphOf(forgedList);
	const registry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: FORGES_DIR });
	runProducer({ graph, runnerLib: require(RUNNER_PATH), registry }, (outcome) => {
		harness.section('BASELINE');
		const verdictA = judgeOracleSets(outcome);
		harness.ok('a_familyEdgesEqualOracleUnionAllowance PASS', verdictA.pass, verdictA.detail);
		harness.note(`MEASURED ${verdictA.detail}`);
		const verdictB = judgePropertyRenames(outcome);
		harness.ok('b_propertiesDifferOnlyByTheA3Renames PASS', verdictB.pass, verdictB.detail);
		harness.note(`MEASURED ${verdictB.detail}`);
		const forgeEdgeIdentitySet = new Set(graph.edgeList.map(identityOf));
		const sourceByStableId = graph.nodeList.reduce((soFar, oneNode) => ({ ...soFar, [oneNode.stableId]: oneNode.properties._source }), {});
		const writtenList = outcome.runError ? [] : outcome.graphDouble.state.writtenEdgeList;
		const intraList = writtenList.filter((oneEdge) => sourceByStableId[oneEdge.fromStableId] === sourceByStableId[oneEdge.toStableId]);
		const duplicateList = writtenList.filter((oneEdge) => forgeEdgeIdentitySet.has(identityOf(oneEdge)));
		harness.ok('c_noIntraStandardEdgeAndNoForgeDuplicate PASS', writtenList.length > 0 && intraList.length === 0 && duplicateList.length === 0, `written ${writtenList.length}; intra-standard ${intraList.length}; duplicating a forge edge (type+endpoints) ${duplicateList.length}`);
		// d — the pair harvest vs a label harvest over the same endpoints
		const blockList = outcome.runError ? [] : outcome.runReport.blocks;
		const harvestLineList = blockList.map((oneBlock) => {
			const pairHarvest = outcome.graphDouble.harvestByCrossSourcePair(oneBlock.crossSourcePair);
			const writtenForPair = writtenList.filter((oneEdge) => [oneBlock.crossSourcePair.pairA, oneBlock.crossSourcePair.pairB].indexOf(sourceByStableId[oneEdge.fromStableId]) !== -1 && [oneBlock.crossSourcePair.pairA, oneBlock.crossSourcePair.pairB].indexOf(sourceByStableId[oneEdge.toStableId]) !== -1);
			const pairExact = JSON.stringify(pairHarvest.edgeList.map(identityOf).sort()) === JSON.stringify(writtenForPair.map(identityOf).sort()) && pairHarvest.nodeList.length === 0;
			// the label a label-scoped harvest would select: stamped on every endpoint of the pair's written edges
			const endpointSet = new Set(writtenForPair.reduce((soFar, oneEdge) => soFar.concat([oneEdge.fromStableId, oneEdge.toStableId]), []));
			outcome.graphDouble.state.nodeList.forEach((oneNode) => {
				if (endpointSet.has(oneNode.stableId) && oneNode.labels.indexOf(oneBlock.applyLabel) === -1) {
					oneNode.labels.push(oneBlock.applyLabel);
				}
			});
			const labelHarvest = outcome.graphDouble.harvestByLabel({ applyLabel: oneBlock.applyLabel, edgeTypeList: oneBlock.harvestEdgeTypeList });
			const sweptNativeList = labelHarvest.edgeList.filter((oneEdge) => sourceByStableId[oneEdge.fromStableId] === sourceByStableId[oneEdge.toStableId]);
			return { pairExact, sweptNativeCount: sweptNativeList.length, text: `${oneBlock.firstStandard}::${oneBlock.secondStandard}: pair harvest ${pairHarvest.edgeList.length} edge(s) = written ${writtenForPair.length}: ${pairExact}; a label harvest would take ${labelHarvest.edgeList.length}, of them ${sweptNativeList.length} NATIVE intra-standard edge(s)` };
		});
		harness.ok('d_pairHarvestIsExactlyTheWrittenEdges PASS', harvestLineList.length === 3 && harvestLineList.every((oneLine) => oneLine.pairExact), harvestLineList.map((oneLine) => oneLine.text).join(' | '));
		harness.ok("d_labelHarvestWouldSweepNativeEdges (twin (b): the label path observed RED where the pair path is green)", harvestLineList.some((oneLine) => oneLine.sweptNativeCount > 0), harvestLineList.map((oneLine) => oneLine.text).join(' | '));
		harness.note(`MEASURED ${harvestLineList.map((oneLine) => oneLine.text).join(' | ')}`);
		harness.ok('f_threeBlocksRootFirst PASS', JSON.stringify(blockList.map((oneBlock) => `${oneBlock.firstStandard}::${oneBlock.secondStandard}`)) === JSON.stringify(['ctdl::ctdlasn', 'ctdl::ctdlqdata', 'ctdlasn::ctdlqdata']) && blockList.every((oneBlock) => oneBlock.producer === 'structural' && oneBlock.decisionBlock === null && oneBlock.crossSourcePair && Array.isArray(oneBlock.harvestEdgeTypeList) && oneBlock.harvestEdgeTypeList.length > 0), JSON.stringify(blockList.map((oneBlock) => ({ pair: `${oneBlock.firstStandard}::${oneBlock.secondStandard}`, crossSourcePair: oneBlock.crossSourcePair, types: oneBlock.harvestEdgeTypeList }))));
		// e — a locator in neither list: the table read with meta:domainFor removed from both lists, through a scratch bundle copy
		const scratchForgesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'familyStructureScratch-'));
		const copyDir = (fromDir, toDir) => {
			fs.mkdirSync(toDir, { recursive: true });
			fs.readdirSync(fromDir, { withFileTypes: true }).forEach((oneEntry) => (oneEntry.isDirectory() ? copyDir(path.join(fromDir, oneEntry.name), path.join(toDir, oneEntry.name)) : fs.copyFileSync(path.join(fromDir, oneEntry.name), path.join(toDir, oneEntry.name))));
		};
		copyDir(path.join(FORGES_DIR, 'ctdl', 'bridges'), path.join(scratchForgesDir, 'ctdl', 'bridges'));
		copyDir(path.join(FORGES_DIR, 'ctdl', 'bridgeData'), path.join(scratchForgesDir, 'ctdl', 'bridgeData'));
		const scratchTablePath = path.join(scratchForgesDir, 'ctdl', 'bridgeData', 'ctdlFamilyLocatorTable.json');
		const tableWithoutDomainFor = JSON.parse(fs.readFileSync(scratchTablePath, 'utf8'));
		tableWithoutDomainFor.structureLocatorList = tableWithoutDomainFor.structureLocatorList.filter((oneRow) => oneRow.locator !== 'meta:domainFor');
		fs.writeFileSync(scratchTablePath, JSON.stringify(tableWithoutDomainFor));
		fs.rmSync(path.join(scratchForgesDir, 'ctdl', 'bridges', 'ctdlCedsDeclaredCorrespondence.js'));
		const scratchRegistry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: scratchForgesDir });
		runProducer({ graph, runnerLib: require(RUNNER_PATH), registry: scratchRegistry }, (refusalOutcome) => {
			harness.match('e_locatorInNeitherListRefusedByName PASS', String(refusalOutcome.runError || ''), /carries locator 'meta:domainFor', which the family locator table lists as neither structure nor correspondence/);
			harness.section('THE TWIN SWEEP');
			const tableWithoutTargetScheme = JSON.parse(fs.readFileSync(path.join(FORGES_DIR, 'ctdl', 'bridgeData', 'ctdlFamilyLocatorTable.json'), 'utf8'));
			tableWithoutTargetScheme.structureLocatorList = tableWithoutTargetScheme.structureLocatorList.filter((oneRow) => oneRow.locator !== 'meta:targetScheme');
			tableWithoutTargetScheme.correspondenceLocatorList = tableWithoutTargetScheme.correspondenceLocatorList.concat(['meta:targetScheme']);
			fs.writeFileSync(scratchTablePath, JSON.stringify(tableWithoutTargetScheme));
			runProducer({ graph, runnerLib: require(RUNNER_PATH), registry: pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: scratchForgesDir }) }, (tableTwin) => {
				const twinVerdict = judgeOracleSets(tableTwin);
				harness.ok("(a) observed RED under 'tableDropsTargetScheme'", !twinVerdict.pass, twinVerdict.detail);
				harness.note(`RED-OBSERVED a twin='tableDropsTargetScheme' → ${twinVerdict.detail.slice(0, 260)}`);
				const precedenceTwinLib = moduleDouble.loadWithMutations({ modulePath: RUNNER_PATH, mutationList: [{ modulePath: RUNNER_PATH, find: '				if (structureRow.rowIndex >= standing.rowIndex) {', replace: '				if (true) {' }] });
				runProducer({ graph, runnerLib: precedenceTwinLib, registry }, (precedenceTwin) => {
					const precedenceVerdict = judgePropertyRenames(precedenceTwin);
					harness.ok("(b) observed RED under 'readOrderPrecedence' (July's first-emission rule with meta:domainFor in the table)", !precedenceVerdict.pass, precedenceVerdict.detail);
					harness.note(`RED-OBSERVED b twin='readOrderPrecedence' → ${precedenceVerdict.detail.slice(0, 300)}`);
					fs.rmSync(scratchForgesDir, { recursive: true, force: true });
					harness.report();
				});
			});
		});
	});
});
