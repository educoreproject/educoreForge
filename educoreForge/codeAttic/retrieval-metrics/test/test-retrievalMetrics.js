#!/usr/bin/env node
'use strict';

// test-retrievalMetrics.js — HERMETIC gate for lib/retrieval-metrics (⟪P11, 2026-07-31⟫).
//
// Every fixture in this suite is SYNTHETIC and built in-process, so the suite is green on a bare
// checkout with no dataStores at all. The acceptance gate against the real CASE corpus is a
// SEPARATE suite (test-retrievalMetricsCaseAcceptance.js) precisely so that the absence of that
// corpus fails ITS gate loudly instead of quietly weakening this one.
//
// PROVES:
//   SECTION 1 — R7: every public callable REFUSES to run without a callback.
//   SECTION 2 — the parser: headers, cosines, nominations, body markers; preamble ignored;
//     indented prose that RESEMBLES a header is not mistaken for one; a non-finite cosine is
//     refused by name rather than admitted as NaN.
//   SECTION 3 — DISPLAY ORDER IS NOT RANK. A pool listed out of cosine order ranks by cosine, and
//     ties break deterministically by display position.
//   SECTION 4 — analyzeRecord's four outcomes, and the RESCUE DISTINCTION as a RED/GREEN twin:
//     a nominated winner INSIDE the cutoff is 'merely nominated' and NOT a genuine rescue; the
//     same winner outside the cutoff IS one. This is the exact conflation (155 vs 20) the module
//     was built to end, held here by a test that fails if the two ever collapse into one number.
//   SECTION 5 — computeMetrics: buckets, denominators, and the two rescue numbers side by side.
//   SECTION 6 — the abstention lint: over-threshold probes FLAG, under-threshold probes do not,
//     and discovered recurring phrases are never flagged.
//   SECTION 7 — I/O: a malformed JSONL line is COUNTED, never silently dropped; trail discovery
//     refusals; a generation-less run measures EVERY generation.
//
// Run: node lib/retrieval-metrics/test/test-retrievalMetrics.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for lib/retrieval-metrics (the retrieval measurement instrument)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the prompt parser, the cosine re-ranking (display order is NOT rank), the four
     judgment outcomes, the GENUINE-rescue vs merely-nominated distinction, the metric
     denominators, the abstention lint's flag threshold, and the I/O refusals. Entirely
     synthetic fixtures -- green on a bare checkout.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const retrievalMetrics = require('../retrieval-metrics')();

// ---------------------------------------------------------------------
// FIXTURE BUILDERS — the renderer's literal prompt shape, reproduced
// ---------------------------------------------------------------------
// Byte-faithful to lib.d/evidenceRenderer's output: an unindented `N) name — retrieval cosine X`
// header, an optionally indented `Nominated by <tool>: <rationale>` line, then indented body
// markers. If the renderer's shape ever changes, THIS is the fixture that must change with it.

const PREAMBLE =
	'You are weighing ALL of the evidence below to judge whether ONE candidate is the correct match.\n' +
	'Source standard note: definitions are frequently terse.\n' +
	'\n' +
	'EVIDENCE\n';

const candidateBlock = ({ position, name, cosine, nominatedBy, rationale }) => {
	const header = `${position}) ${name} — retrieval cosine ${cosine}\n`;
	const nomination = nominatedBy
		? `   Nominated by ${nominatedBy}: ${rationale || 'shares token(s) [x] with this candidate'}\n`
		: '';
	return (
		header +
		nomination +
		`  CEDS Reference: P00000${position} — "${name}"\n` +
		`  Domain(s): C200064\n` +
		`  Range: scalar — string\n` +
		`  Notes: Source structural location: owning class 'Thing', property 'thing'.\n` +
		'\n'
	);
};

const makePrompt = (candidateSpecs) =>
	PREAMBLE +
	candidateSpecs.map(candidateBlock).join('') +
	'Reply with the number of the single best-supported candidate, or NONE.\n';

