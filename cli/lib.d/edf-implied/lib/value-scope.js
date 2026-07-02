'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// value-scope.js — CODESET-VALUE (PLAN-codesetValueMatching-070126.md Phase C) scoping helpers for the
// INFERRED value-tier track. Implements PLAN §5's gate: a source option value is ONLY offered to the
// reranker within the option set of its OWN parent property's ALREADY-MATCHED CEDS target — never a
// global retrieve among the full ~19,546 CEDS option values. A source whose parent property has no match,
// or whose matched CEDS property has no option set, is UNSCOPABLE and MUST abstain (never global-retrieve
// as a hidden default — PLAN §5 rule 3).
//
// Pure + synchronous: builds in-memory indexes from already-deserialized block records (node-loader.js
// collapseNodes output) and already-materialized mapping-block edges. No graph/network access. camelCase.
//
// @concept: [[CodesetValueMatching]]
// @concept: [[ScopedInferredValueMatching]]

const v1 = (arrayOrScalar) => (Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar);

// buildPropertyRangeOptionSetIndex — CEDS reference block's UNQUALIFIED property-tier HubReference nodes:
// propertyKey -> rangeOptionSetId. (Same shape as edf-mapping/lib/value-crosswalk.js's index of the same
// name — duplicated here, not required, to keep edf-implied's lib/ self-contained the way node-loader.js
// already is; both read the identical reference-block property shape.)
const buildPropertyRangeOptionSetIndex = (referenceNodes) => {
	const index = {};
	(referenceNodes || []).forEach((oneNode) => {
		const props = oneNode.properties || {};
		const role = v1(props.role);
		const tier = v1(props.referenceTier);
		const qualifierKeys = Array.isArray(props.qualifierKeys)
			? props.qualifierKeys
			: props.qualifierKeys
				? [props.qualifierKeys]
				: [];
		if (role !== 'HubReference' || tier !== 'property' || qualifierKeys.length > 0) {
			return;
		}
		const propertyKey = v1(props.propertyKey);
		const rangeOptionSetId = v1(props.rangeOptionSetId);
		if (propertyKey && rangeOptionSetId) {
			index[propertyKey] = rangeOptionSetId;
		}
	});
	return index;
};

// buildMatchedTargetIndex — from a deserialized mapping block's edges (EXACT_MATCH or CLOSE_MATCH):
// sourcePropertyStableId -> { targetPropertyKey, predicate, confidence, ambiguousTargets }. EXACT_MATCH
// wins over CLOSE_MATCH when a source carries both (deterministic tie-break; an EXACT arrival clears any
// CLOSE-tier ambiguity). The targetPropertyKey is read off the edge's own cedsAnchorKey property (stamped
// by both mappingSubgraph.js and inferredSubgraph.js — the chosen CEDS Global ID, already a 'P######'
// token for property-tier edges).
//
// L5 — SAME-strength edges naming DIFFERENT targets for one source (authored ambiguity is real:
// 22/936 property FROM keys carry multiple authored EXACT_MATCH targets): NEVER last-write-wins.
// The entry is marked with ambiguousTargets (every distinct target seen at that strength) and
// resolveValueParentScope abstains with 'parentMatchAmbiguous' — reported, not arbitrary. Identical
// targets restated by several edges are NOT ambiguous (the higher confidence is kept).
const buildMatchedTargetIndex = (mappingEdges) => {
	const index = {};
	(mappingEdges || []).forEach((oneEdge) => {
		if (oneEdge.type !== 'EXACT_MATCH' && oneEdge.type !== 'CLOSE_MATCH') {
			return;
		}
		const props = oneEdge.properties || {};
		const targetPropertyKey = v1(props.cedsAnchorKey);
		if (!targetPropertyKey) {
			return;
		}
		const fromId = oneEdge.fromRef && oneEdge.fromRef.id;
		if (!fromId) {
			return;
		}
		const confidence = typeof v1(props.confidence) === 'number' ? v1(props.confidence) : null;
		const existing = index[fromId];
		if (!existing) {
			index[fromId] = { targetPropertyKey, predicate: oneEdge.type, confidence, ambiguousTargets: null };
			return;
		}
		if (existing.predicate === 'EXACT_MATCH' && oneEdge.type === 'CLOSE_MATCH') {
			return; // keep the EXACT_MATCH
		}
		if (existing.predicate === 'CLOSE_MATCH' && oneEdge.type === 'EXACT_MATCH') {
			// EXACT supersedes CLOSE — and clears any CLOSE-tier ambiguity.
			index[fromId] = { targetPropertyKey, predicate: 'EXACT_MATCH', confidence, ambiguousTargets: null };
			return;
		}
		// same strength from here on
		const knownTargets = existing.ambiguousTargets || [existing.targetPropertyKey];
		if (knownTargets.indexOf(targetPropertyKey) !== -1) {
			// identical target restated — not ambiguous by itself; keep the higher confidence.
			if (
				!existing.ambiguousTargets &&
				confidence !== null &&
				(existing.confidence === null || confidence > existing.confidence)
			) {
				existing.confidence = confidence;
			}
			return;
		}
		// L5: a DIFFERENT target at the same strength — mark (or extend) the ambiguity.
		knownTargets.push(targetPropertyKey);
		existing.ambiguousTargets = knownTargets;
	});
	return index;
};

