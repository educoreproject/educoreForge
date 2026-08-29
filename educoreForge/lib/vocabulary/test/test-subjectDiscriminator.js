#!/usr/bin/env node
'use strict';

// test-subjectDiscriminator.js — the gate for the OPT-IN relationship-subject discriminator
// (SPEC-phase7-optInDiscriminator-082926.md §3.1, §3.4, §3.5; invariants I-A and I-F). This locks:
//   (a) I-A — every relationship subject the four LIVE bridges compose today composes BYTE-IDENTICALLY
//       with `discriminator: undefined`. The five-tuple table below is the baseline FROZEN BEFORE ANY
//       EDIT at HEAD 35f5664 (hubKitRole/logs/phase7/subjectBaseline.pre.json, md5
//       2341214d78a0a06e28a0bbb91dc8e27c) — its components were measured from four SEPARATE artifacts:
//       recipe tokens from the recipe file, resolved versions from the store's blocks.version COLUMN
//       (never parsed back out of the subject, which would make this a tautology), producer from each
//       plugin's own frozen declaration, and the expected string from the store itself;
//   (b) the collision this phase exists to break is REAL — the five tuples compose FOUR distinct
//       subjects, PESC's two derived tiers sharing one;
//   (c) a declared discriminator appends AFTER the producer suffix, and a malformed one is REFUSED BY
//       NAME quoting the value and the pattern — never coerced, never dropped;
//   (d) I-F — both readers (relationshipProducerFromSubject and the RELATIONSHIP kind matcher) read
//       discriminated AND undiscriminated subjects, and REFUSE malformed tails ('..._close~',
//       '..._close~Bad', a 33-character tail) rather than quietly accepting them;
//   (e) the TAIL pattern is DERIVED from the one authored pattern, so no reader can drift from another.
// RED TWINS (observed by the sweep below on every run, three-state — in-memory vocabulary doubles via
// lib/forge-framework/test/testSupport/moduleDouble.js; no file is written): the composer made to
// append '~x' UNCONDITIONALLY → (a) red; the strip removed from each reader in turn → (d) red; the
// authored pattern loosened to admit an upper-case initial → (d) red on the malformed-tail rows and
// (e) red, which is what proves the derivation is load-bearing rather than decorative. Pure; no
// docker, no database, no network.
//
// Run: node lib/vocabulary/test/test-subjectDiscriminator.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gate for the opt-in relationship-subject discriminator (Phase 7, I-A and I-F)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
DESCRIPTION
     Locks the frozen five-tuple baseline (byte-identical composition when no discriminator is declared),
     the measured collision, the named refusal of a malformed discriminator, and both readers over
     discriminated, undiscriminated and malformed-tail subjects. Every conjunct is observed RED under an
     in-memory vocabulary double. Pure.
EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const harness = require('../../../test/testLib/harness')(moduleName);
const vocabulary = require('../vocabulary');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));

const VOCABULARY_PATH = path.join(__dirname, '..', 'vocabulary.js');

// ---------------------------------------------------------------------------------------------------
// THE FROZEN I-A BASELINE — READ FROM THE ARTIFACT, NOT TRANSCRIBED FROM IT (review finding C-2,
// RULING FJ-P7-2 item 1).
//
// The first version of this suite declared the five rows inline and CALLED them a transcription of
// subjectBaseline.pre.json. The reviewer's objection is exact and worth keeping in the file rather than
// only in a report: NOTHING TIED THE TWO. The comment's defence pointed at logs/phase7/freezeSubjectBaseline.js,
// a one-off script outside the tree that no gate runs, so the two agreed only for as long as nobody edited
// either. A gate whose expectation can drift from the artifact it claims to prove is a gate about itself.
//
// So the suite now OPENS the frozen file, ASSERTS ITS MD5 is the value recorded at the freeze
// (2341214d78a0a06e28a0bbb91dc8e27c, taken at HEAD 35f5664 BEFORE any edit), and composes from the rows
// it contains. The inline table below survives as a SECOND, LABELLED CONTROL: two independently-authored
// statements of the same five tuples, asserted equal. If either moves, the gate says which.
//
// ABSENCE IS A NAMED FAILURE, NEVER A SKIP. If the artifact is missing or its md5 differs, the conjunct
// goes red naming the path and both md5s — a phase whose frozen oracle has vanished must say so, not
// quietly fall through to the inline copy.
// ---------------------------------------------------------------------------------------------------
const FROZEN_BASELINE_PATH = path.join(__dirname, '..', '..', '..', '..', '..', 'management', 'zNotesPlansDocs', 'hubKitRole', 'logs', 'phase7', 'subjectBaseline.pre.json');
const FROZEN_BASELINE_MD5 = '2341214d78a0a06e28a0bbb91dc8e27c';

