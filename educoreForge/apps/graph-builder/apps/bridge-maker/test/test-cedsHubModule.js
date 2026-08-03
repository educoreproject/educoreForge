#!/usr/bin/env node
'use strict';

// test-cedsHubModule.js — hermetic gate for lib.d/cedsHubModule.js (⟪hubReimplementation P3,
// 2026-08-03⟫ SPEC-hubReimplementation-080326.md §6). Proves, against the REAL
// hubModulePresentationViolation oracle (evidenceContracts.js — the contract gate IS the acceptance
// oracle, never this suite's own assertions):
//   RED  — call guards refuse BY NAME (missing candidate / referenceTier / canonicalKey / propertyKey
//          / name / domainId; zero or two range fields; missing domainName; missing propertyName;
//          qualifierKeys/qualifierNames parallelism violations; a value-tier candidate missing its
//          valueKey or owning scope) — and an OLD-SHAPE card (the retired ' [qualifier]' name-suffix
//          convention with no qualifierNames) is refused, never parsed.
//   GREEN — every worked card shape (scalar, class-range, option-set, qualified, value-tier) renders
//          a MEANING-carrying presentation (domain group, property group, range prose, value prose,
//          qualifierNames) that passes the REAL oracle; absent prose stays ABSENT (no key), never ''.
//
// Hermetic throughout: no Docker, no Neo4j, no LLM, no network — every candidate is a plain object,
// exactly the flattenFullRecord shape a real reimplemented HubReference :ForgedNode would produce.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-cedsHubModule.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the REAL CEDS hub module (lib.d/cedsHubModule.js)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves cedsHubModule's call guards (RED) and every reimplemented card shape's MEANING-carrying
     presentation (GREEN) against the REAL hubModulePresentationViolation oracle
     (SPEC-hubReimplementation-080326.md §6).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const cedsHubModuleFactory = require('../lib.d/cedsHubModule');
const { hubModulePresentationViolation } = require('../lib/evidenceContracts');

const hubModule = cedsHubModuleFactory();

const callWith = (candidate) => {
	let observed = null;
	hubModule(candidate, (err, presentation) => {
		observed = { err, presentation };
	});
	return observed;
};

// newShapeCard — one canonical NEW-shape property-tier card, spread-overridable per test. Carries the
// full MEANING group the reimplemented forge stamps (SPEC §1.3).
const newShapeCard = (overrides = {}) => ({
	referenceTier: 'property',
	canonicalKey: 'P001470',
	propertyKey: 'P001470',
	name: 'Rubric Criterion Description',
	domainId: 'C200354',
	domainName: 'Rubric Criterion',
	domainDefinition: 'Text describing a specific criterion within a rubric dimension.',
	propertyName: 'Rubric Criterion Description',
	propertyDefinition:
		'Text describing a criterion that must be met to demonstrate quality for a product, process, or performance task.',
	rangeDatatype: 'string',
	...overrides,
});

// =====================================================================
// RED — call guards
// =====================================================================
harness.section('RED — call guards refuse BY NAME');

harness.match('missing candidate', callWith(null).err, /candidate is missing or not an object/);
harness.match(
	'missing/bad referenceTier',
	callWith(newShapeCard({ referenceTier: 'qualified' })).err,
	/referenceTier must be 'property' or 'value'/,
);
harness.match(
	'missing canonicalKey',
	callWith(newShapeCard({ canonicalKey: undefined })).err,
	/candidate.canonicalKey is missing/,
);
harness.match(
	'missing propertyKey — refusal NAMES the card',
	callWith(newShapeCard({ propertyKey: undefined })).err,
	/candidate 'P001470': propertyKey is missing/,
);
harness.match(
	'missing name — refusal NAMES the card',
	callWith(newShapeCard({ name: undefined })).err,
	/candidate 'P001470': name is missing/,
);
harness.match(
	'missing domainId — refusal NAMES the card',
	callWith(newShapeCard({ domainId: undefined })).err,
	/candidate 'P001470': domainId is missing/,
);
harness.match(
	'ZERO range fields present',
	callWith(newShapeCard({ rangeDatatype: undefined })).err,
	/candidate carries 0 range field\(s\)/,
);
harness.match(
	'TWO range fields present',
	callWith(newShapeCard({ rangeClassId: 'C200196' })).err,
	/candidate carries 2 range field\(s\)/,
);

// THE REQUIRED MEANING FIELDS (SPEC §6) — a card without them is refused NAMING THE CARD.
harness.match(
	'missing domainName — refused NAMING the card, never map-resolved',
	callWith(newShapeCard({ domainName: undefined })).err,
	/candidate 'P001470' carries no domainName/,
);
harness.match(
	'missing propertyName — refused NAMING the card',
	callWith(newShapeCard({ propertyName: undefined })).err,
	/candidate 'P001470' carries no propertyName/,
);

