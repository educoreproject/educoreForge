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
const ANTHROPIC_RENDERING_BASELINE_SHA256 =
	'3a11df3b583a66645f106df74185200634095b83a5b27cde44520a315315a8e6';

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
	'the canonical category enum equals SELECT_CATEGORY_ENUM minus none, DERIVED in this assertion',
	canonicalSchema.jsonSchema.properties.category.enum.join(','),
	EXPECTED_PICK_CATEGORY_LIST.join(','),
);
// NON-VACUITY. The assertion above would also pass if BOTH sides were empty, or if the filter silently
// removed everything. Pin the shape of the expectation itself so the comparison cannot be trivially true.
harness.ok(
	'…and the derived expectation is genuinely non-empty and genuinely narrower than the contract enum',
	EXPECTED_PICK_CATEGORY_LIST.length > 0 && EXPECTED_PICK_CATEGORY_LIST.length < SELECT_CATEGORY_ENUM.length,
	`pick-only ${JSON.stringify(EXPECTED_PICK_CATEGORY_LIST)} vs contract ${JSON.stringify(SELECT_CATEGORY_ENUM)}`,
);
harness.ok(
	"…and 'none' is absent from what the schema OFFERS THE MODEL (abstain travels as choice='NONE')",
	canonicalSchema.jsonSchema.properties.category.enum.indexOf('none') === -1,
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
		`the '${oneDialectName}' rendering offers exactly the pick-only categories`,
		renderedCategoryEnum.join(','),
		EXPECTED_PICK_CATEGORY_LIST.join(','),
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

harness.report();
