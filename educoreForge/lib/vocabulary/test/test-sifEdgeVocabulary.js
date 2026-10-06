#!/usr/bin/env node
'use strict';

// test-sifEdgeVocabulary.js — phase V1 of the SIF replacement (PLAN-sifReplacement-smallPhases-092826 §3 V1;
// SPEC-sifStructuralBridge-replacement §3.2, §9 A10 and A24). V1 adds five EDGE_TYPES rows (HAS_FIELD,
// HAS_CHILD, HAS_INSTANCE, CONSTRAINED_BY and the one native kind, REFERENCES_OBJECT) and one mapping-edge
// property (judgedSubjectStableId). This suite holds gates (a) to (d); gate (e), the invariance oracle, is
// test-sifVocabularyInvariance.js, because it forges four standards.
//
//   (a) kit.addEdge accepts each new type.        TWIN: a kit double whose vocabulary lacks the row refuses
//                                                 that type by name.
//   (b) every new type has a definition.          TWIN: a definitions double missing one of them makes the
//                                                 schema-view finisher refuse, naming it; once per type.
//   (c) the schema-view member count is the frozen literal, and rises from the pre-V1 count by exactly the
//       number of rows added.                     TWIN: a double adds one more row WITH a definition, so the
//                                                 finisher does not refuse and only the count goes red.
//   (d) MAPPING_PROPERTY_NAME_LIST contains judgedSubjectStableId, and the write seam accepts an edge
//       carrying it.                              TWIN: a double without the row, and
//                                                 graphSeamRules.mappingEdgeRefusal refuses it by name.
//
// Every twin is an in-memory double (lib/forge-framework/test/testSupport/moduleDouble.js); no file is
// written. LAYERING NOTE: gates (b) and (c) consume the finisher from apps/graph-builder, the direction the
// graphSelfDoc campaign moved its own completeness gate away from. V1's footprint is lib/vocabulary/test
// only, so the gate lives here; the finisher's own suite (test-definitionCompleteness.js) still guards the
// general rule.
//
// Run: node lib/vocabulary/test/test-sifEdgeVocabulary.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- phase V1 gates (a)-(d): the SIF edge types and judgedSubjectStableId
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
DESCRIPTION
     Proves the five V1 EDGE_TYPES rows are accepted by the forge kit, defined for the schema view, counted
     exactly in it, and that judgedSubjectStableId is in the closed mapping-property set. Every conjunct is
     observed RED under an in-memory double. Pure; no docker, no database.
EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');
const harness = require('../../../test/testLib/harness')(moduleName);
const vocabulary = require('../vocabulary');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const toyScenario = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'toyScenario'));

const VOCABULARY_PATH = path.join(__dirname, '..', 'vocabulary.js');
const DEFINITIONS_PATH = path.join(__dirname, '..', 'vocabulary-definitions.js');
const KIT_PATH = path.join(__dirname, '..', '..', 'forge-framework', 'contractGraphKit.js');
const SEAM_RULES_PATH = path.join(__dirname, '..', '..', 'bridge-framework', 'graphSeamRules.js');
const FINISHER_PATH = path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'apps', 'replay-manager', 'lib', 'finishing', 'lib', 'schema-view-finisher.js');

// the five rows V1 adds, by member name and value
const V1_EDGE_TYPE_NAME_LIST = ['HAS_FIELD', 'HAS_CHILD', 'HAS_INSTANCE', 'CONSTRAINED_BY', 'REFERENCES_OBJECT'];

