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

const EXPECTED = Object.freeze({
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
	sourceFileName: 'ctdlasn.json',
	expected: EXPECTED,
});
