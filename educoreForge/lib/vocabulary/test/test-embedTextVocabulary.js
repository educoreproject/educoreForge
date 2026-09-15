#!/usr/bin/env node
'use strict';

// test-embedTextVocabulary.js — the gate for the embed-text vocabulary (PLAN-forgeEmbedText-091426.md §4 P2,
// §8.1 R-ET-4, §8.3 R-ET-4 revised and R-ET-24). This locks:
//   (a) DME_ROLES.EMBED_TEXT is 'DmeEmbedText' and is a DME_ROLES MEMBER — the forge framework admits a role
//       through Object.values(DME_ROLES), so membership, not the named token alone, is what P3 relies on;
//   (b) EDGE_TYPES.EMBEDS_TEXT_OF is 'EMBEDS_TEXT_OF' and passes the replay guard's edge-type pattern;
//   (c) EMBED_TEXT_VECTOR is EXACTLY { label, propertyName, indexNameSuffix } with the ruled values, and frozen
//       — P4 builds the second vector index's DDL from it, so an extra or renamed field is a defect here;
//   (d) its label IS the role, read from DME_ROLES rather than re-typed: the index must cover the label the
//       role mints, and two spellings of one name is how they come apart;
//   (e) both new terms carry a definition in the bucket the schema-view finisher READS (SCHEMA_VIEW.KINDS);
//   (f) the edge definition states the shape a graph consumer needs: direction, one edge per pair, the sorted
//       propertyNameList, the loader's scalar collapse and the reader's re-widen, the structural tier;
//   (g) the role definition states that the node carries no embedding and names the index that does.
// RED TWINS: every conjunct is observed RED under an in-memory module double
// (lib/forge-framework/test/testSupport/moduleDouble.js) — no file is written. Pure; no docker, no database,
// no network.
//
// Run: node lib/vocabulary/test/test-embedTextVocabulary.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gate for the embed-text vocabulary (DmeEmbedText, EMBEDS_TEXT_OF, EMBED_TEXT_VECTOR)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
DESCRIPTION
     Locks the role, the edge type and the frozen vector-index descriptor P4 imports, the descriptor's label
     read from the role, and the definitions of both terms in the buckets the schema-view finisher reads.
     Every conjunct is observed RED under an in-memory vocabulary double. Pure.
EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');
const harness = require('../../../test/testLib/harness')(moduleName);
const vocabulary = require('../vocabulary');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));

const VOCABULARY_PATH = path.join(__dirname, '..', 'vocabulary.js');
const DEFINITIONS_PATH = path.join(__dirname, '..', 'vocabulary-definitions.js');

// the ruled descriptor (PLAN §8.3 R-ET-24), stated independently of the module it checks
const EXPECTED_VECTOR_DESCRIPTOR = { label: 'DmeEmbedText', propertyName: 'textEmbedding', indexNameSuffix: '_embedText_vector' };

// the clauses a graph consumer needs from the edge definition (R-ET-4 revised), each named for its refusal
const EDGE_DEFINITION_CLAUSE_LIST = [
	{ clauseName: 'direction', pattern: /\(DmeEmbedText\)-\[:EMBEDS_TEXT_OF\]->\(described node\)/ },
	{ clauseName: 'structural tier', pattern: /provenanceTier 'structural'/ },
	{ clauseName: 'one edge per pair', pattern: /ONE edge per distinct \(text node, described node\) pair/ },
	{ clauseName: 'sorted propertyNameList', pattern: /propertyNameList — the SORTED list/ },
	{ clauseName: 'loader scalar collapse', pattern: /stores a one-element list as a SCALAR/ },
	{ clauseName: 'reader re-widen', pattern: /re-widens a scalar propertyNameList to a one-element list/ },
];