// FROZEN LITERALS for gate (c). 89 was measured at 97feee9 (sifReplacementBase), before any V1 edit:
// schema-view-finisher.buildMembers().members.length over the unedited registry. Never edited to match a
// later measurement; a disagreement is reported, not absorbed.
const SCHEMA_VIEW_MEMBER_COUNT_BEFORE_V1 = 89;
const SCHEMA_VIEW_MEMBER_COUNT_AFTER_V1 = 94;
// ⟪lane P, mappingProvenance 2026-10-04⟫ one schema-view member added AFTER V1 and unrelated to it: the required-property set
// REQUIRED_PROPERTIES.MAPPING_EDGE (a mapping edge carries mappingKind, not provenanceTier). The two V1 literals above stay as
// measured; both readings now include this one row, so each is compared against its literal PLUS it. The rise of exactly
// five is unaffected.
// ⟪campaign P2, W-A-10, 2026-10-06 (CARDINAL_RIVER)⟫ +5 more, unrelated to V1: REQUIRED_PROPERTIES.NODE (one member) became
// NODE_BY_ROLE_CLASS, projected one member per class (five), plus NODE_RECOMMENDED (one) — 1 removed, 6 added.
// ⟪campaign P2, W-A-6, 2026-10-06 (CARDINAL_RIVER)⟫ +176 more, unrelated to V1: the graph contract projected (27 passport
// fields, 18 attestation fields, 57 self-doc fields, 25 list-valued names, 39 integer-valued names = 166) and the 10 DME
// role labels as nodeLabel members. (The generated HAS_<HUB>_<SLOT> members need a hub list and are not in this pure count.)
// ⟪campaign P3, W-B-1..4, 2026-10-06 (CARDINAL_HORIZON)⟫ +29 more, unrelated to V1: the 26 mapping-edge properties
// (matchEdgeProperty) and the 3 confidence bands (confidenceBand), the two SchemaView kinds CONTRACTS §9 deferred to P3.
// ⟪campaign P3, W-C-17, 2026-10-06 (CARDINAL_HORIZON)⟫ +5 more, unrelated to V1: five integer-valued names (maxLength,
// minLength, decimalPlaces, minCount, maxCount) joined graph-contract §2 once the CEDS parser typed them.
const SCHEMA_VIEW_MEMBER_ROWS_ADDED_AFTER_V1 = 1 + 5 + 176 + 29 + 5;

// ---------------------------------------------------------------------
// doubles
// ---------------------------------------------------------------------
// the text of one EDGE_TYPES row as it stands in vocabulary.js (the find-text of every row mutation)
const edgeTypeRowText = (oneName) => `\t${oneName}: '${oneName}',\n`;

// the text that opens one edgeType definition in vocabulary-definitions.js
const definitionOpeningText = (oneName) => `\t\t${oneName}:\n\t\t\t'`;

const vocabularyDouble = (mutationList) => moduleDouble.loadWithMutations({ modulePath: VOCABULARY_PATH, mutationList });
const finisherOver = (subjectVocabulary) => require(FINISHER_PATH)({ vocabulary: subjectVocabulary });

// a vocabulary whose TERM_DEFINITIONS lacks the named edgeType definition: the definition's key is renamed,
// so the text survives but no longer answers for the term
const withoutDefinition = (oneName) =>
	vocabularyDouble([{ modulePath: DEFINITIONS_PATH, find: definitionOpeningText(oneName), replace: `\t\t${oneName}_DEFINITION_REMOVED_BY_TWIN:\n\t\t\t'` }]);

// a vocabulary carrying the five V1 rows minus the named ones (an empty list is the pre-V1 registry)
const withoutEdgeTypeRows = (nameList) =>
	vocabularyDouble(nameList.map((oneName) => ({ modulePath: VOCABULARY_PATH, find: edgeTypeRowText(oneName), replace: '' })));

// ---------------------------------------------------------------------
// the conjunct judges, each a pure verdict over a subject
// ---------------------------------------------------------------------
const kitFor = (kitModule) => kitModule.contractGraphKit({ forgeDeclaration: toyScenario.makeScenario().forgeDeclaration, metadata: {} }).kit;

