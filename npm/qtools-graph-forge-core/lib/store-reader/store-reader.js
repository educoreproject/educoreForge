'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// store-reader — the MODULE INPUT PLANE (forgeArchitectureRefactor SPECIFICATION v2 S4).
//
// Forge modules (the bridgeMaker's uniform-contract modules, S2/S3) never open the store
// or a graph driver themselves: they receive an injected READER. This is the pilot's
// STORE-plane implementation — it reads the WORKING MANIFEST's member blocks (manifest →
// blocks, the same plane as all four existing edf-* tools) and answers synchronously from
// preloaded indexes. A graph-backed reader is a later drop-in behind the SAME interface;
// no module code changes when the transport does (the S4 honesty seam).
//
// R2-3 (load-bearing): the reader is defined OVER THE WORKING MANIFEST STATE and is
// REFRESHED BETWEEN MODULES — the runner constructs a fresh reader from the accumulated
// member list after each module's emissions are appended, so a later module sees earlier
// modules' blocks exactly as a graph-plane module would see their replayed edges.
//
// Interface (S4 minimum):
//   standardsPresent()      -> [{ standardKey, blockId, headerVersion }] (sorted by standardKey)
//   nodesFor(standardKey)   -> [{ stableId, ref, labels, properties, uris, crossRefs, source }]
//                              crossRefs PARSED ({ raw, system, locator }) — modules never
//                              touch the stash encoding.
//   edgesFor(selector)      -> edges of the standard block (selector = standardKey) or of
//                              all pair-scoped member blocks under a pair subject
//                              (selector = 'A::B').
//
// forgeStore is INJECTED already-init'd (the pair-binding / pair-group-mint DI precedent):
// this module holds no db handle and owns no table/file names. Construction is async
// (member block loads); the returned reader is pure + synchronous.

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const replayBlock = require('../replay/replay-block');

// firstValue — PG-JSON single-element [x] -> x (deserializeBlock returns raw property arrays).
const firstValue = (oneVal) => (Array.isArray(oneVal) ? oneVal[0] : oneVal);

// parseCrossRefs — the crossRefs property is a single-element array whose [0] is a JSON
// string (or the literal '[]'). Returns an array of { raw, system, locator } (empty when
// none) or { error } for the caller's error channel. (Re-homed from edfCtdlUriBridge.js —
// the reader owns stash decoding now; S4 'nodes incl. properties + crossRefs'.)
const parseCrossRefs = (properties) => {
	const rawStash = firstValue((properties || {}).crossRefs);
	if (rawStash === undefined || rawStash === null || rawStash === '') {
		return [];
	}
	let parsed;
	if (typeof rawStash === 'string') {
		// the one sanctioned local parse guard (mirrors forge-store's requires guard): a
		// corrupt crossRefs stash surfaces as a named error, never a raw stack.
		let guardError = null;
		const attempt = (() => {
			try {
				return JSON.parse(rawStash);
			} catch (parseErr) {
				guardError = parseErr;
				return null;
			}
		})();
		if (guardError) {
			return { error: `crossRefs stash is not valid JSON: ${guardError.message}` };
		}
		parsed = attempt;
	} else {
		parsed = rawStash;
	}
	return Array.isArray(parsed) ? parsed : [];
};

