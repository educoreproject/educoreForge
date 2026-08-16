#!/usr/bin/env node
'use strict';

// test-cedsRoundTripValidator.js — THE GATES FOR CEDS'S DECLARED RT-13 ENTRY POINT.
//
// WHY THIS SUITE EXISTS, stated plainly because it is the justification for adding a suite to the
// tree. Round-Trip Perfection Phase 3.5 gave CEDS a declared `roundTripValidator` — the uniform
// entry point the RT-13 builder stage can invoke. Before it, CEDS was declared-ABSENT to the stage
// and tolerated, which made the Phase 8 gate ("four verdicts against the combined graph")
// unachievable by the mechanism its own gate names. The measurement machinery already existed and
// is untouched; what is NEW is the plumbing, the RT-3 door, and the A13 arithmetic — and new code
// with no gate is exactly the claim-without-enforcement this campaign exists to prevent.
//
// ⚠️ THE ONE THING TO UNDERSTAND BEFORE READING THE ASSERTIONS. Phase 2 shipped A13 assertions in
// three bundles that were GREEN AND COULD NOT HAVE GONE RED: every hermetic fixture in the tree
// reports explicitlyOmitted = 0, and with a zero in that slot `contentGap + explicitlyOmitted ===
// notReproduced` and `lostTotal === contentGapTotal` are both true under the OLD arithmetic too.
// 0 + N === N proves nothing. CEDS makes that trap WORSE, not better, because its registry is
// empty BY RULING and can never carry a nonzero in production.
//
// This suite answers it by making the registry a PARAMETER rather than a hidden constant:
// `assembleVerdictNumbers({ report, explicitlyOmittedPredicateList })` is pure and synchronous, so
// section 2 can drive it with a POPULATED list over a report whose loss splits unevenly, and watch
// contentGapTotal and notReproducedTotal come back as DIFFERENT NUMBERS — the state no other CEDS
// fixture can reach, and the state under which a hardcoded zero fails.
//
// AND THE SEAM IS PROVEN AGAINST THE LIVE STAGE, NOT AGAINST A RESTATEMENT OF IT. Section 6 builds
// a REAL verdict through the real code path and hands it to the actual
// `round-trip-stage.runRoundTripStage`, whose private `adjudicateVerdict` is what decides whether a
// bundle's verdict is conformant. Every other bundle's suite asserts against its own copy of the
// rules; if the stage tightens again the way Phase 2 tightened it, this gate notices and theirs do
// not.
//
// Hermetic: no Docker, no bolt, no Voyage, no network. It writes only into a scratch directory
// under the OS temp dir, which it removes.
//
// Run: node forges/ceds/test/test-cedsRoundTripValidator.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for the CEDS declared roundTripValidator (RT-13 entry point)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
DESCRIPTION
     Proves the RT-3 snapshot door refuses by name on five separate wrongs, that the A13
     partition is performed arithmetic rather than a hardcoded zero, that the partition
     invariant refuses a report whose rows do not close, and that a real verdict produced
     through the real code path is accepted by the LIVE RT-13 stage while three damaged
     twins are refused by it.
OPTIONS
     -verbose    Show every individual assertion, not just failures and the tally.
     -quiet      Failures and the tally only.
     -help       This message.
EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const validatorLib = require('../roundTripValidator')();
const compilerLib = require('../lib/roundTripCompiler')();
const roundTripStageLib = require('../../../apps/graph-builder/lib/round-trip-stage')();

const CEDS = 'https://w3id.org/CEDStandards/terms/';

const scratchRootDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cedsRtValidatorGate-'));
const scratchDir = (oneName) => {
	const dirPath = path.join(scratchRootDirPath, oneName);
	fs.mkdirSync(dirPath, { recursive: true });
	return dirPath;
};

// a logger double: the stage requires xLog.status and we want the stage's own lines captured
// rather than printed into the middle of the assertion tally.
const capturedStageLines = [];
const stageLoggerDouble = {
	status: (oneLine) => capturedStageLines.push(oneLine),
	error: (oneLine) => capturedStageLines.push(`ERROR ${oneLine}`),
};

