'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// no-rebuild-materialise.js — P-a2 of the R0 proof kit (2026-10-21, step 6): would a plain build of a recipe of record write the
// SAME relationship blocks it wrote before, from the frozen decision blocks of its baseline store, with no graph and no spend?
//
// WHAT RUNS FOR REAL, per mapping bridge of the recipe: the bridge framework itself (lib/bridge-framework, built by its own
// factory over the build's discovery registry and the real conflict detector), in MATERIALISE mode, reading the baseline decision
// store read-only — so the drift checks (declarationDigest, versions, document channel digests), the content-address verification,
// the sibling conflict lookup and materialiser.js all run exactly as in a build. Only the GRAPH DOORS are this module's:
//   the reader factory REFUSES if called (materialise reads no graph; a call would prove that claim false, loudly);
//   the writer records each edge after the SAME closed rules the bolt writer applies (graphSeamRules mappingEdgeRefusal /
//     declaredCorrespondenceEdgeRefusal, with the endpoints read from the base blocks) and merges on the SAME identity
//     (replay-engine edgeConservationIdentityFor), as apoc.merge.relationship does.
//
// THE HARVEST, rebuilt from the engine's own functions: the stamped endpoints' node lines from the recipe's stored base blocks
// (replay-block deserializeBlock → replay-engine resolveNodeVectors over the baseline support store → buildNodeRow, the row the
// engine would MERGE), each read back as the bolt driver returns it and shaped by replay-engine shapeNode; the written edges shaped
// by pgArray; ordered as the harvest's Cypher orders them (nodes by stableId; edges by fromStableId, type, toStableId); the header
// composed as build.js composes it; serialised by replay-block serializeBlock; addressed by content-address blockIdForText.
// WHAT IS EMULATED, and so is the claim's limit: Neo4j's storage round-trip of a property value and the harvest's selection and
// ordering. Reproducing the stored block's refId BYTE FOR BYTE is the check that the emulation is faithful: it cannot agree by
// accident. Where it does not, the edge sets are compared by the engine's identity, so the report says which of the two moved.
//
// Structural (hubless) pairings have no decision block; they are not materialised from the store and are reported as such.
//
//   materialiseRecipe({ recipe, registry, versionByToken, standardNameByToken, standardsDatabaseFilePath, supportStoreFilePath,
//                       decisionStoreFilePath, manifestRefId }, callback) → callback('', { rowList, passed })
//     supportStoreFilePath  a WRITABLE copy of the baseline standards store: the engine's vector store opens it for frozen vectors

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const neo4j = require('neo4j-driver');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const bridgeFrameworkLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'bridge-framework'));
const conflictDetectorLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'conflictDetector'));
const graphSeamRulesLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'graphSeamRules'));
const replayBlockLib = require(path.join(TREE_ROOT, 'lib', 'replay', 'replay-block'))();
const replayEngineLib = require(path.join(TREE_ROOT, 'lib', 'replay', 'replay-engine'))();
const contentAddress = require(path.join(TREE_ROOT, 'lib', 'content-address', 'content-address'))();
const vocabulary = require(path.join(TREE_ROOT, 'lib', 'vocabulary', 'vocabulary'));
const { makeVectorStoreResolver } = require(path.join(__dirname, 'build'))();

const VERDICT_PASS = 'PASS';
const VERDICT_EDGES_EQUAL_BLOCK_DIFFERS = 'EDGES_EQUAL_BLOCK_DIFFERS';
const VERDICT_EDGES_DIFFER = 'EDGES_DIFFER';
const VERDICT_RUN_REFUSED = 'RUN_REFUSED';
const VERDICT_STRUCTURAL = 'STRUCTURAL_NOT_MATERIALISED';
const PASSING_VERDICT_LIST = Object.freeze([VERDICT_PASS, VERDICT_STRUCTURAL]);
const RELATION_LABEL = vocabulary.BRIDGE_PAIR_LABEL_PREFIX;
// the harvest's embedding header fields, as build.js composes the relationship header (phase C harvest)
const HARVEST_EMBEDDING_ENCODING = Object.freeze({ embeddingEncoding: 'base64', embeddingDtype: 'float32', embeddingByteOrder: 'little-endian' });

const compareStrings = (leftValue, rightValue) => (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0);
// what the bolt driver hands back for a stored value: an Integer as a number, lists element-wise
const asBoltReturns = (oneValue) => (neo4j.isInt(oneValue) ? oneValue.toNumber() : Array.isArray(oneValue) ? oneValue.map(asBoltReturns) : oneValue);
const textOf = (storedText) => (Buffer.isBuffer(storedText) ? storedText.toString('utf8') : String(storedText));

