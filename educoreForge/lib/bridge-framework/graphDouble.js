'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// graphDouble.js — the Docker-free READER/WRITER double (SPEC-bridgeFramework-v1.md §14.1; RULING BF12).
// The reader mirrors lib/forge-framework/roundTripHarness graphDoubleFrom's IDIOM ({ readAll }-style over an
// in-memory node/edge set, reader only); the WRITER double is NEW construction. Both expose the SAME
// factory shapes as graphReader.js / graphWriter.js, so a suite injects them through the FRAMEWORK factory
// (D-S1) and every gate runs hermetically — no container.
//
//   graphDoubleFrom({ nodeList, edgeList }) → { graphReaderFactory, graphWriterFactory, state, harvestByLabel }
//     nodeList  [{ stableId, labels: [...], properties: {...} }]     edgeList [{ fromStableId, toStableId, type, properties }]
//     state     the mutable double: node labels stamped by the writer, edges written (edgeList grows), the
//               reader's own counters (readHubCardsCallCount, sessionsOpenedFromPluginFrames …)
//     harvestByLabel({ applyLabel }) → { nodeList, edgeList }   the harvest MATCH (a:Label)-[r]->(b:Label) mirror
//
// The reader/writer CONTRACT (the two bolt files implement the same):
//   graphReaderFactory({ inGraph, dependencyStandardNameList, sourceStandardName, blindingDeclaration }) → reader
//     reader.readHubCards({ referenceTier }, cb(err, cardList))          list slots RE-WIDENED at entry (RULING P8)
//     reader.readSubjectNodes(cb(err, nodeList))                          WITHOUT embedding (RULING 12:05 #2), blinded view
//     reader.forWalk({ channelPropertyList }) → view                      declared channel properties UNBLINDED, other
//                                                                          blinded names REFUSED on read (Proxy)
//     reader.forEvidence() → view                                          every record BLINDED (names removed)
//     view.readSourceNodes({ roleList }, cb) / view.readNodesByStableId({ stableIdList }, cb) / view.readEdgesAmongSource({ edgeTypeList }, cb)
//     reader.close(cb)
//   graphWriterFactory({ inGraph, applyLabel, sourceStandardName }) → writer
//     writer.writeMappingEdge({ subjectStableId, objectStableId, edgeType, edgeProperties }, cb(err, { edgeWritten }))
//     writer.close(cb)
// The reader/writer refusals themselves live in graphSeamRules.js (shared by the double and the bolt files) so
// the double proves the SAME rules the bolt files enforce.

