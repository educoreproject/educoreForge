#!/usr/bin/env node
'use strict';

// test-selectCandidateSchema.js — THE SELECT_CANDIDATE SCHEMA, DERIVED ONCE AND RENDERED PER DIALECT.
// judgeProviderRegistry JOB 2, 2026-09-07.
//
// ⟪WHY THIS FILE WAS WRITTEN BEFORE THE MODULE IT TESTS⟫ v2 §GOVERNANCE: "GATE BEFORE EDIT on any seam
// that has no suite... JOBs 2 and 3 create new modules in that same suite-less directory. Write the
// module's contract gate FIRST — assert what it must return, run it red against the empty file — then
// write the module. A gate written after the edit is an audit; a gate written before it is a spec."
// Twice in two jobs the hazard was a GREEN hermetic suite over a DEAD production path: JOB 0's omitted
// caller, and JOB 1's rerank callback that lost `choice` for forty minutes. This file was run RED against
// a nonexistent apps/bridge-maker/lib/selectCandidateSchema.js before that module had a single line.
//
// WHAT IS AT STAKE. Each provider delivers the same constraint in a different dialect: Anthropic sends
// `tool_choice` + `input_schema`, Ollama sends `format`. If each provider writes its own schema, N
// providers become N restatements of SELECT_CATEGORY_ENUM that drift independently — and a drifted enum
// fails SILENTLY, because the model simply never emits the missing value. Nothing throws. Nothing logs.
// The judgments just quietly stop being able to say 'weakButReal'. That is the failure this suite exists
// to make impossible, and it is why every category assertion below DERIVES its expectation from
// SELECT_CATEGORY_ENUM rather than restating the three values as a literal: a test that hard-codes the
// enum drifts in exactly the same way as the code it is watching, and would go green through the drift.
//
// HERMETIC — no network, no key, no Docker, no store, no construction of any client. Every subject is a
// pure function of module-level data. The G2-b scratch copy is written under os.tmpdir(), NEVER inside
// the repo, where an untracked file would trip BG-COMPOSE-SIF conjunct (c).
//
// Run: node apps/graph-builder/test/test-selectCandidateSchema.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- the select_candidate schema is derived ONCE and rendered per provider dialect

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Holds the canonical select_candidate schema and its per-dialect renderings to three
     properties: that the category enum is DERIVED from SELECT_CATEGORY_ENUM rather than
     restated (G2-a); that a change to that single source reaches EVERY rendering with no
     provider file edited (G2-b); and that no provider file contains a hard-coded category
     string at all (G2-c). It also pins the Anthropic rendering BYTE-FOR-BYTE to a capture
     taken before any JOB 2 edit, because the measurement instrument must not drift while
     the thing that measures it is being built.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const harness = require('../../../test/testLib/harness')(moduleName);

const BRIDGE_MAKER_LIB_DIR_PATH = path.join(__dirname, '..', 'apps', 'bridge-maker', 'lib');

const selectCandidateSchemaLib = require(path.join(BRIDGE_MAKER_LIB_DIR_PATH, 'selectCandidateSchema'));
const llmClientLib = require(path.join(BRIDGE_MAKER_LIB_DIR_PATH, 'llmClient'));
const { SELECT_CATEGORY_ENUM } = require(path.join(BRIDGE_MAKER_LIB_DIR_PATH, 'evidenceContracts'));
const { JUDGMENT_EXTRACTOR_SHAPE } = require('../interfaces');

const sha256 = (text) => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');

// thrownMessage — captures a REFUSAL so it can be asserted on. The try/catch is this test's PRODUCT (the
// refusal text), never control flow in production code; test-judgeProviderContract.js, test-bgNosub.js and
// test-embedding-client.js use the identical idiom for the identical reason.
const thrownMessage = (fn) => {
	let message = '';
	try {
		fn();
	} catch (thrown) {
		message = thrown.message;
	}
	return message;
};

// THE EXPECTATION, DERIVED — never a literal list. This single line is the whole point of G2-a: if
// SELECT_CATEGORY_ENUM gains, loses or renames a value, this expectation moves WITH it, so the assertions
// below keep testing "the schema offers exactly the pick-only categories" rather than "the schema offers
// these three strings I typed in on 2026-09-07".
const EXPECTED_PICK_CATEGORY_LIST = SELECT_CATEGORY_ENUM.filter((oneCategory) => oneCategory !== 'none');

