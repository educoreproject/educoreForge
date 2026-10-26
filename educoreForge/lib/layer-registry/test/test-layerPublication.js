#!/usr/bin/env node
'use strict';

// test-layerPublication.js — gates for lib/layer-registry/layerPublication.js (mappingLayers ML3-a/b; rulings R-a, R-b, R-c', R-e; TQ Q37).
// On REAL decision-block slices (lib/layer-agreement/test/fixtures, the Ed-Fi block and a PESC fan-out block) and a STATED curated set:
// subject_id is the encoded CURIE whose plain expansion is the element IRI; every record_id recomputes from its row ALONE; one set per
// version carries the pinned set identity; a curated row hashes its ONE author and two authors of one triple get two record_ids; a public
// filtered rendering omits the held standards and says so; registry documents carry the effective status; contexts map element terms
// to pinned interpretation URIs; the same inputs give the same bytes.
//
// Run: node lib/layer-registry/test/test-layerPublication.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for lib/layer-registry/layerPublication.js

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the public renderings of layer versions: encoded subjects, recomputable record_ids (machine s p o; curated s p o author),
     one set per version with its pinned identity, public filtering by the licence hold list, registry documents and contexts.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const crypto = require('crypto');
const harness = require('../../../test/testLib/harness')(moduleName);
const publication = require('../layerPublication');
const { registryFor } = require('../layerRegistry');
const edcUri = require('../../edc-uri/edcUri');
const subjectCurieLib = require('../../edc-uri/subjectCurie');
const edfiSlice = require('../../layer-agreement/test/fixtures/edfiBlockSlice.json');
const pescSlice = require('../../layer-agreement/test/fixtures/pescFanOutBlockSlice.json');

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const ORGANISATION_IRI = 'https://w3id.org/EDUcore/agent/org/educore';
const JUDGE_IRI = 'https://w3id.org/EDUcore/agent/judge/jev:jev-1.13.0:data:cfg-03f64470322c';
const RATER_A_IRI = 'https://w3id.org/EDUcore/agent/raterA';
const RATER_B_IRI = 'https://w3id.org/EDUcore/agent/raterB';
const agentRegistry = { agentList: [{ agentIri: ORGANISATION_IRI, agentKind: 'organisation', displayName: 'EDUcore' }, { agentIri: JUDGE_IRI, agentKind: 'judge', displayName: 'Jev' }, { agentIri: RATER_A_IRI, agentKind: 'person', displayName: 'rater A' }, { agentIri: RATER_B_IRI, agentKind: 'person', displayName: 'rater B' }] };
// stated cards for every object the two slices name (labels are test text, never published)
const cardByStableId = [edfiSlice, pescSlice].reduce((soFar, oneSlice) => oneSlice.decisionRecordList.filter((oneRecord) => typeof oneRecord.objectStableId === 'string' && oneRecord.objectStableId.length).reduce((soFarInner, oneRecord) => ({ ...soFarInner, [oneRecord.objectStableId]: { uri: oneRecord.objectStableId, name: 'a stated card' } }), soFar), {});
const EDFI_HASH = 'e'.repeat(64);
const PESC_HASH = 'a'.repeat(64);
const memberList = [{ pairKey: 'ceds@14.0.0.0::edfi@5.2.0::edfiCedsDerivedPlugin::inferred', decisionBlockHash: EDFI_HASH }, { pairKey: 'ceds@14.0.0.0::pesccollegetranscript1v7v0@1.7.0::pescCollegeTranscript1v7v0CedsDerivedPlugin::inferred', decisionBlockHash: PESC_HASH }];
const machineLayer = { layerKey: 'jevToy', displayName: 'a toy judge layer', layerKind: 'judge', authorAgentIri: JUDGE_IRI };
const machineVersion = { administrationRecord: { versionTag: 'base', contentId: 'c'.repeat(64), publishedAt: '2026-10-25T00:00:00Z' }, registrationStatus: 'Standard', authorAgentIri: JUDGE_IRI, contentIdBasis: 'sortedMemberBlockHashList', memberBlockList: memberList, copiedFromLayerVersion: 'https://w3id.org/EDUcore/layer/jev/cfg-03f64470322c' };
// ⟪ML3.1, Q42⟫ STATED subject labels (test text): every Ed-Fi subject but the first; no PESC subject (so every PESC label is empty)
const edfiSubjectStableIdList = Array.from(new Set(edfiSlice.decisionRecordList.reduce((soFar, oneRecord) => soFar.concat(oneRecord.instanceStableIdList === undefined ? [oneRecord.subjectStableId] : oneRecord.instanceStableIdList), [])));
const subjectLabelByStableId = edfiSubjectStableIdList.slice(1).reduce((soFar, oneStableId) => ({ ...soFar, [oneStableId]: `stated label ${oneStableId.slice(oneStableId.lastIndexOf('.') + 1)}` }), { 'edfi:property/abstractEntity.X': 'EducationOrganization.X' });
const memberRowsList = [[memberList[0], edfiSlice], [memberList[1], pescSlice]].map(([member, decisionBlock]) => publication.machineMemberRowsFor({ member, decisionBlock, cardByStableId, subjectLabelByStableId }));
const publicFilter = publication.publicFilterFor({ licenceHoldList: [{ bundleToken: 'edfi' }, { bundleToken: 'jedx' }], filterSourceText: 'a stated hold list' }).publicFilter;
const headerScalarOf = (setText, slotName) => {
	const line = setText.split('\n').find((oneLine) => oneLine.startsWith(`#${slotName}: `));
	return line === undefined ? undefined : JSON.parse(line.slice(slotName.length + 3));
};
const rowsOf = (setText) => {
	const bodyLineList = setText.split('\n').filter((oneLine) => oneLine.length && !oneLine.startsWith('#'));
	const columnList = bodyLineList[0].split('\t');
	return { columnList, rowList: bodyLineList.slice(1).map((oneLine) => oneLine.split('\t').reduce((soFar, oneCell, cellIndex) => ({ ...soFar, [columnList[cellIndex]]: oneCell }), {})) };
};

