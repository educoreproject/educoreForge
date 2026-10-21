'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// structuralRunner.js — ⟪ctdlHub-101926 P6, ruling R-3⟫ runs a STRUCTURAL producer (structuralProducerContract.js): the July
// ctdlFamilyStructure algorithm, moved out of the forge layer into the bridge layer and made generic, its family and its locator
// table the producer's DATA. bridgeMaker dispatches here when the recipe's bridge names a registered structural producer; the
// bridge framework never sees one.
//
// THE ALGORITHM (code fact of the attic module, kept, with the ruled changes marked):
//   1. Read the family's base records (familyReader). Identity universe: every record's stableId and uri → its standard. Two
//      standards claiming one identifier is refused by name (July reported it and let the first stand; a guess is not a join).
//   2. Every crossRef of every record: its locator is looked up in the ONE locator table. A CORRESPONDENCE locator is not this
//      producer's (the declared bridges write it) and is counted; a locator in NEITHER list refuses the run by name ⟪ruled P6⟫.
//      A STRUCTURE locator resolves its raw target in the identity universe: unresolved → counted; same standard → counted
//      (intra-standard structure is the forge's); otherwise one edge of the row's type, in the row's direction, in the pair
//      ordered root first then lexicographically by token (S11).
//   3. Dedupe on (type, from, to). ⟪ruled P6⟫ When two locators make the same edge, the one EARLIER in the table's structure list
//      stands (deterministic and independent of read order); July let the first emission stand.
//   4. One block per pair WITH edges, written through a structuralWriter for that pair and reported in blocks[] with its
//      crossSourcePair (the _source names), so build.js harvests it by the engine's pair selector, never by label. A pair with
//      no edges emits NOTHING and is reported (R2-7).
// Edge properties: provenanceTier 'structural', provenanceSource <producerName> (July: 'uriBridge'), bridgeAuthored true,
// crossRefLocator <the standing locator>.
//
//   structuralRunnerFactory({ familyReaderFactory, structuralWriterFactory, pluginRegistry, xLog }) → { run(spec, cb) }
//   spec = { inGraph, bridge, source, applyLabel, config: { familyStandards, familyStandardNameByToken, ... } }

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const pluginRegistryLib = require('./pluginRegistry');

const STRUCTURAL_PRODUCER_KIND = 'structural';
const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const compareStrings = (leftValue, rightValue) => (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0);

// crossRefListOf — the carried crossRefs are a JSON STRING on a forged node. JSON.parse throws on malformed text; the throw is
// translated ONCE, here, into { error } (the boundary dispensation the plugin files take), never control flow.
const crossRefListOf = (oneRecord) => {
	const rawText = oneRecord.properties.crossRefs;
	if (rawText === undefined || rawText === null) {
		return { crossRefList: [] };
	}
	let parsed = null;
	let parseFault = '';
	try {
		parsed = JSON.parse(rawText);
	} catch (parseError) {
		parseFault = parseError.message;
	}
	if (parseFault !== '' || !Array.isArray(parsed)) {
		return { error: `node '${oneRecord.stableId}' crossRefs is not a JSON list (${parseFault || 'wrong shape'})` };
	}
	return { crossRefList: parsed };
};

