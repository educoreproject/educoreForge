#!/usr/bin/env node
'use strict';

// test-confidenceNormalizer.js — hermetic gate for lib.d/confidenceNormalizer.js (bridgeEvidenceRefactor-
// spec.md §3, ⟪A4⟫; P3 deliverable). Proves, against the REAL normalizerShapeViolation/
// normalizerDeterminismViolation oracle (evidenceContracts.js):
//   RED  — an unrecognized category is refused BY NAME (never a silent default mapping); a non-finite
//          cosine is refused BY NAME.
//   GREEN — category='none' always yields confidence 0, regardless of cosine; the documented f(category,
//          cosine) mapping (CATEGORY_BAND, this module's own exported data) is proven EXACTLY at the
//          band floor (cosine=-1), band ceiling (cosine=1), and midpoint (cosine=0); a HIGHER category
//          band NEVER produces a lower confidence than a LOWER band at the SAME cosine (the doctrine:
//          "a band is a hard ceiling on how much retrieval agreement alone can buy" — proven, not
//          merely asserted); determinism (same inputs -> same output, twice) via the REAL contract gate.
//
// Hermetic throughout: pure arithmetic, no Docker, no Neo4j, no LLM, no network.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-confidenceNormalizer.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the P3 confidence normalizer (lib.d/confidenceNormalizer.js)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves confidenceNormalizer's call guards (RED), the documented f(category, cosine) mapping at
     its band edges and midpoint, category-band monotonicity, and determinism against the REAL
     normalizerDeterminismViolation oracle (GREEN).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const confidenceNormalizerFactory = require('../lib.d/confidenceNormalizer');
const { CATEGORY_BAND } = confidenceNormalizerFactory;
const { normalizerShapeViolation, normalizerDeterminismViolation } = require('../lib/evidenceContracts');

const normalize = confidenceNormalizerFactory();

const callWith = (category, cosine, context) => {
	let observed = null;
	normalize(category, cosine, context, (err, confidence) => {
		observed = { err, confidence };
	});
	return observed;
};

// =====================================================================
harness.section('THE PRODUCED CALLABLE — passes the REAL normalizerShapeViolation gate');
// =====================================================================
harness.equal('confidenceNormalizer passes normalizerShapeViolation', normalizerShapeViolation(normalize, 'confidenceNormalizer'), '');

// =====================================================================
harness.section('RED — call guards refuse BY NAME');
// =====================================================================
harness.match('unrecognized category refused, named', callWith('fabricated', 0.5, {}).err, /category must be one of strong, moderate, weakButReal, none/);
harness.match('non-finite cosine refused, named', callWith('strong', NaN, {}).err, /retrievalCosine is not a finite number/);
harness.match('non-numeric cosine refused, named', callWith('strong', 'high', {}).err, /retrievalCosine is not a finite number/);

// =====================================================================
harness.section('GREEN — category "none" always yields confidence 0, regardless of cosine');
// =====================================================================
harness.equal('none @ cosine -1', callWith('none', -1, {}).confidence, 0);
harness.equal('none @ cosine 0', callWith('none', 0, {}).confidence, 0);
harness.equal('none @ cosine 1', callWith('none', 1, {}).confidence, 0);

// =====================================================================
harness.section('GREEN — the documented f(category, cosine) mapping, exact at band edges + midpoint');
// =====================================================================
['strong', 'moderate', 'weakButReal'].forEach((category) => {
	const band = CATEGORY_BAND[category];
	harness.equal(`${category} @ cosine=-1 (band floor)`, callWith(category, -1, {}).confidence, band.floor);
	harness.equal(`${category} @ cosine=1 (band ceiling)`, callWith(category, 1, {}).confidence, band.ceiling);
	harness.equal(`${category} @ cosine=0 (band midpoint)`, callWith(category, 0, {}).confidence, (band.floor + band.ceiling) / 2);
});

// =====================================================================
harness.section('GREEN — cosine is CLAMPED to [-1, 1] (an out-of-range cosine never breaks the band)');
// =====================================================================
harness.equal('strong @ cosine=5 clamps to the ceiling, same as cosine=1', callWith('strong', 5, {}).confidence, callWith('strong', 1, {}).confidence);
harness.equal('strong @ cosine=-5 clamps to the floor, same as cosine=-1', callWith('strong', -5, {}).confidence, callWith('strong', -1, {}).confidence);

// =====================================================================
harness.section('GREEN — category-band monotonicity: a higher category NEVER scores below a lower one at the SAME cosine');
// =====================================================================
[-1, -0.3, 0, 0.4, 1].forEach((cosine) => {
	const noneC = callWith('none', cosine, {}).confidence;
	const weakC = callWith('weakButReal', cosine, {}).confidence;
	const moderateC = callWith('moderate', cosine, {}).confidence;
	const strongC = callWith('strong', cosine, {}).confidence;
	harness.ok(`@ cosine=${cosine}: none <= weakButReal`, noneC <= weakC);
	harness.ok(`@ cosine=${cosine}: weakButReal <= moderate`, weakC <= moderateC);
	harness.ok(`@ cosine=${cosine}: moderate <= strong`, moderateC <= strongC);
});
harness.ok(
	'a "weakButReal" pick at the BEST possible cosine (1.0) never beats a "strong" pick at the WORST possible cosine (-1.0) — the hard ceiling',
	callWith('weakButReal', 1, {}).confidence <= callWith('strong', -1, {}).confidence,
);

// =====================================================================
harness.section('GREEN — determinism: passes the REAL normalizerDeterminismViolation oracle');
// =====================================================================
harness.equal('strong @ 0.73', normalizerDeterminismViolation(normalize, 'strong', 0.73, {}), '');
harness.equal('none @ -1', normalizerDeterminismViolation(normalize, 'none', -1, {}), '');
harness.equal('the `context` argument is accepted but does not affect determinism', normalizerDeterminismViolation(normalize, 'moderate', 0.1, { anything: 'here' }), '');

harness.report();