// =====================================================================
harness.section(
	'THE REGISTRY IS EMPTY BY RULING — and the emptiness must be load bearing, not decorative',
);
// =====================================================================
// Both directions are needed and neither alone is enforcement. Asserting the registry is empty
// passes against a stub that ignores it entirely; asserting a populated one moves the numbers
// (section 2) does not prove the SHIPPED default is empty. Together they do.
harness.ok(
	'EXPLICITLY_OMITTED_PREDICATES is exported as an array',
	Array.isArray(validatorLib.EXPLICITLY_OMITTED_PREDICATES),
	typeof validatorLib.EXPLICITLY_OMITTED_PREDICATES,
);
harness.equal(
	'the registry is EMPTY — TQ 2026-08-02: if it is in the OWL, it has to come out of the graph',
	validatorLib.EXPLICITLY_OMITTED_PREDICATES.length,
	0,
);
harness.equal(
	'the verdict version is the A13 shape',
	validatorLib.VERDICT_VERSION,
	'cedsRoundTripVerdict-2',
);
harness.ok(
	'assembleVerdictNumbers is exported as a testable pure seam',
	typeof validatorLib.assembleVerdictNumbers === 'function',
);
harness.ok('validate is exported — the RT-13 uniform entry point', typeof validatorLib.validate === 'function');
harness.ok('validateWithReader is exported', typeof validatorLib.validateWithReader === 'function');
harness.ok('verifySnapshotDir is exported', typeof validatorLib.verifySnapshotDir === 'function');

// =====================================================================
harness.section(
	'THE A13 PARTITION IS PERFORMED ARITHMETIC — driven with a NONZERO omitted count, the state no CEDS fixture reaches',
);
// =====================================================================
// A hand-built report in the shape lib/roundTripDiff.js produces. Loss splits 40 / 10 across two
// predicates so that moving one of them into the registry changes BOTH totals by a visible amount.
const reportFixture = () => ({
	reportVersion: 'cedsRoundTrip-1',
	headline: { matched: 100, lost: 50, invented: 0 },
	perPredicate: [
		{ predicate: `${CEDS}chosenNotToCarry`, source: 40, emitted: 0, matched: 0, lost: 40, invented: 0 },
		{ predicate: `${CEDS}genuineBacklog`, source: 10, emitted: 0, matched: 0, lost: 10, invented: 0 },
		{ predicate: `${CEDS}reproducedFine`, source: 100, emitted: 100, matched: 100, lost: 0, invented: 0 },
	],
});

const defaultRegistryResult = validatorLib.assembleVerdictNumbers({ report: reportFixture() });
harness.equal(
	'with the SHIPPED (empty) registry the assembly succeeds',
	defaultRegistryResult.error,
	undefined,
);
const shipped = defaultRegistryResult.numbers || {};
harness.equal('shipped: explicitlyOmittedTotal is 0', shipped.explicitlyOmittedTotal, 0);
harness.equal('shipped: contentGapTotal absorbs all 50', shipped.contentGapTotal, 50);
harness.equal('shipped: lostTotal IS contentGap alone (A13)', shipped.lostTotal, 50);
harness.equal('shipped: notReproducedTotal preserves the old arithmetic', shipped.notReproducedTotal, 50);
harness.ok('shipped: roundTripClean is FALSE over 50 content gaps', shipped.roundTripClean === false);

