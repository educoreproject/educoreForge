#!/usr/bin/env node
'use strict';

// test-elementPathPrefix.js — a standard whose stableIds are absolute IRIs gets element URIs through uriScheme.json's
// elementPathPrefixDeclaration (cedsElementUri-110326, TQ 2026-11-03): every kind that spells an element mints the declared form, parsing
// reverses it exactly, the resolver reads the row by the stableId, and everything outside the declaration is refused by name.
// Pure: no store, no socket. The real store's rows are proven by the gates in zNotesPlansDocs/cedsElementUri-110326/runs.
// Run: node lib/edc-uri/test/test-elementPathPrefix.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for uriScheme.json elementPathPrefixDeclaration

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const path = require('path');
const harness = require('../../../test/testLib/harness')(moduleName);
const edcUri = require('../edcUri');
const assertionIdentity = require('../assertionIdentity');
const { subjectCurieFor, stableIdOfSubjectCurie } = require('../subjectCurie');
const { resolveEdcUri } = require('../stubResolver');
const { layerEntryFor } = require('../../layer-import/layerImport');
const importRules = require('../../layer-import/importRules.json');

const { mint, parse, schemeLoadRefusalFor, URI_SCHEME } = edcUri;
const BASE = URI_SCHEME.baseIri;
const TERMS = 'https://w3id.org/CEDStandards/terms/';
const cedsParts = { standardName: 'CEDS', standardVersion: '14.0.0.0' };
const elementOf = (elementStableId, standardName = 'CEDS', standardVersion = '14.0.0.0') => mint({ kind: 'element', standardName, standardVersion, elementStableId });

harness.section('the spelling, pinned: a URI is forever');
[
	['a property', `${TERMS}P000033`, 'CEDS/14.0.0.0/ceds:P000033'],
	['the standard root (an empty local part, as other roots are addressable)', TERMS, 'CEDS/14.0.0.0/ceds:'],
	['an option value', `${TERMS}NI000002113286`, 'CEDS/14.0.0.0/ceds:NI000002113286'],
	["a fragment row: '#' encoded, as PESC's and MedBiquitous's", `${TERMS}C000193#editHistory/0`, 'CEDS/14.0.0.0/ceds:C000193%23editHistory/0'],
	["an embedText row: '/' literal, as every standard's", `${TERMS}embedText/0009f113`, 'CEDS/14.0.0.0/ceds:embedText/0009f113'],
].forEach(([label, stableId, expectedPath]) => {
	const minted = elementOf(stableId);
	harness.equal(`${label}: the URI`, minted.uri, `${BASE}${expectedPath}`);
	harness.equal(`${label}: the CURIE`, minted.curie, `edc:${expectedPath}`);
	harness.equal(`${label}: parsing the URI returns the stableId`, parse(minted.uri).partByName.elementStableId, stableId);
	harness.equal(`${label}: parsing the CURIE returns the stableId`, parse(minted.curie).partByName.elementStableId, stableId);
});

harness.section('every kind that spells an element spells it the same way');
const cedsElement = { ...cedsParts, elementStableId: `${TERMS}P000033` };
const HASH = 'a'.repeat(64);
[
	[{ kind: 'interpretationPinned', ...cedsElement, layerKey: 'jev', versionTag: 'base' }, 'CEDS/14.0.0.0/ceds:P000033@jev/base'],
	[{ kind: 'interpretationFloating', ...cedsElement, layerKey: 'jev' }, 'CEDS/14.0.0.0/ceds:P000033@jev'],
	[{ kind: 'question', publicLabel: 'educore-2026-10-30', ...cedsElement }, 'manifest/educore-2026-10-30/q/CEDS/14.0.0.0/ceds:P000033'],
	[{ kind: 'questionForHub', publicLabel: 'educore-2026-10-30', hubSegment: 'CTDL', ...cedsElement }, 'manifest/educore-2026-10-30/q/hub/CTDL/CEDS/14.0.0.0/ceds:P000033'],
	[{ kind: 'questionByContent', manifestRefId: HASH, ...cedsElement }, `manifest/sha256/${HASH}/q/CEDS/14.0.0.0/ceds:P000033`],
	[{ kind: 'questionForHubByContent', manifestRefId: HASH, hubSegment: 'CTDL', ...cedsElement }, `manifest/sha256/${HASH}/q/hub/CTDL/CEDS/14.0.0.0/ceds:P000033`],
].forEach(([partByName, expectedPath]) => {
	const minted = mint(partByName);
	harness.equal(`${partByName.kind}: the URI`, minted.uri, `${BASE}${expectedPath}`);
	const parsed = parse(minted.uri);
	harness.equal(`${partByName.kind}: parses as itself`, parsed.kind, partByName.kind);
	harness.equal(`${partByName.kind}: parsing returns the stableId`, parsed.partByName.elementStableId, `${TERMS}P000033`);
});

