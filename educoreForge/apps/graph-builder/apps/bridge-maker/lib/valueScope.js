'use strict';

// =====================================================================
// VALUE-TIER RELIC (P5 teardown ruling, 2026-07-30): the property-tier scalar path is superseded by
// the evidence architecture (see genericBridge/caseEvidenceBridge); this module survives ONLY as the
// sole value-tier implementation. Do not extend; do not use for new property-tier work; dies when
// value-tier is re-expressed on the evidence path.
// =====================================================================

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// valueScope.js — CODESET-VALUE scoping helpers for the INFERRED value-tier track. FAITHFUL PORT of the
// incumbent cli/bridge-maker/edf-inferred/lib/value-scope.js into the recreation (P3c). No require repoints
// were needed: the functions are PURE + synchronous, reading already-deserialized records / raw reference
// nodes / already-materialized decisions — no graph, no network, no config. The scoping logic (the 2-hop
// parentId walk, the L5 ambiguity abstain, the exact-shortcut) is byte-for-byte the incumbent's; this is the
// twin of how inferredIndex.js was ported from inferredSubgraph.js and referenceIndex.js from mappingSubgraph.js.
//
// It implements the gate: a source option value is ONLY offered to the reranker within the option set of its
// OWN parent property's ALREADY-MATCHED CEDS target — never a global retrieve among the full CEDS option
// values. A source whose parent property has no match, or whose matched CEDS property has no option set, is
// UNSCOPABLE and MUST abstain (never global-retrieve as a hidden default).
//
// PURE + synchronous. No graph/network access. camelCase; compound names.
//
// @concept: [[CodesetValueMatching]]
// @concept: [[ScopedInferredValueMatching]]

const v1 = (arrayOrScalar) => (Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar);

// buildPropertyRangeOptionSetIndex — CEDS reference block's UNQUALIFIED property-tier HubReference nodes
// (RAW { stableId, properties } shape, as graphReader returns them): propertyKey -> rangeOptionSetId.
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
// wins over CLOSE_MATCH when a source carries both. The targetPropertyKey is read off the edge's own
// cedsAnchorKey property (the chosen CEDS Global ID, already a 'P######' token for property-tier edges).
//
// (In the recreation's single-pass rebridge the property-tier picks are in hand as DECISIONS, so the caller
// builds the matched-target index directly rather than via this edge reader; this reader is kept for parity
// with the incumbent and for any replay-from-edges caller. L5 authored-ambiguity handling is preserved.)
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

// buildOptionSetCandidateIndex — CEDS standard-block records (flattened DmeOptionValue records):
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

// resolveValueParentScope — given ONE source DmeOptionValue record (whose value nodes carry a 2-hop
// parentId chain: value.parentId -> DmeOptionSet record, optionSet.parentId -> DmeProperty record stableId
// — verified live for CTDL: 'assessMethod:Artifact'.parentId -> 'ceterms:AssessmentMethod' (DmeOptionSet)
// .parentId -> 'ceterms:assessmentMethodType' (DmeProperty)), resolve
// { scope: { parentPropertyStableId, targetPropertyKey, rangeOptionSetId, parentPredicate, parentConfidence },
//   unscopableReason: null } or { scope: null, unscopableReason } — the caller MUST abstain on a null scope.
//
// unscopableReason distinguishes the diagnostic classes:
//   CONTRACT VIOLATIONS (the parentId chain itself is broken — a forge/block defect):
//     'valueParentIdMissing' | 'optionSetParentIdMissing' | 'parentUnresolvable'
//   LEGITIMATE SCOPING OUTCOMES (chain intact; scoping honestly abstains):
//     'optionSetNotPropertyParented' | 'parentUnmatched' | 'parentMatchAmbiguous' |
//     'parentMatchBelowFloor' | 'matchedTargetHasNoOptionSet'
//
// sourceRecordsById: stableId -> record (for the 2-hop walk; MUST include the DmeOptionSet intermediates).
// matchedTargetIndex: sourcePropertyStableId -> { targetPropertyKey, predicate, confidence, ambiguousTargets }.
// propertyRangeOptionSetIndex: targetPropertyKey -> rangeOptionSetId (the MATCHED CEDS property's option set).
// rerankerFloor (optional number): the property-tier reranker floor a CLOSE_MATCH parent must clear.
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
		return { scope: null, unscopableReason: 'parentUnmatched' }; // abstain
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
// candidate's notation OR name. Applied ONLY within a scope (never globally).
//
// L4 — returns { hit, ambiguousHits }: when MORE THAN ONE distinct candidate in the pool matches, there is
// NO deterministic pick — hit is null and ambiguousHits carries every distinct match so the caller can
// report and route the source to the LLM rerank pool (which can disambiguate on definitions).
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
	moduleName,
	buildPropertyRangeOptionSetIndex,
	buildMatchedTargetIndex,
	buildOptionSetCandidateIndex,
	resolveValueParentScope,
	exactShortcut,
};
