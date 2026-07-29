#!/usr/bin/env node
'use strict';

// test-evidenceFreezer.js — hermetic gate for lib/evidenceFreezer.js (bridgeEvidenceRefactor-
// spec.md §3, ⟪A6⟫; P2 deliverable). Proves:
//   COEXISTENCE — lib/decisionFreezer.js is untouched: it still serializes 'inferredDecisionRecord'
//          exactly as before, and evidenceFreezer's own record type is a DIFFERENT, new one.
//   RED  — freeze() throws (call-time wiring fault, named) when generation/rendererVersion are
//          missing; parse() refuses (as a VALUE, never thrown) invalid JSON and the wrong recordType.
//   GREEN — freeze() produces a decisionBlock that passes the REAL freezeAdditionsViolation oracle;
//          freeze() -> parse() round-trips the ⟪A6⟫ fields AND the frozen evidence BYTE-IDENTICALLY;
//          perturbing a decision changes the hash (the pin bites, same discipline as decisionFreezer);
//          an END-TO-END scenario freezes REAL evidenceComposer output and proves replay recovers it
//          without ever re-invoking the walk hook (replay never re-walks).
//
// Hermetic throughout: no Docker, no Neo4j, no LLM, no network.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-evidenceFreezer.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the P2 ⟪A6⟫ evidence freezer (evidenceFreezer.js)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves coexistence with lib/decisionFreezer.js (untouched, different record type), RED
     (missing generation/rendererVersion throws; parse() refuses malformed input as a value), and
     GREEN (freeze/parse round-trips the ⟪A6⟫ additions and the frozen evidence byte-identically;
     an end-to-end run with the REAL evidenceComposer proves replay never re-walks).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const decisionFreezerFactory = require('../lib/decisionFreezer');
const evidenceFreezerFactory = require('../lib/evidenceFreezer');
const evidenceComposerFactory = require('../lib/evidenceComposer');
const semanticMatcherFactory = require('../lib.d/semanticMatcher');
const { freezeAdditionsViolation } = require('../lib/evidenceContracts');

// =====================================================================
harness.section('COEXISTENCE — lib/decisionFreezer.js is untouched; evidenceFreezer uses a DIFFERENT record type');
// =====================================================================
(() => {
	const decisionFreezer = decisionFreezerFactory();
	const oldFrozen = decisionFreezer.freeze({
		pairStamp: { subjectSource: 'LIF', subjectVersion: 'v1', objectSource: 'CEDS', objectVersion: 'v14' },
		decisions: [{ source: { stableId: 's1', role: 'DmeProperty' }, abstain: false, targetKey: 'P1', cosineScore: 0.9, retrievalRank: 1 }],
	});
	harness.equal(
		'decisionFreezer.freeze() STILL produces recordType inferredDecisionRecord, unchanged',
		JSON.parse(oldFrozen.frozenText).recordType,
		'inferredDecisionRecord',
	);
	harness.equal('evidenceFreezer\'s own record type constant is DIFFERENT', evidenceFreezerFactory.RECORD_TYPE, 'evidenceDecisionRecord');
})();

const evidenceFreezer = evidenceFreezerFactory();

const pairStamp = { subjectSource: 'LIF', subjectVersion: 'v1', objectSource: 'CEDS', objectVersion: 'v14' };
const decisions = [
	{ source: { stableId: 's1', role: 'DmeProperty' }, abstain: false, targetKey: 'P1', cosineScore: 0.9, retrievalRank: 1 },
	{ source: { stableId: 's2', role: 'DmeProperty' }, abstain: true, abstainReason: 'cosineFloor', targetKey: null },
];
const evidencePackages = {
	pool: [
		{
			candidate: { stableId: 'ceds:P1', canonicalKey: 'P1', name: 'Near' },
			cosine: 0.9,
			considerations: {
				tuple: {
					referenceTier: 'property',
					canonicalKey: 'P1',
					propertyKey: 'P1',
					name: 'Near',
					domains: [{ domainId: 'C1', domainName: 'D1' }],
					domainsComplete: true,
					range: { shape: 'datatype', rangeDatatype: 'string', rangeClassId: null, rangeOptionSetId: null },
					isQualified: false,
					qualifier: null,
					value: null,
				},
				notes: ['walked: found 1 related element'],
			},
		},
	],
	promptSegments: ['Judge this pair using the walked context.'],
};