harness.section('refusals, each by name');
harness.match('a CEDS row outside the expansion (the w3.org vocabulary rows)', elementOf('http://www.w3.org/2002/07/owl#Class').error, /REFUSED.*is outside https:\/\/w3id.org\/CEDStandards\/terms\//);
harness.match('a CEDS hub card is no element', elementOf('https://w3id.org/EDUcore/CEDStandards/hub/14.0.0.0/abc').error, /REFUSED.*is outside/);
harness.match('the spelling itself is no stableId, so it cannot be minted twice over', elementOf('ceds:P000033').error, /REFUSED.*is outside/);
harness.match('a stableId of another prefix under CEDS', elementOf('edfi:property/X').error, /REFUSED.*is outside/);
harness.match('mint: a ceds: stableId under another standard', elementOf('ceds:P000033', 'EdFi', '5.2.0').error, /REFUSED.*the prefix 'ceds' belongs to standard 'CEDS'/);
harness.match('parse: a ceds: URI under another standard', parse(`${BASE}EdFi/5.2.0/ceds:P000033`).error, /REFUSED.*the prefix 'ceds' belongs to standard 'CEDS'/);
harness.match('parse: a ceds: interpretation under another standard', parse(`${BASE}EdFi/5.2.0/ceds:P000033@jev`).error, /REFUSED.*the prefix 'ceds' belongs to standard 'CEDS'/);
harness.match('parse: another prefix under CEDS', parse(`${BASE}CEDS/14.0.0.0/edfi:property/X`).error, /REFUSED.*does not begin with its prefix 'ceds:'/);
harness.match("parse: no prefix under CEDS", parse(`${BASE}CEDS/14.0.0.0/P000033`).error, /REFUSED.*does not begin with its prefix 'ceds:'/);
harness.match("parse: the prefix spelled with an escaped ':' is another spelling", parse(`${BASE}CEDS/14.0.0.0/ceds%3AP000033`).error, /matches no kind/);
harness.match('the absolute IRI under another standard stays refused', elementOf(`${TERMS}P000033`, 'EdFi', '5.2.0').error, /REFUSED/);
harness.match("the CEDS forge's own layer IRIs stay outside every kind (worklist item 11 is not absorbed)", parse(`${BASE}CEDStandards/layer/guide/14/concept/Resource`).error, /matches no kind/);

harness.section('every other standard is untouched');
harness.equal('a CURIE-shaped stableId mints as it did', elementOf('edfi:property/X', 'EdFi', '5.2.0').uri, `${BASE}EdFi/5.2.0/edfi:property/X`);
harness.equal('…and parses as it did', parse(`${BASE}EdFi/5.2.0/edfi:property/X`).partByName.elementStableId, 'edfi:property/X');
harness.equal('a CEDS meaning is not an element and is untouched', parse(`${BASE}CEDStandards/hub/14.0.0.0/abc`).kind, 'meaning');

harness.section('identity: the IRI is what is hashed, never the URI');
harness.equal('nodeIriFor takes the CEDS IRI as its own', assertionIdentity.nodeIriFor({ stableId: `${TERMS}P000033`, standardName: 'CEDS', standardVersion: '14.0.0.0' }).iri, `${TERMS}P000033`);
harness.equal('the recipe, pinned on a CEDS subject', assertionIdentity.assertionIdFor({ decisionBlockHash: HASH, subjectStableId: `${TERMS}P000033`, subjectStandardName: 'CEDS', subjectStandardVersion: '14.0.0.0', predicateCurie: 'skos:exactMatch', objectStableId: `${BASE}CTDL/hub/Release%2020260927/abc` }).assertionHash, require('crypto').createHash('sha256').update(`${TERMS}P000033\nhttp://www.w3.org/2004/02/skos/core#exactMatch\n${BASE}CTDL/hub/Release%2020260927/abc`, 'utf8').digest('hex'));

harness.section('the subject CURIE follows the one spelling');
const subjectIdentity = subjectCurieFor({ stableId: `${TERMS}C000193#editHistory/0`, ...cedsParts });
harness.equal('the subject CURIE', subjectIdentity.subjectCurie, 'ceds:C000193%23editHistory/0');
harness.equal('expansion + local part = the minted IRI', `${subjectIdentity.expansion}${subjectIdentity.subjectCurie.slice('ceds:'.length)}`, elementOf(`${TERMS}C000193#editHistory/0`).uri);
harness.equal('decodes back to the IRI', stableIdOfSubjectCurie(subjectIdentity.subjectCurie).stableId, `${TERMS}C000193#editHistory/0`);
harness.match('a row outside the expansion is refused', subjectCurieFor({ stableId: 'http://www.w3.org/2002/07/owl#Class', ...cedsParts }).error, /is outside/);

harness.section('an import names the standard by the declared prefix, never by the IRI\'s scheme');
const importedEntry = layerEntryFor({ layerKey: 'toyImport', slug: 'toyImport', authorIri: `${BASE}agent/org/toySource`, acceptedList: [{ subjectStableId: `${TERMS}P000033`, standardName: 'CEDS', subjectIri: `${BASE}CEDS/14.0.0.0/ceds:P000033`, isAbstention: true, objectIri: '' }], goldCapture: { hubList: [] }, importRules });
harness.equal('the standard key', importedEntry.standardList[0].standardKey, 'ceds');
harness.equal('the source IRI is the URI before the local part', importedEntry.standardList[0].sourceIri, `${BASE}CEDS/14.0.0.0/ceds:`);

harness.section('the declaration is data, and a bad one is refused at load');
const withDeclarationList = (declarationList) => ({ ...URI_SCHEME, elementPathPrefixDeclaration: { ...URI_SCHEME.elementPathPrefixDeclaration, declarationList } });
const cedsRow = URI_SCHEME.elementPathPrefixDeclaration.declarationList[0];
harness.equal('the shipped scheme passes', schemeLoadRefusalFor(URI_SCHEME), '');
harness.match('TWIN: an absent declaration', schemeLoadRefusalFor({ ...URI_SCHEME, elementPathPrefixDeclaration: undefined }), /absent or malformed/);
harness.match('TWIN: one prefix for two standards', schemeLoadRefusalFor(withDeclarationList([cedsRow, { ...cedsRow, standardName: 'Other', stableIdExpansion: 'https://example.org/' }])), /repeats a curiePrefix/);
harness.match('TWIN: two prefixes for one standard', schemeLoadRefusalFor(withDeclarationList([cedsRow, { ...cedsRow, curiePrefix: 'other', stableIdExpansion: 'https://example.org/' }])), /repeats a standardName/);
harness.match('TWIN: an expansion that is no IRI', schemeLoadRefusalFor(withDeclarationList([{ ...cedsRow, stableIdExpansion: 'terms/' }])), /absolute stableIdExpansion/);
harness.match('TWIN: a prefix the encoding would alter', schemeLoadRefusalFor(withDeclarationList([{ ...cedsRow, curiePrefix: 'ce-ds' }])), /keeps literal/);
harness.match('TWIN: an element template with no owning standard', schemeLoadRefusalFor({ ...URI_SCHEME, kindList: URI_SCHEME.kindList.concat([{ kind: 'stray', template: 'stray/{elementStableId}', verbatimPartList: [] }]) }), /no owning standard/);
const codeLineList = fs.readFileSync(path.join(__dirname, '..', 'edcUri.js'), 'utf8').split('\n').filter((oneLine) => !/^\s*\/\//.test(oneLine));
harness.equal('edcUri.js names no standard in its code', codeLineList.filter((oneLine) => /CEDS|ceds:|CEDStandards/.test(oneLine)).length, 0);

harness.section('the resolver reads the row by the stableId; its answer carries the IRI');
const LAYER_MEMBER_HASH = 'b'.repeat(64);
const machineVersion = { contentIdBasis: 'sortedMemberBlockHashList', administrationRecord: { versionTag: 'base' }, memberBlockList: [{ decisionBlockHash: LAYER_MEMBER_HASH, pairKey: `ctdl@1::ceds@14.0.0.0::${HASH}::inferred` }] };
const registry = {
	layerFor: () => ({ layer: { layerKey: 'toyLayer', hubList: [{ hubName: 'CTDL' }] } }),
	versionFor: () => ({ version: machineVersion }),
	currentStandardVersionFor: () => ({ version: machineVersion }),
	effectiveStatusFor: () => ({ registrationStatus: 'Standard' }),
};
const subjectAskedList = [];
const reader = {
	elementRecordFor: ({ elementStableId }, done) => done('', elementStableId === `${TERMS}P000033` ? { schemaBlockRefId: HASH, node: { stableId: elementStableId, labels: ['CedsProperty'], properties: {} }, parentStableId: TERMS, siblingStableIdList: [`${TERMS}P000034`, 'http://www.w3.org/2002/07/owl#Class'], definitionText: 'a definition' } : null),
	publishedLayerVersionListForStandard: (standard, done) => done('', [{ layerKey: 'toyLayer', versionTag: 'base', registrationStatus: 'Standard' }]),
	decisionBlockFormFor: (decisionBlockHash, done) => done('', { blockForm: 'machine', subjectStandardName: 'CEDS', subjectStandardVersion: '14.0.0.0', edgeShapeFault: null, objectSourceVersionJson: null }),
	elementAssertionRowListFor: ({ subjectStableIdList }, done) => {
		subjectAskedList.push(...subjectStableIdList);
		done('', [{ rowOrdinal: 0, subjectStableId: subjectStableIdList[0], interpretationEntry: { assertionId: 'an assertion', predicate: 'skos:exactMatch', object: `${BASE}CTDL/hub/1/abc` } }]);
	},
};
const resolved = {};
const askResolver = (label, uriOrPath) => resolveEdcUri({ uriOrPath, registry, uriContractReader: reader }, (resolveError, oneAnswer) => { resolved[label] = resolveError ? { httpStatus: 0, body: { error: resolveError } } : oneAnswer; });
askResolver('element', '/EDUcore/CEDS/14.0.0.0/ceds:P000033');
harness.equal('the element answers 200', resolved.element.httpStatus, 200);
harness.equal('the answer carries the CEDS IRI as elementStableId', resolved.element.body.partByName.elementStableId, `${TERMS}P000033`);
harness.equal('…and on the node', resolved.element.body.node.stableId, `${TERMS}P000033`);
harness.equal('the answer names itself by the edc: URI', resolved.element.body.element, `${BASE}CEDS/14.0.0.0/ceds:P000033`);
harness.equal('the parent is the root, by its edc: URI', resolved.element.body.parent, `${BASE}CEDS/14.0.0.0/ceds:`);
harness.equal('a sibling is by its edc: URI, and no list entry is empty', JSON.stringify(resolved.element.body.siblingList), JSON.stringify([`${BASE}CEDS/14.0.0.0/ceds:P000034`]));
harness.equal('a sibling with no URI is named by its stableId', JSON.stringify(resolved.element.body.siblingWithoutUriStableIdList), JSON.stringify(['http://www.w3.org/2002/07/owl#Class']));
harness.equal('its interpretations are spelled the same way', resolved.element.body.interpretationList[0].floating, `${BASE}CEDS/14.0.0.0/ceds:P000033@toyLayer`);
askResolver('noRow', '/EDUcore/CEDS/14.0.0.0/ceds:P999999');
harness.equal('a ceds: URI naming no row answers 404', resolved.noRow.httpStatus, 404);
harness.match('…naming the stableId it looked for', resolved.noRow.body.error, /CEDS 14\.0\.0\.0 element https:\/\/w3id\.org\/CEDStandards\/terms\/P999999/);
askResolver('foreign', '/EDUcore/EdFi/5.2.0/ceds:P000033');
harness.equal('a ceds: URI under another standard answers 400', resolved.foreign.httpStatus, 400);
harness.match('…by name', resolved.foreign.body.error, /belongs to standard 'CEDS'/);

harness.section('the interpretation form, by the same rule as other standards');
askResolver('floating', '/EDUcore/CEDS/14.0.0.0/ceds:P000033@toyLayer');
harness.equal('a floating interpretation answers 200', resolved.floating.httpStatus, 200);
harness.equal("a machine member is chosen by the declared prefix, and its row asked for by the stableId", JSON.stringify(subjectAskedList), JSON.stringify([`${TERMS}P000033`]));
harness.equal('the answer holds the row', resolved.floating.body.assertionList.length, 1);
harness.equal('the answer names the element by its edc: URI', resolved.floating.body.element, `${BASE}CEDS/14.0.0.0/ceds:P000033`);

harness.report();