const makeRecord = ({ choice, category, rationale, candidateSpecs, sourceStableId }) => ({
	timestamp: '2026-07-31T00:00:00.000Z',
	sourceStableId: sourceStableId || 'test:Thing.thing',
	sourceName: 'thing',
	promptText: makePrompt(candidateSpecs || []),
	model: 'claude-opus-4-8',
	rendererVersion: 'evidenceRenderer-v2',
	generation: 'testBridge-evidence-v1',
	judgedVia: 'cache:abc',
	response: { choice, category: category || 'moderate', rationale: rationale || 'because' },
});

// a pool of `count` candidates with strictly descending cosines, cosine = 0.9 - position/100
const descendingPool = (count) =>
	Array.from({ length: count }, (unused, index) => ({
		position: index + 1,
		name: `Candidate ${index + 1}`,
		cosine: (0.9 - (index + 1) / 100).toFixed(6),
	}));

// =====================================================================
harness.section('SECTION 1 — R7: a public callable REFUSES to run without a callback');
// =====================================================================

[
	'parseCandidateBlocks',
	'rankCandidatesByCosine',
	'analyzeRecord',
	'lintAbstentions',
	'computeMetrics',
	'readForensicRecords',
	'discoverTrails',
	'measureTrail',
	'measurePair',
	'renderReportText',
].forEach((oneName) => {
	let thrown = null;
	try {
		retrievalMetrics[oneName]({});
	} catch (error) {
		thrown = error;
	}
	harness.ok(
		`${oneName} throws when called with no callback (R7)`,
		thrown !== null && /callback is REQUIRED/.test(String(thrown.message)),
		thrown ? thrown.message : 'did not throw at all',
	);
});

// =====================================================================
harness.section('SECTION 2 — the parser');
// =====================================================================

retrievalMetrics.parseCandidateBlocks({}, (err) => {
	harness.match('a missing promptText is refused by name', err, /promptText is REQUIRED/);
});
retrievalMetrics.parseCandidateBlocks({ promptText: 42 }, (err) => {
	harness.match('a non-string promptText is refused by name', err, /promptText is REQUIRED/);
});

retrievalMetrics.parseCandidateBlocks(
	{
		promptText: makePrompt([
			{ position: 1, name: 'Alpha Identifier URI', cosine: '0.591891' },
			{ position: 2, name: 'Beta Name', cosine: '0.524533', nominatedBy: 'caseEvidenceBridge', rationale: 'shares [beta]' },
		]),
	},
	(err, result) => {
		harness.accepts('a well-formed prompt parses cleanly', err ? [err] : []);
		const candidates = (result || {}).candidates || [];
		harness.equal('  both candidate blocks are found', candidates.length, 2);
		harness.equal('  the display position is read', candidates[0].displayPosition, 1);
		harness.equal('  the name is read whole (embedded spaces survive)', candidates[0].name, 'Alpha Identifier URI');
		harness.equal('  the cosine is read as a number', candidates[0].retrievalCosine, 0.591891);
		harness.equal('  an un-nominated candidate carries no nominatedBy', candidates[0].nominatedBy, '');
		harness.equal('  a nominated candidate names its nominator', candidates[1].nominatedBy, 'caseEvidenceBridge');
		harness.equal('  and carries the nomination rationale', candidates[1].nominationRationale, 'shares [beta]');
		harness.ok(
			'  body markers are recognized (CEDS reference, domains, range, notes)',
			['cedsReference', 'domains', 'range', 'notes'].every((one) => candidates[0].bodyMarkers.indexOf(one) !== -1),
			JSON.stringify(candidates[0].bodyMarkers),
		);
	},
);