// The choiceEnum fixture the pre-edit baseline was captured with. choiceEnum is PER-CALL (it is the list of
// candidate numbers for one subject), so a byte comparison needs a fixed one; this is the same list the
// JOB 2 baseline capture used, and changing it invalidates the recorded sha256 below.
const CHOICE_ENUM_FIXTURE = Object.freeze(['1', '2', '3', 'NONE']);

// ⟪THE G2-a BASELINE⟫ sha256 of JSON.stringify(buildTool({choiceEnum: CHOICE_ENUM_FIXTURE}), null, 2),
// captured on 2026-09-07 from the tree at dce97f6 BEFORE any JOB 2 edit, into
// zNotesPlansDocs/judgeProviderRegistry-evidence/JOB2-g2a-baseline-PREEDIT.txt. It is the SAME value JOB 0
// recorded for gate G0-b against pre-JOB-0 code, which is a second, independent fact: the tool object has
// not moved across two intervening jobs.
//
// ⟪RE-PINNED 2026-09-10, OCEAN_SUMMIT, TQ-authorised⟫ The schema now OFFERS the abstain category 'none'
// (OFFERED_CATEGORY_ENUM — see selectCandidateSchema.js for the measured defect it removes), and the two
// description strings say so. That is a DELIBERATE byte move of the tool object, so the pin moves with it.
// The JOB 2 value 3a11df3b583a66645f106df74185200634095b83a5b27cde44520a315315a8e6 held from dce97f6
// through JOB 7; the value below was captured from the tree immediately after the enum change and before
// any other edit. Every other assertion in this file that cites the baseline is checking the SAME constant,
// so they stay meaningful: they prove llmClient consumes this rendering, not that the rendering is old.
const ANTHROPIC_RENDERING_BASELINE_SHA256 =
	'7746be79a61b513b51ed9436647c76b20aaa7bdcd9a5994c9c715ef60096713e';

const canonicalSchema = selectCandidateSchemaLib.buildCanonicalSelectCandidateSchema({
	choiceEnum: CHOICE_ENUM_FIXTURE,
});

// =====================================================================
harness.section('G2-a — THE CANONICAL SCHEMA, AND ITS CATEGORY ENUM DERIVED RATHER THAN RESTATED');
// =====================================================================

harness.equal(
	'the canonical schema s required list is choice, category, rationale',
	canonicalSchema.jsonSchema.required.join(','),
	'choice,category,rationale',
);
harness.ok(
	'…and that list is FROZEN (a contract nothing can edit at run time)',
	Object.isFrozen(canonicalSchema.jsonSchema.required),
);
harness.equal(
	'the canonical category enum OFFERED to the model equals the FULL SELECT_CATEGORY_ENUM, abstain category included, DERIVED in this assertion (2026-09-10)',
	canonicalSchema.jsonSchema.properties.category.enum.join(','),
	SELECT_CATEGORY_ENUM.join(','),
);
harness.equal(
	'…and the module exports that offered enum as OFFERED_CATEGORY_ENUM, equal to the contract enum',
	selectCandidateSchemaLib.OFFERED_CATEGORY_ENUM.join(','),
	SELECT_CATEGORY_ENUM.join(','),
);
harness.ok('…and it is frozen', Object.isFrozen(selectCandidateSchemaLib.OFFERED_CATEGORY_ENUM));
// NON-VACUITY. The assertion above would also pass if BOTH sides were empty, or if the filter silently
// removed everything. Pin the shape of the expectation itself so the comparison cannot be trivially true.
harness.ok(
	'…and the derived expectation is genuinely non-empty and genuinely narrower than the contract enum',
	EXPECTED_PICK_CATEGORY_LIST.length > 0 && EXPECTED_PICK_CATEGORY_LIST.length < SELECT_CATEGORY_ENUM.length,
	`pick-only ${JSON.stringify(EXPECTED_PICK_CATEGORY_LIST)} vs contract ${JSON.stringify(SELECT_CATEGORY_ENUM)}`,
);
harness.ok(
	"…and 'none' IS offered to the model, so an abstention (choice='NONE') can satisfy `required` truthfully instead of fabricating a confidence (2026-09-10)",
	canonicalSchema.jsonSchema.properties.category.enum.indexOf('none') !== -1,
);
harness.ok(
	"…while PICK_CATEGORY_ENUM — what a PICK may carry — still EXCLUDES 'none'",
	selectCandidateSchemaLib.PICK_CATEGORY_ENUM.indexOf('none') === -1,
);
harness.equal(
	'the canonical choice enum is the per-call list, passed straight through',
	canonicalSchema.jsonSchema.properties.choice.enum.join(','),
	CHOICE_ENUM_FIXTURE.join(','),
);

