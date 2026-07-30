#!/usr/bin/env node
'use strict';

// test-cedsHubModule.js — hermetic gate for lib.d/cedsHubModule.js (bridgeEvidenceRefactor-spec.md
// §6/§7 P3, R5). Proves, against the REAL hubModulePresentationViolation oracle (evidenceContracts.js
// — the contract gate IS the acceptance oracle, never this suite's own assertions):
//   RED  — call guards refuse BY NAME (missing candidate / referenceTier / canonicalKey / propertyKey
//          / name / domainId; zero or two range fields present; a qualified candidate whose name
//          carries no '[qualifier name]' suffix; a value-tier candidate missing its owning scope).
//   GREEN — EVERY P0-cedsTupleModel.md §3 worked shape (A scalar, B class-range, C option-set,
//          D qualified, E value-tier) renders a presentation that passes the REAL
//          hubModulePresentationViolation gate — the P0-FIDELITY proof this module's whole job is.
//
// Hermetic throughout: no Docker, no Neo4j, no LLM, no network — every candidate is a plain object,
// exactly the flattenFullRecord shape a real HubReference :ForgedNode would produce.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-cedsHubModule.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the REAL CEDS hub module (lib.d/cedsHubModule.js)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves cedsHubModule's call guards (RED) and every P0-cedsTupleModel.md §3 worked shape (A-E)
     against the REAL hubModulePresentationViolation oracle (GREEN, P0-fidelity).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const cedsHubModuleFactory = require('../lib.d/cedsHubModule');
const { hubModulePresentationViolation } = require('../lib/evidenceContracts');

const hubModule = cedsHubModuleFactory();

// =====================================================================
// RED — call guards
// =====================================================================
harness.section('RED — call guards refuse BY NAME');

const callWith = (candidate) => {
	let observed = null;
	hubModule(candidate, (err, presentation) => {
		observed = { err, presentation };
	});
	return observed;
};

harness.match('missing candidate', callWith(null).err, /candidate is missing or not an object/);
harness.match(
	'missing/bad referenceTier',
	callWith({ referenceTier: 'qualified', canonicalKey: 'P1', propertyKey: 'P1', name: 'x', domainId: 'C1', rangeDatatype: 'string' }).err,
	/referenceTier must be 'property' or 'value'/,
);
harness.match(
	'missing canonicalKey',
	callWith({ referenceTier: 'property', propertyKey: 'P1', name: 'x', domainId: 'C1', rangeDatatype: 'string' }).err,
	/candidate.canonicalKey is missing/,
);
harness.match(
	'missing propertyKey',
	callWith({ referenceTier: 'property', canonicalKey: 'P1', name: 'x', domainId: 'C1', rangeDatatype: 'string' }).err,
	/candidate.propertyKey is missing/,
);
harness.match(
	'missing name',
	callWith({ referenceTier: 'property', canonicalKey: 'P1', propertyKey: 'P1', domainId: 'C1', rangeDatatype: 'string' }).err,
	/candidate.name is missing/,
);
harness.match(
	'missing domainId',
	callWith({ referenceTier: 'property', canonicalKey: 'P1', propertyKey: 'P1', name: 'x', rangeDatatype: 'string' }).err,
	/candidate.domainId is missing/,
);
harness.match(
	'ZERO range fields present',
	callWith({ referenceTier: 'property', canonicalKey: 'P1', propertyKey: 'P1', name: 'x', domainId: 'C1' }).err,
	/candidate carries 0 range field\(s\)/,
);
harness.match(
	'TWO range fields present',
	callWith({
		referenceTier: 'property',
		canonicalKey: 'P1',
		propertyKey: 'P1',
		name: 'x',
		domainId: 'C1',
		rangeDatatype: 'string',
		rangeClassId: 'C2',
	}).err,
	/candidate carries 2 range field\(s\)/,
);
harness.match(
	'qualified candidate (qualifierKeys set) whose name carries no bracket suffix',
	callWith({
		referenceTier: 'property',
		canonicalKey: 'P600502',
		propertyKey: 'P600502',
		name: 'Has Organization Identifier', // no '[qualifier name]' suffix
		domainId: 'C200239',
		rangeClassId: 'C200252',
		qualifierKeys: ['OV_federalSchoolCode'],
	}).err,
	/does not carry the '<token> \[<qualifier name>\]' suffix/,
);
harness.match(
	'value-tier candidate carrying the WRONG range shape (rangeDatatype instead of rangeOptionSetId) has no owning-option-set scope',
	callWith({
		referenceTier: 'value',
		canonicalKey: 'OV001',
		propertyKey: 'P001',
		name: 'Some Value',
		domainId: 'C200010',
		rangeDatatype: 'string', // malformed: a value-tier ref should carry rangeOptionSetId, never this
	}).err,
	/missing valueKey\/propertyKey\/rangeOptionSetId/,
);

// =====================================================================
// GREEN — P0-FIDELITY: every worked shape from P0-cedsTupleModel.md §3
// =====================================================================
harness.section('GREEN — P0-FIDELITY: every P0-cedsTupleModel.md §3 worked shape');

