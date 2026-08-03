#!/usr/bin/env node
'use strict';

// test-evidenceContracts.js — hermetic gate for apps/graph-builder/apps/bridge-maker/lib/evidenceContracts.js
// (bridgeEvidenceRefactor-spec.md §4/§7, P1 deliverable). For EVERY one of the six contracts (evidence
// package, match/compose, hub module, renderer, select, normalizer) PLUS the ⟪A6⟫ freeze additions:
// a GREEN case (a conforming fixture passes) and RED fault twins (each declared refusal condition
// actually refuses, BY NAME). A guard never seen failing is unproven (the doctrine test-interfaces.js
// and test-bridgeSkeleton.js already apply in this tree) — every RED here is a real call into the
// real gate function, never asserted by inspection.
//
// Hermetic throughout: no Docker, no Neo4j, no LLM, no network. Every fixture is an in-memory double.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-evidenceContracts.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the six bridge evidence-package contracts (evidenceContracts.js)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     For each of the six P1 contracts (evidence package, match/compose, hub module, renderer, select,
     normalizer) plus the freeze additions: proves a conforming fixture passes (GREEN) and proves every
     declared refusal condition actually refuses, by name (RED). Includes a contract-level renderer
     byte-stability proof: two identical calls to a conforming renderer double produce identical bytes,
     and a nondeterministic double is caught failing.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const {
	CONTRACT_STATUS,
	EVIDENCE_CONTRACTS,
	evidencePackageViolation,
	candidateEvidenceViolation,
	MATCH_COMPOSE_SHAPE,
	MATCH_COMPOSE_OBLIGATIONS,
	matchComposeCallableViolation,
	matchComposeResultViolation,
	HUB_MODULE_SHAPE,
	RETIRED_TUPLE_EVIDENCE_FIELDS,
	hubModuleCallableViolation,
	hubModulePresentationViolation,
	RENDERER_SHAPE,
	rendererModuleViolation,
	rendererDeterminismViolation,
	SELECT_SHAPE,
	SELECT_CATEGORY_ENUM,
	selectShapeViolation,
	selectResultViolation,
	NORMALIZER_SHAPE,
	normalizerShapeViolation,
	normalizerDeterminismViolation,
	DECISION_BLOCK_FREEZE_ADDITIONS,
	freezeAdditionsViolation,
} = require('../lib/evidenceContracts');

// =====================================================================
// FIXTURES — conforming (GREEN) building blocks reused across sections.
// =====================================================================

// ⟪hubReimplementation P3 (SPEC §6)⟫ the MEANING-revision fixtures: singular `domain` group with its
// name (and definition prose), the `property` meaning group, qualifierNames ALWAYS an array. The
// retired fields (domains[]/domainsComplete/qualifier) appear ONLY in oldShapeBaseTuple below, which
// exists to be refused.
const conformingBaseTupleShapeA = () => ({
	referenceTier: 'property',
	canonicalKey: 'P000104',
	propertyKey: 'P000104',
	name: 'Staff Evaluation Score or Rating',
	domain: {
		domainId: 'C200366',
		domainName: 'Staff Evaluation',
		domainDefinition: 'Information about the evaluation of a staff member.',
	},
	property: {
		propertyName: 'Staff Evaluation Score or Rating',
		propertyDefinition: 'The score or rating resulting from an evaluation of a staff member.',
	},
	range: { shape: 'datatype', rangeDatatype: 'string', rangeClassId: null, rangeOptionSetId: null },
	isQualified: false,
	qualifierNames: [],
	value: null,
});

const conformingBaseTupleShapeD = () => ({
	referenceTier: 'property',
	canonicalKey: 'P600502',
	propertyKey: 'P600502',
	name: 'Has Organization Identifier',
	domain: {
		domainId: 'C200239',
		domainName: 'Organization',
		domainDefinition: 'Information about an organization.',
	},
	property: {
		propertyName: 'Has Organization Identifier',
		propertyDefinition: 'A reference to an identification code assigned to the organization.',
	},
	range: { shape: 'class', rangeClassId: 'C200252', rangeClassName: 'Identification Code', rangeOptionSetId: null, rangeDatatype: null },
	isQualified: true,
	qualifierNames: ['Provided by an internal assessment service'],
	value: null,
});

