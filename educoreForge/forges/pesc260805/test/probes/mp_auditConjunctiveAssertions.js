#!/usr/bin/env node
'use strict';

// mp_auditConjunctiveAssertions.js — answers the supervisor's METHOD question from GAP 1b
// (independent review, 2026-08-06): "is any other shipped assertion a conjunction whose receipt
// covers only part of it?"
//
// WHY THE QUESTION IS ABOUT METHOD, NOT ONE ROW. The ledger maps an assertion LABEL to a log in
// which that label FAILED. A conjunction fails when ANY conjunct fails, so a receipt proves only
// that SOME conjunct can fail — never that every conjunct can. Two of this phase's assertions were
// recorded "proven" on levers that reddened one half:
//   - the acceptance-1 gate, whose lever moved only the PersonType pin beside it (and whose other
//     conjunct was structurally vacuous, so it could not have been reddened by anything);
//   - the SHORTFALL assertion, whose lever moved only the contribution count.
// This is the inherited-receipt pattern arriving through a CONJUNCTION rather than through a
// rename, and the ledger cannot currently see it: it records evidence per LABEL, and a label is
// the wrong granularity for a claim with several independent parts.
//
// This audit reports the conjunct count for every shipped assertion so the risk surface is a
// number someone reads rather than a property nobody measured. It does NOT decide which are
// under-evidenced — that needs a human reading the lever against the conjuncts, which is exactly
// what the supervisor asked for.

const fs = require('fs');
const path = require('path');

const SUITE_FILES = [
	{ suiteName: 'synthetic', filePath: path.join(__dirname, '..', 'test-pesc260805SyntheticTier.js') },
	{ suiteName: 'source', filePath: path.join(__dirname, '..', 'test-pesc260805SourceTier.js') },
	{ suiteName: 'derived', filePath: path.join(__dirname, '..', 'test-pesc260805DerivedTier.js') },
];

// count top-level && / || in a condition expression, ignoring those nested inside parentheses,
// brackets, braces, strings or template literals. A nested operator belongs to a sub-expression,
// not to the claim's own structure.
const topLevelOperatorCountOf = (conditionText) => {
	let depth = 0;
	let insideSingle = false;
	let insideDouble = false;
	let insideTemplate = false;
	let andCount = 0;
	let orCount = 0;
	for (let index = 0; index < conditionText.length; index++) {
		const oneCharacter = conditionText[index];
		const previousCharacter = index === 0 ? '' : conditionText[index - 1];
		if (previousCharacter !== '\\') {
			if (oneCharacter === "'" && !insideDouble && !insideTemplate) insideSingle = !insideSingle;
			else if (oneCharacter === '"' && !insideSingle && !insideTemplate) insideDouble = !insideDouble;
			else if (oneCharacter === '`' && !insideSingle && !insideDouble) insideTemplate = !insideTemplate;
		}
		if (insideSingle || insideDouble || insideTemplate) continue;
		if ('([{'.indexOf(oneCharacter) !== -1) depth++;
		else if (')]}'.indexOf(oneCharacter) !== -1) depth--;
		else if (depth === 0 && oneCharacter === '&' && conditionText[index + 1] === '&') andCount++;
		else if (depth === 0 && oneCharacter === '|' && conditionText[index + 1] === '|') orCount++;
	}
	return { andCount, orCount };
};

