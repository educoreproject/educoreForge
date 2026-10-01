#!/usr/bin/env node
'use strict';

// test-release.js — the PESC release gate suite, pointed at pescdocumentrequest1v0v0. ALL PURE: no
// Docker, no network, no embedding. WRITTEN BY lib/pesc-release-forge/tools/scaffoldReleaseBundle.js.
// The gates and their twins live in lib/pesc-release-forge/gateSuite.js; this bundle's frozen counts
// in ../lib/releaseCensus.json; the work order's expected literals in
// lib/pesc-release-forge/expectedReleaseLiterals.json.
//
// Run: node forges/pescdocumentrequest1v0v0/test/test-release.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- the PESC release gates for PESC Document Request v1.0.0

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct PASSES and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const { runReleaseGateSuite } = require(path.join(__dirname, '..', '..', '..', 'lib', 'pesc-release-forge', 'gateSuite'));

runReleaseGateSuite({ harness, bundleDirPath: path.join(__dirname, '..') }, () => harness.report());