const conformingBaseTupleShapeE = () => ({
	referenceTier: 'value',
	canonicalKey: 'OV001637175776',
	propertyKey: 'P001637',
	name: 'Twelfth grade',
	domain: {
		domainId: 'C200010',
		domainName: 'Person',
		domainDefinition: 'Information about a person.',
	},
	property: {
		propertyName: 'Grade Level',
		propertyDefinition: 'The grade level or primary instructional level of the person.',
	},
	range: {
		shape: 'optionSet',
		rangeOptionSetId: 'OS001637',
		rangeOptionSetName: 'Grade Level Option Set',
		rangeOptionSetDefinition: 'The set of grade-level option values.',
		rangeDatatype: null,
		rangeClassId: null,
	},
	isQualified: false,
	qualifierNames: [],
	value: { valueKey: 'OV001637175776', owningPropertyKey: 'P001637', owningOptionSetId: 'OS001637', valueName: 'Twelfth grade' },
});

// oldShapeBaseTuple — the RETIRED presentation shape (domains[]/domainsComplete/nullable qualifier),
// exactly what a stale hub module or a pre-P3 fixture would still emit. It exists to be REFUSED — by
// hubModulePresentationViolation directly, and by candidateEvidenceViolation at the ⟪A3⟫ seam.
const oldShapeBaseTuple = () => ({
	referenceTier: 'property',
	canonicalKey: 'P000104',
	propertyKey: 'P000104',
	name: 'Staff Evaluation Score or Rating',
	domains: [{ domainId: 'C200366', domainName: 'Staff Evaluation' }],
	domainsComplete: true,
	range: { shape: 'datatype', rangeDatatype: 'string', rangeClassId: null, rangeOptionSetId: null },
	isQualified: false,
	qualifier: null,
	value: null,
});

const conformingCandidateEvidence = (overrides = {}) => ({
	candidate: { stableId: 'src:P600253', canonicalKey: 'P600253', name: 'Has LEA Title I Support Service' },
	cosine: 0.83,
	considerations: { tuple: conformingBaseTupleShapeA(), notes: [] },
	...overrides,
});

const conformingEvidencePackage = () => ({
	// ⟪SOURCE-PRESENCE HARDENING, 2026-07-31⟫ a conforming package CARRIES ITS SOURCE.
	sourceElement: { name: 'Local Education Agency Identifier', defText: 'the id of an LEA' },
	pool: [
		conformingCandidateEvidence(),
		conformingCandidateEvidence({
			candidate: { stableId: 'src:P600188', canonicalKey: 'P600188', name: 'Local Education Agency' },
			cosine: 0.41,
			considerations: { tuple: conformingBaseTupleShapeA(), notes: ['shares the owning-class term'] },
			nomination: { nominatedBy: 'caseStructuralBridge', rationale: 'owning-class term match' },
		}),
	],
	promptSegments: ['Judge CASE structural matches by owning-class term overlap, not surface wording.'],
});

// =====================================================================
harness.section('DECLARATION — every contract carries the ⟪A8⟫ HARDENED status marker (P4)');
// =====================================================================

harness.equal(
	'CONTRACT_STATUS is the literal HARDENED marker, riders R-a/R-b recorded',
	CONTRACT_STATUS,
	'HARDENED — public-ready as of the P3 boundary review (2026-07-29), riders R-a (llmClient live-wired, P4) ' +
		'and R-b (category/rationale/normalizedConfidence ride in frozenEvidence.judgment, not first-class fields) recorded.',
);
harness.ok('CONTRACT_STATUS names rider R-a', CONTRACT_STATUS.includes('R-a'));
harness.ok('CONTRACT_STATUS names rider R-b', CONTRACT_STATUS.includes('R-b'));

harness.equal(
	'EVIDENCE_CONTRACTS declares exactly the six contracts',
	Object.keys(EVIDENCE_CONTRACTS).sort().join(','),
	'evidencePackage,hubModule,matchCompose,normalizer,renderer,select',
);

Object.keys(EVIDENCE_CONTRACTS).forEach((oneContractName) => {
	harness.equal(
		`${oneContractName}.status === CONTRACT_STATUS`,
		EVIDENCE_CONTRACTS[oneContractName].status,
		CONTRACT_STATUS,
	);
});

harness.ok(
	'select and normalizer share ONE category enum (no drift between the two contracts)',
	EVIDENCE_CONTRACTS.select.categoryEnum === SELECT_CATEGORY_ENUM,
	'the two contracts declared separate enum arrays',
);

