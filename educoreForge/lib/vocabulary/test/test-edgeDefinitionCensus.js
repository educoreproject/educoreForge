#!/usr/bin/env node
'use strict';

// test-edgeDefinitionCensus.js — gate for W-C-3 (V1-C30, V1-S32; campaign P2): the four structural edge types several
// forges share (SUBCLASS_OF, HAS_INSTANCE, HAS_CHILD, HAS_OPTION_SET) declare their endpoint kinds as DATA
// (vocabulary EDGE_ENDPOINT_KIND_PAIR_LIST_BY_TYPE), every endpoint pair the gold graph holds is declared, and the prose
// definition the schema view projects names every declared kind.
//
// PROVES:
//   (a) every (type, fromKind -> toKind) pair of the frozen gold census is in the declared list
//   (b) every declared kind is named in that type's TERM_DEFINITIONS.edgeType text (letters only, case-insensitive)
// RED TWINS: the census run against the list with PESC's 'Occurrence->Occurrence' HAS_CHILD row removed -> (a) red; the
// definitions read with 'PESC writes it too' sentence removed (a vocabulary-definitions double) -> (b) red.
//
// Run: node lib/vocabulary/test/test-edgeDefinitionCensus.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: structural edge definitions name every endpoint kind the graph holds
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const vocabulary = require('../vocabulary');
const { loadBuildJsDouble } = require('../../bridge-framework/test/testSupport/bridgeTwinFactories');
const censusFixture = require('./fixtures/edgeEndpointKindPairs-goldEval261005.json');

const lettersOf = (text) => `${text}`.toLowerCase().replace(/[^a-z]/g, '');
const undeclaredPairListOf = (declaredByType) =>
	Object.keys(censusFixture.endpointKindPairListByType).reduce((soFar, oneType) => soFar.concat(censusFixture.endpointKindPairListByType[oneType].filter((onePair) => (declaredByType[oneType] || []).indexOf(onePair) === -1).map((onePair) => `${oneType} ${onePair}`)), []);
const unnamedKindListOf = (definitionByType) =>
	Object.keys(vocabulary.EDGE_ENDPOINT_KIND_PAIR_LIST_BY_TYPE).reduce((soFar, oneType) => {
		const kindList = Array.from(new Set(vocabulary.EDGE_ENDPOINT_KIND_PAIR_LIST_BY_TYPE[oneType].reduce((kinds, onePair) => kinds.concat(onePair.split('->')), [])));
		return soFar.concat(kindList.filter((oneKind) => lettersOf(definitionByType[oneType]).indexOf(lettersOf(oneKind)) === -1).map((oneKind) => `${oneType}: ${oneKind}`));
	}, []);

harness.section('(a) every live endpoint pair is declared');
const undeclaredList = undeclaredPairListOf(vocabulary.EDGE_ENDPOINT_KIND_PAIR_LIST_BY_TYPE);
harness.ok('the frozen gold census holds no undeclared (type, from -> to) pair', undeclaredList.length === 0, undeclaredList.join(', '));
const twinDeclared = { ...vocabulary.EDGE_ENDPOINT_KIND_PAIR_LIST_BY_TYPE, HAS_CHILD: vocabulary.EDGE_ENDPOINT_KIND_PAIR_LIST_BY_TYPE.HAS_CHILD.filter((onePair) => onePair !== 'Occurrence->Occurrence') };
const twinUndeclaredList = undeclaredPairListOf(twinDeclared);
harness.ok("(a) observed RED with PESC's HAS_CHILD Occurrence->Occurrence row removed", twinUndeclaredList.indexOf('HAS_CHILD Occurrence->Occurrence') !== -1, twinUndeclaredList.join(', '));
harness.note(`RED-OBSERVED a twin='pescHasChildRowRemoved' → undeclared [${twinUndeclaredList.join(', ')}]`);

harness.section('(b) every declared kind is named in its definition');
const unnamedList = unnamedKindListOf(vocabulary.TERM_DEFINITIONS.edgeType);
harness.ok('every declared endpoint kind appears in its type\'s definition text', unnamedList.length === 0, unnamedList.join(', '));
const definitionsDouble = loadBuildJsDouble({ buildJsPath: path.join(__dirname, '..', 'vocabulary-definitions.js'), mutationList: [{ find: 'PESC writes it too: Occurrence to Occurrence, and GlobalElement to Occurrence. ', replace: '' }] });
const twinUnnamedList = unnamedKindListOf((definitionsDouble.TERM_DEFINITIONS || definitionsDouble).edgeType);
harness.ok("(b) observed RED with HAS_CHILD's PESC sentence removed", twinUnnamedList.some((oneText) => /^HAS_CHILD: (GlobalElement|Occurrence)$/.test(oneText)), twinUnnamedList.join(', '));
harness.note(`RED-OBSERVED b twin='hasChildPescSentenceRemoved' → unnamed [${twinUnnamedList.join(', ')}]`);

harness.report();