const ROLE_DEFINITION_CLAUSE_LIST = [
	{ clauseName: 'carries no embedding', pattern: /NO name, NO searchText and NO embedding property/ },
	{ clauseName: 'vector property', pattern: /vector lives on textEmbedding/ },
	{ clauseName: 'own index', pattern: /<graphName>_embedText_vector/ },
	{ clauseName: 'DME search reads only the ordinary index', pattern: /reads only <graphName>_vector/ },
];

const isDefinitionText = (oneText) => typeof oneText === 'string' && oneText.trim() !== '';

const missingClauseNameList = (definitionText, clauseList) =>
	clauseList.filter((oneClause) => !isDefinitionText(definitionText) || !oneClause.pattern.test(definitionText)).map((oneClause) => oneClause.clauseName);

// ---------------------------------------------------------------------------------------------------
// THE CONJUNCTS — pure judges over a vocabulary module (the real one, or an in-memory double)
// ---------------------------------------------------------------------------------------------------
const conjunctJudgeByRefId = {
	a_embedTextRoleIsADmeRolesMember: (subject) => {
		const roleName = subject.DME_ROLES.EMBED_TEXT;
		const isMember = Object.values(subject.DME_ROLES).indexOf(EXPECTED_VECTOR_DESCRIPTOR.label) !== -1;
		return { pass: roleName === EXPECTED_VECTOR_DESCRIPTOR.label && isMember, detail: `DME_ROLES.EMBED_TEXT ${JSON.stringify(roleName)}; 'DmeEmbedText' in Object.values(DME_ROLES) ${isMember}` };
	},
	b_embedsTextOfEdgeTypeRegistered: (subject) => {
		const edgeTypeName = subject.EDGE_TYPES.EMBEDS_TEXT_OF;
		const passesGuard = subject.isValidEdgeType(edgeTypeName);
		return { pass: edgeTypeName === 'EMBEDS_TEXT_OF' && passesGuard, detail: `EDGE_TYPES.EMBEDS_TEXT_OF ${JSON.stringify(edgeTypeName)}; isValidEdgeType ${passesGuard}` };
	},
	c_vectorDescriptorExactAndFrozen: (subject) => {
		const descriptor = subject.EMBED_TEXT_VECTOR;
		if (descriptor === undefined) {
			return { pass: false, detail: 'EMBED_TEXT_VECTOR is ABSENT from the vocabulary exports' };
		}
		const observedFieldNameText = JSON.stringify(Object.keys(descriptor).sort());
		const expectedFieldNameText = JSON.stringify(Object.keys(EXPECTED_VECTOR_DESCRIPTOR).sort());
		const wrongFieldNameList = Object.keys(EXPECTED_VECTOR_DESCRIPTOR).filter((oneFieldName) => descriptor[oneFieldName] !== EXPECTED_VECTOR_DESCRIPTOR[oneFieldName]);
		const isFrozen = Object.isFrozen(descriptor);
		return {
			pass: observedFieldNameText === expectedFieldNameText && wrongFieldNameList.length === 0 && isFrozen,
			detail: `${JSON.stringify(descriptor)}; fields ${observedFieldNameText} (want ${expectedFieldNameText}); wrong values [${wrongFieldNameList.join(', ')}]; frozen ${isFrozen}`,
		};
	},
	d_vectorLabelIsTheRole: (subject) => {
		const descriptorLabel = (subject.EMBED_TEXT_VECTOR || {}).label;
		return {
			pass: descriptorLabel !== undefined && descriptorLabel === subject.DME_ROLES.EMBED_TEXT,
			detail: `EMBED_TEXT_VECTOR.label ${JSON.stringify(descriptorLabel)} vs DME_ROLES.EMBED_TEXT ${JSON.stringify(subject.DME_ROLES.EMBED_TEXT)}`,
		};
	},
	e_bothTermsDefinedInTheBucketsTheFinisherReads: (subject) => {
		const definitionsByKind = subject.TERM_DEFINITIONS || {};
		const roleDefinition = (definitionsByKind[subject.SCHEMA_VIEW.KINDS.DME_ROLE] || {})[EXPECTED_VECTOR_DESCRIPTOR.label];
		const edgeDefinition = (definitionsByKind[subject.SCHEMA_VIEW.KINDS.EDGE_TYPE] || {}).EMBEDS_TEXT_OF;
		return {
			pass: isDefinitionText(roleDefinition) && isDefinitionText(edgeDefinition),
			detail: `dmeRole:DmeEmbedText ${isDefinitionText(roleDefinition) ? 'defined' : 'MISSING'}; edgeType:EMBEDS_TEXT_OF ${isDefinitionText(edgeDefinition) ? 'defined' : 'MISSING'}`,
		};
	},
	f_edgeDefinitionStatesTheShape: (subject) => {
		const edgeDefinition = ((subject.TERM_DEFINITIONS || {}).edgeType || {}).EMBEDS_TEXT_OF;
		const missingList = missingClauseNameList(edgeDefinition, EDGE_DEFINITION_CLAUSE_LIST);
		return { pass: missingList.length === 0, detail: missingList.length ? `edge definition lacks: ${missingList.join(', ')}` : `${EDGE_DEFINITION_CLAUSE_LIST.length} clauses present` };
	},
	g_roleDefinitionStatesNoEmbeddingAndItsIndex: (subject) => {
		const roleDefinition = ((subject.TERM_DEFINITIONS || {}).dmeRole || {}).DmeEmbedText;
		const missingList = missingClauseNameList(roleDefinition, ROLE_DEFINITION_CLAUSE_LIST);
		return { pass: missingList.length === 0, detail: missingList.length ? `role definition lacks: ${missingList.join(', ')}` : `${ROLE_DEFINITION_CLAUSE_LIST.length} clauses present` };
	},
};