// buildOptionSetCandidateIndex — CEDS standard-block records (nodeLoader.collapseNodes output):
// rangeOptionSetId -> [DmeOptionValue candidate record, ...]. Scoping's candidate-pool source.
const buildOptionSetCandidateIndex = (cedsRecords) => {
	const index = {};
	(cedsRecords || []).forEach((oneRecord) => {
		if (oneRecord.role !== 'DmeOptionValue' || !oneRecord.rangeOptionSetId) {
			return;
		}
		(index[oneRecord.rangeOptionSetId] = index[oneRecord.rangeOptionSetId] || []).push(oneRecord);
	});
	return index;
};

// resolveValueParentScope — given ONE source DmeOptionValue record (from a standard whose value nodes
// carry a 2-hop parentId chain: value.parentId -> DmeOptionSet record, optionSet.parentId -> DmeProperty
// record stableId — the referent structural-contract enforces at forge time; verified live for LIF:
// 'lif:Assessment.assessmentLevel.option.IT'.parentId -> 'lif:Assessment.assessmentLevel.optionSet'
// .parentId -> 'lif:Assessment.assessmentLevel' DmeProperty), resolve
// { scope: { parentPropertyStableId, targetPropertyKey, rangeOptionSetId }, unscopableReason: null }
// or { scope: null, unscopableReason } — the caller MUST abstain on a null scope, never fabricate one.
//
// unscopableReason distinguishes the M7 diagnostic classes (never a bare null again):
//   CONTRACT VIOLATIONS (the parentId chain itself is broken — loud, a forge/block defect, since
//   structural-contract guarantees every parentId resolves to a member stableId):
//     'valueParentIdMissing'      — the value record carries no parentId at all
//     'optionSetParentIdMissing'  — the option-set record carries no parentId at all
//     'parentUnresolvable'        — a chain hop names a stableId with NO record in sourceRecordsById
//       (the pre-fix signature of _id-form parentIds: every hop-1 lookup missed and 100% of values
//       abstained as if legitimately unscoped)
//   LEGITIMATE SCOPING OUTCOMES (the chain is intact; scoping honestly abstains — PLAN §5 rule 3):
//     'optionSetNotPropertyParented' — the set's parent resolves but is not a DmeProperty (a multi-
//       owner or orphan set parked on the root by the single-owner alignment)
//     'parentUnmatched'              — the parent property has no property-tier match
//     'parentMatchAmbiguous'         — the parent property carries SEVERAL same-strength matches
//       naming different targets (L5: authored ambiguity); no arbitrary pick may scope child
//       values — reported, never last-write-wins
//     'parentMatchBelowFloor'        — the parent's match is a CLOSE_MATCH whose confidence does not
//       clear rerankerFloor (an EXACT_MATCH parent always passes; a CLOSE parent with a missing/
//       non-numeric confidence cannot be verified and does NOT pass) — value-scope confidence
//       honesty: a low-confidence parent hypothesis may not scope child values
//     'matchedTargetHasNoOptionSet'  — the matched CEDS property has no option set
//
// sourceRecordsById: stableId -> record (for the 2-hop walk). matchedTargetIndex:
// sourcePropertyStableId -> { targetPropertyKey, predicate, confidence }. propertyRangeOptionSetIndex:
// targetPropertyKey -> rangeOptionSetId (the MATCHED CEDS property's own option set — NOT the source's).
// rerankerFloor (optional number): the property-tier reranker floor a CLOSE_MATCH parent must clear;
// omitted/non-numeric -> no floor gate (legacy behavior). A resolved scope carries the parent-match
// evidence (parentPredicate, parentConfidence) so the caller can stamp it on every value-tier edge.
const resolveValueParentScope = ({
	sourceValueRecord,
	sourceRecordsById,
	matchedTargetIndex,
	propertyRangeOptionSetIndex,
	rerankerFloor,
}) => {
	if (!sourceValueRecord || !sourceValueRecord.parentId) {
		return { scope: null, unscopableReason: 'valueParentIdMissing' };
	}
	const optionSetRecord = sourceRecordsById[sourceValueRecord.parentId];
	if (!optionSetRecord) {
		return { scope: null, unscopableReason: 'parentUnresolvable' };
	}
	if (!optionSetRecord.parentId) {
		return { scope: null, unscopableReason: 'optionSetParentIdMissing' };
	}
	const parentPropertyStableId = optionSetRecord.parentId;
	const parentPropertyRecord = sourceRecordsById[parentPropertyStableId];
	if (!parentPropertyRecord) {
		return { scope: null, unscopableReason: 'parentUnresolvable' };
	}
	if (parentPropertyRecord.role !== 'DmeProperty') {
		return { scope: null, unscopableReason: 'optionSetNotPropertyParented' };
	}
	const matched = matchedTargetIndex[parentPropertyStableId];
	if (!matched) {
		return { scope: null, unscopableReason: 'parentUnmatched' }; // abstain (PLAN §5 rule 3)
	}
	// L5: several same-strength parent matches naming different targets — an arbitrary pick may
	// not scope child values. Abstain, reported under its own reason.
	if (matched.ambiguousTargets) {
		return { scope: null, unscopableReason: 'parentMatchAmbiguous' };
	}
	// value-scope confidence honesty: an EXACT_MATCH parent always passes; a CLOSE_MATCH parent must
	// clear the reranker floor on a VERIFIED numeric confidence (missing confidence does not pass).
	if (
		typeof rerankerFloor === 'number' &&
		matched.predicate !== 'EXACT_MATCH' &&
		!(typeof matched.confidence === 'number' && matched.confidence >= rerankerFloor)
	) {
		return { scope: null, unscopableReason: 'parentMatchBelowFloor' }; // abstain
	}
	const rangeOptionSetId = propertyRangeOptionSetIndex[matched.targetPropertyKey];
	if (!rangeOptionSetId) {
		return { scope: null, unscopableReason: 'matchedTargetHasNoOptionSet' }; // abstain
	}
	return {
		scope: {
			parentPropertyStableId,
			targetPropertyKey: matched.targetPropertyKey,
			rangeOptionSetId,
			parentPredicate: matched.predicate,
			parentConfidence: typeof matched.confidence === 'number' ? matched.confidence : null,
		},
		unscopableReason: null,
	};
};