// readFrozenArtifact — a PURE FUNCTION of (artifactPath, expectedMd5) rather than an inline block, for the
// same reason bridgeCollisionRule.js is a module: its red twin must drive THE RULE, not a copy of it. The
// vocabulary twin sweep below mutates vocabulary.js and cannot reach a constant that lives in this file.
const readFrozenArtifact = ({ artifactPath, expectedMd5 }) => {
	if (!fs.existsSync(artifactPath)) {
		return { error: `the frozen I-A artifact is ABSENT at ${artifactPath} — it is the oracle this gate exists to check against; a missing oracle is a failure, never a skip` };
	}
	const rawText = fs.readFileSync(artifactPath);
	const observedMd5 = crypto.createHash('md5').update(rawText).digest('hex');
	if (observedMd5 !== expectedMd5) {
		return { error: `the frozen I-A artifact has CHANGED: ${artifactPath} hashes to ${observedMd5}, not the ${expectedMd5} recorded when it was frozen at HEAD 35f5664 before any edit` };
	}
	const parsed = JSON.parse(rawText.toString('utf8'));
	return {
		md5: observedMd5,
		rowList: parsed.rowList.map((oneRow) => ({
			bridgeName: oneRow.bridgeName,
			inPhase5Recipe: oneRow.inPhase5Recipe,
			tuple: oneRow.tuple,
			expectedSubject: oneRow.composedSubject,
		})),
	};
};
const frozenArtifactReading = readFrozenArtifact({ artifactPath: FROZEN_BASELINE_PATH, expectedMd5: FROZEN_BASELINE_MD5 });

// the SECOND, INDEPENDENT statement of the same five tuples — a control on the artifact, not its source
const INLINE_CONTROL_BASELINE = [
	{ bridgeName: 'sifCedsStandardPlugin', inPhase5Recipe: true, tuple: { hubStandard: 'ceds', hubVersion: '14.0.0.0', sourceStandard: 'sif', sourceVersion: 'unknown_01', producer: 'authored' }, expectedSubject: 'ceds@14.0.0.0_rel_sif@unknown_01_exact' },
	{ bridgeName: 'edfiCedsCrosswalkPlugin', inPhase5Recipe: true, tuple: { hubStandard: 'ceds', hubVersion: '14.0.0.0', sourceStandard: 'edfi', sourceVersion: '5.2.0', producer: 'authored' }, expectedSubject: 'ceds@14.0.0.0_rel_edfi@5.2.0_exact' },
	{ bridgeName: 'edfiCedsDerivedPlugin', inPhase5Recipe: true, tuple: { hubStandard: 'ceds', hubVersion: '14.0.0.0', sourceStandard: 'edfi', sourceVersion: '5.2.0', producer: 'inferred' }, expectedSubject: 'ceds@14.0.0.0_rel_edfi@5.2.0_close' },
	{ bridgeName: 'pescCedsDerivedPlugin', inPhase5Recipe: true, tuple: { hubStandard: 'ceds', hubVersion: '14.0.0.0', sourceStandard: 'pesc260805', sourceVersion: 'aggregate-01', producer: 'inferred' }, expectedSubject: 'ceds@14.0.0.0_rel_pesc260805@aggregate-01_close' },
	// NOT in the Phase 5 recipe and therefore holding NO block in hubKitRole_phase5Entry. Its row is the
	// collision: the same five-tuple shape as the sibling above, composing the same string today.
	{ bridgeName: 'pescOptionSetCedsDerivedPlugin', inPhase5Recipe: false, tuple: { hubStandard: 'ceds', hubVersion: '14.0.0.0', sourceStandard: 'pesc260805', sourceVersion: 'aggregate-01', producer: 'inferred' }, expectedSubject: 'ceds@14.0.0.0_rel_pesc260805@aggregate-01_close' },
];

