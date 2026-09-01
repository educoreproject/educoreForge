#!/usr/bin/env node
'use strict';

// test-definitionCompleteness.js — the definition-completeness gate, PHASE 1 FORM (graphSelfDoc,
// 2026-08-31). It supersedes the Phase 0 gate that lived at lib/vocabulary/test/, which is RETIRED in the
// same phase that created its replacement (GRANITE_ECHO, binding).
//
// WHAT CHANGED AND WHY IT IS THE WHOLE POINT. The Phase 0 gate MIRRORED the schemaView enumeration: it
// rebuilt the kind->source-array map itself, because the finisher did not exist yet. That mirror was two
// lists that could drift — and TWO LISTS THAT DRIFTED IS THE EXACT DEFECT THIS CAMPAIGN OPENED ON.
// FINDING 0-A was four registry terms whose definitions had been authored into a bucket the enumerator did
// not read; answering it with a second enumeration would have rebuilt the defect while fixing its symptom.
// So this gate now CONSUMES schema-view-finisher's buildMembers(). There is ONE enumeration in the tree,
// it lives in the module that emits from it, and this file holds NO list of its own — which is why a drift
// between gate and finisher is not merely unlikely here, it is unrepresentable.
//
// IT ALSO MOVED, AND THE MOVE IS THE DEPENDENCY DIRECTION. The Phase 0 gate sat under lib/vocabulary/test/.
// Consuming the finisher from there would have made a lib/ test depend on an apps/ module — the wrong way
// down the layering. The gate belongs with the code that owns what it checks.
//
// THE REFUSAL CHANGED OWNER, DELIBERATELY AND ON THE RECORD (GRANITE_ECHO's ruling: update the message so
// it names the finisher, and record old and new side by side at the moment of the move, so the Phase 0
// quoted refusal stays findable through the record rather than through a stale grep):
//   PHASE 0 (retired):  "definitionCompleteness: N registry term(s) have NO definition in
//                        vocabulary-definitions.js — refusing to emit an undocumented schema view.
//                        Undefined: <kind:value, …>"
//   PHASE 1 (this one): "schema-view-finisher: N registry term(s) have NO definition in
//                        vocabulary-definitions.js — refusing to emit an undocumented schema view.
//                        Undefined: <kind:value, …>"
// Only the OWNER token changed. The finisher is genuinely the refuser now, and a message claiming an owner
// its code does not have is prose drift in miniature.
//
// THE RED TWIN (gate doctrine: a gate never observed failing is unproven). Delete any one definition from
// lib/vocabulary/vocabulary-definitions.js and re-run: section (b) goes red and the refusal NAMES the
// deleted term as kind:value. Observed and recorded in DEVLOG-graphSelfDoc-083126.md.
// Pure; no docker, no database, no store.
//
// Run: node apps/graph-builder/apps/replay-manager/lib/finishing/test/test-definitionCompleteness.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gate: every term the schemaView finisher enumerates carries a human definition
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
DESCRIPTION
     Consumes schema-view-finisher.buildMembers() -- the ONE enumeration -- and asserts every member
     carries a non-empty definition in vocabulary-definitions.js. Reports missing terms BY kind:value in
     a refusal owned by the finisher. Orphan definitions are asserted PERMITTED (RULING FJ-P2-1), never
     failed. Holds no term list of its own, so gate/finisher drift is unrepresentable. Pure.
EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../../../test/testLib/harness')(moduleName);
const vocabulary = require('../../../../../../../lib/vocabulary/vocabulary');
const { TERM_DEFINITIONS } = vocabulary;

// THE ONE ENUMERATION. This gate builds no list; it asks the finisher what it emits.
const schemaViewFinisher = require('../lib/schema-view-finisher')({ vocabulary });

const { members, missingDefinitions } = schemaViewFinisher.buildMembers();
const refusal = schemaViewFinisher.definitionCompletenessRefusal();
const KINDS = vocabulary.SCHEMA_VIEW.KINDS;

const uniq = (oneList) =>
	oneList.filter((oneValue, onePosition) => oneList.indexOf(oneValue) === onePosition);
const hasMember = (kind, value) =>
	members.some((oneMember) => oneMember.kind === kind && oneMember.value === value);