const graphSeamRulesLib = require('./graphSeamRules');

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const graphDoubleFrom = ({ nodeList, edgeList } = {}) => {
	if (!Array.isArray(nodeList) || !Array.isArray(edgeList)) {
		throw new Error(`${moduleName} REFUSED: graphDoubleFrom needs nodeList[] and edgeList[] — there is no default graph`);
	}
	const state = {
		nodeList: cloneJson(nodeList),
		edgeList: cloneJson(edgeList),
		writtenEdgeList: [],
		labelStampList: [],
		readHubCardsCallCount: 0,
		readSubjectNodesCallCount: 0,
		sessionsOpenedFromPluginFrames: 0,
		writerCloseCount: 0,
		readerCloseCount: 0,
	};
	const nodeByStableId = () => state.nodeList.reduce((soFar, oneNode) => ({ ...soFar, [oneNode.stableId]: oneNode }), {});

	const graphReaderFactory = ({ inGraph, dependencyStandardNameList, sourceStandardName, blindingDeclaration } = {}) => {
		const constructionError = graphSeamRulesLib.readerConstructionRefusal({ inGraph, dependencyStandardNameList, sourceStandardName, blindingDeclaration });
		if (constructionError) {
			throw constructionError;
		}
		const rawNodeRecordList = () => state.nodeList.map((oneNode) => ({ stableId: oneNode.stableId, labels: oneNode.labels.slice(), properties: { ...oneNode.properties } }));
		const readHubCards = ({ referenceTier } = {}, callback) => {
			state.readHubCardsCallCount += 1;
			const cardList = rawNodeRecordList().filter((oneRecord) => oneRecord.labels.indexOf('HubReference') !== -1 && oneRecord.properties.referenceTier === referenceTier);
			const shaped = graphSeamRulesLib.shapeHubCardList({ rawRecordList: cardList, referenceTier });
			if (shaped.error) {
				callback(shaped.error.message);
				return;
			}
			callback('', shaped.cardList);
		};
		const sourceRecordList = () => rawNodeRecordList().filter((oneRecord) => oneRecord.properties._source === sourceStandardName);
		const readSubjectNodes = (callback) => {
			state.readSubjectNodesCallCount += 1;
			callback('', sourceRecordList().map((oneRecord) => graphSeamRulesLib.blindedRecordFor({ record: graphSeamRulesLib.withoutEmbedding(oneRecord), blindingDeclaration })));
		};
		const makeView = ({ shapeRecord }) => ({
			readSourceNodes: ({ roleList } = {}, callback) => {
				const roleFilter = Array.isArray(roleList) && roleList.length ? (oneRecord) => roleList.indexOf(oneRecord.properties.role) !== -1 : () => true;
				callback('', sourceRecordList().filter(roleFilter).map(shapeRecord));
			},
			readNodesByStableId: ({ stableIdList } = {}, callback) => {
				const wanted = new Set(Array.isArray(stableIdList) ? stableIdList : []);
				callback('', sourceRecordList().filter((oneRecord) => wanted.has(oneRecord.stableId)).map(shapeRecord));
			},
			readEdgesAmongSource: ({ edgeTypeList } = {}, callback) => {
				const sourceStableIdSet = new Set(sourceRecordList().map((oneRecord) => oneRecord.stableId));
				const typeFilter = Array.isArray(edgeTypeList) && edgeTypeList.length ? (oneEdge) => edgeTypeList.indexOf(oneEdge.type) !== -1 : () => true;
				callback('', state.edgeList.filter((oneEdge) => sourceStableIdSet.has(oneEdge.fromStableId) && sourceStableIdSet.has(oneEdge.toStableId) && typeFilter(oneEdge)).map((oneEdge) => ({ fromStableId: oneEdge.fromStableId, toStableId: oneEdge.toStableId, type: oneEdge.type, properties: { ...oneEdge.properties } })));
			},
		});
		const forWalk = ({ channelPropertyList } = {}) => {
			const walkError = graphSeamRulesLib.walkViewRefusal({ channelPropertyList, blindingDeclaration });
			if (walkError) {
				throw walkError;
			}
			return graphSeamRulesLib.closedView(makeView({ shapeRecord: (oneRecord) => graphSeamRulesLib.walkRecordFor({ record: graphSeamRulesLib.withoutEmbedding(oneRecord), blindingDeclaration, channelPropertyList }) }));
		};
		const forEvidence = () => graphSeamRulesLib.closedView(makeView({ shapeRecord: (oneRecord) => graphSeamRulesLib.blindedRecordFor({ record: graphSeamRulesLib.withoutEmbedding(oneRecord), blindingDeclaration }) }));
		const close = (callback) => {
			state.readerCloseCount += 1;
			callback('');
		};
		return graphSeamRulesLib.closedReader({ readHubCards, readSubjectNodes, forWalk, forEvidence, close });
	};

	const graphWriterFactory = ({ inGraph, applyLabel, sourceStandardName } = {}) => {
		const constructionError = graphSeamRulesLib.writerConstructionRefusal({ inGraph, applyLabel, sourceStandardName });
		if (constructionError) {
			throw constructionError;
		}
		const writeMappingEdge = ({ subjectStableId, objectStableId, edgeType, edgeProperties } = {}, callback) => {
			const byStableId = nodeByStableId();
			const subjectNode = byStableId[subjectStableId];
			const objectNode = byStableId[objectStableId];
			const refusal = graphSeamRulesLib.mappingEdgeRefusal({
				subjectStableId,
				objectStableId,
				edgeType,
				edgeProperties,
				sourceStandardName,
				subjectEndpoint: subjectNode === undefined ? null : { labels: subjectNode.labels, sourceStandardName: subjectNode.properties._source },
				objectEndpoint: objectNode === undefined ? null : { labels: objectNode.labels },
			});
			if (refusal) {
				callback(refusal.message);
				return;
			}
			[subjectNode, objectNode].forEach((oneNode) => {
				if (oneNode.labels.indexOf(applyLabel) === -1) {
					oneNode.labels.push(applyLabel);
				}
				state.labelStampList.push({ stableId: oneNode.stableId, applyLabel });
			});
			// MERGE on (from, type, to): an existing edge takes the new properties, no duplicate
			const existing = state.edgeList.find((oneEdge) => oneEdge.fromStableId === subjectStableId && oneEdge.toStableId === objectStableId && oneEdge.type === edgeType);
			if (existing !== undefined) {
				existing.properties = { ...edgeProperties };
			} else {
				state.edgeList.push({ fromStableId: subjectStableId, toStableId: objectStableId, type: edgeType, properties: { ...edgeProperties } });
			}
			state.writtenEdgeList.push({ fromStableId: subjectStableId, toStableId: objectStableId, type: edgeType, properties: { ...edgeProperties }, applyLabel });
			callback('', { edgeWritten: true });
		};
		const close = (callback) => {
			state.writerCloseCount += 1;
			callback('');
		};
		return graphSeamRulesLib.closedWriter({ writeMappingEdge, close });
	};

	// harvestByLabel — the replay-engine harvest MATCH (a:L)-[r]->(b:L): every edge whose BOTH endpoints carry the label
	const harvestByLabel = ({ applyLabel } = {}) => {
		const labelled = state.nodeList.filter((oneNode) => oneNode.labels.indexOf(applyLabel) !== -1);
		const labelledSet = new Set(labelled.map((oneNode) => oneNode.stableId));
		return {
			nodeList: labelled.map((oneNode) => ({ stableId: oneNode.stableId, labels: oneNode.labels.slice(), properties: { ...oneNode.properties } })),
			// harvest wraps every edge property in a one-element list (replay-engine shapeEdgeProps / pgArray)
			edgeList: state.edgeList
				.filter((oneEdge) => labelledSet.has(oneEdge.fromStableId) && labelledSet.has(oneEdge.toStableId))
				.map((oneEdge) => ({ fromStableId: oneEdge.fromStableId, toStableId: oneEdge.toStableId, type: oneEdge.type, properties: Object.keys(oneEdge.properties).reduce((soFar, oneName) => ({ ...soFar, [oneName]: [oneEdge.properties[oneName]] }), {}) })),
		};
	};

	return { graphReaderFactory, graphWriterFactory, state, harvestByLabel };
};

module.exports = { graphDoubleFrom, isPlainObject, moduleName };
