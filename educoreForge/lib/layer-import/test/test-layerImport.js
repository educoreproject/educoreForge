#!/usr/bin/env node
'use strict';

// test-layerImport.js — gates for lib/layer-import (mappingLayers ML3-c). On a STATED toy gold capture: every deliberately broken row of the
// broken fixture is refused BY NAME with its OWN reason (one reason per row, none dropped, none guessed); a well-formed set is accepted
// row for row; importLayer freezes the exact bytes (sha256 = version id) under layerSet::imported-<slug>, appends the layer and its
// Candidate version through the registry's append path, reports alreadyPresent on identical bytes, and refuses a reused tag, an
// unregistered author, a file sssom-py rejects and an import with no accepted row. It writes no relationship block.
//
// Run: node lib/layer-import/test/test-layerImport.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for lib/layer-import

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves resolveImportRows refuses each broken row by name with its own reason (unknown prefix, subject not an element IRI,
     subject absent from the gold, object not a HubReference, malformed predicate, predicate not admitted, duplicate record_id,
     missing cell) and accepts the good rows; proves importLayer's freeze, registration, idempotence and refusals.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const harness = require('../../../test/testLib/harness')(moduleName);
const { registryFor } = require('../../layer-registry/layerRegistry');
const { resolveImportRows, importLayer } = require('../layerImport');
const importRules = require('../importRules.json');
const decisionStoreLib = require('../../decision-store/decision-store')();

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const ORGANISATION_IRI = 'https://w3id.org/EDUcore/agent/org/educore';
const SOURCE_AUTHOR_IRI = 'https://w3id.org/EDUcore/agent/org/toySource';
const CARD_A = 'https://w3id.org/EDUcore/ToyHub/hub/1.0/aaaa';
const CARD_B = 'https://w3id.org/EDUcore/ToyHub/hub/1.0/bbbb';
const agentRegistry = { agentList: [{ agentIri: ORGANISATION_IRI, agentKind: 'organisation', displayName: 'EDUcore' }, { agentIri: SOURCE_AUTHOR_IRI, agentKind: 'organisation', displayName: 'a toy outside source' }] };
const statedLayerRegistry = () => ({ registrationAuthorityIri: ORGANISATION_IRI, registrarIri: ORGANISATION_IRI, layerList: [] });
// a STATED gold: ToyA 2.0 with three elements, one hub with two cards
const goldCapture = {
	goldContainerName: 'TOY_GOLD',
	manifestRefId: 'f'.repeat(64),
	cardList: [{ stableId: CARD_A, uri: CARD_A, name: 'Card A' }, { stableId: CARD_B, uri: CARD_B, name: 'Card B' }],
	elementList: [{ stableId: 'toya:property/Alpha', sourceName: 'ToyA' }, { stableId: 'toya:property/Beta', sourceName: 'ToyA' }, { stableId: 'toya:property/Gamma', sourceName: 'ToyA' }],
	standardList: [{ standardName: 'ToyA', standardKey: 'toya', standardVersion: '2.0' }],
	edgeSubjectVersionList: [{ standardName: 'ToyA', standardVersion: '2.0_01' }],
	hubList: [{ hubName: 'ToyHub', hubVersion: '1.0', namespace: 'https://w3id.org/EDUcore/ToyHub/hub/' }],
};
const prefixMapDeclaration = { prefixExpansion: { toya: 'https://w3id.org/EDUcore/ToyA/2.0/toya:', edc: 'https://w3id.org/EDUcore/', elsewhere: 'https://example.org/not/an/element/' } };
const COLUMN_LINE = ['subject_id', 'predicate_id', 'object_id', 'mapping_justification', 'record_id'].join('\t');
const HEADER_LINE_LIST = ['#curie_map:', '#  toya: "https://w3id.org/EDUcore/ToyA/2.0/toya:"', '#  foo: "https://example.org/foo/"', '#  edc: "https://w3id.org/EDUcore/"', '#mapping_set_id: "https://example.org/toySet"', '#mapping_provider: "https://example.org/toySource"'];
const rowLine = (cellList) => cellList.join('\t');
const goodRowList = [
	['toya:property/Alpha', 'skos:exactMatch', CARD_A, 'semapv:ManualMappingCuration', 'https://example.org/r/1'],
	['toya:property/Beta', 'edc:bestMatch', CARD_B, 'semapv:ManualMappingCuration', 'https://example.org/r/2'],
	['toya:property/Gamma', 'skos:mappingRelation', 'sssom:NoTermFound', 'semapv:ManualMappingCuration', 'https://example.org/r/3'],
];
// the broken fixture: each row carries exactly ONE fault, named in the expected reason list in the same order
const brokenRowList = [
	[['foo:bar', 'skos:exactMatch', CARD_A, 'semapv:ManualMappingCuration', 'https://example.org/b/1'], 'unknownPrefix'],
	[['elsewhere:thing', 'skos:exactMatch', CARD_A, 'semapv:ManualMappingCuration', 'https://example.org/b/2'], 'subjectNotAnElementIri'],
	[['toya:property/NoSuchElement', 'skos:exactMatch', CARD_A, 'semapv:ManualMappingCuration', 'https://example.org/b/3'], 'subjectAbsentFromGold'],
	[['toya:property/Alpha', 'skos:exactMatch', 'https://w3id.org/EDUcore/ToyHub/hub/1.0/zzzz', 'semapv:ManualMappingCuration', 'https://example.org/b/4'], 'objectNotAHubReference'],
	[['toya:property/Alpha', 'exactMatch', CARD_B, 'semapv:ManualMappingCuration', 'https://example.org/b/5'], 'malformedPredicate'],
	[['toya:property/Alpha', 'skos:related', CARD_B, 'semapv:ManualMappingCuration', 'https://example.org/b/6'], 'predicateNotAdmitted'],
	[['toya:property/Beta', 'skos:closeMatch', CARD_A, 'semapv:ManualMappingCuration', 'https://example.org/r/1'], 'duplicateRecordId'],
	[['toya:property/Beta', 'skos:closeMatch', CARD_A, ''], 'missingMandatoryCell'],
];
const setTextOf = (cellListList) => `${HEADER_LINE_LIST.join('\n')}\n${COLUMN_LINE}\n${cellListList.map(rowLine).join('\n')}\n`;
const goodSetText = setTextOf(goodRowList);
const brokenSetText = setTextOf(goodRowList.concat(brokenRowList.map(([cellList]) => cellList)));