// =====================================================================
harness.section('1. EVIDENCE PACKAGE — GREEN then RED, by name (⟪A3⟫ shape gate)');
// =====================================================================

harness.equal('GREEN: a conforming evidence package passes', evidencePackageViolation(conformingEvidencePackage()), '');

harness.match(
	'RED: missing candidate is caught, named',
	evidencePackageViolation({ sourceElement: { name: 's' }, pool: [conformingCandidateEvidence({ candidate: undefined })], promptSegments: [] }),
	/pool\[0\]: missing candidate/,
);
harness.match(
	'RED: non-numeric cosine is caught, named',
	evidencePackageViolation({ sourceElement: { name: 's' }, pool: [conformingCandidateEvidence({ cosine: 'high' })], promptSegments: [] }),
	/pool\[0\]: cosine is not a finite number/,
);
harness.match(
	'RED: considerations missing tuple is caught, named',
	evidencePackageViolation({
		sourceElement: { name: 's' },
		pool: [conformingCandidateEvidence({ considerations: { tuple: null, notes: [] } })],
		promptSegments: [],
	}),
	/pool\[0\]: considerations\.tuple is missing/,
);
// ⟪hubReimplementation P3 (SPEC §6)⟫ the ⟪A3⟫ seam now proves the tuple's OWN shape, not merely its
// presence — an old-shape or meaning-less tuple is refused at the seam, naming the tuple violation.
harness.match(
	'RED (⟪A3⟫): a pool entry whose considerations.tuple is OLD-SHAPE is refused by candidateEvidenceViolation, naming the tuple violation',
	candidateEvidenceViolation(conformingCandidateEvidence({ considerations: { tuple: oldShapeBaseTuple(), notes: [] } }), 0),
	/pool\[0\]: considerations\.tuple fails the meaning contract — .*carries retired field 'domains'/,
);
harness.match(
	'RED (⟪A3⟫): a MEANING-LESS tuple (no domain group) in the pool is refused at the whole-package seam by evidencePackageViolation',
	evidencePackageViolation({
		sourceElement: { name: 's' },
		pool: [
			conformingCandidateEvidence({
				considerations: {
					tuple: (() => {
						const tuple = conformingBaseTupleShapeA();
						delete tuple.domain;
						return tuple;
					})(),
					notes: [],
				},
			}),
		],
		promptSegments: [],
	}),
	/pool\[0\]: considerations\.tuple fails the meaning contract — .*domain is missing/,
);
harness.match(
	'RED: considerations.notes not an array is caught, named',
	evidencePackageViolation({
		sourceElement: { name: 's' },
		pool: [conformingCandidateEvidence({ considerations: { tuple: conformingBaseTupleShapeA(), notes: 'not an array' } })],
		promptSegments: [],
	}),
	/pool\[0\]: considerations\.notes is not an array/,
);
harness.match(
	'RED: a malformed nomination (missing rationale) is caught, named',
	evidencePackageViolation({
		sourceElement: { name: 's' },
		pool: [conformingCandidateEvidence({ nomination: { nominatedBy: 'someBridge' } })],
		promptSegments: [],
	}),
	/pool\[0\]: nomination is present but malformed/,
);
harness.match(
	'RED: promptSegments not an array is caught, named',
	evidencePackageViolation({ sourceElement: { name: 's' }, pool: [], promptSegments: 'not an array' }),
	/evidencePackage: promptSegments is not an array/,
);
harness.match(
	'RED: promptSegments with a non-string entry is caught, named',
	evidencePackageViolation({ sourceElement: { name: 's' }, pool: [], promptSegments: ['fine', 42] }),
	/evidencePackage: promptSegments contains a non-string entry/,
);
harness.match(
	'RED: promptSegments NOT deduped is caught (⟪A2⟫)',
	evidencePackageViolation({ sourceElement: { name: 's' }, pool: [], promptSegments: ['same instruction', 'same instruction'] }),
	/promptSegments contains duplicate entries/,
);
harness.match(
	'RED: a per-candidate segment SMUGGLED into promptSegments is caught, naming the token (⟪A2⟫)',
	evidencePackageViolation({
		sourceElement: { name: 's' },
		pool: [conformingCandidateEvidence({ candidate: { stableId: 'src:P600253', canonicalKey: 'P600253', name: 'x' } })],
		promptSegments: ['This segment specifically discusses P600253 and nothing else.'],
	}),
	/references candidate-specific token 'P600253'/,
);
harness.equal(
	'GREEN (twin): the same segment text with NO matching candidate token in the pool passes',
	evidencePackageViolation({
		sourceElement: { name: 's' },
		pool: [conformingCandidateEvidence({ candidate: { stableId: 'src:P999999', canonicalKey: 'P999999', name: 'y' } })],
		promptSegments: ['A generic global instruction mentioning nothing candidate-specific.'],
	}),
	'',
);

