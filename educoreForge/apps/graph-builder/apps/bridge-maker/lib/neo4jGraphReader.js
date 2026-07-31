'use strict';

// neo4jGraphReader — the DEFAULT graphReader: the real read-from-graph substrate bridgeMaker mints per
// run from the GraphHandle, the READ twin of neo4jGraphWriter. An authored producer needs to WALK the
// materialized dependency graph — its source-standard nodes, the CEDS HubReference nodes, the CEDS
// standard DmeOptionValue rows — before it can author a single edge; this is how it reads them. It is the
// production twin of the graphReader DOUBLE the suite injects (test-ctdl-authored-bridge.js): both satisfy
// the same tiny contract, so the producer's read path is proven with a double and NO container (§3 hard
// line 2 — the suite never opens a database).
//
//   neo4jGraphReader({ inGraph }) -> {
//       readNodes({ label, propertyEquals }, callback('', { nodes: [{ stableId, properties }] }))
//       close(callback(''))
//   }
//
// readNodes selects :label nodes whose given scalar properties equal the requested values and returns
// each as { stableId, properties } with SCALAR property values (the live graph stores scalars — the
// forge's PG-JSON arrays were collapsed at replay MERGE). It opens ONE driver lazily on the first read
// (the same idiom neo4jGraphWriter and replayManager use — a handle carries its own credential and
// nothing else does) but a SESSION PER readNodes CALL: since the bounded-concurrency judging change
// (P8, 2026-07-30) up to EVIDENCE_JUDGE_CONCURRENCY walk hooks share this ONE reader concurrently, and
// a neo4j session is a sequential container not safe for overlapping runs — per-call sessions ride the
// driver's connection pool (neo4j's own documented pattern; sessions are cheap). close() closes the
// driver and is safe whether or not a connection was ever opened.
//
// `label` is interpolated (a Cypher label position cannot be parameterized) so it is validated as a bare
// identifier first — the same injection guard neo4jGraphWriter applies. propertyEquals VALUES are
// parameterized; its KEYS are validated as bare identifiers (a property name is also interpolated into
// the WHERE). A bad interpolation target is refused BY VALUE, never sanitized into (polyArch2 §6).

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ inGraph } = {}) => {
		let driver = null;

		const ensureDriver = () => {
			if (driver) {
				return;
			}
			const neo4j = require('neo4j-driver');
			driver = neo4j.driver(inGraph.boltUrl, neo4j.auth.basic('neo4j', inGraph.password), {
				encrypted: false,
			});
		};

		const readNodes = ({ label = 'ForgedNode', propertyEquals = {} } = {}, callback) => {
			if (!IDENTIFIER_RE.test(String(label || ''))) {
				callback(
					`${moduleName}: label '${label}' is not a bare identifier (a Cypher label position is ` +
						`interpolated, not parameterized, so it must be safe).`,
				);
				return;
			}
			const propertyKeys = Object.keys(propertyEquals);
			const badKey = propertyKeys.find((oneKey) => !IDENTIFIER_RE.test(oneKey));
			if (badKey) {
				callback(
					`${moduleName}: propertyEquals key '${badKey}' is not a bare identifier (a property name is ` +
						`interpolated into the WHERE, not parameterized).`,
				);
				return;
			}

			ensureDriver();

			const whereClause = propertyKeys.length
				? 'WHERE ' + propertyKeys.map((oneKey) => `n.\`${oneKey}\` = $${oneKey}`).join(' AND ')
				: '';
			const cypher = `MATCH (n:\`${label}\`)\n${whereClause}\nRETURN n.stableId AS stableId, properties(n) AS properties`;

			// one session per read (see header): the session is closed on BOTH outcomes before the
			// callback fires, and a close failure after a good read is reported honestly, never swallowed.
			const readSession = driver.session();
			const finish = (errString, payload) => {
				readSession.close().then(
					() => callback(errString, payload),
					(closeError) =>
						callback(
							errString || `${moduleName}: closing read session failed: ${closeError.message}`,
							payload,
						),
				);
			};
			readSession
				.run(cypher, propertyEquals)
				.then((queryResult) => {
					const nodes = queryResult.records.map((oneRecord) => ({
						stableId: oneRecord.get('stableId'),
						properties: oneRecord.get('properties') || {},
					}));
					finish('', { nodes });
				})
				.catch((error) => finish(`${moduleName}: reading :${label} nodes failed: ${error.message}`));
		};

		const close = (callback) => {
			if (!driver) {
				callback('');
				return;
			}
			driver
				.close()
				.then(() => callback(''))
				.catch((error) => callback(`${moduleName}: closing graph reader failed: ${error.message}`));
		};

		return { readNodes, close };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