// EVERY dialect the module knows renders the SAME derived category enum. Enumerated from the module's own
// declared dialect list, so a dialect added later is covered by this gate without editing it.
harness.ok(
	'the module declares at least the two dialects this campaign needs',
	selectCandidateSchemaLib.SCHEMA_DIALECT_NAME_LIST.indexOf('anthropic') !== -1 &&
		selectCandidateSchemaLib.SCHEMA_DIALECT_NAME_LIST.indexOf('ollama') !== -1,
	JSON.stringify(selectCandidateSchemaLib.SCHEMA_DIALECT_NAME_LIST),
);
selectCandidateSchemaLib.SCHEMA_DIALECT_NAME_LIST.forEach((oneDialectName) => {
	const renderedSchema = selectCandidateSchemaLib.renderSelectCandidateSchema(oneDialectName, {
		choiceEnum: CHOICE_ENUM_FIXTURE,
	});
	const renderedCategoryEnum = selectCandidateSchemaLib.categoryEnumOfRendering(oneDialectName, renderedSchema);
	harness.equal(
		`the '${oneDialectName}' rendering offers exactly the full contract enum (abstain category included)`,
		renderedCategoryEnum.join(','),
		SELECT_CATEGORY_ENUM.join(','),
	);
});

// =====================================================================
harness.section('G2-a (second half) — THE ANTHROPIC RENDERING IS BYTE-IDENTICAL TO THE PRE-EDIT CAPTURE');
// =====================================================================

const anthropicRendering = selectCandidateSchemaLib.renderSelectCandidateSchema('anthropic', {
	choiceEnum: CHOICE_ENUM_FIXTURE,
});
harness.equal(
	'the anthropic rendering hashes to the baseline captured BEFORE any JOB 2 edit',
	sha256(JSON.stringify(anthropicRendering, null, 2)),
	ANTHROPIC_RENDERING_BASELINE_SHA256,
);
// …and the incumbent's own entry point, which production actually calls, emits that same object. This is
// the assertion that would have caught JOB 1's dropped `choice`: it drives the REAL exported function
// rather than asserting about the module that feeds it.
harness.equal(
	'llmClient.buildTool — the function production calls — still emits the baseline object EXACTLY',
	sha256(JSON.stringify(llmClientLib.buildTool({ choiceEnum: CHOICE_ENUM_FIXTURE }), null, 2)),
	ANTHROPIC_RENDERING_BASELINE_SHA256,
);
// …and the two are pinned TO EACH OTHER, not merely each to the same recorded constant. Added after the
// M11 inversion (llmClient rebuilding the tool object inline but still deriving every value from the
// canonical module) was observed to leave every other assertion GREEN. M11 is an EQUIVALENT MUTANT rather
// than an uncaught fault — it keeps the single source, the derived enum and the identical bytes — but it
// showed that the client and the renderer were each pinned only to ANTHROPIC_RENDERING_BASELINE_SHA256 and
// never to one another. A later job that legitimately changes the schema will move that constant, and on
// that day this assertion is the one that still says the client is consuming the rendering.
harness.equal(
	'llmClient.buildTool and the anthropic rendering are the SAME object, not two objects that agree today',
	sha256(JSON.stringify(llmClientLib.buildTool({ choiceEnum: CHOICE_ENUM_FIXTURE }), null, 2)),
	sha256(JSON.stringify(anthropicRendering, null, 2)),
);
harness.equal(
	'…and llmClient s tool name is the canonical one, not a second copy of the string',
	llmClientLib.TOOL_NAME,
	selectCandidateSchemaLib.SELECT_CANDIDATE_TOOL_NAME,
);
harness.equal(
	'…and llmClient s CATEGORY_ENUM agrees with the canonical pick-only list',
	llmClientLib.CATEGORY_ENUM.join(','),
	EXPECTED_PICK_CATEGORY_LIST.join(','),
);