// THE DISCRIMINATING DRIVE. The same report, partitioned against a POPULATED registry.
const populatedRegistryResult = validatorLib.assembleVerdictNumbers({
	report: reportFixture(),
	explicitlyOmittedPredicateList: [`${CEDS}chosenNotToCarry`],
});
harness.equal(
	'with a POPULATED registry the assembly succeeds',
	populatedRegistryResult.error,
	undefined,
);
const populated = populatedRegistryResult.numbers || {};
harness.equal(
	'populated: explicitlyOmittedTotal is 40 — NONZERO, which is the whole point of this section',
	populated.explicitlyOmittedTotal,
	40,
);
harness.equal('populated: contentGapTotal drops to the 10 genuine gaps', populated.contentGapTotal, 10);
harness.equal('populated: lostTotal follows contentGap, not the sum', populated.lostTotal, 10);
harness.equal(
	'populated: notReproducedTotal is UNCHANGED at 50 — no number was destroyed',
	populated.notReproducedTotal,
	50,
);
// This is the assertion a hardcoded zero cannot satisfy, and the reason the seam takes a parameter.
harness.ok(
	'CONTENT GAP and NOT REPRODUCED are DIFFERENT numbers here — the partition can discriminate the two arithmetics',
	populated.contentGapTotal !== populated.notReproducedTotal,
	`contentGap=${populated.contentGapTotal} notReproduced=${populated.notReproducedTotal}`,
);
harness.ok(
	'the shipped and populated runs disagree — so the registry parameter is load bearing, not ignored',
	shipped.contentGapTotal !== populated.contentGapTotal,
	`shipped=${shipped.contentGapTotal} populated=${populated.contentGapTotal}`,
);
harness.equal(
	'populated: the matched rows are reported by name, not just counted',
	JSON.stringify(populated.explicitlyOmittedRowList),
	JSON.stringify([{ predicate: `${CEDS}chosenNotToCarry`, explicitlyOmitted: 40 }]),
);

// roundTripClean is DRIVEN BY THE PARTITION, not by the raw loss. Claim every lost predicate and
// the boolean must flip — which is precisely why CEDS is forbidden a registry by ruling.
const allClaimedResult = validatorLib.assembleVerdictNumbers({
	report: reportFixture(),
	explicitlyOmittedPredicateList: [`${CEDS}chosenNotToCarry`, `${CEDS}genuineBacklog`],
});
harness.ok(
	'claiming EVERY lost predicate flips roundTripClean to true over 50 not-reproduced statements',
	(allClaimedResult.numbers || {}).roundTripClean === true,
	JSON.stringify(allClaimedResult.numbers || allClaimedResult.error),
);
harness.equal(
	'…and notReproducedTotal still reports the 50, so the flip is visible rather than hidden',
	(allClaimedResult.numbers || {}).notReproducedTotal,
	50,
);

// INVENTION drives the boolean too, independently of loss.
const inventedReport = reportFixture();
inventedReport.headline = { matched: 100, lost: 0, invented: 2 };
inventedReport.perPredicate = [
	{ predicate: `${CEDS}reproducedFine`, source: 100, emitted: 102, matched: 100, lost: 0, invented: 2 },
];
const inventedResult = validatorLib.assembleVerdictNumbers({ report: inventedReport });
harness.equal('invention is carried into the verdict numbers', (inventedResult.numbers || {}).inventedTotal, 2);
harness.ok(
	'roundTripClean is FALSE on invention even with zero content gap — the hard line',
	(inventedResult.numbers || {}).roundTripClean === false,
);

// =====================================================================
harness.section('THE PARTITION INVARIANT REFUSES BY NAME — a partition that does not close is not a verdict');
// =====================================================================
// If the per-predicate rows do not account for exactly the headline loss, the split is measuring
// something other than the loss it claims to partition. A tool that answers here instead of
// refusing is the exact defect class this campaign keeps meeting.
const notClosingReport = reportFixture();
notClosingReport.headline.lost = 77; // rows still sum to 50
const notClosing = validatorLib.assembleVerdictNumbers({ report: notClosingReport });
harness.ok(
	'a report whose rows do not sum to the headline loss is REFUSED, not partitioned',
	typeof notClosing.error === 'string' && notClosing.numbers === undefined,
	JSON.stringify(notClosing),
);
harness.match(
	'…and the refusal names both numbers so the reader can see the discrepancy',
	notClosing.error || '',
	/50.*77|77.*50/s,
);
harness.match(
	'…and it says the arithmetic does not close rather than merely failing',
	notClosing.error || '',
	/does not close/,
);