// The preamble, the global segment and the trailing instruction are NOT candidate blocks, and an
// INDENTED line that resembles a header must not be mistaken for one -- the indent is the only
// thing separating a block header from prose that looks like it, so this is the parser's keystone.
retrievalMetrics.parseCandidateBlocks(
	{
		promptText:
			PREAMBLE +
			candidateBlock({ position: 1, name: 'Real Candidate', cosine: '0.5' }) +
			'  Notes: an earlier run said 9) Fake Candidate — retrieval cosine 0.999999\n' +
			'Reply with the number.\n',
	},
	(err, result) => {
		harness.accepts('a prompt with header-shaped PROSE parses cleanly', err ? [err] : []);
		harness.equal(
			'  the INDENTED header-shaped line is NOT parsed as a candidate',
			((result || {}).candidates || []).length,
			1,
		);
	},
);

// A header-shaped line whose cosine is NOT a number must be REFUSED BY NAME. The alternative --
// declining to recognize the line at all -- would make the candidate block VANISH from the pool,
// silently shrinking it and shifting every rank below it. A vanished candidate is a wrong number
// that looks like a right one; a refusal is a sentence.
['NaN', '1e999', '0.5abc', 'null'].forEach((oneBadCosine) => {
	retrievalMetrics.parseCandidateBlocks(
		{ promptText: `${PREAMBLE}1) Broken — retrieval cosine ${oneBadCosine}\n` },
		(err, result) => {
			harness.match(
				`RED: a cosine of '${oneBadCosine}' is REFUSED BY NAME, never silently dropped`,
				err,
				/not a finite number/,
			);
			harness.ok(
				`  and no candidate is handed back carrying a bad cosine ('${oneBadCosine}')`,
				!((result || {}).candidates || []).some((one) => !isFinite(one.retrievalCosine)),
				JSON.stringify((result || {}).candidates),
			);
		},
	);
});

// GREEN twin: the numeric forms the renderer actually emits still parse.
['0.591891', '0.22791', '-0.05', '1e-3', '0'].forEach((oneGoodCosine) => {
	retrievalMetrics.parseCandidateBlocks(
		{ promptText: `${PREAMBLE}1) Fine — retrieval cosine ${oneGoodCosine}\n` },
		(err, result) => {
			harness.equal(
				`GREEN: a cosine of '${oneGoodCosine}' parses to its number`,
				((result || {}).candidates || [{}])[0].retrievalCosine,
				parseFloat(oneGoodCosine),
			);
		},
	);
});

// =====================================================================
harness.section('SECTION 3 — DISPLAY ORDER IS NOT RANK');
// =====================================================================

retrievalMetrics.rankCandidatesByCosine({}, (err) => {
	harness.match('a missing candidates array is refused by name', err, /candidates is REQUIRED/);
});

// This is the real shape of a composed pool: the cosine top-K first, then NOMINATED candidates
// appended with LOWER, unsorted cosines. Reading display position as rank would call candidate 3
// "rank 3" when cosine puts it last.
retrievalMetrics.rankCandidatesByCosine(
	{
		candidates: [
			{ displayPosition: 1, name: 'top', retrievalCosine: 0.9 },
			{ displayPosition: 2, name: 'second', retrievalCosine: 0.8 },
			{ displayPosition: 3, name: 'appended nomination', retrievalCosine: 0.2 },
			{ displayPosition: 4, name: 'another appended nomination', retrievalCosine: 0.5 },
		],
	},
	(err, result) => {
		harness.accepts('a pool listed OUT of cosine order ranks cleanly', err ? [err] : []);
		const ranked = (result || {}).rankedCandidates || [];
		harness.equal('  rank 1 is the highest cosine', ranked[0].name, 'top');
		harness.equal('  rank 3 is the higher of the two APPENDED nominations', ranked[2].name, 'another appended nomination');
		harness.equal(
			'  the candidate DISPLAYED third ranks LAST by cosine (display order is not rank)',
			ranked[3].name,
			'appended nomination',
		);
		harness.equal('  cosineRank is stamped on every candidate', ranked[3].cosineRank, 4);
	},
);

retrievalMetrics.rankCandidatesByCosine(
	{
		candidates: [
			{ displayPosition: 7, name: 'later', retrievalCosine: 0.324488 },
			{ displayPosition: 3, name: 'earlier', retrievalCosine: 0.324488 },
		],
	},
	(err, result) => {
		const ranked = (result || {}).rankedCandidates || [];
		harness.equal(
			'IDENTICAL cosines break by display position, so ranking is deterministic',
			ranked[0].name,
			'earlier',
		);
	},
);