// =====================================================================
harness.section('G2-b (twin) — A FIFTH CATEGORY IN THE SINGLE SOURCE REACHES EVERY RENDERING');
// =====================================================================

// THE METHOD, and why it is a copy rather than a stub: v2 says "add a fifth value to SELECT_CATEGORY_ENUM
// in a scratch copy; BOTH rendered schemas change with neither provider file edited." Injecting the enum
// as a parameter would prove nothing — it would test that the module uses its argument. Copying the
// directory and patching the SOURCE FILE proves the derivation is structural: the module reads the one
// contract, and nothing else does the reading for it.
const SCRATCH_CATEGORY_NAME = 'ceremonial';
const scratchDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'selectCandidateSchema-g2b-'));
['evidenceContracts.js', 'selectCandidateSchema.js', 'llmClient.js', 'debugJudge.js'].forEach((oneFileName) => {
	fs.copyFileSync(path.join(BRIDGE_MAKER_LIB_DIR_PATH, oneFileName), path.join(scratchDirPath, oneFileName));
});
const scratchContractsFilePath = path.join(scratchDirPath, 'evidenceContracts.js');
const originalContractsText = fs.readFileSync(scratchContractsFilePath, 'utf8');
const patchedContractsText = originalContractsText.replace(
	"Object.freeze(['strong', 'moderate', 'weakButReal', 'none'])",
	`Object.freeze(['strong', 'moderate', 'weakButReal', '${SCRATCH_CATEGORY_NAME}', 'none'])`,
);
// The patch must be OBSERVED to have applied. A replace() that matched nothing returns the original string
// silently, and this whole gate would then pass by testing the unpatched module against itself — the exact
// vacuous-gate disease JOB 1's T3 inversion found in its own suite.
harness.ok(
	'the scratch patch actually changed evidenceContracts.js (the gate is not testing an unpatched copy)',
	patchedContractsText !== originalContractsText,
	'SELECT_CATEGORY_ENUM literal not found in the copy — the patch anchor has drifted',
);
fs.writeFileSync(scratchContractsFilePath, patchedContractsText);

const scratchSchemaLib = require(path.join(scratchDirPath, 'selectCandidateSchema'));
scratchSchemaLib.SCHEMA_DIALECT_NAME_LIST.forEach((oneDialectName) => {
	const scratchRendering = scratchSchemaLib.renderSelectCandidateSchema(oneDialectName, {
		choiceEnum: CHOICE_ENUM_FIXTURE,
	});
	harness.ok(
		`the '${oneDialectName}' rendering picked up the fifth category with NO provider file edited`,
		scratchSchemaLib.categoryEnumOfRendering(oneDialectName, scratchRendering).indexOf(SCRATCH_CATEGORY_NAME) !== -1,
		JSON.stringify(scratchSchemaLib.categoryEnumOfRendering(oneDialectName, scratchRendering)),
	);
});
// "with NEITHER PROVIDER FILE EDITED" — asserted, not assumed. Both provider files in the scratch copy are
// byte-identical to the tree's, so the change above travelled entirely through the derivation.
['llmClient.js', 'debugJudge.js'].forEach((oneProviderFileName) => {
	harness.equal(
		`…and ${oneProviderFileName} in the scratch copy is BYTE-IDENTICAL to the tree s (it was never touched)`,
		sha256(fs.readFileSync(path.join(scratchDirPath, oneProviderFileName), 'utf8')),
		sha256(fs.readFileSync(path.join(BRIDGE_MAKER_LIB_DIR_PATH, oneProviderFileName), 'utf8')),
	);
});
// NEGATIVE CONTROL — the tree's own module did NOT gain the fifth category. Without this, a bug that made
// the scratch require() resolve back to the real module would leave both halves green.
harness.ok(
	'NEGATIVE CONTROL: the tree s own rendering does NOT contain the scratch category',
	selectCandidateSchemaLib
		.categoryEnumOfRendering('anthropic', anthropicRendering)
		.indexOf(SCRATCH_CATEGORY_NAME) === -1,
);

