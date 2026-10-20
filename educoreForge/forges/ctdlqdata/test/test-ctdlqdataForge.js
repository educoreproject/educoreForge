#!/usr/bin/env node
'use strict';

// test-ctdlqdataForge.js — the CTDLQData forge bundle (ctdlHub-101926 P2), Docker-free. The expectation table below is the July
// oracle's counts for snapshot 01 (dataStores/ctdlHub_101926/oracle) plus this port's ruled departures; the assertions live
// once in lib/ctdl-family-forge/testSupport/realSnapshotSuite.js. The loader's refusals are proven in forges/ctdl/test and
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
const { runRealSnapshotSuite } = require(path.join(TREE_ROOT, 'lib', 'ctdl-family-forge', 'testSupport', 'realSnapshotSuite'));

const EXPECTED = Object.freeze({
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
	sourceFileName: 'qdata.json',
	expected: EXPECTED,
});