// a decision store adapter that reads (latest row per pairKey, as decision-store.getDecisionBlock answers) and never writes
const readonlyDecisionStoreFor = (database) => ({
	getDecisionBlock: ({ pairKey }, callback) => {
		const row = database.prepare('select decisionBlockHash, frozenText from decisionBlocks where pairKey = ? order by seq desc limit 1').get(pairKey);
		callback('', row === undefined ? { frozenText: null } : { frozenText: textOf(row.frozenText), decisionBlockHash: row.decisionBlockHash, pairKey });
	},
	saveDecisionBlock: (unusedSpec, callback) => callback(`${moduleName}: saveDecisionBlock REFUSED — a materialise freezes nothing; a call here means the run left materialise mode`),
});

// the bolt writer answers each write from a driver promise, so the materialiser's write loop never deepens the stack; the recording
// writer answers on the next turn of the event loop for the same reason (thousands of synchronous answers overflow it)
const answerLater = (callback, ...answerList) => setImmediate(() => callback(...answerList));

// the recording writer: the bolt writer's closed rules and merge identity, endpoints read from the base node index
const recordingWriterFactoryFor = ({ nodeByStableId, writeLog }) => ({ inGraph, applyLabel, sourceStandardName } = {}) => {
	const constructionError = graphSeamRulesLib.writerConstructionRefusal({ inGraph, applyLabel, sourceStandardName });
	if (constructionError) {
		throw constructionError;
	}
	const identitySet = new Set();
	const recordEdge = ({ subjectStableId, objectStableId, edgeType, edgeProperties }) => {
		const hostileNameList = Object.keys(edgeProperties || {}).filter((oneName) => replayEngineLib.identityHostileValue(edgeProperties[oneName]));
		if (hostileNameList.length > 0) {
			return `${moduleName}: edge ${edgeType} ${subjectStableId} -> ${objectStableId} carries identity-hostile propert(ies) ${hostileNameList.join(', ')}`;
		}
		const shape = { type: edgeType, fromRef: { id: subjectStableId }, toRef: { id: objectStableId }, properties: { ...edgeProperties } };
		const identity = replayEngineLib.edgeConservationIdentityFor(shape);
		if (!identitySet.has(identity)) {
			identitySet.add(identity);
			writeLog.edgeList.push(shape);
		}
		writeLog.stampedStableIdSet.add(subjectStableId);
		writeLog.stampedStableIdSet.add(objectStableId);
		writeLog.applyLabel = applyLabel;
		return '';
	};
	const writeMappingEdge = ({ subjectStableId, objectStableId, edgeType, edgeProperties } = {}, callback) => {
		const subjectNode = nodeByStableId.get(subjectStableId);
		const objectNode = nodeByStableId.get(objectStableId);
		const refusal = graphSeamRulesLib.mappingEdgeRefusal({
			subjectStableId,
			objectStableId,
			edgeType,
			edgeProperties,
			sourceStandardName,
			subjectEndpoint: subjectNode === undefined ? null : { labels: subjectNode.labels, sourceStandardName: subjectNode.ref.source },
			objectEndpoint: objectNode === undefined ? null : { labels: objectNode.labels, referenceTier: asBoltReturns(replayEngineLib.pgToStored(objectNode.properties).referenceTier) },
		});
		if (refusal) {
			answerLater(callback, refusal.message);
			return;
		}
		const recordError = recordEdge({ subjectStableId, objectStableId, edgeType, edgeProperties });
		answerLater(callback, recordError, recordError ? undefined : { edgeWritten: true });
	};
	const writeDeclaredCorrespondenceEdge = ({ subjectStableId, objectStableId, objectStandardName, edgeType, edgeProperties } = {}, callback) => {
		const subjectNode = nodeByStableId.get(subjectStableId);
		const objectNode = nodeByStableId.get(objectStableId);
		const refusal = graphSeamRulesLib.declaredCorrespondenceEdgeRefusal({
			subjectStableId,
			objectStableId,
			objectStandardName,
			edgeType,
			edgeProperties,
			sourceStandardName,
			subjectEndpoint: subjectNode === undefined ? null : { sourceStandardName: subjectNode.ref.source },
			objectEndpoint: objectNode === undefined ? null : { labels: objectNode.labels, sourceStandardName: objectNode.ref.source },
		});
		if (refusal) {
			answerLater(callback, refusal.message);
			return;
		}
		const recordError = recordEdge({ subjectStableId, objectStableId, edgeType, edgeProperties });
		answerLater(callback, recordError, recordError ? undefined : { edgeWritten: true });
	};
	const close = (callback) => {
		const pgShaped = (properties) => Object.keys(properties || {}).reduce((soFar, oneName) => Object.assign(soFar, { [oneName]: Array.isArray(properties[oneName]) ? properties[oneName] : [properties[oneName]] }), {});
		callback('', {
			loadedConservationSummary: replayEngineLib.conservationSummaryFor({
				nodes: Array.from(writeLog.stampedStableIdSet).sort().map((oneStableId) => ({ stableId: oneStableId })),
				edges: writeLog.edgeList.map((oneEdge) => ({ ...oneEdge, properties: pgShaped(oneEdge.properties) })),
			}),
		});
	};
	return graphSeamRulesLib.closedWriter({ writeMappingEdge, close, writeDeclaredCorrespondenceEdge });
};