const noRowsReport = reportFixture();
delete noRowsReport.perPredicate;
harness.match(
	'a report with NO perPredicate array is refused by name — the split is never guessed',
	(validatorLib.assembleVerdictNumbers({ report: noRowsReport }) || {}).error || '',
	/perPredicate/,
);
harness.match(
	'an absent report is refused by name, never treated as an empty one',
	(validatorLib.assembleVerdictNumbers({}) || {}).error || '',
	/REQUIRED/,
);
// THE ONE DECLARED DEFAULT IN THIS MODULE, PINNED. Omitting the parameter is legitimately
// optional input (polyArch2: a default is correct when it is documented) and it takes the
// bundle's own registry. That is exactly what production does, so it must be asserted rather
// than assumed — and asserted as an EQUIVALENCE, so it cannot pass by both paths being ignored.
const omittedParameterRun = validatorLib.assembleVerdictNumbers({ report: reportFixture() });
const explicitConstantRun = validatorLib.assembleVerdictNumbers({
	report: reportFixture(),
	explicitlyOmittedPredicateList: validatorLib.EXPLICITLY_OMITTED_PREDICATES,
});
harness.equal(
	'omitting the parameter is EXACTLY passing the module registry — the documented default is real',
	JSON.stringify(omittedParameterRun.numbers),
	JSON.stringify(explicitConstantRun.numbers),
);
harness.ok(
	'…and that shared result differs from the populated run, so neither path is simply ignoring its input',
	JSON.stringify(omittedParameterRun.numbers) !== JSON.stringify(populated),
);

harness.match(
	'a non-array registry is refused by name — omit it for the declared registry, never coerce',
	(
		validatorLib.assembleVerdictNumbers({
			report: reportFixture(),
			explicitlyOmittedPredicateList: 'chosenNotToCarry',
		}) || {}
	).error || '',
	/must be an array/,
);

// =====================================================================
harness.section('RT-3 AT THE DOOR — five separate wrongs, five separate refusals, each by name');
// =====================================================================
// One generically-broken directory would prove one thing five times. Each of these is wrong in
// exactly one way, so each refusal is attributable.
const sha256Of = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const writeSnapshot = ({ dirName, ontologyText, sumsText, extraFiles = {} }) => {
	const dirPath = scratchDir(dirName);
	if (ontologyText !== null) {
		fs.writeFileSync(path.join(dirPath, 'fixtureOntology.rdf'), ontologyText);
	}
	if (sumsText !== null) {
		fs.writeFileSync(path.join(dirPath, 'SHA256SUMS'), sumsText);
	}
	Object.keys(extraFiles).forEach((oneName) =>
		fs.writeFileSync(path.join(dirPath, oneName), extraFiles[oneName]),
	);
	return dirPath;
};
const refusalFrom = (snapshotPath) => {
	let captured = 'NO CALLBACK FIRED';
	validatorLib.verifySnapshotDir({ snapshotPath }, (verifyError) => {
		captured = verifyError || '';
	});
	return captured;
};

const ontologyBytes = '<?xml version="1.0"?>\n<rdf:RDF/>\n';

harness.match(
	'WRONG 1 — no SHA256SUMS at all: refused, pointing at the provenance contract',
	refusalFrom(writeSnapshot({ dirName: 'wrong1NoSums', ontologyText: ontologyBytes, sumsText: null })),
	/SHA256SUMS.*README_PROVENANCE|README_PROVENANCE.*SHA256SUMS/s,
);
harness.match(
	'WRONG 2 — a digest that does not match the bytes: refused with both digests named',
	refusalFrom(
		writeSnapshot({
			dirName: 'wrong2BadDigest',
			ontologyText: ontologyBytes,
			sumsText: `${'0'.repeat(64)}  fixtureOntology.rdf\n`,
		}),
	),
	/fails its SHA256SUMS check/,
);
harness.match(
	'WRONG 3 — an .rdf present but UNLISTED: refused rather than silently diffed',
	refusalFrom(
		writeSnapshot({
			dirName: 'wrong3Unlisted',
			ontologyText: ontologyBytes,
			sumsText: `${sha256Of('something else')}  someOther.rdf\n`,
			extraFiles: {},
		}),
	),
	/NOT listed in SHA256SUMS/,
);
harness.match(
	'WRONG 4 — a file LISTED but absent from the snapshot: refused',
	refusalFrom(
		writeSnapshot({
			dirName: 'wrong4Absent',
			ontologyText: ontologyBytes,
			sumsText:
				`${sha256Of(ontologyBytes)}  fixtureOntology.rdf\n` +
				`${sha256Of('gone')}  vanishedOntology.rdf\n`,
		}),
	),
	/is ABSENT from the snapshot/,
);
harness.match(
	'WRONG 5a — ZERO .rdf candidates: a snapshot with no source is a missing input, not an empty diff',
	refusalFrom(writeSnapshot({ dirName: 'wrong5aNone', ontologyText: null, sumsText: '' })),
	/holds no \.rdf ontology/,
);
harness.match(
	'WRONG 5b — TWO .rdf candidates: a stray second ontology would silently measure something else',
	refusalFrom(
		writeSnapshot({
			dirName: 'wrong5bTwo',
			ontologyText: ontologyBytes,
			sumsText: '',
			extraFiles: { 'secondOntology.rdf': ontologyBytes },
		}),
	),
	/candidate \.rdf files/,
);
harness.match(
	'a blank snapshotPath is refused and has no default',
	refusalFrom(''),
	/REQUIRED and has no default/,
);
harness.match(
	'a snapshotPath that names no directory is refused',
	refusalFrom(path.join(scratchRootDirPath, 'definitelyNotThere')),
	/does not exist|is not a directory/,
);