// =====================================================================
harness.section('resolveImportRows: each broken row refused BY NAME with its OWN reason; the good rows accepted');
// =====================================================================

const goodResolved = resolveImportRows({ sssomText: goodSetText, prefixExpansionByPrefix: prefixMapDeclaration.prefixExpansion, goldCapture, importRules });
harness.ok('the good set resolves', goodResolved.error === undefined, goodResolved.error);
harness.equal('every good row is accepted, none refused', `${goodResolved.acceptedList.length}/${goodResolved.refusalList.length}`, '3/0');
harness.equal('the accepted rows resolve to the gold\'s stableIds', goodResolved.acceptedList.map((oneAccepted) => oneAccepted.subjectStableId).join(','), 'toya:property/Alpha,toya:property/Beta,toya:property/Gamma');
harness.equal('the abstention row is accepted as an abstention', goodResolved.acceptedList.map((oneAccepted) => oneAccepted.isAbstention).join(','), 'false,false,true');

const brokenResolved = resolveImportRows({ sssomText: brokenSetText, prefixExpansionByPrefix: prefixMapDeclaration.prefixExpansion, goldCapture, importRules });
harness.ok('the broken set resolves (row refusals are not a file refusal)', brokenResolved.error === undefined, brokenResolved.error);
harness.equal('accepted N = the 3 good rows; refused M = the 8 broken rows; none dropped', `${brokenResolved.acceptedList.length} + ${brokenResolved.refusalList.length} = ${brokenResolved.rowCount}`, '3 + 8 = 11');
brokenRowList.forEach(([cellList, expectedReasonCode], brokenIndex) => {
	const refusal = brokenResolved.refusalList.find((oneRefusal) => oneRefusal.rowNumber === goodRowList.length + brokenIndex + 1);
	harness.equal(`broken row ${brokenIndex + 1} (${cellList[0]} ${cellList[1]}) is refused as ${expectedReasonCode}`, refusal === undefined ? 'NOT REFUSED' : refusal.reasonCode, expectedReasonCode);
});
harness.ok('every refusal carries a reason text', brokenResolved.refusalList.every((oneRefusal) => typeof oneRefusal.reasonText === 'string' && oneRefusal.reasonText.length > 20));
harness.ok('every refusal reason is one importRules.json lists', brokenResolved.refusalList.every((oneRefusal) => importRules.refusalReasonList.indexOf(oneRefusal.reasonCode) !== -1));
harness.ok('the file\'s own curie_map is NOT used: foo is declared in the file, unknown to the declaration, and refused', brokenResolved.refusalList.some((oneRefusal) => oneRefusal.subject_id === 'foo:bar' && /prefix 'foo' is not in the declared prefix map/.test(oneRefusal.reasonText)));
const pairVersionText = goodSetText.split('https://w3id.org/EDUcore/ToyA/2.0/toya:').join('https://w3id.org/EDUcore/ToyA/2.0_01/toya:');
harness.equal('an element IRI carrying the version the gold\'s EDGES stamp (2.0_01, not the root\'s 2.0) resolves', resolveImportRows({ sssomText: pairVersionText, prefixExpansionByPrefix: { ...prefixMapDeclaration.prefixExpansion, toya: 'https://w3id.org/EDUcore/ToyA/2.0_01/toya:' }, goldCapture, importRules }).acceptedList.length, 3);
harness.equal('…a version neither stamps is refused as subjectAbsentFromGold', resolveImportRows({ sssomText: goodSetText, prefixExpansionByPrefix: { ...prefixMapDeclaration.prefixExpansion, toya: 'https://w3id.org/EDUcore/ToyA/9.9/toya:' }, goldCapture, importRules }).refusalList.map((oneRefusal) => oneRefusal.reasonCode).join(','), 'subjectAbsentFromGold,subjectAbsentFromGold,subjectAbsentFromGold');
harness.match('a file with no subject_id column is refused whole', resolveImportRows({ sssomText: '#mapping_set_id: "x:y"\npredicate_id\tobject_id\tmapping_justification\n', prefixExpansionByPrefix: {}, goldCapture, importRules }).error, /mandatory column 'subject_id' is absent/);

