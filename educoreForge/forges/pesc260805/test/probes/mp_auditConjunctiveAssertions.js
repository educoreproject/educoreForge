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
const shippedAssertionsOf = (fileText) => {
	const assertions = [];
	let searchFrom = 0;
	for (;;) {
		const callIndex = fileText.indexOf('check(', searchFrom);
		if (callIndex === -1) break;
		const beforeCharacter = callIndex === 0 ? '' : fileText[callIndex - 1];
		if (/[A-Za-z0-9_$.]/.test(beforeCharacter)) {
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
		}
		searchFrom = cursor;
	}
	return assertions;
};

const ledger = require(path.join(__dirname, '..', 'redEvidenceLedger.json'));

// EXPORTED so the ledger can READ these numbers rather than carry a copied constant that goes
// stale silently. The shipped ledger published 229/75/8 while this auditor already said 232/78/11,
// and Phase 6 would have inherited the stale figure as its brief.
const auditConjunctiveAssertions = () => {
	const summary = { totalShipped: 0, totalConjunctive: 0, riskRows: [], unjoinedLabels: [] };
	SUITE_FILES.forEach(({ suiteName, filePath }) => {
		const assertions = shippedAssertionsOf(fs.readFileSync(filePath, 'utf8'));
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
	return summary;
};
module.exports = { auditConjunctiveAssertions };

const unjoinedLabels = [];
let totalShipped = 0;
let totalConjunctive = 0;
const riskRows = [];

SUITE_FILES.forEach(({ suiteName, filePath }) => {
	const assertions = shippedAssertionsOf(fs.readFileSync(filePath, 'utf8'));
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
