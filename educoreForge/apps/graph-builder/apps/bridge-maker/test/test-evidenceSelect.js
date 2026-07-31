#!/usr/bin/env node
'use strict';

// test-evidenceSelect.js — hermetic gate for lib.d/evidenceSelect.js (bridgeEvidenceRefactor-spec.md
// §3, ⟪A3⟫/⟪A4⟫; P3 deliverable). Proves, against the REAL contract oracle (selectShapeViolation/
// selectResultViolation, evidenceContracts.js) and a STUB llmClient only (no real LLM):
//   RED  — construction guard (no renderer); call guards (missing llmClient / missing package-or-
//          wrapper); ⟪A3⟫: a MALFORMED EvidencePackage is refused BY NAME before any prompt is built
//          (proven by a renderer double that THROWS if ever called — proof the gate sits BEFORE
//          rendering, not merely somewhere in the pipeline); an llmClient that omits/mis-supplies
//          category is refused BY NAME, never defaulted (⟪A4⟫); an out-of-range choice is refused.
//   GREEN — a conforming EvidencePackage is rendered (via the injected renderer) and judged, landing a
//          conforming SelectResult that passes the REAL selectResultViolation oracle; a pre-rendered
//          { promptText, pool } wrapper skips rendering entirely (proven the same way — a renderer
//          double that throws if called); an LLM 'NONE' choice abstains with category 'none'; the
//          produced callable itself passes the REAL selectShapeViolation gate.
//
// Hermetic throughout: no Docker, no Neo4j, no LLM, no network — llmClient is a STUB double.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-evidenceSelect.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the P3 evidence-based select (lib.d/evidenceSelect.js)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves evidenceSelect's construction/call guards (RED), the ⟪A3⟫ shape gate sitting BEFORE any
     prompt is built, and a conforming judge round-trip against the REAL selectResultViolation oracle
     (GREEN), using a stub llmClient only.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const evidenceSelectFactory = require('../lib.d/evidenceSelect');
const evidenceRendererFactory = require('../lib.d/evidenceRenderer');
const { selectShapeViolation, selectResultViolation } = require('../lib/evidenceContracts');

const realRenderer = evidenceRendererFactory();

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

const poolEntry = (canonicalKey, name, cosine) => ({
	candidate: { stableId: `ceds:${canonicalKey}`, canonicalKey, name },
	cosine,
	considerations: { tuple: tupleFor(canonicalKey, name), notes: [] },
});

const conformingEvidencePackage = () => ({
	sourceElement: { name: 'Rubric Criterion Identifier' },
	pool: [poolEntry('P1', 'Near Candidate', 0.9), poolEntry('P2', 'Far Candidate', 0.2)],
	promptSegments: ['Judge by definitions, not surface wording.'],
});

const throwingRenderer = {
	render: () => {
		throw new Error('renderer.render was called — the ⟪A3⟫ gate must refuse BEFORE this ever happens');
	},
};

// =====================================================================
harness.section('RED — construction guard (no renderer)');
// =====================================================================
harness.match(
	'constructing without a renderer throws, naming the reason',
	(() => {
		try {
			evidenceSelectFactory({});
			return '';
		} catch (constructionError) {
			return constructionError.message;
		}
	})(),
	/constructed without a renderer/,
);

const select = evidenceSelectFactory({ renderer: realRenderer });

// =====================================================================
harness.section('THE PRODUCED CALLABLE — passes the REAL selectShapeViolation gate');
// =====================================================================
harness.equal('evidenceSelect passes selectShapeViolation', selectShapeViolation(select, 'evidenceSelect'), '');

// =====================================================================
harness.section('RED — call guards refuse BY NAME');
// =====================================================================
(() => {
	let observed = null;
	select(conformingEvidencePackage(), null, (err) => {
		observed = err;
	});
	harness.match('missing llmClient refused, named', observed, /llmClient is missing/);
})();
(() => {
	let observed = null;
	select(null, { rerank: () => {} }, (err) => {
		observed = err;
	});
	harness.match('missing renderedPromptOrPackage refused, named', observed, /renderedPromptOrPackage is missing/);
})();

// =====================================================================
harness.section('⟪A3⟫ RED — a MALFORMED EvidencePackage is refused BEFORE any prompt is built');
// =====================================================================
(() => {
	const selectWithThrowingRenderer = evidenceSelectFactory({ renderer: throwingRenderer });
	const malformedPackage = { sourceElement: { name: 's' }, pool: [{ candidate: {}, cosine: 'not-a-number', considerations: { tuple: {}, notes: [] } }], promptSegments: [] };
	let observed = null;
	// this call MUST refuse before ever invoking throwingRenderer.render — if it didn't, the test
	// process itself would throw synchronously and this suite would crash rather than report a FAIL.
	selectWithThrowingRenderer(malformedPackage, { rerank: () => {} }, (err) => {
		observed = err;
	});
	harness.match('refused BY NAME at the ⟪A3⟫ seam, naming the shape violation', observed, /evidence package refused at the select seam/);
})();