const refusingReaderFactory = () => {
	throw new Error(`${moduleName}: the framework asked for a graph READER during a materialise — the claim that materialise reads no graph is false; nothing here can stand in for it`);
};

// the relationship block a harvest would mint from what the writer wrote (see the header for what is emulated)
const harvestedBlockFor = ({ writeLog, nodeByStableId, blockHeaderByStableId, storeResolver, relationshipHeader }, callback) => {
	const stampedNodeList = Array.from(writeLog.stampedStableIdSet).sort(compareStrings).map((oneStableId) => nodeByStableId.get(oneStableId));
	const missingStableIdList = Array.from(writeLog.stampedStableIdSet).filter((oneStableId) => !nodeByStableId.has(oneStableId));
	if (missingStableIdList.length > 0) {
		callback(`${moduleName}: written endpoint(s) absent from the base blocks: ${missingStableIdList.slice(0, 5).join(', ')}`);
		return;
	}
	// one resolveNodeVectors call per source block, each node tagged exactly as replay() tags a node it accumulates from a
	// block (replay-engine: only a standardBase block's vectors live in a vector store)
	const nodeListByHeader = new Map();
	stampedNodeList.forEach((oneNode) => {
		const nodeBlockHeader = blockHeaderByStableId.get(oneNode.stableId);
		const resolvableNode = { ...oneNode, _standardKey: nodeBlockHeader.blockType === 'standardBase' ? nodeBlockHeader.standardKey : undefined };
		nodeListByHeader.set(nodeBlockHeader, (nodeListByHeader.get(nodeBlockHeader) || []).concat([resolvableNode]));
	});
	const taskList = new taskListPlus();
	nodeListByHeader.forEach((resolvableNodeList, nodeBlockHeader) => {
		taskList.push((args, next) => {
			replayEngineLib.resolveNodeVectors({ nodes: resolvableNodeList, storeResolver, header: nodeBlockHeader }, (resolveError) => next(resolveError, { ...args, resolvedNodeList: args.resolvedNodeList.concat(resolvableNodeList) }));
		});
	});
	pipeRunner(taskList.getList(), { resolvedNodeList: [] }, (pipeError, args) => {
		if (pipeError) {
			callback(`${moduleName}: resolving stamped node vectors: ${pipeError}`);
			return;
		}
		const nodeShapeList = args.resolvedNodeList.slice().sort((leftNode, rightNode) => compareStrings(leftNode.stableId, rightNode.stableId)).map((oneNode) => {
			const row = replayEngineLib.buildNodeRow(oneNode);
			const storedProperties = Object.keys(row.props).reduce((soFar, oneName) => Object.assign(soFar, { [oneName]: asBoltReturns(row.props[oneName]) }), {});
			const labelList = oneNode.labels.indexOf(writeLog.applyLabel) === -1 ? oneNode.labels.concat([writeLog.applyLabel]) : oneNode.labels.slice();
			return replayEngineLib.shapeNode({ labels: labelList, properties: storedProperties }, relationshipHeader, false);
		});
		const edgeShapeList = writeLog.edgeList
			.map((oneEdge) => ({
				type: oneEdge.type,
				fromRef: { source: nodeByStableId.get(oneEdge.fromRef.id).ref.source, id: oneEdge.fromRef.id },
				toRef: { source: nodeByStableId.get(oneEdge.toRef.id).ref.source, id: oneEdge.toRef.id },
				properties: Object.keys(oneEdge.properties).reduce((soFar, oneName) => Object.assign(soFar, { [oneName]: replayEngineLib.pgArray(oneEdge.properties[oneName]) }), {}),
			}))
			.sort((leftEdge, rightEdge) => compareStrings(leftEdge.fromRef.id, rightEdge.fromRef.id) || compareStrings(leftEdge.type, rightEdge.type) || compareStrings(leftEdge.toRef.id, rightEdge.toRef.id));
		const blockText = replayBlockLib.serializeBlock({ header: relationshipHeader, nodes: nodeShapeList, edges: edgeShapeList });
		callback('', { blockText, refId: contentAddress.blockIdForText(blockText), nodeCount: nodeShapeList.length, edgeCount: edgeShapeList.length });
	});
};

