'use strict';

// evidenceFreezer.js — bridge-maker/lib NEW (bridgeEvidenceRefactor-spec.md §3, ⟪A6⟫; P2 deliverable).
// FREEZE-THE-EVIDENCE: a decision block that self-describes its own `generation` and
// `rendererVersion` alongside the `frozenEvidence` gathered for it (⟪A6⟫ — "blocks self-describe"),
// so a reader never has to INFER what generation or renderer produced a frozen block.
//
// COEXISTENCE — lib/decisionFreezer.js is byte-untouched. This is a NEW function/mode beside it, not
// a mutation: decisionFreezer.freeze/parse keep serializing the SAME 'inferredDecisionRecord' shape
// they always have, for every existing bridge that calls them; every bridge freezing a plain scalar
// decision today keeps working exactly as it does. This module serializes a DIFFERENT record type
// ('evidenceDecisionRecord') carrying the ⟪A6⟫ additions decisionFreezer's record has no room for.
// Wiring this into bridgeSkeleton's freeze move (replacing/augmenting `moves.freeze` for a run that
// actually gathers evidence packages) is P3/P4 scope, same reasoning as evidenceComposer.js's own
// placement note: the pieces this composes WITH (the real hub module, the renderer, generic select)
// don't exist yet in P2.
//
//   evidenceFreezer() -> {
//       freeze({ pairStamp, decisions, generation, rendererVersion, evidencePackages })
//         -> decisionBlock: { frozenText, decisionBlockHash, inferredDecisions,
//                             generation, rendererVersion, frozenEvidence }
//            — passes freezeAdditionsViolation (evidenceContracts.js ⟪A6⟫ gate) by construction;
//              freeze() itself THROWS if it would not (a call-time wiring fault: generation/
//              rendererVersion are REQUIRED, exactly the "throws, uncaught, named" contract this
//              tree's other construction/call-time invariants already use — e.g.
//              defaultMatchMove/kitLoader.buildKit), never silently emitting a block that would fail
//              its own oracle downstream.
//       parse(frozenText) -> decisionBlock (same shape, + pairStamp/decisions) | { error }
//            — errors are VALUES here (matching decisionFreezer.parse's own convention), never thrown;
//              a caller replaying a pair reads `.error` and decides, exactly as the materialize path
//              already does for decisionFreezer.parse().
//   }
//
// REPLAY NEVER RE-WALKS (⟪A6⟫ / spec §3's whole point of freezing): `frozenEvidence` is embedded
// VERBATIM in the frozen JSON text at freeze() time and read back EXACTLY at parse() time — never
// recomputed by calling hubModule/graphReader/a walk hook again. test-evidenceFreezer.js's
// byte-identity assertion is the proof: JSON.stringify(parse(freeze(...).frozenText).frozenEvidence)
// === JSON.stringify(the evidencePackages handed to freeze()).
//
// Content-addressed the SAME way decisionFreezer is: sha256 of the exact frozen JSON bytes via the
// shared content-address module (the identical hash decision-store.js recomputes on every read).
//
// PURE + synchronous + deterministic: no Neo4j, no async, no Date/random, no LLM. camelCase only.

const path = require('path');

// 5 levels up from apps/graph-builder/apps/bridge-maker/lib to the tree root — the SAME depth
// lib/decisionFreezer.js (this directory's other freeze module) uses to reach lib/content-address.
const contentAddress = require(
	path.join(__dirname, '..', '..', '..', '..', '..', 'lib', 'content-address', 'content-address'),
)();

const { freezeAdditionsViolation } = require('./evidenceContracts');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const RECORD_TYPE = 'evidenceDecisionRecord';

