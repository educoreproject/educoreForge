#!/usr/bin/env node
'use strict';

// test-publicationIndex.js — gates for lib/layer-registry/publicationIndex.js, the listing of a gold's published mapping sets and card
// downloads that the educore downloads page reads (mappingLayers ML3.1 Part C). On STATED file facts shaped as the real published tree:
// every file is classified by the declared kinds (layerPublicationRules.json publicationFileKindList), carries its layer title and
// EFFECTIVE status or its hub release, and the listing is ordered by path; a file of no kind, a layer the registry lacks and a hub
// release the card report lacks are each refused by name.
//
// Run: node lib/layer-registry/test/test-publicationIndex.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for lib/layer-registry/publicationIndex.js

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);
const { publicationIndexFor, PUBLICATION_INDEX_FORMAT } = require('../publicationIndex');

const factOf = (relativePath) => ({ relativePath, byteSize: relativePath.length, sha256: 'e'.repeat(64) });
const fileFactList = [
	factOf('hubCards/CTDL/Release_20260927/cards.jsonld'),
	factOf('mappingLayers/layer/jev/cfg-03f64470322c/set.sssom.tsv'),
	factOf('mappingLayers/layer/jev/cfg-03f64470322c/context/edfi.jsonld'),
	factOf('mappingLayers/layer/jev/registry.sssom.yml'),
	factOf('mappingLayers/registry/layers.sssom.yml'),
	factOf('hubCards/CTDL/Release_20260927/cards.csv'),
];
const layerFactByLayerKey = { jev: { displayName: 'Jev judge layer', statusByVersionTag: { 'cfg-03f64470322c': 'Superseded' } } };
const hubFactByRelease = { 'CTDL/Release_20260927': { hubName: 'CTDL', hubVersion: 'Release 20260927', cardCount: 13996 } };
const statedInput = { graphName: 'GOLD_EVAL_TOY', publicLabel: 'educore-toy', manifestRefId: 'a'.repeat(64), generatedAt: '2026-10-26', fileFactList, layerFactByLayerKey, hubFactByRelease };

harness.section('every published file listed, classified and explained');
const indexed = publicationIndexFor(statedInput);
harness.ok('the stated tree indexes', indexed.error === undefined, indexed.error);
const entryList = indexed.error ? [] : indexed.publicationIndex.entryList;
harness.equal('the listing declares its format and the manifest it publishes', indexed.error ? '' : `${indexed.publicationIndex.manifestFormat} ${indexed.publicationIndex.publicLabel}`, `${PUBLICATION_INDEX_FORMAT} educore-toy`);
harness.equal('every file, ordered by path', entryList.map((oneEntry) => oneEntry.relativePath).join(','), fileFactList.map((oneFact) => oneFact.relativePath).sort().join(','));
const kindOf = (relativePath) => (entryList.find((oneEntry) => oneEntry.relativePath === relativePath) || {}).kind;
harness.equal('each file has its declared kind', ['mappingLayers/layer/jev/cfg-03f64470322c/set.sssom.tsv', 'mappingLayers/layer/jev/cfg-03f64470322c/context/edfi.jsonld', 'mappingLayers/layer/jev/registry.sssom.yml', 'mappingLayers/registry/layers.sssom.yml', 'hubCards/CTDL/Release_20260927/cards.csv', 'hubCards/CTDL/Release_20260927/cards.jsonld'].map(kindOf).join(','), 'mappingSet,mappingContext,layerRegistry,siteRegistry,hubCardsCsv,hubCardsJsonLd');
const setEntry = entryList.find((oneEntry) => oneEntry.kind === 'mappingSet') || {};
harness.ok("a set carries its layer's title and its version's EFFECTIVE status", setEntry.layerTitle === 'Jev judge layer' && setEntry.registrationStatus === 'Superseded' && setEntry.versionTag === 'cfg-03f64470322c');
const cardEntry = entryList.find((oneEntry) => oneEntry.kind === 'hubCardsCsv') || {};
harness.ok('a card file carries its hub, release and card count', cardEntry.hubName === 'CTDL' && cardEntry.hubVersion === 'Release 20260927' && cardEntry.cardCount === 13996);

harness.section('refusals, each by name');
harness.match('a published file of no declared kind is refused', publicationIndexFor({ ...statedInput, fileFactList: fileFactList.concat([factOf('mappingLayers/stray.txt')]) }).error, /is of no declared kind/);
harness.match('a layer the registry of record lacks is refused', publicationIndexFor({ ...statedInput, layerFactByLayerKey: {} }).error, /names layer 'jev'.*does not hold/);
harness.match('a hub release the card report lacks is refused', publicationIndexFor({ ...statedInput, hubFactByRelease: {} }).error, /names hub release CTDL\/Release_20260927/);
harness.match('an absent label is refused, never defaulted', publicationIndexFor({ ...statedInput, publicLabel: '' }).error, /absent: publicLabel/);

harness.report();
