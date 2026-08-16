'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// graphReader.js — the ONE bolt-facing READ file of the Bridge Framework (SPEC-bridgeFramework-v1.md §4.2,
// §5.2 step 1, §14.1; RULINGS BF7, P8, 12:05 #2; named in apps/graph-builder/DOCTRINE.md). The same contract
// as graphDouble.js's reader (the rules live in graphSeamRules.js — this file is the I/O):
//
//   graphReaderFactory({ inGraph, dependencyStandardNameList, sourceStandardName, blindingDeclaration }) → reader
//     readHubCards({ referenceTier }, cb)   HubReference cards of the hub, ONE flatten, list slots re-widened, embedding required
//     readSubjectNodes(cb)                  the source standard's forged nodes (_source EXACT), WITHOUT the embedding, blinded
//     forWalk({ channelPropertyList })      the walk view — declared channel properties unblinded, other blinded names refused
//     forEvidence()                         the blinded view (the renderer / judge / forensics view) — nodes AND edges (BR6)
//     close(cb)
//
// neo4j-driver v6 is promise-native; the dispensation (DOCTRINE.md) is taken as .then().catch()-to-callback at
// the LEAF, here only. The driver is required LAZILY inside the factory (the framework's static require
// graph stays driver-free — BG-CONTAIN). No async/await, no try/catch. Reads are paged and COLLECTED then
// sorted by stableId so read order never reaches the frozen text (BG-DET, BG-POOL-ORDER).

const graphSeamRulesLib = require('./graphSeamRules');

const NEO4J_USER = 'neo4j';
const PAGE_SIZE = 5000;