// QUALIFIER PARALLELISM (SPEC §1.3) — and the retirement of the ' [qualifier]' name-suffix parse.
harness.match(
	'OLD-SHAPE qualified card (suffix-bearing name, qualifierKeys, NO qualifierNames) is REFUSED — the suffix parse is retired',
	callWith(
		newShapeCard({
			canonicalKey: 'P600502',
			propertyKey: 'P600502',
			name: 'Has Organization Identifier [Federal School Code]',
			propertyName: 'Has Organization Identifier',
			rangeDatatype: undefined,
			rangeClassId: 'C200252',
			qualifierKeys: ['OV_federalSchoolCode'],
		}),
	).err,
	/1 qualifierKeys but 0 qualifierNames/,
);
harness.match(
	'qualifierNames WITHOUT qualifierKeys is refused (parallel lists)',
	callWith(newShapeCard({ qualifierNames: ['Federal School Code'] })).err,
	/qualifierNames .* but no qualifierKeys/,
);
harness.match(
	'a non-string qualifierNames entry is refused',
	callWith(
		newShapeCard({
			qualifierKeys: ['OV_federalSchoolCode'],
			qualifierNames: [''],
		}),
	).err,
	/qualifierNames entry that is not a non-empty string/,
);

// VALUE TIER — valueKey is read directly off the card; there is no canonicalKey recovery.
harness.match(
	'value-tier candidate missing valueKey is refused (no recovery from canonicalKey)',
	callWith(
		newShapeCard({
			referenceTier: 'value',
			canonicalKey: 'OV001637175776',
			propertyKey: 'P001637',
			name: 'Yankunytjatjara',
			rangeDatatype: undefined,
			rangeOptionSetId: 'OS001637',
		}),
	).err,
	/candidate 'OV001637175776' has referenceTier='value' but is missing valueKey/,
);
harness.match(
	'value-tier candidate carrying the WRONG range shape (rangeDatatype, no rangeOptionSetId) is refused',
	callWith(
		newShapeCard({
			referenceTier: 'value',
			canonicalKey: 'OV001',
			propertyKey: 'P001',
			name: 'Some Value',
			valueKey: 'OV001',
		}),
	).err,
	/missing valueKey\/propertyKey\/rangeOptionSetId/,
);

// =====================================================================
// GREEN — the MEANING-carrying presentation, every card shape, against the REAL oracle
// =====================================================================
harness.section('GREEN — every card shape renders a MEANING-carrying presentation (REAL oracle)');

