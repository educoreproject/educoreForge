#!/usr/bin/env node
'use strict';

// test-evidenceFlow.js — THE PHASE GATE (bridgeEvidenceRefactor-spec.md §7 P3). ONE hermetic test
// driving the WHOLE new evidence path with REAL modules (composed through the REAL kitLoader.buildKit,
// proving deliverable #5's "buildKit() must yield a kit whose members can drive the full new path")
// and a STUBBED llmClient — no Docker, no Neo4j, no real LLM, no commit:
//
//   full elements -> kit.evidenceComposer(real kit.cedsHubModule) -> ⟪A3⟫ shape gate ->
//   kit.evidenceRenderer -> kit.evidenceSelect(stub Opus) -> kit.confidenceNormalizer ->
//   kit.evidenceFreezer.freeze -> parse -> byte-identical evidence recovery, a decision block
//   carrying generation + RENDERER_VERSION + category + normalized confidence.
//
// EVERY intermediate is validated by its OWN real contract gate (evidenceContracts.js) — never this
// suite's own assertions alone; the contract gate IS the acceptance oracle throughout.
//
// PLUS P0-FIDELITY: kit.cedsHubModule's output for EVERY P0-cedsTupleModel.md §3 worked shape
// (property unqualified, class-range, option-set, qualified, value-tier four-slot) checked against
// the REAL hubModulePresentationViolation oracle AND against P0's own literal example field values,
// plus an explicit domainsComplete:false proof (P0 §2.4).
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-evidenceFlow.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- THE P3 PHASE GATE: the whole evidence path, end to end, hermetically

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Drives full elements through the REAL kit (kitLoader.buildKit): evidenceComposer(cedsHubModule)
     -> the ⟪A3⟫ shape gate -> evidenceRenderer -> evidenceSelect(stub Opus) -> confidenceNormalizer
     -> evidenceFreezer.freeze -> parse, proving byte-identical evidence recovery and that every
     intermediate passes its own real contract gate. Plus P0-fidelity cases for every hub-module shape.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const kitLoader = require('../lib/kitLoader');
const { deriveEdgePolicy } = require('../lib/componentLibrary');
const {
	evidencePackageViolation,
	hubModulePresentationViolation,
	rendererModuleViolation,
	rendererDeterminismViolation,
	selectShapeViolation,
	selectResultViolation,
	normalizerShapeViolation,
	normalizerDeterminismViolation,
	freezeAdditionsViolation,
} = require('../lib/evidenceContracts');

// =====================================================================
// THE KIT — built through the REAL kitLoader.buildKit, doubles ONLY at the substrate boundary
// (graphWriter/graphReader/vectorizer never touch Docker/Neo4j/Voyage).
// =====================================================================
const graphWriterDouble = { writeRelationshipEdge: (spec, cb) => cb('', { edgeWritten: true }) };
const graphReaderDouble = () => ({ readNodes: (spec, cb) => cb('', { nodes: [] }), close: (cb) => cb('') });
const fakeVectorizerFactory = () => ({ batchEmbed: ({ texts }, cb) => cb('', { vectors: (texts || []).map(() => null) }) });
const edgePolicy = deriveEdgePolicy();

const kit = kitLoader.buildKit({
	inGraph: { graphName: 'DEV_probe', boltUrl: 'bolt://x', password: 'x' },
	graphWriter: graphWriterDouble,
	edgePolicy,
	componentOverrides: { graphReader: graphReaderDouble, vectorizer: fakeVectorizerFactory },
});

// =====================================================================
// FIXTURES — a full source element (LIF-shaped) + full CEDS HubReference candidate elements
// (flattenFullRecord shape), hand-picked vectors so cosine ranks are unambiguous.
// =====================================================================
const sourceElement = {
	stableId: 'lif:staffEvalScore',
	role: 'DmeProperty',
	name: 'Staff Evaluation Score',
	defText: 'A numeric evaluation score assigned to a staff member.',
	vector: [1, 0, 0],
};

const candidateNear = {
	stableId: 'cedsHubRef:addr1',
	role: 'HubReference',
	referenceTier: 'property',
	canonicalKey: 'P000104',
	propertyKey: 'P000104',
	name: 'Staff Evaluation Score or Rating',
	domainId: 'C200366',
	rangeDatatype: 'string',
	vector: [1, 0, 0], // cosine 1.0 — the true match
};
const candidateFar = {
	stableId: 'cedsHubRef:addr2',
	role: 'HubReference',
	referenceTier: 'property',
	canonicalKey: 'P600253',
	propertyKey: 'P600253',
	name: 'Has Local Education Agency Title I Support Service',
	domainId: 'C200188',
	rangeClassId: 'C200196',
	vector: [0, 1, 0], // cosine 0.0 — a plausible-looking distractor
};
const candidateElements = [candidateNear, candidateFar];

