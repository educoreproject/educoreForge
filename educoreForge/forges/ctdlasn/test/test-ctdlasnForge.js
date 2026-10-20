#!/usr/bin/env node
'use strict';

// test-ctdlasnForge.js — the CTDLASN forge bundle (ctdlHub-101926 P2), Docker-free. The expectation table below is the July
// oracle's counts for snapshot 01 (dataStores/ctdlHub_101926/oracle) plus this port's ruled departures; the assertions live
// once in lib/ctdl-family-forge/test/realSnapshotSuite.js. The loader's refusals are proven in forges/ctdl/test and
// lib/ctdl-family-forge/test (the loader is shared); the ORACLE gate is apps/graph-builder/tools/oracleDiff.js on a DEV build.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the CTDLASN forge bundle: real-snapshot counts, round trip and its twins (no Docker)

SYNOPSIS
     node forges/ctdlasn/test/${moduleName}.js [-verbose] [-help]

DESCRIPTION
     Forges forges/ctdlasn/assets/standardSourceData/01 in process (no embedding), asserts the expectation table, runs the
     bundle's round-trip validator over the harness graph double, and observes it RED on two perturbations. Writes only
     under os.tmpdir().

EXIT STATUS
     0 every assertion passed;  1 otherwise.
`;

const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const harness = require(path.join(TREE_ROOT, 'test', 'testLib', 'harness'))(moduleName);
const { runRealSnapshotSuite } = require(path.join(TREE_ROOT, 'lib', 'ctdl-family-forge', 'test', 'realSnapshotSuite'));

// ⟪P2b⟫ the rows the suite expects the profile to carry, written FIRST at each row's commit (red-first)
const INTENDED_ENRICHMENT_LIST = Object.freeze(['E2', 'E3', 'E4', 'E7', 'E8', 'E9']);
const ENRICHMENT_EFFECT_BY_ROW = Object.freeze({
 "E2": {
  "edgeType": "TOP_CONCEPT_OF",
  "edgeDelta": 8,
  "omittedDelta": {
   "nativeReferenceNotModelled": 16
  },
  "exampleEdgeList": [
   [
    "evalCat:Authority",
    "ceasn:EvaluatorCategory"
   ],
   [
    "evalCat:Automated",
    "ceasn:EvaluatorCategory"
   ],
   [
    "evalCat:External",
    "ceasn:EvaluatorCategory"
   ]
  ]
 },
 "E3": {
  "edgeType": "SUBPROPERTY_OF",
  "edgeDelta": 10,
  "omittedDelta": {
   "nativeReferenceNotModelled": 10
  },
  "exampleEdgeList": [
   [
    "ceasn:competencyLabel",
    "ceasn:name"
   ],
   [
    "ceasn:inProgressionModel",
    "skos:inScheme"
   ],
   [
    "ceasn:isTopChildOf",
    "ceasn:isChildOf"
   ]
  ]
 },
 "E4": {
  "edgeType": "INVERSE_OF",
  "edgeDelta": 2,
  "omittedDelta": {
   "nativeReferenceNotModelled": 2
  },
  "exampleEdgeList": [
   [
    "ceasn:hasChild",
    "ceasn:isChildOf"
   ],
   [
    "ceasn:isChildOf",
    "ceasn:hasChild"
   ]
  ]
 },
 "E7": {
  "carriedPropertyName": "rdfsComment",
  "carriedCount": 25,
  "omittedDelta": {
   "secondaryDescription": 25
  },
  "exampleIdList": [
   "ceasn:Competency",
   "ceasn:CompetencyFramework",
   "ceasn:ProficiencyScale"
  ]
 },
 "E8": {
  "carriedPropertyName": "skosDefinition",
  "carriedCount": 3,
  "omittedDelta": {
   "secondaryDescription": 3
  },
  "exampleIdList": [
   "evalCat:Authority",
   "evalCat:External",
   "evalCat:Peer"
  ]
 },
 "E9": {
  "carriedPropertyName": "status",
  "carriedRole": "DmeOptionSet",
  "carriedCount": 2,
  "omittedDelta": {
   "schemeStatus": 2
  },
  "exampleIdList": [
   "ceasn:EvaluatorCategory",
   "ceasn:PublicationStatus"
  ]
 },
 "E10": {
  "carriedPropertyName": "changeHistoryUrl",
  "carriedCount": 118,
  "omittedDelta": {
   "changeHistory": 118
  },
  "exampleIdList": [
   "asn:ProgressionLevel",
   "asn:ProgressionModel",
   "ceasn:Competency"
  ]
 },
 "E11": {
  "crossRefDelta": 35,
  "omittedDelta": {
   "unresolvedNativePrefixReference": 35
  }
 },
 "E12": {
  "carriedPropertyName": "usageNote",
  "carriedRole": "nonProperty",
  "carriedCount": 1,
  "omittedDelta": {
   "usageNoteOffProperty": 1
  },
  "exampleIdList": [
   "publicationStatus:Draft"
  ]
 }
});

const EXPECTED = Object.freeze({
 "intendedEnrichmentList": INTENDED_ENRICHMENT_LIST,
 "enrichmentEffectByRow": ENRICHMENT_EFFECT_BY_ROW,
 "standardSource": "CTDLASN",
 "rootStableId": "ctdlasn:root",
 "nodeCountByRole": {
  "DmeStandardRoot": 1,
  "DmeClass": 11,
  "DmeProperty": 97,
  "DmeOptionSet": 2,
  "DmeOptionValue": 8
 },
 "edgeCount": 280,
 "rootEdgeCountByType": {
  "HAS_CLASS": 11
 },
 "statByName": {
  "crossRefTotal": 349,
  "declaredCorrespondenceTotal": 0,
  "duplicateEdgeSuppressedCount": 0,
  "unresolvedNativePrefixReferenceCount": 35
 },
 "foreignTermEntryCount": 4,
 "rootVersionText": "20230929|20230929|provenance-file",
 "standardFamily": "CTDLASN",
 "explicitlyOmittedByKind": {
  "changeHistory": 118,
  "unresolvedNativePrefixReference": 35,
  "secondaryDescription": 28,
  "nativeReferenceNotModelled": 28,
  "schemeStatus": 2,
  "usageNoteOffProperty": 1
 },
 "twinEdgeType": "HAS_PROPERTY"
});

runRealSnapshotSuite({
	harness,
	bundle: require(path.join(__dirname, '..', 'forgeCtdlasn'))({ embedder: null }),
	validator: require(path.join(__dirname, '..', 'roundTripValidator')),
	snapshotDirPath: path.join(__dirname, '..', 'assets', 'standardSourceData', '01'),
	vocabularyProfile: require(path.join(__dirname, '..', 'lib', 'ctdlasnVocabularyProfile.json')),
	sourceFileName: 'ctdlasn.json',
	expected: EXPECTED,
});
