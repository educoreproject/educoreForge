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
// PLUS SHAPE-FIDELITY (⟪hubReimplementation P3, SPEC-hubReimplementation-080326.md §6⟫): kit.
// cedsHubModule's output for EVERY worked shape (property unqualified, class-range, option-set,
// qualified, value-tier) checked against the REAL hubModulePresentationViolation oracle AND against
// each new-shape card's own literal MEANING field values (domain group, property group, range prose,
// qualifierNames, value prose), plus explicit retired-field absence proofs (SPEC §1.6: no domains[],
// no domainsComplete, no qualifier object) and a missing-domainName refusal twin (refused BY NAME).
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
     intermediate passes its own real contract gate. Plus shape-fidelity cases for every hub-module
     card shape (⟪hubReimplementation P3⟫ MEANING contract) and their SPEC §6 refusal twins.

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
// FIXTURES — a full source element (LIF-shaped) + full CEDS HubReference candidate CARDS in the
// ⟪hubReimplementation P3⟫ SELF-SUFFICIENT shape (SPEC-hubReimplementation-080326.md §1): ADDRESS +
// IDENTITY + MEANING (domainName/domainDefinition, propertyName/propertyDefinition, range prose) +
// DERIVED (embedText; vector drives the hermetic cosine retrieval) all ON the card. No cedsId, no
// description, no searchText, no allDomainIds/allDomainNames, no ' [qualifier]' name suffix (§1.6).
// Hand-picked vectors so cosine ranks are unambiguous.
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
	domainName: 'Staff Evaluation',
	domainDefinition: 'Information about the evaluation of a staff member.',
	propertyName: 'Staff Evaluation Score or Rating',
	propertyDefinition: 'The score or rating assigned to a staff member as the result of an evaluation.',
	rangeDatatype: 'string',
	embedText:
		'Staff Evaluation · Staff Evaluation Score or Rating · The score or rating assigned to a staff ' +
		'member as the result of an evaluation. · Information about the evaluation of a staff member.',
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
	domainName: 'Local Education Agency',
	domainDefinition: 'A local-level education agency that operates schools or contracts for educational services.',
	propertyName: 'Has Local Education Agency Title I Support Service',
	propertyDefinition: 'An indication that the local education agency provides a Title I support service.',
	rangeClassId: 'C200196',
	rangeClassName: 'Title I Support Service',
	rangeClassDefinition: 'A support service provided to students under Title I.',
	embedText:
		'Local Education Agency · Has Local Education Agency Title I Support Service · An indication that ' +
		'the local education agency provides a Title I support service. · A local-level education agency ' +
		'that operates schools or contracts for educational services.',
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
// ⟪hubReimplementation P3 (SPEC §6)⟫ the candidate blocks now carry the card's MEANING — the domain
// by NAME (id in parens), the property's definition, the domain's definition — and the completeness
// caveat is DELETED, not conditional.
harness.ok(
	'promptText carries the true match\'s Domain line — name leading, id in parens',
	promptText.includes('Domain: Staff Evaluation (C200366)'),
);
harness.ok(
	'promptText carries the true match\'s property definition line',
	promptText.includes('Definition: The score or rating assigned to a staff member as the result of an evaluation.'),
);
harness.ok(
	'promptText carries the true match\'s domain definition line',
	promptText.includes('Domain definition: Information about the evaluation of a staff member.'),
);
harness.ok(
	'promptText carries the distractor\'s class-range name and its range definition',
	promptText.includes('Range: reference → CEDS class C200196 (Title I Support Service)') &&
		promptText.includes('Range definition: A support service provided to students under Title I.'),
);
harness.ok(
	'the completeness caveat string is GONE from the rendered prompt (SPEC §6: deleted, never conditional)',
	!promptText.includes('may be incomplete'),
);

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
harness.section('PLUS — SHAPE-FIDELITY (⟪hubReimplementation P3⟫): kit.cedsHubModule against EVERY worked card shape (SPEC §1/§6)');
// =====================================================================

const hubCallWith = (candidate) => {
	let observed = null;
	kit.cedsHubModule(candidate, (err, presentation) => {
		observed = { err, presentation };
	});
	return observed;
};

// retiredFieldsAbsent — SPEC §1.6's absence proof, applied to the PRESENTATION: the old-shape
// fields must not merely be falsy, they must not EXIST (the ⟪A3⟫ gate refuses them on sight).
const retiredFieldsAbsent = (presentation) =>
	presentation.domains === undefined && presentation.domainsComplete === undefined && presentation.qualifier === undefined;