// Shape A — scalar datatype property (994 live instances)
(() => {
	const observed = callWith({
		referenceTier: 'property',
		canonicalKey: 'P000104',
		propertyKey: 'P000104',
		name: 'Staff Evaluation Score or Rating',
		domainId: 'C200366',
		rangeDatatype: 'string',
	});
	harness.equal('Shape A: no error', observed.err, '');
	harness.equal('Shape A: passes the REAL hubModulePresentationViolation oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('Shape A: range.shape is datatype', observed.presentation.range.shape, 'datatype');
	harness.equal('Shape A: domainsComplete is honestly false (P0 §2.4 — see file header)', observed.presentation.domainsComplete, false);
	harness.equal('Shape A: isQualified is false', observed.presentation.isQualified, false);
	harness.equal('Shape A: value is null (property tier)', observed.presentation.value, null);
})();

// Shape B — class-range (object/association) property (363 live instances)
(() => {
	const observed = callWith({
		referenceTier: 'property',
		canonicalKey: 'P600253',
		propertyKey: 'P600253',
		name: 'Has Local Education Agency Title I Support Service',
		domainId: 'C200188',
		rangeClassId: 'C200196',
	});
	harness.equal('Shape B: no error', observed.err, '');
	harness.equal('Shape B: passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('Shape B: range.shape is class', observed.presentation.range.shape, 'class');
	harness.equal('Shape B: range.rangeClassId carried through', observed.presentation.range.rangeClassId, 'C200196');
})();

// Shape C — option-set (enumerated) property (994 live instances)
(() => {
	const observed = callWith({
		referenceTier: 'property',
		canonicalKey: 'P001753',
		propertyKey: 'P001753',
		name: 'Has Credential Definition Verification Type',
		domainId: 'C200087',
		rangeOptionSetId: 'OS001753',
	});
	harness.equal('Shape C: no error', observed.err, '');
	harness.equal('Shape C: passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('Shape C: range.shape is optionSet', observed.presentation.range.shape, 'optionSet');
})();

// Shape D — qualified property variant (27 live instances). referenceSubgraph.js:418's own naming
// convention: `${tokenName} [${qualifierValueName}]`.
(() => {
	const observed = callWith({
		referenceTier: 'property',
		canonicalKey: 'P600502',
		propertyKey: 'P600502',
		name: 'Has Organization Identifier [Federal School Code]',
		domainId: 'C200239',
		rangeClassId: 'C200252',
		qualifierKeys: ['OV_federalSchoolCode'],
	});
	harness.equal('Shape D: no error', observed.err, '');
	harness.equal('Shape D: passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('Shape D: isQualified is true', observed.presentation.isQualified, true);
	harness.equal('Shape D: qualifierKey parsed correctly', observed.presentation.qualifier.qualifierKey, 'OV_federalSchoolCode');
	harness.equal('Shape D: qualifierName parsed from the bracket suffix', observed.presentation.qualifier.qualifierName, 'Federal School Code');
})();

// Shape D twin — qualifierKeys single-element PG-JSON COLLAPSE (a scalar string, not an array) — the
// live-graph shape P0 §2.5/Q/A3-A4 documents (all 27 qualified refs come back typed STRING, not LIST).
(() => {
	const observed = callWith({
		referenceTier: 'property',
		canonicalKey: 'P600502',
		propertyKey: 'P600502',
		name: 'Has Organization Identifier [Federal School Code]',
		domainId: 'C200239',
		rangeClassId: 'C200252',
		qualifierKeys: 'OV_federalSchoolCode', // collapsed scalar, not ['OV_federalSchoolCode']
	});
	harness.equal('Shape D (collapsed scalar qualifierKeys): no error', observed.err, '');
	harness.equal('Shape D (collapsed scalar qualifierKeys): passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('Shape D (collapsed scalar qualifierKeys): qualifierKey parsed correctly', observed.presentation.qualifier.qualifierKey, 'OV_federalSchoolCode');
})();

// Shape E — value-tier option-value (4-slot) (27,437 live instances)
(() => {
	const observed = callWith({
		referenceTier: 'value',
		canonicalKey: 'OV001637175776',
		propertyKey: 'P001637',
		name: 'Yankunytjatjara',
		domainId: 'C200010',
		rangeOptionSetId: 'OS001637',
		valueKey: 'OV001637175776',
	});
	harness.equal('Shape E: no error', observed.err, '');
	harness.equal('Shape E: passes the REAL oracle', hubModulePresentationViolation(observed.presentation), '');
	harness.equal('Shape E: referenceTier is value', observed.presentation.referenceTier, 'value');
	harness.equal('Shape E: value.owningPropertyKey', observed.presentation.value.owningPropertyKey, 'P001637');
	harness.equal('Shape E: value.owningOptionSetId', observed.presentation.value.owningOptionSetId, 'OS001637');
})();

// GREEN — a domainsComplete:false case is the DEFAULT, not a special fixture (P0 §2.4 honesty).
harness.section('GREEN — domainsComplete:false is the uniform default (P0 §2.4)');
(() => {
	const propertyTier = callWith({
		referenceTier: 'property',
		canonicalKey: 'P000104',
		propertyKey: 'P000104',
		name: 'Staff Evaluation Score or Rating',
		domainId: 'C200366',
		rangeDatatype: 'string',
	});
	const valueTier = callWith({
		referenceTier: 'value',
		canonicalKey: 'OV1',
		propertyKey: 'P1',
		name: 'V',
		domainId: 'C1',
		rangeOptionSetId: 'OS1',
	});
	harness.equal('property-tier domainsComplete is false', propertyTier.presentation.domainsComplete, false);
	harness.equal('value-tier domainsComplete is false', valueTier.presentation.domainsComplete, false);
})();

harness.report();