// =====================================================================
harness.section('BASELINE — the real vocabulary passes every conjunct');
// =====================================================================
Object.keys(conjunctJudgeByRefId).forEach((oneRefId) => {
	const verdict = conjunctJudgeByRefId[oneRefId](vocabulary);
	harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail);
});

// =====================================================================
harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under a vocabulary double (in memory)');
// =====================================================================
const twinList = [
	{
		// the role renamed: (a) goes red, and (d) STAYS GREEN because the descriptor reads its label from the
		// role — observed below as the proof that the label is derived, not a second spelling
		conjunctRefIdList: ['a_embedTextRoleIsADmeRolesMember', 'c_vectorDescriptorExactAndFrozen'],
		greenRefIdList: ['d_vectorLabelIsTheRole'],
		twinName: 'roleRenamed',
		mutationList: [{ modulePath: VOCABULARY_PATH, find: "\tEMBED_TEXT: 'DmeEmbedText',\n", replace: "\tEMBED_TEXT: 'DmeEmbeddedText',\n" }],
	},
	{
		conjunctRefIdList: ['b_embedsTextOfEdgeTypeRegistered'],
		twinName: 'edgeTypeRemoved',
		mutationList: [{ modulePath: VOCABULARY_PATH, find: "\tEMBEDS_TEXT_OF: 'EMBEDS_TEXT_OF',\n", replace: '' }],
	},
	{
		conjunctRefIdList: ['c_vectorDescriptorExactAndFrozen'],
		twinName: 'descriptorPropertyNameIsTheOrdinaryEmbedding',
		mutationList: [{ modulePath: VOCABULARY_PATH, find: "\tpropertyName: 'textEmbedding',\n", replace: "\tpropertyName: 'embedding',\n" }],
	},
	{
		// the registry's export loop ALSO freezes every top-level member, so unfreezing needs both levers
		conjunctRefIdList: ['c_vectorDescriptorExactAndFrozen'],
		twinName: 'descriptorUnfrozen',
		mutationList: [
			{ modulePath: VOCABULARY_PATH, find: 'const EMBED_TEXT_VECTOR = Object.freeze({', replace: 'const EMBED_TEXT_VECTOR = ({' },
			{ modulePath: VOCABULARY_PATH, find: '\t\tObject.freeze(value);\n', replace: '' },
		],
	},
	{
		conjunctRefIdList: ['d_vectorLabelIsTheRole'],
		twinName: 'descriptorLabelRetypedDifferently',
		mutationList: [{ modulePath: VOCABULARY_PATH, find: '\tlabel: DME_ROLES.EMBED_TEXT,\n', replace: "\tlabel: 'DmeEmbeddedText',\n" }],
	},
	{
		conjunctRefIdList: ['e_bothTermsDefinedInTheBucketsTheFinisherReads', 'g_roleDefinitionStatesNoEmbeddingAndItsIndex'],
		twinName: 'roleDefinitionRemoved',
		mutationList: [{ modulePath: DEFINITIONS_PATH, find: '\t\tDmeEmbedText:\n', replace: '\t\tDmeEmbedTextRemovedByTwin:\n' }],
	},
	{
		conjunctRefIdList: ['e_bothTermsDefinedInTheBucketsTheFinisherReads', 'f_edgeDefinitionStatesTheShape'],
		twinName: 'edgeDefinitionRemoved',
		mutationList: [{ modulePath: DEFINITIONS_PATH, find: '\t\tEMBEDS_TEXT_OF:\n', replace: '\t\tEMBEDS_TEXT_OF_REMOVED_BY_TWIN:\n' }],
	},
	{
		conjunctRefIdList: ['f_edgeDefinitionStatesTheShape'],
		twinName: 'edgeDefinitionDropsTheScalarCollapse',
		mutationList: [{ modulePath: DEFINITIONS_PATH, find: 'stores a one-element list as a SCALAR', replace: 'stores a one-element list as a list' }],
	},
	{
		conjunctRefIdList: ['g_roleDefinitionStatesNoEmbeddingAndItsIndex'],
		twinName: 'roleDefinitionClaimsAnEmbedding',
		mutationList: [{ modulePath: DEFINITIONS_PATH, find: 'NO name, NO searchText and NO embedding property', replace: 'NO name, NO searchText and an embedding property' }],
	},
];

