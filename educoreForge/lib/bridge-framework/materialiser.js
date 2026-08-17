'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// materialiser.js — records → writer calls in sorted order; edge-property assembly from MAPPING_PROPERTIES;
// the debug re-flag (SPEC-bridgeFramework-v1.md §5.7; RULINGS R1, R5, BF2, BF3, 12:20; BR-031, BR-045, BR-072).
// Materialise reads the FROZEN BLOCK ONLY (objectStableId off the record — never re-derived) and writes through
// the writer ONLY. Records sorted by (subjectStableId, objectStableId, predicate) before writing; ONE EDGE PER
// DISTINCT (subject, predicate, object) — a (subject, object) pair carrying TWO predicates is refused
// (edgeUniquenessRefusal, applied at freeze AND re-checked here). Every edge carries decisionBlockHash and
// the ENGINE-LEVEL provenanceTier derived from the block's producerKind (invalid-debug on a debug block —
// on freeze AND on plain replay, read back from the generation).
//
//   materialiseBlock({ block, decisionBlockHash, writer, sourceStandardName, sourceVersion, hubName, hubVersion,
//                      mappingProviderUrl, subjectMatchField, objectMatchField, debugMark }, cb)
//     → { edgesWritten, writtenEdgeList }

const path = require('path');
const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { compareRecords, sha256Hex } = require('./decisionBlock');
const { RENDERER_VERSION } = require('./evidenceRenderer');

const { SKOS_EDGE_TYPES, MAPPING_PROPERTIES, PROVENANCE_TIER, MAPPING_EDGE_PROVENANCE_TIER_BY_PRODUCER_KIND } = vocabularyLib;

const JUSTIFICATION_BY_RESOLUTION = Object.freeze({ specified: 'semapv:ManualMappingCuration', judged: 'semapv:CompositeMatching' });

// pickedRecordList — the records that yield an edge, in the sorted order
const pickedRecordList = (decisionRecordList) =>
	decisionRecordList.filter((oneRecord) => typeof oneRecord.objectStableId === 'string' && oneRecord.objectStableId.length > 0 && typeof oneRecord.predicate === 'string').slice().sort(compareRecords);

// edgeUniquenessRefusal(decisionRecordList) → Error | null — a (subject, object) pair with two predicates
const edgeUniquenessRefusal = (decisionRecordList) => {
	const predicateSetByPair = {};
	const pickedList = pickedRecordList(decisionRecordList);
	for (let recordIndex = 0; recordIndex < pickedList.length; recordIndex++) {
		const oneRecord = pickedList[recordIndex];
		const pairRefId = `${oneRecord.subjectStableId}\u001f${oneRecord.objectStableId}`;
		const seen = predicateSetByPair[pairRefId] === undefined ? (predicateSetByPair[pairRefId] = new Set()) : predicateSetByPair[pairRefId];
		seen.add(oneRecord.predicate);
		if (seen.size > 1) {
			return refuse.byName({ moduleName, what: `(${oneRecord.subjectStableId}, ${oneRecord.objectStableId}) carries two predicates (${Array.from(seen).sort().join(', ')})`, where: 'ONE edge per distinct (subject, predicate, object); a pair with two predicates is refused at freeze (BG-EDGE-UNIQUE b)' });
		}
	}
	return null;
};

// provenanceTierFor — the ENGINE-LEVEL tier (RULING 12:20): debug block → invalid-debug; else by producerKind
const provenanceTierFor = ({ producerKind, debugMark }) => {
	if (debugMark) {
		return PROVENANCE_TIER.INVALID_DEBUG;
	}
	const tier = MAPPING_EDGE_PROVENANCE_TIER_BY_PRODUCER_KIND[producerKind];
	// an unknown producerKind yields undefined; the writer's closed-set check refuses it by name (never a throw here)
	return tier;
};