// Shape: scalar datatype property — the full meaning group rides through.
(() => {
	const observed = callWith(newShapeCard());
	harness.equal('scalar: no error', observed.err, '');
	harness.equal('scalar: passes the REAL hubModulePresentationViolation oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('scalar: domain is SINGULAR with its name', observed.presentation.domain.domainName, 'Rubric Criterion');
	harness.equal('scalar: domain.domainId carried', observed.presentation.domain.domainId, 'C200354');
	harness.match('scalar: domainDefinition carried', observed.presentation.domain.domainDefinition, /criterion within a rubric dimension/);
	harness.match('scalar: propertyDefinition carried — the judge finally sees the meaning', observed.presentation.property.propertyDefinition, /^Text describing a criterion/);
	harness.equal('scalar: range.shape is datatype', observed.presentation.range.shape, 'datatype');
	harness.equal('scalar: isQualified is false', observed.presentation.isQualified, false);
	harness.equal('scalar: qualifierNames is the EMPTY array', observed.presentation.qualifierNames.length, 0);
	harness.equal('scalar: value is null (property tier)', observed.presentation.value, null);
	harness.equal('scalar: retired domains[] is NOT present', 'domains' in observed.presentation, false);
	harness.equal('scalar: retired domainsComplete is NOT present', 'domainsComplete' in observed.presentation, false);
	harness.equal('scalar: retired qualifier object is NOT present', 'qualifier' in observed.presentation, false);
})();

// Shape: class-range property — range prose rides with the range.
(() => {
	const observed = callWith(
		newShapeCard({
			canonicalKey: 'P600253',
			propertyKey: 'P600253',
			name: 'Has Local Education Agency Title I Support Service',
			propertyName: 'Has Local Education Agency Title I Support Service',
			propertyDefinition: 'A relation to the Title I support service offered by the LEA.',
			domainId: 'C200188',
			domainName: 'Local Education Agency',
			domainDefinition: 'A local education agency.',
			rangeDatatype: undefined,
			rangeClassId: 'C200196',
			rangeClassName: 'Title I Support Service',
			rangeClassDefinition: 'A service supported by Title I funds.',
		}),
	);
	harness.equal('class-range: no error', observed.err, '');
	harness.equal('class-range: passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('class-range: range.shape is class', observed.presentation.range.shape, 'class');
	harness.equal('class-range: rangeClassName carried', observed.presentation.range.rangeClassName, 'Title I Support Service');
	harness.equal('class-range: rangeClassDefinition carried', observed.presentation.range.rangeClassDefinition, 'A service supported by Title I funds.');
})();

// Shape: option-set property — option-set prose rides with the range.
(() => {
	const observed = callWith(
		newShapeCard({
			canonicalKey: 'P001753',
			propertyKey: 'P001753',
			name: 'Has Credential Definition Verification Type',
			propertyName: 'Has Credential Definition Verification Type',
			rangeDatatype: undefined,
			rangeOptionSetId: 'OS001753',
			rangeOptionSetName: 'Credential Definition Verification Type',
			rangeOptionSetDefinition: 'The types of verification available for a credential definition.',
		}),
	);
	harness.equal('option-set: no error', observed.err, '');
	harness.equal('option-set: passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('option-set: range.shape is optionSet', observed.presentation.range.shape, 'optionSet');
	harness.equal('option-set: rangeOptionSetName carried', observed.presentation.range.rangeOptionSetName, 'Credential Definition Verification Type');
	harness.match('option-set: rangeOptionSetDefinition carried', observed.presentation.range.rangeOptionSetDefinition, /types of verification/);
})();

// Shape: qualified property — qualifierNames read VERBATIM off the card; the card name carries NO
// suffix (SPEC §1.6 retired the convention).
(() => {
	const observed = callWith(
		newShapeCard({
			canonicalKey: 'P600502',
			propertyKey: 'P600502',
			name: 'Has Organization Identifier',
			propertyName: 'Has Organization Identifier',
			rangeDatatype: undefined,
			rangeClassId: 'C200252',
			qualifierKeys: ['OV_federalSchoolCode'],
			qualifierNames: ['Federal School Code'],
		}),
	);
	harness.equal('qualified: no error', observed.err, '');
	harness.equal('qualified: passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('qualified: isQualified is true', observed.presentation.isQualified, true);
	harness.equal('qualified: qualifierNames read verbatim', observed.presentation.qualifierNames[0], 'Federal School Code');
})();

// Shape: qualified with PG-JSON single-element COLLAPSE on BOTH lists (scalar strings, not arrays) —
// the live-graph shape a single-element list property merges into.
(() => {
	const observed = callWith(
		newShapeCard({
			canonicalKey: 'P600502',
			propertyKey: 'P600502',
			name: 'Has Organization Identifier',
			propertyName: 'Has Organization Identifier',
			rangeDatatype: undefined,
			rangeClassId: 'C200252',
			qualifierKeys: 'OV_federalSchoolCode',
			qualifierNames: 'Federal School Code',
		}),
	);
	harness.equal('qualified (collapsed scalars): no error', observed.err, '');
	harness.equal('qualified (collapsed scalars): passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('qualified (collapsed scalars): qualifierNames normalized to a one-entry list', observed.presentation.qualifierNames.length, 1);
})();

// Shape: value-tier — owning scope + value prose; property group is the OWNING property's meaning.
(() => {
	const observed = callWith(
		newShapeCard({
			referenceTier: 'value',
			canonicalKey: 'OV001637175776',
			propertyKey: 'P001637',
			name: 'Yankunytjatjara',
			propertyName: 'Language Type',
			propertyDefinition: 'The specific language or dialect a person uses to communicate.',
			domainId: 'C200010',
			domainName: 'Person',
			domainDefinition: 'An individual.',
			rangeDatatype: undefined,
			rangeOptionSetId: 'OS001637',
			rangeOptionSetName: 'Language',
			valueKey: 'OV001637175776',
			valueName: 'Yankunytjatjara',
			valueNotation: 'kdd',
			valuePrefLabel: 'Yankunytjatjara',
		}),
	);
	harness.equal('value-tier: no error', observed.err, '');
	harness.equal('value-tier: passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('value-tier: referenceTier is value', observed.presentation.referenceTier, 'value');
	harness.equal('value-tier: value.owningPropertyKey', observed.presentation.value.owningPropertyKey, 'P001637');
	harness.equal('value-tier: value.owningOptionSetId', observed.presentation.value.owningOptionSetId, 'OS001637');
	harness.equal('value-tier: valueKey read DIRECTLY off the card', observed.presentation.value.valueKey, 'OV001637175776');
	harness.equal('value-tier: value prose (valueNotation) carried', observed.presentation.value.valueNotation, 'kdd');
	harness.equal('value-tier: OWNING property meaning carried', observed.presentation.property.propertyName, 'Language Type');
	harness.match('value-tier: owning propertyDefinition carried', observed.presentation.property.propertyDefinition, /language or dialect/);
})();

// =====================================================================
// GREEN — absent prose stays ABSENT (SPEC §1.3 "absent is absent"; G-3's contract)
// =====================================================================
harness.section('GREEN — absent prose stays ABSENT (no key, never \'\')');
(() => {
	const observed = callWith(
		newShapeCard({
			canonicalKey: 'P000021',
			propertyKey: 'P000021',
			domainDefinition: undefined,
			propertyDefinition: undefined,
		}),
	);
	harness.equal('definition-less card: no error (definitions are not REQUIRED fields)', observed.err, '');
	harness.equal('definition-less card: passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('definition-less card: propertyDefinition key is ABSENT', 'propertyDefinition' in observed.presentation.property, false);
	harness.equal('definition-less card: domainDefinition key is ABSENT', 'domainDefinition' in observed.presentation.domain, false);
})();

harness.report();