// =====================================================================
harness.section('G2-c (twin) — NO PROVIDER FILE CONTAINS A HARD-CODED CATEGORY STRING');
// =====================================================================

// THE CENSUS METHOD, stated so the denominator is readable: comments are STRIPPED first, then each
// pick-only category name is searched for in what remains. Stripping comments follows BG-DET conjunct
// (a)'s own precedent in test-bgReplay.js, and it is not a loophole — a category named in PROSE cannot
// reach a model, while one in a string literal or an array can. Before JOB 2, llmClient.js:318 held
// 'strong, moderate, or weakButReal' inside the schema's description STRING and this gate failed on it.
const PROVIDER_FILE_NAME_LIST = ['llmClient.js', 'debugJudge.js'];
const withoutComments = (sourceText) =>
	sourceText.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

PROVIDER_FILE_NAME_LIST.forEach((oneProviderFileName) => {
	const codeOnlyText = withoutComments(
		fs.readFileSync(path.join(BRIDGE_MAKER_LIB_DIR_PATH, oneProviderFileName), 'utf8'),
	);
	const literalCategoryFaultList = EXPECTED_PICK_CATEGORY_LIST.filter(
		(oneCategory) => codeOnlyText.indexOf(oneCategory) !== -1,
	);
	harness.equal(
		`${oneProviderFileName} contains ZERO hard-coded category strings (comments stripped)`,
		literalCategoryFaultList.join(','),
		'',
	);
});
harness.note(
	`census denominator: ${PROVIDER_FILE_NAME_LIST.length} provider files under apps/bridge-maker/lib, ` +
		`each searched for all ${EXPECTED_PICK_CATEGORY_LIST.length} pick-only category names after comment stripping`,
);
// NON-VACUITY — the census can actually find a category when one is there. Without this the gate would
// pass just as happily against a comment stripper that ate the whole file.
harness.equal(
	'NON-VACUITY: the same census DOES flag a category planted in a string literal',
	EXPECTED_PICK_CATEGORY_LIST.filter(
		(oneCategory) => withoutComments(`const planted = '${EXPECTED_PICK_CATEGORY_LIST[0]}';`).indexOf(oneCategory) !== -1,
	).join(','),
	EXPECTED_PICK_CATEGORY_LIST[0],
);

// =====================================================================
harness.section('G3-e — THE FROZEN SCHEMA IS ACTUALLY FROZEN, INCLUDING THE CALLER S OWN ARRAY');
// =====================================================================
// ⟪WHY THIS GATE EXISTS, AND WHY IT IS JOB 3'S FIRST EDIT⟫ COBALT_ANCHOR found this in its own shipped
// module while answering JOB 2's stand-down question, ten minutes after the commit landed
// (STANDDOWN-job2-COBALT_ANCHOR-090726.md §1). Object.freeze is SHALLOW. The canonical schema froze itself,
// its jsonSchema, each property object and category.enum — but choice.enum held `choiceEnum`, THE CALLER'S
// OWN ARRAY, by reference. A caller that kept that reference could mutate a schema this module calls frozen,
// after construction, and nothing would say so. It was not found by review; it was found by asking whether
// the freezes were real, a question nobody had asked precisely because the builder wrote them.
//
// It is not a live bug today — evidenceRenderer.js builds a BRAND-NEW choiceEnum per question (renderedPoolStableIdList.map(...).concat([ABSTAIN_TOKEN]); judgeComponent.js:211 only TYPE-CHECKS it — corrected by RUBY_ANCHOR, JOB 4) and nothing
// mutates it afterwards — and it is fixed anyway, because a contract that ASSERTS frozen and DELIVERS
// partially frozen is a polyArch2 shortfall whether or not today's callers happen to behave. It matters more
// with two providers than with one: JOB 3's Ollama provider receives the SAME object the incumbent does.
//
// THE BYTES CANNOT MOVE. JSON.stringify renders a frozen copy of an array identically to the array itself,
// so G2-a's recorded sha256 above must STILL HOLD after the fix. That assertion is not decoration here — it
// is what distinguishes this one-line repair from a schema change wearing its clothes.