// edgePropertiesFor — assembled from the record + the run's identity; camelCase; the CLOSED set
const edgePropertiesFor = ({ record, block, decisionBlockHash, sourceStandardName, sourceVersion, hubName, hubVersion, mappingProviderUrl, subjectMatchField, objectMatchField, debugMark }) => {
	const edgeProperties = {
		[MAPPING_PROPERTIES.PREDICATE]: record.predicate,
		// THE RECORD IS THE AUTHORITY on its own justification; the resolution table is the answer only when the
		// record did not name one. The framework already writes the justification onto every decision record at
		// classification time, and for a RETRIEVED mapping that value is semapv:SemanticSimilarityThresholdMatching
		// (RULING §11.7 (b)) — which the two-row resolution table cannot express, because both a key-filtered and
		// a retrieved pool resolve as 'judged'. Reading the table first silently relabelled every derived edge as
		// CompositeMatching, which is the justification for "an algorithm chose among candidates" and says nothing
		// about HOW the candidates were proposed. Byte-identical for both documentary producers, whose records
		// carry exactly the table's values.
		[MAPPING_PROPERTIES.MAPPING_JUSTIFICATION]: record.mappingJustification === undefined || record.mappingJustification === null ? JUSTIFICATION_BY_RESOLUTION[record.resolution] : record.mappingJustification,
		[MAPPING_PROPERTIES.MATCH_BASIS]: block.header.matchBasis,
		[MAPPING_PROPERTIES.RESOLUTION]: record.resolution,
		[MAPPING_PROPERTIES.OBJECT_MATCH_FIELD]: objectMatchField,
		[MAPPING_PROPERTIES.SUBJECT_SOURCE]: sourceStandardName,
		[MAPPING_PROPERTIES.SUBJECT_VERSION]: sourceVersion,
		[MAPPING_PROPERTIES.OBJECT_SOURCE]: hubName,
		[MAPPING_PROPERTIES.OBJECT_VERSION]: hubVersion,
		[MAPPING_PROPERTIES.PREDICATE_ASSERTED_BY]: record.predicateAssertedBy,
		[MAPPING_PROPERTIES.ATTESTATION_CHANNEL_LIST]: record.attestationChannelList.slice(),
		[MAPPING_PROPERTIES.DECISION_BLOCK_HASH]: decisionBlockHash,
		[MAPPING_PROPERTIES.PROVENANCE_TIER]: provenanceTierFor({ producerKind: block.header.producerKind, debugMark }),
		[MAPPING_PROPERTIES.MATCH_ID]: sha256Hex(`${decisionBlockHash}\n${record.subjectStableId}\n${record.predicate}\n${record.objectStableId}`),
	};
	// The two PRODUCER-CONDITIONAL properties are set only when the run HAS them (an authored producer). For an
	// inferred producer each key is left ABSENT entirely — the write seam refuses a forbidden key that is
	// present, and "absent" means absent, never null (RULING 2026-08-17 amending §11.7 (c)(d)).
	if (mappingProviderUrl !== null && mappingProviderUrl !== undefined) {
		edgeProperties[MAPPING_PROPERTIES.MAPPING_PROVIDER] = mappingProviderUrl;
	}
	if (subjectMatchField !== null && subjectMatchField !== undefined) {
		edgeProperties[MAPPING_PROPERTIES.SUBJECT_MATCH_FIELD] = subjectMatchField;
	}
	if (record.sourceLabel !== null && record.sourceLabel !== undefined) {
		edgeProperties[MAPPING_PROPERTIES.SOURCE_LABEL] = record.sourceLabel;
	}
	if (record.resolution === 'judged') {
		edgeProperties[MAPPING_PROPERTIES.CONFIDENCE] = record.confidence;
		edgeProperties[MAPPING_PROPERTIES.MAPPING_TOOL] = record.judge.judgeModel;
		edgeProperties[MAPPING_PROPERTIES.MAPPING_TOOL_VERSION] = `${record.judge.rendererVersion === undefined ? RENDERER_VERSION : record.judge.rendererVersion}`;
	}
	return edgeProperties;
};

