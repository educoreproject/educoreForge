'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// embedPass.js — embed.embedNodes, census D5–D7 made ONE (SPEC-forgeFramework-v1.md §6.3; Profile
// §4.7). Filter by nonEmbeddableRoleList FIRST (CEDS), THEN slice to nodeSubsetLimit in emission
// order, chunk by EMBED_BATCH_SIZE, serial recursion, embedder.embedTexts({ texts }, cb), stamp
// properties.embedding = Array.from(vectors[i]), mirror to node.embedding, stamp
// embeddingModelVersion on BOTH the node and its properties from embedResult (CARRIED, never
// invented), count embedCallCount, one status line per batch (forgeEdfi.js:61-105, the compound
// names kept). The pass NEVER removes a node from the array and NEVER re-orders it.
//
// Refuses by name: embedder null with embedding requested; a batch failure with its batch number;
// vectors.length !== texts.length (interfaces.js:249-251); a missing embeddingModelVersion.
//
// The role filter is the caller's list UNIONED with the framework-owned roles
// (frameworkNonEmbeddableRoles.js, R-ET-3), computed HERE because the public embed.embedNodes export
// takes a caller list: a DmeEmbedText node (no searchText) never reaches embedTexts through this pass.
// Its text is embedded by embedTextPass.js under textEmbedding.

const refuse = require('./refuse');
const { effectiveNonEmbeddableRoleList } = require('./frameworkNonEmbeddableRoles');

const EMBED_BATCH_SIZE = 128; // the ONE copy (D6): forgeCeds.js:73, forgeEdfi.js:49, forgeSif.js:64, forgePesc260805.js:61

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder, xLog } = {}) => {
		if (!xLog || typeof xLog.status !== 'function') {
			throw refuse.byName({ moduleName, what: 'xLog with a status() channel is required', where: 'the per-batch status line needs a real channel' });
		}

		// standardKey is OPTIONAL and affects only the status/refusal PREFIX text (never data): the
		// bundle's forge() passes its own; a caller of the surface export may omit it
		const embedNodes = ({ nodes, nodeSubsetLimit, nonEmbeddableRoleList, standardKey } = {}, callback) => {
			const prefixText = typeof standardKey === 'string' && standardKey.length ? `forge-${standardKey}` : moduleName;
			if (!Array.isArray(nodes)) {
				callback(refuse.byName({ moduleName, what: `nodes is ${typeof nodes}, not an array`, where: 'pass the walk\'s node array in emission order' }).message);
				return;
			}
			if (!Array.isArray(nonEmbeddableRoleList)) {
				callback(refuse.byName({ moduleName, what: 'nonEmbeddableRoleList is not an array', where: 'the declaration\'s nonEmbeddableRoleList (may be [])' }).message);
				return;
			}
			if (nodeSubsetLimit !== undefined && (typeof nodeSubsetLimit !== 'number' || !Number.isInteger(nodeSubsetLimit) || nodeSubsetLimit < 0)) {
				callback(refuse.byName({ moduleName, what: `nodeSubsetLimit is ${JSON.stringify(nodeSubsetLimit)}`, where: 'embedNodeLimit is a non-negative integer or absent' }).message);
				return;
			}
			if (embedder === null || embedder === undefined || typeof embedder.embedTexts !== 'function') {
				callback(refuse.byName({ moduleName, what: `embedding requested with embedder ${embedder === null ? 'null' : embedder === undefined ? 'absent' : 'lacking embedTexts'}`, where: "silence is not consent to spend; pass skipEmbedding: true or inject an Embedder" }).message);
				return;
			}

			// FILTER by role first (a non-embeddable node keeps its place and carries no vector), THEN
			// slice to the limit in emission order (FR20)
			const passNonEmbeddableRoleList = effectiveNonEmbeddableRoleList({ nonEmbeddableRoleList });
			const embeddableNodeList = nodes.filter((oneNode) => passNonEmbeddableRoleList.indexOf(oneNode.role) === -1);
			const targetNodeList =
				nodeSubsetLimit !== undefined && nodeSubsetLimit < embeddableNodeList.length
					? embeddableNodeList.slice(0, nodeSubsetLimit)
					: embeddableNodeList;

			const batchList = [];
			for (let batchStart = 0; batchStart < targetNodeList.length; batchStart += EMBED_BATCH_SIZE) {
				batchList.push(targetNodeList.slice(batchStart, batchStart + EMBED_BATCH_SIZE));
			}

			let embedCallCount = 0;
			let batchIndex = 0;

			const nextBatch = () => {
				if (batchIndex >= batchList.length) {
					callback('', { embedCallCount, embeddedCount: targetNodeList.length });
					return;
				}
				const batch = batchList[batchIndex];
				batchIndex++;
				const texts = batch.map((oneNode) => oneNode.properties.searchText);
				embedder.embedTexts({ texts }, (embedError, embedResult) => {
					if (embedError) {
						callback(`${prefixText} embedNodes batch ${batchIndex} failed: ${embedError}`);
						return;
					}
					if (!embedResult || !Array.isArray(embedResult.vectors) || embedResult.vectors.length !== texts.length) {
						callback(
							refuse.byName({
								moduleName,
								what: `batch ${batchIndex}: embedder returned ${embedResult && Array.isArray(embedResult.vectors) ? embedResult.vectors.length : 'no'} vectors for ${texts.length} texts`,
								where: 'vectors[i] MUST align 1:1 with texts[i] (interfaces.js Embedder)',
							}).message,
						);
						return;
					}
					if (typeof embedResult.embeddingModelVersion !== 'string' || embedResult.embeddingModelVersion.length === 0) {
						callback(refuse.byName({ moduleName, what: `batch ${batchIndex}: embedder returned no embeddingModelVersion`, where: 'the model version is CARRIED from the embedder, never invented' }).message);
						return;
					}
					embedCallCount++;
					batch.forEach((oneNode, nodeIndex) => {
						oneNode.properties.embedding = Array.from(embedResult.vectors[nodeIndex]);
						oneNode.embedding = oneNode.properties.embedding; // for serializeBlock
						oneNode.embeddingModelVersion = embedResult.embeddingModelVersion;
						oneNode.properties.embeddingModelVersion = embedResult.embeddingModelVersion;
					});
					xLog.status(`[${prefixText}] embedded batch ${batchIndex}/${batchList.length} (${batch.length} nodes)`);
					nextBatch();
				});
			};

			nextBatch();
		};

		return { embedNodes };
	};

module.exports = moduleFunction({ moduleName });
module.exports.EMBED_BATCH_SIZE = EMBED_BATCH_SIZE;