const graphReaderForComposer = { readNodes: (spec, cb) => cb('', { nodes: [] }), close: (cb) => cb('') };

// =====================================================================
harness.section('STEP 1 — kit.evidenceComposer(real kit.cedsHubModule): full elements -> EvidencePackage');
// =====================================================================
const composer = kit.evidenceComposer({ semanticMatcher: kit.semanticMatcher });

let evidencePackage = null;
composer(
	{ sourceElement, candidateElements, graphReader: graphReaderForComposer, hubModule: kit.cedsHubModule },
	(err, out) => {
		harness.equal('composer calls back with no error', err, '');
		evidencePackage = out;
	},
);
harness.ok('an evidencePackage was produced', !!evidencePackage);
harness.equal('pool has exactly 2 entries (both candidates)', evidencePackage.pool.length, 2);
harness.equal('pool[0] is the cosine-nearest candidate', evidencePackage.pool[0].candidate.stableId, 'cedsHubRef:addr1');

// =====================================================================
harness.section('STEP 2 — THE ⟪A3⟫ SHAPE GATE: the composed package is validated at the seam');
// =====================================================================
harness.equal('the evidencePackage passes the REAL evidencePackageViolation oracle', evidencePackageViolation(evidencePackage), '');
evidencePackage.pool.forEach((oneEntry, idx) => {
	harness.equal(
		`pool[${idx}]'s hub tuple passes the REAL hubModulePresentationViolation oracle`,
		hubModulePresentationViolation(oneEntry.considerations.tuple),
		'',
	);
});

// =====================================================================
harness.section('STEP 3 — kit.evidenceRenderer: EvidencePackage -> deterministic promptText');
// =====================================================================
harness.equal('kit.evidenceRenderer passes the REAL rendererModuleViolation oracle', rendererModuleViolation(kit.evidenceRenderer, 'kit.evidenceRenderer'), '');
harness.equal(
	'kit.evidenceRenderer passes the REAL rendererDeterminismViolation oracle',
	rendererDeterminismViolation(kit.evidenceRenderer.render, evidencePackage, ['Judge CEDS matches by definition, not surface wording.'], {}),
	'',
);

let promptText = null;
kit.evidenceRenderer.render(evidencePackage, ['Judge CEDS matches by definition, not surface wording.'], {}, (err, out) => {
	harness.equal('render calls back with no error', err, '');
	promptText = out;
});
harness.ok('promptText mentions the true match', promptText.includes('Staff Evaluation Score or Rating'));
harness.ok('promptText mentions the distractor', promptText.includes('Has Local Education Agency Title I Support Service'));

// =====================================================================
harness.section('STEP 4 — kit.evidenceSelect(stub Opus): promptText + pool -> a discrete verdict');
// =====================================================================
harness.equal('kit.evidenceSelect passes the REAL selectShapeViolation oracle', selectShapeViolation(kit.evidenceSelect, 'kit.evidenceSelect'), '');

const stubOpus = {
	rerank: (spec, callback) => {
		harness.ok('the stub LLM receives the SAME promptText the renderer produced', spec.userPrompt === promptText);
		callback('', { choice: '1', category: 'strong', rationale: 'the definitions align exactly; the distractor is unrelated' });
	},
};

let selectResult = null;
kit.evidenceSelect({ promptText, pool: evidencePackage.pool }, stubOpus, (err, out) => {
	harness.equal('select calls back with no error', err, '');
	selectResult = out;
});
harness.equal('selectResult passes the REAL selectResultViolation oracle', selectResultViolation(selectResult), '');
harness.equal('the pick is the true match', selectResult.pick.stableId, 'cedsHubRef:addr1');
harness.equal('category is "strong"', selectResult.category, 'strong');
harness.equal('abstain is false', selectResult.abstain, false);

const chosenEntry = evidencePackage.pool.find((oneEntry) => oneEntry.candidate.stableId === selectResult.pick.stableId);
harness.ok('the chosen pool entry (for its cosine) was found', !!chosenEntry);

