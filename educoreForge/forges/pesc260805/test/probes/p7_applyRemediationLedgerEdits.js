#!/usr/bin/env node
'use strict';

// p7_applyRemediationLedgerEdits.js — the ledger edits ordered by the Phase 7 independent review
// (JADE_PORTAL, 2026-08-07). Idempotent; refuses rather than half-applying.
//
//   F-3  the interpolated-label class cites source:367. My own +38-line edit to that file moved it
//        to source:403. A LINE NUMBER IN A PUBLISHED FINDING IS A PROMISE THAT SOMEONE CAN OPEN IT,
//        so it is recomputed FROM THE FILE here rather than retyped — a hand-corrected number would
//        go stale again on the next edit and nothing would notice.
//   F-7  the Phase 7 probes are referenced by nothing, so a one-shot script cannot regress-detect
//        and the findings it produced can silently come untrue. Each is now DECLARED with its
//        disposition and, where it is one-shot, the reason it must not run in the suite.

const fs = require('fs');
const path = require('path');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const LEDGER_PATH = path.join(__dirname, '..', 'redEvidenceLedger.json');
const SUITE_PATHS = {
	source: path.join(__dirname, '..', 'test-pesc260805SourceTier.js'),
	derived: path.join(__dirname, '..', 'test-pesc260805DerivedTier.js'),
};

// RECOMPUTED, NOT RETYPED. Finds the 1-based line of a literal in a suite file, and REFUSES if the
// literal is absent or ambiguous — a site citation that silently resolved to "line 1" or to the
// wrong one of two matches would be worse than no citation.
const lineOfLiteralIn = (filePath, literalText) => {
	const lines = fs.readFileSync(filePath, 'utf8').split('\n');
	const hits = [];
	lines.forEach((oneLine, zeroBasedIndex) => {
		if (oneLine.indexOf(literalText) !== -1) {
			hits.push(zeroBasedIndex + 1);
		}
	});
	if (hits.length !== 1) {
		return {
			refusal:
				`${moduleName}: the literal ${JSON.stringify(literalText.substring(0, 50))} matches ` +
				`${hits.length} line(s) in ${path.basename(filePath)} (expected exactly 1), so its site ` +
				`citation cannot be computed. Lines: ${hits.join(', ') || 'none'}.`,
		};
	}
	return { lineNumber: hits[0] };
};

const PROBE_DISPOSITIONS = {
	note:
		'F-7 (independent review, 2026-08-07): a one-shot script cannot regress-detect, so a finding it ' +
		'produced can silently come untrue. Every Phase 7 probe is declared here with its disposition. ' +
		'"wiredIntoSuite" means the suites import and run it on every pass; "oneShot" means it is run by ' +
		'hand and the REASON it must not run in the suite is stated — an unexplained one-shot is the ' +
		'silence this declaration exists to prevent.',
	probes: [
		{
			probe: 'test/probes/p7_expectationLeverSweep.js',
			disposition: 'wiredIntoSuite',
			detail:
				'All three suites import classifyOneLever from it for the standing gate "every proven row ' +
				'carries at least one lever that MUTATES PRODUCTION DATA", so its classification runs on ' +
				'every suite pass and the 65-row finding cannot come untrue unnoticed. The standalone CLI ' +
				'additionally reports the reconciliation between its two independent passes.',
		},
		{
			probe: 'test/probes/mp_auditConjunctiveAssertions.js',
			disposition: 'oneShot',
			detail:
				'Inherited from Phase 6 as a one-shot and left one-shot. It is a MEASUREMENT of the ' +
				'conjunction class rather than a gate: there is no threshold it could assert against ' +
				'without inventing a policy nobody has set, and the class is deliberately open pending a ' +
				'specification decision. Its figures ARE consumed on every ledger rebuild by ' +
				'buildRedEvidenceLedger.js, which is what keeps them from going stale.',
		},
		{
			probe: 'test/probes/p7_repinnedDescriptorLevers.js',
			disposition: 'oneShot',
			detail:
				'DELIBERATELY one-shot and it must stay that way. It MUTATES parserDescriptor.ini — the ' +
				"bundle's own self-description, read by forger.js on every build — and restores it. The " +
				'restore is verified by byte comparison, but a suite that crashed or was interrupted ' +
				'mid-probe would leave the descriptor mutated and every subsequent build reading it. ' +
				'Running a descriptor-mutating probe on every suite pass trades a real hazard for a ' +
				'regression check the suite already provides: the three assertions it proves are shipped ' +
				'in the source suite and run every pass.',
		},
		{
			probe: 'test/probes/p7_applyLedgerRepin.js',
			disposition: 'oneShotMigration',
			detail:
				'A one-time ledger migration, not a check. Idempotent and refuses on a state it did not ' +
				'create; a second run reports no-op. Retained rather than deleted so the edit is ' +
				'reviewable as intent rather than as a diff of 195 KB of JSON.',
		},
		{
			probe: 'test/probes/p7_applyExpectationLeverOnly.js',
			disposition: 'oneShotMigration',
			detail:
				'As above, for the expectationLeverOnly re-statement. It selects its rows by running the ' +
				'SAME imported classifier the standing gate runs, so it cannot disagree with the gate ' +
				'about which rows are affected.',
		},
		{
			probe: 'test/probes/p7_applyRemediationLedgerEdits.js',
			disposition: 'oneShotMigration',
			detail: 'This file. The F-3 site recomputation and this declaration block.',
		},
	],
};