const addEdgeOutcome = (kit, edgeType) => {
	let refusalMessage = '';
	const edgeCountBefore = kit.edges.length;
	try {
		// the kit's refusal is a THROW by its declared contract (contractGraphKit.js header, SPEC §3.3);
		// catching it here is observation of that contract, not control flow
		kit.addEdge({ edgeType, fromStableId: 'toy:from', toStableId: 'toy:to', edgeContext: `${moduleName} ${edgeType}` });
	} catch (kitError) {
		refusalMessage = kitError.message;
	}
	const addedEdge = kit.edges.length === edgeCountBefore + 1 ? kit.edges[kit.edges.length - 1] : undefined;
	return { refusalMessage, addedEdge };
};

const judgeKitAccepts = (kitModule, oneName) => {
	const { refusalMessage, addedEdge } = addEdgeOutcome(kitFor(kitModule), oneName);
	const pass = refusalMessage === '' && addedEdge !== undefined && addedEdge.type === oneName && addedEdge.properties.provenanceTier === 'structural';
	return { pass, detail: refusalMessage || (addedEdge ? `edge ${addedEdge.type}` : 'no edge collected') };
};

const judgeDefinitionComplete = (subjectVocabulary) => {
	const refusal = finisherOver(subjectVocabulary).definitionCompletenessRefusal();
	return { pass: refusal === '', refusal, detail: refusal || 'no refusal' };
};

const schemaViewCount = (subjectVocabulary) => finisherOver(subjectVocabulary).buildMembers().members.length;

// a well-formed inferred, judged mapping edge, fan-out shaped: the subject is a Field, and
// judgedSubjectStableId names the question that was judged
const fanOutEdgeRequest = () => ({
	subjectStableId: 'sif260928:field-toy',
	objectStableId: 'hub:toyCard',
	edgeType: 'CLOSE_MATCH',
	sourceStandardName: 'SIF260928',
	subjectEndpoint: { sourceStandardName: 'SIF260928' },
	objectEndpoint: { labels: ['HubReference'], referenceTier: 'property' },
	edgeProperties: {
		predicate: 'closeMatch',
		mappingMethod: 'semapv:SemanticSimilarityThresholdMatching',
		matchBasis: 'derived',
		resolution: 'judged',
		objectMatchField: 'EDUcoreHub:canonicalKey',
		subjectSource: 'SIF260928',
		subjectVersion: '4.3',
		objectSource: 'CEDS',
		objectVersion: '14.0.0.0',
		predicateAssertedBy: 'judge',
		attestationChannelList: ['derived:1'],
		decisionBlockHash: 'c'.repeat(64),
		mappingConfidence: 0.8,
		mappingKind: 'inferred',
		mappingSource: 'bridge-jev',
		judgeIdentity: 'jev:toyJudge',
		rendererVersion: 'v12',
		matchId: 'd'.repeat(64),
		judgedSubjectStableId: 'sif260928:question-toy',
	},
});

const judgeSeamAcceptsJudgedSubject = (seamRulesModule) => {
	const refusal = seamRulesModule.mappingEdgeRefusal(fanOutEdgeRequest());
	return { pass: refusal === null, detail: refusal === null ? 'accepted' : refusal.message };
};

// =====================================================================
harness.section('(a) kit.addEdge accepts each of the five V1 edge types, stamped structural');
// =====================================================================
const realKitModule = require(KIT_PATH);
V1_EDGE_TYPE_NAME_LIST.forEach((oneName) => {
	harness.ok(`EDGE_TYPES.${oneName} === '${oneName}'`, vocabulary.EDGE_TYPES[oneName] === oneName);
	const verdict = judgeKitAccepts(realKitModule, oneName);
	harness.ok(`a_kitAcceptsType ${oneName} PASS`, verdict.pass, verdict.detail);
});

// =====================================================================
harness.section('(b) every V1 edge type carries a non-empty definition, and the finisher is satisfied');
// =====================================================================
V1_EDGE_TYPE_NAME_LIST.forEach((oneName) => {
	const definitionText = vocabulary.TERM_DEFINITIONS.edgeType[oneName];
	harness.ok(`${oneName} has an edgeType definition that says more than its name`, typeof definitionText === 'string' && definitionText.trim().length > oneName.length + 20);
});
const realCompleteness = judgeDefinitionComplete(vocabulary);
harness.ok('b_finisherRefusesNothing PASS', realCompleteness.pass, realCompleteness.detail);

