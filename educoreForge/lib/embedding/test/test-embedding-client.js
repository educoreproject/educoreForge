#!/usr/bin/env node
'use strict';

// test-embedding-client.js — a STANDING gate for the embedding client's CONFIGURATION reading.
//
// NOTHING HERE TOUCHES THE NETWORK. Every assertion runs against the module's config resolver,
// which is reached before any provider is constructed and long before any socket would open. The
// ini fixtures below carry a fake key and are written to the OS temp dir, never into the project.
//
// WHY THIS SUITE EXISTS (Phase 4, work group 1, 2026-07-23):
// The model actually SENT to Voyage came from the ini, while the model STAMPED onto every node
// came from an in-code constant. Embeddings feed content addressing, so a stamp that disagrees
// with the model that produced the vectors makes every block id wrong and silently so. This suite
// is what keeps the two from ever diverging again.
//
// Run: node lib/embedding/test/test-embedding-client.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- standing gate for the embedding client's configuration reading

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves that [voyageEmbedding].model and .embeddingDims are REQUIRED and VALIDATED, that a
     configured value is honoured verbatim, and that no in-code model or dimension constant
     survives to stand in for either. No network: only the config resolver is exercised.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const embeddingClient = require('../embedding-client');

// -----
// iniWith — write a throwaway [voyageEmbedding] ini into the OS temp dir and return its path.
//   The key is fake and never leaves this process; nothing here can reach the Voyage API.

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'educoreForge-embeddingTest-'));
let iniSerial = 0;

const iniWith = (lines) => {
	iniSerial += 1;
	const filePath = path.join(tempDir, `voyageEmbedding-${iniSerial}.ini`);
	fs.writeFileSync(filePath, ['[voyageEmbedding]', 'apiKey=NOT-A-REAL-KEY'].concat(lines).join('\n') + '\n');
	return filePath;
};

// -----
// thrownMessage — run fn and return the thrown message as a LIST, so harness.rejects can insist
//   on the specific reason. try/catch is localized to this one boundary, never used for control
//   flow in the code under test.

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
// identityOrError — the value a resolver returns, or {error} carrying why it refused. Lets a
//   POSITIVE control report "expected X, got undefined" instead of taking the suite down, so
//   every assertion in a red run is observed rather than only the first.

const identityOrError = (fn) => {
	let answer;
	try {
		answer = fn();
	} catch (error) {
		answer = { error: error.message };
	}
	return answer;
};

// -----
// codeOf — a file's source with whole-line comments stripped, so a scan for a surviving in-code
//   constant is not fooled by prose in the header (and is not defeated by it either).

const codeOf = (filePath) =>
	fs
		.readFileSync(filePath, 'utf8')
		.split('\n')
		.filter((oneLine) => !/^\s*(\/\/|\*|\/\*)/.test(oneLine))
		.join('\n');

// =====================================================================
harness.section('MODEL — required, validated, and the ONE value both sent and stamped');
// =====================================================================

harness.rejects(
	'an ABSENT model is refused, naming the key, the section and the file',
	thrownMessage(() => embeddingClient({ configFilePath: iniWith(['embeddingDims=1024']) }).resolveEmbeddingIdentity()),
	/\[voyageEmbedding\]\.model.*voyageEmbedding-\d+\.ini/s,
);

harness.rejects(
	'an INVALID (blank) model is refused, naming what was given',
	thrownMessage(() =>
		embeddingClient({ configFilePath: iniWith(['model=   ', 'embeddingDims=1024']) }).resolveEmbeddingIdentity(),
	),
	/\[voyageEmbedding\]\.model/,
);

harness.equal(
	'a CONFIGURED model is honoured verbatim — the positive control',
	identityOrError(() =>
		embeddingClient({
			configFilePath: iniWith(['model=voyage-context-3', 'embeddingDims=1024']),
		}).resolveEmbeddingIdentity(),
	).model,
	'voyage-context-3',
);

harness.ok(
	'no in-code stamped model constant survives on the module surface',
	embeddingClient({ configFilePath: iniWith(['model=voyage-context-3', 'embeddingDims=1024']) })
		.stampedModelVersion === undefined,
	typeof embeddingClient({ configFilePath: iniWith(['model=voyage-context-3', 'embeddingDims=1024']) })
		.stampedModelVersion,
);

harness.ok(
	'no model-version literal survives anywhere in embedding-client.js',
	!/voyage-[0-9]/.test(codeOf(path.join(__dirname, '..', 'embedding-client.js'))),
	(codeOf(path.join(__dirname, '..', 'embedding-client.js')).match(/.*voyage-[0-9].*/g) || []).join('\n'),
);

// =====================================================================
harness.section('EMBEDDING DIMS — required, validated, and never quietly corrected');
// =====================================================================

harness.rejects(
	'an ABSENT embeddingDims is refused, naming the key, the section and the file',
	thrownMessage(() =>
		embeddingClient({ configFilePath: iniWith(['model=voyage-4-large']) }).resolveEmbeddingIdentity(),
	),
	/\[voyageEmbedding\]\.embeddingDims.*voyageEmbedding-\d+\.ini/s,
);

harness.rejects(
	'a MISTYPED embeddingDims=102o is refused, naming what was given (never truncated to 102)',
	thrownMessage(() =>
		embeddingClient({
			configFilePath: iniWith(['model=voyage-4-large', 'embeddingDims=102o']),
		}).resolveEmbeddingIdentity(),
	),
	/\[voyageEmbedding\]\.embeddingDims.*'102o'/s,
);

harness.rejects(
	'an OUT-OF-RANGE embeddingDims=0 is refused rather than replaced',
	thrownMessage(() =>
		embeddingClient({
			configFilePath: iniWith(['model=voyage-4-large', 'embeddingDims=0']),
		}).resolveEmbeddingIdentity(),
	),
	/\[voyageEmbedding\]\.embeddingDims.*'0'/s,
);

harness.equal(
	'a CONFIGURED embeddingDims is honoured verbatim as a number — the positive control',
	identityOrError(() =>
		embeddingClient({
			configFilePath: iniWith(['model=voyage-context-3', 'embeddingDims=512']),
		}).resolveEmbeddingIdentity(),
	).embeddingDims,
	512,
);

harness.ok(
	'no dimension literal survives anywhere in embedding-client.js',
	!/\b(1024|512)\b/.test(codeOf(path.join(__dirname, '..', 'embedding-client.js'))),
	(codeOf(path.join(__dirname, '..', 'embedding-client.js')).match(/.*\b(1024|512)\b.*/g) || []).join('\n'),
);

harness.report();