// =====================================================================
harness.section('STEP 5 — kit.confidenceNormalizer: category + retrieval cosine -> deterministic confidence');
// =====================================================================
harness.equal('kit.confidenceNormalizer passes the REAL normalizerShapeViolation oracle', normalizerShapeViolation(kit.confidenceNormalizer, 'kit.confidenceNormalizer'), '');
harness.equal(
	'kit.confidenceNormalizer passes the REAL normalizerDeterminismViolation oracle',
	normalizerDeterminismViolation(kit.confidenceNormalizer, selectResult.category, chosenEntry.cosine, {}),
	'',
);

let normalizedConfidence = null;
kit.confidenceNormalizer(selectResult.category, chosenEntry.cosine, {}, (err, out) => {
	harness.equal('normalize calls back with no error', err, '');
	normalizedConfidence = out;
});
// chosenEntry.cosine is exactly 1.0 (hand-picked identical vectors) -> the 'strong' band's CEILING, exactly.
harness.equal('at cosine=1.0, "strong" normalizes to EXACTLY the strong band ceiling', normalizedConfidence, require('../lib.d/confidenceNormalizer').CATEGORY_BAND.strong.ceiling);

// =====================================================================
harness.section('STEP 6 — kit.evidenceFreezer.freeze: generation + RENDERER_VERSION + evidence -> a self-describing block');
// =====================================================================
const generation = 'evidence-p3-flow-test-gen-1';

// the frozen evidence blob carries BOTH the evidence package AND the judgment (category + rationale +
// normalized confidence) — lib/evidenceFreezer.js's per-source `decisions[]` shape (P2, byte-
// untouched) has no category/confidence fields of its own (it only carries fromStableId/targetKey/
// cosineScore/retrievalRank — the SAME shape decisionFreezer's scalar path already uses); P3 carries
// category+confidence INSIDE the frozen evidence blob itself rather than extending P2's schema. See
// this phase's final report for the ambiguity this resolves.
const frozenEvidencePayload = {
	evidencePackage,
	judgment: { category: selectResult.category, rationale: selectResult.rationale, normalizedConfidence },
};

const decisionForFreeze = {
	source: { stableId: sourceElement.stableId, role: sourceElement.role },
	abstain: selectResult.abstain,
	abstainReason: null,
	targetKey: selectResult.pick.canonicalKey,
	chosenStableId: selectResult.pick.stableId,
	retrievalRank: 1,
	cosineScore: chosenEntry.cosine,
};

const decisionBlock = kit.evidenceFreezer.freeze({
	pairStamp: { subjectSource: 'LIF', subjectVersion: '', objectSource: 'CEDS', objectVersion: '14.0.0.0' },
	decisions: [decisionForFreeze],
	generation,
	rendererVersion: kit.evidenceRenderer.RENDERER_VERSION,
	evidencePackages: frozenEvidencePayload,
});
harness.equal('the decision block passes the REAL freezeAdditionsViolation oracle', freezeAdditionsViolation(decisionBlock), '');
harness.equal('decisionBlock.generation is the given generation', decisionBlock.generation, generation);
harness.equal('decisionBlock.rendererVersion is the RENDERER_VERSION', decisionBlock.rendererVersion, kit.evidenceRenderer.RENDERER_VERSION);

// =====================================================================
harness.section('STEP 7 — kit.evidenceFreezer.parse: byte-identical evidence recovery, no re-walk');
// =====================================================================
const parsed = kit.evidenceFreezer.parse(decisionBlock.frozenText);
harness.ok('parse succeeded (no .error)', !parsed.error);
harness.equal('parsed.generation matches', parsed.generation, generation);
harness.equal('parsed.rendererVersion matches', parsed.rendererVersion, kit.evidenceRenderer.RENDERER_VERSION);
harness.equal(
	'BYTE-IDENTICAL EVIDENCE RECOVERY: parsed.frozenEvidence === the evidence handed to freeze(), verbatim',
	JSON.stringify(parsed.frozenEvidence),
	JSON.stringify(frozenEvidencePayload),
);
harness.equal('the decision carries CATEGORY (inside the frozen evidence)', parsed.frozenEvidence.judgment.category, 'strong');
harness.equal('the decision carries the NORMALIZED CONFIDENCE (inside the frozen evidence)', parsed.frozenEvidence.judgment.normalizedConfidence, normalizedConfidence);
harness.equal('parsed.decisions[0].chosenStableId round-trips', parsed.decisions[0].chosenStableId, 'cedsHubRef:addr1');
harness.equal('parsed.decisions[0].cosineScore round-trips', parsed.decisions[0].cosineScore, chosenEntry.cosine);
harness.equal('parsed.inferredDecisions carries the one non-abstaining pick', parsed.inferredDecisions.length, 1);

