#!/usr/bin/env node
'use strict';

// test-evidenceRenderer.js — hermetic gate for lib.d/evidenceRenderer.js (bridgeEvidenceRefactor-
// spec.md §3, ⟪A2⟫; P3 deliverable). Proves, against the REAL contract oracle
// (rendererModuleViolation/rendererDeterminismViolation, evidenceContracts.js):
//   RED  — a missing pool is refused BY NAME.
//   GREEN — the module passes rendererModuleViolation (arity 4 + RENDERER_VERSION); byte-stability
//          is proven by rendererDeterminismViolation (the contract's own keystone gate) AND by a
//          direct two-call comparison in this suite; the DETERMINISTIC EVIDENCE BUDGET
//          (maxCandidates / maxTotalChars) truncates deterministically and leaves an explicit marker,
//          never a silent drop; the deterministic COMPOSITION ORDER (base instruction -> hub segment
//          -> deduped global segments -> per-candidate blocks) is proven by substring-position
//          assertions against the real rendered text.
//
// Hermetic throughout: no Docker, no Neo4j, no LLM, no network.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-evidenceRenderer.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the P3 evidence renderer (lib.d/evidenceRenderer.js)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the renderer passes the REAL rendererModuleViolation/rendererDeterminismViolation oracle,
     the deterministic evidence budget (truncation), and the deterministic composition order.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const evidenceRendererFactory = require('../lib.d/evidenceRenderer');
const { rendererModuleViolation, rendererDeterminismViolation } = require('../lib/evidenceContracts');

const rendererModule = evidenceRendererFactory();

const tupleFor = (canonicalKey, name) => ({
	referenceTier: 'property',
	canonicalKey,
	propertyKey: canonicalKey,
	name,
	domains: [{ domainId: 'C200000', domainName: 'Fixture Domain' }],
	domainsComplete: true,
	range: { shape: 'datatype', rangeDatatype: 'string', rangeClassId: null, rangeOptionSetId: null },
	isQualified: false,
	qualifier: null,
	value: null,
});

const poolEntry = (canonicalKey, name, cosine, overrides = {}) => ({
	candidate: { stableId: `ceds:${canonicalKey}`, canonicalKey, name },
	cosine,
	considerations: { tuple: tupleFor(canonicalKey, name), notes: [] },
	...overrides,
});

const conformingEvidencePackage = () => ({
	sourceElement: { name: 'Rubric Criterion Identifier', casePath: 'case:CFRubric.rubricCriterionId', defText: 'the id of a rubric criterion' },
	pool: [poolEntry('P1', 'Near Candidate', 0.9), poolEntry('P2', 'Far Candidate', 0.2)],
	promptSegments: ['Judge CASE structural matches by owning-class term overlap.'],
});

// =====================================================================
harness.section('GREEN — passes the REAL rendererModuleViolation oracle');
// =====================================================================
harness.equal('evidenceRenderer passes rendererModuleViolation', rendererModuleViolation(rendererModule, 'evidenceRenderer'), '');

// =====================================================================
harness.section('RED — a missing pool is refused BY NAME');
// =====================================================================
(() => {
	let observed = null;
	rendererModule.render({ promptSegments: [] }, [], {}, (err, text) => {
		observed = { err, text };
	});
	harness.match('missing pool refused, named', observed.err, /evidencePackage\.pool is missing or not an array/);
})();

// =====================================================================
harness.section('GREEN — byte-stability: two calls, identical inputs, identical bytes');
// =====================================================================
(() => {
	harness.equal(
		'passes the REAL rendererDeterminismViolation oracle',
		rendererDeterminismViolation(rendererModule.render, conformingEvidencePackage(), ['hub segment'], { maxCandidates: 5 }),
		'',
	);
	let firstText = null;
	let secondText = null;
	rendererModule.render(conformingEvidencePackage(), ['hub segment'], {}, (err, text) => {
		firstText = text;
	});
	rendererModule.render(conformingEvidencePackage(), ['hub segment'], {}, (err, text) => {
		secondText = text;
	});
	harness.equal('a direct two-call comparison is also byte-identical', firstText, secondText);
})();