// the positive control: a CORRECT snapshot passes the same door. Without this, every refusal
// above is satisfied by a door that refuses everything.
let goodSnapshotResult = null;
const goodSnapshotDirPath = writeSnapshot({
	dirName: 'goodSnapshot',
	ontologyText: ontologyBytes,
	sumsText: `${sha256Of(ontologyBytes)}  fixtureOntology.rdf\n`,
});
validatorLib.verifySnapshotDir({ snapshotPath: goodSnapshotDirPath }, (verifyError, verifyResult) => {
	harness.equal('CONTROL — a correct snapshot is ACCEPTED (the door is not simply always shut)', verifyError, '');
	goodSnapshotResult = verifyResult;
});
harness.equal(
	'…and it names the one ontology it found',
	(goodSnapshotResult || {}).ontologyFilename,
	'fixtureOntology.rdf',
);
harness.ok(
	'…and reports a combined digest for the verdict to record',
	/^[0-9a-f]{64}$/.test((goodSnapshotResult || {}).combinedDigest || ''),
);

// =====================================================================
harness.section('THE UNIFORM ENTRY POINT REFUSES BY NAME — no default graph, no default output');
// =====================================================================
let validateRefusal = 'NO CALLBACK FIRED';
validatorLib.validate({ snapshotPath: goodSnapshotDirPath, outputPath: scratchDir('unused') }, (oneError) => {
	validateRefusal = oneError || '';
});
harness.match(
	'validate with neither containerName nor a bolt triple is refused — a graph is never guessed at',
	validateRefusal,
	/containerName OR the full bolt triple/,
);
let readerRefusal = 'NO CALLBACK FIRED';
validatorLib.validateWithReader({ reader: {}, snapshotPath: goodSnapshotDirPath }, (oneError) => {
	readerRefusal = oneError || '';
});
harness.match('validateWithReader with no outputPath is refused', readerRefusal, /outputPath is REQUIRED/);

// =====================================================================
// From here the instrument does real file I/O, so the remaining sections are callback-chained
// and the tally is reported at the end of the chain — the same serial idiom test-cedsRoundTrip.js
// uses, and the reason is the same: one harness, one report.
// =====================================================================
// The graph double: the same one-method contract makeNeo4jCedsReader's product exposes, so
// compileToFile and the serializer cannot tell it from the real reader.
const graphRowsFor = ({ includeSecondClass }) => ({
	rootNodes: [
		{
			stableId: CEDS,
			uri: CEDS,
			role: 'DmeStandardRoot',
			version: '99.0.0.0',
			name: 'CEDS',
			description: 'the validator-gate fixture ontology',
		},
	],
	classNodes: [
		{
			stableId: `${CEDS}C990000`,
			uri: `${CEDS}C990000`,
			role: 'DmeClass',
			cedsId: 'C990000',
			crossRefs: JSON.stringify([
				{ system: 'ceds', id: 'C990000', raw: 'C990000', locator: 'dc:identifier' },
			]),
			name: 'Fixture Base',
			description: 'The base class of the validator-gate fixture.',
		},
		...(includeSecondClass
			? [
					{
						stableId: `${CEDS}C990001`,
						uri: `${CEDS}C990001`,
						role: 'DmeClass',
						cedsId: 'C990001',
						crossRefs: JSON.stringify([
							{ system: 'ceds', id: 'C990001', raw: 'C990001', locator: 'dc:identifier' },
						]),
						name: 'Fixture Second',
						description: 'A second class, dropped by the loss-detection twin.',
					},
				]
			: []),
	],
});
const makeGraphDouble = ({ includeSecondClass }) => ({
	readAll: (callback) => compilerLib.assembleCedsGraph(graphRowsFor({ includeSecondClass }), callback),
	close: (callback) => callback(''),
});

