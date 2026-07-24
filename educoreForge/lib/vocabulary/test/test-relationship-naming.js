#!/usr/bin/env node
'use strict';

// test-relationship-naming.js — the gate for the RELATIONSHIP producer-suffix vocabulary (P2 Phase C,
// implementationPlan_bridge_072426 §7). A relationship block is per-(pair × producer):
//   '<hub>@<hubVer>_rel_<source>@<sourceVer>_exact'  (authored, deterministic)
//   '<hub>@<hubVer>_rel_<source>@<sourceVer>_close'  (inferred, frozen)
// version-keyed on BOTH endpoints (REAL resolved versions), producer-suffixed. This locks the composer,
// the producer read-back, and the tightened kind gate (a bare '..._rel_...' with NO producer suffix is
// REFUSED). Pure; no docker/db.
//
// Run: node lib/vocabulary/test/test-relationship-naming.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gate for the relationship producer-suffix vocabulary + tightened kind gate
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
DESCRIPTION
     Locks relationshipSubjectRefId composition, relationshipProducerFromSubjectRefId read-back, and the
     RELATIONSHIP kind gate (pair infix AND a known producer suffix required). Pure.
EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);
const vocabulary = require('../vocabulary');
const KIND = vocabulary.SCHEMA_BLOCK_KIND;

// =====================================================================
harness.section('COMPOSE — version-keyed on both endpoints, producer-suffixed');
// =====================================================================
const authored = vocabulary.relationshipSubjectRefId({ hubStandard: 'ceds', hubVersion: '5', sourceStandard: 'ctdl', sourceVersion: '3', producer: 'authored' });
harness.equal('authored -> ceds@5_rel_ctdl@3_exact', authored.subjectRefId, 'ceds@5_rel_ctdl@3_exact');
const inferred = vocabulary.relationshipSubjectRefId({ hubStandard: 'ceds', hubVersion: '5', sourceStandard: 'lif', sourceVersion: '1', producer: 'inferred' });
harness.equal('inferred -> ceds@5_rel_lif@1_close', inferred.subjectRefId, 'ceds@5_rel_lif@1_close');

harness.ok('a missing hubVersion is an ERROR (no default — version-keyed on both endpoints)', !!vocabulary.relationshipSubjectRefId({ hubStandard: 'ceds', sourceStandard: 'ctdl', sourceVersion: '3', producer: 'authored' }).error);
harness.ok('a missing sourceStandard is an ERROR', !!vocabulary.relationshipSubjectRefId({ hubStandard: 'ceds', hubVersion: '5', sourceVersion: '3', producer: 'authored' }).error);
harness.ok('an unknown producer is an ERROR, not a silent default', !!vocabulary.relationshipSubjectRefId({ hubStandard: 'ceds', hubVersion: '5', sourceStandard: 'ctdl', sourceVersion: '3', producer: 'guessed' }).error);

// =====================================================================
harness.section('READ-BACK — which producer a subjectRefId names');
// =====================================================================
harness.equal('..._exact -> authored', vocabulary.relationshipProducerFromSubjectRefId('ceds@5_rel_ctdl@3_exact'), 'authored');
harness.equal('..._close -> inferred', vocabulary.relationshipProducerFromSubjectRefId('ceds@5_rel_lif@1_close'), 'inferred');
harness.equal('a bare _rel_ name names NO producer', vocabulary.relationshipProducerFromSubjectRefId('ceds@5_rel_ctdl@3'), undefined);

// =====================================================================
harness.section('GATE — RELATIONSHIP requires the pair infix AND a known producer suffix');
// =====================================================================
harness.ok('an _exact name AGREES with relationship', vocabulary.subjectRefIdAgreesWithKind('ceds@5_rel_ctdl@3_exact', KIND.RELATIONSHIP));
harness.ok('a _close name AGREES with relationship', vocabulary.subjectRefIdAgreesWithKind('ceds@5_rel_lif@1_close', KIND.RELATIONSHIP));
harness.ok('a bare _rel_ name (no producer suffix) is REFUSED', !vocabulary.subjectRefIdAgreesWithKind('ceds@5_rel_ctdl@3', KIND.RELATIONSHIP));
harness.ok('a name with a producer suffix but NO _rel_ infix is REFUSED', !vocabulary.subjectRefIdAgreesWithKind('ceds@5_ctdl@3_exact', KIND.RELATIONSHIP));
harness.ok('the _base gate is unchanged (standardBase still agrees)', vocabulary.subjectRefIdAgreesWithKind('lif@current_base', KIND.STANDARD_BASE));
harness.ok('an _exact relationship name does NOT masquerade as standardBase', !vocabulary.subjectRefIdAgreesWithKind('ceds@5_rel_ctdl@3_exact', KIND.STANDARD_BASE));

harness.report();