// =====================================================================
harness.section('2. MATCH/COMPOSE — GREEN then RED (callable shape + result === evidence package)');
// =====================================================================

harness.equal(
	'MATCH_COMPOSE_SHAPE declares arity 2 (named-arg object + callback) and the four argKeys — already callback-shaped, unchanged by the TQ ruling',
	`${MATCH_COMPOSE_SHAPE.arity}|${MATCH_COMPOSE_SHAPE.argKeys.join(',')}`,
	'2|sourceElement,candidateElements,graphReader,hubModule',
);

const conformingComposer = ({ sourceElement, candidateElements, graphReader, hubModule }, callback) => {
	void sourceElement;
	void candidateElements;
	void graphReader;
	void hubModule;
	callback('', conformingEvidencePackage());
};
harness.equal(
	'GREEN: a conforming composer callable passes the callable-shape gate',
	matchComposeCallableViolation(conformingComposer, 'conformingComposer'),
	'',
);
(() => {
	let observed = null;
	conformingComposer({ sourceElement: {}, candidateElements: [], graphReader: {}, hubModule: () => {} }, (err, result) => {
		observed = { err, result };
	});
	harness.equal('GREEN: the conforming composer calls back with no error', observed.err, '');
	harness.equal(
		'GREEN: its result passes matchComposeResultViolation (== evidencePackageViolation)',
		matchComposeResultViolation(observed.result),
		'',
	);
})();

harness.match(
	'RED: a positional (arity-3) composer callable is caught, naming it',
	matchComposeCallableViolation((sourceElement, candidateElements, callback) => callback(''), 'positionalComposer'),
	/positionalComposer takes 3 argument/,
);
harness.match(
	'RED: a composer that never reads a declared key is caught, naming it',
	matchComposeCallableViolation(({ sourceElement, candidateElements, graphReader }, callback) => callback(''), 'renamedComposer'),
	/renamedComposer never reads.*hubModule/,
);

const smugglingComposer = (spec, callback) => {
	void spec;
	callback('', {
		sourceElement: { name: 's' },
		pool: [conformingCandidateEvidence({ candidate: { stableId: 'src:P600253', canonicalKey: 'P600253', name: 'x' } })],
		promptSegments: ['This global note is really about P600253 specifically.'],
	});
};
(() => {
	let observed = null;
	smugglingComposer({}, (err, result) => {
		observed = { err, result };
	});
	harness.match(
		'RED: a composer double smuggling a per-candidate segment into promptSegments is caught by matchComposeResultViolation',
		matchComposeResultViolation(observed.result),
		/references candidate-specific token 'P600253'/,
	);
})();

harness.ok(
	'MATCH_COMPOSE_OBLIGATIONS declares freeze-what-you-gather and the dependency-scoped walk (⟪A5⟫), as data',
	MATCH_COMPOSE_OBLIGATIONS.length === 2 &&
		/freezeWhatYouGather/.test(MATCH_COMPOSE_OBLIGATIONS[0]) &&
		/graphWalkScopeIsDeclaredDependencyGraph/.test(MATCH_COMPOSE_OBLIGATIONS[1]),
	`got: ${JSON.stringify(MATCH_COMPOSE_OBLIGATIONS)}`,
);

// =====================================================================
harness.section('3. HUB MODULE — GREEN then RED (R5 tuple presentation, hubReimplementation P3 MEANING contract, SPEC §6)');
// =====================================================================

harness.equal(
	'HUB_MODULE_SHAPE declares arity 2 (candidate, callback), positional (argKeys null) — TQ ruling 2026-07-29',
	`${HUB_MODULE_SHAPE.arity}|${HUB_MODULE_SHAPE.argKeys}`,
	'2|null',
);

