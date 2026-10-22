'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// graphReader.js — the ONE bolt-facing file of the Forge Framework (SPEC-forgeFramework-v1.md
// §12.1; DOCTRINE dispensation: neo4j-driver's Promises resolve `.then().catch()` to the callback AT
// THE LEAF, in this file alone). It is the validator's sanctioned read (Profile §8.1, RT-4): the
// MATERIALIZED graph over bolt, scoped to ONE `_source`, Layer 1 only.
//
// It exposes the SAME GraphReader contract the Docker-free double exposes (roundTripHarness.js
// graphDoubleFrom), so an emitter is written ONCE against `reader.readAll`:
//
//   reader.readAll(callback(errString, { nodes: [{ stableId, labels, role, properties }],
//                                        edges: [{ type, fromStableId, toStableId, properties }] }))
//   reader.close(callback(errString))
//
// neo4j-driver is required LAZILY inside openGraphReader, so requiring this module (through the
// harness, from a roundTripValidator.js) never loads the driver, and the hermetic
// validateWithReader path runs with the driver absent or stubbed (G-NOGRAPH's dynamic conjunct).
// Node-integer scalars are unwrapped to JS numbers; every other value passes through untouched.
// A session/driver close error is REPORTED in the callback text, never swallowed (FA8).

const NODE_PAGE_SIZE = 5000;

const openGraphReader = ({ boltUrl, user, password, standardSource } = {}, callback) => {
	if (typeof boltUrl !== 'string' || boltUrl.length === 0) {
		callback(`${moduleName} REFUSED: boltUrl is required to open a graph reader`);
		return;
	}
	if (typeof standardSource !== 'string' || standardSource.length === 0) {
		callback(`${moduleName} REFUSED: standardSource is required — the read is scoped to ONE _source (RT-4)`);
		return;
	}
	if (typeof user !== 'string' || typeof password !== 'string') {
		callback(`${moduleName} REFUSED: user and password are required (strings)`);
		return;
	}
	const neo4j = require('neo4j-driver'); // the ONE sanctioned require of the driver in the framework
	const driver = neo4j.driver(boltUrl, neo4j.auth.basic(user, password));

	const unwrapValue = (oneValue) => {
		if (neo4j.isInt(oneValue)) {
			return oneValue.toNumber();
		}
		if (Array.isArray(oneValue)) {
			return oneValue.map(unwrapValue);
		}
		return oneValue;
	};
	const unwrapProperties = (rawProperties) => {
		const properties = {};
		Object.keys(rawProperties || {}).forEach((oneName) => {
			properties[oneName] = unwrapValue(rawProperties[oneName]);
		});
		return properties;
	};

	const readAll = (readCallback) => {
		const session = driver.session();
		const nodes = [];
		const readNodePage = (skip) => {
			session
				.run('MATCH (n {_source:$source}) RETURN n ORDER BY n.stableId SKIP $skip LIMIT $limit', {
					source: standardSource,
					skip: neo4j.int(skip),
					limit: neo4j.int(NODE_PAGE_SIZE),
				})
				.then((result) => {
					result.records.forEach((oneRecord) => {
						const oneNode = oneRecord.get('n');
						const properties = unwrapProperties(oneNode.properties);
						nodes.push({
							stableId: properties.stableId,
							labels: oneNode.labels.slice(),
							role: properties.role,
							properties,
						});
					});
					if (result.records.length === NODE_PAGE_SIZE) {
						readNodePage(skip + NODE_PAGE_SIZE);
						return;
					}
					session
						.run(
							`MATCH (a {_source:$source})-[r]->(b {_source:$source})
							 RETURN a.stableId AS fromStableId, type(r) AS type, b.stableId AS toStableId, properties(r) AS props
							 ORDER BY fromStableId, type, toStableId`,
							{ source: standardSource },
						)
						.then((edgeResult) => {
							const edges = edgeResult.records.map((oneRecord) => ({
								type: oneRecord.get('type'),
								fromStableId: oneRecord.get('fromStableId'),
								toStableId: oneRecord.get('toStableId'),
								properties: unwrapProperties(oneRecord.get('props')),
							}));
							session
								.close()
								.then(() => readCallback('', { nodes, edges }))
								.catch((closeError) => readCallback(`${moduleName} session close failed: ${closeError.message}`));
						})
						.catch((edgeError) => {
							session
								.close()
								.then(() => readCallback(`${moduleName} edge read failed: ${edgeError.message}`))
								.catch((closeError) => readCallback(`${moduleName} edge read failed: ${edgeError.message}; and session close failed: ${closeError.message}`));
						});
				})
				.catch((nodeError) => {
					session
						.close()
						.then(() => readCallback(`${moduleName} node read failed: ${nodeError.message}`))
						.catch((closeError) => readCallback(`${moduleName} node read failed: ${nodeError.message}; and session close failed: ${closeError.message}`));
				});
		};
		readNodePage(0);
	};

	const close = (closeCallback) => {
		driver
			.close()
			.then(() => closeCallback(''))
			.catch((closeError) => closeCallback(`${moduleName} driver close failed: ${closeError.message}`));
	};

	callback('', { readAll, close });
};

