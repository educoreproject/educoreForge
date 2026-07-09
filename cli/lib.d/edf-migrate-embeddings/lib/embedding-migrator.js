'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// START OF moduleFunction() ============================================================
//
// embedding-migrator — the CORE of the Phase-5 migration (embedding-sidecar PLAN §4 Phase 5,
// §5). Two operations over the blocks of ONE golden manifest, sharing the SAME per-block
// decode + addressing so the census provably exercises the code path the migration uses:
//
//   census({ manifestKey })  — DRY RUN. Decode every standard block's inline base64 embeddings,
//     compute vectorId = contentAddress.vectorIdForInput(modelVersion, searchText) and
//     vectorHash = contentAddress.vectorHashForBytes(rawBytes). Detect COLLISIONS: the same
//     vectorId (same input) arriving with a byte-DIFFERENT vector (drifted historical embedding).
//     Mints NOTHING, writes NOTHING. This is the empirical arbiter of whether input-addressed
//     dedup is lossless on the real historical data (PLAN §3.6 drift caveat).
//
//   migrate({ manifestKey, producedBy, label, note }) — for every standard block: putVector each
//     DISTINCT (modelVersion, searchText) inline vector VERBATIM (reuse the historical bytes — NO
//     embedder call) into that standard's per-standard sidecar store, rewrite each embedded node
//     line to embeddingRef (drop the inline embedding), re-serialize -> a NEW blockId (the base64
//     vector is gone from the hashed text), and saveSchemaBlock it. Then combine(base=golden,
//     set=new standard blockIds) -> a NEW immutable manifest generation. Blocks are immutable and
//     content-addressed, so the old blocks + manifest are RETAINED untouched (rollback). Only
//     STANDARD blocks carry embeddings (recon-verified), so all other block types pass through.
//
// Idempotent/resumable: saveSchemaBlock dedups on blockId, putVector is insert-or-ignore, the
// manifestKey is derived — re-running yields identical blockIds/vectors/manifestKey.
//
// Injected (curried constructor injection, mirrors manifest-editor's DI): { forgeStore,
// manifestEditor, openVectorStoreForStandard, replayBlock, contentAddress,
// eachEntrySequentialStackSafe, xLog }. Holds no db handle and owns no file/table names.
//
// Async style (project doctrine): callback + error-first + qtools-asynchronous-pipe-plus; NO
// async/await, NO try/catch for control flow (the ONE sanctioned exception is the library-boundary
// deserializeBlock parse in safeDeserializeBlock, mirroring manifest-editor's blockMetaFromHeader).

