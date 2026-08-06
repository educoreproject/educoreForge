#!/usr/bin/env node
'use strict';

// p4r_probeComputedContested.js — a SHIPPED-CONFIGURATION red lever for the restated G3-D checks.
//
// WHY THIS EXISTS. G3-D's restated assertions ("ZERO references into the contested namespace are
// resolved by COMPUTATION", and the 201 / 195+6 accounting of the decided ones) had red evidence
// only from p4_probeContested_derived.log, an EXPECTATION PERTURBATION — the constants were moved
// and the assertions dutifully went red. That proves the assertion READS THE OBSERVATION. It does
// not prove it RESISTS A REAL DEFECT, which is a different claim and the one that matters. The
// Phase 4 review flagged the gap ([G-3]); this closes it.
//
// THE ONE THING REVERTED. In lib/derivedTier.js's resolveOneReference, the contested-namespace
// branch records the ambiguity and RETURNS WITHOUT RESOLVING — that return IS the quarantine. This
// probe leaves the recording exactly as shipped and ADDS the structural resolution the quarantine
// exists to withhold: one addDerivedEdge call, in one branch. Nothing else is touched. The result
// is the half-applied quarantine — a plausible defect, since a maintainer "helpfully" emitting the
// edge while leaving the record in place would see every census in the suite stay green.
//
// A FIRST ATTEMPT, RECORDED BECAUSE THE OUTCOME IS A FINDING. The obvious lever — neutralising the
// contested-namespace CHECK itself (`if (false && contestedNamespaces.indexOf(...) !== -1)`) —
// does NOT reach G3-D. The build refuses earlier, at a different guard:
//
//     reference 'AcRec:HighSchoolType' matches 2 definitions in
//     'urn:org:pesc:sector:AcademicRecord:v1.6.0' — one symbol space should hold one
//
// The 31 shared names make the one-symbol-space guard fire on the first shared reference, so
// deleting the quarantine outright is caught by a SECOND defence rather than by G3-D. Worth
// knowing (the quarantine is not the only thing standing between the corpus and a computed
// contested resolution) but useless as a lever for the assertion under test, since it produces no
// graph at all. Hence the narrower mutation above, which leaves the build standing so the
// assertion can be observed doing its job.
//
// Run: node forges/pesc260805/test/probes/p4r_probeComputedContested.js
// Writes: test/test-artifacts/p4r_probeComputedContested_derived.log
// ALWAYS restores lib/derivedTier.js, including on failure.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const BUNDLE_DIR = path.join(__dirname, '..', '..');
const DERIVED_TIER_PATH = path.join(BUNDLE_DIR, 'lib', 'derivedTier.js');
const SUITE_PATH = path.join(BUNDLE_DIR, 'test', 'test-pesc260805DerivedTier.js');
const LOG_PATH = path.join(BUNDLE_DIR, 'test', 'test-artifacts', 'p4r_probeComputedContested_derived.log');

// anchored on the type-space branch's own last record field, because the IMPORTS branch pushes to
// the same list a hundred lines earlier and an unanchored needle would match both — which is TWO
// things, and would be exactly the compounding this probe refuses to do.
const THE_ONE_THING = `						candidateStableIds,
					};
					ambiguousPendingSynthesis.push(ambiguousEntry);`;
const THE_MUTATION = `						candidateStableIds,
					};
					/* PROBE — THE ONE THING: the contested branch now ALSO emits the structural
					   resolution the quarantine exists to withhold. The recording below is left
					   exactly as shipped, so every census that counts recorded entries stays green
					   and only the "resolved by COMPUTATION" assertions can notice. */
					if (candidateStableIds.length > 0) {
						addDerivedEdge('RESOLVES_TO', fromNode.stableId, candidateStableIds[0], {
							referenceVariety,
							writtenAs: writtenValue,
						});
						stats.resolvesToEdges++;
					}
					ambiguousPendingSynthesis.push(ambiguousEntry);`;

// GUARDS AGAINST A SILENTLY DIVERGENT PROBE. The N1 lesson was a probe that had reverted a SECOND
// thing and so proved nothing about the shipped build. These assert that the untouched defences
// are still present in the patched text, by name.
const MUST_REMAIN_INTACT = [
	{
		label: 'the contested-namespace CHECK itself',
		needle: 'if (contestedNamespaces.indexOf(boundNamespace) !== -1) {',
	},
	{
		label: 'the one-symbol-space multi-candidate refusal',
		needle: 'one symbol ',
	},
	{
		label: "the ambiguity record's per-node accumulation",
		needle: '(ambiguousEntriesByNode[fromNode.stableId] =',
	},
	{
		label: 'the unresolved-reference refusal for absent namespaces',
		needle: 'the bound namespace has no artifact in the corpus',
	},
];

const originalText = fs.readFileSync(DERIVED_TIER_PATH, 'utf8');
const originalSha = crypto.createHash('sha256').update(originalText).digest('hex');

const occurrences = originalText.split(THE_ONE_THING).length - 1;
if (occurrences !== 1) {
	throw new Error(
		`probe REFUSES: the mutation site appears ${occurrences} times in lib/derivedTier.js, not once. ` +
			'A probe that cannot name its own single change proves nothing.',
	);
}

const patchedText = originalText.replace(THE_ONE_THING, THE_MUTATION);
MUST_REMAIN_INTACT.forEach((oneGuard) => {
	if (patchedText.indexOf(oneGuard.needle) === -1) {
		throw new Error(
			`probe REFUSES: ${oneGuard.label} is not present in the patched source. The probe would have ` +
				'reverted more than one thing, which is the exact defect this discipline exists to prevent.',
		);
	}
});

let suiteOutput = '';
try {
	fs.writeFileSync(DERIVED_TIER_PATH, patchedText);
	try {
		suiteOutput = execFileSync(process.execPath, [SUITE_PATH], {
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
	} catch (thrownError) {
		// a suite that FAILS exits nonzero — that is the point of the probe, not an error
		suiteOutput = `${thrownError.stdout || ''}${thrownError.stderr || ''}`;
	}
} finally {
	fs.writeFileSync(DERIVED_TIER_PATH, originalText);
	const restoredSha = crypto
		.createHash('sha256')
		.update(fs.readFileSync(DERIVED_TIER_PATH, 'utf8'))
		.digest('hex');
	if (restoredSha !== originalSha) {
		throw new Error(
			`probe FAILED TO RESTORE lib/derivedTier.js (sha ${restoredSha} != ${originalSha}). The tree is ` +
				'left mutated — repair it before doing anything else.',
		);
	}
}

fs.writeFileSync(LOG_PATH, suiteOutput);
const failedLabels = suiteOutput
	.split('\n')
	.filter((oneLine) => /^\s*FAIL\s+/.test(oneLine))
	.map((oneLine) => oneLine.replace(/^\s*FAIL\s+/, ''));
console.log(`wrote ${LOG_PATH}`);
console.log(`lib/derivedTier.js restored (sha ${originalSha.substring(0, 12)})`);
console.log(`assertions observed RED: ${failedLabels.length}`);
failedLabels.forEach((oneLabel) => console.log(`   ${oneLabel}`));