// pull each check(...) call's label and condition by brace/paren matching from the call site
// =================================================================================================
// blankOutComments — PHASE 7. Replaces the CONTENT of // and /* */ comments with spaces, preserving
// every newline and the total byte length, so line numbers reported downstream stay exact.
//
// WHY THIS IS HERE, AND IT IS THE SAME LESSON THIS CAMPAIGN HAS NOW PAID FOR THREE TIMES. A parser
// that reads raw bytes cannot tell code from prose ABOUT code. The zero-argument classifier below
// catches the harmless form — `check()` written in a sentence — but it cannot catch a fully formed
// call QUOTED in a comment, which parses as a perfectly good assertion that no ledger row will ever
// join. It is not hypothetical: Phase 7's own re-pin comment quoted the assertion it was retiring,
// verbatim and with both arguments, and this auditor promptly counted the retired assertion as
// shipped and reported it UNJOINED. The instrument found its author's phantom, which is the whole
// reason to have one.
//
// STRINGS AND TEMPLATE LITERALS ARE RESPECTED, because an assertion label may legitimately contain
// '//' — over-stripping would delete real code and is a WORSE failure than under-stripping, since
// it removes shipped assertions from a completeness count. The accept-control specimen list carries
// exactly that case and requires it to survive.
//
// Regular-expression literals are NOT tracked. Stated rather than hidden: a regex containing an
// unbalanced quote could desynchronise the scan. The suites contain no such literal, and the
// denominator reconciliation printed at the foot of this probe is the check that would catch it —
// stripped rows plus mentions plus unparsed must equal the RAW occurrence count, and a
// desynchronised scan cannot make that arithmetic close by accident.
// =================================================================================================
const blankOutComments = (fileText) => {
	const characters = fileText.split('');
	let insideSingle = false;
	let insideDouble = false;
	let insideTemplate = false;
	let index = 0;
	while (index < fileText.length) {
		const oneCharacter = fileText[index];
		const nextCharacter = fileText[index + 1];
		const previousCharacter = index === 0 ? '' : fileText[index - 1];
		if (!insideSingle && !insideDouble && !insideTemplate) {
			if (oneCharacter === '/' && nextCharacter === '/') {
				while (index < fileText.length && fileText[index] !== '\n') {
					characters[index] = ' ';
					index += 1;
				}
				continue;
			}
			if (oneCharacter === '/' && nextCharacter === '*') {
				while (index < fileText.length && !(fileText[index] === '*' && fileText[index + 1] === '/')) {
					if (fileText[index] !== '\n') {
						characters[index] = ' ';
					}
					index += 1;
				}
				// blank the closing '*/' too, when it is present
				if (index < fileText.length) {
					characters[index] = ' ';
					characters[index + 1] = ' ';
					index += 2;
				}
				continue;
			}
		}
		if (previousCharacter !== '\\') {
			if (oneCharacter === "'" && !insideDouble && !insideTemplate) insideSingle = !insideSingle;
			else if (oneCharacter === '"' && !insideSingle && !insideTemplate) insideDouble = !insideDouble;
			else if (oneCharacter === '`' && !insideSingle && !insideDouble) insideTemplate = !insideTemplate;
		}
		index += 1;
	}
	return characters.join('');
};