const conformingHubModule = (candidate, callback) => {
	void candidate;
	callback('', conformingBaseTupleShapeA());
};
harness.equal('GREEN: a conforming callback-shaped hub module callable passes', hubModuleCallableViolation(conformingHubModule, 'ceds'), '');
harness.match(
	'RED: a bare-return (arity 1, no callback) hub module is caught, naming it (the pre-ruling shape)',
	hubModuleCallableViolation((candidate) => conformingBaseTupleShapeA(), 'noCallbackHub'),
	/noCallbackHub takes 1 argument/,
);
harness.match(
	'RED: an over-arity (arity 3) hub module is caught, naming it',
	hubModuleCallableViolation((candidate, extra, callback) => callback(''), 'wrongArityHub'),
	/wrongArityHub takes 3 argument/,
);
(() => {
	let observed = null;
	conformingHubModule({ canonicalKey: 'P000104' }, (err, presentation) => {
		observed = { err, presentation };
	});
	harness.equal('GREEN: the conforming hub module calls back with no error', observed.err, '');
	harness.equal(
		'GREEN: its callback-delivered presentation passes hubModulePresentationViolation',
		hubModulePresentationViolation(observed.presentation),
		'',
	);
})();

harness.equal('GREEN: Shape A (scalar datatype) presentation passes', hubModulePresentationViolation(conformingBaseTupleShapeA()), '');
harness.equal('GREEN: Shape D (qualified) presentation passes', hubModulePresentationViolation(conformingBaseTupleShapeD()), '');
harness.equal('GREEN: Shape E (value tier) presentation passes', hubModulePresentationViolation(conformingBaseTupleShapeE()), '');

