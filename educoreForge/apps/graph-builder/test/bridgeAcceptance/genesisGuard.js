'use strict';

// genesisGuard.js — the pinned-store guard and its ONE named exception, as a PURE function (RULING BS-5,
// SABLE_RIVER 2026-08-17). It lives beside runBridgeAcceptanceCommand.js rather than inside it because that
// file is a CLI that calls process.exit on refusal: requiring it from a suite would EXECUTE it, so a twin
// could only ever test a copy of the rule rather than the rule itself. Here both the runner and the suite
// require the SAME function, and a twin that goes red proves the runner's own behaviour rather than a
// parallel implementation of it.
//
// THE GUARD. A frozen line runs against the PINNED store only — a fresh scratch DB reads as "no decision
// block" and mimics a replay defect, which is the failure this exists to catch.
//
// THE EXCEPTION. A plugin phase ruled to FORGE FRESH has no store until its first run creates one, so the
// guard as originally written could not launch the most consequential run of a phase: the one that MAKES the
// store every later run is compared against. Genesis is DECLARED AS DATA on the line
// (`<lineName>Genesis: true`, the same per-line convention as `<lineName>MaxJudgmentCount`), never inferred,
// and permitted only when ALL of these hold:
//   (1) the line is a `rejudge*` line. A materialise line REPLAYS a frozen block; on a store that does not
//       exist there is nothing to replay from, so genesis there is a contradiction, refused BY NAME.
//   (2) the directory that will hold the store EXISTS. This is what separates "the first run of a real,
//       prepared location" from "a typo in an absolute path" — and the typo is precisely the case the
//       original guard was protecting against.
//   (3) the store file itself does NOT exist. Once it does the declaration is INERT and the ordinary guard
//       governs, so genesis cannot be left switched on as a standing bypass.

const moduleName = 'genesisGuard';

const REJUDGE_LINE_PATTERN = /^rejudge/;

// genesisRefusalFor — '' when the launch may proceed; otherwise the refusal text, naming what is wrong.
// storeExists / storeDirPathExists are passed IN rather than read here so the rule is pure and a twin can
// state the world it is testing instead of having to build one on disk.
const genesisRefusalFor = ({ entry, lineName, storeExists, storeDirPathExists, storeFilePath, storeDirPath } = {}) => {
	const genesisDeclared = entry[`${lineName}Genesis`] === true;
	if (genesisDeclared && !REJUDGE_LINE_PATTERN.test(lineName)) {
		return `'${lineName}Genesis' is declared, but genesis is permitted only on a rejudge* line — a materialise line replays a frozen block and has nothing to replay from on a store that does not exist`;
	}
	if (storeExists) {
		return ''; // the ordinary guard is satisfied; a genesis declaration is INERT here by design
	}
	if (!genesisDeclared) {
		return `the pinned store '${storeFilePath}' is not on disk — the frozen line runs against the pinned store only (declare '${lineName}Genesis': true on the line if this is the run that CREATES it; RULING BS-5)`;
	}
	if (!storeDirPathExists) {
		return `'${lineName}Genesis' is declared but the store's directory '${storeDirPath}' does not exist — genesis creates the STORE, never its location; an absent directory is a path typo, not a first run`;
	}
	return '';
};

// isGenesisLaunch — true only when this launch is actually creating the store (so the caller can SAY SO in
// the log rather than letting the most consequential run of a phase look like any other)
const isGenesisLaunch = ({ entry, lineName, storeExists } = {}) => storeExists !== true && entry[`${lineName}Genesis`] === true;

module.exports = { genesisRefusalFor, isGenesisLaunch, REJUDGE_LINE_PATTERN, moduleName };