// =====================================================================
harness.section('(a) THE SINGLE ENUMERATION — this gate consumes the finisher and holds no list of its own');
// =====================================================================
harness.ok('buildMembers() is exposed by the finisher as the enumeration of record', typeof schemaViewFinisher.buildMembers === 'function');
harness.ok('definitionCompletenessRefusal() is exposed by the finisher (the refusal is the finisher\'s own)', typeof schemaViewFinisher.definitionCompletenessRefusal === 'function');
harness.ok('the enumeration is non-empty', members.length > 0);
harness.ok(`it covers every KIND the registry declares (${Object.keys(KINDS).length})`, uniq(members.map((oneMember) => oneMember.kind)).length === Object.keys(KINDS).length);
harness.ok('no member carries an empty value (a nameless member could never be looked up)', members.every((oneMember) => typeof oneMember.value === 'string' && oneMember.value.trim() !== ''));
harness.ok('every member stableId is schemaView:<kind>:<value> — the finisher\'s own addressing', members.every((oneMember) => oneMember.stableId === `schemaView:${oneMember.kind}:${oneMember.value}`));
harness.ok('member stableIds are UNIQUE', new Set(members.map((oneMember) => oneMember.stableId)).size === members.length);
harness.ok('members arrive sorted by stableId (deterministic emission; twin builds match)', JSON.stringify(members.map((oneMember) => oneMember.stableId)) === JSON.stringify(members.map((oneMember) => oneMember.stableId).slice().sort()));

// =====================================================================
harness.section('(b) THE GATE — every enumerated term carries a non-empty definition');
// =====================================================================
harness.equal('the finisher\'s refusal is EMPTY (no undefined terms)', refusal, '');
harness.equal('buildMembers reports ZERO missing definitions', String(missingDefinitions.length), '0');
harness.ok('every enumerated member resolves to a non-empty string definition', members.every((oneMember) => typeof oneMember.description === 'string' && oneMember.description.trim() !== ''));
harness.ok('the two agree — an empty refusal implies an empty missing list', (refusal === '') === (missingDefinitions.length === 0));

// =====================================================================
harness.section('(c) the four PRE-EXISTING undefined terms stay closed, each in the bucket the finisher READS');
// =====================================================================
const THE_FOUR_CLOSED = [
	{ kind: KINDS.PROVENANCE_TIER, value: 'invalid-debug' },
	{ kind: KINDS.DME_ROLE, value: 'DmeEditHistoryEntry' },
	{ kind: KINDS.DME_ROLE, value: 'DmeRestriction' },
	{ kind: KINDS.DME_ROLE, value: 'DmeVocabularyTerm' },
];
THE_FOUR_CLOSED.forEach((oneTerm) => {
	harness.ok(`${oneTerm.kind}:${oneTerm.value} is still ENUMERATED (hiding it was rejected)`, hasMember(oneTerm.kind, oneTerm.value));
	const definitionText = ((TERM_DEFINITIONS || {})[oneTerm.kind] || {})[oneTerm.value];
	harness.ok(`${oneTerm.kind}:${oneTerm.value} has a definition in its OWN kind bucket`, typeof definitionText === 'string' && definitionText.trim() !== '');
});
harness.match('invalid-debug names the debug judge and its unconditional rule', TERM_DEFINITIONS.provenanceTier['invalid-debug'], /useDebugJudge/);
harness.match('invalid-debug says plainly it must not be read as a judgement about meaning', TERM_DEFINITIONS.provenanceTier['invalid-debug'], /never be read as a judgement about meaning/);
harness.ok('the three dmeRole texts are NOT verbatim copies of their nodeLabel siblings (a role and a label are different assertions)', ['DmeEditHistoryEntry', 'DmeRestriction', 'DmeVocabularyTerm'].every((oneRole) => TERM_DEFINITIONS.dmeRole[oneRole] !== TERM_DEFINITIONS.nodeLabel[oneRole]));

// =====================================================================
harness.section('(d) the graphSelfDoc additions are enumerated, defined, and marked meta where they belong');
// =====================================================================
const NEW_NODE_LABELS = ['UsagePattern', 'BuildAttestation'];
const NEW_EDGE_TYPES = ['DESCRIBES', 'HAS_VIEW', 'ATTESTS', 'ADVISES', 'DEFINES'];

NEW_NODE_LABELS.forEach((oneLabel) => {
	harness.ok(`${oneLabel} is enumerated as a nodeLabel`, hasMember(KINDS.NODE_LABEL, oneLabel));
	harness.ok(`${oneLabel} carries a definition`, typeof TERM_DEFINITIONS.nodeLabel[oneLabel] === 'string' && TERM_DEFINITIONS.nodeLabel[oneLabel].trim() !== '');
	harness.ok(`${oneLabel} is in META_NODE_LABELS (the XOR gate needs zero edits per new type)`, vocabulary.GRAPH_META.META_NODE_LABELS.indexOf(oneLabel) !== -1);
});
NEW_EDGE_TYPES.forEach((oneType) => {
	harness.ok(`${oneType} is enumerated as an edgeType`, hasMember(KINDS.EDGE_TYPE, oneType));
	harness.ok(`${oneType} carries a definition`, typeof TERM_DEFINITIONS.edgeType[oneType] === 'string' && TERM_DEFINITIONS.edgeType[oneType].trim() !== '');
});
harness.ok('DEFINES is NOT in META_NODE_LABELS (it is an edge type, not a node label)', vocabulary.GRAPH_META.META_NODE_LABELS.indexOf('DEFINES') === -1);
harness.ok('the new stableId prefixes are declared in the registry, not in the finisher', typeof vocabulary.SELF_DOC.USAGE_PATTERN_STABLE_ID_PREFIX === 'string' && typeof vocabulary.SELF_DOC.BUILD_ATTESTATION_STABLE_ID_PREFIX === 'string');