// A DELIBERATELY MUTABLE array — not CHOICE_ENUM_FIXTURE, which is frozen at module load and could not
// demonstrate the defect even if the defect were present.
const mutableChoiceEnum = ['1', '2', 'NONE'];
const schemaFromMutableEnum = selectCandidateSchemaLib.buildCanonicalSelectCandidateSchema({
	choiceEnum: mutableChoiceEnum,
});

harness.ok(
	'G3-e: the schema s choice.enum is FROZEN — the shallow-freeze hole is closed',
	Object.isFrozen(schemaFromMutableEnum.jsonSchema.properties.choice.enum),
	`Object.isFrozen(choice.enum) === ${Object.isFrozen(schemaFromMutableEnum.jsonSchema.properties.choice.enum)}`,
);
// The three freezes JOB 2 DID get right, asserted beside the one it missed so the gate reads as a statement
// about the whole object rather than about one property somebody once got wrong.
harness.ok('…and so is the schema object itself', Object.isFrozen(schemaFromMutableEnum));
harness.ok('…and the jsonSchema', Object.isFrozen(schemaFromMutableEnum.jsonSchema));
harness.ok('…and the choice PROPERTY object', Object.isFrozen(schemaFromMutableEnum.jsonSchema.properties.choice));
harness.ok('…and category.enum, which was frozen all along (it is a module-load constant)', Object.isFrozen(schemaFromMutableEnum.jsonSchema.properties.category.enum));

// THE TWIN — the defect demonstrated in the failure direction rather than reasoned about. The caller mutates
// ITS OWN array after construction; the schema must not move.
const enumBeforeCallerMutation = schemaFromMutableEnum.jsonSchema.properties.choice.enum.join(',');
mutableChoiceEnum.push('MUTATED_AFTER_THE_FACT');
harness.equal(
	'G3-e TWIN: the caller mutating its own array AFTER construction does not reach the schema',
	schemaFromMutableEnum.jsonSchema.properties.choice.enum.join(','),
	enumBeforeCallerMutation,
);
harness.equal(
	'…and the schema still holds exactly the three values it was built with',
	schemaFromMutableEnum.jsonSchema.properties.choice.enum.join(','),
	'1,2,NONE',
);
// NON-VACUITY. Everything above would pass trivially if the mutation had not actually happened — a twin that
// mutates nothing proves nothing. Prove the caller's array really did change.
harness.equal(
	'…and the twin is NOT vacuous: the caller s own array genuinely did change',
	mutableChoiceEnum.join(','),
	'1,2,NONE,MUTATED_AFTER_THE_FACT',
);
// The array must be a COPY, not merely a frozen alias of the caller's. Freezing the caller's own array in
// place would also pass isFrozen — and would be a worse bug, since it would silently freeze an object the
// caller owns.
harness.ok(
	'…and the schema holds a COPY, never the caller s array frozen in place',
	schemaFromMutableEnum.jsonSchema.properties.choice.enum !== mutableChoiceEnum,
);
harness.ok(
	'…so the caller s own array is left UNFROZEN — this module freezes its copy, never its caller s property',
	!Object.isFrozen(mutableChoiceEnum),
);

// EVERY dialect inherits the fix, because every rendering carries the same canonical jsonSchema. Enumerated
// from the module's own dialect list so a dialect added later is covered without editing this gate.
selectCandidateSchemaLib.SCHEMA_DIALECT_NAME_LIST.forEach((oneDialectName) => {
	const renderedSchema = selectCandidateSchemaLib.renderSelectCandidateSchema(oneDialectName, {
		choiceEnum: ['1', '2', 'NONE'],
	});
	// read the choice enum through the dialect's own shape rather than assuming where it sits
	const choiceEnumOfRendering =
		oneDialectName === 'anthropic'
			? renderedSchema.input_schema.properties.choice.enum
			: renderedSchema.properties.choice.enum;
	harness.ok(
		`the '${oneDialectName}' rendering s choice.enum is frozen too`,
		Object.isFrozen(choiceEnumOfRendering),
		`${oneDialectName}: ${JSON.stringify(choiceEnumOfRendering)}`,
	);
});