// ---- the RETIRED old-shape fields are refused ON SIGHT, one RED per retired field (SPEC §6) ----
harness.equal(
	'RETIRED_TUPLE_EVIDENCE_FIELDS declares exactly the three old-shape fields',
	RETIRED_TUPLE_EVIDENCE_FIELDS.join(','),
	'domains,domainsComplete,qualifier',
);
harness.match(
	"RED: retired field 'domains' still present is refused BY NAME",
	hubModulePresentationViolation({ ...conformingBaseTupleShapeA(), domains: [{ domainId: 'C200366', domainName: 'Staff Evaluation' }] }),
	/carries retired field 'domains'/,
);
harness.match(
	"RED: retired field 'domainsComplete' still present is refused BY NAME",
	hubModulePresentationViolation({ ...conformingBaseTupleShapeA(), domainsComplete: true }),
	/carries retired field 'domainsComplete'/,
);
harness.match(
	"RED: retired field 'qualifier' still present is refused BY NAME — even null-valued (the old nullable shape)",
	hubModulePresentationViolation({ ...conformingBaseTupleShapeA(), qualifier: null }),
	/carries retired field 'qualifier'/,
);
harness.match(
	'RED: the complete OLD-SHAPE presentation (a stale hub module\'s whole output) is refused, never rendered',
	hubModulePresentationViolation(oldShapeBaseTuple()),
	/carries retired field/,
);
// ---- the MEANING fields: domain group, property group (SPEC §6) ----
harness.match(
	'RED: a missing domain group is caught, naming the singular domain requirement',
	(() => {
		const evidence = conformingBaseTupleShapeA();
		delete evidence.domain;
		return hubModulePresentationViolation(evidence);
	})(),
	/domain is missing.*singular domain group/,
);
harness.match(
	'RED: a domain group without domainId is caught',
	hubModulePresentationViolation({ ...conformingBaseTupleShapeA(), domain: { domainName: 'Staff Evaluation' } }),
	/domain\.domainId is missing/,
);
harness.match(
	'RED: a domain group without domainName is caught — a REQUIRED meaning field, the old id-only shape refused',
	hubModulePresentationViolation({ ...conformingBaseTupleShapeA(), domain: { domainId: 'C200366' } }),
	/domain\.domainName is missing.*REQUIRED meaning field/,
);
harness.match(
	"RED: an ''-valued domainDefinition is caught — absent must stay absent, never ''",
	hubModulePresentationViolation({
		...conformingBaseTupleShapeA(),
		domain: { domainId: 'C200366', domainName: 'Staff Evaluation', domainDefinition: '' },
	}),
	/domain\.domainDefinition is present but not a non-empty string/,
);
harness.match(
	'RED: a missing property group is caught, naming the property-slot meaning group',
	(() => {
		const evidence = conformingBaseTupleShapeA();
		delete evidence.property;
		return hubModulePresentationViolation(evidence);
	})(),
	/property is missing.*property-slot meaning group/,
);
harness.match(
	'RED: a property group without propertyName is caught — a REQUIRED meaning field',
	hubModulePresentationViolation({ ...conformingBaseTupleShapeA(), property: { propertyDefinition: 'prose without a name' } }),
	/property\.propertyName is missing.*REQUIRED meaning field/,
);
harness.match(
	"RED: an ''-valued propertyDefinition is caught — absent must stay absent, never ''",
	hubModulePresentationViolation({
		...conformingBaseTupleShapeA(),
		property: { propertyName: 'Staff Evaluation Score or Rating', propertyDefinition: '' },
	}),
	/property\.propertyDefinition is present but not a non-empty string/,
);
// ---- range: the XOR rules are unchanged; prose extras (rangeClassName etc.) already ride in the
// GREEN Shape D/E fixtures above ----
harness.match(
	'RED: two range fields set at once is caught, naming the mutual exclusivity (SPEC §1.1, G-12)',
	hubModulePresentationViolation({
		...conformingBaseTupleShapeA(),
		range: { shape: 'datatype', rangeDatatype: 'string', rangeClassId: 'C200196', rangeOptionSetId: null },
	}),
	/range\.rangeClassId is also set.*mutually exclusive/,
);
harness.match(
	'RED: range.shape not one of the three enum values is caught',
	hubModulePresentationViolation({ ...conformingBaseTupleShapeA(), range: { shape: 'bogus' } }),
	/range\.shape must be one of datatype, class, optionSet/,
);
// ---- qualifierNames: ALWAYS an array of non-empty strings, consistent with isQualified (SPEC §6) ----
harness.match(
	'RED: qualifierNames not an array (a bare string) is caught',
	hubModulePresentationViolation({ ...conformingBaseTupleShapeD(), qualifierNames: 'Provided by an internal assessment service' }),
	/qualifierNames must be an array/,
);
harness.match(
	'RED: qualifierNames containing an empty-string entry is caught',
	hubModulePresentationViolation({ ...conformingBaseTupleShapeD(), qualifierNames: [''] }),
	/qualifierNames contains a non-string or empty entry/,
);
harness.match(
	'RED: isQualified=true with EMPTY qualifierNames is caught — canonicalKey alone is ambiguous once qualified',
	hubModulePresentationViolation({ ...conformingBaseTupleShapeD(), qualifierNames: [] }),
	/isQualified is true but qualifierNames is empty.*ambiguous once qualified/,
);
harness.match(
	'RED: isQualified=false with NON-EMPTY qualifierNames is caught (ambiguous self-description)',
	hubModulePresentationViolation({ ...conformingBaseTupleShapeA(), qualifierNames: ['Stray Qualifier Name'] }),
	/isQualified is false but qualifierNames is non-empty/,
);
harness.match(
	'RED: referenceTier=value with no value context is caught, naming P0 §2.6 non-uniqueness',
	hubModulePresentationViolation({ ...conformingBaseTupleShapeE(), value: null }),
	/value context.*is missing.*NOT unique across properties/,
);
harness.match(
	'RED: referenceTier=property with a value object present is caught (self-contradictory)',
	hubModulePresentationViolation({ ...conformingBaseTupleShapeA(), value: { valueKey: 'x', owningPropertyKey: 'y', owningOptionSetId: 'z' } }),
	/value context belongs only to referenceTier=value/,
);

// =====================================================================
harness.section('4. RENDERER — GREEN then RED (⟪A2⟫ named pure component + byte-stability)');
// =====================================================================

harness.equal(
	'RENDERER_SHAPE declares arity 4 (evidencePackages, promptSegments, config, callback), positional — TQ ruling 2026-07-29',
	`${RENDERER_SHAPE.arity}|${RENDERER_SHAPE.argKeys}`,
	'4|null',
);

const conformingRendererModule = {
	render: (evidencePackages, promptSegments, config, callback) =>
		callback('', JSON.stringify({ evidencePackages, promptSegments, config })),
	RENDERER_VERSION: 'renderer-v1',
};
harness.equal(
	'GREEN: a conforming callback-shaped renderer module passes',
	rendererModuleViolation(conformingRendererModule, 'conformingRenderer'),
	'',
);