// =====================================================================
harness.section('(e) ORPHAN definitions are PERMITTED by ruling — asserted, not failed (RULING FJ-P2-1)');
// =====================================================================
const CEDS_HUB_EDGE_NAMES = ['HAS_CEDS_DOMAIN', 'HAS_CEDS_PROPERTY', 'HAS_CEDS_RANGE', 'HAS_CEDS_VALUE', 'HAS_CEDS_QUALIFIER'];
harness.ok('CEDS_HUB_EDGE_TYPES is GONE from the registry (Phase 2c, RULING FJ-P2-3)', vocabulary.CEDS_HUB_EDGE_TYPES === undefined);
CEDS_HUB_EDGE_NAMES.forEach((oneType) => {
	harness.ok(`${oneType} is NOT enumerated (its constant was deleted)`, !hasMember(KINDS.EDGE_TYPE, oneType));
	harness.ok(`${oneType} KEEPS its definition anyway — it describes a live edge (RULING FJ-P2-1)`, typeof TERM_DEFINITIONS.edgeType[oneType] === 'string' && TERM_DEFINITIONS.edgeType[oneType].trim() !== '');
});
harness.ok('the generator that replaced the constant still produces the same five names', CEDS_HUB_EDGE_NAMES.every((oneType, onePosition) => vocabulary.hubEdgeType('CEDS', vocabulary.HUB_DECOMPOSITION_SLOTS[onePosition]) === oneType));

// =====================================================================
harness.section('(f) the refusal NAMES what is missing, and is OWNED BY THE FINISHER');
// =====================================================================
// Proven against a deliberately incomplete definitions map so the message shape is verified WITHOUT
// mutating the real file. The live RED twin (deleting a real definition) is recorded in the DEVLOG.
const probeFinisher = require('../lib/schema-view-finisher')({
	vocabulary: { ...vocabulary, TERM_DEFINITIONS: { ...TERM_DEFINITIONS, provenanceTier: {} } },
});
const probeRefusal = probeFinisher.definitionCompletenessRefusal();

harness.ok('a definitions map missing a whole kind DOES refuse', probeRefusal !== '');
harness.match('the refusal is OWNED BY THE FINISHER (Phase 0\'s definitionCompleteness: owner is retired)', probeRefusal, /^schema-view-finisher:/);
harness.match('it names the file to edit', probeRefusal, /vocabulary-definitions\.js/);
harness.match('it states the consequence (it refuses to emit)', probeRefusal, /refusing to emit an undocumented schema view/);
harness.match('it names the terms as kind:value, not as a bare count', probeRefusal, /Undefined: provenanceTier:/);
harness.ok('it names EVERY missing term, not just the first', vocabulary.PROVENANCE_TIERS.every((oneTier) => probeRefusal.indexOf(`provenanceTier:${oneTier}`) !== -1));
harness.ok('the LIVE refusal is empty, so this shape is not firing on the real registry', refusal === '');

// =====================================================================
harness.section('(g) emit() REFUSES rather than emitting an undocumented view — the gate has teeth');
// =====================================================================
// The completeness check is not decoration beside emit; it is the first thing emit does.
let probeEmitError = 'NOT CALLED';
probeFinisher.emit({ readQuery: () => {} }, (err) => {
	probeEmitError = err;
});
harness.ok('emit() on an incomplete registry REFUSED', probeEmitError !== '' && probeEmitError !== 'NOT CALLED');
harness.equal('emit()\'s refusal IS the completeness refusal (one message, one owner)', probeEmitError, probeRefusal);

let liveEmitError = 'NOT CALLED';
let liveEmitResult = null;
schemaViewFinisher.emit({ readQuery: () => {} }, (err, result) => {
	liveEmitError = err;
	liveEmitResult = result;
});
harness.equal('emit() on the REAL registry succeeds', liveEmitError, '');
harness.ok('and returns one node per member plus the root', liveEmitResult && liveEmitResult.nodes.length === members.length + 1);

harness.report();