const applyTheEdits = () => {
	const ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
	if (!ledger.interpolatedLabelClass) {
		return {
			refusal: `${moduleName}: ledger has no interpolatedLabelClass block; run p7_applyLedgerRepin.js first.`,
		};
	}

	const sourceSite = lineOfLiteralIn(SUITE_PATHS.source, 'check(`INTEGRATION forge run (${err})`');
	if (sourceSite.refusal) {
		return { refusal: sourceSite.refusal };
	}
	const derivedSite = lineOfLiteralIn(SUITE_PATHS.derived, 'G3-A regeneration ran without refusal${');
	if (derivedSite.refusal) {
		return { refusal: derivedSite.refusal };
	}

	const recomputed = {
		'test/test-pesc260805SourceTier.js': sourceSite.lineNumber,
		'test/test-pesc260805DerivedTier.js': derivedSite.lineNumber,
	};
	const previous = ledger.interpolatedLabelClass.members.map((oneMember) => oneMember.site);
	ledger.interpolatedLabelClass.members.forEach((oneMember) => {
		const fileName = oneMember.site.split(':')[0];
		oneMember.site = `${fileName}:${recomputed[fileName]}`;
	});
	ledger.interpolatedLabelClass.siteCitationNote =
		'SITE LINE NUMBERS ARE RECOMPUTED FROM THE FILES by test/probes/p7_applyRemediationLedgerEdits.js, ' +
		'never retyped. The first publication of this block cited source:367; a +38-line edit to that same ' +
		'file in the same phase moved the call to source:403 and the citation went stale within the hour. ' +
		'A line number in a published finding is a promise that someone can open it, and a promise nothing ' +
		'recomputes is one that decays silently.';
	ledger.phase7ProbeDispositions = PROBE_DISPOSITIONS;

	fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, '\t')}\n`);
	return {
		applied: true,
		previousSites: previous,
		recomputedSites: ledger.interpolatedLabelClass.members.map((oneMember) => oneMember.site),
		probeCount: PROBE_DISPOSITIONS.probes.length,
	};
};

module.exports = { applyTheEdits, lineOfLiteralIn };

if (require.main === module) {
	const outcome = applyTheEdits();
	if (outcome.refusal) {
		console.error(`\n${outcome.refusal}`);
		process.exit(1);
	}
	console.log(`interpolated-label sites: ${outcome.previousSites.join(', ')}`);
	console.log(`                      ->  ${outcome.recomputedSites.join(', ')}   (recomputed from the files)`);
	console.log(`declared probe dispositions: ${outcome.probeCount}`);
	process.exit(0);
}