// =====================================================================
harness.section('SECTION 4 — the four outcomes, and the RESCUE DISTINCTION (RED/GREEN twin)');
// =====================================================================

retrievalMetrics.analyzeRecord({ record: 'not an object' }, (err) => {
	harness.match('a non-object record is refused by name', err, /record is REQUIRED/);
});
retrievalMetrics.analyzeRecord({ record: {}, cosineCutoff: 0 }, (err) => {
	harness.match('a cosineCutoff below 1 is refused by name', err, /cosineCutoff must be a finite number/);
});

retrievalMetrics.analyzeRecord(
	{ record: makeRecord({ choice: 'NONE', candidateSpecs: descendingPool(5) }) },
	(err, result) => {
		harness.equal('a NONE choice is an abstention', (result || {}).analysis.outcome, 'abstention');
		harness.equal('  and its pool is still measured', (result || {}).analysis.poolSize, 5);
	},
);
retrievalMetrics.analyzeRecord(
	{ record: makeRecord({ choice: 'banana', candidateSpecs: descendingPool(5) }) },
	(err, result) => {
		harness.equal(
			'an unreadable choice is its OWN outcome, not silently an abstention',
			(result || {}).analysis.outcome,
			'unrecognizedChoice',
		);
	},
);
retrievalMetrics.analyzeRecord(
	{ record: makeRecord({ choice: '99', candidateSpecs: descendingPool(5) }) },
	(err, result) => {
		harness.equal(
			'a choice naming a candidate the pool does not have is its OWN outcome',
			(result || {}).analysis.outcome,
			'unresolvableChoice',
		);
	},
);

// THE TWIN. One pool, one nominated winner, two cutoffs. The ONLY difference between "merely
// nominated" and "a genuine rescue" is whether cosine would have retrieved it anyway.
const nominatedWinnerPool = descendingPool(20).map((one) =>
	one.position === 6 ? Object.assign({}, one, { nominatedBy: 'testBridge' }) : one,
);
const nominatedWinnerRecord = makeRecord({ choice: '6', candidateSpecs: nominatedWinnerPool });

retrievalMetrics.analyzeRecord({ record: nominatedWinnerRecord, cosineCutoff: 15 }, (err, result) => {
	const analysis = (result || {}).analysis;
	harness.equal('GREEN: the winner ranks 6th by cosine', analysis.winnerCosineRank, 6);
	harness.equal('  it DID carry a nomination', analysis.winnerCarriedNomination, true);
	harness.equal(
		'  RED: but it is NOT a genuine rescue -- cosine would have retrieved it anyway',
		analysis.winnerWasGenuineRescue,
		false,
	);
	harness.equal('  and it counts toward recall', analysis.winnerWithinCosineCutoff, true);
});
retrievalMetrics.analyzeRecord({ record: nominatedWinnerRecord, cosineCutoff: 5 }, (err, result) => {
	const analysis = (result || {}).analysis;
	harness.equal(
		'GREEN: the SAME nominated winner, now OUTSIDE the cutoff, IS a genuine rescue',
		analysis.winnerWasGenuineRescue,
		true,
	);
	harness.equal('  and it does NOT count toward recall', analysis.winnerWithinCosineCutoff, false);
});

retrievalMetrics.analyzeRecord(
	{ record: makeRecord({ choice: '1', candidateSpecs: descendingPool(20) }), cosineCutoff: 15 },
	(err, result) => {
		const analysis = (result || {}).analysis;
		harness.equal('an UN-nominated cosine-top-1 winner is top-1', analysis.winnerWasCosineTopOne, true);
		harness.equal('  carries no nomination', analysis.winnerCarriedNomination, false);
		harness.equal('  and is certainly not a rescue', analysis.winnerWasGenuineRescue, false);
		harness.equal('  and lands in the rank1 bucket', analysis.winnerRankBucket, 'rank1');
	},
);