// nonAbstainRow — the materializer input row a non-abstaining decision reduces to. Mirrors
// decisionFreezer's own nonAbstainToMaterializerRow shape (fromStableId, targetKey, cosineScore,
// retrievalRank) so a future shared materializer can consume either freezer's output identically.
const nonAbstainRow = ({ fromStableId, targetKey, cosineScore, retrievalRank }) => ({
	fromStableId,
	targetKey,
	cosineScore: typeof cosineScore === 'number' ? cosineScore : null,
	retrievalRank: typeof retrievalRank === 'number' ? retrievalRank : null,
});

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => {
		// serialize — deterministic JSON body. decisions sorted by fromStableId (decisionFreezer's own
		// discipline, carried here identically) so the block is byte-stable regardless of gather order;
		// frozenEvidence rides through VERBATIM, never re-derived, never reordered.
		const serialize = ({ pairStamp, decisions, generation, rendererVersion, evidencePackages }) => {
			const stamp = pairStamp || {};
			const sortedDecisions = (decisions || [])
				.map((oneDecision) => ({
					fromStableId: (oneDecision.source && oneDecision.source.stableId) || oneDecision.fromStableId,
					role: (oneDecision.source && oneDecision.source.role) || oneDecision.role || null,
					abstain: !!oneDecision.abstain,
					abstainReason: oneDecision.abstainReason || null,
					targetKey: oneDecision.targetKey || null,
					chosenStableId: oneDecision.chosenStableId || null,
					retrievalRank: typeof oneDecision.retrievalRank === 'number' ? oneDecision.retrievalRank : null,
					cosineScore: typeof oneDecision.cosineScore === 'number' ? oneDecision.cosineScore : null,
				}))
				.sort((first, second) => (first.fromStableId < second.fromStableId ? -1 : first.fromStableId > second.fromStableId ? 1 : 0));
			return JSON.stringify(
				{
					recordType: RECORD_TYPE,
					subjectSource: stamp.subjectSource || null,
					subjectVersion: stamp.subjectVersion || null,
					objectSource: stamp.objectSource || null,
					objectVersion: stamp.objectVersion || null,
					generation: generation || null,
					rendererVersion: rendererVersion || null,
					decisionCount: sortedDecisions.length,
					decisions: sortedDecisions,
					frozenEvidence: evidencePackages,
				},
				null,
				0,
			);
		};

		// freeze — decisions + evidence -> a content-addressed, self-describing decision block.
		// THROWS (call-time wiring fault, uncaught, named) when generation/rendererVersion are not
		// given: these are the ⟪A6⟫ self-description fields, not optional decoration.
		const freeze = ({ pairStamp, decisions, generation, rendererVersion, evidencePackages } = {}) => {
			if (typeof generation !== 'string' || !generation.trim()) {
				throw new Error(
					`${moduleName}.freeze: generation is not given — ⟪A6⟫ requires every frozen block to ` +
						`self-describe its generation; there is no default.`,
				);
			}
			if (typeof rendererVersion !== 'string' || !rendererVersion.trim()) {
				throw new Error(
					`${moduleName}.freeze: rendererVersion is not given — ⟪A6⟫ requires every frozen block ` +
						`to self-describe the renderer version it was rendered with; there is no default.`,
				);
			}
			const frozenText = serialize({ pairStamp, decisions, generation, rendererVersion, evidencePackages });
			const decisionBlockHash = contentAddress.blockIdForText(frozenText);
			const inferredDecisions = (decisions || [])
				.filter((oneDecision) => !oneDecision.abstain && oneDecision.targetKey)
				.map((oneDecision) =>
					nonAbstainRow({
						fromStableId: (oneDecision.source && oneDecision.source.stableId) || oneDecision.fromStableId,
						targetKey: oneDecision.targetKey,
						cosineScore: oneDecision.cosineScore,
						retrievalRank: oneDecision.retrievalRank,
					}),
				);
			const decisionBlock = {
				frozenText,
				decisionBlockHash,
				inferredDecisions,
				generation,
				rendererVersion,
				frozenEvidence: evidencePackages,
			};
			const violation = freezeAdditionsViolation(decisionBlock);
			if (violation) {
				// belt-and-suspenders: the two explicit checks above should make this unreachable, but a
				// self-gating module never trusts its own reachability analysis over its own oracle.
				throw new Error(`${moduleName}.freeze: produced a decision block that fails its own ⟪A6⟫ gate: ${violation}`);
			}
			return decisionBlock;
		};

		// parse — read a frozen block back. Errors are VALUES (decisionFreezer.parse's own convention),
		// never thrown. Never re-derives frozenEvidence — reads it back exactly as frozen (replay never
		// re-walks).
		const parse = (frozenText) => {
			let record = null;
			try {
				record = JSON.parse(`${frozenText}`);
			} catch (parseError) {
				return { error: `${moduleName}: frozen decision block is not valid JSON: ${parseError.message}` };
			}
			if (!record || record.recordType !== RECORD_TYPE) {
				return {
					error: `${moduleName}: frozen block is not a ${RECORD_TYPE} (got recordType '${record && record.recordType}').`,
				};
			}
			const decisions = Array.isArray(record.decisions) ? record.decisions : [];
			const inferredDecisions = decisions.filter((oneDecision) => !oneDecision.abstain && oneDecision.targetKey).map(nonAbstainRow);
			const decisionBlock = {
				pairStamp: {
					subjectSource: record.subjectSource,
					subjectVersion: record.subjectVersion,
					objectSource: record.objectSource,
					objectVersion: record.objectVersion,
				},
				decisions,
				inferredDecisions,
				generation: record.generation,
				rendererVersion: record.rendererVersion,
				frozenEvidence: record.frozenEvidence,
			};
			const violation = freezeAdditionsViolation(decisionBlock);
			if (violation) {
				return { error: `${moduleName}: parsed decision block fails its own ⟪A6⟫ gate: ${violation}` };
			}
			return decisionBlock;
		};

		return { freeze, parse };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
module.exports.RECORD_TYPE = RECORD_TYPE;