const observedRedSet = new Set();
twinList.forEach((oneTwin) => {
	oneTwin.mutationList.forEach((oneMutation) => moduleDouble.assertMutationApplies({ modulePath: oneMutation.modulePath, find: oneMutation.find }));
	const doubled = moduleDouble.loadWithMutations({ modulePath: VOCABULARY_PATH, mutationList: oneTwin.mutationList });
	oneTwin.conjunctRefIdList.forEach((oneRefId) => {
		const verdict = conjunctJudgeByRefId[oneRefId](doubled);
		harness.ok(`${oneRefId} observed RED under twin '${oneTwin.twinName}' (productionMutation)`, verdict.pass === false, verdict.detail);
		if (verdict.pass === false) {
			observedRedSet.add(oneRefId);
		}
		process.global.xLog.status(`  RED-OBSERVED EMBED-TEXT-VOCABULARY/${oneRefId} twin='${oneTwin.twinName}' lever=productionMutation → ${verdict.pass ? 'PASS (DEFECTIVE)' : 'FAIL'}: ${verdict.detail}`);
	});
	(oneTwin.greenRefIdList || []).forEach((oneRefId) => {
		const verdict = conjunctJudgeByRefId[oneRefId](doubled);
		harness.ok(`${oneRefId} stays GREEN under twin '${oneTwin.twinName}' (the label is derived from the role)`, verdict.pass === true, verdict.detail);
	});
});

harness.equal('every conjunct was observed red', observedRedSet.size, Object.keys(conjunctJudgeByRefId).length);
process.global.xLog.status(`  EMBED-TEXT-VOCABULARY: ${observedRedSet.size}/${Object.keys(conjunctJudgeByRefId).length} conjuncts observed red, ${twinList.length} twin runs`);

harness.report();
