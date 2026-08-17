#!/usr/bin/env node
'use strict';

// p0b_compositionOrderingLevers.js — RED EVIDENCE for the five shipped COMPOSITION assertions in
// test-pesc260805SourceTier.js (TQ 2026-08-17 "re-embed authorized"; SABLE_RIVER required the twin
// explicitly: "OBSERVE IT RED against the naive in-makeNode composition before you make it green —
// and report the red number, not just the green").
//
// IT OBSERVES THE SHIPPED ASSERTIONS FAILING, not merely a condition failing. Each lever plants a
// defect in PRODUCTION code, runs the SHIPPED suite as a child process, and reads which assertion
// labels came back FAIL. A probe that checked its own private predicate would prove the predicate
// can fail and say nothing about whether the shipped gate would notice.
//
// WHY FOUR LEVERS AND NOT ONE — this is the part worth reading, because the first design was wrong:
//
//   The builder first proposed a SINGLE gate — zero C1-shaped emissions, meaning no composed text is
//   a bare element name — as the twin for the ORDERING trap. IT CANNOT CATCH THAT TRAP, and that was
//   found while building this probe rather than after shipping. The C0 arm DELEGATES to the shared
//   composer, which for a PROPERTY role always emits `OwningType | ElementName`, so a separator is
//   always present and the naive placement produces no C1-SHAPED text at all. What actually goes
//   wrong is that ~68% of declarations are ROUTED to the no-prose arm: the failure is in the arm
//   SELECTION, and a shape check is blind to it.
//
//   Four DISTINCT failures, each with its own lever, and the levers redden DIFFERENT label sets —
//   which is the discrimination proof. A single conjunction over all four would have hidden exactly
//   the case above. Same reasoning as RT-13.3 being three assertions rather than one `A AND B AND C`.
//
//     LEVER 1  the ORDERING trap — compose from the SOURCE graph, which predates RESOLVES_TO.
//              The index is exactly empty and the production pass REFUSES by name, so the forge
//              produces no graph at all. Does NOT move the C1 counter.
//     LEVER 2  an arm that emits a BARE NAME — the C0 arm mutated to return the element name.
//              That is C1, the DISQUALIFIED arm. Reddens the C1 counter and the shape envelope.
//     LEVER 3  RESOLUTION BYPASSED — resolveEffectiveDescription stops after the node's own prose
//              and never follows RESOLVES_TO. The forge COMPLETES, which is what makes this
//              different from lever 1: the damage is silent, and only the borrowed-prose assertion
//              notices.
//     LEVER 4  the C2 arm REVERSED — `effectiveDescription | ElementName`. This is the lever that
//              justifies a fifth assertion: a reversed C2 ends with the element's name, so it
//              MASQUERADES AS A VALID C0 and passes the shape envelope. Only the own-prose
//              name-first assertion catches it.
//
// THE ACCEPT-CONTROL IS LOAD-BEARING (standing rule: a filter must be proven to FILTER, not merely
// to return nothing). Without a run that must PASS, a probe whose levers always redden looks exactly
// like one measuring something real.
//
// Every lever REFUSES to apply if its target literal is not present exactly once, because a mutation
// that silently lands nowhere produces a green run indistinguishable from evidence — the same
// failure as "a mutation that does not compile proves nothing", one step earlier.
//
// One-shot and self-restoring: the shipped bytes are restored and the restore is VERIFIED BY SHA256
// after every lever and again at exit.
//
// Run: node forges/pesc260805/test/probes/p0b_compositionOrderingLevers.js

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const BUNDLE_DIR = path.join(__dirname, '..', '..');
const FORGE_PATH = path.join(BUNDLE_DIR, 'forgePesc260805.js');
const COMPOSITION_PATH = path.join(BUNDLE_DIR, 'lib', 'searchTextComposition.js');
const SUITE_PATH = path.join(BUNDLE_DIR, 'test', 'test-pesc260805SourceTier.js');