// WHAT THE CONJUNCTS COMPOSE FROM: the artifact's rows when it is readable, and the inline control when it
// is not — the latter only so the OTHER conjuncts still run and report; the artifact conjunct itself goes
// red and names why, so a missing oracle can never look like a pass.
const FROZEN_SUBJECT_BASELINE = frozenArtifactReading.error ? INLINE_CONTROL_BASELINE : frozenArtifactReading.rowList;

// The malformed discriminators, each with the reason it must be refused. '' and null are deliberately
// here: they are NOT "absent" — absent is `undefined` and returns today's string.
const MALFORMED_DISCRIMINATOR_LIST = [
	{ value: 'Bad', why: 'upper-case initial' },
	{ value: '', why: 'empty string is a malformed VALUE, not an absent key' },
	{ value: 'a~b', why: 'carries the separator itself' },
	{ value: 'a'.repeat(33), why: '33 characters, one past the 32 the pattern admits' },
	{ value: null, why: 'null is a malformed value, not an absent key' },
	{ value: 7, why: 'not a string' },
	{ value: '1leading', why: 'leading digit' },
];

// I-F: the reader table. Each row names what BOTH readers must say about it.
const READER_ROW_LIST = [
	{ subject: 'ceds@14.0.0.0_rel_pesc260805@aggregate-01_close', producer: 'inferred', isRelationship: true, why: 'undiscriminated — the shape shipped today' },
	{ subject: 'ceds@14.0.0.0_rel_pesc260805@aggregate-01_close~optionSet', producer: 'inferred', isRelationship: true, why: 'discriminated, the Phase 7 shape' },
	{ subject: 'ceds@14.0.0.0_rel_sif@unknown_01_exact~someTail', producer: 'authored', isRelationship: true, why: 'discriminated on the authored suffix' },
	{ subject: 'ceds@14.0.0.0_rel_edfi@5.2.0_struct~s1', producer: 'structural', isRelationship: true, why: 'the third producer row carries a tail too — data, not a branch' },
	{ subject: 'ceds@14.0.0.0_rel_pesc260805@aggregate-01_close~', producer: undefined, isRelationship: false, why: 'MALFORMED: separator with no discriminator — not stripped, so no producer suffix trails' },
	{ subject: 'ceds@14.0.0.0_rel_pesc260805@aggregate-01_close~Bad', producer: undefined, isRelationship: false, why: 'MALFORMED: upper-case initial' },
	{ subject: `ceds@14.0.0.0_rel_pesc260805@aggregate-01_close~${'a'.repeat(33)}`, producer: undefined, isRelationship: false, why: 'MALFORMED: 33-character tail' },
	{ subject: 'ceds@14.0.0.0_rel_pesc260805@aggregate-01', producer: undefined, isRelationship: false, why: 'no producer suffix at all — refused before and after this phase' },
	{ subject: 'ceds@14_0_0_0_base', producer: undefined, isRelationship: false, why: 'a base subject is not a relationship subject' },
];

const RELATIONSHIP_KIND = vocabulary.SCHEMA_BLOCK_KIND.RELATIONSHIP;

