#!/usr/bin/env node
'use strict';

// test-bgP7.js — BG-P7 (Profile 7.7, BR-106; RULINGS P7, BF13, BF17, 12:05 #6, #9): SSSOM validity of the exporter's TSV.
//   (a) the TSV parses — sssom-py is NOT on this machine (checked 2026-08-16: no `sssom` CLI, no importable module), so
//   the validator is the framework's OWN header/row/curie_map validator, LABELLED PROXY (RULING 12:05 #6); (b) every
//   non-built-in prefix is in curie_map; (c) object_match_field is the Profile §4.5 tuple string on every row; (d)
//   subject_match_field names the DOCUMENT prefix for crosswalk (toyCrosswalk:HubGlobalId|toyCrosswalk:HubClassURI) and the
//   standard's own prefix + property NAME for standard (toy:hubAnchorId — CURIE-safe, never a header text); (e)
//   mapping_date present ONLY if a declared source column supplied it (none in v1 — an exporter stamping today is refused);
//   (f) mapping_provider recorded as verified (verifiedBy null → the export REFUSES the run); (g) author_id / creator_id
//   emitted at set level whenever declared. Plus the report's subject census beside the row count (RULING 12:05 #9).
//
// Run: node lib/bridge-framework/test/test-bgP7.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-P7: SSSOM/TSV validity (PROXY validator — sssom-py absent on this machine)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const fs = require('fs');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { runConjunct, succeeded, nameInRefusal, refusalCase, frameworkMutationTwin, scenarioTwin } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const sssomExporterLib = require('../sssomExporter');

const GATE_ID = 'BG-P7';
const twinRegistry = makeTwinRegistry();
const EXPORTER_FILE = 'sssomExporter.js';
const FRAMEWORK_FILE = 'bridge-framework.js';
const CROSSWALK_PLUGIN_PATH = path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', 'toyCrosswalkPlugin.js');
const VALIDATOR_LABEL = 'PROXY (framework header/row/curie_map validator; sssom-py absent on this machine — RULING 12:05 #6)';
const cloneJson = scenarioLib.cloneJson;
const tsvOf = (outcome) => fs.readFileSync(outcome.runReport.sssomExportPath, 'utf8');
const parsedOf = (outcome, scenario) => {
	const lib = scenario.frameworkMutationList.some((oneMutation) => oneMutation.modulePath.endsWith(EXPORTER_FILE)) ? moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, EXPORTER_FILE), mutationList: scenario.frameworkMutationList }) : sssomExporterLib;
	return lib.parseSssomTsv(tsvOf(outcome));
};
const overrideDeclaration = (scenario, mutate) => {
	const loaded = require(CROSSWALK_PLUGIN_PATH);
	const bridgeDeclaration = cloneJson(loaded.bridgeDeclaration);
	mutate(bridgeDeclaration);
	scenario.pluginModuleOverrides.toyCrosswalkPlugin = { bridgeDeclaration };
};

