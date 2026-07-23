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

// =====================================================================
harness.section('THE PROVIDER — a documented default, and an unknown one refused AT CONSTRUCTION');
// =====================================================================
// `providerName = 'voyage'` is a DEFAULT PARAMETER on the module boundary, and the audit put it
// in bucket 1 for one reason: the default was not stated in the module's header interface block,
// where the configFilePath default IS stated. An undocumented default is indistinguishable from
// the defect (polyArch2 §6).
//
// DISPOSITION: documented optional, not required. §6 permits a default for a legitimately
// optional input "and it must be documented in -help or the module's stated interface" — this
// module's stated interface is its header block, which now names it. Voyage is the only provider
// on disk, the registry is a discovery pattern, and making every caller type the same literal
// would add a word without adding a fact.
//
// What was a REAL defect underneath it: an UNKNOWN provider constructed cleanly, answered
// resolveEmbeddingIdentity() as though all was well, and was only refused at embedText time —
// deep inside a callback, after the credentials file had already been opened.

const GOOD_INI = () => iniWith(['model=voyage-context-3', 'embeddingDims=1024']);

harness.rejects(
	'an UNKNOWN providerName is refused AT CONSTRUCTION, naming it and what IS available',
	thrownMessage(() => embeddingClient({ configFilePath: GOOD_INI(), providerName: 'nosuchprovider' })),
	/nosuchprovider[\s\S]*voyage/,
);

harness.rejects(
	'a BLANK providerName is refused too — a blank name is not a name',
	thrownMessage(() => embeddingClient({ configFilePath: GOOD_INI(), providerName: '  ' })),
	/providerName/,
);

harness.rejects(
	'a non-string providerName is refused, naming what was given',
	thrownMessage(() => embeddingClient({ configFilePath: GOOD_INI(), providerName: 7 })),
	/providerName/,
);

harness.equal(
	'an OMITTED providerName takes the DOCUMENTED default — the positive control',
	identityOrError(() => embeddingClient({ configFilePath: GOOD_INI() }).providerName()),
	'voyage',
);

harness.equal(
	'  and naming it explicitly reaches the same provider',
	identityOrError(() =>
		embeddingClient({ configFilePath: GOOD_INI(), providerName: 'voyage' }).providerName(),
	),
	'voyage',
);

harness.match(
	"the module's STATED INTERFACE names providerName and its default — an undocumented default is the defect",
	fs.readFileSync(path.join(__dirname, '..', 'embedding-client.js'), 'utf8'),
	/providerName\?[\s\S]*default[\s\S]*voyage/,
);

// =====================================================================
harness.section('ONE CHANNEL FOR ONE FAULT — a missing key THROWS, like the model and the dims');
// =====================================================================
// Three keys live in one section of one file, read in one pass: apiKey, model, embeddingDims. A
// missing model or a mistyped embeddingDims THREW (work group 1). A missing apiKey answered a
// callback error string. Same file, same section, same moment, same class of fault — two
// channels, and a caller had to handle both anyway, because the throw already escaped embedText.
//
// DECIDED: throw, uniformly, on the same reasoning work group 2 applied to replayManager's
// resolveSettings.
//   1. The reading happens in a SYNCHRONOUS resolver, before any provider is touched and long
//      before a socket exists. There is nothing in flight for a callback to unwind.
//   2. resolveEmbeddingIdentity() is PUBLIC and has no callback at all. It must throw. Routing
//      the apiKey to a callback keeps two channels for the one act of reading the ini.
//   3. Routing the throw INTO the callback would need a try/catch around a synchronous call —
//      try/catch as control flow, which the house style forbids.
//   4. A tree whose embedding credentials are unconfigured has nothing sensible to do next.
// Operational faults — empty text, a provider that answered badly — still travel by callback.
// That is the line: CONFIGURATION throws, OPERATION calls back.

const keyless = (extraLines) => {
	iniSerial += 1;
	const filePath = path.join(tempDir, `voyageNoKey-${iniSerial}.ini`);
	fs.writeFileSync(filePath, ['[voyageEmbedding]'].concat(extraLines).join('\n') + '\n');
	return filePath;
};

harness.rejects(
	'a MISSING apiKey THROWS, naming the key, the section and the file',
	thrownMessage(() =>
		embeddingClient({
			configFilePath: keyless(['model=voyage-context-3', 'embeddingDims=1024']),
		}).embedText({ text: 'anything' }, () => {}),
	),
	/\[voyageEmbedding\]\.apiKey[\s\S]*voyageNoKey-\d+\.ini/,
);

harness.rejects(
	'a BLANK apiKey throws too — a blank credential is not a credential',
	thrownMessage(() =>
		embeddingClient({
			configFilePath: keyless(['apiKey=', 'model=voyage-context-3', 'embeddingDims=1024']),
		}).embedText({ text: 'anything' }, () => {}),
	),
	/\[voyageEmbedding\]\.apiKey/,
);