// The answer key is the FULL graph's own emission, written into a proper checksummed snapshot.
// That makes a clean reading REACHABLE, which is what lets a nonzero mean something later.
const answerKeyDirPath = scratchDir('answerKeySnapshot');
const cleanOutputDirPath = scratchDir('cleanVerdictOutput');
let cleanVerdict = null;
let lossyVerdict = null;
const verdictOf = () => cleanVerdict || {};
const lossyOf = () => lossyVerdict || {};

const buildAnswerKeySection = (done) => {
	harness.section('THE ANSWER KEY — the full graph writes its own checksummed snapshot');
	compilerLib.compileToFile(
		{
			reader: makeGraphDouble({ includeSecondClass: true }),
			outPath: path.join(answerKeyDirPath, 'fixtureOntology.rdf'),
		},
		(compileError) => {
			harness.equal('the answer-key emission compiles', compileError, '');
			if (compileError) {
				done();
				return;
			}
			const bytes = fs.readFileSync(path.join(answerKeyDirPath, 'fixtureOntology.rdf'));
			fs.writeFileSync(
				path.join(answerKeyDirPath, 'SHA256SUMS'),
				`${sha256Of(bytes)}  fixtureOntology.rdf\n`,
			);
			harness.ok(
				'the answer-key snapshot is checksummed and would pass the RT-3 door',
				fs.existsSync(path.join(answerKeyDirPath, 'SHA256SUMS')),
			);
			done();
		},
	);
};

const runCleanVerdictSection = (done) => {
	harness.section(
		'END TO END — a REAL verdict from the real code path, adjudicated by the LIVE RT-13 stage',
	);
	validatorLib.validateWithReader(
		{
			reader: makeGraphDouble({ includeSecondClass: true }),
			snapshotPath: answerKeyDirPath,
			outputPath: cleanOutputDirPath,
			graphIdentity: { containerName: 'DEV_hermeticDouble', boltUrl: 'bolt://double' },
		},
		(validateError, verdict) => {
			harness.equal('the whole instrument runs against the double without refusal', validateError, '');
			cleanVerdict = verdict;
			done();
		},
	);
};