// =====================================================================
harness.section('PLUS — P0-FIDELITY: kit.cedsHubModule against EVERY P0-cedsTupleModel.md §3 worked shape');
// =====================================================================

const hubCallWith = (candidate) => {
	let observed = null;
	kit.cedsHubModule(candidate, (err, presentation) => {
		observed = { err, presentation };
	});
	return observed;
};

// Shape A — scalar datatype property (P0 §3, 994 live instances)
(() => {
	const observed = hubCallWith({
		referenceTier: 'property',
		canonicalKey: 'P000104',
		propertyKey: 'P000104',
		name: 'Staff Evaluation Score or Rating',
		domainId: 'C200366',
		rangeDatatype: 'string',
	});
	harness.equal('P0-fidelity Shape A: no error', observed.err, '');
	harness.equal('P0-fidelity Shape A: passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('P0-fidelity Shape A: canonicalKey matches P0\'s own example', observed.presentation.canonicalKey, 'P000104');
	harness.equal('P0-fidelity Shape A: range.rangeDatatype matches P0\'s own example', observed.presentation.range.rangeDatatype, 'string');
	harness.equal('P0-fidelity Shape A: domainsComplete is honestly false', observed.presentation.domainsComplete, false);
})();

// Shape B — class-range property (P0 §3, 363 live instances)
(() => {
	const observed = hubCallWith({
		referenceTier: 'property',
		canonicalKey: 'P600253',
		propertyKey: 'P600253',
		name: 'Has Local Education Agency Title I Support Service',
		domainId: 'C200188',
		rangeClassId: 'C200196',
	});
	harness.equal('P0-fidelity Shape B: no error', observed.err, '');
	harness.equal('P0-fidelity Shape B: passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('P0-fidelity Shape B: range.rangeClassId matches P0\'s own example', observed.presentation.range.rangeClassId, 'C200196');
})();

// Shape C — option-set (enumerated) property (P0 §3, 994 live instances)
(() => {
	const observed = hubCallWith({
		referenceTier: 'property',
		canonicalKey: 'P001753',
		propertyKey: 'P001753',
		name: 'Has Credential Definition Verification Type',
		domainId: 'C200087',
		rangeOptionSetId: 'OS001753',
	});
	harness.equal('P0-fidelity Shape C: no error', observed.err, '');
	harness.equal('P0-fidelity Shape C: passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('P0-fidelity Shape C: range.rangeOptionSetId matches P0\'s own example', observed.presentation.range.rangeOptionSetId, 'OS001753');
})();

// Shape D — qualified property variant (P0 §3, 27 live instances)
(() => {
	const observed = hubCallWith({
		referenceTier: 'property',
		canonicalKey: 'P600502',
		propertyKey: 'P600502',
		name: 'Has Organization Identifier [Federal School Code]',
		domainId: 'C200239',
		rangeClassId: 'C200252',
		qualifierKeys: ['OV_federalSchoolCode'],
	});
	harness.equal('P0-fidelity Shape D: no error', observed.err, '');
	harness.equal('P0-fidelity Shape D: passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('P0-fidelity Shape D: qualifier.qualifierName matches P0\'s own example', observed.presentation.qualifier.qualifierName, 'Federal School Code');
	harness.equal(
		'P0-fidelity Shape D: canonicalKey is shared with the unqualified base (P0 §2.2 ambiguity, disambiguated by the qualifier context)',
		observed.presentation.canonicalKey,
		'P600502',
	);
})();

// Shape E — value-tier option-value, 4-slot (P0 §3, 27,437 live instances)
(() => {
	const observed = hubCallWith({
		referenceTier: 'value',
		canonicalKey: 'OV001637175776',
		propertyKey: 'P001637',
		name: 'Yankunytjatjara',
		domainId: 'C200010',
		rangeOptionSetId: 'OS001637',
		valueKey: 'OV001637175776',
	});
	harness.equal('P0-fidelity Shape E: no error', observed.err, '');
	harness.equal('P0-fidelity Shape E: passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('P0-fidelity Shape E: value.owningPropertyKey matches P0\'s own example', observed.presentation.value.owningPropertyKey, 'P001637');
	harness.equal('P0-fidelity Shape E: value.owningOptionSetId matches P0\'s own example', observed.presentation.value.owningOptionSetId, 'OS001637');
	harness.equal('P0-fidelity Shape E: domainsComplete is honestly false', observed.presentation.domainsComplete, false);
})();

harness.report();
