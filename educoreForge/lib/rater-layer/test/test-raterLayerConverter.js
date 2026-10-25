#!/usr/bin/env node
'use strict';

// test-raterLayerConverter.js — gates for lib/rater-layer (mappingLayers ML2-a). Hermetic: STATED rater rows (literal, never the demo
// store), a stated suggested list, the real raterLayerSources.json and the real exporter constants; the CLI half writes a throwaway
// sqlite in the OS temp directory whose raters.displayJson carries canary names, and proves none reaches any output.
//
// Run: node lib/rater-layer/test/test-raterLayerConverter.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for lib/rater-layer/raterLayerConverter and raterLayerCli

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Converts a small stated rater population and proves: the row mapping (Best -> edc:bestMatch, Same -> edc:alsoAcceptable,
     noMatch -> the exporter's own skos:mappingRelation / sssom:NoTermFound pair, unsure -> no row, counted); byte-identical output
     on a re-run and on shuffled input; that one altered answer changes only that subject's rows; the per-rater and pooled sets and
     their authors; exclusion of an unresolved element by name; and each refusal by name (unlisted standard, unlabelled card, a card
     outside the hub, two current answers for one pair, an unknown rater). The CLI half proves raters.displayJson never reaches output.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const harness = require('../../../test/testLib/harness')(moduleName);
const { convertRaterStore } = require('../raterLayerConverter');
const raterLayerSources = require('../raterLayerSources.json');
const { NO_TERM_FOUND_PREDICATE_ID, NO_TERM_FOUND_OBJECT_ID } = require('../../bridge-framework/sssomExporter');
const Database = require('../../../node_modules/better-sqlite3');

const CARD_A = 'https://w3id.org/EDUcore/CEDStandards/hub/14.0.0.0/aaaa';
const CARD_B = 'https://w3id.org/EDUcore/CEDStandards/hub/14.0.0.0/bbbb';
const CARD_ADDED = 'https://w3id.org/EDUcore/CEDStandards/hub/14.0.0.0/cccc';
const ELEMENT_EDFI = 'Ed-Fi:edfi:property/domainEntity.Toy.Alpha';
const ELEMENT_SIF = 'SIF:sif260928:field/Toys/Toy/Beta';
const ELEMENT_PESC = 'PESC:pescacademiceportfolio1v0v0:property/Toy.Gamma';
const raterRowList = [
	{ refId: 'refIdRater04', raterUserName: 'rater-04', surveyName: 'A' },
	{ refId: 'refIdRater05', raterUserName: 'rater-05', surveyName: 'B' },
	{ refId: 'refIdRater07', raterUserName: 'rater-07', surveyName: 'C' },
];
const suggestedByElementStableId = {
	[ELEMENT_EDFI]: { cardList: [{ cedsTupleId: CARD_A, className: 'Toy Class', propertyName: 'Alpha Property', qualifierNameList: ['Q1'] }, { cedsTupleId: CARD_B, className: 'Toy Class', propertyName: 'Beta Property', qualifierNameList: [] }] },
	[ELEMENT_SIF]: { cardList: [{ cedsTupleId: CARD_B, className: 'Toy Class', propertyName: 'Beta Property', qualifierNameList: [] }] },
	[ELEMENT_PESC]: { cardList: [] },
};
const answerOf = (answer) => JSON.stringify({ sameCedsTupleIdList: [], note: '', addedCardList: [], searchesTyped: [], ...answer });
const answerRowListFor = () => [
	{ raterUserName: 'rater-04', elementStableId: ELEMENT_EDFI, answerJson: answerOf({ answerKind: 'cards', bestCedsTupleId: CARD_A, sameCedsTupleIdList: [CARD_B] }) },
	{ raterUserName: 'rater-04', elementStableId: ELEMENT_SIF, answerJson: answerOf({ answerKind: 'noMatch', bestCedsTupleId: null }) },
	{ raterUserName: 'rater-05', elementStableId: ELEMENT_EDFI, answerJson: answerOf({ answerKind: 'cards', bestCedsTupleId: CARD_A }) },
	{ raterUserName: 'rater-05', elementStableId: ELEMENT_PESC, answerJson: answerOf({ answerKind: 'cards', bestCedsTupleId: CARD_ADDED, addedCardList: [{ cedsTupleId: CARD_ADDED, className: 'Added Class', propertyName: 'Added Property', qualifierNameList: [] }] }) },
	{ raterUserName: 'rater-05', elementStableId: ELEMENT_SIF, answerJson: answerOf({ answerKind: 'unsure', bestCedsTupleId: null, note: 'why' }) },
	{ raterUserName: 'rater-07', elementStableId: ELEMENT_SIF, answerJson: answerOf({ answerKind: 'unsure', bestCedsTupleId: null, note: 'why' }) },
];
const historyRowList = [
	{ raterUserName: 'rater-04', elementStableId: ELEMENT_EDFI },
	{ raterUserName: 'rater-04', elementStableId: ELEMENT_EDFI },
	{ raterUserName: 'rater-05', elementStableId: ELEMENT_EDFI },
];
const convertWith = (overrides = {}) => convertRaterStore({ answerRowList: answerRowListFor(), raterRowList, historyRowList, suggestedByElementStableId, unresolvedElementStableIdList: [], raterLayerSources, versionTag: 'r1', ...overrides });
const bodyRowsOf = (setText) => setText.split('\n').filter((oneLine) => oneLine.length > 0 && !oneLine.startsWith('#')).slice(1).map((oneLine) => oneLine.split('\t'));
const columnListOf = (setText) => setText.split('\n').find((oneLine) => oneLine.length > 0 && !oneLine.startsWith('#')).split('\t');
const rowObjectsOf = (setText) => bodyRowsOf(setText).map((cellList) => columnListOf(setText).reduce((soFar, oneColumn, columnIndex) => ({ ...soFar, [oneColumn]: cellList[columnIndex] }), {}));

// =====================================================================
harness.section('row mapping (D-RATERPRED; SPEC §8.1)');
// =====================================================================
const converted = convertWith();
harness.ok('the stated population converts', converted.error === undefined, converted.error);
const pooledRowList = rowObjectsOf(converted.setTextByLayerKey.raters);
harness.equal('pooled rows: rater-04 Best + Same + noMatch, rater-05 Best + added Best; unsure none', pooledRowList.length, 5);
harness.equal('Best is edc:bestMatch with the title the rater saw', JSON.stringify(pooledRowList.filter((oneRow) => oneRow.object_id === CARD_A).map((oneRow) => [oneRow.predicate_id, oneRow.object_label])), JSON.stringify([['edc:bestMatch', 'Toy Class → Alpha Property (Q1)'], ['edc:bestMatch', 'Toy Class → Alpha Property (Q1)']]));
harness.equal('Same is edc:alsoAcceptable', pooledRowList.filter((oneRow) => oneRow.object_id === CARD_B).map((oneRow) => oneRow.predicate_id).join(','), 'edc:alsoAcceptable');
const noMatchRow = pooledRowList.find((oneRow) => oneRow.object_id === NO_TERM_FOUND_OBJECT_ID);
harness.equal('noMatch uses the EXPORTER\'S abstention predicate (ML1 doubt 2)', noMatchRow.predicate_id, NO_TERM_FOUND_PREDICATE_ID);
harness.equal('  …which is skos:mappingRelation, stated literally so a change to the exporter shows red here', noMatchRow.predicate_id, 'skos:mappingRelation');
harness.equal('  …with mapping_cardinality 1:0', noMatchRow.mapping_cardinality, '1:0');
harness.equal('an added card takes its label from the answer\'s addedCardList', pooledRowList.find((oneRow) => oneRow.object_id === CARD_ADDED).object_label, 'Added Class → Added Property');
harness.equal('subject_id is the forged stableId, the display prefix dropped', pooledRowList[0].subject_id, 'edfi:property/domainEntity.Toy.Alpha');
harness.equal('subject_source and version come from raterLayerSources.json', `${noMatchRow.subject_source} ${noMatchRow.subject_source_version}`, 'urn:educore:sif260928: 4.3');
harness.equal('rows sort by subject, predicate rank, object, author', pooledRowList.map((oneRow) => `${oneRow.subject_id.slice(0, 4)}/${oneRow.predicate_id}/${oneRow.author_id.slice(-2)}`).join(' '), 'edfi/edc:bestMatch/04 edfi/edc:bestMatch/05 edfi/edc:alsoAcceptable/04 pesc/edc:bestMatch/05 sif2/skos:mappingRelation/04');
harness.match('no mapping_date and no record_id (ruled: ML3)', columnListOf(converted.setTextByLayerKey.raters).join(' '), /^(?!.*(mapping_date|record_id)).*$/);
harness.match('the header says what edc:bestMatch means', converted.setTextByLayerKey.raters, /#comment: ".*never asked a SKOS relation/);

// =====================================================================
harness.section('layers, authors and agents');
// =====================================================================
harness.equal('a set per rater with a row, plus the pooled set', Object.keys(converted.setTextByLayerKey).sort().join(','), 'rater-04,rater-05,raters');
harness.match('the pooled set is provided by the pooling organisation', converted.setTextByLayerKey.raters, /#mapping_provider: "https:\/\/w3id\.org\/EDUcore\/agent\/org\/educore"/);
harness.match('a rater set is provided by edc:agent/<raters.refId>', converted.setTextByLayerKey['rater-05'], /#mapping_provider: "https:\/\/w3id\.org\/EDUcore\/agent\/refIdRater05"/);
harness.equal('every pooled row names its rater in author_id', Array.from(new Set(pooledRowList.map((oneRow) => oneRow.author_id))).sort().join(' '), 'https://w3id.org/EDUcore/agent/refIdRater04 https://w3id.org/EDUcore/agent/refIdRater05');
harness.equal('the set id is the layer version URI', /#mapping_set_id: "([^"]+)"/.exec(converted.setTextByLayerKey['rater-04'])[1], 'https://w3id.org/EDUcore/layer/rater-04/r1');
harness.equal('a rater whose every answer is unsure gets no set, and the census says why', converted.censusByLayerKey['rater-07'].noSetBecause, 'every answer is unsure, so the set would carry no row');
harness.equal('agents are pseudonymous: "rater NN, survey X"', converted.agentRowList.map((oneAgent) => oneAgent.displayName).join(' | '), 'rater 04, survey A | rater 05, survey B | rater 07, survey C');
harness.equal('layer rows name the standards their set covers', JSON.stringify(converted.layerRowList.find((oneLayer) => oneLayer.layerKey === 'raters').standardKeyList), JSON.stringify(['edfi', 'pescacademiceportfolio1v0v0', 'sif260928']));

// =====================================================================
harness.section('census: unsure counted, history counted, never rows');
// =====================================================================
harness.equal('pooled: 6 answers read, 2 unsure', `${converted.censusByLayerKey.raters.answerReadCount} ${converted.censusByLayerKey.raters.unsureCount}`, '6 2');
harness.equal('pooled: 3 history rows, 1 changed answer (rater-04 on Ed-Fi)', `${converted.censusByLayerKey.raters.historyRowCount} ${converted.censusByLayerKey.raters.changedAnswerCount}`, '3 1');
harness.equal('the unsure subjects are listed, never scored', JSON.stringify(converted.censusByLayerKey['rater-05'].unsureSubjectList), JSON.stringify(['sif260928:field/Toys/Toy/Beta']));
harness.equal('  …and as (author, element) units for the agreement tool', JSON.stringify(converted.censusByLayerKey.raters.unsureUnitList), JSON.stringify([{ authorIri: 'https://w3id.org/EDUcore/agent/refIdRater05', elementStableId: 'sif260928:field/Toys/Toy/Beta' }, { authorIri: 'https://w3id.org/EDUcore/agent/refIdRater07', elementStableId: 'sif260928:field/Toys/Toy/Beta' }]));

// =====================================================================
harness.section('determinism and locality');
// =====================================================================
harness.equal('a re-run gives byte-identical sets and census', JSON.stringify(convertWith()), JSON.stringify(converted));
harness.equal('shuffled input rows give byte-identical sets', JSON.stringify(convertWith({ answerRowList: answerRowListFor().reverse() }).setTextByLayerKey), JSON.stringify(converted.setTextByLayerKey));
const alteredRowList = answerRowListFor().map((oneRow) => (oneRow.raterUserName === 'rater-05' && oneRow.elementStableId === ELEMENT_EDFI ? { ...oneRow, answerJson: answerOf({ answerKind: 'cards', bestCedsTupleId: CARD_B }) } : oneRow));
const alteredSetText = convertWith({ answerRowList: alteredRowList }).setTextByLayerKey.raters;
const changedLineList = alteredSetText.split('\n').filter((oneLine) => converted.setTextByLayerKey.raters.split('\n').indexOf(oneLine) === -1);
harness.equal('one altered answer changes exactly one pooled row, that subject\'s', changedLineList.length === 1 && changedLineList[0].indexOf('edfi:property/domainEntity.Toy.Alpha') === 0 && changedLineList[0].indexOf(CARD_B) !== -1 && changedLineList[0].indexOf('refIdRater05') !== -1, true);
harness.equal('  …and the other rater\'s set is untouched', convertWith({ answerRowList: alteredRowList }).setTextByLayerKey['rater-04'], converted.setTextByLayerKey['rater-04']);
const excluded = convertWith({ unresolvedElementStableIdList: [ELEMENT_PESC] });
harness.equal('an unresolved element is excluded by name and makes no row', `${JSON.stringify(excluded.censusByLayerKey.raters.excludedUnresolvedList)} ${excluded.setTextByLayerKey.raters.indexOf('pescacademic') === -1}`, `${JSON.stringify([`rater-05|${ELEMENT_PESC}`])} true`);

// =====================================================================
harness.section('refusals, each by name');
// =====================================================================
const refusalFor = (answerRowList, extra = {}) => convertWith({ answerRowList, ...extra }).error;
harness.rejects('an unlisted standard prefix', [refusalFor([{ raterUserName: 'rater-04', elementStableId: 'Toy:toystandard:property/X', answerJson: answerOf({ answerKind: 'noMatch', bestCedsTupleId: null }) }])].filter(Boolean), /names standard "toystandard", which is not listed/);
harness.rejects('a card neither suggested nor added (no label)', [refusalFor([{ raterUserName: 'rater-04', elementStableId: ELEMENT_SIF, answerJson: answerOf({ answerKind: 'cards', bestCedsTupleId: CARD_A }) }])].filter(Boolean), /neither suggested nor added, so it has no label/);
harness.rejects('a card outside the hub release', [refusalFor([{ raterUserName: 'rater-04', elementStableId: ELEMENT_SIF, answerJson: answerOf({ answerKind: 'cards', bestCedsTupleId: 'https://w3id.org/EDUcore/CEDStandards/hub/13.0.0.0/zzzz' }) }])].filter(Boolean), /not a CEDS 14\.0\.0\.0 card URI/);
harness.rejects('two current answers for one (rater, element)', [refusalFor(answerRowListFor().concat([answerRowListFor()[0]]))].filter(Boolean), /two current answers for rater-04\|Ed-Fi/);
harness.rejects('an answer by an account that is not a rater-NN', [refusalFor([{ raterUserName: 'tqtest', elementStableId: ELEMENT_SIF, answerJson: answerOf({ answerKind: 'noMatch', bestCedsTupleId: null }) }])].filter(Boolean), /names no rater account matching/);
harness.rejects('an unreadable answerKind', [refusalFor([{ raterUserName: 'rater-04', elementStableId: ELEMENT_SIF, answerJson: answerOf({ answerKind: 'maybe' }) }])].filter(Boolean), /is not a readable answer \(answerKind "maybe"\)/);
harness.rejects('an absent input list', [convertRaterStore({ answerRowList: [], raterRowList, suggestedByElementStableId, unresolvedElementStableIdList: [], raterLayerSources, versionTag: 'r1' }).error].filter(Boolean), /historyRowList is not a list/);

// =====================================================================
harness.section('the CLI never reads raters.displayJson');
// =====================================================================
const temporaryDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'raterLayerCliTest-'));
const storePath = path.join(temporaryDirectoryPath, 'raterStoreCopy.sqlite3');
const canaryNameList = ['Canary Realname', 'canary@example.invalid'];
const fixtureStore = new Database(storePath);
fixtureStore.exec('CREATE TABLE raters (refId TEXT PRIMARY KEY, raterUserName TEXT, surveyName TEXT, displayJson TEXT); CREATE TABLE answers (refId TEXT PRIMARY KEY, raterUserName TEXT, elementStableId TEXT, answerJson TEXT, savedAt TEXT); CREATE TABLE answerHistory (refId TEXT PRIMARY KEY, raterUserName TEXT, elementStableId TEXT, answerJson TEXT, savedAt TEXT, historySequence TEXT);');
raterRowList.forEach((oneRater) => fixtureStore.prepare('INSERT INTO raters VALUES (?, ?, ?, ?)').run(oneRater.refId, oneRater.raterUserName, oneRater.surveyName, JSON.stringify({ whoText: canaryNameList[0], emailAdr: canaryNameList[1] })));
answerRowListFor().forEach((oneRow, rowIndex) => fixtureStore.prepare('INSERT INTO answers VALUES (?, ?, ?, ?, ?)').run(`answer${rowIndex}`, oneRow.raterUserName, oneRow.elementStableId, oneRow.answerJson, '2026-10-25T00:00:00.000Z'));
fixtureStore.close();
const suggestedPath = path.join(temporaryDirectoryPath, 'suggested.json');
const unresolvedListPath = path.join(temporaryDirectoryPath, 'unresolved.json');
fs.writeFileSync(suggestedPath, JSON.stringify({ suggestedByElementStableId }));
fs.writeFileSync(unresolvedListPath, '[]');
const outputDirPath = path.join(temporaryDirectoryPath, 'out');
const cliRun = spawnSync(process.execPath, [path.join(__dirname, '..', 'raterLayerCli.js'), `--raterStoreCopyPath=${storePath}`, `--suggestedPath=${suggestedPath}`, `--unresolvedListPath=${unresolvedListPath}`, '--versionTag=r1', `--outputDirPath=${outputDirPath}`], { encoding: 'utf8' });
harness.equal('the CLI exits 0 over the fixture store', cliRun.status, 0);
const outputText = fs.readdirSync(outputDirPath).map((oneFile) => fs.readFileSync(path.join(outputDirPath, oneFile), 'utf8')).join('\n');
harness.equal('it writes the three sets, the census and the registry rows', fs.readdirSync(outputDirPath).sort().join(','), 'rater-04.r1.sssom.tsv,rater-05.r1.sssom.tsv,raterLayerCensus.r1.json,raterLayerRegistryRows.r1.json,raters.r1.sssom.tsv');
harness.equal('no displayJson value appears in any output', canaryNameList.filter((canaryText) => outputText.indexOf(canaryText) !== -1).join(','), '');
harness.equal('the CLI\'s pooled set equals the library\'s', fs.readFileSync(path.join(outputDirPath, 'raters.r1.sssom.tsv'), 'utf8'), converted.setTextByLayerKey.raters);
const bareRun = spawnSync(process.execPath, [path.join(__dirname, '..', 'raterLayerCli.js')], { encoding: 'utf8' });
harness.match('a bare run refuses by name and does not print the full page', `${bareRun.status} ${bareRun.stderr}`, /^1 raterLayerCli: --raterStoreCopyPath, .* REQUIRED, with no default/);
fs.rmSync(temporaryDirectoryPath, { recursive: true, force: true });

harness.report();
