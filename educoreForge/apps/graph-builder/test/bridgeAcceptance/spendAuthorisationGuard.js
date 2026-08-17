'use strict';

// spendAuthorisationGuard.js — the PER-LINE real-judge spend authorisation rule, as a PURE function
// (RULING B4R-2, SABLE_RIVER 2026-08-17, on DEFECT D-2 of reviews/REVIEW-B4-sifPlugin-081726.md).
//
// It lives beside runBridgeAcceptanceCommand.js, not inside it, for the same reason genesisGuard.js does
// (RULING BS-5): that file is a CLI which calls process.exit on refusal, so requiring it from a suite would
// EXECUTE it and a twin could only ever test a copy of the rule. Here the runner and the suite require the
// SAME function, so a twin that goes red proves the runner's own behaviour rather than a parallel one.
//
// ⟪WHAT WAS WRONG, stated plainly, because the shape of the defect is the whole argument for this file⟫
// The retired gate was a PRESENCE CHECK ON ONE FIELD covering BOTH spending lines:
//
//     if (SPENDING_LINE_NAME_LIST.indexOf(lineName) !== -1 && !(entry.materialiseRealSpendAuthorisedBy && …))
//
// So a single object named for `materialiseReal` authorised `rejudgeRealLimit` as well — and, far worse, the
// reverse: an authorisation written to release ONLY the ten-subject CP3 conformance batch also opened
// `materialiseReal`, the full real run over every judged subject. The distinction the supervisor's ruling drew
// lived ONLY in that object's prose `note`, which the runner never reads. The predecessor knew and wrote it
// down — DEVLOG-B4-sifPlugin.md: "It does not cover materialiseReal despite the name — read the note, not the
// key" — which is an instruction to a HUMAN standing where a GUARD should have been. TQ's standing directive of
// 2026-08-17 00:46 CDT ("do not start a full run until we talk") was, until this file, enforced by a comment.
//
// THE RULE. Authorisation is DECLARED PER LINE, as data, on the bridge entry:
//
//     "spendAuthorisationByLine": {
//         "rejudgeRealLimit": { "sessionName": "…", "date": "…", "note": "…" },
//         "materialiseReal": null
//     }
//
// and a spending line runs only when ITS OWN name carries an authorisation object. Three states, three
// different answers, and they are deliberately NOT collapsed:
//
//   (1) an OBJECT with a sessionName → PERMITTED. Somebody named themselves and released this line.
//   (2) null                        → REFUSED as WITHHELD. A human considered this line and said no. That is
//                                     the state `materialiseReal` sits in for every bridge until TQ speaks.
//   (3) the name ABSENT ENTIRELY    → REFUSED as UNDECLARED, and by a DIFFERENT name than (2). Absent is not
//                                     withheld: it means nobody wrote a decision down at all, which is the
//                                     data-incompleteness case, and reporting it as "withheld" would credit
//                                     the file with a deliberation that never happened. polyArch2 forbids
//                                     silently correcting absent input; it equally forbids silently
//                                     REINTERPRETING it as a different declared state.
//
// THE RETIRED FIELD IS REFUSED BY NAME, ALWAYS, on any line. Leaving `materialiseRealSpendAuthorisedBy` merely
// unread would recreate DEFECT D-2 pointing the other way: a successor would write the familiar field, see no
// complaint, and believe a spend was authorised while this guard ignored it. A field that LOOKS like
// authorisation and authorises nothing is worse than no field, so its presence makes the entry malformed and
// the runner refuses whatever line was asked for — including a non-spending one, because the fault is in the
// DECLARATION and not in the request.

const moduleName = 'spendAuthorisationGuard';

// the two field names as constants, so the refusal texts, the runner and the suites cannot drift apart
const AUTHORISATION_BY_LINE_FIELD_NAME = 'spendAuthorisationByLine';
const RETIRED_FLAT_AUTHORISATION_FIELD_NAME = 'materialiseRealSpendAuthorisedBy';