harness.match(
	'RED: a renderer module with no RENDERER_VERSION is caught',
	rendererModuleViolation({ render: conformingRendererModule.render }, 'noVersionRenderer'),
	/noVersionRenderer\.RENDERER_VERSION: missing or empty/,
);
harness.match(
	'RED: a bare-return (arity 3, no callback) renderer is caught, naming it (the pre-ruling shape)',
	rendererModuleViolation(
		{ render: (a, b, c) => `${a}${b}${c}`, RENDERER_VERSION: 'v1' },
		'noCallbackRenderer',
	),
	/noCallbackRenderer\.render takes 3 argument/,
);
harness.match(
	'RED: an over-arity (arity 5) renderer is caught, naming it',
	rendererModuleViolation({ render: (a, b, c, d, callback) => callback(''), RENDERER_VERSION: 'v1' }, 'wrongArityRenderer'),
	/wrongArityRenderer\.render takes 5 argument/,
);

harness.equal(
	'GREEN: two identical calls to the conforming callback-shaped renderer double deliver IDENTICAL bytes',
	rendererDeterminismViolation(conformingRendererModule.render, conformingEvidencePackage(), ['seg'], { budget: 10 }),
	'',
);

let nondeterministicCallCount = 0;
const nondeterministicRender = (evidencePackages, promptSegments, config, callback) => {
	void evidencePackages;
	void promptSegments;
	void config;
	nondeterministicCallCount += 1;
	callback('', `render-output-${nondeterministicCallCount}`);
};
harness.match(
	'RED: a NONDETERMINISTIC callback-shaped renderer double is caught by rendererDeterminismViolation',
	rendererDeterminismViolation(nondeterministicRender, conformingEvidencePackage(), ['seg'], {}),
	/two calls with IDENTICAL inputs delivered DIFFERENT output/,
);
harness.match(
	'RED: a renderer double that calls back with an error is caught, naming it',
	rendererDeterminismViolation(
		(evidencePackages, promptSegments, config, callback) => callback('boom'),
		conformingEvidencePackage(),
		['seg'],
		{},
	),
	/renderer: first call's callback reported an error: boom/,
);

// =====================================================================
harness.section('5. SELECT — GREEN then RED (⟪A4⟫ discrete category, never a fabricated float)');
// =====================================================================

harness.equal(
	'SELECT_SHAPE declares arity 3 (renderedPromptOrPackage, llmClient, callback), positional — already callback-shaped, unchanged by the TQ ruling',
	`${SELECT_SHAPE.arity}|${SELECT_SHAPE.argKeys}`,
	'3|null',
);
harness.equal(
	'SELECT_CATEGORY_ENUM is exactly the four discrete verdicts',
	SELECT_CATEGORY_ENUM.join(','),
	'strong,moderate,weakButReal,none',
);

const conformingSelect = (renderedPromptOrPackage, llmClient, callback) => {
	void renderedPromptOrPackage;
	void llmClient;
	callback('', { abstain: false, pick: { stableId: 'src:P600253' }, category: 'strong', rationale: 'definitions align exactly' });
};
harness.equal('GREEN: a conforming select callable passes the arity gate', selectShapeViolation(conformingSelect, 'conformingSelect'), '');
harness.match(
	'RED: a select callable with the wrong arity is caught, naming it',
	selectShapeViolation((renderedPromptOrPackage, callback) => callback(''), 'wrongAritySelect'),
	/wrongAritySelect takes 2 argument/,
);

harness.equal(
	'GREEN: a non-abstaining conforming result passes selectResultViolation',
	selectResultViolation({ abstain: false, pick: { stableId: 'x' }, category: 'strong', rationale: 'defs align' }),
	'',
);
harness.equal(
	'GREEN: an abstaining conforming result passes selectResultViolation',
	selectResultViolation({ abstain: true, pick: null, category: 'none', rationale: 'no candidate matches the definition' }),
	'',
);
harness.match(
	'RED: a non-enum category is caught BY NAME, listing the four legal values (⟪A4⟫)',
	selectResultViolation({ abstain: false, pick: { stableId: 'x' }, category: 0.87, rationale: 'a fabricated float, not a category' }),
	/category must be one of strong, moderate, weakButReal, none/,
);
harness.match(
	'RED: a missing rationale is caught',
	selectResultViolation({ abstain: false, pick: { stableId: 'x' }, category: 'strong', rationale: '' }),
	/rationale \(non-empty string\) is missing/,
);
harness.match(
	'RED: abstain=true with a pick set is caught (mutually exclusive)',
	selectResultViolation({ abstain: true, pick: { stableId: 'x' }, category: 'none', rationale: 'inconsistent' }),
	/abstain is true but pick is set/,
);
harness.match(
	'RED: abstain=false with no pick is caught',
	selectResultViolation({ abstain: false, pick: null, category: 'strong', rationale: 'inconsistent' }),
	/abstain is false but pick is missing/,
);