// =====================================================================
harness.section('importLayer: exact bytes frozen, layer and Candidate version appended, alreadyPresent, refusals by name');
// =====================================================================

const temporaryDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'layerImportTest-'));
const passingValidator = (validatedPath, validatedCallback) => validatedCallback('', { validateExit: 0, sssomPyRowCount: 3 });
const refusingValidator = (validatedPath, validatedCallback) => validatedCallback('exit 1: a stated validator refusal');
const importArgsFor = ({ layerRegistry, sssomText, versionTag = 'i1', authorIri = SOURCE_AUTHOR_IRI, validateWithSssomPy = passingValidator, decisionStore }) => ({
	sssomText,
	sssomPath: path.join(temporaryDirectoryPath, `${versionTag}.sssom.tsv`),
	slug: 'toySource',
	versionTag,
	authorIri,
	prefixMapDeclaration,
	goldCapture,
	registry: registryFor({ layerRegistry, agentRegistry }).registry,
	decisionStore,
	publishedAt: '2026-10-25T12:00:00.000Z',
	validateWithSssomPy,
	importRules,
});

decisionStoreLib.open({ databaseFilePath: path.join(temporaryDirectoryPath, 'decisions.sqlite3') }, (openError, decisionStore) => {
	if (openError) {
		harness.ok('the temporary decision store opens', false, openError);
		harness.report();
		return;
	}
	const steps = [];
	const importNow = (args, judge, next) => importLayer(args, (importError, imported) => { judge(importError, imported); next(); });
	const run = (args, judge) => steps.push((next) => importNow(args, judge, next));
	let registryAfterFirst = null;
	run(importArgsFor({ layerRegistry: statedLayerRegistry(), sssomText: brokenSetText, decisionStore }), (importError, imported) => {
		harness.ok('the broken set imports (its good rows), reporting its refusals', !importError, importError);
		if (importError) return;
		registryAfterFirst = imported.layerRegistry;
		harness.equal('accepted 3, refused 8', `${imported.acceptedRowCount}/${imported.refusedRowCount}`, '3/8');
		harness.equal('the version id is the file bytes\' sha256', imported.contentId, sha256Hex(brokenSetText));
		harness.equal('the block is layerSet::imported-toySource under that id', JSON.stringify(imported.wholeSetBlock), JSON.stringify({ pairKey: 'layerSet::imported-toySource', decisionBlockHash: sha256Hex(brokenSetText) }));
		const layer = imported.layerRegistry.layerList.find((oneLayer) => oneLayer.layerKey === 'imported-toySource');
		harness.ok('the layer imported-toySource is appended, kind imported', layer !== undefined && layer.layerKind === 'imported');
		harness.equal('…its one version is Candidate, tag i1', layer && `${layer.versionList.length} ${layer.versionList[0].registrationStatus} ${layer.versionList[0].administrationRecord.versionTag}`, '1 Candidate i1');
		harness.equal('…its standards and hubs are those the ACCEPTED rows name', layer && `${layer.standardList.map((oneStandard) => oneStandard.standardKey).join(',')} / ${layer.hubList.map((oneHub) => oneHub.hubKey).join(',')}`, 'toya / toyhub');
		harness.equal('…the import record keeps the counts by reason', layer && JSON.stringify(layer.versionList[0].importRecord.refusalCountByReasonCode), JSON.stringify({ unknownPrefix: 1, subjectNotAnElementIri: 1, subjectAbsentFromGold: 1, objectNotAHubReference: 1, malformedPredicate: 1, predicateNotAdmitted: 1, duplicateRecordId: 1, missingMandatoryCell: 1 }));
	});
	steps.push((next) => {
		decisionStore.getDecisionBlock({ pairKey: 'layerSet::imported-toySource' }, (getError, got) => {
			harness.equal('the stored text IS the file, byte for byte', got && got.frozenText, brokenSetText);
			next();
		});
	});
	steps.push((next) => {
		importNow(importArgsFor({ layerRegistry: registryAfterFirst, sssomText: brokenSetText, versionTag: 'i9', decisionStore }), (importError, imported) => {
			harness.ok('a second import of identical bytes reports alreadyPresent and writes no registry', !importError && imported.alreadyPresent === true && imported.layerRegistry === null, importError);
		}, next);
	});
	steps.push((next) => {
		importNow(importArgsFor({ layerRegistry: registryAfterFirst, sssomText: goodSetText, versionTag: 'i1', decisionStore }), (importError) => {
			harness.match('a tag already holding other bytes is refused', importError, /tag 'i1' of layer 'imported-toySource' already names other bytes/);
		}, next);
	});
	steps.push((next) => {
		importNow(importArgsFor({ layerRegistry: registryAfterFirst, sssomText: goodSetText, versionTag: 'i2', decisionStore }), (importError, imported) => {
			harness.ok('new bytes under a new tag append a SECOND version to the same layer', !importError && imported.layerRegistry.layerList.find((oneLayer) => oneLayer.layerKey === 'imported-toySource').versionList.length === 2, importError);
		}, next);
	});
	steps.push((next) => {
		importNow(importArgsFor({ layerRegistry: statedLayerRegistry(), sssomText: goodSetText, authorIri: 'https://w3id.org/EDUcore/agent/org/nobody', decisionStore }), (importError) => {
			harness.match('an unregistered author is refused', importError, /author https:\/\/w3id.org\/EDUcore\/agent\/org\/nobody is not in the agent registry/);
		}, next);
	});
	steps.push((next) => {
		importNow(importArgsFor({ layerRegistry: statedLayerRegistry(), sssomText: goodSetText, validateWithSssomPy: refusingValidator, decisionStore }), (importError) => {
			harness.match('a file sssom-py rejects is refused whole', importError, /fails sssom-py: exit 1/);
		}, next);
	});
	steps.push((next) => {
		importNow(importArgsFor({ layerRegistry: statedLayerRegistry(), sssomText: setTextOf([brokenRowList[0][0]]), decisionStore }), (importError, imported) => {
			harness.match('an import with no accepted row registers nothing', importError, /no row of .* resolved \(1 refused\)/);
			harness.equal('…and still returns its refusal list', imported && imported.refusalList.length, 1);
		}, next);
	});
	steps.push((next) => {
		// read the store file itself: the decision store has no listing verb, and a gate that cannot look is no gate
		const Database = require('../../../node_modules/better-sqlite3');
		const storeReader = new Database(path.join(temporaryDirectoryPath, 'decisions.sqlite3'), { readonly: true });
		const pairKeyList = storeReader.prepare('SELECT pairKey FROM decisionBlocks').all().map((oneRow) => oneRow.pairKey);
		storeReader.close();
		harness.ok(`no relationship block and no pair block: only layerSet:: blocks (${pairKeyList.length} stored)`, pairKeyList.length === 2 && pairKeyList.every((onePairKey) => onePairKey.indexOf('layerSet::') === 0), pairKeyList.join(', '));
		next();
	});
	const runNext = (stepIndex) => {
		if (stepIndex >= steps.length) {
			fs.rmSync(temporaryDirectoryPath, { recursive: true, force: true });
			harness.report();
			return;
		}
		steps[stepIndex](() => runNext(stepIndex + 1));
	};
	runNext(0);
});