const graphReaderFactory = ({ inGraph, dependencyStandardNameList, sourceStandardName, blindingDeclaration } = {}) => {
	const constructionError = graphSeamRulesLib.readerConstructionRefusal({ inGraph, dependencyStandardNameList, sourceStandardName, blindingDeclaration });
	if (constructionError) {
		throw constructionError;
	}
	if (typeof inGraph.boltUrl !== 'string' || typeof inGraph.password !== 'string') {
		throw new Error(`${moduleName} REFUSED: inGraph lacks boltUrl / password — the GraphHandle replayManager.create returns carries both`);
	}
	const neo4j = require('neo4j-driver'); // the ONE sanctioned require of the driver in the framework's read path
	const driver = neo4j.driver(inGraph.boltUrl, neo4j.auth.basic(typeof inGraph.user === 'string' ? inGraph.user : NEO4J_USER, inGraph.password), { encrypted: false });

	const unwrapValue = (oneValue) => (neo4j.isInt(oneValue) ? oneValue.toNumber() : Array.isArray(oneValue) ? oneValue.map(unwrapValue) : oneValue);
	const unwrapProperties = (rawProperties) => Object.keys(rawProperties || {}).reduce((soFar, oneName) => ({ ...soFar, [oneName]: unwrapValue(rawProperties[oneName]) }), {});
	const compareStrings = (leftValue, rightValue) => (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0);

	// pagedNodeRead — runs the cypher (with $skip/$limit) until a short page; collects records { stableId, labels, properties }
	const pagedNodeRead = ({ cypher, parameters }, callback) => {
		const session = driver.session();
		const collected = [];
		const readPage = (skip) => {
			session
				.run(cypher, { ...parameters, skip: neo4j.int(skip), limit: neo4j.int(PAGE_SIZE) })
				.then((result) => {
					result.records.forEach((oneRecord) => {
						const node = oneRecord.get('n');
						const properties = unwrapProperties(node.properties);
						collected.push({ stableId: properties.stableId, labels: node.labels.slice(), properties });
					});
					if (result.records.length < PAGE_SIZE) {
						session.close().then(() => callback('', collected.sort((leftRecord, rightRecord) => compareStrings(String(leftRecord.stableId), String(rightRecord.stableId))))).catch((closeError) => callback(`${moduleName}: session close: ${closeError.message}`));
						return;
					}
					readPage(skip + PAGE_SIZE);
				})
				.catch((runError) => {
					session.close().then(() => callback(`${moduleName}: ${runError.message}`)).catch(() => callback(`${moduleName}: ${runError.message}`));
				});
		};
		readPage(0);
	};

	const readHubCards = ({ referenceTier } = {}, callback) => {
		pagedNodeRead(
			{ cypher: `MATCH (n:${graphSeamRulesLib.HUB_REFERENCE_LABEL}) WHERE n.referenceTier = $referenceTier RETURN n ORDER BY n.stableId SKIP $skip LIMIT $limit`, parameters: { referenceTier } },
			(readError, rawRecordList) => {
				if (readError) {
					callback(readError);
					return;
				}
				const shaped = graphSeamRulesLib.shapeHubCardList({ rawRecordList, referenceTier });
				if (shaped.error) {
					callback(shaped.error.message);
					return;
				}
				callback('', shaped.cardList);
			},
		);
	};

	// readSourceRecords — every node whose _source is the source standard EXACTLY (BR-023); the vector is never read
	const readSourceRecords = (callback) => {
		pagedNodeRead(
			{ cypher: 'MATCH (n) WHERE n._source = $sourceStandardName RETURN n ORDER BY n.stableId SKIP $skip LIMIT $limit', parameters: { sourceStandardName } },
			(readError, rawRecordList) => {
				if (readError) {
					callback(readError);
					return;
				}
				callback('', rawRecordList.map(graphSeamRulesLib.withoutEmbedding));
			},
		);
	};

	const readSubjectNodes = (callback) => {
		readSourceRecords((readError, recordList) => {
			if (readError) {
				callback(readError);
				return;
			}
			callback('', recordList.map((oneRecord) => graphSeamRulesLib.blindedRecordFor({ record: oneRecord, blindingDeclaration })));
		});
	};

	const readEdgesAmongSourceRaw = ({ edgeTypeList }, callback) => {
		const session = driver.session();
		const typeClause = Array.isArray(edgeTypeList) && edgeTypeList.length ? ' AND type(r) IN $edgeTypeList' : '';
		session
			.run(`MATCH (a)-[r]->(b) WHERE a._source = $sourceStandardName AND b._source = $sourceStandardName${typeClause} RETURN a.stableId AS fromStableId, b.stableId AS toStableId, type(r) AS edgeType, properties(r) AS edgeProperties`, { sourceStandardName, edgeTypeList: Array.isArray(edgeTypeList) ? edgeTypeList : [] })
			.then((result) => {
				const edgeList = result.records.map((oneRecord) => ({ fromStableId: oneRecord.get('fromStableId'), toStableId: oneRecord.get('toStableId'), type: oneRecord.get('edgeType'), properties: unwrapProperties(oneRecord.get('edgeProperties')) }));
				session.close().then(() => callback('', edgeList)).catch((closeError) => callback(`${moduleName}: session close: ${closeError.message}`));
			})
			.catch((runError) => {
				session.close().then(() => callback(`${moduleName}: ${runError.message}`)).catch(() => callback(`${moduleName}: ${runError.message}`));
			});
	};

	const makeView = ({ shapeRecord, shapeEdge }) => ({
		readSourceNodes: ({ roleList } = {}, callback) => {
			readSourceRecords((readError, recordList) => {
				if (readError) {
					callback(readError);
					return;
				}
				const roleFilter = Array.isArray(roleList) && roleList.length ? (oneRecord) => roleList.indexOf(oneRecord.properties.role) !== -1 : () => true;
				callback('', recordList.filter(roleFilter).map(shapeRecord));
			});
		},
		readNodesByStableId: ({ stableIdList } = {}, callback) => {
			readSourceRecords((readError, recordList) => {
				if (readError) {
					callback(readError);
					return;
				}
				const wanted = new Set(Array.isArray(stableIdList) ? stableIdList : []);
				callback('', recordList.filter((oneRecord) => wanted.has(oneRecord.stableId)).map(shapeRecord));
			});
		},
		readEdgesAmongSource: ({ edgeTypeList } = {}, callback) =>
			readEdgesAmongSourceRaw({ edgeTypeList }, (readError, edgeList) => (readError ? callback(readError) : callback('', edgeList.map(shapeEdge)))),
	});
	const forWalk = ({ channelPropertyList } = {}) => {
		const walkError = graphSeamRulesLib.walkViewRefusal({ channelPropertyList, blindingDeclaration });
		if (walkError) {
			throw walkError;
		}
		return graphSeamRulesLib.closedView(makeView({ shapeRecord: (oneRecord) => graphSeamRulesLib.walkRecordFor({ record: oneRecord, blindingDeclaration, channelPropertyList }), shapeEdge: (oneEdge) => graphSeamRulesLib.walkEdgeFor({ edge: oneEdge, blindingDeclaration, channelPropertyList }) }));
	};
	const forEvidence = () => graphSeamRulesLib.closedView(makeView({ shapeRecord: (oneRecord) => graphSeamRulesLib.blindedRecordFor({ record: oneRecord, blindingDeclaration }), shapeEdge: (oneEdge) => graphSeamRulesLib.blindedEdgeFor({ edge: oneEdge, blindingDeclaration }) }));
	const close = (callback) => {
		driver.close().then(() => callback('')).catch((closeError) => callback(`${moduleName}: driver close: ${closeError.message}`));
	};
	return graphSeamRulesLib.closedReader({ readHubCards, readSubjectNodes, forWalk, forEvidence, close });
};

module.exports = { graphReaderFactory, moduleName };