// the five shipped COMPOSITION assertion labels, declared ONCE. Copied verbatim from the suite; the
// ACCEPT-CONTROL asserts every one of them actually appears in a shipped run, so a label that drifts
// in the suite cannot leave this probe quietly watching for a string nobody emits any more.
const COMPOSITION_ASSERTION_LABELS = {
	c1Shape: 'COMPOSITION zero C1-shaped emissions (a bare element name is the DISQUALIFIED arm)',
	borrowedProse:
		'COMPOSITION prose IS borrowed over RESOLVES_TO, so the composition ran AFTER the derived tier',
	shapeEnvelope:
		'COMPOSITION every composed node emits one of the two RULED shapes (name-first or name-last)',
	nameFirstDirection:
		'COMPOSITION a node with its OWN prose emits the NAME FIRST (the C2 direction, so a reversed arm cannot pass as C0)',
	partition:
		'COMPOSITION the arms PARTITION the composed population (byArm = byLabel = proseSource = nodes seen)',
};

const sha256OfFile = (filePath) =>
	crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

const pristineBytesByPath = {
	[FORGE_PATH]: fs.readFileSync(FORGE_PATH),
	[COMPOSITION_PATH]: fs.readFileSync(COMPOSITION_PATH),
};
const pristineDigestByPath = {
	[FORGE_PATH]: sha256OfFile(FORGE_PATH),
	[COMPOSITION_PATH]: sha256OfFile(COMPOSITION_PATH),
};

const restoreEverything = () => {
	Object.keys(pristineBytesByPath).forEach((onePath) => {
		fs.writeFileSync(onePath, pristineBytesByPath[onePath]);
	});
};
// a probe that leaves a planted defect in production code is worse than no probe
process.on('exit', restoreEverything);

let pass = 0;
let fail = 0;
const check = (label, condition) => {
	if (condition) {
		pass++;
		console.log(`  ok    ${label}`);
	} else {
		fail++;
		console.error(`  FAIL  ${label}`);
	}
};
const evidence = (message) => console.log(`    | ${message}`);

const applyOneLever = ({ filePath, findLiteral, replaceLiteral, leverName }) => {
	const originalText = fs.readFileSync(filePath, 'utf8');
	const occurrenceCount = originalText.split(findLiteral).length - 1;
	if (occurrenceCount !== 1) {
		throw new Error(
			`p0b ${leverName} cannot be applied to ${path.basename(filePath)}: the target literal occurs ` +
				`${occurrenceCount} times, expected exactly 1. The lever has DRIFTED from the code it ` +
				`mutates, so this run would have reported a green that proved nothing.\n` +
				`  literal: ${JSON.stringify(findLiteral)}`,
		);
	}
	fs.writeFileSync(filePath, originalText.replace(findLiteral, replaceLiteral));
};

// runShippedSuite — invoke the SHIPPED suite as a child process and return which labels FAILed. A
// child process is deliberate: the suite mutates require caches and process.global, and reusing this
// process would let one lever's state leak into the next.
// THE EXIT CODE AND THE ASSERTION COUNT ARE BOTH RETURNED, AND THE REASON IS A DEFECT THIS PROBE
// ALREADY MADE ONCE. The first version of this probe read only `failedLabels.length` and concluded
// LEVER 1 had not worked, because the count was ZERO. It was zero because THE SUITE ABORTS AT ITS
// FIRST GATE under that lever and never emits a single ok/FAIL line — so "0 failed" meant "nothing
// ran", not "everything passed". A count of failures is not a measure of health unless you also know
// how many assertions were REACHED. Both are returned here so no caller can make that mistake again.
const runShippedSuite = (callback) => {
	execFile(
		process.execPath,
		[SUITE_PATH],
		{ cwd: path.join(BUNDLE_DIR, '..', '..'), maxBuffer: 64 * 1024 * 1024, timeout: 600000 },
		(childError, stdout, stderr) => {
			const wholeOutput = `${stdout}\n${stderr}`;
			const exitedNonZero = Boolean(childError);
			const suiteAborted = wholeOutput.indexOf('SUITE ABORTED') !== -1;
			const failedLabels = wholeOutput
				.split('\n')
				.filter((oneLine) => oneLine.indexOf('FAIL  ') !== -1)
				.map((oneLine) => oneLine.substring(oneLine.indexOf('FAIL  ') + 6).trim());
			const shippedLabels = wholeOutput
				.split('\n')
				.filter((oneLine) => oneLine.indexOf('ok    ') !== -1 || oneLine.indexOf('FAIL  ') !== -1)
				.map((oneLine) =>
					oneLine.substring(oneLine.indexOf(oneLine.indexOf('FAIL  ') !== -1 ? 'FAIL  ' : 'ok    ') + 6).trim(),
				);
			callback('', { failedLabels, shippedLabels, wholeOutput, exitedNonZero, suiteAborted });
		},
	);
};