const materialiseBlock = ({ block, decisionBlockHash, writer, sourceStandardName, sourceVersion, hubName, hubVersion, mappingProviderUrl, subjectMatchField, objectMatchField, debugMark, runWindowMark } = {}, callback) => {
	if (!block || !block.header || !Array.isArray(block.decisionRecordList)) {
		callback(refuse.byName({ moduleName, what: 'materialiseBlock needs a parsed block ({ header, decisionRecordList })', where: 'decisionBlock.parseFrozenText' }).message);
		return;
	}
	// ⟪THE PARTIAL GUARD — RULING §11.12⟫ A --limit run freezes a WHOLE, SEPARATE block under the same pairKey
	// carrying a sourceWindow mark, and the store keeps LATEST by seq. So after a batch of ten, the latest block
	// for that pairKey is a TEN-SUBJECT block — and the DEVLOG's own warning is that "a plain build replays the
	// LATEST block for the pairKey". Without this guard an unwindowed build would replay it, write ten edges,
	// and report success: a graph that is not wrong, only radically incomplete, which is the failure mode that
	// reads exactly like completeness. B3 hit this genus with debug-vs-real block ordering.
	//
	// The rule: a block frozen from a WINDOW may only be materialised by a run carrying the SAME window. Equal
	// marks are the only pass; a full run meeting a partial block, or a differently-windowed run meeting it, is
	// refused BY NAME with both marks printed. A full block (sourceWindow null) materialises under any run,
	// which is the pre-existing behaviour and is byte-unchanged for every crosswalk build.
	const blockWindowMark = block.header.sourceWindow === undefined ? null : block.header.sourceWindow;
	const currentWindowMark = runWindowMark === undefined ? null : runWindowMark;
	if (blockWindowMark !== null && blockWindowMark !== currentWindowMark) {
		callback(refuse.byName({ moduleName, what: `decision block ${decisionBlockHash} was frozen from a PARTIAL window (${JSON.stringify(blockWindowMark)}) and this run's window is ${JSON.stringify(currentWindowMark)}`, where: 'a windowed block may only be materialised by the SAME window; re-freeze the full run first, or pass the identical --limit/--offset. Ten edges shipped as a graph would report success (RULING §11.12)' }).message);
		return;
	}
	if (!writer || typeof writer.writeMappingEdge !== 'function') {
		callback(refuse.byName({ moduleName, what: 'materialiseBlock needs the writer', where: 'graphWriterFactory({ inGraph, applyLabel, sourceStandardName })' }).message);
		return;
	}
	if (typeof decisionBlockHash !== 'string' || decisionBlockHash.length !== 64) {
		callback(refuse.byName({ moduleName, what: `decisionBlockHash ${JSON.stringify(decisionBlockHash)} is not a 64-hex id`, where: 'every edge carries the block id (RULING R1)' }).message);
		return;
	}
	const uniquenessRefusal = edgeUniquenessRefusal(block.decisionRecordList);
	if (uniquenessRefusal) {
		callback(uniquenessRefusal.message);
		return;
	}
	const orderedList = pickedRecordList(block.decisionRecordList);
	const writtenEdgeList = [];
	let recordIndex = 0;
	const nextRecord = () => {
		if (recordIndex >= orderedList.length) {
			callback('', { edgesWritten: writtenEdgeList.length, writtenEdgeList });
			return;
		}
		const oneRecord = orderedList[recordIndex];
		recordIndex += 1;
		const edgeProperties = edgePropertiesFor({ record: oneRecord, block, decisionBlockHash, sourceStandardName, sourceVersion, hubName, hubVersion, mappingProviderUrl, subjectMatchField, objectMatchField, debugMark });
		const edgeType = SKOS_EDGE_TYPES[oneRecord.predicate];
		writer.writeMappingEdge({ subjectStableId: oneRecord.subjectStableId, objectStableId: oneRecord.objectStableId, edgeType, edgeProperties }, (writeError, written) => {
			if (writeError) {
				callback(`${moduleName}: record ${oneRecord.subjectStableId} → ${oneRecord.objectStableId} (${oneRecord.predicate}): ${writeError}`);
				return;
			}
			if (!written || written.edgeWritten !== true) {
				callback(refuse.byName({ moduleName, what: `the writer did not report edgeWritten for ${oneRecord.subjectStableId} → ${oneRecord.objectStableId}`, where: 'an un-counted write cannot be gated (HARVEST §1.14)' }).message);
				return;
			}
			writtenEdgeList.push({ subjectStableId: oneRecord.subjectStableId, objectStableId: oneRecord.objectStableId, edgeType, predicate: oneRecord.predicate, edgeProperties });
			nextRecord();
		});
	};
	nextRecord();
};

module.exports = { materialiseBlock, edgePropertiesFor, edgeUniquenessRefusal, pickedRecordList, provenanceTierFor, JUSTIFICATION_BY_RESOLUTION, moduleName };