// =====================================================================
harness.section('SECTION 5 — computeMetrics: buckets, denominators, both rescue numbers');
// =====================================================================

retrievalMetrics.computeMetrics({ records: 'nope' }, (err) => {
	harness.match('a non-array records is refused by name', err, /records is REQUIRED/);
});

// four picks landing in four different buckets, plus one abstention. Pool of 20 so a rank-16+
// pick is expressible; the winner at display position 16 is nominated, making it the ONE genuine
// rescue in the set -- while TWO picks carry a nomination.
const bucketPool = (nominatedPositions) =>
	descendingPool(20).map((one) =>
		nominatedPositions.indexOf(one.position) === -1
			? one
			: Object.assign({}, one, { nominatedBy: 'testBridge' }),
	);

const mixedRecords = [
	makeRecord({ choice: '1', candidateSpecs: bucketPool([]) }), // rank 1
	makeRecord({ choice: '2', candidateSpecs: bucketPool([2]) }), // rank 2-3, nominated, NOT a rescue
	makeRecord({ choice: '7', candidateSpecs: bucketPool([]) }), // rank 4-10
	makeRecord({ choice: '16', candidateSpecs: bucketPool([16]) }), // rank 16+, nominated -> GENUINE rescue
	makeRecord({ choice: 'NONE', rationale: 'none of the candidates are supported', candidateSpecs: bucketPool([]) }),
];

retrievalMetrics.computeMetrics(
	{ records: mixedRecords, pairKey: 'CEDS::TEST', generation: 'testBridge-evidence-v1' },
	(err, result) => {
		harness.accepts('a mixed record set computes cleanly', err ? [err] : []);
		const metrics = (result || {}).metrics;
		harness.equal('the record count is every record', metrics.recordCount, 5);
		harness.equal('picks exclude abstentions', metrics.judgmentOutcomes.picks, 4);
		harness.equal('abstentions are counted', metrics.judgmentOutcomes.abstentions, 1);
		harness.equal('  rank1 bucket', metrics.winnerRankDistribution.rank1.count, 1);
		harness.equal('  rank2to3 bucket', metrics.winnerRankDistribution.rank2to3.count, 1);
		harness.equal('  rank4to10 bucket', metrics.winnerRankDistribution.rank4to10.count, 1);
		harness.equal('  rank11to15 bucket', metrics.winnerRankDistribution.rank11to15.count, 0);
		harness.equal('  rank16plus bucket', metrics.winnerRankDistribution.rank16plus.count, 1);
		harness.equal('cosine top-1 accuracy counts only rank 1', metrics.cosineTopOneAccuracy.hits, 1);
		harness.equal('  over the PICK denominator, never the record count', metrics.cosineTopOneAccuracy.of, 4);
		harness.equal('  as a percent', metrics.cosineTopOneAccuracy.percent, 25);
		harness.equal('recall counts picks within the cutoff', metrics.recallWithinCosineCutoff.hits, 3);
		harness.equal('  as a percent', metrics.recallWithinCosineCutoff.percent, 75);
		// THE TWO NUMBERS, SIDE BY SIDE, DIFFERENT.
		harness.equal('GENUINE rescues counts only nominated winners OUTSIDE the cutoff', metrics.rescueAttribution.genuineRescues, 1);
		harness.equal(
			'  while "winner merely carried a nomination" is the LARGER, WEAKER number',
			metrics.rescueAttribution.winnerCarriedNomination,
			2,
		);
		harness.ok(
			'  and the two are never the same field',
			metrics.rescueAttribution.genuineRescues !== metrics.rescueAttribution.winnerCarriedNomination,
			'the conflation this module exists to end',
		);
		harness.equal('pool composition measures every pool', metrics.poolComposition.poolsMeasured, 5);
		harness.equal('  and reports the pool size', metrics.poolComposition.maxPoolSize, 20);
		harness.equal('the metrics stamp their own version', metrics.metricsVersion, retrievalMetrics.METRICS_VERSION);
	},
);

