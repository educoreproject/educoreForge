#!/usr/bin/env node
'use strict';

// test-ctdlqdataForge.js — the CTDLQData forge bundle (ctdlHub-101926 P2), Docker-free. The expectation table below is the July
// oracle's counts for snapshot 01 (dataStores/ctdlHub_101926/oracle) plus this port's ruled departures; the assertions live
// once in lib/ctdl-family-forge/test/realSnapshotSuite.js. The loader's refusals are proven in forges/ctdl/test and
// lib/ctdl-family-forge/test (the loader is shared); the ORACLE gate is apps/graph-builder/tools/oracleDiff.js on a DEV build.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the CTDLQData forge bundle: real-snapshot counts, round trip and its twins (no Docker)

SYNOPSIS
     node forges/ctdlqdata/test/${moduleName}.js [-verbose] [-help]

DESCRIPTION
     Forges forges/ctdlqdata/assets/standardSourceData/01 in process (no embedding), asserts the expectation table, runs the
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
const INTENDED_ENRICHMENT_LIST = Object.freeze(['E1', 'E2', 'E3', 'E7', 'E9', 'E12', 'E13', 'E11', 'E14']);
const ENRICHMENT_EFFECT_BY_ROW = Object.freeze({
 "E1": {
  "edgeType": "BROADER_CONCEPT",
  "edgeDelta": 52,
  "omittedDelta": {
   "nativeReferenceNotModelled": 104
  },
  "exampleEdgeList": [
   [
    "metricCat:Acceptance",
    "metricCat:ParticipationEngagement"
   ],
   [
    "metricCat:Access",
    "metricCat:ParticipationEngagement"
   ],
   [
    "metricCat:BenefitsReceived",
    "metricCat:Organization"
   ]
  ]
 },
 "E2": {
  "edgeType": "TOP_CONCEPT_OF",
  "edgeDelta": 61,
  "omittedDelta": {
   "nativeReferenceNotModelled": 122
  },
  "exampleEdgeList": [
   [
    "adminRecord:Tax1099",
    "qdata:AdministrativeRecordCategory"
   ],
   [
    "adminRecord:TaxW2",
    "qdata:AdministrativeRecordCategory"
   ],
   [
    "adminRecord:UnemploymentInsurance",
    "qdata:AdministrativeRecordCategory"
   ]
  ]
 },
 "E3": {
  "edgeType": "SUBPROPERTY_OF",
  "edgeDelta": 2,
  "omittedDelta": {
   "nativeReferenceNotModelled": 2
  },
  "exampleEdgeList": [
   [
    "qdata:regionalEarningsDistribution",
    "qdata:earningsDistribution"
   ],
   [
    "qdata:regionalEmploymentRate",
    "qdata:employmentRate"
   ]
  ]
 },
 "E7": {
  "carriedPropertyName": "rdfsComment",
  "carriedCount": 8,
  "omittedDelta": {
   "secondaryDescription": 8
  },
  "exampleIdList": [
   "qdata:Observation",
   "qdata:adjustment",
   "qdata:dimensionType"
  ]
 },
 "E9": {
  "carriedPropertyName": "status",
  "carriedRole": "DmeOptionSet",
  "carriedCount": 8,
  "omittedDelta": {
   "schemeStatus": 8
  },
  "exampleIdList": [
   "qdata:AdministrativeRecordCategory",
   "qdata:CollectionMethod",
   "qdata:DataSourceCoverage"
  ]
 },
 "E11": {
  "crossRefDelta": 13,
  "omittedDelta": {
   "unresolvedNativePrefixReference": 13
  }
 },
 "E12": {
  "carriedPropertyName": "usageNote",
  "carriedRole": "nonProperty",
  "carriedCount": 5,
  "omittedDelta": {
   "usageNoteOffProperty": 5
  },
  "exampleIdList": [
   "schema:QuantitativeValue",
   "metricCat:PostCompletion",
   "metricCat:PostEnrollment"
  ]
 },
 "E13": {
  "edgeType": "RELATED_CONCEPT",
  "edgeDelta": 10,
  "omittedDelta": {
   "nativeReferenceNotModelled": 10
  },
  "exampleEdgeList": [
   [
    "demoCat:EducationLevel",
    "metricCat:EducationLevel"
   ],
   [
    "demoCat:Employment",
    "metricCat:Employment"
   ],
   [
    "demoCat:Income",
    "metricCat:Earnings"
   ]
  ]
 },
 "E14": {
  "carriedPropertyName": "rangeDatatypeList",
  "carriedRole": "DmeProperty",
  "carriedCount": 24,
  "carriedEntryCount": 24,
  "omittedDelta": {},
  "exampleIdList": [
   "qdata:adjustment",
   "qdata:dataSuppressionPolicy",
   "qdata:earningsDefinition"
  ],
  "exampleValueById": {
   "qdata:adjustment": ["rdf:langString"]
  }
 }
});

const EXPECTED = Object.freeze({
 "intendedEnrichmentList": INTENDED_ENRICHMENT_LIST,
 "enrichmentEffectByRow": ENRICHMENT_EFFECT_BY_ROW,
 "standardSource": "CTDLQData",
 "rootStableId": "ctdlqdata:root",
 "nodeCountByRole": {
  "DmeStandardRoot": 1,
  "DmeClass": 11,
  "DmeProperty": 82,
  "DmeOptionSet": 8,
  "DmeOptionValue": 113
 },
 "edgeCount": 277,
 "rootEdgeCountByType": {
  "HAS_CLASS": 11,
  "HAS_OPTION_SET": 8,
  "HAS_PROPERTY": 5
 },
 "statByName": {
  "crossRefTotal": 178,
  "declaredCorrespondenceTotal": 0,
  "duplicateEdgeSuppressedCount": 0,
  "unresolvedNativePrefixReferenceCount": 13
 },
 "foreignTermEntryCount": 31,
 "rootVersionText": "20260130|20260130|provenance-file",
 "standardFamily": "CTDLQData",
 "explicitlyOmittedByKind": {
  "secondaryDescription": 8,
  "usageNoteOffProperty": 5,
  "unresolvedNativePrefixReference": 13,
  "nativeReferenceNotModelled": 238,
  "schemeStatus": 8
 },
 "twinEdgeType": "HAS_VALUE"
});

runRealSnapshotSuite({
	harness,
	bundle: require(path.join(__dirname, '..', 'forgeCtdlqdata'))({ embedder: null }),
	validator: require(path.join(__dirname, '..', 'roundTripValidator')),
	snapshotDirPath: path.join(__dirname, '..', 'assets', 'standardSourceData', '01'),
	vocabularyProfile: require(path.join(__dirname, '..', 'lib', 'ctdlqdataVocabularyProfile.json')),
	sourceFileName: 'qdata.json',
	expected: EXPECTED,
});
