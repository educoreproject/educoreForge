#!/usr/bin/env node
'use strict';

// test-schemaViewContractProjection.js — gate for W-A-6 (V1-C20, V2-C31; campaign P2; ruling G15): the schema view projects
// the graph contract (one member per declared field and per declared list/integer name, each described by the contract's
// own meaning), generates the hub edge types for the hubs a graph holds, catalogues the DME role labels, and a finish-time
// coverage gate refuses a live label or relationship type that is neither a member nor a declared producer-local pattern.
//
// PROVES:
//   (a) schemaView:passportField:<name> for every PASSPORT_FIELD_LIST row, description === its meaning, fieldType/required/
//       writer on the member; likewise attestation and self-doc fields (<Label>.<name>), list- and integer-valued names
//   (b) buildMembers({ hubNameList: ['CEDS'] }) carries the five HAS_CEDS_* edge types; emit reads the hubs from the graph
//   (c) the role labels (DmeEditHistoryEntry, DmeRestriction, DmeVocabularyTerm, …) are nodeLabel members
//   (e) every forge declaration's label family (rootLabel and its prefix) is producer-local (fleet finding: old SIF)
//   (d) COVERAGE over the frozen gold census (157 labels, 34 relationship types): residue EMPTY; and residueFor names a
//       planted uncatalogued label; the coverage finisher refuses a residue by name
// RED TWINS: embeddingDimsUndeclared (the contract row removed, a graph-contract double) -> (a) red — the cross-check
// W-A-3 named; standardBasePatternRemoved (the coverage finisher read with that pattern gone) -> (d) red; hubGenerationDropped
// (schema-view double) -> (b) red.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: the schema view projects the graph contract and covers every live label and type
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../../../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');
const vocabulary = require('../../../../../../../lib/vocabulary/vocabulary');
const { loadBuildJsDouble } = require('../../../../../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');

const VIEW_PATH = path.join(__dirname, '..', 'lib', 'schema-view-finisher.js');
const COVERAGE_PATH = path.join(__dirname, '..', 'lib', 'schema-view-coverage-finisher.js');
const CONTRACT_PATH = path.join(__dirname, '..', '..', '..', '..', '..', '..', '..', 'lib', 'vocabulary', 'graph-contract.js');
const CENSUS_DIR = path.join(__dirname, '..', '..', '..', '..', '..', '..', '..', 'lib', 'replay', 'test', 'fixtures', 'liveCensus');
const KINDS = vocabulary.SCHEMA_VIEW.KINDS;

const projectionFaultListFor = (vocabularyInUse) => {
	const { members } = require(VIEW_PATH)({ vocabulary: vocabularyInUse }).buildMembers();
	const memberByStableId = members.reduce((soFar, oneMember) => ({ ...soFar, [oneMember.stableId]: oneMember }), {});
	const expectList = []
		.concat(vocabulary.PASSPORT_FIELD_LIST.map((oneRow) => ({ kind: KINDS.PASSPORT_FIELD, value: oneRow.name, meaning: oneRow.meaning, fieldType: oneRow.type })))
		.concat(vocabulary.ATTESTATION_FIELD_LIST.map((oneRow) => ({ kind: KINDS.ATTESTATION_FIELD, value: oneRow.name, meaning: oneRow.meaning, fieldType: oneRow.type })))
		.concat([['ManifestRecipe', vocabulary.MANIFEST_RECIPE_FIELD_LIST], ['RecipeBlock', vocabulary.RECIPE_BLOCK_FIELD_LIST], ['StandardDefinition', vocabulary.STANDARD_DEFINITION_FIELD_LIST], ['UsagePattern', vocabulary.USAGE_PATTERN_FIELD_LIST]].reduce((soFar, [oneLabel, oneList]) => soFar.concat(oneList.map((oneRow) => ({ kind: KINDS.SELF_DOC_FIELD, value: `${oneLabel}.${oneRow.name}`, meaning: oneRow.meaning, fieldType: oneRow.type }))), []))
		.concat(vocabulary.LIST_VALUED_PROPERTY_NAME_LIST.map((oneName) => ({ kind: KINDS.LIST_VALUED_PROPERTY, value: oneName })))
		.concat(vocabulary.INTEGER_VALUED_PROPERTY_NAME_LIST.map((oneName) => ({ kind: KINDS.INTEGER_VALUED_PROPERTY, value: oneName })));
	return expectList.filter((oneExpect) => {
		const member = memberByStableId[`${vocabulary.SCHEMA_VIEW.MEMBER_STABLE_ID_PREFIX}${oneExpect.kind}:${oneExpect.value}`];
		return !member || !member.description || (oneExpect.meaning !== undefined && member.description !== oneExpect.meaning) || (oneExpect.fieldType !== undefined && (member.memberPropertyByName || {}).fieldType !== oneExpect.fieldType);
	}).map((oneExpect) => `${oneExpect.kind}:${oneExpect.value}`);
};