// exactShortcut — deterministic, no-LLM pick within an ALREADY-SCOPED candidate pool: a case/whitespace-
// insensitive match of the source's own text (name, or notation-like fields when present) against a
// candidate's notation OR name. Applied ONLY within a scope (never globally) — PLAN §5 step 1 "exact
// notation/name match -> deterministic pick (no LLM)".
//
// L4 — returns { hit, ambiguousHits }: when MORE THAN ONE distinct candidate in the pool matches
// (two candidates normalizing identically), there is NO deterministic pick — hit is null and
// ambiguousHits carries every distinct match so the caller can report and route the source to the
// LLM rerank pool (which can disambiguate on definitions) instead of taking the first in pool order.
const normalizeText = (text) => `${text || ''}`.trim().toLowerCase();
const exactShortcut = (sourceRecord, scopedCandidates) => {
	const sourceTexts = [normalizeText(sourceRecord.name), normalizeText(sourceRecord.notation)].filter(Boolean);
	if (sourceTexts.length === 0) {
		return { hit: null, ambiguousHits: [] };
	}
	const matches = (scopedCandidates || []).filter((oneCandidate) => {
		const candidateTexts = [normalizeText(oneCandidate.name), normalizeText(oneCandidate.notation)].filter(Boolean);
		return candidateTexts.some((oneCandidateText) => sourceTexts.indexOf(oneCandidateText) !== -1);
	});
	const seenStableIds = new Set();
	const distinctMatches = matches.filter((oneMatch) => {
		if (seenStableIds.has(oneMatch.stableId)) {
			return false;
		}
		seenStableIds.add(oneMatch.stableId);
		return true;
	});
	if (distinctMatches.length > 1) {
		return { hit: null, ambiguousHits: distinctMatches };
	}
	return { hit: distinctMatches[0] || null, ambiguousHits: [] };
};

module.exports = {
	buildPropertyRangeOptionSetIndex,
	buildMatchedTargetIndex,
	buildOptionSetCandidateIndex,
	resolveValueParentScope,
	exactShortcut,
};
