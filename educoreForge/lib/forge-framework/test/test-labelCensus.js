'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// test-labelCensus.js — G-LABEL-CENSUS. THE CHEAP DETECTOR FOR A WRONG PER-STANDARD LABEL.
//
// Written 2026-08-29 in hub-kit-role Phase 3 under RULING FJ-P3-1, discharging the Phase 1 docket
// row that asked for a label census and said, in capitals, GENERALISE IT RATHER THAN COPYING IT.
//
// WHY IT EXISTS. Phase 1's first CEDS re-forge collapsed four per-role entity labels into one and
// produced b7351c60… at 419,591,071 against the expected 09a5d658… at 419,649,468. ALL FOUR CEDS
// SUITES WERE GREEN ON THAT BUILD — including a byte-identical DETERMINISM conjunct, which proves
// run-to-run stability rather than fidelity. Node and edge counts were identical (119,805 /
// 496,119); the hub census still read 94,602; the divergence report still had 71 rows. I5, I6 and
// I5b would ALL have passed. A LABEL IS NOT A COUNT, and no suite in the tree asserted one. Only the
// 262-second byte-identity oracle caught it. This suite catches the same class in about five seconds
// with no Docker, no container, and no embedding spend.
//
// WHY IT IS A CENSUS AND NOT A BY-ROLE TABLE — the whole point of "generalise, do not copy". The
// three migrated forges key their per-standard labels off THREE DIFFERENT AXES, measured:
//   ceds  — by DME ROLE.            5 labels. role -> label is a FUNCTION, so CEDS's own
//                                   PER_STANDARD_LABEL_BY_ROLE registry is role-keyed and correct.
//   sif   — by NATIVE KIND.         9 labels across SIX roles. DmeClass carries BOTH SifObject and
//                                   SifComplexType; DmeSupport carries SifPrimitiveType,
//                                   SifSimpleType AND SifXmlElement.
//   edfi  — by METAED ENTITY TYPE. 22 labels, far more than there are roles.
// A by-role assertion is STRUCTURALLY INCAPABLE of expressing two of the three. The only thing
// genuinely common is the label -> count table, which is checkable uniformly whatever the key space.
//
// AND IT IS CENSUSED STRUCTURALLY, NOT POSITIONALLY. Harvest emits labels SORTED, so the
// per-standard label sits at a different index per standard: the docket's `labels[1]` shorthand is
// right for CEDS ("CedsClass","DmeClass","ForgedNode","StandardBase") and WRONG for SIF
// ("DmeOptionSet","ForgedNode","SifCodeset","StandardBase"). A copied positional test would have
// read the wrong element and passed for the wrong reason.
//
// WHAT IT CANNOT SEE, stated so nobody over-trusts it: it censuses the FORGE BUNDLE's output, not a
// materialized graph, so it says nothing about load, MERGE collapse, or anything the forger adds
// afterwards (CEDS's hub fold included — which is why ceds reads 25,202 here and not 119,805). It is
// a CHEAP FIRST DETECTOR, never a substitute for the re-forge. Phase 3 proved the converse too: the
// oracle was green while a digest-EXCLUDED field had been dropped, and only a suite caught THAT.
// NEITHER INSTRUMENT DOMINATES.

const path = require('path');
const fs = require('fs');

// the house test bootstrap (testSupport/runToyFingerprint.js:15-17): the REAL qtools-x-log, frozen
// into process.global. NOT a manufactured do-nothing logger — the framework REFUSES BY NAME when
// xLog is absent ("no do-nothing logger is manufactured, Profile §5.3") and that refusal is right;
// a test satisfies it the way production does rather than by stubbing around it.
process.global = { xLog: require(path.join(__dirname, '..', '..', '..', 'node_modules', 'qtools-x-log')) };
Object.freeze(process.global);
process.global.xLog.logToStdOut = process.global.xLog.logToStdOut || (() => {});

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const EXPECTATION_FILE = path.join(__dirname, 'acceptance', 'expectedLabelCensus.json');

// the framework labels every forged node carries; they are not per-standard and are excluded from
// the census on both sides.
const FRAMEWORK_LABEL_LIST = Object.freeze(['ForgedNode', 'StandardBase']);
const DME_ROLE_LABEL_PREFIX = 'Dme';

