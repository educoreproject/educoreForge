'use strict';

// p1_registryOmissionLever.js — LUNAR_PRISM (P1), 2026-08-17.
//
// THE HONEST TEST OF COMPANION EDIT 2. My required S-1c owner gate PASSES AND IS VACUOUS: S-1c merges
// SAME-NAMED definitions, so the merged definition's name equals the source child's container name on
// all 522 children, and inheriting is INDISTINGUISHABLE from recomposing for owningTypeName on this
// corpus. I reported that rather than bank the green.
//
// So this measures the thing that CAN differ. The registry entry's real hazard was never the VALUE —
// it was that three unregistered names would enter inheritedPropertyNamesOf (GAP 3) and could change
// decidedNonSignaturePropertyNames, WHICH IS STAMPED ONTO THE NODE. Census content moving quietly,
// through a path with nothing to do with the evidence seat.
//
// THE LEVER: remove the three names from DUPLICATED_CHILD_OVERRIDDEN_PROPERTY_NAMES, re-forge, diff.
//   IF IT MOVES     — the registry entry is LOAD-BEARING and companion edit 2 prevented a silent change.
//   IF IT DOES NOT  — companion edit 2 is a hazard that DOES NOT MATERIALISE ON THIS CORPUS, and this
//                     probe says so IN THOSE WORDS. A guard against a hazard that cannot occur here is
//                     still worth keeping for the next corpus, but it MUST NOT be sold as a save.
// I am not guessing which. The probe reports the number.
//
// PATTERN, inherited from p0b_compositionOrderingLevers.js rather than invented: pristine bytes and
// sha256 captured up front; the lever REFUSES if its target literal is not present EXACTLY ONCE (a
// lever that has drifted from the code cannot report a meaningful anything); the mutation is asserted
// to have actually changed the file; the restore is VERIFIED BY SHA256; and process.on('exit')
// restores even on a crash. Each forge runs in a CHILD PROCESS because Node caches modules — an
// in-process re-run would read the OLD module and report "no difference" forever.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');

const moduleName = 'p1_registryOmissionLever';
const PROBE_DIR = __dirname;
const BUNDLE_DIR = path.join(PROBE_DIR, '..', '..');
const TREE_ROOT = path.join(BUNDLE_DIR, '..', '..');
const SYNTHETIC_TIER_PATH = path.join(BUNDLE_DIR, 'lib', 'syntheticTier.js');
const COLLECTOR_PATH = path.join(PROBE_DIR, 'p1_collectMergedChildDecidedNames.js');

const LEVER_FIND_LITERAL = "\t'effectiveDescription',\n\t'owningTypeName',\n\t'proseSource',\n];";
const LEVER_REPLACE_LITERAL = '];';

const sha256OfFile = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

const pristineBytes = fs.readFileSync(SYNTHETIC_TIER_PATH);
const pristineDigest = sha256OfFile(SYNTHETIC_TIER_PATH);

const restoreShippedBytes = () => {
	if (sha256OfFile(SYNTHETIC_TIER_PATH) !== pristineDigest) {
		fs.writeFileSync(SYNTHETIC_TIER_PATH, pristineBytes);
	}
};
process.on('exit', restoreShippedBytes);

const resultList = [];
let assertionsReached = 0;
let failedCount = 0;

const assert = ({ name, pass, detail }) => {
	assertionsReached += 1;
	if (!pass) {
		failedCount += 1;
	}
	resultList.push({ name, verdict: pass ? 'PASS' : 'FAIL', detail });
};

const report = (extra) => {
	restoreShippedBytes();
	process.stdout.write(
		`${JSON.stringify(
			{
				probe: moduleName,
				assertionsReached,
				failedCount,
				verdict: assertionsReached === 0 ? 'VACUOUS — NOTHING RAN' : failedCount === 0 ? 'ALL GREEN' : 'RED',
				note: 'A failure count without the assertion count reached cannot distinguish a clean pass from a suite that aborted before asserting anything.',
				...extra,
				resultList,
			},
			null,
			2,
		)}\n`,
	);
	process.exitCode = failedCount === 0 && assertionsReached > 0 ? 0 : 1;
};

