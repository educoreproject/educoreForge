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
//     reader.forEvidence() → view                                          every record BLINDED (names removed) — nodes AND edges (BR6)
//     view.readSourceNodes({ roleList }, cb) / view.readNodesByStableId({ stableIdList }, cb) / view.readEdgesAmongSource({ edgeTypeList }, cb)
//     reader.close(cb)
//   graphWriterFactory({ inGraph, applyLabel, sourceStandardName }) → writer
//     writer.writeMappingEdge({ subjectStableId, objectStableId, edgeType, edgeProperties }, cb(err, { edgeWritten }))
//     writer.close(cb)
// The reader/writer refusals themselves live in graphSeamRules.js (shared by the double and the bolt files) so
// the double proves the SAME rules the bolt files enforce.

const graphSeamRulesLib = require('./graphSeamRules');
// ⟪JOB 5a⟫ THE DOUBLE MUST MERGE BY THE SAME RULE AS THE REAL WRITER, or every suite that runs
// against it tests behaviour the real writer no longer has. It therefore keys its edges with the
// SAME exported identity function the loader and graphWriter use — one definition of what counts
// as the same edge, across all THREE WRITE DOORS — mergeEdges, graphWriter, this one — and across the
// FOURTH EMULATION that is not a door: testSupport/boltDriverDouble, the fake driver that pattern-matches
// the writer's cypher and emulates its merge. Four emulations, one identity definition.
const replayEngineLib = require(require('path').join(__dirname, '..', 'replay', 'replay-engine'))();
const { edgeConservationIdentityFor, identityHostileValue } = replayEngineLib;

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
		// ⟪JOB 5b⟫ the double keeps the SAME loaded-side accumulation the bolt writer keeps, so a test
		// that gates on the summary exercises the same shape the production door produces.
		loadedNodeStableIdSet: new Set(),
		loadedEdgeList: [],
		readHubCardsCallCount: 0,
		readHubVectorsCallCount: 0,
		readSubjectVectorsCallCount: 0,
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
		const makeView = ({ shapeRecord, shapeEdge }) => ({
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
				callback('', state.edgeList.filter((oneEdge) => sourceStableIdSet.has(oneEdge.fromStableId) && sourceStableIdSet.has(oneEdge.toStableId) && typeFilter(oneEdge)).map((oneEdge) => shapeEdge({ fromStableId: oneEdge.fromStableId, toStableId: oneEdge.toStableId, type: oneEdge.type, properties: { ...oneEdge.properties } })));
			},
		});
		const forWalk = ({ channelPropertyList } = {}) => {
			const walkError = graphSeamRulesLib.walkViewRefusal({ channelPropertyList, blindingDeclaration });
			if (walkError) {
				throw walkError;
			}
			return graphSeamRulesLib.closedView(makeView({ shapeRecord: (oneRecord) => graphSeamRulesLib.walkRecordFor({ record: graphSeamRulesLib.withoutEmbedding(oneRecord), blindingDeclaration, channelPropertyList }), shapeEdge: (oneEdge) => graphSeamRulesLib.walkEdgeFor({ edge: oneEdge, blindingDeclaration, channelPropertyList }) }));
		};
		const forEvidence = () => graphSeamRulesLib.closedView(makeView({ shapeRecord: (oneRecord) => graphSeamRulesLib.blindedRecordFor({ record: graphSeamRulesLib.withoutEmbedding(oneRecord), blindingDeclaration }), shapeEdge: (oneEdge) => graphSeamRulesLib.blindedEdgeFor({ edge: oneEdge, blindingDeclaration }) }));
		// forRetrieval — the double's vector view, shaped by THE SAME graphSeamRules.retrievalRecordFor the bolt
		// reader uses, so a hermetic retrieval gate proves the shape the live walk will actually see (RULING
		// §11.4; the B3 lesson that a double must run the framework's own rules, not a parallel imitation).
		const forRetrieval = () =>
			graphSeamRulesLib.closedRetrievalView({
				readHubVectors: ({ referenceTier } = {}, callback) => {
					state.readHubVectorsCallCount += 1;
					callback('', rawNodeRecordList().filter((oneRecord) => oneRecord.labels.indexOf('HubReference') !== -1 && oneRecord.properties.referenceTier === referenceTier).map(graphSeamRulesLib.retrievalRecordFor));
				},
				readSubjectVectors: ({ label } = {}, callback) => {
					state.readSubjectVectorsCallCount += 1;
					if (typeof label !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) {
						callback(`${moduleName}: readSubjectVectors label ${JSON.stringify(label)} is not a graph label`);
						return;
					}
					callback('', sourceRecordList().filter((oneRecord) => oneRecord.labels.indexOf(label) !== -1).map(graphSeamRulesLib.retrievalRecordFor));
				},
			});
		const close = (callback) => {
			state.readerCloseCount += 1;
			callback('');
		};
		return graphSeamRulesLib.closedReader({ readHubCards, readSubjectNodes, forWalk, forEvidence, forRetrieval, close });
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
				objectEndpoint: objectNode === undefined ? null : { labels: objectNode.labels, referenceTier: objectNode.properties.referenceTier },
			});
			if (refusal) {
				callback(refusal.message);
				return;
			}
			// ⟪JOB 5a⟫ the same identity-hostile refusal the real writer makes, so the double cannot
			// accept an edge the writer would reject. Like the real writer, it sits BEHIND §6, so it is
			// proven here for the ONE shape §6 cannot see — an array holding null. All three shapes are
			// proven on the loader door. See the note in graphWriter.js.
			const hostileNameList = Object.keys(edgeProperties || {}).filter((oneName) => identityHostileValue(edgeProperties[oneName]));
			if (hostileNameList.length > 0) {
				callback(`${moduleName} REFUSED: edge ${edgeType} ${subjectStableId} -> ${objectStableId} carries identity-hostile propert(ies) — null, undefined, or an array holding null: ${hostileNameList.join(', ')}. Edge properties are the relationship's merge identity; a null there decides which relationship the edge merges onto and is never defaulted. Nothing written.`);
				return;
			}
			[subjectNode, objectNode].forEach((oneNode) => {
				if (oneNode.labels.indexOf(applyLabel) === -1) {
					oneNode.labels.push(applyLabel);
				}
				state.labelStampList.push({ stableId: oneNode.stableId, applyLabel });
			});
			// ⟪JOB 5a⟫ MERGE ON THE FULL IDENTITY — (type, from, to, sorted key=VALUE) — exactly as
			// apoc.merge.relationship does in the real writer. The previous predicate keyed on
			// (from, type, to) alone and let an existing edge TAKE THE NEW PROPERTIES, which is the
			// defect being removed: two mapping claims differing only by a property value collapsed into
			// one carrying the last writer's. Identical edges still merge; distinct ones no longer do.
			const identityOf = (oneEdgeShape) => edgeConservationIdentityFor({ type: oneEdgeShape.type, fromRef: { id: oneEdgeShape.fromStableId }, toRef: { id: oneEdgeShape.toStableId }, properties: oneEdgeShape.properties });
			const incomingShape = { fromStableId: subjectStableId, toStableId: objectStableId, type: edgeType, properties: { ...edgeProperties } };
			const existing = state.edgeList.find((oneEdge) => identityOf(oneEdge) === identityOf(incomingShape));
			if (existing === undefined) {
				state.edgeList.push(incomingShape);
			}
			state.writtenEdgeList.push({ fromStableId: subjectStableId, toStableId: objectStableId, type: edgeType, properties: { ...edgeProperties }, applyLabel });
			// ⟪JOB 5b⟫ the loaded side, recorded exactly as the bolt writer records it: both endpoints
			// stamped, one edge per accepted write. The identity Set dedups a repeat, which is correct —
			// a repeat merges onto the relationship already there and adds nothing to what was loaded.
			state.loadedNodeStableIdSet.add(subjectStableId);
			state.loadedNodeStableIdSet.add(objectStableId);
			state.loadedEdgeList.push({ type: edgeType, fromRef: { id: subjectStableId }, toRef: { id: objectStableId }, properties: { ...edgeProperties } });
			callback('', { edgeWritten: true });
		};
		const close = (callback) => {
			state.writerCloseCount += 1;
			// ⟪JOB 5b⟫ same contract as the bolt writer: the loaded summary rides out on close's second
			// argument, built by the SHARED conservationSummaryFor.
			// ⟪JOB 5b⟫ the SAME PG-JSON shaping the bolt writer applies, and for the same measured
			// reason — see the long note in graphWriter.js. The double must produce the shape the door
			// produces or a test gates on something production never sees.
			const pgShaped = (properties) => {
				const out = {};
				Object.keys(properties || {}).forEach((oneName) => {
					const oneValue = properties[oneName];
					out[oneName] = Array.isArray(oneValue) ? oneValue : [oneValue];
				});
				return out;
			};
			callback('', {
				loadedConservationSummary: replayEngineLib.conservationSummaryFor({
					nodes: Array.from(state.loadedNodeStableIdSet).sort().map((oneStableId) => ({ stableId: oneStableId })),
					edges: state.loadedEdgeList.map((oneEdge) => ({ ...oneEdge, properties: pgShaped(oneEdge.properties) })),
				}),
			});
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