const moduleFunction =
	({ moduleName } = {}) =>
	(injectedDeps = {}) => {
		const {
			forgeStore,
			manifestEditor,
			openVectorStoreForStandard,
			replayBlock,
			contentAddress,
			eachEntrySequentialStackSafe,
			xLog,
		} = injectedDeps;

		const EMBEDDED_BLOCK_TYPE = 'standard'; // recon-verified: only standard blocks carry embeddings

		// -----
		// firstValue — a PG-JSON property value is a multi-valued array; the scalar we want is [0].
		const firstValue = (propertyValue) =>
			Array.isArray(propertyValue) ? propertyValue[0] : undefined;

		// -----
		// safeDeserializeBlock — the ONE sanctioned local try/catch: deserializeBlock throws on a
		// malformed block (library boundary), so isolate that throw into a named { error } for the
		// caller's error channel, exactly as manifest-editor.blockMetaFromHeader isolates JSON.parse.
		const safeDeserializeBlock = (blockText) => {
			try {
				return replayBlock.deserializeBlock(blockText);
			} catch (deserializeErr) {
				return { error: deserializeErr.message };
			}
		};

		// -----
		// blockHasInlineEmbedding — cheap guard so passthrough blocks are never deserialized. The
		// serialized inline embedding field is the exact token `"embedding":` (embeddingRef and
		// embeddingModelVersion do not contain it).
		const blockHasInlineEmbedding = (row) =>
			!!row && row.type === EMBEDDED_BLOCK_TYPE && !!row.text && row.text.indexOf('"embedding":') !== -1;

		// -----
		// vectorFacetsForNode — the shared per-node addressing both operations use. Returns
		//   { skip:true } for a non-embedded node,
		//   { error } when an embedded node lacks searchText (the recon invariant is violated),
		//   { vectorId, vectorHash, modelVersion, searchText, vector } otherwise.
		// vectorHash is sha256 of the SAME raw little-endian float32 bytes putVector will store, so a
		// census vectorHash is byte-comparable to the store's — computed by round-tripping the decoded
		// number[] through encodeEmbedding (base64 of float32 LE) back to bytes, matching
		// vector-store.encodeVectorBlob's byte layout exactly.
		const vectorFacetsForNode = (node, header) => {
			if (!Array.isArray(node.embedding)) {
				return { skip: true };
			}
			const searchText = firstValue(node.properties && node.properties.searchText);
			const modelVersion = node.embeddingModelVersion || header.embeddingModelVersion;
			if (searchText == null) {
				return {
					error: `node '${node.stableId}' carries an inline embedding but no searchText — cannot compute embeddingRef`,
				};
			}
			const vectorId = contentAddress.vectorIdForInput(modelVersion, searchText);
			const rawBytes = Buffer.from(replayBlock.encodeEmbedding(node.embedding), 'base64');
			const vectorHash = contentAddress.vectorHashForBytes(rawBytes);
			return { vectorId, vectorHash, modelVersion, searchText, vector: node.embedding };
		};

		// -----
		// loadManifestBlocks — { manifestKey } -> [{ blockId, row }] (row = full getBlock result,
		// verify-on-read already applied by forge-store). Members loaded sequentially; small (a golden
		// is ~28 members) so a taskListPlus fan-in is fine.
		const loadManifestBlocks = (manifestKey, callback) => {
			forgeStore.getManifest({ manifestKey }, (manifestErr, manifest) => {
				if (manifestErr) {
					callback(manifestErr);
					return;
				}
				if (!manifest) {
					callback(`${moduleName}: no manifest '${manifestKey}'`);
					return;
				}
				const members = manifest.members || [];
				const loaded = [];
				const taskList = new taskListPlus();
				members.forEach((oneMember) => {
					taskList.push((args, next) => {
						forgeStore.getBlock({ blockId: oneMember.blockId }, (blockErr, row) => {
							if (blockErr) {
								next(blockErr, args);
								return;
							}
							loaded.push({ blockId: oneMember.blockId, row });
							next('', args);
						});
					});
				});
				pipeRunner(taskList.getList(), {}, (err) => callback(err, err ? undefined : loaded));
			});
		};

		// =====================================================================
		// CENSUS — dry-run collision scan. Mints nothing, writes nothing.
		// =====================================================================
		const census = ({ manifestKey }, callback) => {
			loadManifestBlocks(manifestKey, (loadErr, blocks) => {
				if (loadErr) {
					callback(loadErr);
					return;
				}

				const vectorIdSeen = new Map(); // vectorId -> { vectorHash, standardKey, searchText }
				const collisions = [];
				const missingSearchText = [];
				const perStandard = {}; // standardKey -> { embeddedNodes, distinctVectorIds:Set }
				let totalEmbeddedNodes = 0;
				let deserializeError = '';

				blocks.forEach(({ row }) => {
					if (deserializeError || !blockHasInlineEmbedding(row)) {
						return;
					}
					const parsed = safeDeserializeBlock(row.text);
					if (parsed.error) {
						deserializeError = `census: block ${row.blockId} (${row.subject}): ${parsed.error}`;
						return;
					}
					const { header, nodes } = parsed;
					const standardKey = header.standardKey;
					if (!perStandard[standardKey]) {
						perStandard[standardKey] = { embeddedNodes: 0, distinctVectorIds: new Set() };
					}
					nodes.forEach((node) => {
						const facets = vectorFacetsForNode(node, header);
						if (facets.skip) {
							return;
						}
						totalEmbeddedNodes += 1;
						perStandard[standardKey].embeddedNodes += 1;
						if (facets.error) {
							missingSearchText.push({ standardKey, detail: facets.error });
							return;
						}
						perStandard[standardKey].distinctVectorIds.add(facets.vectorId);
						const seen = vectorIdSeen.get(facets.vectorId);
						if (!seen) {
							vectorIdSeen.set(facets.vectorId, {
								vectorHash: facets.vectorHash,
								standardKey,
								searchText: facets.searchText,
							});
						} else if (seen.vectorHash !== facets.vectorHash) {
							collisions.push({
								vectorId: facets.vectorId,
								searchText: facets.searchText,
								firstStandardKey: seen.standardKey,
								firstVectorHash: seen.vectorHash,
								collidingStandardKey: standardKey,
								collidingVectorHash: facets.vectorHash,
							});
						}
					});
				});

				if (deserializeError) {
					callback(deserializeError);
					return;
				}

				const perStandardReport = {};
				Object.keys(perStandard).forEach((oneStandardKey) => {
					perStandardReport[oneStandardKey] = {
						embeddedNodes: perStandard[oneStandardKey].embeddedNodes,
						distinctVectors: perStandard[oneStandardKey].distinctVectorIds.size,
					};
				});

				callback('', {
					manifestKey,
					standardBlocksScanned: blocks.filter((oneBlock) => blockHasInlineEmbedding(oneBlock.row)).length,
					totalEmbeddedNodes,
					distinctVectorIds: vectorIdSeen.size,
					collisionCount: collisions.length,
					collisions,
					missingSearchTextCount: missingSearchText.length,
					missingSearchText,
					perStandard: perStandardReport,
				});
			});
		};

		// =====================================================================
		// MIGRATE — mint per-standard sidecar stores + a new manifest generation.
		// =====================================================================

		// migrateOneBlock — decode, putVector each distinct vector VERBATIM, rewrite node lines to
		// embeddingRef, re-serialize, saveSchemaBlock -> new blockId. Returns the change record.
		// producedBy is metadata (NOT in the hashed block text -> does not affect blockId); when the
		// caller supplies one it stamps migration provenance, else the original block's is preserved.
		const migrateOneBlock = ({ oldBlockId, row, producedBy }, callback) => {
			const parsed = safeDeserializeBlock(row.text);
			if (parsed.error) {
				callback(`migrate: block ${oldBlockId} (${row.subject}): ${parsed.error}`);
				return;
			}
			const { header, nodes, edges } = parsed;
			const standardKey = header.standardKey;

			// CANONICALIZATION (TQ ruling 2026-07-09, option a — deterministic first-write-wins). Nodes are
			// visited in BLOCK LINE ORDER (deserializeBlock preserves it) and distinctByVectorId keeps the
			// FIRST vector seen for each vectorId; every later node with the same vectorId is rewritten to
			// that SAME embeddingRef, so a historically-drifted duplicate (census collision) is canonicalized
			// to the first-seen vector. This is intra-standard by construction (one standard per block ->
			// one per-standard store), so first-seen is deterministic and the whole migration is REPRODUCIBLE
			// (re-run -> identical stored vectors, blockIds, manifestKey). It realizes the one-text-one-vector
			// invariant on legacy data that predates the caching embedder; a fresh cached forge never drifts.
			const distinctByVectorId = new Map(); // vectorId -> { modelVersion, inputText, vector }
			let embeddedNodes = 0;
			let facetError = '';

			nodes.forEach((node) => {
				if (facetError) {
					return;
				}
				const facets = vectorFacetsForNode(node, header);
				if (facets.skip) {
					return;
				}
				if (facets.error) {
					facetError = `migrate: block ${oldBlockId} (${standardKey}): ${facets.error}`;
					return;
				}
				embeddedNodes += 1;
				if (!distinctByVectorId.has(facets.vectorId)) {
					distinctByVectorId.set(facets.vectorId, {
						modelVersion: facets.modelVersion,
						inputText: facets.searchText,
						vector: facets.vector,
					});
				}
				// rewrite the node line: embeddingRef supersedes the inline embedding (serializeNodeLine
				// gives embeddingRef precedence and drops the inline scalar). Same stable field position.
				node.embeddingRef = facets.vectorId;
				node.embedding = null;
			});

			if (facetError) {
				callback(facetError);
				return;
			}

			openVectorStoreForStandard(standardKey, (storeErr, vectorStore) => {
				if (storeErr) {
					callback(`migrate: block ${oldBlockId} (${standardKey}): ${storeErr}`);
					return;
				}
				const distinctEntries = Array.from(distinctByVectorId.values());
				eachEntrySequentialStackSafe(
					distinctEntries,
					(oneEntry, entryDone) => vectorStore.putVector(oneEntry, entryDone),
					(putErr) => {
						if (putErr) {
							callback(`migrate: block ${oldBlockId} (${standardKey}) putVector: ${putErr}`);
							return;
						}
						const newText = replayBlock.serializeBlock({ header, nodes, edges });
						manifestEditor.saveSchemaBlock(
							{
								type: row.type,
								subject: row.subject,
								version: row.version,
								requires: row.requires,
								text: newText,
								producedBy: producedBy != null ? producedBy : row.producedBy,
							},
							(saveErr, saveResult) => {
								if (saveErr) {
									callback(saveErr);
									return;
								}
								callback('', {
									standardKey,
									oldBlockId,
									newBlockId: saveResult.blockId,
									embeddedNodes,
									distinctVectors: distinctEntries.length,
								});
							},
						);
					},
				);
			});
		};

		const migrate = ({ manifestKey, label, note, producedBy }, callback) => {
			loadManifestBlocks(manifestKey, (loadErr, blocks) => {
				if (loadErr) {
					callback(loadErr);
					return;
				}
				const changedBlocks = [];
				const taskList = new taskListPlus();

				blocks.forEach(({ blockId, row }) => {
					taskList.push((args, next) => {
						if (!blockHasInlineEmbedding(row)) {
							next('', args); // passthrough: no embeddings -> unchanged, keeps its blockId
							return;
						}
						migrateOneBlock({ oldBlockId: blockId, row, producedBy }, (blockErr, changeRecord) => {
							if (blockErr) {
								next(blockErr, args);
								return;
							}
							if (xLog) {
								xLog.status(
									`  migrated ${changeRecord.standardKey}: ${changeRecord.embeddedNodes} embedded nodes, ` +
										`${changeRecord.distinctVectors} distinct vectors -> ${changeRecord.newBlockId.slice(0, 12)}…`,
								);
							}
							changedBlocks.push(changeRecord);
							next('', args);
						});
					});
				});

				pipeRunner(taskList.getList(), {}, (blockErr) => {
					if (blockErr) {
						callback(blockErr);
						return;
					}
					const newBlockIds = changedBlocks.map((oneChange) => oneChange.newBlockId);
					manifestEditor.combine(
						{ base: manifestKey, set: newBlockIds, label, note },
						(combineErr, combineResult) => {
							if (combineErr) {
								callback(combineErr);
								return;
							}
							callback('', {
								sourceManifestKey: manifestKey,
								newManifestKey: combineResult.manifestKey,
								memberCount: combineResult.memberCount,
								changedBlockCount: changedBlocks.length,
								changedBlocks,
							});
						},
					);
				});
			});
		};

		return { census, migrate };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
