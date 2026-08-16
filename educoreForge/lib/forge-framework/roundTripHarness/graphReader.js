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
							session.close().catch(() => {});
							readCallback(`${moduleName} edge read failed: ${edgeError.message}`);
						});
				})
				.catch((nodeError) => {
					session.close().catch(() => {});
					readCallback(`${moduleName} node read failed: ${nodeError.message}`);
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

module.exports = { openGraphReader, moduleName };
