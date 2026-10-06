#!/usr/bin/env node
'use strict';

// test-retrievalMetricsCaseAcceptance.js — THE ACCEPTANCE GATE (⟪P11, 2026-07-31⟫).
//
// Holds lib/retrieval-metrics to a set of numbers derived INDEPENDENTLY of it, from the real CASE
// forensic trail. This is how we know the instrument is right rather than merely self-consistent:
// the expected values below were computed by a separate reading of the same file, and the module
// must reproduce them EXACTLY.
//
//   ⟪THE RULE⟫ IF THE PARSER YIELDS DIFFERENT NUMBERS, THE PARSER IS WRONG. Debug it against the
//   real file. DO NOT adjust the expected values. An acceptance test whose expectations drift to
//   meet the implementation is a mirror, not a gate, and this project has already paid once for
//   believing a number nothing was holding.
//
// WHY THIS IS A SEPARATE SUITE. It reads a corpus that lives in dataStores, OUTSIDE the code tree,
// and is therefore not hermetic. Its sibling (test-retrievalMetrics.js) is entirely synthetic and
// green on a bare checkout. Splitting them means a machine WITHOUT the corpus fails THIS gate
// loudly -- by name, saying exactly which file it wanted -- instead of quietly passing a weakened
// version of it. A missing corpus is a missing gate, and a missing gate must never read as
// coverage (the same doctrine runAllTests applies when it reports a module as NONE).
//
// Run: node lib/retrieval-metrics/test/test-retrievalMetricsCaseAcceptance.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- the CASE acceptance gate for lib/retrieval-metrics

SYNOPSIS
     ${moduleName} [--forensicsDirPath=<path>] [-verbose] [-quiet] [-help]

DESCRIPTION
     Runs the retrieval-metrics instrument over the REAL CEDS::CASE forensic trail
     (caseEvidenceBridge-evidence-v2) and requires it to reproduce a set of independently
     derived numbers EXACTLY: 204 picks; winner rank 1=124, 2-3=30, 4-10=22, 11-15=8, 16+=20;
     cosine top-1 60.8%; recall within top-15 90.2%; 20 GENUINE rescues.

     If the numbers differ, the PARSER is wrong -- the expected values are not to be adjusted.

OPTIONS
     --forensicsDirPath=<path>   Where the forensic match log lives. Defaults to the documented
                                 canonical home, system/dataStores/matchForensics.

EXIT STATUS
     0 all assertions passed;  1 at least one failed (including: the corpus is not on this machine).
