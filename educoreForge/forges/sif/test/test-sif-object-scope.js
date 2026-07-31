#!/usr/bin/env node
'use strict';

// test-sif-object-scope.js — the trial-scope seam (TQ ruling 2026-07-31: judge ONLY the
// StudentPersonal object as a trial, extensible to the rest without re-spending). Proves the pure
// scope filter: passthrough when absent, owner-exact filtering when present, refuse-by-name on a
// malformed scope and on a scope matching zero fields (the CASE-RULE lesson: an empty run is never
// silence). Hermetic — pure function, no graph, no LLM.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- the SIF trial-scope filter: passthrough, filter, and refusals

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const { applySifObjectScope } = require('../bridges/sifEvidenceBridge');

const fields = [
	{ stableId: 'f1', xpath: '/StudentPersonals/StudentPersonal/Name/FirstName' },
	{ stableId: 'f2', xpath: '/StudentPersonals/StudentPersonal/@RefId' },
	{ stableId: 'f3', xpath: '/SchoolInfos/SchoolInfo/SchoolName' },
	{ stableId: 'f4', xpath: '/AccountingPeriods/AccountingPeriod/SIF_Metadata/LifeCycle/Created/DateTime' },
];

harness.section('passthrough — no scope configured judges everything');
(() => {
	const out = applySifObjectScope(fields, {});
	harness.ok('no error', !out.error, out.error);
	harness.equal('all 4 fields pass through', out.sourceNodes.length, 4);
	harness.ok('no scopedFrom marker on passthrough', out.scopedFrom === undefined);
})();

harness.section('filter — owner-exact (xpath second segment), the StudentPersonal trial shape');
(() => {
	const out = applySifObjectScope(fields, { sifObjectScope: ['StudentPersonal'] });
	harness.ok('no error', !out.error, out.error);
	harness.equal('exactly the 2 StudentPersonal fields survive', out.sourceNodes.length, 2);
	harness.equal('scopedFrom records the pre-filter count', out.scopedFrom, 4);
	harness.ok('the survivors are the right ones', out.sourceNodes.every((n) => n.xpath.split('/')[2] === 'StudentPersonal'));
})();

harness.section('RED — refusals by name');
(() => {
	const empty = applySifObjectScope(fields, { sifObjectScope: [] });
	harness.match('RED: an empty scope array is refused', empty.error, /non-empty array/);
	const junk = applySifObjectScope(fields, { sifObjectScope: ['StudentPersonal', ''] });
	harness.match('RED: a blank member is refused', junk.error, /non-empty array of non-empty/);
	const notArray = applySifObjectScope(fields, { sifObjectScope: 'StudentPersonal' });
	harness.match('RED: a bare string is refused (must be an array)', notArray.error, /non-empty array/);
	const zero = applySifObjectScope(fields, { sifObjectScope: ['NoSuchObject'] });
	harness.match('RED: a scope matching ZERO fields is refused, never judged as silence', zero.error, /matched ZERO fields/);
})();

harness.report();