// =====================================================================
harness.section('GREEN — a conforming EvidencePackage is rendered + judged; passes selectResultViolation');
// =====================================================================
(() => {
	const stubLlm = {
		rerank: (spec, callback) => {
			callback('', { choice: '1', category: 'strong', rationale: 'definitions align exactly' });
		},
	};
	let observed = null;
	select(conformingEvidencePackage(), stubLlm, (err, result) => {
		observed = { err, result };
	});
	harness.equal('no error', observed.err, '');
	harness.equal('passes the REAL selectResultViolation oracle', selectResultViolation(observed.result), '');
	harness.equal('abstain is false', observed.result.abstain, false);
	harness.equal('pick is the FIRST pool candidate (choice "1")', observed.result.pick.stableId, 'ceds:P1');
	harness.equal('category rides through from the LLM', observed.result.category, 'strong');
})();

// =====================================================================
harness.section('GREEN — a pre-rendered { promptText, pool } wrapper skips rendering entirely');
// =====================================================================
(() => {
	const selectWithThrowingRenderer = evidenceSelectFactory({ renderer: throwingRenderer });
	const pool = [poolEntry('P9', 'Pre-rendered Candidate', 0.5)];
	const wrapper = { promptText: 'already rendered text', pool };
	const stubLlm = {
		rerank: (spec, callback) => {
			harness.equal('the pre-rendered promptText rides through UNCHANGED as userPrompt', spec.userPrompt, 'already rendered text');
			callback('', { choice: '1', category: 'moderate', rationale: 'a reasonable match' });
		},
	};
	let observed = null;
	// this call MUST NOT invoke throwingRenderer.render — same crash-vs-fail proof as the ⟪A3⟫ case.
	selectWithThrowingRenderer(wrapper, stubLlm, (err, result) => {
		observed = { err, result };
	});
	harness.equal('no error (rendering was skipped, not attempted and failed)', observed.err, '');
	harness.equal('passes selectResultViolation', selectResultViolation(observed.result), '');
	harness.equal('pick resolved from the WRAPPER\'s own pool', observed.result.pick.stableId, 'ceds:P9');
})();

// =====================================================================
harness.section('GREEN — an LLM NONE choice abstains with category "none"');
// =====================================================================
(() => {
	const stubLlm = { rerank: (spec, callback) => callback('', { choice: 'NONE' }) };
	let observed = null;
	select(conformingEvidencePackage(), stubLlm, (err, result) => {
		observed = { err, result };
	});
	harness.equal('no error', observed.err, '');
	harness.equal('passes selectResultViolation', selectResultViolation(observed.result), '');
	harness.equal('abstain is true', observed.result.abstain, true);
	harness.equal('category is none', observed.result.category, 'none');
	harness.equal('pick is null', observed.result.pick, null);
})();

// =====================================================================
harness.section('RED — llmClient omitting a valid category is refused, never fabricated (⟪A4⟫)');
// =====================================================================
(() => {
	const stubLlm = { rerank: (spec, callback) => callback('', { choice: '1', rationale: 'no category supplied' }) };
	let observed = null;
	select(conformingEvidencePackage(), stubLlm, (err) => {
		observed = err;
	});
	harness.match('refused, naming the missing/invalid category', observed, /did not supply a valid category/);
})();

// =====================================================================
harness.section('RED — llmClient omitting a rationale for its PICK is refused, never fabricated (⟪R-a REAL-RUN FINDING⟫)');
// =====================================================================
// THIS is the exact production fault a live LIF --rebridge against real Opus hit (2026-07-30): a pick
// with a valid category but no rationale. evidenceSelect.js is THE enforcer of this refusal (see
// lib/llmClient.js's own header for the "which layer enforces" disposition) — this is that enforcement,
// proven directly.
(() => {
	const stubLlm = { rerank: (spec, callback) => callback('', { choice: '1', category: 'strong' }) };
	let observed = null;
	select(conformingEvidencePackage(), stubLlm, (err) => {
		observed = err;
	});
	harness.match('refused, naming the missing rationale for the pick', observed, /did not supply a rationale for its pick/);
})();

// =====================================================================
harness.section('GREEN — evidenceSelect requests the EVIDENCE tool-schema variant on EVERY call (requireJudgment:true)');
// =====================================================================
// ⟪R-a REAL-RUN FIX⟫ item 2: evidenceSelect.js must request llmClient's stricter, category+rationale-
// REQUIRED schema variant on every rerank call — proven by inspecting what the stub llmClient actually
// received, never by reading evidenceSelect.js's own source text.
(() => {
	let observedSpec = null;
	const stubLlm = {
		rerank: (spec, callback) => {
			observedSpec = spec;
			callback('', { choice: '1', category: 'strong', rationale: 'x' });
		},
	};
	select(conformingEvidencePackage(), stubLlm, () => {});
	harness.equal('requireJudgment:true was passed to llmClient.rerank', observedSpec && observedSpec.requireJudgment, true);
})();

// =====================================================================
harness.section('RED — llmClient returning an out-of-range choice is refused, named');
// =====================================================================
(() => {
	const stubLlm = { rerank: (spec, callback) => callback('', { choice: '99', category: 'strong', rationale: 'x' }) };
	let observed = null;
	select(conformingEvidencePackage(), stubLlm, (err) => {
		observed = err;
	});
	harness.match('refused, naming the out-of-range choice', observed, /out-of-range choice '99'/);
})();

// =====================================================================
harness.section('RED — llmClient.rerank failing is propagated, named');
// =====================================================================
(() => {
	const stubLlm = { rerank: (spec, callback) => callback('rerank service unavailable') };
	let observed = null;
	select(conformingEvidencePackage(), stubLlm, (err) => {
		observed = err;
	});
	harness.match('refused, naming the underlying failure', observed, /llmClient\.rerank failed: rerank service unavailable/);
})();

harness.report();
