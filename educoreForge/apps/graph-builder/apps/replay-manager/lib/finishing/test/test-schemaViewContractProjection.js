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
//   (f) ⟪ctdlHub P4⟫ a TERM-tier hub's own edges are members: HAS_<HUB>_TERM for a hub whose HubDefinition's slotProfile records
//       the term tier, and HAS_TERM_REFERENCE once when such a hub also mints the property tier; a hub without the term tier
//       (CEDS) gains neither, so its view is unchanged; emit reads the tiers from the slotProfile and refuses a HubDefinition
//       that carries none, by name
//   (d) COVERAGE over the frozen gold census (157 labels, 34 relationship types): residue EMPTY; and residueFor names a
//       planted uncatalogued label; the coverage finisher refuses a residue by name
// RED TWINS: embeddingDimsUndeclared (the contract row removed, a graph-contract double) -> (a) red — the cross-check
// W-A-3 named; standardBasePatternRemoved (the coverage finisher read with that pattern gone) -> (d) red; hubGenerationDropped
// (schema-view double) -> (b) red; termEdgeGenerationDropped -> (f) red; termEdgeForEveryHub -> (f) red.

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
// ⟪R5 S7⟫ the hubs' own edge definitions, as finishing.js hands them
const hubEdgeDefinitionRead = require(path.join(__dirname, '..', '..', '..', '..', 'forger', 'forger')).hubEdgeDefinitionByHubNameFor();

