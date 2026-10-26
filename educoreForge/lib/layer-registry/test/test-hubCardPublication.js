#!/usr/bin/env node
'use strict';

// test-hubCardPublication.js — gates for lib/layer-registry/hubCardPublication.js, the card download per hub release (mappingLayers
// ML3.1 Part C, TQ Q8). On STATED cards shaped as the goldWave3 cards are (a CEDS property card, a CEDS value card with a comma and a
// quote in its definition, a CEDS term card, a CTDL property card with a range LIST): one file pair per hub release, every field read
// from the card (never composed), RFC 4180 quoting, JSON-LD that parses with the definition as skos:definition; a held hub, a hub with
// no bundle row and a card that is not a meaning URI are each refused by name.
//
// Run: node lib/layer-registry/test/test-hubCardPublication.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for lib/layer-registry/hubCardPublication.js

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);
const { hubCardFileListFor, CARD_COLUMN_LIST } = require('../hubCardPublication');
const { hubBundleTokenByHubName } = require('../layerPublicationRules.json');

const CEDS_BASE = 'https://w3id.org/EDUcore/CEDStandards/hub/14.0.0.0/';
const CTDL_BASE = 'https://w3id.org/EDUcore/CTDL/hub/Release_20260927/';
const cardList = [
	{ uri: `${CEDS_BASE}${'b'.repeat(64)}`, hubName: 'CEDS', hubVersion: '14.0.0.0', referenceTier: 'value', domainId: 'C200010', domainName: 'Assessment', propertyKey: 'P001637', propertyName: 'Has ISO 639-3 Language Code', rangeOptionSetName: 'ISO 639-3 Language Code', valueKey: 'NI001637175776', valueName: 'Yankunytjatjara', valueDefinition: 'A "Western Desert" language, spoken in SA', propertyDefinition: 'The code for the language.' },
	{ uri: `${CEDS_BASE}${'a'.repeat(64)}`, hubName: 'CEDS', hubVersion: '14.0.0.0', referenceTier: 'property', domainId: 'C200010', domainName: 'Assessment', propertyKey: 'P001637', propertyName: 'Has ISO 639-3 Language Code', rangeOptionSetName: 'ISO 639-3 Language Code', propertyDefinition: 'The code for the language.' },
	{ uri: `${CEDS_BASE}${'c'.repeat(64)}`, hubName: 'CEDS', hubVersion: '14.0.0.0', referenceTier: 'term', termIri: 'https://w3id.org/CEDStandards/terms/C200010', termName: 'Assessment', termDefinition: 'An instrument used to evaluate a person.' },
	{ uri: `${CTDL_BASE}${'d'.repeat(64)}`, hubName: 'CTDL', hubVersion: 'Release 20260927', referenceTier: 'property', domainId: 'ceterms:Diploma', domainName: 'Diploma', propertyKey: 'ceterms:approvedBy', propertyName: 'Approved By', rangeClassNameList: ['Credential Organization', 'Organization'], propertyDefinition: 'Agent that pronounces favorable judgment for this resource.' },
];
const csvRowsOf = (csvText) => csvText.trim().split('\r\n');

harness.section('one file pair per hub release, every field read from the card');
const rendered = hubCardFileListFor({ cardList, hubBundleTokenByHubName, heldBundleTokenList: ['edfi'] });
harness.ok('the stated cards render', rendered.error === undefined, rendered.error);
const fileList = rendered.error ? [] : rendered.hubFileList;
harness.equal('one file pair per hub release, named by the meaning URI\'s own segments', fileList.map((oneFile) => `${oneFile.hubSegment}/${oneFile.hubReleaseSegment}:${oneFile.cardCount}`).join(','), 'CEDStandards/14.0.0.0:3,CTDL/Release_20260927:1');
const cedsRowList = csvRowsOf(fileList[0].csvText);
harness.equal('the header is the declared columns', cedsRowList[0], CARD_COLUMN_LIST.map((oneColumn) => oneColumn.columnName).join(','));
harness.ok('rows are ordered by meaning URI (the property card a… before the value card b…)', cedsRowList[1].indexOf(`${CEDS_BASE}${'a'.repeat(64)}`) === 0 && cedsRowList[2].indexOf(`${CEDS_BASE}${'b'.repeat(64)}`) === 0);
harness.ok('a value card carries its domain, property, range, value and its OWN definition (the value\'s, not the property\'s), RFC 4180 quoted', cedsRowList[2].indexOf(',value,C200010,Assessment,P001637,Has ISO 639-3 Language Code,ISO 639-3 Language Code,NI001637175776,Yankunytjatjara,,,"A ""Western Desert"" language, spoken in SA"') !== -1, cedsRowList[2]);
harness.ok('a term card carries its term, its definition, and an empty domain (a term has none on its card)', cedsRowList[3].indexOf(',term,,,,,,,,https://w3id.org/CEDStandards/terms/C200010,Assessment,An instrument used to evaluate a person.') !== -1, cedsRowList[3]);
harness.ok("a CTDL range LIST is joined with '|', never composed into prose", csvRowsOf(fileList[1].csvText)[1].indexOf(',Credential Organization|Organization,') !== -1, csvRowsOf(fileList[1].csvText)[1]);
const jsonLd = JSON.parse(fileList[0].jsonLdText);
harness.ok('the JSON-LD parses, names each card by its meaning URI, and maps definition to skos:definition', jsonLd['@graph'].length === 3 && jsonLd['@graph'][0]['@id'] === `${CEDS_BASE}${'a'.repeat(64)}` && jsonLd['@context'].definition === 'skos:definition');
harness.ok('the JSON-LD leaves out an absent field rather than writing it empty', jsonLd['@graph'][2].domainId === undefined && jsonLd['@graph'][2].termName === 'Assessment');
harness.equal('the same cards give the same bytes', JSON.stringify(hubCardFileListFor({ cardList: cardList.slice().reverse(), hubBundleTokenByHubName, heldBundleTokenList: ['edfi'] })), JSON.stringify(rendered));

harness.section('refusals, each by name');
harness.match('a hub whose bundle is on the licence-hold list is refused', hubCardFileListFor({ cardList, hubBundleTokenByHubName, heldBundleTokenList: ['ctdl'] }).error, /hub 'CTDL' \(bundle 'ctdl'\) is on the licence-hold list/);
harness.match('a hub with no bundle row is refused, never guessed', hubCardFileListFor({ cardList: cardList.concat([{ ...cardList[0], hubName: 'TOYHUB' }]), hubBundleTokenByHubName, heldBundleTokenList: [] }).error, /hub 'TOYHUB' has no bundleToken/);
harness.match('a card that is not a meaning URI is refused', hubCardFileListFor({ cardList: [{ ...cardList[0], uri: 'https://w3id.org/EDUcore/EdFi/5.2.0/edfi:property/X' }], hubBundleTokenByHubName, heldBundleTokenList: [] }).error, /is not a meaning URI/);
harness.match('absent inputs are refused, never defaulted', hubCardFileListFor({ cardList: [], hubBundleTokenByHubName, heldBundleTokenList: [] }).error, /are required/);

harness.report();