retrievalMetrics.computeMetrics({ records: [] }, (err, result) => {
	harness.accepts('an EMPTY record set is a legitimate measurement, not an error', err ? [err] : []);
	const metrics = (result || {}).metrics;
	harness.equal('  a percentage of nothing is null, never 0', metrics.cosineTopOneAccuracy.percent, null);
});

// =====================================================================
harness.section('SECTION 6 — the abstention lint');
// =====================================================================

retrievalMetrics.lintAbstentions({ rationales: 'nope' }, (err) => {
	harness.match('a non-array rationales is refused by name', err, /rationales is REQUIRED/);
});
retrievalMetrics.lintAbstentions({ rationales: [], flagThreshold: 5 }, (err) => {
	harness.match(
		'a flagThreshold stated as a PERCENT (5) rather than a share is refused by name',
		err,
		/flagThreshold must be a number between 0 and 1/,
	);
});

// nine honest abstentions plus one carrying the source-not-visible phrasing = 10%, over the 5%
// default threshold, so that probe FLAGS while the untriggered ones do not.
const lintRationales = Array.from({ length: 9 }, () => 'the pool simply held nothing appropriate here').concat([
	'the source definition is empty, so there is nothing to match from',
]);
retrievalMetrics.lintAbstentions({ rationales: lintRationales }, (err, result) => {
	harness.accepts('the lint runs cleanly', err ? [err] : []);
	const lint = (result || {}).abstentionLint;
	const probeNamed = (key) => lint.probes.find((one) => one.key === key);
	harness.equal('the abstention count is reported', lint.abstentionCount, 10);
	harness.equal('a probe over the threshold FIRES', probeNamed('sourceNotVisible').count, 1);
	harness.equal('  and is FLAGGED (10% > 5%)', probeNamed('sourceNotVisible').flagged, true);
	harness.equal('  and appears in flaggedSignals', lint.flaggedSignals.length, 1);
	harness.equal('a probe that never matched is NOT flagged', probeNamed('insufficientEvidence').flagged, false);
	harness.ok(
		'every declared probe is reported whether it fired or not (a silent probe is an unwatched defect)',
		lint.probes.length === retrievalMetrics.ABSTENTION_PROBES.length,
		`${lint.probes.length} of ${retrievalMetrics.ABSTENTION_PROBES.length}`,
	);
	harness.ok(
		'recurring phrasing is DISCOVERED (the boilerplate 9/10 phrase surfaces)',
		lint.recurringPhrases.some((one) => one.phrase.indexOf('held nothing appropriate') !== -1),
		JSON.stringify(lint.recurringPhrases.slice(0, 3)),
	);
	harness.ok(
		'  but a discovered phrase is NEVER a flagged signal',
		lint.flaggedSignals.every((one) => typeof one.key === 'string' && one.defect),
		'flaggedSignals must contain only declared probes',
	);
});

// AT the threshold is not OVER it -- exactly 5% must not flag when the rule is ">5%".
retrievalMetrics.lintAbstentions(
	{
		rationales: Array.from({ length: 19 }, () => 'nothing matched').concat([
			'the source definition is empty here',
		]),
	},
	(err, result) => {
		const probe = (result || {}).abstentionLint.probes.find((one) => one.key === 'sourceNotVisible');
		harness.equal('exactly AT the threshold (5%) does NOT flag -- the rule is strictly greater', probe.flagged, false);
	},
);

// =====================================================================
harness.section('SECTION 7 — I/O: reading trails and discovering them');
// =====================================================================

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfRetrievalMetricsGate-'));
const forensicsDirPath = path.join(scratchDir, 'matchForensics');
const pairDirPath = path.join(forensicsDirPath, 'CEDS::TEST');
fs.mkdirSync(pairDirPath, { recursive: true });

