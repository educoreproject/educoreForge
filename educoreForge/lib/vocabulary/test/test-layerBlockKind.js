#!/usr/bin/env node
'use strict';

// test-layerBlockKind.js — the fourth block kind, `layer` (lane DES, campaign cedsRichness-101226, 2026-10-12; COPPER_RIVER
// ruling Q1): its subject grammar, its kind gate, its header identity, its harvest rule, and the three layer roles. Pure;
// no Docker, no store. Each gate is shown refusing the fault it names.
//
// Run: node lib/vocabulary/test/test-layerBlockKind.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- the layer block kind: subject grammar, kind gate, header identity, harvest endpoint rule, roles
SYNOPSIS
     ${moduleName} [-verbose] [-help]
EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');
const harness = require('../../../test/testLib/harness')(moduleName);
const vocabulary = require('../vocabulary');
const KIND = vocabulary.SCHEMA_BLOCK_KIND;

harness.section('the taxonomy has four kinds, layer among them');
harness.equal('SCHEMA_BLOCK_KINDS', vocabulary.SCHEMA_BLOCK_KINDS.join(','), 'standardBase,hub,relationship,layer');

harness.section('compose and parse a layer subject');
const guideSubject = vocabulary.layerSubject({ standardKey: 'ceds', version: '14.0.0.0', layerKey: 'guide', layerVersion: '14' });
harness.equal('guide -> ceds@14_0_0_0_layer_guide@14', guideSubject.subject, 'ceds@14_0_0_0_layer_guide@14');
harness.equal('a lower-camel layer key composes', vocabulary.layerSubject({ standardKey: 'ceds', version: '14.0.0.0', layerKey: 'textRepair', layerVersion: '14.0.0.0' }).subject, 'ceds@14_0_0_0_layer_textRepair@14_0_0_0');
harness.equal('the subject parses back into its parts', JSON.stringify(vocabulary.parseBlockSubject(guideSubject.subject)), JSON.stringify({ kind: 'layer', standardKey: 'ceds', versionSlug: '14_0_0_0', layerKey: 'guide', layerVersionSlug: '14' }));
harness.match('a missing layerVersion is refused (no default)', vocabulary.layerSubject({ standardKey: 'ceds', version: '14.0.0.0', layerKey: 'guide' }).error, /layerVersion slugs to nothing/);
harness.match('a missing standard version is refused', vocabulary.layerSubject({ standardKey: 'ceds', layerKey: 'guide', layerVersion: '14' }).error, /version slugs to nothing/);
harness.match('an upper-case layer key is refused', vocabulary.layerSubject({ standardKey: 'ceds', version: '14', layerKey: 'Guide', layerVersion: '14' }).error, /not a lower-camel layer token/);

harness.section('the kind gate: a layer name agrees with layer and with nothing else');
harness.ok('a layer subject agrees with kind layer', vocabulary.subjectAgreesWithKind(guideSubject.subject, KIND.LAYER));
harness.ok('a layer subject does NOT agree with standardBase', !vocabulary.subjectAgreesWithKind(guideSubject.subject, KIND.STANDARD_BASE));
harness.ok('a layer subject does NOT agree with relationship', !vocabulary.subjectAgreesWithKind(guideSubject.subject, KIND.RELATIONSHIP));
harness.ok('a base subject does NOT agree with layer', !vocabulary.subjectAgreesWithKind('ceds@14_0_0_0_base', KIND.LAYER));
harness.ok("an '_layer_' infix with a malformed tail is refused", !vocabulary.subjectAgreesWithKind('ceds@14_0_0_0_layer_guide', KIND.LAYER));
harness.equal('kindImpliedBySubject names layer', vocabulary.kindImpliedBySubject(guideSubject.subject), KIND.LAYER);

harness.section('the header names its own subject');
harness.equal('a layer header composes its subject', vocabulary.subjectOfHeader({ serializerVersion: '2', blockType: 'layer', standardKey: 'ceds', version: '14.0.0.0', layerKey: 'guide', layerVersion: '14' }).subject, 'ceds@14_0_0_0_layer_guide@14');
harness.match('a layer header without its layerVersion is refused', vocabulary.subjectOfHeader({ serializerVersion: '2', blockType: 'layer', standardKey: 'ceds', version: '14.0.0.0', layerKey: 'guide' }).error, /must carry standardKey, version, layerKey, layerVersion; it lacks layerVersion/);

harness.section('the three layer roles: none is a data role');
harness.equal('LAYER_ROLE_LIST', vocabulary.LAYER_ROLE_LIST.join(','), 'DmeLayerRoot,DmeConcept,DmeTextRepair');
harness.ok('no layer role is DmeClass, DmeProperty, DmeOptionSet or DmeOptionValue', vocabulary.LAYER_ROLE_LIST.every((oneRole) => ['DmeClass', 'DmeProperty', 'DmeOptionSet', 'DmeOptionValue'].indexOf(oneRole) === -1));
harness.ok('every layer role and edge type has a definition (the schema view refuses one without)', vocabulary.LAYER_ROLE_LIST.every((oneRole) => typeof vocabulary.TERM_DEFINITIONS.dmeRole[oneRole] === 'string') && ['HAS_LAYER', 'HAS_PRIMARY_CONCEPT', 'HAS_SECONDARY_CONCEPT', 'HAS_EVENT_DATE_CONCEPT', 'DECLARES_CONCEPT', 'REPAIRS_TEXT_OF', 'DECLARES_REPAIR'].every((oneType) => typeof vocabulary.TERM_DEFINITIONS.edgeType[oneType] === 'string'));
harness.equal('the layer block label is StandardLayer', vocabulary.STANDARD_LAYER_LABEL, 'StandardLayer');

harness.section('the harvest endpoint rule refuses what it must (replay-engine, before any read)');
const replayEngine = require(path.join(__dirname, '..', '..', 'replay', 'replay-engine'))();
const harvestRefusalOf = (selector, done) => replayEngine.harvestBlock({ boltUri: 'bolt://localhost:1', password: 'unused', selector, header: {} }, (harvestError) => done(String(harvestError)));
harvestRefusalOf({ selectionLabels: ['StandardLayer'], edgeEndpointRule: 'eitherSelected' }, (noTypeRefusal) => {
	harness.match("an 'eitherSelected' harvest without named edge types is refused by name", noTypeRefusal, /'eitherSelected' requires an edgeTypeList/);
	harvestRefusalOf({ selectionLabels: ['StandardLayer'], edgeTypeList: ['HAS_LAYER'], edgeEndpointRule: 'anyEndpoint' }, (unknownRuleRefusal) => {
		harness.match('an unknown endpoint rule is refused by name', unknownRuleRefusal, /edgeEndpointRule "anyEndpoint" is not one of bothSelected, eitherSelected/);
		harness.report();
	});
});