// ---------------------------------------------------------------------------------------------------
// THE CONJUNCTS — pure judges over a vocabulary module (the real one, or an in-memory double)
// ---------------------------------------------------------------------------------------------------
const conjunctJudgeByRefId = {
	a_frozenBaselineComposesByteIdentically: (subject) => {
		const wrong = FROZEN_SUBJECT_BASELINE.filter((oneRow) => {
			const composed = subject.relationshipSubject({ ...oneRow.tuple, discriminator: undefined });
			return composed.subject !== oneRow.expectedSubject;
		}).map((oneRow) => `${oneRow.bridgeName}: got ${JSON.stringify(subject.relationshipSubject({ ...oneRow.tuple, discriminator: undefined }).subject)} want ${JSON.stringify(oneRow.expectedSubject)}`);
		return { pass: wrong.length === 0, detail: wrong.length ? wrong.join(' | ') : `${FROZEN_SUBJECT_BASELINE.length} tuples byte-identical` };
	},
	// The SAME table with the parameter OMITTED ENTIRELY rather than passed as undefined — the call shape
	// every caller in the tree uses today. A composer that read a missing key differently from an explicit
	// undefined would pass the conjunct above and still break every existing caller.
	a_omittedParameterIsAlsoByteIdentical: (subject) => {
		const wrong = FROZEN_SUBJECT_BASELINE.filter((oneRow) => subject.relationshipSubject(oneRow.tuple).subject !== oneRow.expectedSubject);
		return { pass: wrong.length === 0, detail: wrong.length ? wrong.map((oneRow) => oneRow.bridgeName).join(', ') : `${FROZEN_SUBJECT_BASELINE.length} tuples byte-identical with the key absent` };
	},
	b_theCollisionIsReal: (subject) => {
		const composedList = FROZEN_SUBJECT_BASELINE.map((oneRow) => subject.relationshipSubject(oneRow.tuple).subject);
		const distinctCount = new Set(composedList).size;
		return { pass: composedList.length === 5 && distinctCount === 4, detail: `${composedList.length} tuples → ${distinctCount} distinct subjects` };
	},
	c_declaredDiscriminatorAppendsAfterTheProducerSuffix: (subject) => {
		const composed = subject.relationshipSubject({ ...FROZEN_SUBJECT_BASELINE[4].tuple, discriminator: 'optionSet' });
		const sibling = subject.relationshipSubject(FROZEN_SUBJECT_BASELINE[3].tuple);
		return {
			pass: composed.subject === 'ceds@14.0.0.0_rel_pesc260805@aggregate-01_close~optionSet' && composed.subject !== sibling.subject,
			detail: `${JSON.stringify(composed.subject)} vs sibling ${JSON.stringify(sibling.subject)}`,
		};
	},
	c_malformedDiscriminatorRefusedByName: (subject) => {
		const notRefused = MALFORMED_DISCRIMINATOR_LIST.filter((oneCase) => {
			const composed = subject.relationshipSubject({ ...FROZEN_SUBJECT_BASELINE[4].tuple, discriminator: oneCase.value });
			// a refusal NAMES the offending value and the pattern; a subject coming back is a silent coercion
			return composed.subject !== undefined || typeof composed.error !== 'string' || composed.error.indexOf(JSON.stringify(oneCase.value)) === -1;
		});
		return { pass: notRefused.length === 0, detail: notRefused.length ? `not refused by name: ${notRefused.map((oneCase) => `${JSON.stringify(oneCase.value)} (${oneCase.why})`).join(', ')}` : `${MALFORMED_DISCRIMINATOR_LIST.length} malformed values refused by name` };
	},
	d_bothReadersAgreeOverTheTable: (subject) => {
		const wrong = READER_ROW_LIST.filter((oneRow) =>
			subject.relationshipProducerFromSubject(oneRow.subject) !== oneRow.producer ||
			subject.subjectAgreesWithKind(oneRow.subject, RELATIONSHIP_KIND) !== oneRow.isRelationship);
		return {
			pass: wrong.length === 0,
			detail: wrong.length
				? wrong.map((oneRow) => `${oneRow.subject} → producer ${String(subject.relationshipProducerFromSubject(oneRow.subject))} (want ${String(oneRow.producer)}), isRelationship ${subject.subjectAgreesWithKind(oneRow.subject, RELATIONSHIP_KIND)} (want ${oneRow.isRelationship}) [${oneRow.why}]`).join(' | ')
				: `${READER_ROW_LIST.length} rows, both readers agreeing on every one`,
		};
	},
	// C-2 / FJ-P7-2 item 1 — the gate is TIED to the md5'd artifact, and the inline table is a control on it
	f_frozenArtifactReadAndAgreesWithTheInlineControl: () => {
		if (frozenArtifactReading.error) {
			return { pass: false, detail: frozenArtifactReading.error };
		}
		const artifactText = JSON.stringify(frozenArtifactReading.rowList);
		const controlText = JSON.stringify(INLINE_CONTROL_BASELINE);
		return {
			pass: artifactText === controlText,
			detail: artifactText === controlText
				? `artifact md5 ${frozenArtifactReading.md5} verified, and its ${frozenArtifactReading.rowList.length} rows equal the inline control row for row`
				: `ARTIFACT AND CONTROL DISAGREE\n  artifact: ${artifactText}\n  control:  ${controlText}`,
		};
	},
	e_tailPatternIsDerivedFromTheAuthoredPattern: (subject) => {
		// DERIVED, not re-typed: the tail form must equal the authored form with its anchors moved. Comparing
		// the two sources is what would go red if someone re-typed the character class into the tail.
		const authoredBody = subject.RELATIONSHIP_DISCRIMINATOR_PATTERN.source.replace(/^\^/, '').replace(/\$$/, '');
		const expectedTailSource = `${subject.RELATIONSHIP_DISCRIMINATOR_SEPARATOR}${authoredBody}$`;
		return {
			pass: subject.RELATIONSHIP_DISCRIMINATOR_TAIL_PATTERN.source === expectedTailSource,
			detail: `${subject.RELATIONSHIP_DISCRIMINATOR_TAIL_PATTERN.source} vs derived ${expectedTailSource}`,
		};
	},
};