harness.section('(a) the contract is projected, each member described by its contract meaning');
const faultList = projectionFaultListFor(vocabulary);
harness.ok('every declared field and name is a member with its meaning and type', faultList.length === 0, faultList.slice(0, 10).join(', '));
const contractDouble = loadBuildJsDouble({ buildJsPath: CONTRACT_PATH, mutationList: [{ find: "	{ name: 'embeddingDims', type: 'integer', required: true, writer: 'finish', meaning: 'the one distinct vector width over embedding and textEmbedding; refused when ≠ 1' },\n", replace: '' }] });
const twinFaultList = projectionFaultListFor({ ...vocabulary, PASSPORT_FIELD_LIST: contractDouble.PASSPORT_FIELD_LIST });
const twinMemberIds = require(VIEW_PATH)({ vocabulary: { ...vocabulary, PASSPORT_FIELD_LIST: contractDouble.PASSPORT_FIELD_LIST } }).buildMembers().members.map((oneMember) => oneMember.stableId);
harness.ok("(a) observed RED: with 'embeddingDims' undeclared the member vanishes (the W-A-3 cross-check)", twinMemberIds.indexOf('schemaView:passportField:embeddingDims') === -1 && twinFaultList.indexOf('passportField:embeddingDims') !== -1, `faults under the twin: ${twinFaultList.join(', ')}`);
harness.note("RED-OBSERVED a twin='embeddingDimsUndeclared' → schemaView:passportField:embeddingDims absent from the projection");

harness.section('(b) the hub edge types are generated for the hubs the graph holds');
const hubTypeListFor = (viewModule, hubNameList) => viewModule({ vocabulary }).buildMembers({ hubNameList }).members.filter((oneMember) => oneMember.kind === KINDS.EDGE_TYPE && /^HAS_CEDS_/.test(oneMember.value)).map((oneMember) => oneMember.value).sort();
const realHubTypeList = hubTypeListFor(require(VIEW_PATH), ['CEDS']);
harness.equal('five HAS_CEDS_* members for the CEDS hub', realHubTypeList.join(','), 'HAS_CEDS_DOMAIN,HAS_CEDS_PROPERTY,HAS_CEDS_QUALIFIER,HAS_CEDS_RANGE,HAS_CEDS_VALUE');
let emittedHubTypeList = [];
require(VIEW_PATH)({ vocabulary }).emit({ readQuery: ({ cypher }, readCallback) => readCallback('', { records: /HubDefinition/.test(cypher) ? [{ get: () => 'CEDS' }] : [] }) }, (err, result) => {
	emittedHubTypeList = ((result || {}).nodes || []).filter((oneNode) => /^HAS_CEDS_/.test(oneNode.properties.value)).map((oneNode) => oneNode.properties.value);
});
harness.equal('emit reads the hubs and emits the five', emittedHubTypeList.length, 5);
const twinHubTypeList = hubTypeListFor(loadBuildJsDouble({ buildJsPath: VIEW_PATH, mutationList: [{ find: '			uniq(hubNameList).forEach((oneHubName) =>', replace: '			[].forEach((oneHubName) =>' }] }), ['CEDS']);
harness.ok("(b) observed RED under 'hubGenerationDropped'", twinHubTypeList.length === 0, twinHubTypeList.join(','));
harness.note(`RED-OBSERVED b twin='hubGenerationDropped' → ${twinHubTypeList.length} HAS_CEDS_* member(s)`);

harness.section('(c) the DME role labels are node-label members');
const nodeLabelValueList = require(VIEW_PATH)({ vocabulary }).buildMembers().members.filter((oneMember) => oneMember.kind === KINDS.NODE_LABEL).map((oneMember) => oneMember.value);
const missingRoleList = Object.keys(vocabulary.DME_ROLES).map((oneName) => vocabulary.DME_ROLES[oneName]).filter((oneRole) => nodeLabelValueList.indexOf(oneRole) === -1);
harness.ok('every DME role is a nodeLabel member (DmeEditHistoryEntry, DmeRestriction, DmeVocabularyTerm included)', missingRoleList.length === 0, missingRoleList.join(', '));