const runCollector = (label, callback) => {
	execFile(
		process.execPath,
		[COLLECTOR_PATH],
		{ cwd: TREE_ROOT, maxBuffer: 256 * 1024 * 1024, timeout: 900000 },
		(childError, stdout, stderr) => {
			if (childError) {
				callback(`${moduleName}: collector (${label}) failed: ${childError.message}\n${stderr}`);
				return;
			}
			const parsed = JSON.parse(stdout);
			if (parsed.collectorError) {
				callback(`${moduleName}: collector (${label}) refused: ${parsed.collectorError}`);
				return;
			}
			callback('', parsed);
		},
	);
};

const applyLever = () => {
	const originalText = fs.readFileSync(SYNTHETIC_TIER_PATH, 'utf8');
	const occurrenceCount = originalText.split(LEVER_FIND_LITERAL).length - 1;
	if (occurrenceCount !== 1) {
		return `${moduleName} REFUSES to apply: the lever's target literal occurs ${occurrenceCount} times in syntheticTier.js, expected exactly 1. The lever has DRIFTED from the code it claims to mutate, and a lever that cannot find its target cannot report a meaningful green or red.`;
	}
	fs.writeFileSync(SYNTHETIC_TIER_PATH, originalText.replace(LEVER_FIND_LITERAL, LEVER_REPLACE_LITERAL));
	return '';
};