// Shape A — scalar datatype property (994 live instances)
(() => {
	const observed = hubCallWith({
		referenceTier: 'property',
		canonicalKey: 'P000104',
		propertyKey: 'P000104',
		name: 'Staff Evaluation Score or Rating',
		domainId: 'C200366',
		domainName: 'Staff Evaluation',
		domainDefinition: 'Information about the evaluation of a staff member.',
		propertyName: 'Staff Evaluation Score or Rating',
		propertyDefinition: 'The score or rating assigned to a staff member as the result of an evaluation.',
		rangeDatatype: 'string',
	});
	harness.equal('shape-fidelity A: no error', observed.err, '');
	harness.equal('shape-fidelity A: passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('shape-fidelity A: canonicalKey rides through', observed.presentation.canonicalKey, 'P000104');
	harness.equal('shape-fidelity A: range.rangeDatatype rides through', observed.presentation.range.rangeDatatype, 'string');
	harness.equal('shape-fidelity A: domain group carries the card\'s own domainName', observed.presentation.domain.domainName, 'Staff Evaluation');
	harness.equal('shape-fidelity A: domain group carries the card\'s own domainDefinition', observed.presentation.domain.domainDefinition, 'Information about the evaluation of a staff member.');
	harness.equal(
		'shape-fidelity A: property group carries the card\'s own propertyDefinition',
		observed.presentation.property.propertyDefinition,
		'The score or rating assigned to a staff member as the result of an evaluation.',
	);
	harness.ok('shape-fidelity A: NO retired fields (domains/domainsComplete/qualifier), SPEC §1.6', retiredFieldsAbsent(observed.presentation));
})();

// Shape B — class-range property, range prose riding with the range (363 live instances)
(() => {
	const observed = hubCallWith({
		referenceTier: 'property',
		canonicalKey: 'P600253',
		propertyKey: 'P600253',
		name: 'Has Local Education Agency Title I Support Service',
		domainId: 'C200188',
		domainName: 'Local Education Agency',
		propertyName: 'Has Local Education Agency Title I Support Service',
		propertyDefinition: 'An indication that the local education agency provides a Title I support service.',
		rangeClassId: 'C200196',
		rangeClassName: 'Title I Support Service',
		rangeClassDefinition: 'A support service provided to students under Title I.',
	});
	harness.equal('shape-fidelity B: no error', observed.err, '');
	harness.equal('shape-fidelity B: passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('shape-fidelity B: range.rangeClassId rides through', observed.presentation.range.rangeClassId, 'C200196');
	harness.equal('shape-fidelity B: range carries the class NAME prose', observed.presentation.range.rangeClassName, 'Title I Support Service');
	harness.equal('shape-fidelity B: range carries the class DEFINITION prose', observed.presentation.range.rangeClassDefinition, 'A support service provided to students under Title I.');
})();

// Shape C — option-set (enumerated) property, option-set prose riding with the range (994 live instances)
(() => {
	const observed = hubCallWith({
		referenceTier: 'property',
		canonicalKey: 'P001753',
		propertyKey: 'P001753',
		name: 'Has Credential Definition Verification Type',
		domainId: 'C200087',
		domainName: 'Credential Definition',
		propertyName: 'Has Credential Definition Verification Type',
		propertyDefinition: 'The type of verification available for the credential.',
		rangeOptionSetId: 'OS001753',
		rangeOptionSetName: 'Credential Definition Verification Type',
	});
	harness.equal('shape-fidelity C: no error', observed.err, '');
	harness.equal('shape-fidelity C: passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('shape-fidelity C: range.rangeOptionSetId rides through', observed.presentation.range.rangeOptionSetId, 'OS001753');
	harness.equal('shape-fidelity C: range carries the option set NAME prose', observed.presentation.range.rangeOptionSetName, 'Credential Definition Verification Type');
	harness.ok(
		'shape-fidelity C: option-set definition the card did not carry stays ABSENT (never \'\', SPEC §1.3)',
		observed.presentation.range.rangeOptionSetDefinition === undefined,
	);
})();

// Shape D — qualified property variant (27 live instances). The card's name carries NO
// ' [qualifier]' suffix (SPEC §1.6 — that convention is retired); qualifierKeys/qualifierNames ride
// positionally parallel ON the card, and the presentation carries qualifierNames verbatim.
(() => {
	const observed = hubCallWith({
		referenceTier: 'property',
		canonicalKey: 'P600502',
		propertyKey: 'P600502',
		name: 'Has Organization Identifier',
		domainId: 'C200239',
		domainName: 'Organization',
		propertyName: 'Has Organization Identifier',
		propertyDefinition: 'An identifier assigned to the organization.',
		rangeClassId: 'C200252',
		qualifierKeys: ['OV_federalSchoolCode'],
		qualifierNames: ['Federal School Code'],
	});
	harness.equal('shape-fidelity D: no error', observed.err, '');
	harness.equal('shape-fidelity D: passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('shape-fidelity D: isQualified is true', observed.presentation.isQualified, true);
	harness.equal('shape-fidelity D: qualifierNames carries the card\'s own qualifier name, verbatim', observed.presentation.qualifierNames[0], 'Federal School Code');
	harness.equal(
		'shape-fidelity D: canonicalKey is shared with the unqualified base — disambiguated by qualifierNames, never by a name-suffix parse',
		observed.presentation.canonicalKey,
		'P600502',
	);
	harness.ok('shape-fidelity D: NO retired qualifier object (SPEC §1.6)', retiredFieldsAbsent(observed.presentation));
})();

// Shape E — value-tier option-value (27,437 live instances): the owning property's MEANING rides in
// the property group (what makes a prose-less value judgeable, PLAN §3), the value's own prose rides
// in the value context, and a valueDefinition the card did not carry stays honestly absent (~52% do not).
(() => {
	const observed = hubCallWith({
		referenceTier: 'value',
		canonicalKey: 'OV001637175776',
		propertyKey: 'P001637',
		name: 'Yankunytjatjara',
		domainId: 'C200010',
		domainName: 'Person',
		domainDefinition: 'An individual about whom information is collected.',
		propertyName: 'Language Type',
		propertyDefinition: 'The specific language or dialect used by the person.',
		rangeOptionSetId: 'OS001637',
		rangeOptionSetName: 'Language',
		valueKey: 'OV001637175776',
		valueName: 'Yankunytjatjara',
		valueNotation: '1638',
	});
	harness.equal('shape-fidelity E: no error', observed.err, '');
	harness.equal('shape-fidelity E: passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('shape-fidelity E: value.owningPropertyKey binds the owning scope', observed.presentation.value.owningPropertyKey, 'P001637');
	harness.equal('shape-fidelity E: value.owningOptionSetId binds the owning scope', observed.presentation.value.owningOptionSetId, 'OS001637');
	harness.equal('shape-fidelity E: valueKey is read DIRECTLY off the card (never recovered from canonicalKey)', observed.presentation.value.valueKey, 'OV001637175776');
	harness.equal('shape-fidelity E: the OWNING property\'s meaning rides in the property group', observed.presentation.property.propertyName, 'Language Type');
	harness.equal('shape-fidelity E: value prose rides in the value context', observed.presentation.value.valueName, 'Yankunytjatjara');
	harness.equal('shape-fidelity E: valueNotation rides in the value context', observed.presentation.value.valueNotation, '1638');
	harness.ok(
		'shape-fidelity E: a valueDefinition the card did not carry stays ABSENT (never \'\', SPEC §1.3)',
		observed.presentation.value.valueDefinition === undefined,
	);
	harness.ok('shape-fidelity E: NO retired fields (SPEC §1.6)', retiredFieldsAbsent(observed.presentation));
})();

// REFUSAL TWINS — the SPEC §6 refusals, refused BY NAME (naming the card's canonicalKey), never
// defaulted, never recovered by a map lookup or a name parse.
(() => {
	const observed = hubCallWith({
		referenceTier: 'property',
		canonicalKey: 'P000104',
		propertyKey: 'P000104',
		name: 'Staff Evaluation Score or Rating',
		domainId: 'C200366',
		// domainName MISSING — a REQUIRED meaning field
		propertyName: 'Staff Evaluation Score or Rating',
		rangeDatatype: 'string',
	});
	harness.match('refusal twin: a card with no domainName is refused BY NAME, naming the card', observed.err, /candidate 'P000104' carries no domainName/);
	harness.ok('refusal twin: no presentation is produced', observed.presentation === undefined);
})();
(() => {
	const observed = hubCallWith({
		referenceTier: 'property',
		canonicalKey: 'P600502',
		propertyKey: 'P600502',
		name: 'Has Organization Identifier',
		domainId: 'C200239',
		domainName: 'Organization',
		propertyName: 'Has Organization Identifier',
		rangeClassId: 'C200252',
		qualifierKeys: ['OV_federalSchoolCode', 'OV_anotherQualifier'],
		qualifierNames: ['Federal School Code'], // length 1 vs 2 — the lists are positionally parallel
	});
	harness.match(
		'refusal twin: qualifierKeys/qualifierNames length mismatch is refused BY NAME',
		observed.err,
		/candidate 'P600502'.*2 qualifierKeys but 1 qualifierNames/,
	);
})();
(() => {
	const observed = hubCallWith({
		referenceTier: 'value',
		canonicalKey: 'OV001637175776',
		propertyKey: 'P001637',
		name: 'Yankunytjatjara',
		domainId: 'C200010',
		domainName: 'Person',
		propertyName: 'Language Type',
		rangeOptionSetId: 'OS001637',
		// valueKey MISSING — never recovered from canonicalKey anymore
	});
	harness.match(
		'refusal twin: a value-tier card with no valueKey is refused BY NAME (no canonicalKey recovery)',
		observed.err,
		/candidate 'OV001637175776'.*missing valueKey\/propertyKey\/rangeOptionSetId.*valueKey=undefined/,
	);
})();

harness.report();
