'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forge-census-gate.js — the forgeCensus BuildAttestation row (campaign P2, W-C-21, PLAN G6: the code-list check, specified).
//
// The forge COUNTS what it mints — the contract-graph kit's stats.nodeCountByRole and stats.edgeCountByType, computed from
// the source walk — and until P2 those counts were discarded by the forger. This gate compares them with the materialised
// graph, per standard: every role the kit counted must have exactly that many content nodes of the standard, and every
// edge type it counted exactly that many edges between two of the standard's nodes. Option sets and option values are
// roles, so a lost code list or code value fails the row by name. Nodes minted OUTSIDE the kit (hub cards and the hub
// definition, by the hub framework) are outside the census by label. ⟪campaign P3, R2 finding⟫ DmeEmbedText is NOT: the
// embed-text derivation mints its nodes through kit.makeNode (embedTextDerivation.js), so the kit counts them and the graph
// census must too — excluding them read 'forged 6684, graph 0' for every standard on the first live measurement.
//
// ⟪campaign P4a, PLAN G5/G6⟫ the row also carries the two verdict checks of graph-structure-check.js, run in the same READ
// session after the census: instanceStructure (every SIF Field / PESC occurrence has one declaration and one owner) and
// codeListStructure (every option value has one owning set of its standard; counts per standard). Either failing fails the
// row by name. ⟪forgeClean lane CLEAN, R2, 2026-10-08⟫ rootOwnership joins them, a verdict now: every -build fails BY NAME
// on a content node its standard's root does not reach (the orphans' stableIds in the detail). The source-census half of
// codeListStructure is compared by tools/graphStructureCheck.js, which reads the
// graph's StandardDefinitions; here the census map is {} and the detail says no standard was compared to one.
//
// A -replay forges nothing, so it has no expectation: notRun, said so. A forge result carrying no stats is notRun naming
// the standard (a double, or a bundle outside the framework) — never pass.
//
//   forgeCensusRowFor({ expectationList, liveByStandardName, structureCheckRowList }) → the row (pure)
//   runForgeCensusGate({ containerHandle, forgeCensusSpec }, callback(err, row))
//     forgeCensusSpec: null (a replay) | { expectationList: [{ standardName, nodeCountByRole, edgeCountByType }] }
//
// Async style: callback(errString, result). No async/await, no try/catch-for-control-flow.

const neo4j = require('neo4j-driver');
const path = require('path');
const vocabulary = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const graphStructureCheck = require(path.join(__dirname, 'graph-structure-check'));