// THE BYTE INVARIANT, RE-ASSERTED AT THE POINT OF THE CHANGE. G2-a's sha256 is checked above against the
// pre-JOB-2 capture; it is checked AGAIN here, in this gate's own section, because the whole claim of the
// freeze fix is that it moves no bytes. If this one line ever disagrees with the one above, the fix stopped
// being a fix and became a schema change.
harness.equal(
	'G3-e: the freeze fix moved NO BYTES — G2-a s recorded sha256 still holds',
	sha256(
		JSON.stringify(
			selectCandidateSchemaLib.renderSelectCandidateSchema('anthropic', { choiceEnum: CHOICE_ENUM_FIXTURE }),
			null,
			2,
		),
	),
	ANTHROPIC_RENDERING_BASELINE_SHA256,
);

// =====================================================================
harness.section('THE DIALECT SEAM — AN UNKNOWN DIALECT IS REFUSED BY NAME, NEVER GUESSED AT');
// =====================================================================

const unknownDialectRefusal = thrownMessage(() =>
	selectCandidateSchemaLib.renderSelectCandidateSchema('gemini', { choiceEnum: CHOICE_ENUM_FIXTURE }),
);
harness.match('an unknown dialect is refused BY NAME', unknownDialectRefusal, /gemini/);
harness.match('…and the refusal LISTS the dialects that are known', unknownDialectRefusal, /anthropic/);
harness.match('…and names the second known dialect too', unknownDialectRefusal, /ollama/);
harness.match(
	'an absent dialect name is refused too, never defaulted to the incumbent',
	thrownMessage(() => selectCandidateSchemaLib.renderSelectCandidateSchema(undefined, { choiceEnum: CHOICE_ENUM_FIXTURE })),
	/anthropic/,
);
// A silent default is the fault this campaign was created to remove (JOB 0's retired scalar variant WAS a
// default). Prove the absent-dialect path did not quietly render the incumbent.
harness.ok(
	'…and that refusal did not quietly return an anthropic rendering',
	thrownMessage(() => selectCandidateSchemaLib.renderSelectCandidateSchema(undefined, { choiceEnum: CHOICE_ENUM_FIXTURE })) !== '',
);
harness.match(
	'an absent choiceEnum is refused by name (it is per-call and has no meaningful default)',
	thrownMessage(() => selectCandidateSchemaLib.renderSelectCandidateSchema('anthropic', {})),
	/choiceEnum/,
);

// =====================================================================
harness.section('THE EXTRACTION CONTRACT — DECLARED AS DATA FOR JOB 3 TO BUILD AGAINST');
// =====================================================================

// JOB 2 does not write an extractor for a provider that does not exist yet; G-F12-a is JOB 3's twin and is
// NOT claimed here. What JOB 2 owes JOB 3 is a SHAPE to write against, so that the Ollama extractor is
// held to the same discipline the Anthropic one already keeps: read the structured answer, return the
// three fields or `undefined` for any the provider did not validly supply, and NEVER reconstruct a missing
// field from free text.
harness.ok('JUDGMENT_EXTRACTOR_SHAPE is exported from interfaces.js', !!JUDGMENT_EXTRACTOR_SHAPE);
harness.ok('…and it is frozen', Object.isFrozen(JUDGMENT_EXTRACTOR_SHAPE));
harness.equal(
	'…it declares what an extractor RECEIVES',
	JUDGMENT_EXTRACTOR_SHAPE.argKeys.join(','),
	'rawProviderResponse',
);
harness.equal(
	'…and what it must RETURN',
	JUDGMENT_EXTRACTOR_SHAPE.resultKeys.join(','),
	'choice,category,rationale',
);
harness.ok(
	'…and that there is NO free-text fallback: an unsupplied field is undefined, never fabricated',
	JUDGMENT_EXTRACTOR_SHAPE.freeTextFallbackPermitted === false,
);
harness.ok(
	'…and that a body it cannot read in its own dialect is REFUSED BY NAME',
	JUDGMENT_EXTRACTOR_SHAPE.refusesByName === true,
);