// =====================================================================
harness.section('(c) the schema-view member count equals the frozen literal, a rise of exactly five');
// =====================================================================
const realMemberCount = schemaViewCount(vocabulary);
const preV1MemberCount = schemaViewCount(withoutEdgeTypeRows(V1_EDGE_TYPE_NAME_LIST));
harness.equal('c_memberCountEqualsLiteral PASS (the registry as it stands)', String(realMemberCount), String(SCHEMA_VIEW_MEMBER_COUNT_AFTER_V1 + SCHEMA_VIEW_MEMBER_ROWS_ADDED_AFTER_V1));
harness.equal('the registry with the five V1 rows removed reproduces the pre-V1 literal', String(preV1MemberCount), String(SCHEMA_VIEW_MEMBER_COUNT_BEFORE_V1 + SCHEMA_VIEW_MEMBER_ROWS_ADDED_AFTER_V1));
harness.equal('the rise is exactly the number of V1 rows', String(realMemberCount - preV1MemberCount), String(V1_EDGE_TYPE_NAME_LIST.length));

// =====================================================================
harness.section('(d) judgedSubjectStableId is in the closed set, and the write seam accepts it');
// =====================================================================
harness.equal("MAPPING_PROPERTIES.JUDGED_SUBJECT_STABLE_ID === 'judgedSubjectStableId'", vocabulary.MAPPING_PROPERTIES.JUDGED_SUBJECT_STABLE_ID, 'judgedSubjectStableId');
harness.ok('d_nameListCarriesJudgedSubject PASS', vocabulary.MAPPING_PROPERTY_NAME_LIST.indexOf('judgedSubjectStableId') !== -1);
const realSeamVerdict = judgeSeamAcceptsJudgedSubject(require(SEAM_RULES_PATH));
harness.ok('d_seamAcceptsJudgedSubject PASS (a fan-out edge carrying it passes every seam rule)', realSeamVerdict.pass, realSeamVerdict.detail);

// =====================================================================
harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under an in-memory double');
// =====================================================================
const observedRedList = [];
const recordRed = ({ conjunctRefId, twinName, verdictIsRed, detail }) => {
	harness.ok(`${conjunctRefId} observed RED under twin '${twinName}'`, verdictIsRed, detail);
	process.global.xLog.status(`  RED-OBSERVED SIF-EDGE-VOCABULARY/${conjunctRefId} twin='${twinName}' lever=productionMutation → ${verdictIsRed ? 'FAIL' : 'PASS (DEFECTIVE)'}: ${detail}`);
	if (verdictIsRed) {
		observedRedList.push(`${conjunctRefId}/${twinName}`);
	}
};

// (a) — the kit compiled against a vocabulary without the row refuses the type BY NAME
V1_EDGE_TYPE_NAME_LIST.forEach((oneName) => {
	moduleDouble.assertMutationApplies({ modulePath: VOCABULARY_PATH, find: edgeTypeRowText(oneName) });
	const kitModuleDouble = moduleDouble.loadWithMutations({ modulePath: KIT_PATH, mutationList: [{ modulePath: VOCABULARY_PATH, find: edgeTypeRowText(oneName), replace: '' }] });
	const { refusalMessage } = addEdgeOutcome(kitFor(kitModuleDouble), oneName);
	const refusedByName = refusalMessage.indexOf(`edge type '${oneName}' is not a member of EDGE_TYPES`) !== -1;
	recordRed({ conjunctRefId: `a_kitAcceptsType ${oneName}`, twinName: `rowRemoved:${oneName}`, verdictIsRed: refusedByName, detail: refusalMessage || 'NOT REFUSED' });
});