const trailOnePath = path.join(pairDirPath, 'testBridge-evidence-v1.jsonl');
const trailTwoPath = path.join(pairDirPath, 'testBridge-evidence-v2.jsonl');
fs.writeFileSync(
	trailOnePath,
	`${JSON.stringify(mixedRecords[0])}\n` +
		'this line is not JSON at all\n' +
		`${JSON.stringify(mixedRecords[4])}\n` +
		'\n',
	'utf8',
);
fs.writeFileSync(trailTwoPath, `${JSON.stringify(mixedRecords[3])}\n`, 'utf8');

retrievalMetrics.readForensicRecords({}, (err) => {
	harness.match('reading with no filePath is refused by name', err, /filePath is REQUIRED/);
});
retrievalMetrics.readForensicRecords({ filePath: path.join(pairDirPath, 'nope.jsonl') }, (err) => {
	harness.match('reading a trail that is not there is refused by name', err, /reading '.*nope\.jsonl'/);
});
retrievalMetrics.readForensicRecords({ filePath: trailOnePath }, (err, result) => {
	harness.accepts('a real trail reads cleanly', err ? [err] : []);
	harness.equal('  the parseable records are returned', result.records.length, 2);
	harness.equal('  a MALFORMED line is COUNTED, never silently dropped', result.malformedLineCount, 1);
	harness.equal('  and its line number is named', result.malformedLines[0], 2);
});

retrievalMetrics.discoverTrails({ forensicsDirPath }, (err) => {
	harness.match('discovery with no pairKey is refused by name', err, /pairKey is REQUIRED/);
});
retrievalMetrics.discoverTrails({ pairKey: 'CEDS::TEST' }, (err) => {
	harness.match('discovery with no forensicsDirPath is refused by name', err, /forensicsDirPath is REQUIRED/);
});
retrievalMetrics.discoverTrails({ forensicsDirPath, pairKey: 'CEDS::ABSENT' }, (err) => {
	harness.match('an unknown pairKey is refused, LISTING the pairs present', err, /Pairs present: CEDS::TEST/);
});
retrievalMetrics.discoverTrails({ forensicsDirPath, pairKey: 'CEDS::TEST', generation: 'nope' }, (err) => {
	harness.match(
		'an unknown generation is refused, LISTING the generations present',
		err,
		/Generations present: testBridge-evidence-v1, testBridge-evidence-v2/,
	);
});
retrievalMetrics.discoverTrails({ forensicsDirPath, pairKey: 'CEDS::TEST' }, (err, result) => {
	harness.equal('with NO generation named, EVERY generation is discovered', result.trails.length, 2);
});
retrievalMetrics.discoverTrails(
	{ forensicsDirPath, pairKey: 'CEDS::TEST', generation: 'testBridge-evidence-v2' },
	(err, result) => {
		harness.equal('a named generation narrows to exactly one trail', result.trails.length, 1);
		harness.equal('  and it is the right one', result.trails[0].filePath, trailTwoPath);
	},
);

retrievalMetrics.measurePair({ forensicsDirPath, pairKey: 'CEDS::TEST' }, (err, result) => {
	harness.accepts('measurePair runs end to end over every generation', err ? [err] : []);
	harness.equal('  one report per generation', result.reports.length, 2);
	harness.equal(
		'  the malformed line count survives into the report',
		result.reports[0].malformedLineCount,
		1,
	);
	retrievalMetrics.renderReportText({ reports: result.reports }, (renderError, rendered) => {
		harness.accepts('the readable report renders', renderError ? [renderError] : []);
		harness.match('  it names the pair and generation', rendered.reportText, /CEDS::TEST\s+\/\s+testBridge-evidence-v1/);
		harness.match('  it states BOTH rescue numbers', rendered.reportText, /GENUINE rescues/);
		harness.match('  and labels the weaker one as weaker', rendered.reportText, /WEAKER claim/);
		harness.match('  it stamps the instrument version', rendered.reportText, /retrievalMetrics-v1/);

		fs.rmSync(scratchDir, { recursive: true, force: true });
		harness.report();
	});
});