// =====================================================================
harness.section('BASELINE — the real vocabulary passes every conjunct');
// =====================================================================
Object.keys(conjunctJudgeByRefId).forEach((oneRefId) => {
	const verdict = conjunctJudgeByRefId[oneRefId](vocabulary);
	harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail);
});
harness.equal('the separator is the measured one', vocabulary.RELATIONSHIP_DISCRIMINATOR_SEPARATOR, '~');
harness.ok('subjectWithoutRelationshipDiscriminator is a no-op on an undiscriminated subject', vocabulary.subjectWithoutRelationshipDiscriminator('ceds@14.0.0.0_rel_edfi@5.2.0_close') === 'ceds@14.0.0.0_rel_edfi@5.2.0_close');
harness.ok('subjectWithoutRelationshipDiscriminator leaves a MALFORMED tail in place', vocabulary.subjectWithoutRelationshipDiscriminator('ceds@14.0.0.0_rel_edfi@5.2.0_close~Bad') === 'ceds@14.0.0.0_rel_edfi@5.2.0_close~Bad');

// =====================================================================
harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under a vocabulary double (in memory)');
// =====================================================================
const twinList = [
	{
		conjunctRefIdList: ['a_frozenBaselineComposesByteIdentically', 'a_omittedParameterIsAlsoByteIdentical'],
		twinName: 'composerAppendsUnconditionally',
		leverKind: 'productionMutation',
		find: '\t\treturn { subject: undiscriminatedSubject };\n',
		replace: "\t\treturn { subject: `${undiscriminatedSubject}~x` };\n",
	},
	{
		conjunctRefIdList: ['d_bothReadersAgreeOverTheTable'],
		twinName: 'producerReaderStripRemoved',
		leverKind: 'productionMutation',
		find: '\t\t\t\t(oneProducer) => subjectWithoutRelationshipDiscriminator(subject).endsWith(RELATIONSHIP_PRODUCER_SUFFIX[oneProducer]),',
		replace: '\t\t\t\t(oneProducer) => subject.endsWith(RELATIONSHIP_PRODUCER_SUFFIX[oneProducer]),',
	},
	{
		conjunctRefIdList: ['d_bothReadersAgreeOverTheTable'],
		twinName: 'kindMatcherStripRemoved',
		leverKind: 'productionMutation',
		find: '\t\tRELATIONSHIP_PRODUCER_SUFFIXES.some((oneSuffix) => subjectWithoutRelationshipDiscriminator(subject).endsWith(oneSuffix)),',
		replace: '\t\tRELATIONSHIP_PRODUCER_SUFFIXES.some((oneSuffix) => subject.endsWith(oneSuffix)),',
	},
	{
		// THE ONE THAT PROVES THE DERIVATION IS LOAD-BEARING. Loosening the AUTHORED pattern to admit an
		// upper-case initial must reach the READERS through the derived tail pattern — '..._close~Bad' then
		// parses as a discriminated subject. If the tail form had been re-typed instead of derived, this twin
		// would leave the readers untouched and (d) would stay green: the twin's job is to fail that way.
		conjunctRefIdList: ['d_bothReadersAgreeOverTheTable', 'c_malformedDiscriminatorRefusedByName'],
		twinName: 'authoredPatternAdmitsUpperCaseInitial',
		leverKind: 'productionMutation',
		find: 'const RELATIONSHIP_DISCRIMINATOR_PATTERN = /^[a-z][A-Za-z0-9]{0,31}$/;',
		replace: 'const RELATIONSHIP_DISCRIMINATOR_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,31}$/;',
	},
	{
		conjunctRefIdList: ['e_tailPatternIsDerivedFromTheAuthoredPattern'],
		twinName: 'tailPatternReTypedInsteadOfDerived',
		leverKind: 'productionMutation',
		find: "\t`${RELATIONSHIP_DISCRIMINATOR_SEPARATOR}${RELATIONSHIP_DISCRIMINATOR_PATTERN.source.replace(/^\\^/, '').replace(/\\$$/, '')}$`,",
		replace: "\t`${RELATIONSHIP_DISCRIMINATOR_SEPARATOR}[a-z][A-Za-z0-9]{0,30}$`,",
	},
	{
		// PAIRED WITH THE REFUSAL CONJUNCT ONLY. Removing the checker does NOT stop a VALID discriminator
		// from appending, so it cannot make the composition conjunct red — observed, which is why the
		// composition conjunct has its own twin below rather than sharing this one.
		conjunctRefIdList: ['c_malformedDiscriminatorRefusedByName'],
		twinName: 'discriminatorCheckerRemoved',
		leverKind: 'productionMutation',
		find: '\tif (typeof discriminator !== \'string\' || !RELATIONSHIP_DISCRIMINATOR_PATTERN.test(discriminator)) {',
		replace: '\tif (false) {',
	},
	{
		// THE SILENT NO-OP THIS PHASE IS MOST LIKELY TO SHIP: a discriminator that is accepted, validated,
		// and then never applied. The composed subject falls back onto its colliding sibling's string and
		// nothing anywhere refuses — which is exactly the failure the conjunct exists to catch.
		conjunctRefIdList: ['c_declaredDiscriminatorAppendsAfterTheProducerSuffix'],
		twinName: 'discriminatorValidatedThenDropped',
		leverKind: 'productionMutation',
		find: '\treturn { subject: `${undiscriminatedSubject}${RELATIONSHIP_DISCRIMINATOR_SEPARATOR}${discriminator}` };',
		replace: '\treturn { subject: `${undiscriminatedSubject}` };',
	},
	{
		// b_theCollisionIsReal asserts that the FIVE tuples compose FOUR subjects — one duplicate, the PESC
		// pair. Its discriminating twin drops the producer suffix from the template: Ed-Fi's authored and
		// inferred tiers then collide as well and the count falls to THREE. That is the mechanism the whole
		// phase rests on — 'Ed-Fi's two do NOT collide because crosswalk is authored and derived is
		// inferred' — so a twin that cannot move it would leave that claim untested.
		conjunctRefIdList: ['b_theCollisionIsReal'],
		twinName: 'producerSuffixDroppedFromTemplate',
		leverKind: 'productionMutation',
		find: '\tconst undiscriminatedSubject = `${hubStandard}@${hubVersion}${RELATIONSHIP_PAIR_INFIX}${sourceStandard}@${sourceVersion}${producerSuffix}`;',
		replace: '\tconst undiscriminatedSubject = `${hubStandard}@${hubVersion}${RELATIONSHIP_PAIR_INFIX}${sourceStandard}@${sourceVersion}`;',
	},
];
const observedRedSet = new Set();
twinList.forEach((oneTwin) => {
	moduleDouble.assertMutationApplies({ modulePath: VOCABULARY_PATH, find: oneTwin.find });
	const doubled = moduleDouble.loadWithMutations({ modulePath: VOCABULARY_PATH, mutationList: [{ modulePath: VOCABULARY_PATH, find: oneTwin.find, replace: oneTwin.replace }] });
	oneTwin.conjunctRefIdList.forEach((oneRefId) => {
		const verdict = conjunctJudgeByRefId[oneRefId](doubled);
		harness.ok(`${oneRefId} observed RED under twin '${oneTwin.twinName}' (${oneTwin.leverKind})`, verdict.pass === false, verdict.detail);
		if (verdict.pass === false) {
			observedRedSet.add(oneRefId);
		}
		process.global.xLog.status(`  RED-OBSERVED SUBJECT-DISCRIMINATOR/${oneRefId} twin='${oneTwin.twinName}' lever=${oneTwin.leverKind} → ${verdict.pass ? 'PASS (DEFECTIVE)' : 'FAIL'}: ${verdict.detail}`);
	});
});
// =====================================================================
harness.section("THE ARTIFACT TWIN — C-2's conjunct driven with a broken oracle (inputFault, not a module double)");
// =====================================================================
// The vocabulary twin sweep above mutates vocabulary.js; this conjunct is about THIS SUITE's tie to a file
// on disk, so its lever is the reader's own arguments. Three states, one variable: real path + real md5
// passes (the BASELINE section); a WRONG md5 and an ABSENT path must each come back as an error NAMING the
// fault. Without this the C-2 remedy would itself be an ungated claim — which is the finding it answers.
[
	{ twinName: 'frozenArtifactMd5Wrong', argumentSet: { artifactPath: FROZEN_BASELINE_PATH, expectedMd5: '00000000000000000000000000000000' }, mustName: 'has CHANGED' },
	{ twinName: 'frozenArtifactPathAbsent', argumentSet: { artifactPath: path.join(__dirname, 'noSuchFrozenArtifact.pre.json'), expectedMd5: FROZEN_BASELINE_MD5 }, mustName: 'is ABSENT' },
].forEach((oneTwin) => {
	const reading = readFrozenArtifact(oneTwin.argumentSet);
	const namedIt = typeof reading.error === 'string' && reading.error.indexOf(oneTwin.mustName) !== -1;
	harness.ok(`f_frozenArtifactReadAndAgreesWithTheInlineControl observed RED under twin '${oneTwin.twinName}' (inputFault)`, namedIt, reading.error || 'ACCEPTED a broken oracle');
	if (namedIt) {
		observedRedSet.add('f_frozenArtifactReadAndAgreesWithTheInlineControl');
	}
	process.global.xLog.status(`  RED-OBSERVED SUBJECT-DISCRIMINATOR/f_frozenArtifactReadAndAgreesWithTheInlineControl twin='${oneTwin.twinName}' lever=inputFault → ${namedIt ? 'FAIL' : 'PASS (DEFECTIVE)'}: ${(reading.error || 'no error returned').slice(0, 150)}`);
});

harness.equal('every conjunct was observed red', observedRedSet.size, Object.keys(conjunctJudgeByRefId).length);
process.global.xLog.status(`  SUBJECT-DISCRIMINATOR: ${observedRedSet.size}/${Object.keys(conjunctJudgeByRefId).length} conjuncts observed red, ${twinList.length} twin runs`);

harness.report();