`;

const commandLineParameters = require('../../../test/testLib/testAppStartup')({
	moduleName,
	helpText: helpText(),
});

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');

const retrievalMetrics = require('../retrieval-metrics')();

// ---------------------------------------------------------------------
// THE INDEPENDENTLY DERIVED EXPECTATIONS — do not adjust to meet the code
// ---------------------------------------------------------------------
const ACCEPTANCE_PAIR_KEY = 'CEDS::CASE';
const ACCEPTANCE_GENERATION = 'caseEvidenceBridge-evidence-v2';
const EXPECTED = {
	picks: 204,
	rank1: 124,
	rank2to3: 30,
	rank4to10: 22,
	rank11to15: 8,
	rank16plus: 20,
	cosineTopOneHits: 124,
	cosineTopOnePercent: 60.8,
	recallPercent: 90.2,
	genuineRescues: 20,
};

const DEFAULT_FORENSICS_DIR_PATH =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/matchForensics';

const forensicsDirPath =
	(commandLineParameters.values.forensicsDirPath || [])[0] || DEFAULT_FORENSICS_DIR_PATH;
const acceptanceFilePath = path.join(
	forensicsDirPath,
	ACCEPTANCE_PAIR_KEY,
	`${ACCEPTANCE_GENERATION}.jsonl`,
);

// =====================================================================
harness.section('SECTION 1 — the acceptance corpus is present');
// =====================================================================
// ABSENCE IS A FAILURE, NOT A SKIP. A gate that cannot run has not been satisfied.

harness.ok(
	'the real CEDS::CASE forensic trail is on this machine',
	fs.existsSync(acceptanceFilePath),
	`expected the acceptance corpus at:\n  ${acceptanceFilePath}\n` +
		`This gate cannot be satisfied by absence. Point it elsewhere with --forensicsDirPath=<path> ` +
		`if the forensic match log lives somewhere else on this machine.`,
);

if (!fs.existsSync(acceptanceFilePath)) {
	harness.report();
	return;
}

// =====================================================================
harness.section('SECTION 2 — the independently derived numbers, reproduced EXACTLY');
// =====================================================================

retrievalMetrics.measurePair(
	{ forensicsDirPath, pairKey: ACCEPTANCE_PAIR_KEY, generation: ACCEPTANCE_GENERATION },
	(measureError, measured) => {
		harness.accepts('the CASE trail measures cleanly', measureError ? [measureError] : []);
		if (measureError) {
			harness.report();
			return;
		}

		harness.equal('exactly one generation was measured', measured.reports.length, 1);
		const metrics = measured.reports[0];

		harness.equal('the trail read is the acceptance corpus', metrics.forensicFilePath, acceptanceFilePath);
		harness.equal('no line of the real trail was malformed', metrics.malformedLineCount, 0);
		harness.equal(
			'no judgment carried a choice the instrument could not resolve',
			metrics.judgmentOutcomes.unresolvableChoices + metrics.judgmentOutcomes.unrecognizedChoices,
			0,
		);

		harness.equal('PICKS', metrics.judgmentOutcomes.picks, EXPECTED.picks);

		harness.equal('winner rank 1', metrics.winnerRankDistribution.rank1.count, EXPECTED.rank1);
		harness.equal('winner rank 2-3', metrics.winnerRankDistribution.rank2to3.count, EXPECTED.rank2to3);
		harness.equal('winner rank 4-10', metrics.winnerRankDistribution.rank4to10.count, EXPECTED.rank4to10);
		harness.equal('winner rank 11-15', metrics.winnerRankDistribution.rank11to15.count, EXPECTED.rank11to15);
		harness.equal('winner rank 16+', metrics.winnerRankDistribution.rank16plus.count, EXPECTED.rank16plus);

		// the buckets must ACCOUNT for every pick -- a histogram that loses one is not a histogram
		const bucketTotal = retrievalMetrics.RANK_BUCKETS.reduce(
			(soFar, oneBucket) => soFar + metrics.winnerRankDistribution[oneBucket.key].count,
			0,
		);
		harness.equal('the buckets account for EVERY pick, none lost', bucketTotal, EXPECTED.picks);

		harness.equal('cosine top-1 hits', metrics.cosineTopOneAccuracy.hits, EXPECTED.cosineTopOneHits);
		harness.equal('cosine top-1 denominator is the pick count', metrics.cosineTopOneAccuracy.of, EXPECTED.picks);
		harness.equal('cosine top-1 accuracy', metrics.cosineTopOneAccuracy.percent, EXPECTED.cosineTopOnePercent);

		harness.equal('recall is measured against the top-15 cutoff', metrics.recallWithinCosineCutoff.cosineCutoff, 15);
		harness.equal('recall (within cosine top-15)', metrics.recallWithinCosineCutoff.percent, EXPECTED.recallPercent);

		harness.equal('GENUINE rescues', metrics.rescueAttribution.genuineRescues, EXPECTED.genuineRescues);

		// THE CONFLATION, HELD APART. The weaker count is much larger on this very corpus -- which
		// is exactly how a rescue figure got overstated in the first place. The gate does not fix
		// the weaker number to a literal (it is not one of the independently derived expectations);
		// it requires only that the two remain DIFFERENT fields with the weaker one strictly larger.
		harness.ok(
			'"winner merely carried a nomination" is a SEPARATE and strictly larger number',
			metrics.rescueAttribution.winnerCarriedNomination > metrics.rescueAttribution.genuineRescues,
			`genuine=${metrics.rescueAttribution.genuineRescues}, ` +
				`merelyNominated=${metrics.rescueAttribution.winnerCarriedNomination} — if these are ever ` +
				`equal on this corpus the distinction has collapsed and the 155-vs-20 error is back`,
		);
		harness.ok(
			'  and every genuine rescue is, necessarily, also a nominated winner',
			metrics.rescueAttribution.genuineRescues <= metrics.rescueAttribution.winnerCarriedNomination,
			'genuine rescues are a SUBSET of nominated winners',
		);

		// rank16+ and the genuine rescues coincide on this corpus, and that is not a coincidence:
		// nothing gets into the pool below the cosine cutoff EXCEPT by nomination. Asserting it
		// makes the claim checkable rather than merely asserted in prose.
		harness.equal(
			'every rank-16+ winner is a genuine rescue (nothing reaches the pool below the cutoff except by nomination)',
			metrics.winnerRankDistribution.rank16plus.count,
			metrics.rescueAttribution.genuineRescues,
		);

		harness.report();
	},
);