// =====================================================================
harness.section('machine member rows: the exporter\'s own rows, given their public form (R-a)');
// =====================================================================

harness.ok('both real slices render as member rows', memberRowsList.every((oneResult) => oneResult.error === undefined), memberRowsList.map((oneResult) => oneResult.error).join(' | '));
const edfiMemberRows = memberRowsList[0].memberRows;
harness.ok("⟪ML3.1, Q42⟫ every subject_id keeps its real '/' and no '%2F'", edfiMemberRows.rowList.every((oneEntry) => oneEntry.row.subject_id.indexOf('/') !== -1 && oneEntry.row.subject_id.indexOf('%2F') === -1 && oneEntry.row.subject_id.indexOf('edfi:') === 0));
harness.ok('⟪ML3.1, Q42⟫ subject_label is the stated label, verbatim, where one exists', edfiMemberRows.rowList.every((oneEntry) => oneEntry.row.subject_label === (subjectLabelByStableId[oneEntry.subjectStableId] || '')));
harness.equal('⟪ML3.1⟫ a subject with no label gets an EMPTY cell, counted (never composed)', edfiMemberRows.emptySubjectLabelCount, edfiMemberRows.rowList.filter((oneEntry) => oneEntry.subjectStableId === edfiSubjectStableIdList[0]).length);
harness.ok('⟪ML3.1⟫ the PESC slice, with no stated labels, renders every label empty', memberRowsList[1].memberRows.emptySubjectLabelCount === memberRowsList[1].memberRows.rowList.length && memberRowsList[1].memberRows.rowList.length > 0);
harness.match('⟪ML3.1⟫ TWIN: no label map is refused by name, never defaulted to {}', publication.machineMemberRowsFor({ member: memberList[0], decisionBlock: edfiSlice, cardByStableId }).error, /subjectLabelByStableId is required/);
harness.ok('every subject_id decodes back to its forged stableId', edfiMemberRows.rowList.every((oneEntry) => subjectCurieLib.stableIdOfSubjectCurie(oneEntry.row.subject_id).stableId === oneEntry.subjectStableId));
harness.ok('every object_id is a full IRI or sssom:NoTermFound', edfiMemberRows.rowList.every((oneEntry) => /^https:\/\//.test(oneEntry.row.object_id) || oneEntry.row.object_id === 'sssom:NoTermFound'));
harness.ok('the match-field columns are gone (one hub per curie_map prefix; a version spans hubs)', edfiMemberRows.rowList.every((oneEntry) => oneEntry.row.subject_match_field === undefined && oneEntry.row.object_match_field === undefined));
harness.ok("R-c' (2): a machine row carries NO row-level author_id", memberRowsList.every((oneResult) => oneResult.memberRows.rowList.every((oneEntry) => oneEntry.row.author_id === undefined)));
harness.equal("the PESC fan-out slice carries its judged subject, spelled as the subject is (real '/', no '%2F')", pescSlice.decisionRecordList.some((oneRecord) => oneRecord.instanceStableIdList !== undefined) && memberRowsList[1].memberRows.rowList.every((oneEntry) => oneEntry.row.judged_subject_id.indexOf('/') !== -1 && oneEntry.row.judged_subject_id.indexOf('%2F') === -1), true);
harness.match('an authored block is refused (machine layers render judge blocks only)', publication.machineMemberRowsFor({ member: memberList[0], decisionBlock: { ...edfiSlice, header: { ...edfiSlice.header, producerKind: 'authored' } }, cardByStableId, subjectLabelByStableId }).error, /producerKind 'authored'/);

// =====================================================================
harness.section('one set per layer version (R-b): pinned identity, recomputable record_id, deterministic bytes');
// =====================================================================

const machineSet = publication.machineVersionSetText({ layer: machineLayer, version: machineVersion, memberRowsList: memberRowsList.map((oneResult) => oneResult.memberRows) });
harness.ok('the version renders as one set', machineSet.error === undefined, machineSet.error);
harness.equal('mapping_set_id is the pinned layer-version URI', headerScalarOf(machineSet.setText, 'mapping_set_id'), 'https://w3id.org/EDUcore/layer/jevToy/base');
harness.equal('mapping_set_version is the tag', headerScalarOf(machineSet.setText, 'mapping_set_version'), 'base');
harness.ok('mapping_set_source names the version it was copied from', machineSet.setText.indexOf('#mapping_set_source:\n#  - "https://w3id.org/EDUcore/layer/jev/cfg-03f64470322c"') !== -1);
harness.ok('see_also lists every member block URN', machineSet.setText.indexOf(`#  - "urn:educore:decisionBlock:${EDFI_HASH}"`) !== -1 && machineSet.setText.indexOf(`#  - "urn:educore:decisionBlock:${PESC_HASH}"`) !== -1);
harness.equal('R-e: sssom_version is "1.1"', headerScalarOf(machineSet.setText, 'sssom_version'), '1.1');
harness.equal('R-e: the alpha release is named in its declared extension', headerScalarOf(machineSet.setText, 'sssom_schema_release'), 'sssom-schema 1.1.0a5; validated with sssom-py 0.4.21');
harness.ok('every extension slot used is declared', ['sssom_schema_release', 'legacy_curie_map', 'rendering_of', 'member_block_list'].every((oneSlot) => machineSet.setText.indexOf(`#  - slot_name: "${oneSlot}"`) !== -1));
harness.equal('the replaced subject expansions are kept, declared, under legacy_curie_map', JSON.parse(headerScalarOf(machineSet.setText, 'legacy_curie_map')).edfi, 'urn:educore:edfi:');
harness.equal('the rows are both members\' rows, in registry order', machineSet.rowCount, memberRowsList[0].memberRows.rowList.length + memberRowsList[1].memberRows.rowList.length);
const recomputed = publication.recordIdRecomputation({ setText: machineSet.setText });
harness.ok('IDENTITY: every record_id recomputes from its row and the set\'s curie_map alone', recomputed.error === undefined && recomputed.checkedRowCount === machineSet.rowCount, recomputed.error);
harness.ok('each record_id is scoped by its own member block', rowsOf(machineSet.setText).rowList.every((oneRow) => oneRow.record_id.indexOf(`/assertion/${EDFI_HASH}/`) !== -1 || oneRow.record_id.indexOf(`/assertion/${PESC_HASH}/`) !== -1));
// tamper the FIRST data row's predicate (whatever it is) to another SKOS relation
const tamperedSetText = (() => {
	const lineList = machineSet.setText.split('\n');
	const firstRowIndex = lineList.findIndex((oneLine) => oneLine.length && !oneLine.startsWith('#')) + 1;
	const cellList = lineList[firstRowIndex].split('\t');
	// ⟪ML3.1⟫ found by column NAME: subject_label now stands at index 1
	const predicateIndex = lineList[firstRowIndex - 1].split('\t').indexOf('predicate_id');
	cellList[predicateIndex] = cellList[predicateIndex] === 'skos:relatedMatch' ? 'skos:exactMatch' : 'skos:relatedMatch';
	lineList[firstRowIndex] = cellList.join('\t');
	return lineList.join('\n');
})();
harness.match('a row whose predicate was changed no longer recomputes (the gate can fail)', publication.recordIdRecomputation({ setText: tamperedSetText }).error, /does not recompute from the row/);
const machineSetAgain = publication.machineVersionSetText({ layer: machineLayer, version: machineVersion, memberRowsList: [[memberList[0], edfiSlice], [memberList[1], pescSlice]].map(([member, decisionBlock]) => publication.machineMemberRowsFor({ member, decisionBlock, cardByStableId, subjectLabelByStableId }).memberRows) });
harness.equal('the same inputs give the same bytes', sha256Hex(machineSetAgain.setText), sha256Hex(machineSet.setText));
harness.ok('no status is written into a set (a status change must not change a set\'s bytes)', machineSet.setText.indexOf('"Standard"') === -1);
harness.match('members out of registry order are refused', publication.machineVersionSetText({ layer: machineLayer, version: machineVersion, memberRowsList: memberRowsList.map((oneResult) => oneResult.memberRows).reverse() }).error, /out of registry order/);

// =====================================================================
harness.section('public filtered rendering (TQ Q37): the held standards omitted, and the file says so');
// =====================================================================

const publicSet = publication.machineVersionSetText({ layer: machineLayer, version: machineVersion, memberRowsList: memberRowsList.map((oneResult) => oneResult.memberRows), publicFilter });
harness.ok('the filtered rendering renders', publicSet.error === undefined, publicSet.error);
harness.equal('0 rows whose subject is an Ed-Fi element', rowsOf(publicSet.setText).rowList.filter((oneRow) => oneRow.subject_id.indexOf('edfi:') === 0).length, 0);
harness.equal('…and every PESC row kept', publicSet.rowCount, memberRowsList[1].memberRows.rowList.length);
harness.equal('its mapping_set_id is NOT the version URI: the URI plus #publicFilter-<digest>', headerScalarOf(publicSet.setText, 'mapping_set_id'), `https://w3id.org/EDUcore/layer/jevToy/base#publicFilter-${publicFilter.filterDigest}`);
const publicFilterSlot = JSON.parse(headerScalarOf(publicSet.setText, 'public_filter'));
harness.equal('public_filter names the excluded standards and the full version', `${publicFilterSlot.excludedStandardKeyList.join(',')} ${publicFilterSlot.fullVersionId}`, 'edfi,jedx https://w3id.org/EDUcore/layer/jevToy/base');
harness.ok('the filtered rendering\'s record_ids still recompute', publication.recordIdRecomputation({ setText: publicSet.setText }).error === undefined);
harness.equal('the legacy map names no filtered standard', JSON.parse(headerScalarOf(publicSet.setText, 'legacy_curie_map')).edfi, undefined);

// =====================================================================
harness.section("curated versions (R-c, R-c'): a rendering of the stored set; the author term separates two authors of one triple");
// =====================================================================

const CEDS_CARD = 'https://w3id.org/EDUcore/CEDStandards/hub/14.0.0.0/dd11e67afa4ec99dd0d2ba3b9e01f2469945644d262a56653ede1d4f9ce11fe4';
const curatedSetText = [
	'#curie_map:',
	'#  edc: "https://w3id.org/EDUcore/"',
	'#  edfi: "urn:educore:edfi:"',
	'#  urn: "urn:"',
	'#mapping_set_id: "https://w3id.org/EDUcore/layer/ratersToy/r1"',
	'#mapping_set_version: "r1"',
	'#mapping_provider: "https://w3id.org/EDUcore/agent/org/educore"',
	'#object_source: "urn:educore:hub:CEDS:"',
	'#object_source_version: "14.0.0.0"',
	['subject_id', 'predicate_id', 'object_id', 'mapping_justification', 'object_label', 'subject_source', 'subject_source_version', 'author_id', 'mapping_cardinality'].join('\t'),
	['edfi:property/abstractEntity.X', 'edc:bestMatch', CEDS_CARD, 'semapv:ManualMappingCuration', 'Org', 'urn:educore:edfi:', '5.2.0', RATER_A_IRI, ''].join('\t'),
	['edfi:property/abstractEntity.X', 'edc:bestMatch', CEDS_CARD, 'semapv:ManualMappingCuration', 'Org', 'urn:educore:edfi:', '5.2.0', RATER_B_IRI, ''].join('\t'),
	['edfi:property/abstractEntity.Y', 'skos:mappingRelation', 'sssom:NoTermFound', 'semapv:ManualMappingCuration', '', 'urn:educore:edfi:', '5.2.0', RATER_A_IRI, '1:0'].join('\t'),
].join('\n') + '\n';
const curatedLayer = { layerKey: 'ratersToy', displayName: 'toy raters', layerKind: 'curated', authorAgentIri: ORGANISATION_IRI, standardList: [{ standardKey: 'edfi', standardName: 'EdFi', sourceIri: 'urn:educore:edfi:' }], hubList: [{ hubKey: 'ceds', hubName: 'CEDS', sourceIri: 'urn:educore:hub:CEDS:' }] };
const curatedVersion = { administrationRecord: { versionTag: 'r1', contentId: sha256Hex(curatedSetText), publishedAt: '2026-10-25T00:00:00Z' }, registrationStatus: 'Candidate', authorAgentIri: ORGANISATION_IRI, contentIdBasis: 'frozenSetBytes', wholeSetBlock: { pairKey: 'layerSet::ratersToy', decisionBlockHash: sha256Hex(curatedSetText) }, memberBlockList: [] };
const curatedSet = publication.curatedVersionSetText({ layer: curatedLayer, version: curatedVersion, wholeSetText: curatedSetText, subjectLabelByStableId });
harness.ok('the stored curated set renders', curatedSet.error === undefined, curatedSet.error);
const curatedRows = curatedSet.error ? { rowList: [] } : rowsOf(curatedSet.setText);
harness.equal('row for row equal to the stored set (no collapse)', curatedRows.rowList.length, 3);
harness.equal('⟪ML3.1⟫ the curated rendering carries subject_label right after subject_id', curatedRows.columnList.slice(0, 2).join(','), 'subject_id,subject_label');
harness.equal('⟪ML3.1⟫ …with the stated label for X and an empty one for Y', curatedRows.rowList.map((oneRow) => oneRow.subject_label).join('|'), 'EducationOrganization.X|EducationOrganization.X|');
harness.equal('⟪ML3.1⟫ …and the empty one counted', curatedSet.emptySubjectLabelCount, 1);
harness.match('⟪ML3.1⟫ TWIN: a curated rendering with no label map is refused by name', publication.curatedVersionSetText({ layer: curatedLayer, version: curatedVersion, wholeSetText: curatedSetText }).error, /subjectLabelByStableId is required/);
harness.ok('every record_id is scoped by the stored block hash (the version content id)', curatedRows.rowList.every((oneRow) => oneRow.record_id.indexOf(`/assertion/${sha256Hex(curatedSetText)}/`) !== -1));
harness.ok("R-c': two raters asserting one triple get TWO record_ids", curatedRows.rowList.length === 3 && curatedRows.rowList[0].record_id !== curatedRows.rowList[1].record_id);
harness.ok('the curated record_ids recompute from the row (s p o author)', !curatedSet.error && publication.recordIdRecomputation({ setText: curatedSet.setText }).error === undefined);
harness.equal('mapping_set_id stays the version URI (the rendering is OF r1)', curatedSet.error ? '' : headerScalarOf(curatedSet.setText, 'mapping_set_id'), 'https://w3id.org/EDUcore/layer/ratersToy/r1');
harness.ok('see_also names the stored block URN', !curatedSet.error && curatedSet.setText.indexOf(`#  - "urn:educore:decisionBlock:${sha256Hex(curatedSetText)}"`) !== -1);
harness.match("R-c' (1): a curated row with NO author is refused by name", publication.curatedVersionSetText({ layer: curatedLayer, version: { ...curatedVersion, administrationRecord: { ...curatedVersion.administrationRecord, contentId: sha256Hex(curatedSetText.replace(`\t${RATER_B_IRI}\t`, '\t\t')) } }, wholeSetText: curatedSetText.replace(`\t${RATER_B_IRI}\t`, '\t\t'), subjectLabelByStableId }).error, /not exactly one absolute IRI/);
const twoAuthorText = curatedSetText.replace(`\t${RATER_B_IRI}\t`, `\t${RATER_B_IRI}|${RATER_A_IRI}\t`);
harness.match("R-c' (1): a curated row with SEVERAL authors is refused by name", publication.curatedVersionSetText({ layer: curatedLayer, version: { ...curatedVersion, administrationRecord: { ...curatedVersion.administrationRecord, contentId: sha256Hex(twoAuthorText) } }, wholeSetText: twoAuthorText, subjectLabelByStableId }).error, /not exactly one absolute IRI/);
harness.match('a stored text that does not hash to the content id is refused', publication.curatedVersionSetText({ layer: curatedLayer, version: curatedVersion, wholeSetText: `${curatedSetText}\n`, subjectLabelByStableId }).error, /not the version's content id/);
const publicCurated = publication.curatedVersionSetText({ layer: curatedLayer, version: curatedVersion, wholeSetText: curatedSetText, publicFilter, subjectLabelByStableId });
harness.equal('a curated public rendering also omits the held standards', publicCurated.rowCount, 0);

// =====================================================================
harness.section('registry documents and contexts (ML3-b)');
// =====================================================================

const statedRegistry = registryFor({
	layerRegistry: {
		registrationAuthorityIri: ORGANISATION_IRI,
		registrarIri: ORGANISATION_IRI,
		layerList: [{ ...curatedLayer, versionList: [{ ...curatedVersion, administrationRecord: { ...curatedVersion.administrationRecord, registrationAuthority: ORGANISATION_IRI, registrar: ORGANISATION_IRI, submitter: ORGANISATION_IRI }, memberBlockList: [curatedVersion.wholeSetBlock] }], statusChangeList: [{ versionTag: 'r1', registrationStatus: 'Standard', changedAt: '2026-10-26T09:00:00Z', changedBy: ORGANISATION_IRI }] }],
	},
	agentRegistry,
});
harness.ok('the stated registry loads', statedRegistry.error === undefined, statedRegistry.error);
const registryDocument = publication.registryDocumentText({ layer: statedRegistry.registry.layerRegistry.layerList[0], registry: statedRegistry.registry, localNameByVersionTag: { r1: 'r1/set.sssom.tsv' } });
harness.ok('the layer registry document renders', registryDocument.error === undefined, registryDocument.error);
harness.ok('its id is the floating layer URI', registryDocument.documentText.indexOf('mapping_registry_id: "https://w3id.org/EDUcore/layer/ratersToy"') === 0);
harness.ok('mapping_set_group is the EFFECTIVE status: the appended change (Standard), not the published Candidate', registryDocument.documentText.indexOf('mapping_set_group: "Standard"') !== -1 && registryDocument.documentText.indexOf('Candidate') === -1);
harness.ok('last_updated is the date of that status, quoted (linkml types it a string)', registryDocument.documentText.indexOf('last_updated: "2026-10-26"') !== -1);
harness.ok('mirror_from is the content-addressed URI', registryDocument.documentText.indexOf(`mirror_from: "https://w3id.org/EDUcore/layer/ratersToy/sha256/${sha256Hex(curatedSetText)}"`) !== -1);
harness.match('a version with no rendered set is refused', publication.registryDocumentText({ layer: statedRegistry.registry.layerRegistry.layerList[0], registry: statedRegistry.registry, localNameByVersionTag: {} }).error, /no rendered set is named/);
const siteDocument = publication.siteRegistryDocumentText({ layerKeyList: ['ratersToy', 'jevToy'] });
harness.ok('the site registry imports every layer registry', siteDocument.documentText.indexOf('mapping_registry_id: "https://w3id.org/EDUcore/registry/layers"') === 0 && siteDocument.documentText.indexOf('  - "https://w3id.org/EDUcore/layer/jevToy"') !== -1);
const contexts = publication.contextDocumentTextList({ layer: machineLayer, version: machineVersion, subjectStableIdList: machineSet.subjectStableIdList, standardNameByStandardKey: { edfi: 'EdFi', pesccollegetranscript1v7v0: 'PESC-CollegeTranscript-1.7.0' }, standardVersionByStandardKey: { edfi: '5.2.0', pesccollegetranscript1v7v0: '1.7.0' } });
harness.ok('one context per standard', contexts.error === undefined && contexts.contextDocumentList.map((oneContext) => oneContext.standardKey).join(',') === 'edfi,pesccollegetranscript1v7v0', contexts.error);
const edfiContext = contexts.error ? { '@context': {} } : JSON.parse(contexts.contextDocumentList[0].documentText);
const termList = Object.keys(edfiContext['@context']).filter((oneTerm) => oneTerm !== '@version');
harness.ok('no term carries ":" or "/" (a JSON-LD term holding one would be read as an IRI)', termList.length > 0 && termList.every((oneTerm) => oneTerm.indexOf(':') === -1 && oneTerm.indexOf('/') === -1));
harness.ok('every term maps to a PINNED interpretation URI of this layer version', termList.every((oneTerm) => {
	const parsed = edcUri.parse(edfiContext['@context'][oneTerm]['@id']);
	return parsed.kind === 'interpretationPinned' && parsed.partByName.layerKey === 'jevToy' && parsed.partByName.versionTag === 'base' && parsed.partByName.standardName === 'EdFi';
}));
const publicContexts = publication.contextDocumentTextList({ layer: machineLayer, version: machineVersion, subjectStableIdList: machineSet.subjectStableIdList, standardNameByStandardKey: { edfi: 'EdFi', pesccollegetranscript1v7v0: 'PESC-CollegeTranscript-1.7.0' }, standardVersionByStandardKey: { edfi: '5.2.0', pesccollegetranscript1v7v0: '1.7.0' }, publicFilter });
harness.equal('a public context is written for the unheld standards only', publicContexts.contextDocumentList.map((oneContext) => oneContext.standardKey).join(','), 'pesccollegetranscript1v7v0');

harness.report();