// =====================================================================
harness.section('6. NORMALIZER — GREEN then RED (⟪A4⟫ deterministic, f(category, cosine, context))');
// =====================================================================

harness.equal(
	'NORMALIZER_SHAPE declares arity 4 (category, retrievalCosine, context, callback), positional — TQ ruling 2026-07-29',
	`${NORMALIZER_SHAPE.arity}|${NORMALIZER_SHAPE.argKeys}`,
	'4|null',
);

const conformingNormalizer = (category, retrievalCosine, context, callback) => {
	void category;
	void context;
	callback('', retrievalCosine);
};
harness.equal(
	'GREEN: a conforming callback-shaped normalizer callable passes the arity gate',
	normalizerShapeViolation(conformingNormalizer, 'conformingNormalizer'),
	'',
);
harness.match(
	'RED: a bare-return (arity 3, no callback) normalizer is caught, naming it (the pre-ruling shape)',
	normalizerShapeViolation((category, retrievalCosine, context) => retrievalCosine, 'noCallbackNormalizer'),
	/noCallbackNormalizer takes 3 argument/,
);
harness.match(
	'RED: an over-arity (arity 5) normalizer is caught, naming it',
	normalizerShapeViolation((category, retrievalCosine, context, extra, callback) => callback(''), 'wrongArityNormalizer'),
	/wrongArityNormalizer takes 5 argument/,
);

harness.equal(
	'GREEN: two identical calls to the conforming callback-shaped normalizer deliver the SAME number',
	normalizerDeterminismViolation(conformingNormalizer, 'strong', 0.91, {}),
	'',
);

let nondeterministicNormalizerCallCount = 0;
const nondeterministicNormalizer = (category, retrievalCosine, context, callback) => {
	void category;
	void context;
	nondeterministicNormalizerCallCount += 1;
	callback('', retrievalCosine + nondeterministicNormalizerCallCount * 0.0001);
};
harness.match(
	'RED: a NONDETERMINISTIC callback-shaped normalizer double is caught by normalizerDeterminismViolation',
	normalizerDeterminismViolation(nondeterministicNormalizer, 'strong', 0.91, {}),
	/two calls with IDENTICAL inputs delivered DIFFERENT confidence/,
);
harness.match(
	'RED: a normalizer double that calls back with an error is caught, naming it',
	normalizerDeterminismViolation((category, retrievalCosine, context, callback) => callback('boom'), 'strong', 0.91, {}),
	/normalizer: first call's callback reported an error: boom/,
);

// =====================================================================
harness.section('PLUS — ⟪A6⟫ FREEZE ADDITIONS: the decision-block self-description fields');
// =====================================================================

harness.equal(
	'DECISION_BLOCK_FREEZE_ADDITIONS is exactly the three self-describing fields',
	DECISION_BLOCK_FREEZE_ADDITIONS.join(','),
	'generation,rendererVersion,frozenEvidence',
);

const conformingDecisionBlock = () => ({
	generation: 'gen-2026-07-29T00:00:00Z',
	rendererVersion: 'renderer-v1',
	frozenEvidence: conformingEvidencePackage(),
});
harness.equal('GREEN: a conforming decision block passes freezeAdditionsViolation', freezeAdditionsViolation(conformingDecisionBlock()), '');

harness.match(
	'RED: a decision block missing rendererVersion is caught, naming it',
	freezeAdditionsViolation((() => {
		const block = conformingDecisionBlock();
		delete block.rendererVersion;
		return block;
	})()),
	/missing self-describing field\(s\): rendererVersion/,
);
harness.match(
	'RED: a decision block missing generation AND frozenEvidence is caught, naming BOTH',
	freezeAdditionsViolation((() => {
		const block = conformingDecisionBlock();
		delete block.generation;
		delete block.frozenEvidence;
		return block;
	})()),
	/missing self-describing field\(s\): generation, frozenEvidence/,
);
harness.match(
	'RED: an empty-string generation is caught (present but not truthy content)',
	freezeAdditionsViolation({ ...conformingDecisionBlock(), generation: '   ' }),
	/decisionBlock\.generation must be a non-empty string/,
);

harness.report();