const runVerdictShapeSection = (done) => {
	harness.ok('a verdict came back', !!cleanVerdict);
	harness.equal('verdictVersion is cedsRoundTripVerdict-2', verdictOf().verdictVersion, 'cedsRoundTripVerdict-2');
harness.equal('the verdict names its standard', verdictOf().standard, 'CEDS');
harness.ok('roundTripClean is TRUE on a self-consistent round trip', verdictOf().roundTripClean === true);
harness.equal('inventedTotal is 0 — the hard line', verdictOf().inventedTotal, 0);
harness.equal('contentGapTotal is 0', verdictOf().contentGapTotal, 0);
harness.equal('explicitlyOmittedTotal is 0 — DERIVED from the empty registry, not written as a literal', verdictOf().explicitlyOmittedTotal, 0);
harness.equal('lostTotal is 0', verdictOf().lostTotal, 0);
harness.equal('notReproducedTotal is 0', verdictOf().notReproducedTotal, 0);
harness.ok('reproduced is a positive count — the fixture measured something', verdictOf().reproduced > 0, `${verdictOf().reproduced}`);
harness.ok(
	'the verdict carries the registry AND its authority, so an empty category cannot be read as an unasked question',
	((verdictOf().explicitlyOmittedRegistry || {}).authority || '').includes('EMPTY BY RULING'),
);
harness.equal(
	'the verdict records the snapshot digest it verified',
	typeof (verdictOf().snapshot || {}).combinedDigest,
	'string',
);
// Phase 4 (root-and-branch, K3): CEDS was the one survivor whose verdict declared NO
// semanticValidationLimit, so the RT-13 stage substituted "NONE DECLARED BY THIS BUNDLE". The limit is
// now stated FROM THE CODE in roundTripValidator.js; this locks that it travels in the verdict and names
// the load-bearing clauses. (Observed red with the declaration absent — DEVLOG Phase 4 K3.)
harness.ok(
	'the verdict DECLARES its semanticValidationLimit (a non-empty string; the stage no longer substitutes NONE DECLARED)',
	typeof verdictOf().semanticValidationLimit === 'string' && verdictOf().semanticValidationLimit.trim() !== '',
);
harness.match(
	'the declared limit names the statement domain, the Layer-1 scope and the A13 arithmetic',
	verdictOf().semanticValidationLimit,
	/STATEMENT-SET equality[\s\S]*LAYER 1 ONLY[\s\S]*lostTotal IS contentGapTotal[\s\S]*NOT MODELLED/,
);

harness.ok(
	'the verdict artifact is on disk',
	fs.existsSync(path.join(cleanOutputDirPath, 'roundTripVerdict.json')),
);
harness.ok(
	'the human report is on disk beside it',
	fs.existsSync(path.join(cleanOutputDirPath, 'roundTrip.report.txt')),
);
harness.ok(
	'the emission a human can open is on disk',
	fs.existsSync(path.join(cleanOutputDirPath, 'emitted', 'cedsOntology.emitted.rdf')),
);
	done();
};

// ---------------------------------------------------------------------
// THE SEAM ITSELF — driven through round-trip-stage.runRoundTripStage so the LIVE
// adjudicateVerdict does the judging. `damageVerdict` is where each twin breaks one thing.
// ---------------------------------------------------------------------
const stageRunWith = ({ damageVerdict, outputDirName }, stageRunDone) => {
	const outputDirPath = scratchDir(outputDirName);
	roundTripStageLib.runRoundTripStage(
		{
			stageSpec: {
				mode: 'build',
				enabled: true,
				outputDirPath,
				roster: {
					rosterRows: [
						{
							token: 'ceds',
							standardName: 'CEDS',
							disposition: 'declared',
							snapshotDirPath: answerKeyDirPath,
							validatorApi: {
								// the REAL validator, reached through the double instead of bolt. The verdict
								// the stage adjudicates is production code's own output, damaged (or not)
								// by exactly one edit.
								validate: ({ outputPath }, validateDone) =>
									validatorLib.validateWithReader(
										{
											reader: makeGraphDouble({ includeSecondClass: true }),
											snapshotPath: answerKeyDirPath,
											outputPath,
										},
										(validateError, verdict) => {
											if (validateError) {
												validateDone(validateError);
												return;
											}
											validateDone('', damageVerdict ? damageVerdict(verdict) : verdict);
										},
									),
							},
						},
					],
					declaredTokens: ['ceds'],
					absentTokens: [],
				},
			},
			containerHandle: {
				containerName: 'DEV_hermeticDouble',
				boltUrl: 'bolt://double',
				user: 'neo4j',
				password: 'notARealSecret',
			},
			xLog: stageLoggerDouble,
		},
		(stageError, stageSummary) => {
			stageRunDone({ error: stageError, summary: stageSummary });
		},
	);
};