const namesOfReddenedCompositionAssertions = (failedLabels) =>
	Object.keys(COMPOSITION_ASSERTION_LABELS).filter(
		(oneName) => failedLabels.indexOf(COMPOSITION_ASSERTION_LABELS[oneName]) !== -1,
	);

const reddenedByLever = {};

const taskList = new taskListPlus();

// =================================================================================================
// ACCEPT-CONTROL FIRST — so a suite that is already red cannot be mistaken for a lever working.
// =================================================================================================
taskList.push((args, next) => {
	console.log(
		'\nACCEPT-CONTROL (run FIRST, deliberately) — the shipped bytes, unmutated. Every COMPOSITION\n' +
			'  assertion must be PRESENT and GREEN. A suite that was already failing would otherwise make\n' +
			'  every lever below look effective.',
	);
	check(
		'ACCEPT-CONTROL both production files are pristine before the run',
		sha256OfFile(FORGE_PATH) === pristineDigestByPath[FORGE_PATH] &&
			sha256OfFile(COMPOSITION_PATH) === pristineDigestByPath[COMPOSITION_PATH],
	);
	runShippedSuite((unusedErr, { failedLabels, shippedLabels, wholeOutput, exitedNonZero, suiteAborted }) => {
		const tallyLine = (wholeOutput.match(/\d+ passed, \d+ failed/g) || []).slice(-1)[0] || 'none';
		evidence(
			`shipped suite tally: ${tallyLine}; assertions REACHED ${shippedLabels.length}; ` +
				`aborted ${suiteAborted}; exited non-zero ${exitedNonZero}`,
		);
		// the same lesson LEVER 1 taught, applied to the control: a green with zero assertions reached
		// is not a green. Asserted here so the control cannot pass vacuously either.
		check(
			'ACCEPT-CONTROL the suite actually REACHED its assertions (a zero-assertion run is not a pass)',
			shippedLabels.length > 50 && !suiteAborted,
		);
		// every declared label must actually be emitted by the suite — a label this probe watches for
		// that the suite no longer prints would make every lever below silently unfalsifiable
		const missingLabels = Object.keys(COMPOSITION_ASSERTION_LABELS).filter(
			(oneName) => shippedLabels.indexOf(COMPOSITION_ASSERTION_LABELS[oneName]) === -1,
		);
		if (missingLabels.length > 0) {
			evidence(`labels this probe watches for that the suite did NOT emit: ${missingLabels.join(', ')}`);
		}
		check(
			'ACCEPT-CONTROL all five COMPOSITION assertions are actually emitted by the shipped suite',
			missingLabels.length === 0,
		);
		check('ACCEPT-CONTROL GREEN: no COMPOSITION assertion fails in the shipped configuration', namesOfReddenedCompositionAssertions(failedLabels).length === 0);
		check('ACCEPT-CONTROL GREEN: the shipped suite has zero failures overall', failedLabels.length === 0);
		next('', { ...args });
	});
});