const conjunctList = [
	runConjunct({ conjunctId: 'a_tsvParses_PROXY', title: `the TSV parses — ${VALIDATOR_LABEL}: mandatory columns present, every row the header's width, a #curie_map block`, twinNameList: ['deleteMandatoryColumn'], judge: succeeded((runReport, outcome, scenario) => { const parsed = parsedOf(outcome, scenario); return { pass: !parsed.error && parsed.rowList.length === runReport.edgesWritten && parsed.headerLineList.some((oneLine) => oneLine === '#curie_map:'), detail: parsed.error || `${parsed.rowList.length} rows / ${parsed.columnList.length} columns [${VALIDATOR_LABEL}]` }; }) }),
	runConjunct({ conjunctId: 'b_everyPrefixInCurieMap', title: 'every non-built-in prefix used (subject_id, match fields) is declared in curie_map', twinNameList: ['dropHubPrefixFromCurieMap'], judge: succeeded((runReport, outcome, scenario) => { const parsed = parsedOf(outcome, scenario); const declared = parsed.headerLineList.filter((oneLine) => /^#  \w+: /.test(oneLine)).map((oneLine) => oneLine.replace(/^#  (\w+): .*/, '$1')); const usedList = Array.from(new Set(parsed.rowList.reduce((soFar, oneRow) => soFar.concat([oneRow.subject_id.split(':')[0]]).concat(oneRow.subject_match_field.split('|').map((oneField) => oneField.split(':')[0])).concat(oneRow.object_match_field.split('|').map((oneField) => oneField.split(':')[0])), []))); const undeclared = usedList.filter((onePrefix) => declared.indexOf(onePrefix) === -1 && ['skos', 'semapv'].indexOf(onePrefix) === -1); return { pass: undeclared.length === 0 && declared.length >= 3, detail: `declared [${declared.join(', ')}], undeclared [${undeclared.join(', ')}]` }; }) }),
	runConjunct({ conjunctId: 'c_objectMatchFieldIsTupleString', title: "object_match_field is the Profile §4.5 tuple string on every row (EDUcoreHub:canonicalKey|EDUcoreHub:domainId for the crosswalk plugin's two supplied fields)", twinNameList: ['canonicalKeyAlone'], judge: succeeded((runReport, outcome, scenario) => { const parsed = parsedOf(outcome, scenario); const bad = parsed.rowList.filter((oneRow) => oneRow.object_match_field !== 'EDUcoreHub:canonicalKey|EDUcoreHub:domainId'); return { pass: parsed.rowList.length > 0 && bad.length === 0, detail: `${bad.length} bad; sample ${parsed.rowList[0] ? parsed.rowList[0].object_match_field : ''}` }; }) }),
	runConjunct({ conjunctId: 'd_subjectMatchFieldDocumentPrefixForCrosswalk', title: 'subject_match_field names the DOCUMENT prefix for a crosswalk plugin (toyCrosswalk:HubGlobalId|toyCrosswalk:HubClassURI)', twinNameList: ['standardPrefixOnCrosswalkRow'], judge: succeeded((runReport, outcome, scenario) => { const parsed = parsedOf(outcome, scenario); const bad = parsed.rowList.filter((oneRow) => oneRow.subject_match_field !== 'toyCrosswalk:HubGlobalId|toyCrosswalk:HubClassURI'); return { pass: parsed.rowList.length > 0 && bad.length === 0, detail: `${bad.length} bad` }; }) }),
	runConjunct({ conjunctId: 'd_subjectMatchFieldPropertyNameForStandard', title: "subject_match_field for a standard plugin is the standard's prefix + the PROPERTY NAME the walk read (toy:hubAnchorId — CURIE-safe, never a header text)", twinNameList: ['headerTextInMatchField'], shape: (scenario) => { scenario.spec.bridge = 'toyStandardPlugin'; }, judge: succeeded((runReport, outcome, scenario) => { const parsed = parsedOf(outcome, scenario); const bad = parsed.rowList.filter((oneRow) => oneRow.subject_match_field !== 'toy:hubAnchorId'); return { pass: parsed.rowList.length > 0 && bad.length === 0, detail: `${bad.length} bad; sample ${parsed.rowList[0] ? parsed.rowList[0].subject_match_field : ''}` }; }) }),
	runConjunct({ conjunctId: 'e_noMappingDateUnlessSourceSuppliesIt', title: 'mapping_date is present ONLY if a declared source column supplied it — none in v1: no mapping_date column and no #mapping_date line', twinNameList: ['exporterStampsToday'], judge: succeeded((runReport, outcome, scenario) => { const parsed = parsedOf(outcome, scenario); return { pass: parsed.columnList.indexOf('mapping_date') === -1 && !parsed.headerLineList.some((oneLine) => /^#mapping_date/.test(oneLine)), detail: `columns [${parsed.columnList.join(',')}]` }; }) }),
	refusalCase({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'f_unverifiedProviderRefusesExport', title: 'a mappingProvider not recorded as verified (verifiedBy null) → the export REFUSES by name (and so the re-judge run) — never a placeholder', shape: (scenario) => overrideDeclaration(scenario, (declaration) => { declaration.mappingProvider.verifiedBy = null; }), regex: /mappingProvider https:\/\/toy\.example\/crosswalk\/v1 is not recorded as verified-to-resolve \(verifiedBy null\)/, twinName: 'placeholderProvider', fileName: EXPORTER_FILE, find: '\tif (provider.verifiedBy === null || provider.verifiedBy === undefined) {', replace: '\tif (false && (provider.verifiedBy === null || provider.verifiedBy === undefined)) {' }),
	runConjunct({ conjunctId: 'g_authorIdAtSetLevelWhenDeclared', title: 'author_id / creator_id are emitted at set level whenever the declaration carries them (BR-058 SHOULD made checkable): a set-level slot supplied → a #author_id line', twinNameList: ['authorIdDropped'], shape: (scenario) => { scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: '\t\t\t\t\t\t\t\t\t\tsubjectCuriePrefix: bridgeDeclaration.subjectCuriePrefix,\n', replace: "\t\t\t\t\t\t\t\t\t\tsubjectCuriePrefix: bridgeDeclaration.subjectCuriePrefix,\n\t\t\t\t\t\t\t\t\t\tauthorId: 'orcid:0000-0000-0000-0000',\n" }); }, judge: succeeded((runReport, outcome, scenario) => { const parsed = parsedOf(outcome, scenario); return { pass: parsed.headerLineList.some((oneLine) => oneLine === '#author_id: orcid:0000-0000-0000-0000'), detail: parsed.headerLineList.filter((oneLine) => /author/.test(oneLine)).join(' | ') || 'no author line' }; }) }),
	runConjunct({ conjunctId: 'subjectCensusBesideRowCount', title: 'the export report carries the SUBJECT census beside the row count (same-target shared leaves → fewer rows than subjects, by design — RULING 12:05 #9)', twinNameList: ['censusLineDropped'], judge: succeeded((runReport, outcome, scenario) => { const parsed = parsedOf(outcome, scenario); const censusLine = parsed.headerLineList.find((oneLine) => /^#subject_census: /.test(oneLine)); const census = censusLine ? JSON.parse(censusLine.replace('#subject_census: ', '')) : null; return { pass: census !== null && census.rowCount === parsed.rowList.length && Number.isInteger(census.subjectCount), detail: censusLine || 'no subject_census line' }; }) }),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'a_tsvParses_PROXY', twinName: 'deleteMandatoryColumn', fileName: EXPORTER_FILE, find: "const COLUMN_LIST = Object.freeze([\n\t'subject_id',\n\t'predicate_id',", replace: "const COLUMN_LIST = Object.freeze([\n\t'subject_id'," });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'b_everyPrefixInCurieMap', twinName: 'dropHubPrefixFromCurieMap', fileName: FRAMEWORK_FILE, find: "\t\t\t\t\t\t\t\t\tconst curieMap = { [bridgeDeclaration.subjectCuriePrefix]: `urn:educore:${bridgeDeclaration.standardKey}:`, [bridgeDeclaration.sourceCuriePrefix.prefix]: bridgeDeclaration.sourceCuriePrefix.iri, [OBJECT_MATCH_FIELD_HUB_PREFIX]: `urn:educore:hub:${block.header.hubName}:` };", replace: "\t\t\t\t\t\t\t\t\tconst curieMap = { [bridgeDeclaration.subjectCuriePrefix]: `urn:educore:${bridgeDeclaration.standardKey}:`, [bridgeDeclaration.sourceCuriePrefix.prefix]: bridgeDeclaration.sourceCuriePrefix.iri };" });
// under dropHubPrefixFromCurieMap the exporter REFUSES (undeclared prefix) → the run fails → the conjunct is red (a refusal is not a pass); the exporter's own refusal is the production guard and the twin shows the gate would ALSO catch a TSV missing it: register a second twin that disables the exporter's prefix check as well
scenarioTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'b_everyPrefixInCurieMap', twinName: 'dropHubPrefixAndDisableExporterCheck', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: "\t\t\t\t\t\t\t\t\tconst curieMap = { [bridgeDeclaration.subjectCuriePrefix]: `urn:educore:${bridgeDeclaration.standardKey}:`, [bridgeDeclaration.sourceCuriePrefix.prefix]: bridgeDeclaration.sourceCuriePrefix.iri, [OBJECT_MATCH_FIELD_HUB_PREFIX]: `urn:educore:hub:${block.header.hubName}:` };", replace: "\t\t\t\t\t\t\t\t\tconst curieMap = { [bridgeDeclaration.subjectCuriePrefix]: `urn:educore:${bridgeDeclaration.standardKey}:`, [bridgeDeclaration.sourceCuriePrefix.prefix]: bridgeDeclaration.sourceCuriePrefix.iri };" });
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, EXPORTER_FILE), find: '\tif (undeclaredMatchField !== undefined) {', replace: '\tif (false && undeclaredMatchField !== undefined) {' });
} });
conjunctList[1].twinNameList = ['dropHubPrefixFromCurieMap', 'dropHubPrefixAndDisableExporterCheck'];
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'c_objectMatchFieldIsTupleString', twinName: 'canonicalKeyAlone', fileName: FRAMEWORK_FILE, find: "\t\tconst objectMatchFieldFor = (bridgeDeclaration) => TUPLE_FIELD_LIST.filter((oneField) => bridgeDeclaration.tupleFieldColumnMap[oneField] !== undefined).map((oneField) => `${OBJECT_MATCH_FIELD_HUB_PREFIX}:${oneField}`).join('|');", replace: "\t\tconst objectMatchFieldFor = (bridgeDeclaration) => `${OBJECT_MATCH_FIELD_HUB_PREFIX}:canonicalKey`;" });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'd_subjectMatchFieldDocumentPrefixForCrosswalk', twinName: 'standardPrefixOnCrosswalkRow', fileName: FRAMEWORK_FILE, find: "\t\t\tconst prefix = bridgeDeclaration.sourceCuriePrefix.prefix;\n\t\t\treturn TUPLE_FIELD_LIST", replace: "\t\t\tconst prefix = bridgeDeclaration.subjectCuriePrefix;\n\t\t\treturn TUPLE_FIELD_LIST" });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'd_subjectMatchFieldPropertyNameForStandard', twinName: 'headerTextInMatchField', fileName: FRAMEWORK_FILE, find: "\t\t\t\t.map((oneField) => `${prefix}:${bridgeDeclaration.tupleFieldColumnMap[oneField].column}`)", replace: "\t\t\t\t.map((oneField) => `${prefix}:${bridgeDeclaration.matchBasis === 'standard' ? 'Hub Global Id' : bridgeDeclaration.tupleFieldColumnMap[oneField].column}`)" });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'e_noMappingDateUnlessSourceSuppliesIt', twinName: 'exporterStampsToday', fileName: EXPORTER_FILE, find: "\theaderLineList.push(`#subject_census:", replace: "\theaderLineList.push('#mapping_date: 2026-08-16');\n\theaderLineList.push(`#subject_census:" });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'g_authorIdAtSetLevelWhenDeclared', twinName: 'authorIdDropped', fileName: EXPORTER_FILE, find: "\tif (isNonEmptyString(setLevelSlots.authorId)) {\n\t\theaderLineList.push(`#author_id: ${setLevelSlots.authorId}`);\n\t}", replace: "\tif (false && isNonEmptyString(setLevelSlots.authorId)) {\n\t\theaderLineList.push(`#author_id: ${setLevelSlots.authorId}`);\n\t}" });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'subjectCensusBesideRowCount', twinName: 'censusLineDropped', fileName: EXPORTER_FILE, find: "\theaderLineList.push(`#subject_census: ${JSON.stringify({ subjectCount: subjectSet.size, rowCount: rowList.length, note: 'rows are per (subject stableId, predicate, object); several source subjects sharing one leaf yield ONE row' })}`);", replace: '\tvoid subjectSet;' });

const gateDeclarationList = [{ gateId: GATE_ID, title: `SSSOM/TSV validity — ${VALIDATOR_LABEL}`, conjunctList }];

runGateFamily(
	{ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 9 },
	() => harness.report(),
);
