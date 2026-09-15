'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// embedTextPass.js — embedTextNodes, the text pass beside the legacy embed pass (PLAN-forgeEmbedText
// §8.3 R-ET-8, R-ET-18). forge() STEP 6 runs it after embedPass.embedNodes; both are skipped under
// skipEmbedding: true, and the seam's embedCallCount is the SUM of the two passes.
//
// Selects the DmeEmbedText nodes in array order (the framework appends them after the walk's nodes,
// in mint order), takes the first embedNodeLimit when a limit is set, embeds `properties.text` in
// EMBED_BATCH_SIZE batches through the unchanged embedder.embedTexts, and stamps
// properties.textEmbedding = Array.from(vector) and properties.embeddingModelVersion (the ORDINARY
// name, CARRIED from the embed result, as embedPass.js stamps it). It writes nothing to
// `properties.embedding` or to the node's top level: the text vector lives under its own property so
// the graph's `<graph>_vector` index on ForgedNode(embedding) never sees it.
//
// Refuses by name: nodes not an array; an invalid embedNodeLimit; embedder absent; a selected text
// node without a non-empty string `text`; a batch failure with its batch number; vectors.length !==
// texts.length; a missing embeddingModelVersion. The pass never removes or re-orders a node.

const path = require('path');
const { DME_ROLES, EMBED_TEXT_VECTOR } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const refuse = require('./refuse');
const { EMBED_BATCH_SIZE } = require('./embedPass');
const { EMBED_TEXT_PROPERTY_NAME } = require('./embedTextDerivation');

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder, xLog } = {}) => {
		if (!xLog || typeof xLog.status !== 'function') {
			throw refuse.byName({ moduleName, what: 'xLog with a status() channel is required', where: 'the per-batch status line needs a real channel' });
		}

		// standardKey affects only the status/refusal PREFIX text (never data)
		const embedTextNodes = ({ nodes, embedNodeLimit, standardKey } = {}, callback) => {
			const prefixText = typeof standardKey === 'string' && standardKey.length ? `forge-${standardKey}` : moduleName;
			if (!Array.isArray(nodes)) {
				callback(refuse.byName({ moduleName, what: `nodes is ${typeof nodes}, not an array`, where: "pass the forge result's node array" }).message);
				return;
			}
			if (embedNodeLimit !== undefined && (typeof embedNodeLimit !== 'number' || !Number.isInteger(embedNodeLimit) || embedNodeLimit < 0)) {
				callback(refuse.byName({ moduleName, what: `embedNodeLimit is ${JSON.stringify(embedNodeLimit)}`, where: 'embedNodeLimit is a non-negative integer or absent' }).message);
				return;
			}
			if (embedder === null || embedder === undefined || typeof embedder.embedTexts !== 'function') {
				callback(refuse.byName({ moduleName, what: `text embedding requested with embedder ${embedder === null ? 'null' : embedder === undefined ? 'absent' : 'lacking embedTexts'}`, where: 'silence is not consent to spend; pass skipEmbedding: true or inject an Embedder' }).message);
				return;
			}

			const textNodeList = nodes.filter((oneNode) => oneNode.role === DME_ROLES.EMBED_TEXT);
			const targetNodeList =
				embedNodeLimit !== undefined && embedNodeLimit < textNodeList.length
					? textNodeList.slice(0, embedNodeLimit)
					: textNodeList;
			const textlessNode = targetNodeList.find((oneNode) => typeof oneNode.properties[EMBED_TEXT_PROPERTY_NAME] !== 'string' || oneNode.properties[EMBED_TEXT_PROPERTY_NAME].length === 0);
			if (textlessNode !== undefined) {
				callback(refuse.byName({ moduleName, what: `${prefixText} text node '${textlessNode.stableId}' carries text ${JSON.stringify(textlessNode.properties[EMBED_TEXT_PROPERTY_NAME])}`, where: 'a DmeEmbedText node is minted by embedTextDerivation with a non-empty text; nothing else may mint one' }).message);
				return;
			}

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
				const texts = batch.map((oneNode) => oneNode.properties[EMBED_TEXT_PROPERTY_NAME]);
				embedder.embedTexts({ texts }, (embedError, embedResult) => {
					if (embedError) {
						callback(`${prefixText} embedTextNodes batch ${batchIndex} failed: ${embedError}`);
						return;
					}
					if (!embedResult || !Array.isArray(embedResult.vectors) || embedResult.vectors.length !== texts.length) {
						callback(
							refuse.byName({
								moduleName,
								what: `text batch ${batchIndex}: embedder returned ${embedResult && Array.isArray(embedResult.vectors) ? embedResult.vectors.length : 'no'} vectors for ${texts.length} texts`,
								where: 'vectors[i] MUST align 1:1 with texts[i] (interfaces.js Embedder)',
							}).message,
						);
						return;
					}
					if (typeof embedResult.embeddingModelVersion !== 'string' || embedResult.embeddingModelVersion.length === 0) {
						callback(refuse.byName({ moduleName, what: `text batch ${batchIndex}: embedder returned no embeddingModelVersion`, where: 'the model version is CARRIED from the embedder, never invented' }).message);
						return;
					}
					embedCallCount++;
					batch.forEach((oneNode, nodeIndex) => {
						oneNode.properties[EMBED_TEXT_VECTOR.propertyName] = Array.from(embedResult.vectors[nodeIndex]);
						oneNode.properties.embeddingModelVersion = embedResult.embeddingModelVersion;
					});
					xLog.status(`[${prefixText}] embedded text batch ${batchIndex}/${batchList.length} (${batch.length} text nodes)`);
					nextBatch();
				});
			};

			nextBatch();
		};

		return { embedTextNodes };
	};

module.exports = moduleFunction({ moduleName });