// computeFamilyEdges — PURE: the algorithm above over the read records → { edgeListByPairRefId, report } | { error }
const computeFamilyEdges = ({ recordList, familyStandardKeyList, familyRootStandardKey, standardKeyByName, locatorTable, producerName }) => {
	const { PROVENANCE_TIER } = vocabularyLib;
	const ownerTokenByIdentifier = {};
	for (let recordIndex = 0; recordIndex < recordList.length; recordIndex++) {
		const oneRecord = recordList[recordIndex];
		const ownerToken = standardKeyByName[oneRecord.properties._source];
		const identifierList = Array.from(new Set([oneRecord.stableId].concat([].concat(oneRecord.properties.uri === undefined || oneRecord.properties.uri === null ? [] : oneRecord.properties.uri))));
		for (let identifierIndex = 0; identifierIndex < identifierList.length; identifierIndex++) {
			const oneIdentifier = identifierList[identifierIndex];
			const priorOwner = ownerTokenByIdentifier[oneIdentifier];
			if (priorOwner !== undefined && priorOwner !== ownerToken) {
				return { error: refuse.byName({ moduleName, what: `identifier '${oneIdentifier}' is claimed by two family standards (${priorOwner}, ${ownerToken})`, where: 'a same-IRI identity join needs ONE owner per IRI; a collision is a source or forge defect, never resolved by read order' }).message };
			}
			ownerTokenByIdentifier[oneIdentifier] = ownerToken;
		}
	}
	const structureRowByLocator = locatorTable.structureLocatorList.reduce((soFar, oneRow, rowIndex) => ({ ...soFar, [oneRow.locator]: { ...oneRow, rowIndex } }), {});
	const orderedPairOf = (leftToken, rightToken) => (leftToken === familyRootStandardKey ? [leftToken, rightToken] : rightToken === familyRootStandardKey ? [rightToken, leftToken] : compareStrings(leftToken, rightToken) <= 0 ? [leftToken, rightToken] : [rightToken, leftToken]);
	const edgeByIdentityByPairRefId = {};
	const report = { crossRefTotal: 0, correspondenceSkippedCount: 0, unresolvedCountByStandard: {}, intraStandardCount: 0, replacedByEarlierLocatorCount: 0, duplicateCount: 0 };
	for (let recordIndex = 0; recordIndex < recordList.length; recordIndex++) {
		const oneRecord = recordList[recordIndex];
		const sourceToken = standardKeyByName[oneRecord.properties._source];
		const carried = crossRefListOf(oneRecord);
		if (carried.error) {
			return { error: refuse.byName({ moduleName, what: carried.error, where: 'the forge stamps crossRefs as a JSON string of { raw, locator }' }).message };
		}
		for (let crossRefIndex = 0; crossRefIndex < carried.crossRefList.length; crossRefIndex++) {
			const oneCrossRef = carried.crossRefList[crossRefIndex];
			report.crossRefTotal += 1;
			const structureRow = structureRowByLocator[oneCrossRef.locator];
			if (structureRow === undefined) {
				if (locatorTable.correspondenceLocatorList.indexOf(oneCrossRef.locator) !== -1) {
					report.correspondenceSkippedCount += 1;
					continue;
				}
				return { error: refuse.byName({ moduleName, what: `node '${oneRecord.stableId}' crossRef ${JSON.stringify(oneCrossRef)} carries locator '${oneCrossRef.locator}', which the family locator table lists as neither structure nor correspondence`, where: 'ONE table classifies every locator; add it to one list, never guess (WORKORDER-P6)' }).message };
			}
			const targetToken = ownerTokenByIdentifier[oneCrossRef.raw];
			if (targetToken === undefined) {
				report.unresolvedCountByStandard[sourceToken] = (report.unresolvedCountByStandard[sourceToken] || 0) + 1;
				continue;
			}
			if (targetToken === sourceToken) {
				report.intraStandardCount += 1;
				continue;
			}
			const [firstToken, secondToken] = orderedPairOf(sourceToken, targetToken);
			const pairRefId = `${firstToken}::${secondToken}`;
			const [fromStableId, toStableId] = structureRow.direction === 'targetToSource' ? [oneCrossRef.raw, oneRecord.stableId] : [oneRecord.stableId, oneCrossRef.raw];
			const edgeIdentity = `${structureRow.edgeType} ${fromStableId} ${toStableId}`;
			const edgeByIdentity = (edgeByIdentityByPairRefId[pairRefId] = edgeByIdentityByPairRefId[pairRefId] || {});
			const standing = edgeByIdentity[edgeIdentity];
			if (standing !== undefined) {
				report.duplicateCount += 1;
				if (structureRow.rowIndex >= standing.rowIndex) {
					continue;
				}
				report.replacedByEarlierLocatorCount += 1;
			}
			edgeByIdentity[edgeIdentity] = { rowIndex: structureRow.rowIndex, edge: { type: structureRow.edgeType, fromStableId, toStableId, properties: { provenanceTier: PROVENANCE_TIER.STRUCTURAL, provenanceSource: producerName, bridgeAuthored: true, crossRefLocator: structureRow.locator } } };
		}
	}
	// every family pair, root first then lexicographic, each with its edges sorted by (type, from, to)
	const pairList = [];
	familyStandardKeyList.forEach((leftToken, leftIndex) => familyStandardKeyList.slice(leftIndex + 1).forEach((rightToken) => pairList.push(orderedPairOf(leftToken, rightToken))));
	const orderedPairList = pairList.slice().sort(([leftFirst, leftSecond], [rightFirst, rightSecond]) => (leftFirst === familyRootStandardKey && rightFirst !== familyRootStandardKey ? -1 : rightFirst === familyRootStandardKey && leftFirst !== familyRootStandardKey ? 1 : compareStrings(`${leftFirst}::${leftSecond}`, `${rightFirst}::${rightSecond}`)));
	const edgeListByPairRefId = orderedPairList.reduce((soFar, [firstToken, secondToken]) => {
		const edgeByIdentity = edgeByIdentityByPairRefId[`${firstToken}::${secondToken}`] || {};
		return { ...soFar, [`${firstToken}::${secondToken}`]: Object.keys(edgeByIdentity).sort(compareStrings).map((oneIdentity) => edgeByIdentity[oneIdentity].edge) };
	}, {});
	return { orderedPairList, edgeListByPairRefId, report };
};