// (b) — a definition missing makes the finisher refuse, naming the term
V1_EDGE_TYPE_NAME_LIST.forEach((oneName) => {
	moduleDouble.assertMutationApplies({ modulePath: DEFINITIONS_PATH, find: definitionOpeningText(oneName) });
	const verdict = judgeDefinitionComplete(withoutDefinition(oneName));
	const namesTheTerm = verdict.refusal.indexOf(`edgeType:${oneName}`) !== -1;
	recordRed({ conjunctRefId: 'b_finisherRefusesNothing', twinName: `definitionRemoved:${oneName}`, verdictIsRed: !verdict.pass && namesTheTerm, detail: verdict.detail });
});

// (c) — one MORE defined row: the finisher is satisfied, so only the count can go red
const extraRowName = 'V1_TWIN_EXTRA_EDGE';
const extraRowVocabulary = vocabularyDouble([
	{ modulePath: VOCABULARY_PATH, find: edgeTypeRowText('REFERENCES_OBJECT'), replace: `${edgeTypeRowText('REFERENCES_OBJECT')}${edgeTypeRowText(extraRowName)}` },
	{ modulePath: DEFINITIONS_PATH, find: definitionOpeningText('REFERENCES_OBJECT'), replace: `\t\t${extraRowName}: 'A defined twin row that exists only to move the count.',\n${definitionOpeningText('REFERENCES_OBJECT')}` },
]);
const extraRowCompleteness = judgeDefinitionComplete(extraRowVocabulary);
harness.ok('the extra-row twin is DEFINED, so the finisher does not refuse it (the red below is the count alone)', extraRowCompleteness.pass, extraRowCompleteness.detail);
const extraRowCount = schemaViewCount(extraRowVocabulary);
recordRed({ conjunctRefId: 'c_memberCountEqualsLiteral', twinName: 'definedExtraRow', verdictIsRed: extraRowCount !== SCHEMA_VIEW_MEMBER_COUNT_AFTER_V1 + SCHEMA_VIEW_MEMBER_ROWS_ADDED_AFTER_V1, detail: `count ${extraRowCount} vs literal ${SCHEMA_VIEW_MEMBER_COUNT_AFTER_V1 + SCHEMA_VIEW_MEMBER_ROWS_ADDED_AFTER_V1}` });

// (d) — without the row, the name list lacks it and the seam refuses the edge by name
const judgedSubjectRowText = "\tJUDGED_SUBJECT_STABLE_ID: 'judgedSubjectStableId',\n";
moduleDouble.assertMutationApplies({ modulePath: VOCABULARY_PATH, find: judgedSubjectRowText });
const rowRemovedMutation = { modulePath: VOCABULARY_PATH, find: judgedSubjectRowText, replace: '' };
const judgedSubjectRemovedVocabulary = vocabularyDouble([rowRemovedMutation]);
recordRed({ conjunctRefId: 'd_nameListCarriesJudgedSubject', twinName: 'judgedSubjectRowRemoved', verdictIsRed: judgedSubjectRemovedVocabulary.MAPPING_PROPERTY_NAME_LIST.indexOf('judgedSubjectStableId') === -1, detail: `${judgedSubjectRemovedVocabulary.MAPPING_PROPERTY_NAME_LIST.length} names` });
const seamVerdictWithoutRow = judgeSeamAcceptsJudgedSubject(moduleDouble.loadWithMutations({ modulePath: SEAM_RULES_PATH, mutationList: [rowRemovedMutation] }));
const seamRefusedByName = /edge property 'judgedSubjectStableId' is outside vocabulary\.MAPPING_PROPERTIES/.test(seamVerdictWithoutRow.detail);
recordRed({ conjunctRefId: 'd_seamAcceptsJudgedSubject', twinName: 'judgedSubjectRowRemoved', verdictIsRed: !seamVerdictWithoutRow.pass && seamRefusedByName, detail: seamVerdictWithoutRow.detail });

harness.equal('every twin was observed red (5 kit + 5 definition + 1 count + 2 mapping-property)', String(observedRedList.length), '13');

harness.report();