const moduleFunction =
	({ moduleName } = {}) =>
	({ unused } = {}) => {
		// makeReader — { forgeStore, memberBlockIds } -> (err, reader)
		// memberBlockIds = the WORKING manifest membership (base members + any emissions
		// appended so far). Every member block is loaded + deserialized ONCE here.
		const makeReader = ({ forgeStore, memberBlockIds }, callback) => {
			const standardsByKey = new Map(); // standardKey -> { standardKey, blockId, headerVersion, nodes }
			const edgesByStandardKey = new Map(); // standardKey -> [edge]
			const edgesByPairSubject = new Map(); // 'A::B' -> [edge]

			const taskList = new taskListPlus();

			(memberBlockIds || []).forEach((oneBlockId) => {
				taskList.push((args, next) => {
					forgeStore.getBlock({ blockId: oneBlockId }, (err, row) => {
						if (err) {
							next(`${moduleName}: getBlock('${oneBlockId}') failed: ${err}`, args);
							return;
						}
						if (!row) {
							next(`${moduleName}: working-manifest member block '${oneBlockId}' not found`, args);
							return;
						}
						// deserializeBlock throws LOUD on a corrupt block; convert to the error channel.
						let guardError = null;
						const block = (() => {
							try {
								return replayBlock.deserializeBlock(row.text);
							} catch (deErr) {
								guardError = deErr;
								return null;
							}
						})();
						if (guardError) {
							next(
								`${moduleName}: deserializeBlock('${oneBlockId}') failed: ${guardError.message}`,
								args,
							);
							return;
						}

						if (row.type === 'standard') {
							if (standardsByKey.has(row.subject)) {
								next(
									`${moduleName}: working manifest carries TWO standard blocks for ` +
										`'${row.subject}' (${standardsByKey.get(row.subject).blockId} and ` +
										`${oneBlockId}) — ambiguous standard resolution is a refusal, never a pick`,
									args,
								);
								return;
							}
							const nodes = [];
							let crossRefFailure = null;
							(block.nodes || []).forEach((oneNode) => {
								if (crossRefFailure) {
									return;
								}
								const properties = oneNode.properties || {};
								const crossRefs = parseCrossRefs(properties);
								if (crossRefs && crossRefs.error) {
									crossRefFailure = `node '${oneNode.stableId}' of standard ` +
										`'${row.subject}': ${crossRefs.error}`;
									return;
								}
								nodes.push({
									stableId: oneNode.stableId,
									ref: oneNode.ref,
									labels: oneNode.labels || [],
									properties,
									uris: (properties.uri || []).map((oneUri) => oneUri),
									crossRefs: crossRefs || [],
									source: firstValue(properties._source) || row.subject,
								});
							});
							if (crossRefFailure) {
								next(`${moduleName}: ${crossRefFailure}`, args);
								return;
							}
							standardsByKey.set(row.subject, {
								standardKey: row.subject,
								blockId: oneBlockId,
								headerVersion: block.header ? block.header.version : undefined,
								nodes,
							});
							edgesByStandardKey.set(row.subject, block.edges || []);
							next('', args);
							return;
						}

						// pair-scoped member blocks (structuralBridge / mapping) index under their
						// pair subject; anything else (legacy 'bridge', overlays) under its subject
						// verbatim — the reader surfaces, it never filters.
						const pairKey = row.subject == null ? `(subjectless:${row.type})` : row.subject;
						const existingEdges = edgesByPairSubject.get(pairKey) || [];
						edgesByPairSubject.set(pairKey, existingEdges.concat(block.edges || []));
						next('', args);
					});
				});
			});

			pipeRunner(taskList.getList(), {}, (err) => {
				if (err) {
					callback(err);
					return;
				}

				const standardsPresent = () =>
					Array.from(standardsByKey.values())
						.map(({ standardKey, blockId, headerVersion }) => ({
							standardKey,
							blockId,
							headerVersion,
						}))
						.sort((leftEntry, rightEntry) =>
							leftEntry.standardKey < rightEntry.standardKey
								? -1
								: leftEntry.standardKey > rightEntry.standardKey
									? 1
									: 0,
						);

				const nodesFor = (standardKey) => {
					const entry = standardsByKey.get(standardKey);
					return entry ? entry.nodes : [];
				};

				const edgesFor = (selector) =>
					edgesByStandardKey.get(selector) || edgesByPairSubject.get(selector) || [];

				callback('', { standardsPresent, nodesFor, edgesFor });
			});
		};

		return { makeReader };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