// =====================================================================
harness.section('RED — freeze() throws (call-time wiring fault, named) when ⟪A6⟫ fields are missing');
// =====================================================================
harness.match(
	'missing generation throws, naming the reason',
	(() => {
		try {
			evidenceFreezer.freeze({ pairStamp, decisions, rendererVersion: 'renderer-v1', evidencePackages });
			return '';
		} catch (e) {
			return e.message;
		}
	})(),
	/generation is not given/,
);
harness.match(
	'missing rendererVersion throws, naming the reason',
	(() => {
		try {
			evidenceFreezer.freeze({ pairStamp, decisions, generation: 'gen-1', evidencePackages });
			return '';
		} catch (e) {
			return e.message;
		}
	})(),
	/rendererVersion is not given/,
);

// =====================================================================
harness.section('RED — parse() refuses malformed input AS A VALUE, never thrown (matches decisionFreezer.parse convention)');
// =====================================================================
harness.match('parse() on invalid JSON is refused, naming the reason', evidenceFreezer.parse('{not valid json').error, /is not valid JSON/);
harness.match(
	'parse() on the wrong recordType is refused, naming the reason',
	evidenceFreezer.parse(JSON.stringify({ recordType: 'inferredDecisionRecord' })).error,
	/is not a evidenceDecisionRecord/,
);

// =====================================================================
harness.section('GREEN — freeze() passes the REAL freezeAdditionsViolation oracle');
// =====================================================================
const frozen = evidenceFreezer.freeze({ pairStamp, decisions, generation: 'gen-2026-07-29T00:00:00Z', rendererVersion: 'renderer-v1', evidencePackages });
harness.equal('freeze() output passes freezeAdditionsViolation', freezeAdditionsViolation(frozen), '');
harness.equal('freeze() extracts the ONE non-abstain pick', frozen.inferredDecisions.length, 1);
harness.equal('freeze() non-abstain row carries the targetKey', frozen.inferredDecisions[0].targetKey, 'P1');

// =====================================================================
harness.section('GREEN — freeze() -> parse() round-trips the ⟪A6⟫ fields AND frozenEvidence BYTE-IDENTICALLY');
// =====================================================================
const parsed = evidenceFreezer.parse(frozen.frozenText);
harness.ok('parse() reports no error on a well-formed block', !parsed.error, parsed.error);
harness.equal('parse() round-trips generation', parsed.generation, 'gen-2026-07-29T00:00:00Z');
harness.equal('parse() round-trips rendererVersion', parsed.rendererVersion, 'renderer-v1');
harness.equal(
	'parse() round-trips frozenEvidence BYTE-IDENTICALLY (replay never re-walks — it is read back, never recomputed)',
	JSON.stringify(parsed.frozenEvidence),
	JSON.stringify(evidencePackages),
);
harness.equal('parse() output ALSO passes freezeAdditionsViolation', freezeAdditionsViolation(parsed), '');

// =====================================================================
harness.section('GREEN — perturbing a decision changes the decisionBlockHash (the pin bites, same as decisionFreezer)');
// =====================================================================
const perturbedDecisions = decisions.map((d) => (d.source.stableId === 's1' ? { ...d, targetKey: 'P9' } : d));
const frozenPerturbed = evidenceFreezer.freeze({
	pairStamp,
	decisions: perturbedDecisions,
	generation: 'gen-2026-07-29T00:00:00Z',
	rendererVersion: 'renderer-v1',
	evidencePackages,
});
harness.ok('perturbing a decision changes the hash', frozenPerturbed.decisionBlockHash !== frozen.decisionBlockHash);