harness.section('(d) coverage: every live label and type is a member or producer-local');
const labelSetText = fs.readFileSync(path.join(CENSUS_DIR, 'goldEval261005LabelAndTypeList.json'), 'utf8');
const census = JSON.parse(labelSetText);
const memberValueList = require(VIEW_PATH)({ vocabulary }).buildMembers({ hubNameList: ['CEDS'] }).members.filter((oneMember) => oneMember.kind === KINDS.NODE_LABEL || oneMember.kind === KINDS.EDGE_TYPE).map((oneMember) => oneMember.value);
const coverage = require(COVERAGE_PATH)({ vocabulary });
const residue = coverage.residueFor({ labelList: census.labelList, relationshipTypeList: census.relationshipTypeList, memberValueList });
harness.ok(`the frozen gold census (${census.labelList.length} labels, ${census.relationshipTypeList.length} types) leaves NO residue`, residue.length === 0, residue.join(', '));
const plantedResidue = coverage.residueFor({ labelList: census.labelList.concat(['UncataloguedProbe']), relationshipTypeList: census.relationshipTypeList, memberValueList });
harness.equal('a planted uncatalogued label is named', plantedResidue.join(','), 'UncataloguedProbe');
let refusalText = '';
coverage.apply({ runCypher: ({ cypher }, callback) => callback('', { records: [{ get: (fieldName) => ({ labelList: ['ForgedNode', 'UncataloguedProbe'], relationshipTypeList: [], memberValueList: ['ForgedNode'] })[fieldName] }] }) }, (err) => { refusalText = err; });
harness.ok('the coverage finisher refuses a residue by name', /REFUSED: 1 live label\(s\)\/relationship type\(s\) .*UncataloguedProbe/.test(refusalText), refusalText);
const twinCoverage = loadBuildJsDouble({ buildJsPath: COVERAGE_PATH, mutationList: [{ find: 'const producerLocalPatternList = PRODUCER_LOCAL_LABEL_PATTERN_SOURCE_LIST.map((oneSource) => new RegExp(oneSource));', replace: "const producerLocalPatternList = PRODUCER_LOCAL_LABEL_PATTERN_SOURCE_LIST.filter((oneSource) => oneSource !== '^StandardBase$').map((oneSource) => new RegExp(oneSource));" }] })({ vocabulary });
const twinResidue = twinCoverage.residueFor({ labelList: census.labelList, relationshipTypeList: census.relationshipTypeList, memberValueList });
harness.ok("(d) observed RED with the StandardBase pattern removed", twinResidue.indexOf('StandardBase') !== -1, twinResidue.join(', '));
harness.note(`RED-OBSERVED d twin='standardBasePatternRemoved' → residue [${twinResidue.join(', ')}]`);

// (e) campaign P2 fleet finding: every forge's per-standard label family is producer-local — the root label and any label
// minted under its prefix. The gold census held no old-SIF graph, so 'Sif<Kind>' (forges/sif, rootLabel SifRoot) was missing
// from the pattern list and the embedded sifOnly build was refused at finish naming ten Sif* labels.
const forgeDeclarationPathList = fs.readdirSync(path.join(__dirname, '..', '..', '..', '..', '..', '..', '..', 'forges'), { withFileTypes: true })
	.filter((oneEntry) => oneEntry.isDirectory())
	.map((oneEntry) => path.join(__dirname, '..', '..', '..', '..', '..', '..', '..', 'forges', oneEntry.name, 'lib'))
	.filter((oneDirPath) => fs.existsSync(oneDirPath))
	.reduce((soFar, oneDirPath) => soFar.concat(fs.readdirSync(oneDirPath).filter((oneName) => /ForgeDeclaration\.js$/.test(oneName)).map((oneName) => path.join(oneDirPath, oneName))), []);
const forgeFamilyLabelList = forgeDeclarationPathList.map((oneDeclarationPath) => require(oneDeclarationPath).rootLabel).filter(Boolean)
	.reduce((soFar, oneRootLabel) => soFar.concat([oneRootLabel, `${oneRootLabel.replace(/(Root|Ontology)$/, '')}ProbeKind`]), []);
const forgeFamilyResidueFor = (coverageModule) => coverageModule.residueFor({ labelList: forgeFamilyLabelList, relationshipTypeList: [], memberValueList: [] });
const forgeFamilyResidue = forgeFamilyResidueFor(coverage);
harness.ok(`(e) every forge's label family (${forgeDeclarationPathList.length} declarations: ${forgeFamilyLabelList.filter((one, position) => position % 2 === 0).join(', ')}) is producer-local`, forgeDeclarationPathList.length >= 5 && forgeFamilyResidue.length === 0, forgeFamilyResidue.join(', ') || 'no residue');
const preFixPatternList = ['^(Ceds|Edfi|Sif260928|Pesc[A-Za-z0-9]+)[A-Z]', '^StandardBase$', '^BridgedRelation_'];
const preFixResidue = forgeFamilyResidueFor(require(COVERAGE_PATH)({ vocabulary: { ...vocabulary, PRODUCER_LOCAL_LABEL_PATTERN_SOURCE_LIST: preFixPatternList } }));
harness.ok('(e) observed RED with the pre-fix pattern list (no old-SIF family)', preFixResidue.some((oneLabel) => /^Sif[A-Z]/.test(oneLabel)), preFixResidue.join(', '));
harness.note(`RED-OBSERVED e twin='oldSifFamilyUndeclared' → residue [${preFixResidue.join(', ')}]`);

harness.report();