// =================================================================================================
// LEVER 1 — the ORDERING trap.
// =================================================================================================
taskList.push((args, next) => {
	console.log(
		'\nLEVER 1 — PRODUCTION MUTATION, SHIPPED CONFIGURATION: the composition pass is fed the SOURCE\n' +
			'  graph, which predates the derived tier, instead of the COMBINED graph. This is the naive\n' +
			'  placement — the same condition as composing inside makeNode.',
	);
	applyOneLever({
		leverName: 'LEVER 1',
		filePath: FORGE_PATH,
		findLiteral:
			'const compositionOutput = applySearchTextComposition({\n\t\t\t\t\t\tnodes: combinedGraph.nodes,\n\t\t\t\t\t\tedges: combinedGraph.edges,\n\t\t\t\t\t});',
		replaceLiteral:
			'const compositionOutput = applySearchTextComposition({\n\t\t\t\t\t\tnodes: combinedGraph.nodes,\n\t\t\t\t\t\tedges: sourceGraph.edges,\n\t\t\t\t\t});',
	});
	check(
		'LEVER 1 the mutation actually changed the production bytes',
		sha256OfFile(FORGE_PATH) !== pristineDigestByPath[FORGE_PATH],
	);
	runShippedSuite((unusedErr, { failedLabels, shippedLabels, wholeOutput, exitedNonZero, suiteAborted }) => {
		restoreEverything();
		check(
			'LEVER 1 the shipped bytes are restored, verified by sha256',
			sha256OfFile(FORGE_PATH) === pristineDigestByPath[FORGE_PATH],
		);
		const refusalNamesTheTrap = wholeOutput.indexOf('ORDERING TRAP') !== -1;
		const refusalNamesZeroEdges = wholeOutput.indexOf('ZERO RESOLVES_TO') !== -1;
		// WHAT LEVER 1 ACTUALLY DOES, measured rather than assumed: the refusal fires in the FIRST
		// gate's forge run, so the suite ABORTS and emits ZERO assertions. It does not produce a
		// FAILING assertion, because it never produces an assertion at all.
		evidence(
			`suite under LEVER 1: aborted ${suiteAborted}, exited non-zero ${exitedNonZero}, ` +
				`assertions REACHED ${shippedLabels.length}, failures ${failedLabels.length}`,
		);
		evidence(
			`refusal names ORDERING TRAP: ${refusalNamesTheTrap}; names ZERO RESOLVES_TO: ${refusalNamesZeroEdges}`,
		);
		check('LEVER 1 RED: the suite ABORTS rather than completing', suiteAborted);
		check('LEVER 1 RED: the suite exits NON-ZERO', exitedNonZero);
		check('LEVER 1 RED: the abort message names the ORDERING TRAP by name', refusalNamesTheTrap);
		check('LEVER 1 RED: the abort message says ZERO RESOLVES_TO edges', refusalNamesZeroEdges);
		// THE TRAP INSIDE THE TRAP, asserted so it is on the record rather than in a comment: under
		// this lever the suite reports ZERO FAILURES, and a reader who scores health by failure count
		// alone would read that as a PASS. The first version of this probe did exactly that. Zero
		// failures is only good news alongside a nonzero assertion count.
		check(
			'LEVER 1 the "0 failures" here is ZERO ASSERTIONS REACHED, not a pass — the count is only meaningful with the reach',
			failedLabels.length === 0 && shippedLabels.length === 0 && exitedNonZero,
		);
		reddenedByLever.leverOne = namesOfReddenedCompositionAssertions(failedLabels);
		evidence(
			`COMPOSITION assertions reddened by LEVER 1: ${reddenedByLever.leverOne.join(', ') || 'none — the forge refused before ANY assertion could run, which is the point'}`,
		);
		next('', { ...args });
	});
});