// =====================================================================
harness.section('THE FRAMEWORK MIRROR, NOW DERIVED — bridgePluginContract.js JUDGE_CATEGORY_LIST (JOB 3)');
// =====================================================================
// ⟪WHY A GATE ABOUT lib/bridge-framework/ LIVES IN THIS FILE⟫ This suite's declared subject is that the
// judge's category enum is SINGLE-SOURCED and cannot drift. bridgePluginContract.js held a hand-restated copy
// of that enum at :141 as the file stood BEFORE this job — used to REFUSE plugins, at :820-832 as it stands
// AFTER — with nothing checking it against the contract it mirrored.
// COBALT_ANCHOR found it during JOB 2's prose pass and could not fix it (bridge-framework was DO NOT TOUCH
// for JOB 2); DAWN_TOWER put the one-constant fix in JOB 3's lane. Its twin belongs beside G2-b, which
// already proves a contract-enum change reaches every consumer, because it is the SAME property about the
// SAME enum one directory over. Flagged to the supervisor in JOB 3's boundary report as a lane judgement.
//
// The fix follows confidenceBandTable.js:20-25: derive the list, keep the reviewed set as a LOAD-TIME
// assertion only, throw when they disagree. What makes it a fix rather than a second mirror is WHICH list
// the refusals read — the derived one.

const bridgePluginContractLib = require('../../../lib/bridge-framework/bridgePluginContract');

harness.equal(
	'bridgePluginContract JUDGE_CATEGORY_LIST equals the pick-only categories, DERIVED in this assertion',
	bridgePluginContractLib.JUDGE_CATEGORY_LIST.join(','),
	EXPECTED_PICK_CATEGORY_LIST.join(','),
);
harness.equal(
	'…and it agrees with what the SCHEMA offers the model — one enum, two directories, no drift',
	bridgePluginContractLib.JUDGE_CATEGORY_LIST.join(','),
	selectCandidateSchemaLib.PICK_CATEGORY_ENUM.join(','),
);
harness.ok('…and it is frozen', Object.isFrozen(bridgePluginContractLib.JUDGE_CATEGORY_LIST));

// THE TWIN — a fifth category in the contract enum must make bridgePluginContract REFUSE TO LOAD. Run in a
// CHILD PROCESS: the twin works by poisoning the require cache for evidenceContracts, and doing that in this
// process would hand every later assertion — and every other suite runAllTests loads afterwards — a
// five-member enum. The child writes nothing and touches no network; it only requires two modules.
const twinScriptText = [
	"'use strict';",
	'process.global = process.global || {};',
	"const path = require('path');",
	`const contractsPath = require.resolve(${JSON.stringify(path.join(BRIDGE_MAKER_LIB_DIR_PATH, 'evidenceContracts'))});`,
	'const real = require(contractsPath);',
	'require.cache[contractsPath].exports = Object.assign({}, real, {',
	"  SELECT_CATEGORY_ENUM: Object.freeze(real.SELECT_CATEGORY_ENUM.concat(['ceremonial'])),",
	'});',
	'try {',
	`  require(${JSON.stringify(path.join(__dirname, '..', '..', '..', 'lib', 'bridge-framework', 'bridgePluginContract'))});`,
	"  process.stdout.write('LOADED_WITHOUT_THROWING');",
	'} catch (thrown) {',
	'  process.stdout.write(thrown.message);',
	'}',
].join('\n');

const twinOutput = String(
	require('child_process').execFileSync(process.execPath, ['-e', twinScriptText], { encoding: 'utf8' }),
);

harness.match(
	'TWIN: a FIFTH category in SELECT_CATEGORY_ENUM makes bridgePluginContract REFUSE AT LOAD',
	twinOutput,
	/REFUSED AT LOAD/,
);
harness.match('…and the refusal names the derived list including the new member', twinOutput, /ceremonial/);
harness.match('…and names the reviewed set it disagrees with', twinOutput, /reviewed against/);
harness.match(
	'…and tells the reader what to DECIDE rather than what to edit around',
	twinOutput,
	/predicateByCategory table/,
);
// NON-VACUITY: prove the twin did not simply fail to load the module for some unrelated reason.
harness.ok(
	'…and the twin genuinely reached the load-time check (it did not merely fail to find a module)',
	twinOutput.indexOf('LOADED_WITHOUT_THROWING') === -1 && twinOutput.indexOf('Cannot find module') === -1,
	twinOutput.slice(0, 160),
);

harness.report();