const shippedAssertionsOf = (rawFileText) => {
	const fileText = blankOutComments(rawFileText);
	const assertions = [];
	// PHASE 7 — the two classes of non-row that this parser used to discard in silence. Declared
	// beside `assertions` because the three together are one measurement: a count of rows is not a
	// count of `check(` occurrences unless both of these are accounted for.
	//   unparsedCallSites   argument text present, split failed — a PARSER DEFECT, refused by name.
	//   zeroArgumentMentions `check()` with no arguments — prose, reported so the raw-byte
	//                        occurrence count reconciles to the row count arithmetically.
	const unparsedCallSites = [];
	const zeroArgumentMentions = [];
	// occurrences preceded by an identifier character (a `foo.check(` or `recheck(`) — legitimately
	// NOT this suite's assertion helper. Counted rather than skipped in silence, because the closure
	// check below must account for every occurrence in the stripped text or it is not a check.
	let identifierPrefixedSkips = 0;
	let searchFrom = 0;
	for (;;) {
		const callIndex = fileText.indexOf('check(', searchFrom);
		if (callIndex === -1) break;
		const beforeCharacter = callIndex === 0 ? '' : fileText[callIndex - 1];
		if (/[A-Za-z0-9_$.]/.test(beforeCharacter)) {
			identifierPrefixedSkips += 1;
			searchFrom = callIndex + 6;
			continue;
		}
		let depth = 0;
		let cursor = callIndex + 5;
		let insideSingle = false;
		let insideDouble = false;
		let insideTemplate = false;
		for (; cursor < fileText.length; cursor++) {
			const oneCharacter = fileText[cursor];
			const previousCharacter = fileText[cursor - 1];
			if (previousCharacter !== '\\') {
				if (oneCharacter === "'" && !insideDouble && !insideTemplate) insideSingle = !insideSingle;
				else if (oneCharacter === '"' && !insideSingle && !insideTemplate) insideDouble = !insideDouble;
				else if (oneCharacter === '`' && !insideSingle && !insideDouble) insideTemplate = !insideTemplate;
			}
			if (insideSingle || insideDouble || insideTemplate) continue;
			if (oneCharacter === '(') depth++;
			else if (oneCharacter === ')') {
				depth--;
				if (depth === 0) break;
			}
		}
		const callText = fileText.substring(callIndex + 6, cursor);
		// the label is the first argument; split on the first top-level comma
		let splitIndex = -1;
		let commaDepth = 0;
		let s = false;
		let d = false;
		let t = false;
		for (let index = 0; index < callText.length; index++) {
			const oneCharacter = callText[index];
			const previousCharacter = index === 0 ? '' : callText[index - 1];
			if (previousCharacter !== '\\') {
				if (oneCharacter === "'" && !d && !t) s = !s;
				else if (oneCharacter === '"' && !s && !t) d = !d;
				else if (oneCharacter === '`' && !s && !d) t = !t;
			}
			if (s || d || t) continue;
			if ('([{'.indexOf(oneCharacter) !== -1) commaDepth++;
			else if (')]}'.indexOf(oneCharacter) !== -1) commaDepth--;
			else if (commaDepth === 0 && oneCharacter === ',') {
				splitIndex = index;
				break;
			}
		}
		if (splitIndex !== -1) {
			// UNESCAPE the source-literal escapes before the label is used as a ledger join key.
			// Without this the audit FAILS OPEN: a label containing an escaped quote extracts as
			// `...doesn\'t...`, matches no ledger row, is reported "(not in ledger)", and is
			// therefore excluded from the risk list — which requires status 'proven'. A proven
			// three-conjunct row with an apostrophe in it would vanish silently. An auditor that
			// fails open UNDERSTATES the problem while looking like diligence, which is worse than
			// no auditor at all.
			const labelText = callText
				.substring(0, splitIndex)
				.trim()
				.replace(/^['"`]|['"`]$/g, '')
				.replace(/\\(['"`\\])/g, '$1');
			const conditionText = callText.substring(splitIndex + 1).trim();
			assertions.push({ label: labelText, ...topLevelOperatorCountOf(conditionText) });
		} else {
			// PHASE 7 REPAIR — THE DROP THAT WAS SILENT, NOW CLASSIFIED. A call site whose
			// label/condition split does not resolve was previously discarded HERE with no push and
			// no warning. The comment above defends the audit against a label that fails to JOIN;
			// nothing defended it against a call site that never became a row at all. Two OPPOSITE
			// conditions arrived here and were handled identically, by silence:
			//
			//   BENIGN   `check()` written with NO arguments — every occurrence in these suites is
			//            prose inside a comment ("every label check() is called with ..."). It has
			//            no comma because it has no arguments. It is not a shipped assertion under
			//            any reading, and counting it would OVERSTATE the denominator.
			//   DEFECT   a call site carrying argument text that this parser could not split. That
			//            is a parser failure, it silently UNDERSTATES the conjunction totals, and
			//            those totals are written into redEvidenceLedger.json by
			//            buildRedEvidenceLedger.js — so the understatement becomes a published
			//            number nobody can check.
			//
			// MEASURED 2026-08-07 (SCARLET_GARDEN), and the measurement corrected its author: the
			// suites hold 237 `check(` occurrences in RAW BYTES (source 57, derived 73, synthetic
			// 107) against this parser's 233. The gap looked like four dropped call sites. All four
			// are `check()` inside COMMENTS. Counting code constructs in raw bytes including
			// comments is the F-3 error in a different key, and the artifact refuted the mechanism
			// the moment it was opened. COMMENT-STRIPPED the call sites are 233 and this parser is
			// exactly right.
			//
			// THE CLASSIFIER KEYS ON ARGUMENT EMPTINESS, NOT ON COMMENT MEMBERSHIP, and that limit
			// is stated rather than hidden: a zero-argument `check()` written in LIVE CODE would
			// also be binned benign here. It is not invisible — such a call reaches the suite's own
			// `check(label, condition)` with both arguments undefined, which records an undefined
			// label and scores a FAIL. A second, independent net already covers the case this
			// classifier cannot see.
			const lineNumber = fileText.substring(0, callIndex).split('\n').length;
			const argumentText = callText.trim();
			if (argumentText === '') {
				zeroArgumentMentions.push({ lineNumber });
			} else {
				unparsedCallSites.push({
					lineNumber,
					excerpt: argumentText.substring(0, 90).replace(/\s+/g, ' '),
				});
			}
		}
		searchFrom = cursor;
	}
	// ==========================================================================================
	// THE DENOMINATOR RECONCILIATION — AND THE VACUOUS VERSION OF IT THAT SHIPPED FIRST.
	//
	// The first draft of this block computed
	//     commentResidentCount = rawOccurrenceCount - assertions - unparsed - zeroArgument
	// and the caller then ASSERTED that those four sum to rawOccurrenceCount. THAT IS AN ALGEBRAIC
	// IDENTITY. It cannot fail for any input, however badly the stripper misbehaves — a defect that
	// deleted the entire file would still "close". It read like a measurement and was a tautology,
	// which is the vacuous-check class this campaign has now hit five times, and it was found by the
	// author's own polyArch2 self-audit rather than by the instrument.
	//
	// BOTH POPULATIONS ARE NOW COUNTED INDEPENDENTLY, so the closure is falsifiable:
	//   rawOccurrenceCount       occurrences over the UNSTRIPPED bytes
	//   strippedOccurrenceCount  occurrences over the BLANKED bytes
	//   commentResidentCount     the DIFFERENCE — a measurement of what stripping actually removed,
	//                            not a residual defined to make the arithmetic work
	// and the caller checks strippedOccurrenceCount against the classified rows, which CAN diverge:
	// an occurrence the scanner skipped without recording would break it, which is exactly the
	// failure the old form was blind to.
	// ==========================================================================================
	const occurrenceCountOf = (text) => {
		let count = 0;
		let cursorAt = 0;
		for (;;) {
			const found = text.indexOf('check(', cursorAt);
			if (found === -1) break;
			count += 1;
			cursorAt = found + 6;
		}
		return count;
	};
	const rawOccurrenceCount = occurrenceCountOf(rawFileText);
	const strippedOccurrenceCount = occurrenceCountOf(fileText);
	return {
		assertions,
		unparsedCallSites,
		zeroArgumentMentions,
		identifierPrefixedSkips,
		rawOccurrenceCount,
		strippedOccurrenceCount,
		commentResidentCount: rawOccurrenceCount - strippedOccurrenceCount,
	};
};

// ---------------------------------------------------------------------------------------------
// THE DENOMINATOR'S ACCEPT-CONTROL (standing rule, PHASE 7 AMENDMENT: a filter must be proven to
// FILTER, not merely to return nothing). The refusal above returns an empty list against the live
// suites. So would a classifier that binned EVERYTHING as benign, and so would a parser that found
// no call sites at all. Neither would be a working guard, and both would look exactly like this
// one. Three planted specimens, each requiring a DIFFERENT score, are the only way to tell them
// apart — the same design p65_conservationCensus.js established for comment stripping.
//
// Returns an error string (R7 convention, no throw) so the caller decides what a failure means.
// ---------------------------------------------------------------------------------------------
const SELF_TEST_SPECIMENS = [
	{
		specimenName: 'ACCEPT an ordinary two-argument call',
		sourceText: "check('G-X the thing holds', left === right && other === 3);",
		expectedAssertionCount: 1,
		expectedUnparsedCount: 0,
		expectedZeroArgumentCount: 0,
	},
	{
		// A zero-argument check() written in CODE, not in a comment. The class survives the arrival of
		// the comment stripper but its POPULATION changed: every zero-argument occurrence in the live
		// suites is prose inside a comment, so all four are now stripped before this classifier ever
		// sees them and the live zeroArgument count is 0. The class is retained rather than removed
		// because a bare check() CAN be written in code, and binning it as a parser defect would raise
		// a false refusal. This specimen is what keeps the branch proven while nothing exercises it.
		specimenName: 'CLASSIFY a zero-argument call in CODE as benign, not as a parser defect',
		sourceText: 'check();\n',
		expectedAssertionCount: 0,
		expectedUnparsedCount: 0,
		expectedZeroArgumentCount: 1,
	},
	{
		// THE REJECT CONTROL. Argument text is present and there is no top-level comma, so the
		// split cannot resolve — exactly the shape that used to vanish. If this scores 0 the guard
		// is not guarding, however clean the live run looks.
		specimenName: 'REFUSE a call site carrying arguments it cannot split',
		sourceText: "check('a label with no second argument at all');",
		expectedAssertionCount: 0,
		expectedUnparsedCount: 1,
		expectedZeroArgumentCount: 0,
	},
	// ---- THE COMMENT-STRIPPER'S OWN CONTROLS (PHASE 7) ----------------------------------------
	// A stripper must be proven to STRIP and, just as importantly, proven NOT TO OVER-STRIP. A
	// stripper that blanked the whole file would score zero on the two rejection specimens and look
	// like a working filter; the last two specimens are what make that impossible.
	{
		specimenName: 'STRIP a fully formed check() call quoted inside a LINE comment',
		sourceText: "//   check('INTEGRATION something retired', descriptor.thing === undefined);\n",
		expectedAssertionCount: 0,
		expectedUnparsedCount: 0,
		expectedZeroArgumentCount: 0,
	},
	{
		specimenName: 'STRIP a fully formed check() call quoted inside a BLOCK comment',
		sourceText: "/* historical:\n   check('G9-Z old claim', left === right && other === 3);\n*/\n",
		expectedAssertionCount: 0,
		expectedUnparsedCount: 0,
		expectedZeroArgumentCount: 0,
	},
	{
		// THE OVER-STRIPPING CONTROL. A label may legitimately contain '//' — a URL, a namespace, a
		// path. If the stripper treats those two characters inside a string literal as the start of
		// a comment it deletes SHIPPED assertions from a completeness count, which is the more
		// dangerous direction of error. This specimen must survive intact.
		specimenName: 'DO NOT over-strip: a label containing // inside a string literal is real code',
		sourceText: "check('G9-A the urn resolves at http://example.org/x', resolved === expected);",
		expectedAssertionCount: 1,
		expectedUnparsedCount: 0,
		expectedZeroArgumentCount: 0,
	},
	{
		specimenName: 'DO NOT over-strip: code AFTER a line comment on an earlier line still parses',
		sourceText: "// a comment mentioning nothing\ncheck('G9-B the later call survives', a === b);\n",
		expectedAssertionCount: 1,
		expectedUnparsedCount: 0,
		expectedZeroArgumentCount: 0,
	},
];

const selfTestFailureOf = () => {
	const failures = [];
	SELF_TEST_SPECIMENS.forEach((oneSpecimen) => {
		const observed = shippedAssertionsOf(oneSpecimen.sourceText);
		const mismatches = [];
		if (observed.assertions.length !== oneSpecimen.expectedAssertionCount) {
			mismatches.push(
				`assertions ${observed.assertions.length} (expected ${oneSpecimen.expectedAssertionCount})`,
			);
		}
		if (observed.unparsedCallSites.length !== oneSpecimen.expectedUnparsedCount) {
			mismatches.push(
				`unparsed ${observed.unparsedCallSites.length} (expected ${oneSpecimen.expectedUnparsedCount})`,
			);
		}
		if (observed.zeroArgumentMentions.length !== oneSpecimen.expectedZeroArgumentCount) {
			mismatches.push(
				`zeroArgument ${observed.zeroArgumentMentions.length} ` +
					`(expected ${oneSpecimen.expectedZeroArgumentCount})`,
			);
		}
		if (mismatches.length > 0) {
			failures.push(`${oneSpecimen.specimenName}: ${mismatches.join(', ')}`);
		}
	});
	return failures.length === 0
		? ''
		: `mp_auditConjunctiveAssertions self-test FAILED — the call-site classifier does not ` +
				`behave as declared, so every figure it produces is unproven. ${failures.join(' | ')}`;
};

const ledger = require(path.join(__dirname, '..', 'redEvidenceLedger.json'));

// EXPORTED so the ledger can READ these numbers rather than carry a copied constant that goes
// stale silently. The shipped ledger published 229/75/8 while this auditor already said 232/78/11,
// and Phase 6 would have inherited the stale figure as its brief.
const auditConjunctiveAssertions = () => {
	const summary = { totalShipped: 0, totalConjunctive: 0, riskRows: [], unjoinedLabels: [] };
	// PHASE 7 — collected across every suite so the refusal below names ALL unresolved sites at
	// once rather than stopping at the first, which would make the tally a first-error tally (the
	// fail-fast lower-bound doctrine this campaign paid for in Phase 6.5).
	const unparsedCallSitesAllSuites = [];
	// THE SELF-TEST RUNS BEFORE ANY MEASUREMENT. An unproven classifier's empty refusal list is
	// indistinguishable from a working one's.
	const selfTestFailure = selfTestFailureOf();
	if (selfTestFailure !== '') {
		throw new Error(selfTestFailure);
	}
	SUITE_FILES.forEach(({ suiteName, filePath }) => {
		const { assertions, unparsedCallSites } = shippedAssertionsOf(fs.readFileSync(filePath, 'utf8'));
		unparsedCallSites.forEach((oneSite) =>
			unparsedCallSitesAllSuites.push(`${suiteName}:${oneSite.lineNumber} — ${oneSite.excerpt}`),
		);
		const statusByLabel = {};
		const suiteLedger = ledger.suites[suiteName];
		if (suiteLedger !== undefined) {
			suiteLedger.assertions.forEach((oneEntry) => { statusByLabel[oneEntry.label] = oneEntry.status; });
		}
		summary.totalShipped += assertions.length;
		assertions.filter((oneAssertion) => oneAssertion.andCount > 0).forEach((oneAssertion) => {
			summary.totalConjunctive++;
			const joined = Object.prototype.hasOwnProperty.call(statusByLabel, oneAssertion.label);
			if (!joined) { summary.unjoinedLabels.push(`[${suiteName}] ${oneAssertion.label}`); return; }
			if (statusByLabel[oneAssertion.label] === 'proven' && oneAssertion.andCount + 1 >= 3) {
				summary.riskRows.push({ suiteName, conjunctCount: oneAssertion.andCount + 1, label: oneAssertion.label });
			}
		});
	});
	// REFUSE BY NAME. A conjunction figure computed over an unknown fraction of the call sites is
	// not a measurement, and this function's return value is written into redEvidenceLedger.json —
	// so a silent understatement here becomes a published number nobody can check.
	if (unparsedCallSitesAllSuites.length > 0) {
		throw new Error(
			`mp_auditConjunctiveAssertions: ${unparsedCallSitesAllSuites.length} check() call site(s) ` +
				`could not be parsed into a (label, condition) pair and were therefore NOT counted. ` +
				`The conjunction totals would understate by that many rows. Repair the parser in ` +
				`shippedAssertionsOf, or the suite's call syntax, before publishing any figure. ` +
				`Unresolved sites: ${unparsedCallSitesAllSuites.join(' | ')}`,
		);
	}
	return summary;
};
module.exports = { auditConjunctiveAssertions };

const unjoinedLabels = [];
let totalShipped = 0;
let totalConjunctive = 0;
const riskRows = [];

const unparsedCallSitesReport = [];
const zeroArgumentMentionReport = [];
let rawOccurrenceTotal = 0;
let strippedOccurrenceTotal = 0;
let commentResidentTotal = 0;
let identifierPrefixedTotal = 0;

const cliSelfTestFailure = selfTestFailureOf();
if (cliSelfTestFailure !== '') {
	console.error(`\n${cliSelfTestFailure}`);
	process.exit(1);
}
console.log(
	`classifier self-test: ${SELF_TEST_SPECIMENS.length}/${SELF_TEST_SPECIMENS.length} specimens ` +
		`scored as declared (one accept, one benign-mention, one REFUSE control).`,
);

SUITE_FILES.forEach(({ suiteName, filePath }) => {
	const oneScan = shippedAssertionsOf(fs.readFileSync(filePath, 'utf8'));
	const { assertions, unparsedCallSites, zeroArgumentMentions } = oneScan;
	rawOccurrenceTotal += oneScan.rawOccurrenceCount;
	strippedOccurrenceTotal += oneScan.strippedOccurrenceCount;
	commentResidentTotal += oneScan.commentResidentCount;
	identifierPrefixedTotal += oneScan.identifierPrefixedSkips;
	unparsedCallSites.forEach((oneSite) =>
		unparsedCallSitesReport.push(`${suiteName}:${oneSite.lineNumber} — ${oneSite.excerpt}`),
	);
	zeroArgumentMentions.forEach((oneSite) =>
		zeroArgumentMentionReport.push(`${suiteName}:${oneSite.lineNumber}`),
	);
	const statusByLabel = {};
	const suiteLedger = ledger.suites[suiteName];
	if (suiteLedger !== undefined) {
		suiteLedger.assertions.forEach((oneEntry) => {
			statusByLabel[oneEntry.label] = oneEntry.status;
		});
	}
	const conjunctive = assertions.filter((oneAssertion) => oneAssertion.andCount > 0);
	totalShipped += assertions.length;
	totalConjunctive += conjunctive.length;
	console.log(
		`\n=== ${suiteName}: ${assertions.length} check() calls, ${conjunctive.length} with top-level && ===`,
	);
	conjunctive
		.sort((rowA, rowB) => rowB.andCount - rowA.andCount)
		.forEach((oneAssertion) => {
			const conjunctCount = oneAssertion.andCount + 1;
			// AND THE UNMATCHED CASE IS LOUD, not a quiet "(not in ledger)". A label that fails to
			// join is an auditor defect, not a finding about the assertion, and it must not be
			// mistaken for one — a silent non-match is how this audit would understate itself.
			const ledgerStatus = Object.prototype.hasOwnProperty.call(statusByLabel, oneAssertion.label)
				? statusByLabel[oneAssertion.label]
				: 'UNJOINED-AUDITOR-DEFECT';
			if (ledgerStatus === 'UNJOINED-AUDITOR-DEFECT') {
				unjoinedLabels.push(`[${suiteName}] ${oneAssertion.label}`);
			}
			console.log(
				`  ${String(conjunctCount).padStart(2)} conjuncts  [${ledgerStatus}]  ${oneAssertion.label.substring(0, 105)}`,
			);
			if (ledgerStatus === 'proven' && conjunctCount >= 3) {
				riskRows.push({ suiteName, conjunctCount, label: oneAssertion.label });
			}
		});
});

console.log(
	`\n=== SUMMARY ===\nshipped check() calls: ${totalShipped}; carrying a top-level conjunction: ${totalConjunctive}`,
);
console.log(
	`recorded "proven" AND carrying 3+ conjuncts (the highest-risk rows — one lever, three claims): ${riskRows.length}`,
);
riskRows.forEach((oneRow) =>
	console.log(`  [${oneRow.suiteName}] ${oneRow.conjunctCount} conjuncts — ${oneRow.label}`),
);
// JOIN INTEGRITY, REPORTED RATHER THAN ASSUMED. If a shipped label fails to join the ledger, this
// audit is UNDERSTATING itself by that many rows and must say so — a silent non-match is exactly
// the fail-open behaviour that made an auditor look like diligence while hiding the problem.
console.log(
	`\nauditor join integrity: ${unjoinedLabels.length} shipped label(s) failed to join the ledger` +
		(unjoinedLabels.length === 0
			? ' — the risk list above is COMPLETE.'
			: `. THE RISK LIST IS INCOMPLETE BY THAT MUCH:\n  ${unjoinedLabels.join('\n  ')}`),
);
console.log(
	'\nA "proven" status on any row above means SOME conjunct was observed failing. It does not mean ' +
		'every conjunct was. Closing that gap needs either one assertion per claim, or a lever per ' +
		'conjunct — it cannot be closed by the ledger as currently specified, which is the method ' +
		'answer the supervisor asked for.',
);

// PARSE INTEGRITY — the completeness check the join-integrity report above CANNOT make. Join
// integrity inspects only the CONJUNCTIVE subset, so a call site the parser never turned into a
// row at all is invisible to it. This closes the denominator arithmetically instead of asserting
// it: raw `check(` occurrences = shipped rows + zero-argument mentions + unparsed sites.
console.log(
	`\nauditor parse integrity: ${unparsedCallSitesReport.length} check() call site(s) carried ` +
		`arguments this parser could not split` +
		(unparsedCallSitesReport.length === 0
			? ' — no parser defect.'
			: `. THE DENOMINATOR ABOVE UNDERSTATES BY THAT MUCH:\n  ${unparsedCallSitesReport.join('\n  ')}`),
);
console.log(
	`zero-argument check() mentions (prose, not assertions): ${zeroArgumentMentionReport.length}` +
		(zeroArgumentMentionReport.length === 0 ? '' : ` at ${zeroArgumentMentionReport.join(', ')}`),
);
console.log(`check() calls resident in COMMENTS (stripped before parsing): ${commentResidentTotal}`);
console.log(
	`  raw occurrences ${rawOccurrenceTotal} - stripped occurrences ${strippedOccurrenceTotal} = ` +
		`${commentResidentTotal} comment-resident. BOTH SIDES ARE COUNTED, not derived: the first form ` +
		`of this line defined comment-resident as the residual and then asserted the sum, which is an ` +
		`algebraic identity that cannot fail. Found by the author's polyArch2 self-audit, not by this ` +
		`instrument.`,
);
const accountedInStrippedText =
	totalShipped + zeroArgumentMentionReport.length + unparsedCallSitesReport.length + identifierPrefixedTotal;
console.log(
	`DENOMINATOR CLOSES: ${totalShipped} shipped rows + ${zeroArgumentMentionReport.length} ` +
		`zero-argument + ${unparsedCallSitesReport.length} unparsed + ${identifierPrefixedTotal} ` +
		`identifier-prefixed = ${accountedInStrippedText}, against ${strippedOccurrenceTotal} occurrences ` +
		`actually present in the stripped text.`,
);
if (accountedInStrippedText !== strippedOccurrenceTotal) {
	console.error(
		`\nDENOMINATOR DOES NOT CLOSE: ${accountedInStrippedText} accounted against ` +
			`${strippedOccurrenceTotal} present. The scanner passed over ` +
			`${strippedOccurrenceTotal - accountedInStrippedText} occurrence(s) without recording them in ` +
			`any class, so every figure above understates by that much.`,
	);
	process.exit(1);
}
process.exit(unparsedCallSitesReport.length === 0 ? 0 : 1);
