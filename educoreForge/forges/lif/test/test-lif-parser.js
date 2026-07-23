#!/usr/bin/env node
'use strict';

// test-lif-parser.js — a STANDING gate for what the LIF parser STAMPS about its source.
//
// NOTHING HERE TOUCHES THE NETWORK, DOCKER, VOYAGE OR A DATABASE. parseLif reads one JSON file
// and answers; the fixtures are tiny OpenAPI documents written into the OS temp dir, never into
// the project, and the real 723 KB LIF snapshot is never opened.
//
// WHY THIS SUITE EXISTS (Phase 4, work group 5, 2026-07-23):
// `schemaTitle: info.title || 'Learner Information Framework'` invented a plausible standard name
// for a source document that declared none, and that invented name flows into standardName and
// into node descriptions (forgeLif.js:239/249/255, which carried the same constant three more
// times). Read it beside the line immediately above it — `version: info.version || 'unknown'`,
// with a whole versionSource machinery built to keep that gap honest — and the contrast is the
// finding: the version takes the honest route and the title takes the dishonest one, in adjacent
// lines of the same object literal.
//
// Run: node forges/lif/test/test-lif-parser.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- standing gate for the LIF parser's source-provenance stamps

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves that a source document declaring no info.title is REFUSED rather than given an
     invented name, that a declared title is carried verbatim, and that the honest 'unknown'
     version stamp is untouched by any of it. Tiny in-memory fixtures; the real snapshot is
     never read.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseLif } = require('../lib/parser');

// -----
// specFixture — write a minimal OpenAPI document into the OS temp dir and return its path.

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'educoreForge-lifParser-'));
let fixtureSerial = 0;

const specFixture = (info) => {
	fixtureSerial += 1;
	const filePath = path.join(tempDir, `lifSpec-${fixtureSerial}.json`);
	fs.writeFileSync(
		filePath,
		JSON.stringify({
			openapi: '3.0.0',
			...(info === undefined ? {} : { info }),
			components: {
				schemas: {
					Person: { type: 'object', properties: { name: { type: 'string' } } },
				},
			},
		}),
	);
	return filePath;
};

// -----
// parseOutcome — parseLif answers synchronously through its callback on every path exercised
//   here, so the answer can be collected and asserted on. Errors are returned as a LIST so
//   harness.rejects can insist on the SPECIFIC reason.

const parseOutcome = (sourcePath) => {
	const answer = { errors: [], metadata: {} };
	parseLif({ sourcePath }, (err, result) => {
		if (err) {
			answer.errors.push(err);
			return;
		}
		answer.metadata = result.metadata;
	});
	return answer;
};

// =====================================================================
harness.section('SCHEMA TITLE — the source names itself, or the parse says so');
// =====================================================================

harness.rejects(
	'a source with NO info.title is REFUSED — no plausible name is invented for it',
	parseOutcome(specFixture({ version: '1.2.3' })).errors,
	/info\.title/,
);

harness.rejects(
	'a source with a BLANK info.title is refused too',
	parseOutcome(specFixture({ title: '   ', version: '1.2.3' })).errors,
	/info\.title/,
);

harness.rejects(
	'a source with no info block at all is refused',
	parseOutcome(specFixture(undefined)).errors,
	/info/,
);

harness.equal(
	'a DECLARED title is carried verbatim — the positive control',
	parseOutcome(specFixture({ title: 'Learner Information Framework', version: '1.2.3' })).metadata
		.schemaTitle,
	'Learner Information Framework',
);

harness.equal(
	'  and a DIFFERENT declared title is carried too, so the constant is truly gone',
	parseOutcome(specFixture({ title: 'Some Other Data Model', version: '1.2.3' })).metadata
		.schemaTitle,
	'Some Other Data Model',
);

// =====================================================================
harness.section('VERSION — the honest gap stamp is untouched by any of this');
// =====================================================================
// The version's conduct was already correct and is the pattern the title now follows. It is
// asserted here so a later change cannot quietly bring the two back out of step.

const titledNoVersion = parseOutcome(specFixture({ title: 'Learner Information Framework' }));
harness.equal(
	"a source with no info.version still stamps 'unknown' HONESTLY, not a made-up number",
	titledNoVersion.metadata.version,
	'unknown',
);
harness.equal(
	'  and stamps no versionSource, because there is no source to name',
	titledNoVersion.metadata.versionSource,
	undefined,
);

const titledAndVersioned = parseOutcome(
	specFixture({ title: 'Learner Information Framework', version: '1.2.3' }),
);
harness.equal(
	'a declared version is carried verbatim',
	titledAndVersioned.metadata.version,
	'1.2.3',
);
harness.equal("  and named as coming from the spec", titledAndVersioned.metadata.versionSource, 'spec');

// -----
// and no invented name survives anywhere in the bundle.

const sourceOf = (filePath) =>
	fs
		.readFileSync(filePath, 'utf8')
		.split('\n')
		.filter((oneLine) => !/^\s*(\/\/|\*|\/\*)/.test(oneLine))
		.join('\n');

['lib/parser.js', 'forgeLif.js'].forEach((oneFile) => {
	const filePath = path.join(__dirname, '..', oneFile);
	harness.ok(
		`no invented standard name survives in ${oneFile}`,
		!/\|\|\s*'Learner Information Framework'/.test(sourceOf(filePath)),
		(sourceOf(filePath).match(/.*\|\|\s*'Learner Information Framework'.*/g) || []).join('\n'),
	);
});

harness.report();
