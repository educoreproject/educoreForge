'use strict';

// recordDisposition.js — what a decision record's outcome IS, as a PURE function (RULING BS-13, SABLE_RIVER
// 2026-08-17). It lives beside batchCheckpoint.js rather than inside it for the same reason genesisGuard.js
// lives beside runBridgeAcceptanceCommand.js: that file is a CLI that runs on require, so a twin could only
// ever test a COPY of the rule. Here the CLI and the suite require the SAME function.
//
// WHY THIS EXISTS AT ALL. The generator's original predicate read:
//
//     isAbstained = (r) => r.abstained === true || typeof r.objectStableId !== 'string' || r.objectStableId === ''
//
// which is correct for a corpus where every record is JUDGED — and that is exactly the corpus it was written
// against. Measured on the derived order, all six blocks including the 701-subject D4 run: classification is
// 100% 'judged', zero orphan, zero specified. So the predicate never met the two rows that break it.
//
// The SIF order is not that corpus. Its census block is 1875 specified / 327 judged / 29 orphan. An ORPHAN is
// a subject for which NO candidate card exists; an ABSTENTION is the judge looking at candidates and
// declining. Collapsing them inflates reticence and hides a coverage gap inside it — one number that says
// "the judge was cautious" when half of what it counts is "the judge was never asked".
//
// Measured inflation of the abstention count by the old predicate:
//   CP2 census block 31030a16…  132 true abstentions reported as 161  (+29, the orphans)
//   CP3 batch-1      da9ab439…    8 true abstentions reported as   9  (+1,  the one orphan)
// That +1 is the whole of the "document disagrees with the block by one" discrepancy reported at CP3.

const moduleName = 'recordDisposition';

// The four outcomes a record can have. Named rather than inferred, so an unknown classification REFUSES
// instead of silently landing in whichever branch happens to be last.
const DISPOSITION_SPECIFIED = 'specified'; // channel-asserted by the plugin; no judge was ever involved
const DISPOSITION_ORPHAN = 'orphan'; // no candidate card existed — the judge was not asked
const DISPOSITION_ABSTAINED = 'abstained'; // the judge saw candidates and declined to pick
const DISPOSITION_PICKED = 'picked'; // there is an objectStableId to analyse

const KNOWN_CLASSIFICATION_LIST = Object.freeze(['specified', 'judged', 'orphan']);

const hasNoObjectStableId = (decisionRecord) => typeof decisionRecord.objectStableId !== 'string' || decisionRecord.objectStableId === '';

// dispositionOf — { disposition } or { error }. Pure: it reads the record and nothing else.
const dispositionOf = ({ decisionRecord } = {}) => {
	if (decisionRecord === undefined || decisionRecord === null) {
		return { error: new Error(`${moduleName}: no decisionRecord given`) };
	}
	if (KNOWN_CLASSIFICATION_LIST.indexOf(decisionRecord.classification) === -1) {
		return { error: new Error(`${moduleName}: classification '${decisionRecord.classification}' is not one of ${KNOWN_CLASSIFICATION_LIST.join(', ')} — a new classification must be given its disposition DELIBERATELY, never defaulted into an existing one`) };
	}

	// CLASSIFICATION FIRST, FIELD SECOND. The two records this rule exists to separate look IDENTICAL from the
	// objectStableId field — both are absent — so the field can never be asked first. Only the classification
	// knows whether a judge was ever put in front of candidates.
	if (decisionRecord.classification === 'orphan') {
		return { disposition: DISPOSITION_ORPHAN };
	}
	if (decisionRecord.classification === 'specified') {
		// channel-asserted by the plugin. Named here so a caller can separate these BY NAME; how the batch
		// document counts them is RULING BS-12 and is deliberately not decided in this function.
		return { disposition: DISPOSITION_SPECIFIED };
	}
	if (decisionRecord.abstained === true || hasNoObjectStableId(decisionRecord)) {
		return { disposition: DISPOSITION_ABSTAINED };
	}
	return { disposition: DISPOSITION_PICKED };
};

// hasObjectPick — "there is an objectStableId worth analysing", which is NOT the negation of isAbstained.
// Every site that guards pick analysis must ask THIS, never `!isAbstained`: once an orphan stops counting as
// an abstention, `!isAbstained(orphan)` becomes true and the site would read an undefined objectStableId.
// `renderedPoolStableIdList.indexOf(undefined) === -1` is TRUE, so the orphan would have been reported as an
// unmapped pick — a subject with no candidate card re-labelled as the judge picking outside its pool.
const hasObjectPick = (decisionRecord) => {
	const read = dispositionOf({ decisionRecord });
	if (read.error !== undefined) {
		return false;
	}
	return (read.disposition === DISPOSITION_PICKED || read.disposition === DISPOSITION_SPECIFIED) && !hasNoObjectStableId(decisionRecord);
};

// isAbstained / isOrphan — the two counts BS-13 separates. Neither is the other's complement.
const isAbstained = (decisionRecord) => {
	const read = dispositionOf({ decisionRecord });
	return read.error === undefined && read.disposition === DISPOSITION_ABSTAINED;
};
const isOrphan = (decisionRecord) => {
	const read = dispositionOf({ decisionRecord });
	return read.error === undefined && read.disposition === DISPOSITION_ORPHAN;
};

module.exports = {
	dispositionOf,
	hasObjectPick,
	isAbstained,
	isOrphan,
	DISPOSITION_SPECIFIED,
	DISPOSITION_ORPHAN,
	DISPOSITION_ABSTAINED,
	DISPOSITION_PICKED,
	KNOWN_CLASSIFICATION_LIST,
	moduleName,
};