// -------------------------------------------------------------------------------------------------
// STEP 1 — the SHIPPED baseline
// -------------------------------------------------------------------------------------------------
runCollector('shipped', (shippedError, shippedResult) => {
	if (shippedError) {
		assert({ name: 'BASELINE the shipped collector runs', pass: false, detail: shippedError });
		report({});
		return;
	}
	assert({
		name: 'BASELINE the shipped forge produces S-1c merged children (a zero would make every comparison below vacuous)',
		pass: shippedResult.mergedChildCount > 0,
		detail: `${shippedResult.mergedChildCount} merged children, ${shippedResult.nodeCount} nodes`,
	});

	// ---------------------------------------------------------------------------------------------
	// STEP 2 — apply the lever, PROVING the bytes actually moved
	// ---------------------------------------------------------------------------------------------
	const leverRefusal = applyLever();
	if (leverRefusal) {
		assert({ name: 'LEVER applies', pass: false, detail: leverRefusal });
		report({});
		return;
	}
	assert({
		name: 'LEVER the production bytes ACTUALLY changed (sha256 differs) — a mutation that did not land proves nothing',
		pass: sha256OfFile(SYNTHETIC_TIER_PATH) !== pristineDigest,
		detail: `pristine ${pristineDigest.slice(0, 16)}… mutated ${sha256OfFile(SYNTHETIC_TIER_PATH).slice(0, 16)}…`,
	});

	// ---------------------------------------------------------------------------------------------
	// STEP 3 — the MUTATED run, in a fresh child so the new bytes are actually loaded
	// ---------------------------------------------------------------------------------------------
	runCollector('mutated', (mutatedError, mutatedResult) => {
		restoreShippedBytes();
		assert({
			name: 'RESTORE the shipped bytes are restored, VERIFIED BY SHA256 (never assumed)',
			pass: sha256OfFile(SYNTHETIC_TIER_PATH) === pristineDigest,
			detail: `now ${sha256OfFile(SYNTHETIC_TIER_PATH).slice(0, 16)}… expected ${pristineDigest.slice(0, 16)}…`,
		});

		if (mutatedError) {
			assert({
				name: 'MUTATED the collector runs under the lever',
				pass: false,
				detail: `${mutatedError} — NOTE: a CRASH here is itself a finding (the omission would break the forge outright), but it is NOT the silent-census-change hazard this lever was built to measure`,
			});
			report({});
			return;
		}
		assert({
			name: 'MUTATED the forge still COMPLETES under the lever (so any difference below is a CONTENT change, not a crash)',
			pass: mutatedResult.mergedChildCount === shippedResult.mergedChildCount,
			detail: `shipped ${shippedResult.mergedChildCount} vs mutated ${mutatedResult.mergedChildCount} merged children`,
		});

		// -----------------------------------------------------------------------------------------
		// STEP 4 — THE COMPARISON THIS PROBE EXISTS FOR
		// -----------------------------------------------------------------------------------------
		const shippedByStableId = {};
		shippedResult.mergedChildRecordList.forEach((oneRecord) => {
			shippedByStableId[oneRecord.stableId] = oneRecord;
		});

		const decidedNamesMovedList = [];
		const seatValueMovedList = [];
		mutatedResult.mergedChildRecordList.forEach((oneMutated) => {
			const oneShipped = shippedByStableId[oneMutated.stableId];
			if (oneShipped === undefined) {
				return;
			}
			if (oneShipped.decidedNonSignaturePropertyNames !== oneMutated.decidedNonSignaturePropertyNames) {
				if (decidedNamesMovedList.length < 5) {
					decidedNamesMovedList.push({
						stableId: oneMutated.stableId,
						shipped: oneShipped.decidedNonSignaturePropertyNames,
						mutated: oneMutated.decidedNonSignaturePropertyNames,
					});
				}
			}
			if (
				oneShipped.owningTypeName !== oneMutated.owningTypeName ||
				oneShipped.effectiveDescription !== oneMutated.effectiveDescription ||
				oneShipped.proseSource !== oneMutated.proseSource
			) {
				if (seatValueMovedList.length < 5) {
					seatValueMovedList.push({ stableId: oneMutated.stableId, shipped: oneShipped, mutated: oneMutated });
				}
			}
		});

		const decidedNamesMovedCount = mutatedResult.mergedChildRecordList.filter((oneMutated) => {
			const oneShipped = shippedByStableId[oneMutated.stableId];
			return oneShipped !== undefined && oneShipped.decidedNonSignaturePropertyNames !== oneMutated.decidedNonSignaturePropertyNames;
		}).length;
		const seatValueMovedCount = mutatedResult.mergedChildRecordList.filter((oneMutated) => {
			const oneShipped = shippedByStableId[oneMutated.stableId];
			return (
				oneShipped !== undefined &&
				(oneShipped.owningTypeName !== oneMutated.owningTypeName ||
					oneShipped.effectiveDescription !== oneMutated.effectiveDescription ||
					oneShipped.proseSource !== oneMutated.proseSource)
			);
		}).length;

		// REPORTED, NOT ASSERTED AGAINST A TARGET. This probe's whole point is that I do not know the
		// answer in advance and must not write an assertion that presumes one.
		assert({
			name: 'MEASUREMENT the comparison was actually performed over the full merged-child population',
			pass: mutatedResult.mergedChildRecordList.length === shippedResult.mergedChildRecordList.length && mutatedResult.mergedChildRecordList.length > 0,
			detail: `${mutatedResult.mergedChildRecordList.length} children compared`,
		});

		report({
			THE_ANSWER: {
				decidedNonSignaturePropertyNamesMovedOnChildren: decidedNamesMovedCount,
				seatValuesMovedOnChildren: seatValueMovedCount,
				reading:
					decidedNamesMovedCount > 0
						? 'LOAD-BEARING: omitting the registry entry CHANGES a stamped property. Companion edit 2 prevented a silent census change.'
						: 'THE HAZARD DOES NOT MATERIALISE ON THIS CORPUS: omitting the registry entry changes no stamped property here. The guard is kept for the next corpus and MUST NOT be described as a defect caught.',
				seatValueReading:
					seatValueMovedCount > 0
						? 'the seat VALUES also move without the registry entry — inheritance would have produced different values'
						: 'the seat VALUES are identical either way on this corpus, consistent with the vacuity already reported for the S-1c owner gate',
			},
			decidedNamesMovedExamples: decidedNamesMovedList,
			seatValueMovedExamples: seatValueMovedList,
		});
	});
});