const projectionFaultListFor = (vocabularyInUse) => {
	const { members } = require(VIEW_PATH)({ vocabulary: vocabularyInUse, hubEdgeDefinitionRead }).buildMembers();
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
const twinMemberIds = require(VIEW_PATH)({ vocabulary: { ...vocabulary, PASSPORT_FIELD_LIST: contractDouble.PASSPORT_FIELD_LIST }, hubEdgeDefinitionRead }).buildMembers().members.map((oneMember) => oneMember.stableId);
harness.ok("(a) observed RED: with 'embeddingDims' undeclared the member vanishes (the W-A-3 cross-check)", twinMemberIds.indexOf('schemaView:passportField:embeddingDims') === -1 && twinFaultList.indexOf('passportField:embeddingDims') !== -1, `faults under the twin: ${twinFaultList.join(', ')}`);
harness.note("RED-OBSERVED a twin='embeddingDimsUndeclared' → schemaView:passportField:embeddingDims absent from the projection");

harness.section('(b) the hub edge types are generated for the hubs the graph holds');
const hubTypeListFor = (viewModule, hubNameList) => viewModule({ vocabulary, hubEdgeDefinitionRead }).buildMembers({ hubNameList }).members.filter((oneMember) => oneMember.kind === KINDS.EDGE_TYPE && /^HAS_CEDS_/.test(oneMember.value)).map((oneMember) => oneMember.value).sort();
const realHubTypeList = hubTypeListFor(require(VIEW_PATH), ['CEDS']);
harness.equal('five HAS_CEDS_* members for the CEDS hub', realHubTypeList.join(','), 'HAS_CEDS_DOMAIN,HAS_CEDS_PROPERTY,HAS_CEDS_QUALIFIER,HAS_CEDS_RANGE,HAS_CEDS_VALUE');
let emittedHubTypeList = [];
// a HubDefinition row as emit's hub query returns it: the hub's name and its slotProfile (the tiers are read from it)
const slotProfileTextFor = ({ withTermTier }) => JSON.stringify({ ...(withTermTier ? { termAddressSignatureFieldOrder: ['hubName', 'termIri', 'hubVersion'] } : {}), fieldList: [{ fieldName: 'hubName', tierList: withTermTier ? ['property', 'value', 'term'] : ['property', 'value'] }] });
const hubRecordOf = ({ hubName, slotProfile }) => ({ get: (fieldName) => ({ hubName, slotProfile })[fieldName] });
const readQueryOver = (hubRecordList) => ({ cypher }, readCallback) => readCallback('', { records: /HubDefinition/.test(cypher) ? hubRecordList : [] });
require(VIEW_PATH)({ vocabulary, hubEdgeDefinitionRead }).emit({ readQuery: readQueryOver([hubRecordOf({ hubName: 'CEDS', slotProfile: slotProfileTextFor({ withTermTier: false }) })]) }, (err, result) => {
	emittedHubTypeList = ((result || {}).nodes || []).filter((oneNode) => /^HAS_CEDS_/.test(oneNode.properties.value)).map((oneNode) => oneNode.properties.value);
});
harness.equal('emit reads the hubs and emits the five', emittedHubTypeList.length, 5);
const twinHubTypeList = hubTypeListFor(loadBuildJsDouble({ buildJsPath: VIEW_PATH, mutationList: [{ find: '			uniq(hubNameList).forEach((oneHubName) =>', replace: '			[].forEach((oneHubName) =>' }] }), ['CEDS']);
harness.ok("(b) observed RED under 'hubGenerationDropped'", twinHubTypeList.length === 0, twinHubTypeList.join(','));
harness.note(`RED-OBSERVED b twin='hubGenerationDropped' → ${twinHubTypeList.length} HAS_CEDS_* member(s)`);

harness.section('(f) a term-tier hub\'s own edges are members; CEDS gains none');
// what the TIER RECORDS add: the edge-type members of the build, less those of the same hubs with no tier record (the
// catalogue's own edge types, HAS_SCHEMA_TERM among them, are in both)
const edgeTypeValueListOf = (viewModule, buildInput) => viewModule({ vocabulary, hubEdgeDefinitionRead }).buildMembers(buildInput).members.filter((oneMember) => oneMember.kind === KINDS.EDGE_TYPE).map((oneMember) => oneMember.value);
const termEdgeTypeListFor = (viewModule, buildInput) => {
	const withoutTierList = edgeTypeValueListOf(viewModule, { hubNameList: buildInput.hubNameList });
	return edgeTypeValueListOf(viewModule, buildInput).filter((oneValue) => withoutTierList.indexOf(oneValue) === -1).sort();
};
const ctdlAndCedsInput = { hubNameList: ['CEDS', 'CTDL'], hubTierListByName: { CEDS: ['property', 'value'], CTDL: ['property', 'value', 'term'] } };
harness.equal('(f) CTDL (term tier) gains HAS_CTDL_TERM and HAS_TERM_REFERENCE; CEDS gains nothing', termEdgeTypeListFor(require(VIEW_PATH), ctdlAndCedsInput).join(','), 'HAS_CTDL_TERM,HAS_TERM_REFERENCE');
harness.equal('(f) a term-only hub gets HAS_<HUB>_TERM but no HAS_TERM_REFERENCE (no property card to point from)', termEdgeTypeListFor(require(VIEW_PATH), { hubNameList: ['TERMONLY'], hubTierListByName: { TERMONLY: ['term'] } }).join(','), 'HAS_TERMONLY_TERM');
const memberIdListOf = (buildInput) => require(VIEW_PATH)({ vocabulary, hubEdgeDefinitionRead }).buildMembers(buildInput).members.map((oneMember) => oneMember.stableId).join('|');
harness.equal('(f) the CEDS view is byte-unchanged: with its tiers declared it equals the pre-P4 call', memberIdListOf({ hubNameList: ['CEDS'], hubTierListByName: { CEDS: ['property', 'value'] } }), memberIdListOf({ hubNameList: ['CEDS'] }));
let emittedTermTypeList = [];
require(VIEW_PATH)({ vocabulary, hubEdgeDefinitionRead }).emit({ readQuery: readQueryOver([hubRecordOf({ hubName: 'CTDL', slotProfile: slotProfileTextFor({ withTermTier: true }) })]) }, (err, result) => {
	emittedTermTypeList = ((result || {}).nodes || []).map((oneNode) => oneNode.properties.value).filter((oneValue) => /^HAS_CTDL_TERM$|^HAS_TERM_REFERENCE$/.test(oneValue)).sort();
});
harness.equal('(f) emit reads the tiers from the slotProfile and emits both', emittedTermTypeList.join(','), 'HAS_CTDL_TERM,HAS_TERM_REFERENCE');
let profilelessRefusal = '';
require(VIEW_PATH)({ vocabulary, hubEdgeDefinitionRead }).emit({ readQuery: readQueryOver([hubRecordOf({ hubName: 'CTDL', slotProfile: null })]) }, (err) => { profilelessRefusal = String(err || ''); });
harness.match('(f) a HubDefinition with no slotProfile is REFUSED by name', profilelessRefusal, /HubDefinition 'CTDL' carries no slotProfile/);
const droppedTwinList = termEdgeTypeListFor(loadBuildJsDouble({ buildJsPath: VIEW_PATH, mutationList: [{ find: "			termTierHubNameList.forEach((oneHubName) =>", replace: "			[].forEach((oneHubName) =>" }] }), ctdlAndCedsInput);
harness.ok("(f) observed RED under 'termEdgeGenerationDropped'", droppedTwinList.indexOf('HAS_CTDL_TERM') === -1, droppedTwinList.join(','));
harness.note(`RED-OBSERVED f twin='termEdgeGenerationDropped' → [${droppedTwinList.join(', ')}]`);
const everyHubTwinList = edgeTypeValueListOf(loadBuildJsDouble({ buildJsPath: VIEW_PATH, mutationList: [{ find: "const termTierHubNameList = uniq(hubNameList).filter((oneHubName) => (hubTierListByName[oneHubName] || []).indexOf(REFERENCE_TIER.TERM) !== -1);", replace: 'const termTierHubNameList = uniq(hubNameList);' }] }), ctdlAndCedsInput);
harness.ok("(f) observed RED under 'termEdgeForEveryHub' (CEDS would announce HAS_CEDS_TERM)", everyHubTwinList.indexOf('HAS_CEDS_TERM') !== -1, everyHubTwinList.filter((oneValue) => /_TERM$/.test(oneValue)).join(','));
harness.ok('(f) CONTROL: the real view does NOT announce HAS_CEDS_TERM', edgeTypeValueListOf(require(VIEW_PATH), ctdlAndCedsInput).indexOf('HAS_CEDS_TERM') === -1);
harness.note(`RED-OBSERVED f twin='termEdgeForEveryHub' → [${everyHubTwinList.filter((oneValue) => /_TERM$|TERM_REFERENCE/.test(oneValue)).join(', ')}]`);

harness.section('(c) the DME role labels are node-label members');
const nodeLabelValueList = require(VIEW_PATH)({ vocabulary, hubEdgeDefinitionRead }).buildMembers().members.filter((oneMember) => oneMember.kind === KINDS.NODE_LABEL).map((oneMember) => oneMember.value);
const missingRoleList = Object.keys(vocabulary.DME_ROLES).map((oneName) => vocabulary.DME_ROLES[oneName]).filter((oneRole) => nodeLabelValueList.indexOf(oneRole) === -1);
harness.ok('every DME role is a nodeLabel member (DmeEditHistoryEntry, DmeRestriction, DmeVocabularyTerm included)', missingRoleList.length === 0, missingRoleList.join(', '));

harness.section('(d) coverage: every live label and type is a member or producer-local');
const labelSetText = fs.readFileSync(path.join(CENSUS_DIR, 'goldEval261005LabelAndTypeList.json'), 'utf8');
const capturedCensus = JSON.parse(labelSetText);
// ⟪campaign P3⟫ a DECLARED DELTA, not a re-capture: names the capture (GOLD_EVAL_261005, before P3) holds that P3 retired.
// Each must be ABSENT from the vocabulary, or the delta would hide a real residue (asserted below).
const RETIRED_SINCE_CAPTURE_RELATIONSHIP_TYPE_LIST = Object.freeze(['CONSTRAINED_BY']); // W-C-2, TQ ruling S3: SIF's Field -> Codeset is HAS_OPTION_SET
const census = { ...capturedCensus, relationshipTypeList: capturedCensus.relationshipTypeList.filter((oneType) => RETIRED_SINCE_CAPTURE_RELATIONSHIP_TYPE_LIST.indexOf(oneType) === -1) };
const memberValueList = require(VIEW_PATH)({ vocabulary, hubEdgeDefinitionRead }).buildMembers({ hubNameList: ['CEDS'] }).members.filter((oneMember) => oneMember.kind === KINDS.NODE_LABEL || oneMember.kind === KINDS.EDGE_TYPE).map((oneMember) => oneMember.value);
const coverage = require(COVERAGE_PATH)({ vocabulary, hubEdgeDefinitionRead });
const residue = coverage.residueFor({ labelList: census.labelList, relationshipTypeList: census.relationshipTypeList, memberValueList });
harness.ok('every name the declared delta drops is truly retired: absent from EDGE_TYPES and from the captured census only by that delta', RETIRED_SINCE_CAPTURE_RELATIONSHIP_TYPE_LIST.every((oneType) => vocabulary.EDGE_TYPES[oneType] === undefined && capturedCensus.relationshipTypeList.indexOf(oneType) !== -1), RETIRED_SINCE_CAPTURE_RELATIONSHIP_TYPE_LIST.join(', '));
harness.ok(`the frozen gold census (${census.labelList.length} labels, ${census.relationshipTypeList.length} types) leaves NO residue`, residue.length === 0, residue.join(', '));
const plantedResidue = coverage.residueFor({ labelList: census.labelList.concat(['UncataloguedProbe']), relationshipTypeList: census.relationshipTypeList, memberValueList });
harness.equal('a planted uncatalogued label is named', plantedResidue.join(','), 'UncataloguedProbe');
let refusalText = '';
coverage.apply({ runCypher: ({ cypher }, callback) => callback('', { records: [{ get: (fieldName) => ({ labelList: ['ForgedNode', 'UncataloguedProbe'], relationshipTypeList: [], memberValueList: ['ForgedNode'] })[fieldName] }] }) }, (err) => { refusalText = err; });
harness.ok('the coverage finisher refuses a residue by name', /REFUSED: 1 live label\(s\)\/relationship type\(s\) .*UncataloguedProbe/.test(refusalText), refusalText);
const twinCoverage = loadBuildJsDouble({ buildJsPath: COVERAGE_PATH, mutationList: [{ find: 'const producerLocalPatternList = PRODUCER_LOCAL_LABEL_PATTERN_SOURCE_LIST.map((oneSource) => new RegExp(oneSource));', replace: "const producerLocalPatternList = PRODUCER_LOCAL_LABEL_PATTERN_SOURCE_LIST.filter((oneSource) => oneSource !== '^StandardBase$').map((oneSource) => new RegExp(oneSource));" }] })({ vocabulary, hubEdgeDefinitionRead });
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
// ⟪zeroBacklog lane D, D3-6 follower, 2026-10-22⟫ the old SIF forge (rootLabel SifRoot) retired to codeAttic, so no declaration mints a
// Sif* label any more; the same pre-fix list now leaves the three CTDL families' labels as residue, which is what keeps this twin red
harness.ok('(e) observed RED with the pre-fix pattern list (families it never declared: today the CTDL ones)', preFixResidue.length > 0 && preFixResidue.every((oneLabel) => /^Ctdl/.test(oneLabel)), preFixResidue.join(', '));
harness.note(`RED-OBSERVED e twin='oldSifFamilyUndeclared' → residue [${preFixResidue.join(', ')}]`);

harness.report();