// =================================================================================================
// LEVER 2 — an arm that emits a BARE NAME (C1, the disqualified arm).
// =================================================================================================
taskList.push((args, next) => {
	console.log(
		'\nLEVER 2 — PRODUCTION MUTATION, SHIPPED CONFIGURATION: the C0 arm is mutated to return the\n' +
			'  bare element name. That is C1, DISQUALIFIED by the cosine guard for a 0.169 fall in median\n' +
			'  top-1 cosine, more than five times the 0.03 threshold.',
	);
	applyOneLever({
		leverName: 'LEVER 2',
		filePath: COMPOSITION_PATH,
		findLiteral:
			'composeSearchText: ({ searchTextElement, buildSharedSearchText }) =>\n\t\t\tbuildSharedSearchText(searchTextElement),',
		replaceLiteral: 'composeSearchText: ({ elementName }) => `${elementName}`,',
	});
	check(
		'LEVER 2 the mutation actually changed the production bytes',
		sha256OfFile(COMPOSITION_PATH) !== pristineDigestByPath[COMPOSITION_PATH],
	);
	runShippedSuite((unusedErr, { failedLabels, wholeOutput }) => {
		restoreEverything();
		check(
			'LEVER 2 the shipped bytes are restored, verified by sha256',
			sha256OfFile(COMPOSITION_PATH) === pristineDigestByPath[COMPOSITION_PATH],
		);
		const c1CountLine = (wholeOutput.match(/C1-SHAPED EMISSIONS \d+|c1ShapedEmissions \d+/g) || []).join(' ; ');
		reddenedByLever.leverTwo = namesOfReddenedCompositionAssertions(failedLabels);
		evidence(`COMPOSITION assertions reddened by LEVER 2: ${reddenedByLever.leverTwo.join(', ') || 'NONE'}`);
		evidence(`counter evidence in the suite output: ${c1CountLine || '(not printed)'}`);
		check(
			'LEVER 2 RED: the C1-shape assertion fails when an arm emits a bare name',
			reddenedByLever.leverTwo.indexOf('c1Shape') !== -1,
		);
		check(
			'LEVER 2 RED: the shape-envelope assertion also fails (a bare name is neither ruled shape)',
			reddenedByLever.leverTwo.indexOf('shapeEnvelope') !== -1,
		);
		check(
			'LEVER 2 the borrowed-prose assertion stays GREEN (so this is NOT lever 1 in disguise)',
			reddenedByLever.leverTwo.indexOf('borrowedProse') === -1,
		);
		next('', { ...args });
	});
});

// =================================================================================================
// LEVER 3 — RESOLUTION BYPASSED. The forge COMPLETES; the damage is silent.
// =================================================================================================
taskList.push((args, next) => {
	console.log(
		'\nLEVER 3 — PRODUCTION MUTATION, SHIPPED CONFIGURATION: resolveEffectiveDescription stops after\n' +
			'  the node\'s OWN prose and never follows RESOLVES_TO. Unlike lever 1 the forge COMPLETES, so\n' +
			'  this is the SILENT form of the same damage — and only the borrowed-prose assertion notices.',
	);
	applyOneLever({
		leverName: 'LEVER 3',
		filePath: COMPOSITION_PATH,
		findLiteral:
			'\t\t\tconst targetStableIdList = resolvesToTargetsByFromStableId[oneNode.stableId] || [];',
		replaceLiteral:
			'\t\t\tconst targetStableIdList = [];\n\t\t\tvoid resolvesToTargetsByFromStableId;',
	});
	check(
		'LEVER 3 the mutation actually changed the production bytes',
		sha256OfFile(COMPOSITION_PATH) !== pristineDigestByPath[COMPOSITION_PATH],
	);
	runShippedSuite((unusedErr, { failedLabels }) => {
		restoreEverything();
		check(
			'LEVER 3 the shipped bytes are restored, verified by sha256',
			sha256OfFile(COMPOSITION_PATH) === pristineDigestByPath[COMPOSITION_PATH],
		);
		reddenedByLever.leverThree = namesOfReddenedCompositionAssertions(failedLabels);
		evidence(`COMPOSITION assertions reddened by LEVER 3: ${reddenedByLever.leverThree.join(', ') || 'NONE'}`);
		check(
			'LEVER 3 RED: the borrowed-prose assertion fails when RESOLVES_TO is never followed',
			reddenedByLever.leverThree.indexOf('borrowedProse') !== -1,
		);
		check(
			'LEVER 3 the C1-shape assertion stays GREEN (the arm still delegates, so no bare names)',
			reddenedByLever.leverThree.indexOf('c1Shape') === -1,
		);
		next('', { ...args });
	});
});

