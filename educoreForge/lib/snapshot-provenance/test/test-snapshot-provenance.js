#!/usr/bin/env node
'use strict';

// test-snapshot-provenance.js — a STANDING gate for version-provenance stamping (BINDING spec
// §3.2/§3.3).
//
// NOTHING HERE TOUCHES THE NETWORK, DOCKER OR A DATABASE. deriveVersionStamp is pure and
// synchronous; the fixtures are snapshot directories written into the OS temp dir, never into
// the project.
//
// WHY THIS SUITE EXISTS (Phase 4, work group 5, 2026-07-23):
// `warn = () => {}` sat in the parameter list. The §3.2/§3.3 warnings are MANDATED by the binding
// spec — a version DISAGREEMENT between the source and the provenance file, and a publishedVersion
// nobody supplies — and a caller that forgot to pass `warn` discarded every one of them into a
// function that does nothing. Both callers on disk pass xLog.error, so nothing was being lost
// today; the default existed purely to let a future caller lose it silently. The module also had
// no suite at all, so this file is what turns lib/snapshot-provenance from NONE into PASS.
//
// Run: node lib/snapshot-provenance/test/test-snapshot-provenance.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- standing gate for version-provenance stamping

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the §3.3 precedence (spec > provenance-file > unknown), that the §3.2/§3.3 warnings
     are actually DELIVERED, and that the warn channel is REQUIRED — a caller that does not
     supply it is refused rather than quietly deprived of every warning the spec mandates.
     Pure and synchronous: no network, no docker, no database.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const { deriveVersionStamp } = require('../snapshot-provenance');

// -----
// snapshotFixture — write <tmp>/assets/standardSourceData/<key>/<file> and, when a version is
//   given, a standardSourceLocation provenance file beside it. Returns the source file's path.

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'educoreForge-provenance-'));
let fixtureSerial = 0;

const snapshotFixture = ({ snapshotKey, provenanceVersion }) => {
	fixtureSerial += 1;
	const snapshotDir = path.join(
		tempRoot,
		`fixture-${fixtureSerial}`,
		'assets',
		'standardSourceData',
		snapshotKey,
	);
	fs.mkdirSync(snapshotDir, { recursive: true });
	const sourcePath = path.join(snapshotDir, 'theSource.json');
	fs.writeFileSync(sourcePath, '{}\n');
	if (provenanceVersion !== undefined) {
		fs.writeFileSync(
			path.join(snapshotDir, 'standardSourceLocation'),
			`sourceUrl: https://example.invalid/spec\npublishedVersion: ${provenanceVersion}\n`,
		);
	}
	return sourcePath;
};

// -----
// thrownMessage — the thrown message as a LIST, so harness.rejects can insist on the SPECIFIC
//   reason. try/catch is localized to this one test boundary, never control flow in the code
//   under test.

const thrownMessage = (fn) => {
	let messages = [];
	try {
		fn();
	} catch (error) {
		messages = [error.message];
	}
	return messages;
};

// -----
// stampOrError — what a derivation returned, or {error} carrying why it refused, so a POSITIVE
//   control reports "expected X, got undefined" instead of taking the suite down.

const stampOrError = (fn) => {
	let answer;
	try {
		answer = fn();
	} catch (error) {
		answer = { error: error.message };
	}
	return answer;
};

// =====================================================================
harness.section('THE WARN CHANNEL — mandated warnings are delivered, or the call is refused');
// =====================================================================

const noProvenance = snapshotFixture({ snapshotKey: '01' });

harness.rejects(
	'a call with NO warn is refused — the spec-mandated warnings are not optional',
	thrownMessage(() => deriveVersionStamp({ sourcePath: noProvenance, sourceVersion: null })),
	/warn/,
);

harness.rejects(
	'a warn that is not a FUNCTION is refused, naming what was given',
	thrownMessage(() =>
		deriveVersionStamp({ sourcePath: noProvenance, sourceVersion: null, warn: 'xLog.error' }),
	),
	/warn[\s\S]*string/,
);

harness.rejects(
	'a warn of null is refused too — a caller who wants no warnings must say what it wants',
	thrownMessage(() =>
		deriveVersionStamp({ sourcePath: noProvenance, sourceVersion: null, warn: null }),
	),
	/warn/,
);

const deliveredWarnings = [];
const unknownStamp = stampOrError(() =>
	deriveVersionStamp({
		sourcePath: noProvenance,
		sourceVersion: null,
		warn: (message) => deliveredWarnings.push(message),
	}),
);

harness.equal(
	'a supplied warn is honoured — the positive control: the §3.2 warning ARRIVES',
	deliveredWarnings.length,
	1,
);
harness.match(
	'  and it says the publishedVersion is unavailable, naming the honest stamp',
	deliveredWarnings.join('\n'),
	/no publishedVersion available[\s\S]*unknown/,
);
harness.equal(
	'  while the stamp itself is the honest gap marker, never a fabricated version',
	unknownStamp.publishedVersion,
	'unknown',
);
harness.equal('  and versionSource says so', unknownStamp.versionSource, 'unknown');

// =====================================================================
harness.section('§3.3 PRECEDENCE — spec > provenance-file > unknown, disagreements WARNED');
// =====================================================================

const provenanceOnly = snapshotFixture({ snapshotKey: '02', provenanceVersion: '2.1.0' });
const fromFile = stampOrError(() =>
	deriveVersionStamp({ sourcePath: provenanceOnly, sourceVersion: null, warn: () => {} }),
);
harness.equal('a non-self-describing source takes the provenance file', fromFile.publishedVersion, '2.1.0');
harness.equal('  and says where it came from', fromFile.versionSource, 'provenance-file');
harness.equal('  and derives snapshotKey from the directory name', fromFile.snapshotKey, '02');

const disagreeing = snapshotFixture({ snapshotKey: '03', provenanceVersion: '2.1.0' });
const disagreementWarnings = [];
const fromSpec = stampOrError(() =>
	deriveVersionStamp({
		sourcePath: disagreeing,
		sourceVersion: '3.0.0',
		warn: (message) => disagreementWarnings.push(message),
	}),
);
harness.equal('a self-describing source WINS over the provenance file', fromSpec.publishedVersion, '3.0.0');
harness.equal('  and says so', fromSpec.versionSource, 'spec');
harness.match(
	'  and the DISAGREEMENT is warned with BOTH values named — never silently resolved',
	disagreementWarnings.join('\n'),
	/3\.0\.0[\s\S]*2\.1\.0|2\.1\.0[\s\S]*3\.0\.0/,
);

harness.ok(
	'no `warn = () => {}` escape hatch survives in snapshot-provenance.js',
	!/warn\s*=\s*\(\)\s*=>/.test(
		fs
			.readFileSync(path.join(__dirname, '..', 'snapshot-provenance.js'), 'utf8')
			.split('\n')
			.filter((oneLine) => !/^\s*(\/\/|\*|\/\*)/.test(oneLine))
			.join('\n'),
	),
	(fs.readFileSync(path.join(__dirname, '..', 'snapshot-provenance.js'), 'utf8').match(
		/.*warn\s*=\s*\(\)\s*=>.*/g,
	) || []).join('\n'),
);

harness.report();