// the roster is DATA: standardKey -> the bundle to drive and the snapshot to drive it against.
// A standard joins this table in ITS OWN migration commit, with ITS census measured at that time.
const MIGRATED_FORGE_ROSTER = Object.freeze([
	Object.freeze({ standardKey: 'ceds', bundlePath: 'forges/ceds/forgeCeds.js', snapshotPath: 'forges/ceds/assets/standardSourceData/01' }),
	Object.freeze({ standardKey: 'edfi', bundlePath: 'forges/edfi/forgeEdfi.js', snapshotPath: 'forges/edfi/assets/standardSourceData/04' }),
	Object.freeze({ standardKey: 'sif', bundlePath: 'forges/sif/forgeSif.js', snapshotPath: 'forges/sif/assets/standardSourceData/01' }),
	Object.freeze({ standardKey: 'pesc260805', bundlePath: 'forges/pesc260805/forgePesc260805.js', snapshotPath: 'forges/pesc260805/assets/standardSourceData/01' }),
]);

let passedCount = 0;
let failedCount = 0;
const failureList = [];
const check = (title, isPass, detail) => {
	if (isPass) {
		passedCount += 1;
		return;
	}
	failedCount += 1;
	failureList.push(`${title}${detail === undefined ? '' : ` — ${detail}`}`);
	console.log(`  FAIL ${title}${detail === undefined ? '' : `\n       ${detail}`}`);
};

// the census, structural: every label that is neither a framework label nor a Dme* role label.
const perStandardLabelCensusOf = (nodeList) => {
	const census = {};
	nodeList.forEach((oneNode) => {
		(oneNode.labels || [])
			.filter((oneLabel) => FRAMEWORK_LABEL_LIST.indexOf(oneLabel) === -1)
			.filter((oneLabel) => oneLabel.indexOf(DME_ROLE_LABEL_PREFIX) !== 0)
			.forEach((oneLabel) => {
				census[oneLabel] = (census[oneLabel] || 0) + 1;
			});
	});
	return census;
};

const readExpectation = () => {
	if (!fs.existsSync(EXPECTATION_FILE)) {
		throw new Error(`${moduleName}: expectation file missing at ${EXPECTATION_FILE} — this gate has nothing to measure against and an absent expectation is a fault, never an empty pass`);
	}
	const parsed = JSON.parse(fs.readFileSync(EXPECTATION_FILE, 'utf8'));
	if (!parsed.byStandardKey || typeof parsed.byStandardKey !== 'object') {
		throw new Error(`${moduleName}: expectation file carries no byStandardKey object`);
	}
	return parsed.byStandardKey;
};

// a roster entry with no frozen census is REFUSED BY NAME rather than skipped: a standard silently
// absent from the expectation would make this whole gate a no-op for it, which is the failure mode
// an empty gate always has.
const expectationFor = ({ expectationByStandardKey, standardKey }) => {
	const expectation = expectationByStandardKey[standardKey];
	if (expectation === undefined) {
		throw new Error(`${moduleName}: '${standardKey}' is on MIGRATED_FORGE_ROSTER but has no frozen census in expectedLabelCensus.json — add it in the commit that migrates it; a roster entry with no expectation is an unmeasured standard wearing a measured one's clothes`);
	}
	return expectation;
};

