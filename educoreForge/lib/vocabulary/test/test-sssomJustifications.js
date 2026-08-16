#!/usr/bin/env node
'use strict';

// test-sssomJustifications.js — the gate for the SSSOM mapping_justification enum (root-and-branch
// reset Phase 4, K1; RULINGS-supervisor-phase2.md §5 item 7). AUTHORITY: SPEC-educoreBridgeProfile-v1.0.md
// §4.2 — three active terms, one banned by name. This locks:
//   (a) each of the Profile's three terms is VALID;
//   (b) the pre-reset invalid term (not an SSSOM/SEMAPV term at all) is INVALID — refused as
//       "not in the allowlist"; the literal lives HERE, and only here, so the whole tree greps clean;
//   (c) semapv:UnspecifiedMatching is REFUSED BY NAME with the BANNED message, which is a DIFFERENT
//       message from (b)'s — the ban is visible in the refusal, not implicit in an omission;
//   (d) the allowlist is EXACTLY the three (no fourth term can ride along) and the boolean gate is
//       defined by the refusal (a term is valid iff its refusal is '').
// The red twin for (b): temporarily re-add the removed literal to SSSOM_JUSTIFICATIONS in vocabulary.js
// and watch (b) go red, then restore. Observed and recorded in DEVLOG-rootAndBranch.md ## Phase 4.
// Pure; no docker/db.
//
// Run: node lib/vocabulary/test/test-sssomJustifications.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gate for the SSSOM mapping_justification enum (Profile §4.2)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
DESCRIPTION
     Locks SSSOM_JUSTIFICATIONS to the Profile's three active terms, refuses the pre-reset invalid
     term as not-in-allowlist, and refuses semapv:UnspecifiedMatching BY NAME (a distinct message).
     Pure.
EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);
const vocabulary = require('../vocabulary');
const { TERM_DEFINITIONS } = require('../vocabulary-definitions');

// The pre-reset invalid term, as a literal: this file is the ONE place in the tree it may appear
// (the supervisor's tree-wide zero-count check excludes exactly this test's own literal).
const PRE_RESET_INVALID_TERM = 'semapv:SemanticSimilarity';
const BANNED_TERM = 'semapv:UnspecifiedMatching';
const PROFILE_TERMS = ['semapv:ManualMappingCuration', 'semapv:CompositeMatching', 'semapv:MappingReview'];

// =====================================================================
harness.section('(a) each of the Profile §4.2 active terms is VALID');
// =====================================================================
PROFILE_TERMS.forEach((oneTerm) => {
	harness.ok(`${oneTerm} is valid`, vocabulary.sssomJustificationRefusal(oneTerm) === '');
	harness.equal(`${oneTerm} carries no refusal`, vocabulary.sssomJustificationRefusal(oneTerm), '');
	harness.ok(`${oneTerm} has a human definition (schema-view readability bar)`, typeof TERM_DEFINITIONS.sssomJustification[oneTerm] === 'string' && TERM_DEFINITIONS.sssomJustification[oneTerm].trim() !== '');
});

// =====================================================================
harness.section('(b) the pre-reset invalid term is INVALID (not in the allowlist)');
// =====================================================================
harness.ok(`${PRE_RESET_INVALID_TERM} is NOT valid`, vocabulary.sssomJustificationRefusal(PRE_RESET_INVALID_TERM) !== '');
harness.ok(`${PRE_RESET_INVALID_TERM} is NOT in SSSOM_JUSTIFICATIONS`, vocabulary.SSSOM_JUSTIFICATIONS.indexOf(PRE_RESET_INVALID_TERM) === -1);
harness.match(`${PRE_RESET_INVALID_TERM} is refused as not-in-allowlist`, vocabulary.sssomJustificationRefusal(PRE_RESET_INVALID_TERM), /is not in the SSSOM_JUSTIFICATIONS allowlist/);
harness.ok(`${PRE_RESET_INVALID_TERM} is NOT refused with the BANNED message (that message is reserved for the ban)`, !/BANNED/.test(vocabulary.sssomJustificationRefusal(PRE_RESET_INVALID_TERM)));
harness.ok(`${PRE_RESET_INVALID_TERM} has NO definition (it must never become a schema-view member)`, TERM_DEFINITIONS.sssomJustification[PRE_RESET_INVALID_TERM] === undefined);

// =====================================================================
harness.section('(c) semapv:UnspecifiedMatching is REFUSED BY NAME — the BANNED message, distinct from (b)');
// =====================================================================
harness.ok(`${BANNED_TERM} is NOT valid`, vocabulary.sssomJustificationRefusal(BANNED_TERM) !== '');
harness.equal('SSSOM_JUSTIFICATIONS_BANNED names exactly the one banned term', JSON.stringify(vocabulary.SSSOM_JUSTIFICATIONS_BANNED), JSON.stringify([BANNED_TERM]));
harness.match(`${BANNED_TERM} refusal names the term`, vocabulary.sssomJustificationRefusal(BANNED_TERM), new RegExp(BANNED_TERM.replace(':', '\\:')));
harness.match(`${BANNED_TERM} refusal says BANNED and cites Profile §4.2`, vocabulary.sssomJustificationRefusal(BANNED_TERM), /BANNED by the EDUcore Bridge Profile §4\.2/);
harness.ok(`${BANNED_TERM} refusal is NOT the not-in-allowlist message`, !/is not in the SSSOM_JUSTIFICATIONS allowlist/.test(vocabulary.sssomJustificationRefusal(BANNED_TERM)));
harness.ok('the two refusal messages differ (the ban is visible, not an omission)', vocabulary.sssomJustificationRefusal(BANNED_TERM) !== vocabulary.sssomJustificationRefusal(PRE_RESET_INVALID_TERM));

// =====================================================================
harness.section('(d) the allowlist is EXACTLY the three, in the Profile\'s order; the boolean form is REMOVED (BR-145)');
// =====================================================================
harness.equal('SSSOM_JUSTIFICATIONS === the Profile\'s three', JSON.stringify(vocabulary.SSSOM_JUSTIFICATIONS), JSON.stringify(PROFILE_TERMS));
harness.equal('the definitions map carries exactly the three (no orphan definition, no missing one)', JSON.stringify(Object.keys(TERM_DEFINITIONS.sssomJustification).sort()), JSON.stringify(PROFILE_TERMS.slice().sort()));
harness.ok('a bare (unprefixed) name is refused — the semapv: prefix is intrinsic', vocabulary.sssomJustificationRefusal('CompositeMatching') !== '');
harness.ok('undefined is refused, not defaulted', vocabulary.sssomJustificationRefusal(undefined) !== '');
harness.ok('isValidSssomJustification is NOT exported (BR-145 RULED: the boolean invited callers to discard the ban\'s name)', vocabulary.isValidSssomJustification === undefined);
harness.ok('the registry is frozen (no runtime widening of the allowlist)', Object.isFrozen(vocabulary.SSSOM_JUSTIFICATIONS) && Object.isFrozen(vocabulary.SSSOM_JUSTIFICATIONS_BANNED));

harness.report();
