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
//     forRetrieval()                        the vector view: readHubVectors, readSubjectVectors, readEmbedTextVectors, readCardBaseEdges
//     close(cb)
//
// Text nodes (role DME_ROLES.EMBED_TEXT) are excluded from readSourceRecords and from both ends of every among-source
// edge, so subjects, walk and evidence never carry one (R-BR-2). Of the retrieval reads, readSubjectVectors is scoped
// by the declared subject LABEL rather than by that exclusion; readEmbedTextVectors is the read that returns them.
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
	const textSearchVocabulary = graphSeamRulesLib.textSearchVocabularyFor();
	if (textSearchVocabulary.error) {
		throw textSearchVocabulary.error;
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

	// pagedRowRead — the row form of pagedNodeRead for the text-node reads: runs the cypher (with $skip/$limit, paged
	// in the cypher's ORDER BY) until a short page, and collects each record as a plain object over the named aliases
	const pagedRowRead = ({ cypher, parameters, aliasList }, callback) => {
		const session = driver.session();
		const collected = [];
		const readPage = (skip) => {
			session
				.run(cypher, { ...parameters, skip: neo4j.int(skip), limit: neo4j.int(PAGE_SIZE) })
				.then((result) => {
					result.records.forEach((oneRecord) => {
						const row = {};
						aliasList.forEach((oneAlias) => {
							row[oneAlias] = unwrapValue(oneRecord.get(oneAlias));
						});
						collected.push(row);
					});
					if (result.records.length < PAGE_SIZE) {
						session.close().then(() => callback('', collected)).catch((closeError) => callback(`${moduleName}: session close: ${closeError.message}`));
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

	const readHubCards =({ referenceTier } = {}, callback) => {
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

	// embedTextExclusionConditionFor — a text node is identified by ROLE and is never a source record, so never a
	// subject, a walk node, an evidence node or an endpoint of an among-source edge (R-BR-2). IS NULL keeps a roleless
	// node: in Cypher `null <> $x` is null, and a WHERE drops null.
	const embedTextExclusionConditionFor = (variableName) => `(${variableName}.role IS NULL OR ${variableName}.role <> $embedTextRole)`;

	// readSourceRecords — every node whose _source is the source standard EXACTLY (BR-023), text nodes excluded; the vector is never read
	const readSourceRecords = (callback) => {
		pagedNodeRead(
			{ cypher: `MATCH (n) WHERE ${embedTextExclusionConditionFor('n')} AND n._source = $sourceStandardName RETURN n ORDER BY n.stableId SKIP $skip LIMIT $limit`, parameters: { sourceStandardName, embedTextRole: textSearchVocabulary.embedTextRole } },
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
			.run(`MATCH (a)-[r]->(b) WHERE a._source = $sourceStandardName AND b._source = $sourceStandardName${typeClause} AND ${embedTextExclusionConditionFor('a')} AND ${embedTextExclusionConditionFor('b')} RETURN a.stableId AS fromStableId, b.stableId AS toStableId, type(r) AS edgeType, properties(r) AS edgeProperties`, { sourceStandardName, embedTextRole: textSearchVocabulary.embedTextRole, edgeTypeList:Array.isArray(edgeTypeList) ? edgeTypeList : [] })
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

	// forRetrieval — the PURPOSE-SCOPED vector view (RULING §11.4). It is the ONLY path in the framework that
	// yields a vector; each read yields only its own closed field list (graphSeamRules: RETRIEVAL_RECORD_KEY_LIST,
	// EMBED_TEXT_VECTOR_FIELD_NAME_LIST, CARD_BASE_EDGE_FIELD_NAME_LIST), and it is a different closed shape from
	// the evidence view, so the renderer cannot reach a vector and retrieval cannot reach a text or a definition. These are the reader's own reads and deliberately do NOT go through readSourceRecords
	// (which strips the vector by design, RULING 12:05 #2) or readHubCards (which now drops it, §11.4).
	const forRetrieval = () =>
		graphSeamRulesLib.closedRetrievalView({
			readHubVectors: ({ referenceTier } = {}, callback) => {
				pagedNodeRead(
					{ cypher: `MATCH (n:${graphSeamRulesLib.HUB_REFERENCE_LABEL}) WHERE n.referenceTier = $referenceTier RETURN n ORDER BY n.stableId SKIP $skip LIMIT $limit`, parameters: { referenceTier } },
					(readError, rawRecordList) => (readError ? callback(readError) : callback('', rawRecordList.map(graphSeamRulesLib.retrievalRecordFor))),
				);
			},
			readSubjectVectors: ({ label } = {}, callback) => {
				// the label is DATA from the declaration and is re-validated HERE, at the I/O boundary, because a
				// label reaches cypher by interpolation and cannot be a bound parameter
				if (typeof label !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) {
					callback(`${moduleName}: readSubjectVectors label ${JSON.stringify(label)} is not a graph label`);
					return;
				}
				pagedNodeRead(
					{ cypher: `MATCH (n:${label}) WHERE n._source = $sourceStandardName RETURN n ORDER BY n.stableId SKIP $skip LIMIT $limit`, parameters: { sourceStandardName } },
					(readError, rawRecordList) => (readError ? callback(readError) : callback('', rawRecordList.map(graphSeamRulesLib.retrievalRecordFor))),
				);
			},
			// readEmbedTextVectors — one record per text edge out of a text node of standardName: the text's vector and
			// model, the node it describes with that node's role, and propertyNameList re-widened (R-BR-1a). The text is
			// never read. standardName is the CALLER's: the source standard, or the hub's _source.
			readEmbedTextVectors: ({ standardName } = {}, callback) => {
				if (typeof standardName !== 'string' || standardName.length === 0) {
					callback(`${moduleName}: readEmbedTextVectors standardName ${JSON.stringify(standardName)} is not a standard name; the caller names the source standard or the hub's _source, and there is no default`);
					return;
				}
				pagedRowRead(
					{
						cypher: `MATCH (t)-[r]->(s) WHERE t._source = $standardName AND t.role = $embedTextRole AND type(r) = $embedsTextOfEdgeType RETURN t.stableId AS textStableId, t.${textSearchVocabulary.textVectorPropertyName} AS vector, t.embeddingModelVersion AS embeddingModelVersion, s.stableId AS sourceStableId, s.role AS sourceRole, s._source AS sourceStandardName, r.propertyNameList AS propertyNameList ORDER BY textStableId, sourceStableId SKIP $skip LIMIT $limit`,
						parameters: { standardName, embedTextRole: textSearchVocabulary.embedTextRole, embedsTextOfEdgeType: textSearchVocabulary.embedsTextOfEdgeType },
						aliasList: ['textStableId', 'vector', 'embeddingModelVersion', 'sourceStableId', 'sourceRole', 'sourceStandardName', 'propertyNameList'],
					},
					(readError, rowList) => {
						if (readError) {
							callback(readError);
							return;
						}
						const shaped = graphSeamRulesLib.shapeEmbedTextVectorRowList({ rowList, standardName });
						if (shaped.error) {
							callback(shaped.error.message);
							return;
						}
						callback('', shaped.recordList);
					},
				);
			},
			// readCardBaseEdges — the decomposition slot edges of the hub cards at referenceTier: ids, edge types and base
			// roles only (R-BR-9). The cards are read FIRST so a card with no slot edge at all is still seen, and refused
			// by name when it lacks a required slot (R-BR-13).
			readCardBaseEdges: ({ referenceTier } = {}, callback) => {
				if (typeof referenceTier !== 'string' || referenceTier.length === 0) {
					callback(`${moduleName}: readCardBaseEdges referenceTier ${JSON.stringify(referenceTier)} is not a tier; there is no default`);
					return;
				}
				const hubReferenceLabel = graphSeamRulesLib.HUB_REFERENCE_LABEL;
				pagedRowRead(
					{ cypher: `MATCH (c:${hubReferenceLabel}) WHERE c.referenceTier = $referenceTier RETURN c.stableId AS cardStableId, c.hubName AS hubName ORDER BY cardStableId SKIP $skip LIMIT $limit`, parameters: { referenceTier }, aliasList: ['cardStableId', 'hubName'] },
					(cardReadError, cardRowList) => {
						if (cardReadError) {
							callback(cardReadError);
							return;
						}
						pagedRowRead(
							{
								cypher: `MATCH (c:${hubReferenceLabel})-[r]->(b) WHERE c.referenceTier = $referenceTier RETURN c.stableId AS cardStableId, type(r) AS edgeType, b.stableId AS baseStableId, b.role AS baseRole ORDER BY cardStableId, edgeType, baseStableId SKIP $skip LIMIT $limit`,
								parameters: { referenceTier },
								aliasList: ['cardStableId', 'edgeType', 'baseStableId', 'baseRole'],
							},
							(edgeReadError, edgeRowList) => {
								if (edgeReadError) {
									callback(edgeReadError);
									return;
								}
								const shaped = graphSeamRulesLib.shapeCardBaseEdgeRowList({ cardRowList, edgeRowList, textSearchVocabulary });
								if (shaped.error) {
									callback(shaped.error.message);
									return;
								}
								callback('', shaped.recordList);
							},
						);
					},
				);
			},
		});
	const close = (callback) => {
		driver.close().then(() => callback('')).catch((closeError) => callback(`${moduleName}: driver close: ${closeError.message}`));
	};
	return graphSeamRulesLib.closedReader({ readHubCards, readSubjectNodes, forWalk, forEvidence, forRetrieval, close });
};

module.exports = { graphReaderFactory, moduleName };