const structuralRunnerFactory = ({ familyReaderFactory, structuralWriterFactory, pluginRegistry, xLog } = {}) => {
	if (typeof familyReaderFactory !== 'function' || typeof structuralWriterFactory !== 'function' || !isPlainObject(pluginRegistry)) {
		throw refuse.byName({ moduleName, what: 'structuralRunnerFactory needs familyReaderFactory, structuralWriterFactory and pluginRegistry', where: 'bridgeMaker constructs it beside the bridge framework with the real doors; a suite passes the graph double\'s' });
	}
	const logger = xLog !== undefined ? xLog : process.global && process.global.xLog;
	if (!logger || typeof logger.status !== 'function') {
		throw refuse.byName({ moduleName, what: 'xLog is available neither as a dep nor as process.global.xLog', where: 'pass { xLog } or bootstrap process.global' });
	}

	const run = ({ inGraph, bridge, source, applyLabel, config } = {}, callback) => {
		const refuseRun = (what, where) => callback(refuse.byName({ moduleName, what, where }).message);
		const looked = pluginRegistryLib.lookupStructuralProducer({ registry: pluginRegistry, producerName: bridge, standardKey: source });
		if (looked.error) {
			callback(looked.error.message);
			return;
		}
		const { structuralDeclaration, locatorTable } = looked.entry;
		if (!inGraph || !isPlainObject(config)) {
			refuseRun('run: inGraph and config are required', 'build.js composes both for every bridge pairing');
			return;
		}
		const recipeFamily = Array.isArray(config.familyStandards) ? config.familyStandards.slice().sort() : [];
		if (JSON.stringify(recipeFamily) !== JSON.stringify(structuralDeclaration.familyStandardKeyList.slice().sort())) {
			refuseRun(`run: the recipe's familyStandards ${JSON.stringify(config.familyStandards)} are not the producer's family ${JSON.stringify(structuralDeclaration.familyStandardKeyList)}`, 'the recipe names exactly the family the producer declares; a partial family would silently drop pairs');
			return;
		}
		const standardNameByToken = config.familyStandardNameByToken;
		if (!isPlainObject(standardNameByToken) || structuralDeclaration.familyStandardKeyList.some((oneToken) => typeof standardNameByToken[oneToken] !== 'string' || standardNameByToken[oneToken] === '')) {
			refuseRun(`run: config.familyStandardNameByToken ${JSON.stringify(standardNameByToken)} does not name every family standard`, 'build.js resolves each family token to its declared standardName (parserDescriptor.ini); nothing is uppercased by rule');
			return;
		}
		const familyStandardNameList = structuralDeclaration.familyStandardKeyList.map((oneToken) => standardNameByToken[oneToken]);
		const standardKeyByName = structuralDeclaration.familyStandardKeyList.reduce((soFar, oneToken) => ({ ...soFar, [standardNameByToken[oneToken]]: oneToken }), {});
		const say = (text) => logger.status(`[structural ${structuralDeclaration.producerName} ${structuralDeclaration.familyStandardKeyList.join('+')}] ${text}`);
		const reader = familyReaderFactory({ inGraph, familyStandardNameList });
		reader.readFamilyRecords((readError, recordList) => {
			if (readError) {
				callback(`${moduleName}: readFamilyRecords: ${readError}`);
				return;
			}
			const missingStandard = familyStandardNameList.find((oneName) => !recordList.some((oneRecord) => oneRecord.properties._source === oneName));
			if (missingStandard !== undefined) {
				reader.close(() => refuseRun(`run: the dependency graph holds no '${missingStandard}' node`, 'every family standard\'s base must be restored (the recipe\'s dependencies); an absent member would silently lose its pairs'));
				return;
			}
			const computed = computeFamilyEdges({ recordList, familyStandardKeyList: structuralDeclaration.familyStandardKeyList, familyRootStandardKey: structuralDeclaration.familyRootStandardKey, standardKeyByName, locatorTable, producerName: structuralDeclaration.producerName });
			reader.close((closeError) => {
				if (closeError) {
					callback(closeError);
					return;
				}
				if (computed.error) {
					callback(computed.error);
					return;
				}
				say(`read ${recordList.length} family record(s); crossRefs ${computed.report.crossRefTotal}: correspondence (the declared bridges') ${computed.report.correspondenceSkippedCount}, intra-standard ${computed.report.intraStandardCount}, unresolved ${JSON.stringify(computed.report.unresolvedCountByStandard)}, duplicate ${computed.report.duplicateCount} (an earlier locator stood in ${computed.report.replacedByEarlierLocatorCount})`);
				const blockList = [];
				const writePair = (pairIndex) => {
					if (pairIndex >= computed.orderedPairList.length) {
						const edgesWritten = blockList.reduce((soFar, oneBlock) => soFar + oneBlock.edgeCount, 0);
						callback('', {
							inGraph,
							bridge,
							applyLabel,
							producer: STRUCTURAL_PRODUCER_KIND,
							decisionBlock: null,
							blocks: blockList.map(({ edgeCount, ...oneBlock }) => oneBlock),
							edgesWritten,
							counts: { ...computed.report, edgeCountByPair: blockList.reduce((soFar, oneBlock) => ({ ...soFar, [`${oneBlock.firstStandard}::${oneBlock.secondStandard}`]: oneBlock.edgeCount }), {}) },
							generation: `${structuralDeclaration.producerName}@${structuralDeclaration.producerVersion}`,
							rendererVersion: null,
							mode: STRUCTURAL_PRODUCER_KIND,
							sssomExportPath: null,
							note: `structural producer ${structuralDeclaration.producerName}: ${blockList.length} pair block(s), ${edgesWritten} edge(s)`,
							loadedConservationSummary: undefined,
							harvestEdgeTypeList: Array.from(new Set(locatorTable.structureLocatorList.map((oneRow) => oneRow.edgeType))).sort(),
						});
						return;
					}
					const [firstToken, secondToken] = computed.orderedPairList[pairIndex];
					const edgeList = computed.edgeListByPairRefId[`${firstToken}::${secondToken}`];
					if (edgeList.length === 0) {
						say(`pair ${firstToken}::${secondToken} has ZERO edges — nothing emitted (reported, R2-7)`);
						writePair(pairIndex + 1);
						return;
					}
					const writer = structuralWriterFactory({ inGraph, pairStandardNameList: [standardNameByToken[firstToken], standardNameByToken[secondToken]] });
					const writeEdge = (edgeIndex) => {
						if (edgeIndex >= edgeList.length) {
							writer.close((closeError, closeReport) => {
								if (closeError) {
									callback(closeError);
									return;
								}
								const byType = edgeList.reduce((soFar, oneEdge) => ({ ...soFar, [oneEdge.type]: (soFar[oneEdge.type] || 0) + 1 }), {});
								say(`pair ${firstToken}::${secondToken}: ${edgeList.length} edge(s) ${JSON.stringify(byType)}`);
								blockList.push({
									applyLabel: vocabularyLib.pairScopedLabelFor({ sourceToken: secondToken, hubToken: firstToken }),
									firstStandard: firstToken,
									secondStandard: secondToken,
									producer: STRUCTURAL_PRODUCER_KIND,
									decisionBlock: null,
									loadedConservationSummary: closeReport.loadedConservationSummary,
									harvestEdgeTypeList: Object.keys(byType).sort(),
									crossSourcePair: { pairA: standardNameByToken[firstToken], pairB: standardNameByToken[secondToken] },
									edgeCount: edgeList.length,
								});
								writePair(pairIndex + 1);
							});
							return;
						}
						const oneEdge = edgeList[edgeIndex];
						writer.writeStructuralEdge({ fromStableId: oneEdge.fromStableId, toStableId: oneEdge.toStableId, edgeType: oneEdge.type, edgeProperties: oneEdge.properties }, (writeError) => {
							if (writeError) {
								callback(`${moduleName}: pair ${firstToken}::${secondToken} edge ${oneEdge.type} ${oneEdge.fromStableId} → ${oneEdge.toStableId}: ${writeError}`);
								return;
							}
							writeEdge(edgeIndex + 1);
						});
					};
					writeEdge(0);
				};
				writePair(0);
			});
		});
	};
	return { run };
};

module.exports = { structuralRunnerFactory, computeFamilyEdges, STRUCTURAL_PRODUCER_KIND, moduleName };