const edgeIdentitySetOf = (edgeList) => new Set(edgeList.map(replayEngineLib.edgeConservationIdentityFor));

const materialiseRecipe = ({ recipe, registry, versionByToken, standardNameByToken, standardsDatabaseFilePath, supportStoreFilePath, decisionStoreFilePath, manifestRefId }, callback) => {
	const standardsDatabase = new Database(standardsDatabaseFilePath, { readonly: true, fileMustExist: true });
	const decisionDatabase = new Database(decisionStoreFilePath, { readonly: true, fileMustExist: true });
	const memberBySubject = standardsDatabase
		.prepare('select b.kind, b.subject, b.refId from manifestBlocks m join blocks b on b.refId = m.schemaBlockRefId where m.manifestRefId = ?')
		.all(manifestRefId)
		.reduce((soFar, oneMember) => Object.assign(soFar, { [oneMember.subject]: oneMember }), {});
	const blockTextOf = (refId) => textOf(standardsDatabase.prepare('select text from blocks where refId = ?').get(refId).text);
	const baseMemberFor = (token) => memberBySubject[vocabulary.baseSubject({ standardKey: token, version: versionByToken[token] }).subject];
	const storeResolver = makeVectorStoreResolver({ supportStoreFilePath });
	const rowList = [];
	const finish = (finishError) => {
		standardsDatabase.close();
		decisionDatabase.close();
		if (finishError) {
			callback(finishError);
			return;
		}
		callback('', { rowList, passed: rowList.length > 0 && rowList.every((oneRow) => PASSING_VERDICT_LIST.indexOf(oneRow.verdict) !== -1) });
	};
	const taskList = new taskListPlus();
	recipe.bridges.forEach((bridge) => {
		taskList.push((args, next) => {
			if (bridge.hub === undefined) {
				rowList.push({ bridgeName: bridge.bridge, source: bridge.source, verdict: VERDICT_STRUCTURAL, note: 'a structural producer has no decision block; its _struct blocks are a P-z (live build) check' });
				next('', args);
				return;
			}
			// the dependency bases, exactly the tokens build.js restores for a pairing
			const dependencyTokenList = Array.from(new Set([bridge.source, bridge.hub].concat(bridge.dependencies || [])));
			const nodeByStableId = new Map();
			const blockHeaderByStableId = new Map();
			// the run's ONE embedding identity, as phase A carries it into the relationship header: a forged base reports its
			// model and width (vectorised), or no model and a null width (--vectorize=false), so the header says embeddingDims null
			let baseEmbeddingHeader = null;
			dependencyTokenList.forEach((token) => {
				const member = baseMemberFor(token);
				const parsed = replayBlockLib.deserializeBlock(blockTextOf(member.refId));
				baseEmbeddingHeader = baseEmbeddingHeader || parsed.header;
				parsed.nodes.forEach((oneNode) => {
					nodeByStableId.set(oneNode.stableId, oneNode);
					blockHeaderByStableId.set(oneNode.stableId, parsed.header);
				});
			});
			const writeLog = { edgeList: [], stampedStableIdSet: new Set(), applyLabel: null };
			const framework = bridgeFrameworkLib({
				graphReaderFactory: refusingReaderFactory,
				graphWriterFactory: recordingWriterFactoryFor({ nodeByStableId, writeLog }),
				pluginRegistry: registry,
				conflictDetector: conflictDetectorLib.detectSiblingConflicts,
			});
			framework.run(
				{
					inGraph: { graphName: 'noRebuildProofInProcess', boltUrl: 'none://in-process', password: 'none' },
					bridge: bridge.bridge,
					source: bridge.source,
					hub: bridge.hub,
					applyLabel: RELATION_LABEL,
					rebridge: false,
					decisionStore: readonlyDecisionStoreFor(decisionDatabase),
					config: {
						sourceStandard: bridge.source,
						sourceStandardName: standardNameByToken[bridge.source],
						sourceVersion: versionByToken[bridge.source],
						hubVersion: versionByToken[bridge.hub],
						hubStandardName: standardNameByToken[bridge.hub],
						familyStandards: bridge.familyStandards || bridge.dependencies,
					},
				},
				(runError, runReport) => {
					if (runError) {
						rowList.push({ bridgeName: bridge.bridge, source: bridge.source, verdict: VERDICT_RUN_REFUSED, detail: String(runError).slice(0, 600) });
						next('', args);
						return;
					}
					const producer = vocabulary.suffixForRelationshipProducer(runReport.producer) ? runReport.producer : runReport.decisionBlock != null ? 'inferred' : 'authored';
					const relationshipHeader = {
						blockType: 'relationship',
						pairA: bridge.hub,
						pairAVersion: versionByToken[bridge.hub],
						pairB: bridge.source,
						pairBVersion: versionByToken[bridge.source],
						producer,
						discriminator: runReport.subjectDiscriminator,
						embeddingModelVersion: baseEmbeddingHeader.embeddingModelVersion,
						...HARVEST_EMBEDDING_ENCODING,
						embeddingDims: baseEmbeddingHeader.embeddingDims === undefined ? null : baseEmbeddingHeader.embeddingDims,
					};
					const composedSubject = vocabulary.relationshipSubject({ hubStandard: bridge.hub, hubVersion: versionByToken[bridge.hub], sourceStandard: bridge.source, sourceVersion: versionByToken[bridge.source], producer, discriminator: runReport.subjectDiscriminator });
					const storedMember = memberBySubject[composedSubject.subject];
					harvestedBlockFor({ writeLog, nodeByStableId, blockHeaderByStableId, storeResolver, relationshipHeader }, (harvestError, harvested) => {
						if (harvestError) {
							next(harvestError, args);
							return;
						}
						const identity = { bridgeName: bridge.bridge, source: bridge.source, hub: bridge.hub, subject: composedSubject.subject, decisionBlockHash: runReport.decisionBlock ? runReport.decisionBlock.decisionBlockHash : null, edgesWritten: harvested.edgeCount, stampedNodeCount: harvested.nodeCount };
						if (storedMember === undefined) {
							rowList.push({ ...identity, verdict: VERDICT_EDGES_DIFFER, detail: `the recipe's manifest holds no member '${composedSubject.subject}'` });
							next('', args);
							return;
						}
						if (harvested.refId === storedMember.refId) {
							rowList.push({ ...identity, verdict: VERDICT_PASS, refId: harvested.refId });
							next('', args);
							return;
						}
						const storedBlock = replayBlockLib.deserializeBlock(blockTextOf(storedMember.refId));
						const storedIdentitySet = edgeIdentitySetOf(storedBlock.edges);
						const rebuiltIdentitySet = edgeIdentitySetOf(replayBlockLib.deserializeBlock(harvested.blockText).edges);
						const storedOnlyCount = Array.from(storedIdentitySet).filter((oneIdentity) => !rebuiltIdentitySet.has(oneIdentity)).length;
						const rebuiltOnlyCount = Array.from(rebuiltIdentitySet).filter((oneIdentity) => !storedIdentitySet.has(oneIdentity)).length;
						const firstDifferingLine = (() => {
							const storedLineList = blockTextOf(storedMember.refId).split('\n');
							const rebuiltLineList = harvested.blockText.split('\n');
							const lineIndex = storedLineList.findIndex((oneLine, oneIndex) => oneLine !== rebuiltLineList[oneIndex]);
							return lineIndex === -1 ? null : { lineNumber: lineIndex + 1, stored: (storedLineList[lineIndex] || '').slice(0, 400), rebuilt: (rebuiltLineList[lineIndex] || '').slice(0, 400) };
						})();
						rowList.push({
							...identity,
							verdict: storedOnlyCount === 0 && rebuiltOnlyCount === 0 ? VERDICT_EDGES_EQUAL_BLOCK_DIFFERS : VERDICT_EDGES_DIFFER,
							storedRefId: storedMember.refId,
							rebuiltRefId: harvested.refId,
							storedEdgeCount: storedBlock.edges.length,
							storedNodeCount: storedBlock.nodes.length,
							storedOnlyEdgeCount: storedOnlyCount,
							rebuiltOnlyEdgeCount: rebuiltOnlyCount,
							firstDifferingLine,
						});
						next('', args);
					});
				},
			);
		});
	});
	pipeRunner(taskList.getList(), {}, (pipeError) => finish(pipeError || ''));
};

module.exports = {
	materialiseRecipe,
	VERDICT_PASS,
	VERDICT_EDGES_EQUAL_BLOCK_DIFFERS,
	VERDICT_EDGES_DIFFER,
	VERDICT_RUN_REFUSED,
	VERDICT_STRUCTURAL,
	moduleName,
};
