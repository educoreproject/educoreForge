#!/usr/bin/env node
'use strict';

// test-recipe.js — gates for graphBuilder's recipe layer: LOAD, SUMMARIZE, VALIDATE (Layers 1+2).
//
// Every gate is proven in BOTH directions. A check that only ever passes is not a check, so each
// rule gets a fixture that violates it (asserting the SPECIFIC error, never merely "it failed")
// AND a clean recipe proving the same rule stays green when it should. Fixtures are single-fault
// by construction: one recipe, one broken rule.
//
// Run: node apps/graph-builder/test/test-recipe.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const path = require('path');

const helpText = () => `
NAME
     ${moduleName} -- gates for graphBuilder's recipe layer (load, summarize, validate)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Exercises loadRecipe / summarizeRecipe / validateRecipe against the good recipes in
     recipes/ and the single-fault bad recipes in test/fixtures/. Every rule is proven in
     BOTH directions: a fixture that violates it (asserting the SPECIFIC error) and a clean
     recipe proving the rule stays green when it should.

OPTIONS
     -verbose    Show every individual assertion, not just failures and the tally.
     -quiet      Failures and the tally only.
     -help       This message.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);
const recipeLib = require('../lib/recipe');

const fixture = (name) => path.join(__dirname, 'fixtures', `${name}.recipe.jsonc`);
const goodRecipe = (name) =>
	path.join(__dirname, '..', '..', '..', 'recipes', `${name}.recipe.jsonc`);

const loadOrDie = (filePath) => {
	const loaded = recipeLib.loadRecipe(filePath);
	if (loaded.error) {
		console.error(`test setup failure: could not load ${filePath} -- ${loaded.error}`);
		process.exit(1);
	}
	return loaded.recipe;
};

const validateStructuralOnly = (recipe) => recipeLib.validateRecipe(recipe, {});
const validateFully = (recipe, availableForges) =>
	recipeLib.validateRecipe(recipe, {
		contentValidation: true,
		availableForges: availableForges || [],
	});

// =====================================================================
harness.section('LOAD — a recipe that cannot be read is rejected before validation');
// =====================================================================

harness.match(
	'missing path is rejected',
	recipeLib.loadRecipe('').error,
	/no recipe path given/,
);

harness.match(
	'nonexistent file is rejected by name',
	recipeLib.loadRecipe('/no/such/recipe.jsonc').error,
	/recipe file not found/,
);

harness.match(
	'unparseable file is rejected as unparseable',
	recipeLib.loadRecipe(fixture('bad-malformed')).error,
	/not parseable/i,
);

harness.match(
	'a parseable NON-object root is rejected',
	recipeLib.loadRecipe(fixture('bad-notAnObject')).error,
	/must be a JSON object/,
);

harness.ok(
	'a good recipe loads with no error',
	!recipeLib.loadRecipe(goodRecipe('cedsLif')).error,
	recipeLib.loadRecipe(goodRecipe('cedsLif')).error,
);

harness.ok(
	'JSONC comments are tolerated (the good recipes are commented)',
	loadOrDie(goodRecipe('lifOnly')).recipeName === 'lifOnly',
);

// =====================================================================
harness.section('SUMMARIZE — comprehension output must NEVER crash');
// =====================================================================
// A defensive-guard regression caught by testing once already: summarize crashed on a
// wrong-typed collection. These assert it survives shapes the schema would reject, because
// summarize runs BEFORE validation and must describe even a malformed recipe.

harness.doesNotThrow('summarize survives an empty object', () =>
	recipeLib.summarizeRecipe({}),
);

harness.doesNotThrow('summarize survives wrong-typed collections', () =>
	recipeLib.summarizeRecipe({
		recipeName: 'junk',
		standards: 'not-an-array',
		crosswalks: 5,
		hubs: null,
		bridges: { nope: true },
	}),
);

harness.doesNotThrow('summarize survives bare-string standards', () =>
	recipeLib.summarizeRecipe(loadOrDie(fixture('bad-bareStringStandards'))),
);

harness.match(
	'summarize reports standards with their versions',
	recipeLib.summarizeRecipe(loadOrDie(goodRecipe('cedsLif'))),
	/ceds@current, lif@current/,
);

harness.match(
	'summarize names unrecognized sections rather than hiding them',
	recipeLib.summarizeRecipe({ recipeName: 'x', mysterySection: {} }),
	/other sections present.*mysterySection/,
);

// =====================================================================
harness.section('LAYER 1 STRUCTURAL — each rule fails on its own fixture');
// =====================================================================

const structuralCases = [
	['missing standards', 'bad-noStandards', /required property 'standards'|must have required property/],
	['empty standards', 'bad-emptyStandards', /standards.*fewer than 1 items|minItems/i],
	['bare-string standards', 'bad-bareStringStandards', /standards\/0.*must be object/],
	['incumbent legacy format', 'bad-incumbentFormat', /must NOT have additional properties|recipeName/],
	['malformed schemaVersion', 'bad-schemaVersion', /schemaVersion.*pattern/],
	['cacheMode pin without pinBlockId', 'bad-pinNoBlockId', /pinBlockId/],
	['structural bridge without mapper', 'bad-structuralBridgeNoMapper', /mapper/],
	// EVERY bridge names its mapper — the hub case used to be accepted here and silently handed
	// 'defaultSemantic' by build.js:279, so a recipe author who never chose a mapper got one
	// anyway and nothing said so (polyArch2 §6).
	['hub bridge without mapper', 'bad-hubBridgeNoMapper', /mapper/],
	['bridge with a BLANK mapper', 'bad-bridgeBlankMapper', /mapper.*fewer than 1 characters|minLength/i],
];

structuralCases.forEach(([label, name, pattern]) => {
	harness.rejects(
		`REJECTS ${label}`,
		validateStructuralOnly(loadOrDie(fixture(name))).layers.structural.errors,
		pattern,
	);
});

harness.accepts(
	'ACCEPTS the minimal good recipe (lifOnly)',
	validateStructuralOnly(loadOrDie(goodRecipe('lifOnly'))).layers.structural.errors,
);

harness.accepts(
	'ACCEPTS the hub+bridge good recipe (cedsLif)',
	validateStructuralOnly(loadOrDie(goodRecipe('cedsLif'))).layers.structural.errors,
);

// =====================================================================
harness.section('LAYER 2a REFERENTIAL — internal integrity, one fault per fixture');
// =====================================================================
// Each of these is STRUCTURALLY VALID on purpose: it proves Layer 2 is doing the catching,
// not Layer 1 incidentally.

const referentialCases = [
	['hub standard not in standards[]', 'bad-hubNotInStandards', /hubs\[0\]\.standard 'ceds' is not in standards/],
	['bridge source not in standards[]', 'bad-bridgeSourceUndeclared', /bridges\[0\]\.source 'lif' is not in standards/],
	['dependency not in standards[]', 'bad-depUndeclared', /dependencies 'sif' is not in standards/],
	['bridge hub never declared as a hub', 'bad-bridgeHubNotDeclared', /bridges\[0\]\.hub 'ceds' is not a declared hub/],
	['duplicate (source, hub) pairing', 'bad-dupPairing', /duplicate bridge pairing 'lif::ceds'/],
];

referentialCases.forEach(([label, name, pattern]) => {
	const recipe = loadOrDie(fixture(name));
	// the twin assertion: Layer 1 must be CLEAN, or the fixture is not isolating what we claim
	harness.accepts(
		`  (fixture ${name} is structurally clean — the fault is purely referential)`,
		validateStructuralOnly(recipe).layers.structural.errors,
	);
	harness.rejects(`REJECTS ${label}`, validateFully(recipe).layers.referential.errors, pattern);
});

harness.accepts(
	'ACCEPTS a referentially coherent recipe (cedsLif)',
	validateFully(loadOrDie(goodRecipe('cedsLif'))).layers.referential.errors,
);

harness.accepts(
	'ACCEPTS a recipe with no hubs or bridges at all (lifOnly)',
	validateFully(loadOrDie(goodRecipe('lifOnly'))).layers.referential.errors,
);

// =====================================================================
harness.section('LAYER 2b RESOLVABILITY — environment, proven RED and GREEN');
// =====================================================================
// The gate that will stay red for the whole stub era. It must be shown capable of BOTH
// verdicts, or a permanently-red gate is indistinguishable from a broken one.

const cedsLif = loadOrDie(goodRecipe('cedsLif'));

harness.rejects(
	'REJECTS when no forge is available (the stub-era state)',
	validateFully(cedsLif, []).layers.resolvability.errors,
	/no forge available for standard 'ceds'/,
);

harness.rejects(
	'  and names EVERY unresolvable standard, not just the first',
	validateFully(cedsLif, []).layers.resolvability.errors,
	/no forge available for standard 'lif'/,
);

harness.accepts(
	'ACCEPTS when both forges are present (proves the gate can go green)',
	validateFully(cedsLif, ['ceds', 'lif']).layers.resolvability.errors,
);

harness.rejects(
	'REJECTS a PARTIALLY satisfied environment (one forge present, one missing)',
	validateFully(cedsLif, ['ceds']).layers.resolvability.errors,
	/no forge available for standard 'lif'/,
);

harness.equal(
	'  the partial case names exactly one missing standard',
	validateFully(cedsLif, ['ceds']).layers.resolvability.errors.length,
	1,
);

harness.ok(
	'forge matching is case-insensitive',
	validateFully(cedsLif, ['CEDS', 'LIF']).layers.resolvability.ok,
);

// =====================================================================
harness.section('LAYER GATING — content layers run only when asked');
// =====================================================================

const structuralOnlyVerdict = validateStructuralOnly(loadOrDie(fixture('bad-hubNotInStandards')));

harness.ok(
	'referential layer reports ran=false when contentValidation is off',
	structuralOnlyVerdict.layers.referential.ran === false,
);

harness.ok(
	'resolvability layer reports ran=false when contentValidation is off',
	structuralOnlyVerdict.layers.resolvability.ran === false,
);

harness.ok(
	'a referential fault is therefore INVISIBLE without contentValidation',
	structuralOnlyVerdict.valid === true,
	'structural-only validation should call this referentially-broken recipe valid',
);

harness.ok(
	'the same recipe is INVALID once content validation runs',
	validateFully(loadOrDie(fixture('bad-hubNotInStandards'))).valid === false,
);

harness.ok(
	'structural layer always reports ran=true',
	structuralOnlyVerdict.layers.structural.ran === true,
);

// =====================================================================
harness.section('VERDICT SHAPE — errors aggregate across layers');
// =====================================================================

const fullyBad = validateFully(loadOrDie(fixture('bad-hubNotInStandards')), []);

harness.ok(
	'top-level errors include both referential and resolvability findings',
	fullyBad.errors.some((e) => /referential:/.test(e)) &&
		fullyBad.errors.some((e) => /resolvability:/.test(e)),
	`errors were:\n- ${fullyBad.errors.join('\n- ')}`,
);

harness.ok(
	'valid is false whenever any layer has errors',
	fullyBad.valid === false,
);

harness.ok(
	'valid is true when every run layer is clean',
	validateFully(cedsLif, ['ceds', 'lif']).valid === true,
);

harness.report();