// spendRefusalFor — '' when the line may proceed; otherwise the refusal text, NAMING what is wrong.
// `entry` and `spendingLineNameList` are passed IN rather than read here so the rule is pure and a twin can
// state the world it is testing instead of building one on disk.
const spendRefusalFor = ({ entry, lineName, spendingLineNameList, bridgeName } = {}) => {
	if (!entry || typeof entry !== 'object') {
		return `${moduleName} was asked about ${JSON.stringify(bridgeName)} with no acceptance entry to read — a spend decision is never taken against an absent declaration`;
	}
	if (!Array.isArray(spendingLineNameList)) {
		return `${moduleName} was given no spendingLineNameList — the set of lines that SPEND is the runner's own list and is never assumed here`;
	}
	// the retired field: malformed declaration, refused on ANY line (see the header)
	if (Object.prototype.hasOwnProperty.call(entry, RETIRED_FLAT_AUTHORISATION_FIELD_NAME)) {
		return `the acceptance entry for ${bridgeName} still carries the RETIRED field '${RETIRED_FLAT_AUTHORISATION_FIELD_NAME}' — it authorised BOTH spending lines from ONE field, which is DEFECT D-2 (a CP3-only release also opened the full real run). Authorisation is now per line under '${AUTHORISATION_BY_LINE_FIELD_NAME}'; remove the retired field rather than leaving a field that reads as authorisation and grants nothing (RULING B4R-2)`;
	}
	if (spendingLineNameList.indexOf(lineName) === -1) {
		return ''; // a line that asks no real judge needs no authorisation, and inventing one for it would be theatre
	}
	const authorisationByLine = entry[AUTHORISATION_BY_LINE_FIELD_NAME];
	if (!authorisationByLine || typeof authorisationByLine !== 'object' || Array.isArray(authorisationByLine)) {
		return `the ${lineName} line SPENDS on the real judge and the acceptance entry for ${bridgeName} declares no '${AUTHORISATION_BY_LINE_FIELD_NAME}' object (got ${JSON.stringify(authorisationByLine)}) — the supervisor authorises spend PER LINE, as data, before that line runs (RULING B4R-2)`;
	}
	if (!Object.prototype.hasOwnProperty.call(authorisationByLine, lineName)) {
		return `the ${lineName} line SPENDS on the real judge and '${AUTHORISATION_BY_LINE_FIELD_NAME}' for ${bridgeName} carries NO ENTRY FOR IT — declared line names are [${Object.keys(authorisationByLine).join(', ')}]. An ABSENT name is not a withheld one: it means no decision was recorded for this line at all, so it is refused as UNDECLARED rather than read as a no (RULING B4R-2)`;
	}
	const authorisation = authorisationByLine[lineName];
	if (authorisation === null) {
		return `the ${lineName} line SPENDS on the real judge and its authorisation under '${AUTHORISATION_BY_LINE_FIELD_NAME}' for ${bridgeName} is explicitly NULL — WITHHELD by the supervisor. This is the state that holds TQ's standing directive of 2026-08-17 00:46 CDT ("do not start a full run until we talk") as DATA rather than as a comment. Only the supervisor writes the authorisation object for this line (RULING B4R-2)`;
	}
	if (typeof authorisation !== 'object' || Array.isArray(authorisation) || typeof authorisation.sessionName !== 'string' || authorisation.sessionName.length === 0) {
		return `the ${lineName} authorisation under '${AUTHORISATION_BY_LINE_FIELD_NAME}' for ${bridgeName} is present but is not an authorisation: it must be an object carrying a non-empty sessionName naming who released this line (got ${JSON.stringify(authorisation)}). A malformed authorisation is refused rather than read generously — the generous reading is how money gets spent`;
	}
	return '';
};

// authorisationFor — the object that PERMITTED this line, or undefined. The runner reports it on launch and in
// the provenance sidecar, so a run that spent real money records WHO released it beside the command that did
// it, rather than leaving a reader to go and infer it from the acceptance file's state at some later date.
const authorisationFor = ({ entry, lineName } = {}) => {
	const authorisationByLine = entry && entry[AUTHORISATION_BY_LINE_FIELD_NAME];
	if (!authorisationByLine || typeof authorisationByLine !== 'object') {
		return undefined;
	}
	const authorisation = authorisationByLine[lineName];
	return authorisation && typeof authorisation === 'object' && typeof authorisation.sessionName === 'string' ? authorisation : undefined;
};

module.exports = { spendRefusalFor, authorisationFor, AUTHORISATION_BY_LINE_FIELD_NAME, RETIRED_FLAT_AUTHORISATION_FIELD_NAME, moduleName };