const runStageSeamSection = (done) => {
	stageRunWith({ damageVerdict: null, outputDirName: 'stageAccepts' }, (stageAccepted) => {
		harness.equal(
			'THE SEAM HOLDS — the live RT-13 stage ACCEPTS the undamaged verdict',
			stageAccepted.error,
			'',
		);
		harness.ok('…and reports the stage as having run', (stageAccepted.summary || {}).stageRan === true);

		// TWIN 1 — one normative field removed. This is the gate on the FIVE-field contract, and it
		// is asserted by the stage's own refusal rather than by a list restated here, so a future
		// tightening of that list is caught here and nowhere else.
		stageRunWith(
			{
				damageVerdict: (verdict) => {
					const damaged = { ...verdict };
					delete damaged.contentGapTotal;
					return damaged;
				},
				outputDirName: 'stageRefusesMissingField',
			},
			(twinMissingField) => {
				harness.match(
					'TWIN — a verdict missing contentGapTotal is REFUSED BY NAME by the live stage',
					twinMissingField.error || '',
					/lacks the normative RT-6 field\(s\) contentGapTotal/,
				);

				// TWIN 2 — the stale -1 shape: the two A13 fields absent together, exactly the
				// artifact the Phase 2 refusal was built to catch.
				stageRunWith(
					{
						damageVerdict: (verdict) => {
							const damaged = { ...verdict, verdictVersion: 'cedsRoundTripVerdict-1' };
							delete damaged.contentGapTotal;
							delete damaged.explicitlyOmittedTotal;
							return damaged;
						},
						outputDirName: 'stageRefusesStaleVersion',
					},
					(twinStaleVersion) => {
						harness.match(
							'TWIN — a stale -1-shaped verdict is REFUSED rather than read under the new arithmetic',
							twinStaleVersion.error || '',
							/contentGapTotal, explicitlyOmittedTotal/,
						);

						// TWIN 3 — invention. The hard line, enforced by the stage, not by this bundle.
						stageRunWith(
							{
								damageVerdict: (verdict) => ({ ...verdict, inventedTotal: 3, invented: 3 }),
								outputDirName: 'stageRefusesInvention',
							},
							(twinInvented) => {
								harness.match(
									'TWIN — inventedTotal above zero FAILS the build through the live stage',
									twinInvented.error || '',
									/inventedTotal=3.*INVENTED must be 0/s,
								);
								done();
							},
						);
					},
				);
			},
		);
	});
};

// =====================================================================
// LOSS IS DETECTED — the clean reading above is a result, not a property of the rig.
// A rig that always reports clean is worthless. The same answer key, read from a graph missing one
// class: the loss must appear as contentGap, roundTripClean must go false, and invention must stay
// at zero — a graph that carries LESS can lose, but it must never fabricate.
// =====================================================================
const runLossDetectionSection = (done) => {
	harness.section('LOSS IS DETECTED — the clean reading above is a result, not a property of the rig');
	validatorLib.validateWithReader(
		{
			reader: makeGraphDouble({ includeSecondClass: false }),
			snapshotPath: answerKeyDirPath,
			outputPath: scratchDir('lossyVerdictOutput'),
		},
		(validateError, verdict) => {
			harness.equal('the instrument runs against the reduced graph without refusal', validateError, '');
			lossyVerdict = verdict;
			done();
		},
	);
};

const runLossAssertionSection = (done) => {
	harness.ok(
	'a graph missing one class reports NONZERO contentGap',
	lossyOf().contentGapTotal > 0,
	`contentGapTotal=${lossyOf().contentGapTotal}`,
);
harness.ok('…so roundTripClean is FALSE', lossyOf().roundTripClean === false);
harness.equal('…and inventedTotal is STILL 0 — losing is not fabricating', lossyOf().inventedTotal, 0);
harness.equal(
	'…and lostTotal equals contentGapTotal, the registry being empty',
	lossyOf().lostTotal,
	lossyOf().contentGapTotal,
);
harness.equal(
	'…and notReproducedTotal equals it too, which is what an empty registry MEANS',
	lossyOf().notReproducedTotal,
	lossyOf().contentGapTotal,
);
harness.ok(
	'the two verdicts genuinely differ — the clean one was not a rig artifact',
	verdictOf().contentGapTotal !== lossyOf().contentGapTotal,
	`clean=${verdictOf().contentGapTotal} lossy=${lossyOf().contentGapTotal}`,
);
	done();
};

// serial, because the harness tallies into one report
buildAnswerKeySection(() => {
	runCleanVerdictSection(() => {
		runVerdictShapeSection(() => {
			runStageSeamSection(() => {
				runLossDetectionSection(() => {
					runLossAssertionSection(() => {
						fs.rmSync(scratchRootDirPath, { recursive: true, force: true });
						harness.ok(
							'the scratch directory is removed — this suite leaves nothing behind',
							!fs.existsSync(scratchRootDirPath),
						);
						harness.report();
					});
				});
			});
		});
	});
});
