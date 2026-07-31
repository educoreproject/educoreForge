#!/usr/bin/env node
'use strict';

// test-match-forensics.js — hermetic gate for lib/match-forensics/match-forensics.js
// (p9-judgmentPersistence scope amendment, 2026-07-31).
//
// PROVES:
//   SECTION 1 — open refusals (no/blank baseDirPath; a non-directory path).
//   SECTION 2 — appendRecord refusals (blank pairKey/generation; a path separator smuggled into
//     either; a non-object record).
//   SECTION 3 — the append-only JSONL shape: records land one-per-line under
//     <base>/<pairKey>/<generation>.jsonl, in append order, each line parsing back to the exact
//     record; a SECOND pair gets its OWN directory (the organize-by-standard layout); the per-pair
//     directory is prepared on demand.
//
// Run: node lib/match-forensics/test/test-match-forensics.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for lib/match-forensics (the append-only forensic match log)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the open/append refusals and the one-file-per-pair+generation JSONL layout with
     append-order line fidelity. Runs against a throwaway temp directory.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const matchForensicsModule = require('../match-forensics')();

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfMatchForensicsGate-'));
const baseDirPath = path.join(scratchDir, 'matchForensics'); // does NOT exist yet — prepared on demand

// =====================================================================
harness.section('SECTION 1 — open refusals');
// =====================================================================
matchForensicsModule.open({}, (err) => {
	harness.match('opening with no baseDirPath is REFUSED', err, /baseDirPath is REQUIRED/);
});
matchForensicsModule.open({ baseDirPath: '  ' }, (err) => {
	harness.match('opening with a blank baseDirPath is REFUSED', err, /baseDirPath is REQUIRED/);
});
(() => {
	const filePath = path.join(scratchDir, 'aPlainFile.txt');
	fs.writeFileSync(filePath, 'not a directory');
	matchForensicsModule.open({ baseDirPath: filePath }, (err) => {
		harness.match('opening onto an existing NON-directory is REFUSED', err, /is not a directory/);
	});
})();

// =====================================================================
// the real open + the append chain
// =====================================================================
matchForensicsModule.open({ baseDirPath }, (openErr, forensics) => {
	harness.accepts('a real open succeeds (base dir need not pre-exist — prepared on demand)', openErr ? [openErr] : []);
	if (openErr) {
		harness.report();
		return;
	}

	// =====================================================================
	harness.section('SECTION 2 — appendRecord refusals');
	// =====================================================================
	forensics.appendRecord({ generation: 'g-v1', record: {} }, (err) => {
		harness.match('RED: a missing pairKey is refused by name', err, /pairKey is required/);
	});
	forensics.appendRecord({ pairKey: 'CEDS::SIF', record: {} }, (err) => {
		harness.match('RED: a missing generation is refused by name', err, /generation is required/);
	});
	forensics.appendRecord({ pairKey: 'CEDS::SIF/evil', generation: 'g-v1', record: {} }, (err) => {
		harness.match('RED: a path separator smuggled into pairKey is refused by name', err, /contains a path separator/);
	});
	forensics.appendRecord({ pairKey: 'CEDS::SIF', generation: '../escape', record: {} }, (err) => {
		harness.match('RED: a path separator smuggled into generation is refused by name', err, /contains a path separator/);
	});
	forensics.appendRecord({ pairKey: 'CEDS::SIF', generation: 'g-v1', record: [1, 2] }, (err) => {
		harness.match('RED: a non-object record is refused by name', err, /must be a plain object/);
	});

	// =====================================================================
	harness.section('SECTION 3 — the append-only JSONL layout, organized by pair');
	// =====================================================================
	const recordOne = { timestamp: 't1', sourceStableId: 's1', judgedVia: 'live', response: { choice: '1' } };
	const recordTwo = { timestamp: 't2', sourceStableId: 's2', judgedVia: 'cache:abc', response: { choice: 'NONE' } };
	const recordOtherPair = { timestamp: 't3', sourceStableId: 'p1', judgedVia: 'live' };

	forensics.appendRecord({ pairKey: 'CEDS::SIF', generation: 'sifEvidenceBridge-evidence-v2', record: recordOne }, (e1, r1) => {
		harness.accepts('the first append succeeds (directory prepared on demand)', e1 ? [e1] : []);
		forensics.appendRecord({ pairKey: 'CEDS::SIF', generation: 'sifEvidenceBridge-evidence-v2', record: recordTwo }, (e2) => {
			harness.accepts('the second append succeeds', e2 ? [e2] : []);
			forensics.appendRecord({ pairKey: 'CEDS::LIF', generation: 'genericBridge-evidence-v1', record: recordOtherPair }, (e3) => {
				harness.accepts('an append for a DIFFERENT pair succeeds', e3 ? [e3] : []);

				const sifFilePath = path.join(baseDirPath, 'CEDS::SIF', 'sifEvidenceBridge-evidence-v2.jsonl');
				const lifFilePath = path.join(baseDirPath, 'CEDS::LIF', 'genericBridge-evidence-v1.jsonl');
				harness.equal('appendRecord reports the file it wrote', r1.filePath, sifFilePath);
				harness.ok('the pair-per-directory layout exists on disk (CEDS::SIF)', fs.existsSync(sifFilePath), sifFilePath);
				harness.ok('  and the second pair got its OWN directory (CEDS::LIF)', fs.existsSync(lifFilePath), lifFilePath);

				const sifLines = fs.readFileSync(sifFilePath, 'utf8').split('\n').filter(Boolean);
				harness.equal('the SIF trail carries exactly the two appended records, one per line', sifLines.length, 2);
				harness.equal('  line 1 parses back to the exact first record (append order preserved)', sifLines[0], JSON.stringify(recordOne));
				harness.equal('  line 2 parses back to the exact second record', sifLines[1], JSON.stringify(recordTwo));

				const lifLines = fs.readFileSync(lifFilePath, 'utf8').split('\n').filter(Boolean);
				harness.equal('the LIF trail carries exactly its one record', lifLines.length, 1);
				harness.equal('  and it is the exact record appended', lifLines[0], JSON.stringify(recordOtherPair));

				harness.report();
			});
		});
	});
});