harness.rejects(
	'embedTexts uses the SAME reading and the SAME channel',
	thrownMessage(() =>
		embeddingClient({
			configFilePath: keyless(['model=voyage-context-3', 'embeddingDims=1024']),
		}).embedTexts({ texts: ['anything'] }, () => {}),
	),
	/\[voyageEmbedding\]\.apiKey/,
);

harness.rejects(
	'a MISSING section entirely throws about the section, not about a key inside it',
	thrownMessage(() => {
		iniSerial += 1;
		const filePath = path.join(tempDir, `voyageNoSection-${iniSerial}.ini`);
		fs.writeFileSync(filePath, '[somethingElse]\nunrelated=1\n');
		embeddingClient({ configFilePath: filePath }).embedText({ text: 'anything' }, () => {});
	}),
	/\[voyageEmbedding\]/,
);

harness.ok(
	'no configError callback channel survives in embedding-client.js',
	!/configError/.test(codeOf(path.join(__dirname, '..', 'embedding-client.js'))),
	(codeOf(path.join(__dirname, '..', 'embedding-client.js')).match(/.*configError.*/g) || []).join('\n'),
);

// -----
// THE LINE HOLDS IN THE OTHER DIRECTION TOO: an OPERATIONAL fault still travels by callback.
// Without this, "throw everything" would satisfy every assertion above.

const operationalErrors = [];
embeddingClient({
	configFilePath: iniWith(['model=voyage-context-3', 'embeddingDims=1024']),
}).embedText({ text: '   ' }, (err) => operationalErrors.push(err));

harness.match(
	'an EMPTY text is still an operational fault and still travels by CALLBACK — the positive control',
	operationalErrors.join('\n'),
	/text is required/,
);

const operationalListErrors = [];
embeddingClient({
	configFilePath: iniWith(['model=voyage-context-3', 'embeddingDims=1024']),
}).embedTexts({ texts: [] }, (err) => operationalListErrors.push(err));

harness.match(
	'  and so does an empty texts array',
	operationalListErrors.join('\n'),
	/non-empty array/,
);

// =====================================================================
harness.section('ENCODE VECTOR — a non-vector is refused, never coerced to an empty or NaN one');
// =====================================================================
// `Float32Array.from(float32 || [])` silently turned null/undefined into an EMPTY vector and — the
// worse case — a stray STRING into a NaN-filled one that base64-encodes to a real-looking payload.
// encodeVector is a public codec on the module surface; a caller that hands it the wrong thing
// should hear so, not get a plausible-looking blob (polyArch2 §6). The audit filed this B2 (an
// internal utility whose callers pass real vectors); the work-group brief named it, and a codec
// that fabricates a payload from a typo is worth closing. NOTE flagged in the report, not
// reclassified on my own authority.

const client = () => embeddingClient({ configFilePath: iniWith(['model=voyage-context-3', 'embeddingDims=1024']) });

harness.rejects(
	'encodeVector(null) is REFUSED, not silently encoded as an empty vector',
	thrownMessage(() => client().encodeVector(null)),
	/encodeVector[\s\S]*vector/i,
);
harness.rejects(
	'encodeVector(undefined) is refused',
	thrownMessage(() => client().encodeVector(undefined)),
	/encodeVector/,
);
harness.rejects(
	"encodeVector('not a vector') is REFUSED — never coerced to a NaN-filled payload",
	thrownMessage(() => client().encodeVector('not a vector')),
	/encodeVector/,
);
harness.rejects(
	'encodeVector({}) is refused',
	thrownMessage(() => client().encodeVector({})),
	/encodeVector/,
);
harness.rejects(
	'encodeVector of a list carrying a NaN is refused — a vector of not-numbers is not a vector',
	thrownMessage(() => client().encodeVector(Float32Array.from([0.5, NaN]))),
	/encodeVector[\s\S]*(NaN|finite|number)/i,
);

harness.equal(
	'a Float32Array round-trips through encode/decode byte-exact — the positive control',
	(() => {
		const c = client();
		const original = Float32Array.from([0.5, 0.25, -0.125]);
		const back = c.decodeVector(c.encodeVector(original));
		return Array.from(back).join(',');
	})(),
	'0.5,0.25,-0.125',
);
harness.equal(
	'a plain number array is accepted and round-trips too — the second positive control',
	(() => {
		const c = client();
		return Array.from(c.decodeVector(c.encodeVector([1, 0.5]))).join(',');
	})(),
	'1,0.5',
);
harness.equal(
	'an EMPTY vector is a legitimate value and encodes to the empty string, not a refusal',
	client().encodeVector(Float32Array.from([])),
	'',
);

harness.report();