const frozenSameInputsAgain = evidenceFreezer.freeze({
	pairStamp,
	decisions,
	generation: 'gen-2026-07-29T00:00:00Z',
	rendererVersion: 'renderer-v1',
	evidencePackages,
});
harness.equal('freezing the SAME inputs twice produces the SAME hash (byte-stable)', frozenSameInputsAgain.decisionBlockHash, frozen.decisionBlockHash);

// =====================================================================
harness.section('END-TO-END — REAL evidenceComposer output, frozen, then replayed WITHOUT re-invoking the walk hook');
// =====================================================================
(() => {
	const semanticMatcher = semanticMatcherFactory({ topK: 15 });

	let walkInvocationCount = 0;
	const walk = (spec, callback) => {
		walkInvocationCount += 1;
		callback('', {
			perCandidateNotes: { 'ceds:P1': ['walked: a real finding, gathered ONCE'] },
			promptSegments: ['A real global instruction, gathered ONCE.'],
		});
	};
	const composer = evidenceComposerFactory({ semanticMatcher, walk, dependencies: ['lif'] });

	const sourceElement = { stableId: 'lif:s1', role: 'DmeProperty', name: 'Source One', defText: 'source def', vector: [1, 0, 0] };
	const candidateElements = [{ stableId: 'ceds:P1', canonicalKey: 'P1', name: 'Near', vector: [1, 0, 0] }];
	const hubModule = (candidate, callback) =>
		callback('', {
			referenceTier: 'property',
			canonicalKey: candidate.canonicalKey,
			propertyKey: candidate.canonicalKey,
			name: candidate.name,
			domains: [{ domainId: 'C1', domainName: 'D1' }],
			domainsComplete: true,
			range: { shape: 'datatype', rangeDatatype: 'string', rangeClassId: null, rangeOptionSetId: null },
			isQualified: false,
			qualifier: null,
			value: null,
		});
	const graphReaderDouble = { readNodes: (s, cb) => cb('', { nodes: [] }), close: (cb) => cb('') };

	let composedPackage = null;
	composer({ sourceElement, candidateElements, graphReader: graphReaderDouble, hubModule }, (err, evidencePackage) => {
		if (err) {
			throw new Error(`test fixture composer call failed: ${err}`);
		}
		composedPackage = evidencePackage;
	});

	harness.equal('the walk hook ran exactly once, gathering the evidence', walkInvocationCount, 1);

	const realDecisions = [{ source: { stableId: 'lif:s1', role: 'DmeProperty' }, abstain: false, targetKey: 'P1', cosineScore: 1, retrievalRank: 1 }];
	const realFrozen = evidenceFreezer.freeze({
		pairStamp: { subjectSource: 'LIF', subjectVersion: 'v1', objectSource: 'CEDS', objectVersion: 'v14' },
		decisions: realDecisions,
		generation: 'gen-e2e-1',
		rendererVersion: 'renderer-v1',
		evidencePackages: composedPackage,
	});
	const realParsed = evidenceFreezer.parse(realFrozen.frozenText);
	harness.ok('replay parse() reports no error', !realParsed.error, realParsed.error);
	harness.equal(
		'REPLAY RECOVERS THE EXACT COMPOSED PACKAGE — byte-identical, without touching the walk hook again',
		JSON.stringify(realParsed.frozenEvidence),
		JSON.stringify(composedPackage),
	);
	harness.equal('the walk hook STILL only ran once — replay never re-walks', walkInvocationCount, 1);
	harness.equal(
		'the walked note survived the freeze/parse round-trip inside the recovered candidate evidence',
		realParsed.frozenEvidence.pool[0].considerations.notes[0],
		'walked: a real finding, gathered ONCE',
	);
})();

harness.report();