// -----
// openLayerGraphReader — ⟪lane DES, cedsRichness-101226, 2026-10-12⟫ the read a LAYER's round trip needs: the nodes of ONE
// layer (label StandardLayer, the layer's layerKey, the standard's _source) and every edge with an endpoint among them,
// plus the BASE endpoints those edges reach, read as identities only (stableId, role, labels, cedsId) — never the base's
// vectors. Same leaf discipline as openGraphReader: the driver's Promises resolve to the callback here and nowhere else.
//
//   reader.readLayer(callback(errString, { nodes, edges, baseEndpointByStableId, baseQueryRowListByName }))
// baseEndpointPropertyNameList (optional, R5 S3) = the properties of a BASE endpoint a layer's validator reads (the CEDS guide
// layer reads its anchor id); each lands on baseEndpointByStableId[stableId] under its own name beside stableId, role, labels.
// The reader names no standard's property: the validator that owns the meaning declares it.
// baseQueryList (optional) = [{ queryName, cypherText }]: further READ queries a layer's validator needs over the BASE (run in a
// READ session, parameters $source and $layerKey bound), each answered as rows of plain objects under its queryName.
//   reader.close(callback(errString))
const openLayerGraphReader = ({ boltUrl, user, password, standardSource, layerKey, baseQueryList = [], baseEndpointPropertyNameList = [] } = {}, callback) => {
	if (typeof boltUrl !== 'string' || boltUrl.length === 0 || typeof standardSource !== 'string' || standardSource.length === 0 || typeof layerKey !== 'string' || layerKey.length === 0) {
		callback(`${moduleName} REFUSED: boltUrl, standardSource and layerKey are required to open a layer reader`);
		return;
	}
	if (typeof user !== 'string' || typeof password !== 'string') {
		callback(`${moduleName} REFUSED: user and password are required (strings)`);
		return;
	}
	const neo4j = require('neo4j-driver');
	const driver = neo4j.driver(boltUrl, neo4j.auth.basic(user, password));
	const unwrapValue = (oneValue) => (neo4j.isInt(oneValue) ? oneValue.toNumber() : Array.isArray(oneValue) ? oneValue.map(unwrapValue) : oneValue);
	const unwrapProperties = (rawProperties) => Object.keys(rawProperties || {}).reduce((soFar, oneName) => ({ ...soFar, [oneName]: unwrapValue(rawProperties[oneName]) }), {});
	if (!Array.isArray(baseEndpointPropertyNameList) || baseEndpointPropertyNameList.some((oneName) => typeof oneName !== 'string' || oneName === '' || ['stableId', 'role', 'labels'].indexOf(oneName) !== -1)) {
		callback(`${moduleName} REFUSED: baseEndpointPropertyNameList is ${JSON.stringify(baseEndpointPropertyNameList)}; a list of property names, none of them stableId, role or labels (already read)`);
		return;
	}
	const parameterMap = { source: standardSource, layerKey };
	const layerNodeMatch = '(n:StandardLayer {_source:$source, layerKey:$layerKey})';
	const readLayer = (readCallback) => {
		const session = driver.session({ defaultAccessMode: neo4j.session.READ });
		const finish = (failureText, payload) =>
			session
				.close()
				.then(() => readCallback(failureText, payload))
				.catch((closeError) => readCallback(`${failureText ? `${failureText}; and ` : ''}${moduleName} session close failed: ${closeError.message}`));
		session
			.run(`MATCH ${layerNodeMatch} RETURN n ORDER BY n.stableId`, parameterMap)
			.then((nodeResult) => {
				const nodes = nodeResult.records.map((oneRecord) => {
					const oneNode = oneRecord.get('n');
					const properties = unwrapProperties(oneNode.properties);
					return { stableId: properties.stableId, labels: oneNode.labels.slice(), role: properties.role, properties };
				});
				return session
					.run(
						`MATCH (a)-[r]->(b)
						 WHERE (a:StandardLayer AND a._source = $source AND a.layerKey = $layerKey) OR (b:StandardLayer AND b._source = $source AND b.layerKey = $layerKey)
						 RETURN a.stableId AS fromStableId, type(r) AS type, b.stableId AS toStableId, properties(r) AS props,
						        CASE WHEN a:StandardLayer THEN null ELSE { stableId: a.stableId, role: a.role, labels: labels(a), declaredValueList: [oneName IN $baseEndpointPropertyNameList | a[oneName]] } END AS fromBase,
						        CASE WHEN b:StandardLayer THEN null ELSE { stableId: b.stableId, role: b.role, labels: labels(b), declaredValueList: [oneName IN $baseEndpointPropertyNameList | b[oneName]] } END AS toBase
						 ORDER BY fromStableId, type, toStableId`,
						{ ...parameterMap, baseEndpointPropertyNameList },
					)
					.then((edgeResult) => {
						const baseEndpointByStableId = {};
						const edges = edgeResult.records.map((oneRecord) => {
							['fromBase', 'toBase'].forEach((endpointName) => {
								const baseEndpoint = oneRecord.get(endpointName);
								if (baseEndpoint) {
									// the declared properties, each under its own name (R5 S3)
									const { declaredValueList, ...endpointCore } = unwrapProperties(baseEndpoint);
									baseEndpointByStableId[baseEndpoint.stableId] = baseEndpointPropertyNameList.reduce((soFar, oneName, nameIndex) => ({ ...soFar, [oneName]: declaredValueList[nameIndex] }), endpointCore);
								}
							});
							return { type: oneRecord.get('type'), fromStableId: oneRecord.get('fromStableId'), toStableId: oneRecord.get('toStableId'), properties: unwrapProperties(oneRecord.get('props')) };
						});
						const baseQueryRowListByName = {};
						const runBaseQuery = (queryIndex) => {
							if (queryIndex >= baseQueryList.length) {
								finish('', { nodes, edges, baseEndpointByStableId, baseQueryRowListByName });
								return;
							}
							const oneQuery = baseQueryList[queryIndex];
							session
								.run(oneQuery.cypherText, parameterMap)
								.then((queryResult) => {
									baseQueryRowListByName[oneQuery.queryName] = queryResult.records.map((oneRecord) => unwrapProperties(oneRecord.toObject()));
									runBaseQuery(queryIndex + 1);
								})
								.catch((queryError) => finish(`${moduleName} base query '${oneQuery.queryName}' failed: ${queryError.message}`));
						};
						runBaseQuery(0);
					});
			})
			.catch((readError) => finish(`${moduleName} layer read failed: ${readError.message}`));
	};
	const close = (closeCallback) => {
		driver
			.close()
			.then(() => closeCallback(''))
			.catch((closeError) => closeCallback(`${moduleName} driver close failed: ${closeError.message}`));
	};
	callback('', { readLayer, close });
};

module.exports = { openGraphReader, openLayerGraphReader, moduleName };