const judgeOneStandard = ({ standardKey, expectation, forged }) => {
	const measuredCensus = perStandardLabelCensusOf(forged.nodes);
	const expectedCensus = expectation.labelCensus;
	const expectedLabelList = Object.keys(expectedCensus).sort();
	const measuredLabelList = Object.keys(measuredCensus).sort();

	check(
		`${standardKey}: nodeTotal is ${expectation.nodeTotal}`,
		forged.nodes.length === expectation.nodeTotal,
		`measured ${forged.nodes.length}`,
	);

	// EVERY node carries EXACTLY ONE per-standard label. This is the conjunct that catches a node
	// minted with none (which no per-label count would notice, because it is absent from all of them)
	// and a node minted with two.
	//
	// ⚠ HONESTY, BECAUSE A GATE NEVER SEEN RED IS UNPROVEN AND THIS ONE IS THE EXCEPTION IN THIS FILE.
	// Every OTHER conjunct here has been OBSERVED red under a real lever — the label-collapse lever
	// (SifComplexType relabelled SifObject) reddens the vanished-label and both per-label conjuncts by
	// name, and an off-by-one in the frozen table reddens the matching per-label conjunct. THIS one I
	// could NOT redden for its stated purpose: the only lever that produces a node with no
	// per-standard label is stopping the kit from stamping it, and `contractGraphKit.makeNode` REFUSES
	// a non-string perStandardLabel BY NAME, so all three forges refuse before any node exists to
	// count. The state this conjunct guards is currently UNREACHABLE THROUGH THE KIT. It is therefore
	// DEFENCE IN DEPTH against a forge that bypasses the kit or a future kit that stops refusing —
	// worth keeping, and NOT to be described as proven. (Same shape as STANDDOWN-P2 B.4's finding that
	// the hub hooks seam is "proven only in the negative direction".)
	const censusSum = Object.keys(measuredCensus).reduce((soFar, oneLabel) => soFar + measuredCensus[oneLabel], 0);
	check(
		`${standardKey}: the census sums to nodeTotal — every node carries EXACTLY ONE per-standard label`,
		censusSum === forged.nodes.length,
		`census sum ${censusSum} vs ${forged.nodes.length} nodes`,
	);

	check(
		`${standardKey}: no UNDECLARED label appears`,
		measuredLabelList.every((oneLabel) => expectedCensus[oneLabel] !== undefined),
		`undeclared: [${measuredLabelList.filter((oneLabel) => expectedCensus[oneLabel] === undefined).join(', ')}]`,
	);

	check(
		`${standardKey}: no DECLARED label has vanished`,
		expectedLabelList.every((oneLabel) => measuredCensus[oneLabel] !== undefined),
		`missing: [${expectedLabelList.filter((oneLabel) => measuredCensus[oneLabel] === undefined).join(', ')}]`,
	);

	// per-label counts, one conjunct each: a collapse moves TWO counts and naming both is what makes
	// the failure legible (Phase 1's collapse would read here as CedsClass 0 and CedsOntology +402).
	expectedLabelList.forEach((oneLabel) => {
		check(
			`${standardKey}: ${oneLabel} = ${expectedCensus[oneLabel]}`,
			measuredCensus[oneLabel] === expectedCensus[oneLabel],
			`measured ${measuredCensus[oneLabel] === undefined ? 'ABSENT' : measuredCensus[oneLabel]}`,
		);
	});
};

// START — drive the roster serially. Each bundle is forged IN-PROCESS with skipEmbedding: no Docker,
// no container, no embedding spend, no store written.
const expectationByStandardKey = readExpectation();

const runOneStandard = (rosterIndex, whenDone) => {
	if (rosterIndex >= MIGRATED_FORGE_ROSTER.length) {
		whenDone();
		return;
	}
	const rosterEntry = MIGRATED_FORGE_ROSTER[rosterIndex];
	const expectation = expectationFor({ expectationByStandardKey, standardKey: rosterEntry.standardKey });
	const bundle = require(path.join(TREE_ROOT, rosterEntry.bundlePath))({ embedder: null });
	bundle.forge(
		{ sourcePath: path.join(TREE_ROOT, rosterEntry.snapshotPath), skipEmbedding: true },
		(forgeError, forged) => {
			if (forgeError) {
				check(`${rosterEntry.standardKey}: forge succeeded`, false, `${forgeError}`);
				runOneStandard(rosterIndex + 1, whenDone);
				return;
			}
			judgeOneStandard({ standardKey: rosterEntry.standardKey, expectation, forged });
			runOneStandard(rosterIndex + 1, whenDone);
		},
	);
};

console.log(`${moduleName} -- G-LABEL-CENSUS: every per-standard label, counted, against a frozen table`);
runOneStandard(0, () => {
	// the roster itself is a conjunct: an EMPTY roster would pass every check above vacuously, which
	// is the shape of a gate with nothing to measure.
	check(
		'the roster is non-empty and every entry was judged',
		MIGRATED_FORGE_ROSTER.length > 0,
		`roster length ${MIGRATED_FORGE_ROSTER.length}`,
	);
	if (failedCount > 0) {
		console.log(`\n${moduleName}: FAILURES`);
		failureList.forEach((oneFailure) => console.log(`  - ${oneFailure}`));
	}
	console.log(`${moduleName}: ${passedCount}/${passedCount + failedCount} passed, ${failedCount} failed.`);
	process.exitCode = failedCount === 0 ? 0 : 1;
});