const GATE_NAME = 'forgeCensus';
const STRUCTURE_CHECK_NAME_LIST = Object.freeze(['instanceStructure', 'codeListStructure', 'rootOwnership']);
const OUTSIDE_THE_KIT_LABEL_LIST = Object.freeze(['HubReference', 'HubDefinition']);
const NODE_CENSUS_CYPHER = `
	MATCH (n:ForgedNode) WHERE n._source = $standardName AND ${OUTSIDE_THE_KIT_LABEL_LIST.map((oneLabel) => `NOT n:\`${oneLabel}\``).join(' AND ')}
	RETURN n.role AS role, count(n) AS nodeCount`;
const EDGE_CENSUS_CYPHER = `
	MATCH (a:ForgedNode)-[e]->(b:ForgedNode) WHERE a._source = $standardName AND b._source = $standardName AND type(e) IN $edgeTypeList
	RETURN type(e) AS edgeType, count(e) AS edgeCount`;

const mismatchListFor = ({ expectedByName, liveByName, kindText }) =>
	Object.keys(expectedByName).sort().filter((oneName) => Number(liveByName[oneName] || 0) !== Number(expectedByName[oneName])).map((oneName) => `${kindText} ${oneName}: forged ${expectedByName[oneName]}, graph ${Number(liveByName[oneName] || 0)}`);

const forgeCensusRowFor = ({ expectationList, liveByStandardName, structureCheckRowList }) => {
	if (!Array.isArray(structureCheckRowList)) {
		throw new Error(`${moduleName}.forgeCensusRowFor: structureCheckRowList is REQUIRED — [] when no structure check ran; an absent list would read as a pass`);
	}
	const statlessList = expectationList.filter((oneExpectation) => !oneExpectation.nodeCountByRole || !oneExpectation.edgeCountByType).map((oneExpectation) => oneExpectation.standardName);
	if (statlessList.length) {
		return { gate: GATE_NAME, verdict: vocabulary.BUILD_ATTESTATION_VERDICT.NOT_RUN, detail: `the forge reported no kit stats for ${statlessList.join(', ')}, so nothing could be compared` };
	}
	const failureList = expectationList.reduce((soFar, oneExpectation) => {
		const live = liveByStandardName[oneExpectation.standardName] || { nodeCountByRole: {}, edgeCountByType: {} };
		const mismatchList = mismatchListFor({ expectedByName: oneExpectation.nodeCountByRole, liveByName: live.nodeCountByRole, kindText: 'role' }).concat(mismatchListFor({ expectedByName: oneExpectation.edgeCountByType, liveByName: live.edgeCountByType, kindText: 'edge' }));
		return mismatchList.length ? soFar.concat([`${oneExpectation.standardName}: ${mismatchList.slice(0, 5).join('; ')}${mismatchList.length > 5 ? `; +${mismatchList.length - 5} more` : ''}`]) : soFar;
	}, []);
	const failedStructureRowList = structureCheckRowList.filter((oneRow) => oneRow.verdict !== vocabulary.BUILD_ATTESTATION_VERDICT.PASS);
	const censusText = failureList.length === 0 ? `${expectationList.length} standard(s): every role and edge type the forge counted is in the graph at that count` : `FAILED — ${failureList.join(' | ')}`;
	const structureText = structureCheckRowList.map((oneRow) => ` || ${oneRow.checkName} ${oneRow.verdict}: ${oneRow.detail}`).join('');
	return {
		gate: GATE_NAME,
		verdict: failureList.length === 0 && failedStructureRowList.length === 0 ? vocabulary.BUILD_ATTESTATION_VERDICT.PASS : vocabulary.BUILD_ATTESTATION_VERDICT.FAIL,
		detail: `${censusText}${structureText}`,
	};
};

const runForgeCensusGate = ({ containerHandle, forgeCensusSpec } = {}, callback) => {
	if (forgeCensusSpec === null) {
		callback('', { gate: GATE_NAME, verdict: vocabulary.BUILD_ATTESTATION_VERDICT.NOT_RUN, detail: 'replay: no forge ran in this materialize, so there are no forge counts to compare' });
		return;
	}
	if (!forgeCensusSpec || !Array.isArray(forgeCensusSpec.expectationList)) {
		callback(`${moduleName}: forgeCensusSpec is REQUIRED — null for a replay, or { expectationList } from the build's forges`);
		return;
	}
	const statlessRow = forgeCensusRowFor({ expectationList: forgeCensusSpec.expectationList.filter((oneExpectation) => !oneExpectation.nodeCountByRole || !oneExpectation.edgeCountByType), liveByStandardName: {}, structureCheckRowList: [] });
	if (statlessRow.verdict === vocabulary.BUILD_ATTESTATION_VERDICT.NOT_RUN) {
		callback('', statlessRow);
		return;
	}
	if (!containerHandle || !containerHandle.boltUrl || !containerHandle.password) {
		callback(`${moduleName}: the container handle carries no boltUrl/password — the census reads the materialised graph`);
		return;
	}
	const driver = neo4j.driver(containerHandle.boltUrl, neo4j.auth.basic('neo4j', containerHandle.password), { encrypted: false });
	const session = driver.session({ defaultAccessMode: neo4j.session.READ });
	const closeAll = () => session.close().then(() => driver.close(), () => driver.close());
	const liveByStandardName = {};
	const censusNext = (expectationIndex) => {
		if (expectationIndex >= forgeCensusSpec.expectationList.length) {
			graphStructureCheck.runGraphStructureCheck({ session, checkNameList: STRUCTURE_CHECK_NAME_LIST, sourceCodeListCensusByStandard: {} }, (structureError, structureCheckRowList) => {
				closeAll();
				if (structureError) {
					callback(`${moduleName}: the structure checks failed to run: ${structureError}`);
					return;
				}
				callback('', forgeCensusRowFor({ expectationList: forgeCensusSpec.expectationList, liveByStandardName, structureCheckRowList }));
			});
			return;
		}
		const oneExpectation = forgeCensusSpec.expectationList[expectationIndex];
		session.run(NODE_CENSUS_CYPHER, { standardName: oneExpectation.standardName }).then(
			(nodeResult) =>
				session.run(EDGE_CENSUS_CYPHER, { standardName: oneExpectation.standardName, edgeTypeList: Object.keys(oneExpectation.edgeCountByType) }).then(
					(edgeResult) => {
						liveByStandardName[oneExpectation.standardName] = {
							nodeCountByRole: nodeResult.records.reduce((soFar, oneRecord) => ({ ...soFar, [oneRecord.get('role')]: oneRecord.get('nodeCount').toNumber() }), {}),
							edgeCountByType: edgeResult.records.reduce((soFar, oneRecord) => ({ ...soFar, [oneRecord.get('edgeType')]: oneRecord.get('edgeCount').toNumber() }), {}),
						};
						censusNext(expectationIndex + 1);
					},
					(edgeError) => {
						closeAll();
						callback(`${moduleName}: the edge census for ${oneExpectation.standardName} failed: ${edgeError.message}`);
					},
				),
			(nodeError) => {
				closeAll();
				callback(`${moduleName}: the node census for ${oneExpectation.standardName} failed: ${nodeError.message}`);
			},
		);
	};
	censusNext(0);
};

module.exports = { GATE_NAME, STRUCTURE_CHECK_NAME_LIST, NODE_CENSUS_CYPHER, EDGE_CENSUS_CYPHER, OUTSIDE_THE_KIT_LABEL_LIST, forgeCensusRowFor, runForgeCensusGate, moduleName };