// =====================================================================
harness.section('GREEN — deterministic composition order (base -> hub -> global -> per-candidate)');
// =====================================================================
(() => {
	let text = null;
	rendererModule.render(conformingEvidencePackage(), ['THE HUB SEGMENT'], {}, (err, out) => {
		text = out;
	});
	const baseIdx = text.indexOf('You are judging which ONE candidate below is the correct match FOR THE SOURCE ELEMENT');
	const hubIdx = text.indexOf('THE HUB SEGMENT');
	const globalIdx = text.indexOf('Judge CASE structural matches by owning-class term overlap.');
	const candidate1Idx = text.indexOf('Near Candidate');
	const candidate2Idx = text.indexOf('Far Candidate');
	harness.ok('base instruction present', baseIdx !== -1);
	harness.ok('hub segment present', hubIdx !== -1);
	harness.ok('global segment present', globalIdx !== -1);
	harness.ok('base BEFORE hub', baseIdx < hubIdx);
	harness.ok('hub BEFORE global', hubIdx < globalIdx);
	harness.ok('global BEFORE first per-candidate block', globalIdx < candidate1Idx);
	harness.ok('pool ORDER preserved (candidate 1 before candidate 2)', candidate1Idx < candidate2Idx);
})();

// =====================================================================
harness.section('GREEN — segment dedupe across hubSegments + evidencePackage.promptSegments');
// =====================================================================
(() => {
	const evidencePackage = {
		sourceElement: { name: 'Rubric Criterion Identifier' },
		pool: [poolEntry('P1', 'Near Candidate', 0.9)],
		promptSegments: ['shared instruction'],
	};
	let text = null;
	rendererModule.render(evidencePackage, ['shared instruction', 'hub-only instruction'], {}, (err, out) => {
		text = out;
	});
	const occurrences = text.split('shared instruction').length - 1;
	harness.equal('a segment present in BOTH buckets appears exactly ONCE (deduped)', occurrences, 1);
	harness.ok('the hub-only segment still appears', text.includes('hub-only instruction'));
})();

// =====================================================================
harness.section('GREEN — deterministic evidence budget: maxCandidates truncates with an explicit marker');
// =====================================================================
(() => {
	const evidencePackage = {
		sourceElement: { name: 'Rubric Criterion Identifier' },
		pool: [poolEntry('P1', 'Cand One', 0.9), poolEntry('P2', 'Cand Two', 0.7), poolEntry('P3', 'Cand Three', 0.5)],
		promptSegments: [],
	};
	let text = null;
	rendererModule.render(evidencePackage, [], { maxCandidates: 2 }, (err, out) => {
		text = out;
	});
	harness.ok('candidate 1 present', text.includes('Cand One'));
	harness.ok('candidate 2 present', text.includes('Cand Two'));
	harness.ok('candidate 3 is OMITTED (over budget)', !text.includes('Cand Three'));
	harness.match('an explicit truncation marker names the omitted count', text, /truncated: 1 more candidate\(s\) omitted/);
})();

// =====================================================================
harness.section('GREEN — deterministic evidence budget: maxTotalChars truncates the final text deterministically');
// =====================================================================
(() => {
	let full = null;
	rendererModule.render(conformingEvidencePackage(), [], {}, (err, out) => {
		full = out;
	});
	let truncated = null;
	rendererModule.render(conformingEvidencePackage(), [], { maxTotalChars: 40 }, (err, out) => {
		truncated = out;
	});
	harness.ok('the budgeted render is shorter than the unbudgeted one', truncated.length < full.length);
	harness.match('an explicit truncation marker is appended', truncated, /\[\.\.\.evidence truncated by config\.maxTotalChars]/);
})();

// =====================================================================
harness.section('GREEN — RENDERER_VERSION is stable and non-empty (⟪A6⟫ generation legibility)');
// =====================================================================
harness.ok(
	'RENDERER_VERSION is a non-empty string',
	typeof rendererModule.RENDERER_VERSION === 'string' && rendererModule.RENDERER_VERSION.trim().length > 0,
);

harness.report();