// =================================================================================================
// LEVER 4 — the C2 arm REVERSED. It masquerades as a valid C0 and is why there is a fifth assertion.
// =================================================================================================
taskList.push((args, next) => {
	console.log(
		'\nLEVER 4 — PRODUCTION MUTATION, SHIPPED CONFIGURATION: the C2 arm is reversed to\n' +
			'  `effectiveDescription | ElementName`. It ENDS with the element name, so it satisfies the\n' +
			'  shape ENVELOPE by masquerading as a valid C0. Only the own-prose name-first assertion can\n' +
			'  catch it — which is the whole reason that assertion exists.',
	);
	applyOneLever({
		leverName: 'LEVER 4',
		filePath: COMPOSITION_PATH,
		findLiteral:
			'composeSearchText: ({ elementName, effectiveDescription }) =>\n\t\t\tjoinSegments([elementName, effectiveDescription]),',
		replaceLiteral:
			'composeSearchText: ({ elementName, effectiveDescription }) =>\n\t\t\tjoinSegments([effectiveDescription, elementName]),',
	});
	check(
		'LEVER 4 the mutation actually changed the production bytes',
		sha256OfFile(COMPOSITION_PATH) !== pristineDigestByPath[COMPOSITION_PATH],
	);
	runShippedSuite((unusedErr, { failedLabels }) => {
		restoreEverything();
		check(
			'LEVER 4 the shipped bytes are restored, verified by sha256',
			sha256OfFile(COMPOSITION_PATH) === pristineDigestByPath[COMPOSITION_PATH],
		);
		reddenedByLever.leverFour = namesOfReddenedCompositionAssertions(failedLabels);
		evidence(`COMPOSITION assertions reddened by LEVER 4: ${reddenedByLever.leverFour.join(', ') || 'NONE'}`);
		check(
			'LEVER 4 RED: the own-prose name-first assertion fails when the C2 arm is reversed',
			reddenedByLever.leverFour.indexOf('nameFirstDirection') !== -1,
		);
		check(
			'LEVER 4 THE MASQUERADE IS REAL: the shape ENVELOPE stays green, proving it could not have caught this alone',
			reddenedByLever.leverFour.indexOf('shapeEnvelope') === -1,
		);
		next('', { ...args });
	});
});

// =================================================================================================
// DISCRIMINATION — the levers must score DIFFERENTLY. A classifier that reddened everything the same
// way would produce an identical clean run, which is exactly what the accept-control cannot detect.
// =================================================================================================
taskList.push((args, next) => {
	console.log('\nDISCRIMINATION — the four levers must redden DIFFERENT assertion sets');
	Object.keys(reddenedByLever)
		.sort()
		.forEach((oneLeverName) => {
			evidence(`${oneLeverName}: [${reddenedByLever[oneLeverName].join(', ')}]`);
		});
	const signatureList = Object.keys(reddenedByLever).map((oneLeverName) =>
		reddenedByLever[oneLeverName].slice().sort().join('+'),
	);
	const distinctSignatureCount = new Set(signatureList).size;
	evidence(`distinct red signatures: ${distinctSignatureCount} of ${signatureList.length} levers`);
	check(
		'DISCRIMINATION lever 2 and lever 3 redden DIFFERENT assertions (shape vs ordering are distinct failures)',
		(reddenedByLever.leverTwo || []).join('+') !== (reddenedByLever.leverThree || []).join('+'),
	);
	check(
		'DISCRIMINATION lever 4 and lever 2 redden DIFFERENT assertions (a reversed arm is not a bare name)',
		(reddenedByLever.leverFour || []).join('+') !== (reddenedByLever.leverTwo || []).join('+'),
	);
	check('DISCRIMINATION at least three distinct red signatures across four levers', distinctSignatureCount >= 3);
	next('', { ...args });
});

pipeRunner(taskList.getList(), {}, (err) => {
	restoreEverything();
	console.log('\nFINAL RESTORE VERIFICATION');
	check(
		'forgePesc260805.js restored to its shipped bytes',
		sha256OfFile(FORGE_PATH) === pristineDigestByPath[FORGE_PATH],
	);
	check(
		'lib/searchTextComposition.js restored to its shipped bytes',
		sha256OfFile(COMPOSITION_PATH) === pristineDigestByPath[COMPOSITION_PATH],
	);
	if (err) {
		console.error(`\np0b probe pipeline error: ${err}`);
	}
	console.log(`\np0b_compositionOrderingLevers: ${pass} passed, ${fail} failed`);
	process.exitCode = fail === 0 && !err ? 0 : 1;
});
