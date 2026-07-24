'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// decisionFreezer.js — the FREEZE seam of the inferred producer (design §3.5, the freeze that makes an
// LLM-using system reproducible). PURE, deterministic. It takes the raw decisions the inferencePipeline
// emitted (the ONE non-deterministic step, already run) and quarantines them into a CONTENT-ADDRESSED
// `inferredDecision` block: a byte-stable JSON record whose sha256 IS the decisionBlockHash (the pin). A
// plain -build later replays that frozen block through inferredIndex with ZERO LLM calls (§5.5).
//
// It ports the incumbent edf-inferred `serializeDecisions` record shape (recordType 'inferredDecisionRecord',
// method 'definitionEmbedding-opusRerank-v1', decisions sorted by fromStableId) and computes the address via
// the recreation's content-address module (the same sha256(text) the store uses). Byte-stable: sorting the
// decisions means the block is identical whether a run was interrupted or not, and perturbing ANY decision
// changes the hash -> every materialized edge's decisionBlockHash changes -> the fingerprint goes RED (the twin).
//
//   decisionFreezer() -> {
//       freeze({ pairStamp, decisions }) -> { frozenText, decisionBlockHash, inferredDecisions },
//       parse(frozenText)                -> { pairStamp, decisions, inferredDecisions } | { error },
//   }
//
//     pairStamp : { subjectSource, subjectVersion, objectSource, objectVersion } — the pair the decisions
//                 were frozen against (real, resolved versions; the a4a0da2 rule). Carried in the block so a
//                 replay is self-describing.
//     decisions : the pipeline's raw decision rows (abstain + non-abstain).
//     inferredDecisions : the NON-ABSTAIN rows in inferredIndex's input shape
//                 ({ fromStableId, targetKey, confidence, rerankScore, cosineScore, retrievalRank }).
//
// PURE + synchronous + deterministic: no Neo4j, no async, no Date/random, no LLM. camelCase only.
//
// @concept: [[DecisionFreezer]]
// @concept: [[Abstain]]

const path = require('path');

const contentAddress = require(path.join(
	__dirname,
	'..',
	'..',
	'..',
	'..',
	'..',
	'lib',
	'content-address',
	'content-address',
))();

const METHOD = 'definitionEmbedding-opusRerank-v1';

// nonAbstainToMaterializerRow — a picked decision -> the inferredIndex input row. Confidence is the chosen
// candidate's retrieval cosine (the honest numeric signal; the reranker's choice is discrete). Mirrors the
// incumbent edf-inferred -emit materialize mapping.
const nonAbstainToMaterializerRow = (oneDecision) => ({
	fromStableId: oneDecision.fromStableId,
	targetKey: oneDecision.targetKey,
	confidence: typeof oneDecision.cosineScore === 'number' ? oneDecision.cosineScore : null,
	rerankScore: typeof oneDecision.cosineScore === 'number' ? oneDecision.cosineScore : null,
	cosineScore: typeof oneDecision.cosineScore === 'number' ? oneDecision.cosineScore : null,
	retrievalRank: typeof oneDecision.retrievalRank === 'number' ? oneDecision.retrievalRank : null,
});

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => {
		// serializeDecisions — the deterministic JSON body (sorted by source stableId). Ported from the
		// incumbent edf-inferred serializeDecisions; the whole single-line record IS the block's content.
		const serializeDecisions = ({ pairStamp, decisions }) => {
			const stamp = pairStamp || {};
			const sorted = (decisions || [])
				.map((d) => ({
					// the pipeline puts the source under d.source; a replayed row carries fromStableId directly.
					fromStableId: (d.source && d.source.stableId) || d.fromStableId,
					role: (d.source && d.source.role) || d.role || null,
					abstain: !!d.abstain,
					abstainReason: d.abstainReason || null,
					targetKey: d.targetKey || null,
					chosenStableId: d.chosenStableId || null,
					retrievalRank: typeof d.retrievalRank === 'number' ? d.retrievalRank : null,
					cosineScore: typeof d.cosineScore === 'number' ? d.cosineScore : null,
					bestCosine: typeof d.bestCosine === 'number' ? d.bestCosine : null,
					pool: d.pool || null,
				}))
				.sort((a, b) => (a.fromStableId < b.fromStableId ? -1 : a.fromStableId > b.fromStableId ? 1 : 0));
			return JSON.stringify(
				{
					recordType: 'inferredDecisionRecord',
					method: METHOD,
					subjectSource: stamp.subjectSource || null,
					subjectVersion: stamp.subjectVersion || null,
					objectSource: stamp.objectSource || 'CEDS',
					objectVersion: stamp.objectVersion || null,
					decisionCount: sorted.length,
					decisions: sorted,
				},
				null,
				0,
			);
		};

		// freeze — decisions -> content-addressed block. The decisionBlockHash is sha256(frozenText).
		const freeze = ({ pairStamp, decisions } = {}) => {
			const frozenText = serializeDecisions({ pairStamp, decisions });
			const decisionBlockHash = contentAddress.blockIdForText(frozenText);
			const inferredDecisions = (decisions || [])
				.filter((d) => !d.abstain && d.targetKey)
				.map((d) =>
					nonAbstainToMaterializerRow({
						fromStableId: (d.source && d.source.stableId) || d.fromStableId,
						targetKey: d.targetKey,
						cosineScore: d.cosineScore,
						retrievalRank: d.retrievalRank,
					}),
				);
			return { frozenText, decisionBlockHash, inferredDecisions };
		};

		// parse — read a frozen block back (for the materialize path of a plain -build). Errors are VALUES.
		const parse = (frozenText) => {
			let record = null;
			let parseErr = null;
			const attempt = () => {
				record = JSON.parse(`${frozenText}`);
			};
			try {
				attempt();
			} catch (e) {
				parseErr = e;
			}
			if (parseErr) {
				return { error: `${moduleName}: frozen decision block is not valid JSON: ${parseErr.message}` };
			}
			if (!record || record.recordType !== 'inferredDecisionRecord') {
				return {
					error: `${moduleName}: frozen block is not an inferredDecisionRecord (got recordType '${record && record.recordType}').`,
				};
			}
			const decisions = Array.isArray(record.decisions) ? record.decisions : [];
			const inferredDecisions = decisions
				.filter((d) => !d.abstain && d.targetKey)
				.map(nonAbstainToMaterializerRow);
			return {
				pairStamp: {
					subjectSource: record.subjectSource,
					subjectVersion: record.subjectVersion,
					objectSource: record.objectSource,
					objectVersion: record.objectVersion,
				},
				decisions,
				inferredDecisions,
			};
		};

		return { freeze, parse, serializeDecisions };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
