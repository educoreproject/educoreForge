#!/usr/bin/env node
'use strict';

// test-forger.js — FAST gates for the forger module: that its destination guard MOVED intact to
// in every direction — a guard never observed refusing is unproven), bundle resolution against
// the real forges/ tree, and the pure standard-block serializer. NOTHING here touches Docker,
// Neo4j, or Voyage; the full produce-and-write path is proven by the deliberate integration
// script (integration-forge-lif.js), which spends real resources and is not auto-discovered.
//
// Run: node apps/graph-builder/apps/forger/test/test-forger.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- fast gates for the forger module (guard, resolution, serializer)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the DEV_*-only line moved intact to replayManager (GOLD_*,
     gf_*, non-DEV names, malformed handles) and admits DEV_* handles; that bundle resolution
     finds the real LIF bundle and rejects unknown standards naming the known roster; and that
     the pure standard-block serializer emits the proven PG-JSONL shape. No Docker, no Neo4j,
     no Voyage — the live path belongs to integration-forge-lif.js.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const forgerModule = require('../forger');
const { resolveBundle } = forgerModule;
const { buildStandardBlock } = require('../lib/standard-block')();
const { shapeForgedGraph } = require('../lib/shape-forged-graph')();

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
harness.section('THE GUARD MOVED — the forger has no destination left to refuse');
// =====================================================================
// The forger used to carry its own DEV_*-only destination refusal. Work order Phase 5 took its
// destination away entirely: it produces nodeEdges and writes nothing, so there is nothing here
// to guard. A removed guard must be PROVEN to have moved rather than assumed to have — the
// migration is checked at the site of the removal, not asserted in a comment.

harness.ok(
	'the forger no longer exports a destination guard (it has no destination)',
	forgerModule.destinationRefusal === undefined,
	typeof forgerModule.destinationRefusal,
);

const replayManagerModule = require('../../replay-manager/replayManager');
harness.match(
	'the DEV_*-only line is now held by replayManager: GOLD_* refused',
	replayManagerModule.nameRefusal('GOLD_260718', 'init'),
	/REFUSED.*production\/live/,
);
harness.match(
	'  gf_* refused',
	replayManagerModule.nameRefusal('gf_devGolden', 'init'),
	/REFUSED/,
);
harness.match(
	'  and a non-DEV name refused',
	replayManagerModule.nameRefusal('myScratch', 'init'),
	/not a DEV_\* scratch graph/,
);
harness.equal(
	'  while a proper DEV_* name is ADMITTED (a guard that refuses everything is not a guard)',
	replayManagerModule.nameRefusal('DEV_gb_test_1', 'init'),
	'',
);

// A destination handed to forge() is now IGNORED, not honored: there is no code path from the
// forger to a graph at all. Passing one cannot cause a write, which is the property that matters.
const forge = forgerModule().forge;
harness.ok(
	'forge() takes no destination — the forger module never requires the replay engine',
	require('fs')
		.readFileSync(require('path').join(__dirname, '..', 'forger.js'), 'utf8')
		.indexOf('replay-engine') === -1,
);

// =====================================================================
harness.section('BUNDLE RESOLUTION — the real forges/ tree');
// =====================================================================

const lif = resolveBundle({ standard: 'lif' });
harness.equal('lif resolves without error', lif.error || '', '');
harness.equal('  with the descriptor standardName', lif.standardName, 'LIF');
harness.match('  entry path points at forgeLif.js', lif.entryPath, /forges[\/\\]lif[\/\\]forgeLif\.js$/);
harness.ok(
	'  the default source file exists on disk',
	require('fs').existsSync(lif.defaultSource),
	lif.defaultSource,
);
harness.equal('token case is normalized (LIF -> forges/lif)', (resolveBundle({ standard: 'LIF' }).error || ''), '');

const unknown = resolveBundle({ standard: 'noSuchStandard' });
harness.match('an unknown standard errors', unknown.error, /no forge bundle for standard 'noSuchStandard'/);
harness.match('  and names the known roster so the caller can self-correct', unknown.error, /Known forges: .*lif/);

// =====================================================================
harness.section('BUNDLE REGISTRATION — a bundle that registers nothing is refused BY NAME');
// =====================================================================
// forger.js:104 reads `(getConfig(descriptorPath) || {}).parserDescriptor || {}`. A forge bundle
// IS its own registration — the central standard-registry was deleted and the [parserDescriptor]
// section is what replaced it — so an ABSENT section is a bundle that is not registered at all.
// The `|| {}` lets it walk on as though it were, and it dies two lines later blaming a MISSING
// KEY. That refusal is a disguise: it tells the operator to add `entryModule=` to a file where
// he has very likely already written it, under a section header he forgot or mistyped.
//
// CODE FACT, probed against this tree's copy of qtools-config-file-processor rather than assumed:
// SECTIONLESS KEYS ARE DISCARDED. `entryModule=forgeThing.js` written with no [parserDescriptor]
// header does not appear in the parsed config at all — the bundle's own descriptor comment says
// so in its first four lines. So the mistyped-header case is not hypothetical; it is the single
// most likely way to author a descriptor wrongly, and it is the case the `|| {}` hides.
//
// The fixture bundles are temp directories created and removed inside the real forges/ tree,
// because resolveBundle computes its own bundle path from FORGES_DIR and offers no seam. They are
// removed by the helper on every path, and named so a leftover is unmistakable.

// -----
// withTempBundle — write forges/<name>/parserDescriptor.ini, resolve against it, remove it.
//   Returns whatever resolveBundle answered. The directory never outlives the call.

const FORGES_DIR_FOR_TEST = path.join(__dirname, '..', '..', '..', '..', '..', 'forges');
const FORGER_PATH_EARLY = path.join(__dirname, '..', 'forger.js');

const withTempBundle = (bundleName, descriptorText) => {
	const bundleDir = path.join(FORGES_DIR_FOR_TEST, bundleName);
	fs.rmSync(bundleDir, { recursive: true, force: true });
	fs.mkdirSync(bundleDir, { recursive: true });
	fs.writeFileSync(path.join(bundleDir, 'parserDescriptor.ini'), descriptorText);
	let answer;
	try {
		answer = resolveBundle({ standard: bundleName });
	} finally {
		fs.rmSync(bundleDir, { recursive: true, force: true });
	}
	return answer;
};

const NO_SECTION_BUNDLE = 'zztestonlynosection';
const EMPTY_SECTION_BUNDLE = 'zztestonlyemptysection';
const GOOD_BUNDLE = 'zztestonlygoodsection';

// -----
// bundleErrors — the refusal as a LIST, so harness.rejects can insist on the SPECIFIC reason.
const bundleErrors = (answer) => (answer && answer.error ? [answer.error] : []);

const noSection = withTempBundle(
	NO_SECTION_BUNDLE,
	'# the operator wrote the keys but forgot the section header\nentryModule=forgeThing.js\nstandardName=ZZ\n',
);
harness.rejects(
	'an ABSENT [parserDescriptor] section is refused, naming the BUNDLE and the FILE it looked for',
	bundleErrors(noSection),
	new RegExp(`'${NO_SECTION_BUNDLE}'[\\s\\S]*parserDescriptor\\.ini`),
);
harness.match(
	'  and it names the SECTION HEADER, which is what is actually absent — no longer a disguise',
	noSection.error,
	/\[parserDescriptor\] section/,
);
harness.match(
	'  and says WHY a right-looking file can still be empty: sectionless keys are DISCARDED',
	noSection.error,
	/sectionless keys/i,
);
harness.ok(
	'  and it does NOT blame a missing entryModule — the key the operator already wrote',
	!/has no entryModule/.test(String(noSection.error)),
	noSection.error,
);

const emptySection = withTempBundle(
	EMPTY_SECTION_BUNDLE,
	'[parserDescriptor]\n# a registration that registers nothing\n',
);
harness.rejects(
	'an EMPTY [parserDescriptor] section is refused as an INVALID registration, naming the bundle',
	bundleErrors(emptySection),
	new RegExp(`'${EMPTY_SECTION_BUNDLE}'[\\s\\S]*registers nothing`, 'i'),
);
harness.ok(
	'  and it is a DIFFERENT sentence from the absent-section one — two faults, two messages',
	String(emptySection.error).replace(new RegExp(EMPTY_SECTION_BUNDLE, 'g'), '<b>') !==
		String(noSection.error).replace(new RegExp(NO_SECTION_BUNDLE, 'g'), '<b>'),
	`${noSection.error}\n${emptySection.error}`,
);

const missingEntryModule = withTempBundle(
	EMPTY_SECTION_BUNDLE,
	'[parserDescriptor]\nstandardName=ZZ\n',
);
harness.rejects(
	'a registration missing entryModule is still refused — and now names the bundle too',
	bundleErrors(missingEntryModule),
	new RegExp(`'${EMPTY_SECTION_BUNDLE}'[\\s\\S]*entryModule`),
);

const goodSection = withTempBundle(
	GOOD_BUNDLE,
	'[parserDescriptor]\nstandardName=ZZ\nentryModule=forgeZz.js\n',
);
harness.equal(
	'a bundle that DOES register itself resolves without error — the positive control',
	goodSection.error || '',
	'',
);
harness.equal('  and carries its declared standardName', goodSection.standardName, 'ZZ');
harness.match('  and its declared entryModule', goodSection.entryPath, /forgeZz\.js$/);
harness.equal(
	'  while the REAL lif bundle still resolves — the second positive control',
	resolveBundle({ standard: 'lif' }).error || '',
	'',
);

// -----
// THE DECLARED NAME. `standardName: descriptor.standardName || standard` silently substituted the
// lowercase DIRECTORY TOKEN for the name the descriptor was supposed to declare: delete
// `standardName=LIF` and every report, every block header naming path and every node description
// says 'lif'. Undocumented anywhere, and resolveBundle already refuses a missing entryModule for
// the identical class of fault — the descriptor is the bundle's whole registration (audit B1,
// forger.js:135).

const NO_NAME_BUNDLE = 'zztestonlynostandardname';
const BLANK_NAME_BUNDLE = 'zztestonlyblankstandardname';

harness.rejects(
	'a descriptor that declares NO standardName is refused, naming the bundle and the file',
	bundleErrors(
		withTempBundle(NO_NAME_BUNDLE, '[parserDescriptor]\nentryModule=forgeZz.js\n'),
	),
	/standardName[\s\S]*parserDescriptor\.ini/,
);

harness.rejects(
	'a BLANK standardName is refused too — a blank name is not a name',
	bundleErrors(
		withTempBundle(
			BLANK_NAME_BUNDLE,
			'[parserDescriptor]\nstandardName=   \nentryModule=forgeZz.js\n',
		),
	),
	/standardName/,
);

harness.equal(
	'the REAL lif bundle still answers its DECLARED name, not its directory token',
	resolveBundle({ standard: 'lif' }).standardName,
	'LIF',
);
harness.equal(
	'  and the real ceds bundle likewise — the positive controls',
	resolveBundle({ standard: 'ceds' }).standardName,
	'CEDS',
);

harness.ok(
	'no `standardName || standard` fallthrough survives in forger.js',
	!/standardName:\s*descriptor\.standardName\s*\|\|/.test(codeOf(FORGER_PATH_EARLY)),
	(codeOf(FORGER_PATH_EARLY).match(/.*standardName.*\|\|.*/g) || []).join('\n'),
);

harness.ok(
	'no `parserDescriptor || {}` survives in forger.js',
	!/parserDescriptor\s*\|\|\s*\{\}/.test(codeOf(path.join(__dirname, '..', 'forger.js'))),
	(codeOf(path.join(__dirname, '..', 'forger.js')).match(/.*parserDescriptor.*\|\|.*/g) || []).join(
		'\n',
	),
);

// =====================================================================
harness.section('STANDARD-BLOCK SERIALIZER — the pure transport (incumbent-faithful shape)');
// =====================================================================

const syntheticForged = {
	standardKey: 'lif',
	stableUriPropertyName: 'lifPath',
	metadata: { version: '2.0' },
	nodes: [
		{
			stableId: 'lif:root',
			labels: ['ForgedNode', 'LifRoot', 'DmeStandardRoot'],
			properties: {
				_id: 'lif:root',
				_source: 'LIF',
				name: 'LIF',
				searchText: 'LIF | root',
				tags: ['a', 'b'], // already-array property must NOT be double-wrapped
				embedding: [0.25, -0.5, 1.0],
				embeddingModelVersion: 'voyage-4-large',
			},
		},
		{
			stableId: 'lif:plain',
			labels: ['ForgedNode', 'LifEntity', 'DmeClass'],
			properties: { _id: 'lif:plain', _source: 'LIF', name: 'plain', searchText: 'plain' },
		},
	],
	edges: [
		{
			type: 'HAS_CLASS',
			fromRef: { source: 'LIF', id: 'lif:root' },
			toRef: { source: 'LIF', id: 'lif:plain' },
			properties: { provenanceTier: 'structural' },
		},
	],
};

// The declared width is the width of the vectors this fixture actually carries (3), not the 1024
// the module used to stamp on every header regardless. That old assertion certified the shadow
// constant: a three-element vector produced a header claiming a thousand-and-twenty-four.
const block = buildStandardBlock({ forged: syntheticForged, declaredEmbeddingDims: 3 });
harness.equal('node count reported', block.nodeCount, 2);
harness.equal('edge count reported', block.edgeCount, 1);

const lines = block.blockText.trim().split('\n').map((oneLine) => JSON.parse(oneLine));
const header = lines[0];
harness.equal('header blockType', header.blockType, 'standardBase');
harness.equal('header standardKey', header.standardKey, 'lif');
harness.equal('header resolutionKey IS the stableUriPropertyName', header.resolutionKey, 'lifPath');
harness.equal('header embeddingDims is the width GIVEN, not an in-code constant', header.embeddingDims, 3);

const embeddedNode = lines.find((oneLine) => oneLine.stableId === 'lif:root');
harness.ok('embedded node carries base64 embedding scalar', typeof embeddedNode.embedding === 'string', JSON.stringify(embeddedNode.embedding));
harness.ok(
	'  and the embedding is NOT in properties (the scalar exception)',
	embeddedNode.properties.embedding === undefined,
);
harness.ok(
	'scalar properties are array-wrapped (PG-JSON multi-valued)',
	Array.isArray(embeddedNode.properties.name) && embeddedNode.properties.name[0] === 'LIF',
	JSON.stringify(embeddedNode.properties.name),
);
harness.equal(
	'already-array properties are not double-wrapped',
	JSON.stringify(embeddedNode.properties.tags),
	JSON.stringify(['a', 'b']),
);

const plainNode = lines.find((oneLine) => oneLine.stableId === 'lif:plain');
harness.ok('a node without embedding gets NO embedding field', plainNode.embedding === undefined);

const edgeLine = lines.find((oneLine) => oneLine.type === 'HAS_CLASS');
harness.ok('edge carries provenanceTier (array-wrapped)', edgeLine.properties.provenanceTier[0] === 'structural', JSON.stringify(edgeLine.properties));

// =====================================================================
harness.section('VOYAGE CONFIG PATH — the credential pointer is READ, never invented');
// =====================================================================
// Phase 4, work group 4, site 1. `paramPath || configuredPath || DEFAULT_VOYAGE_CONFIG_PATH` put
// an in-code constant BEHIND a settable key, and the key points at CREDENTIALS. Delete
// `voyageConfigFilePath=` from graphBuilder.ini and embedding credentials silently came from a
// machine-specific absolute path baked into the source — wrong on every machine but one, and
// announced nowhere. The param-level override IS announced on stderr; the config->constant
// fallthrough was not. polyArch2 §6: a constant that shadows a settable key is the anti-pattern,
// and it applies with particular force where the value selects which identity a run authenticates
// as.
//
// NO CREDENTIAL VALUE APPEARS ANYWHERE IN THIS SECTION. The fixtures are empty files in an OS
// temp directory; what is under test is the POINTER, and the pointer is not the secret. Nothing
// here opens a file's contents, constructs an embedding client, or calls Voyage.

const os = require('os');

const { resolveVoyageConfigPath } = forgerModule;

// -----
// anExistingIniPath — an empty file in an OS temp dir, standing in for a real credential ini.
//   It carries NO keys and NO secret: the existence check is the only thing under test.
const voyageFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'educoreForge-voyagePointer-'));
const anExistingIniPath = path.join(voyageFixtureDir, 'notARealCredentialFile.ini');
fs.writeFileSync(anExistingIniPath, '# fixture: an existing path, deliberately empty\n');
const aMissingIniPath = path.join(voyageFixtureDir, 'thisFileWasNeverWritten.ini');

// -----
// pathErrors — the refusal as a LIST, so harness.rejects can insist on the SPECIFIC reason.
const pathErrors = (answer) => (answer && answer.error ? [answer.error] : []);

harness.rejects(
	'an ABSENT voyageConfigFilePath is refused, naming the key, the section and the file',
	pathErrors(resolveVoyageConfigPath({ getConfig: () => ({}) })),
	/voyageConfigFilePath[\s\S]*\[forger\][\s\S]*graphBuilder\.ini/,
);
harness.rejects(
	'  and a BLANK one is refused too — a blank pointer is not a pointer',
	pathErrors(resolveVoyageConfigPath({ getConfig: () => ({ voyageConfigFilePath: '   ' }) })),
	/voyageConfigFilePath[\s\S]*EMPTY/,
);
harness.rejects(
	'an INVALID voyageConfigFilePath (no such file) is refused, naming the path it looked at',
	pathErrors(
		resolveVoyageConfigPath({ getConfig: () => ({ voyageConfigFilePath: aMissingIniPath }) }),
	),
	new RegExp(aMissingIniPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
);
harness.match(
	'  and says WHICH source supplied it, so the operator knows which line to fix',
	(resolveVoyageConfigPath({ getConfig: () => ({ voyageConfigFilePath: aMissingIniPath }) }) || {})
		.error,
	/\[forger\]\.voyageConfigFilePath/,
);
harness.rejects(
	'an INVALID call-param path (no such file) is refused too — the override is not exempt',
	pathErrors(
		resolveVoyageConfigPath({ paramPath: aMissingIniPath, getConfig: () => ({}) }),
	),
	/embeddingConfigFilePath/,
);
harness.equal(
	'a CONFIGURED path that EXISTS is honoured verbatim — the positive control',
	(resolveVoyageConfigPath({ getConfig: () => ({ voyageConfigFilePath: anExistingIniPath }) }) || {})
		.configFilePath,
	anExistingIniPath,
);
harness.equal(
	'  and the call param still wins over a configured one — the precedence is unchanged',
	(
		resolveVoyageConfigPath({
			paramPath: anExistingIniPath,
			getConfig: () => ({ voyageConfigFilePath: aMissingIniPath }),
		}) || {}
	).configFilePath,
	anExistingIniPath,
);

harness.ok(
	'no in-code credential path survives in forger.js',
	!/voyageEmbedding\.ini/.test(codeOf(path.join(__dirname, '..', 'forger.js'))),
	(codeOf(path.join(__dirname, '..', 'forger.js')).match(/.*voyageEmbedding\.ini.*/g) || []).join(
		'\n',
	),
);
harness.ok(
	'  and the module exports no DEFAULT_VOYAGE_CONFIG_PATH to stand behind the key',
	forgerModule.DEFAULT_VOYAGE_CONFIG_PATH === undefined,
	String(forgerModule.DEFAULT_VOYAGE_CONFIG_PATH),
);

fs.rmSync(voyageFixtureDir, { recursive: true, force: true });

// =====================================================================
harness.section('THE SPEND KNOB — vectorize is STATED, or the forge does not start');
// =====================================================================
// forger.js:151 destructures `vectorize = true`. The forger is where the money is actually spent
// — work group 3 fixed the four ENTRY POINTS that READ the operator's --vectorize; this is the
// site that ACTS on it. Its only production caller, build.js, does not pass the field at all, so
// every `graphBuilder -build` embeds a whole recipe because nobody said anything either way.
//
// NO SPEND IS POSSIBLE FROM ANY ASSERTION IN THIS SECTION, IN EITHER POLARITY. The fixtures are:
//   - a temp forge bundle registered in forges/ whose entryModule names a file that was never
//     written, so the run cannot reach a parser;
//   - a temp voyage ini that is DELIBERATELY INCOMPLETE — no model, and no apiKey, so an
//     embedding client built against it cannot resolve an identity, let alone call an API.
// vectorize=true therefore stops inside embedding-client naming that fixture ini, and
// vectorize=false stops later at the missing entry module. Two different stops is exactly the
// evidence wanted: it shows WHICH branch each value took, and neither branch touches the network.
// NO CREDENTIAL VALUE APPEARS ANYWHERE — the fixture ini has no key in it to appear.

const spendFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'educoreForge-spendKnob-'));
const incompleteVoyageIniPath = path.join(spendFixtureDir, 'notARealCredentialFile.ini');
fs.writeFileSync(
	incompleteVoyageIniPath,
	'[voyageEmbedding]\n# fixture: deliberately incomplete — no model, no apiKey, nothing to spend\n',
);

const UNREACHABLE_BUNDLE = 'zztestonlyunreachablebundle';
const unreachableBundleDir = path.join(FORGES_DIR_FOR_TEST, UNREACHABLE_BUNDLE);
fs.rmSync(unreachableBundleDir, { recursive: true, force: true });
fs.mkdirSync(unreachableBundleDir, { recursive: true });
fs.writeFileSync(
	path.join(unreachableBundleDir, 'parserDescriptor.ini'),
	'[parserDescriptor]\nstandardName=ZZ\nentryModule=thisEntryModuleWasNeverWritten.js\n',
);

// -----
// forgeOutcome — call forge() with a spec and hand back everything it said, as LISTS so
//   harness.rejects can insist on the SPECIFIC reason. Every path exercised here answers or
//   throws SYNCHRONOUSLY (the spec gates, the roster refusal, the embedding-client identity
//   read and the missing-module require all precede the pipeRunner), so nothing is left running
//   after the assertion. try/catch is localized to this one test boundary and is never control
//   flow in the code under test.

const forgeOutcome = (spec) => {
	const answered = [];
	let thrown = [];
	try {
		forgerModule().forge(spec, (err, report) => {
			answered.push({ err, report });
		});
	} catch (error) {
		thrown = [error.message];
	}
	return {
		thrown,
		callbackErrors: answered.filter((one) => one.err).map((one) => one.err),
		all: [...thrown, ...answered.filter((one) => one.err).map((one) => one.err)],
	};
};

const spendSpec = (vectorizeArgs) => ({
	standard: UNREACHABLE_BUNDLE,
	version: 'testOnly',
	source: path.join(spendFixtureDir, 'noSuchSourceFile.json'),
	embeddingConfigFilePath: incompleteVoyageIniPath,
	...vectorizeArgs,
});

const unstated = forgeOutcome(spendSpec({}));
harness.rejects(
	'an ABSENT vectorize is refused, naming the field and both accepted values',
	unstated.callbackErrors,
	/vectorize is not set[\s\S]*vectorize: true[\s\S]*vectorize: false/,
);
harness.match(
	'  and says it is the SPEND KNOB with NO DEFAULT — the reason absence cannot be answered',
	unstated.callbackErrors.join('\n'),
	/spend knob[\s\S]*no default/i,
);
harness.ok(
	'  and it stops BEFORE an embedding client exists — the refusal cannot itself cost anything',
	!unstated.all.some((one) => /embedding-client/.test(one)),
	unstated.all.join('\n'),
);
harness.ok(
	'  and it travels by CALLBACK, not a throw — forge() is callback-style all the way down',
	unstated.thrown.length === 0 && unstated.callbackErrors.length === 1,
	`thrown: ${unstated.thrown.join('|')} / callback: ${unstated.callbackErrors.join('|')}`,
);

const stringFalse = forgeOutcome(spendSpec({ vectorize: 'false' }));
harness.rejects(
	"an INVALID vectorize:'false' (a STRING, and therefore truthy) is refused, naming what was given",
	stringFalse.callbackErrors,
	/vectorize is 'false'[\s\S]*string/,
);
harness.ok(
	'  and it NEVER reaches the embedding client — the truthy string used to spend silently',
	!stringFalse.all.some((one) => /embedding-client/.test(one)),
	stringFalse.all.join('\n'),
);
harness.rejects(
	"  and vectorize:'true' is refused too — the string is not a spelling of the boolean",
	forgeOutcome(spendSpec({ vectorize: 'true' })).callbackErrors,
	/vectorize is 'true'/,
);
harness.rejects(
	'  and vectorize:1 is refused, naming the number — a truthy number is not a decision',
	forgeOutcome(spendSpec({ vectorize: 1 })).callbackErrors,
	/vectorize is 1/,
);
harness.rejects(
	'  and vectorize:null is refused rather than read as "no" — absence in disguise is still absence',
	forgeOutcome(spendSpec({ vectorize: null })).callbackErrors,
	/vectorize is null/,
);

const booleanFalse = forgeOutcome(spendSpec({ vectorize: false }));
harness.ok(
	'a VALID vectorize:false is honoured as FALSE — the positive control, OFF direction',
	booleanFalse.all.some((one) => /thisEntryModuleWasNeverWritten/.test(one)),
	booleanFalse.all.join('\n'),
);
harness.ok(
	'  and no embedding client is constructed at all — the spend knob really does bind',
	!booleanFalse.all.some((one) => /embedding-client/.test(one)),
	booleanFalse.all.join('\n'),
);

const booleanTrue = forgeOutcome(spendSpec({ vectorize: true }));
harness.ok(
	'a VALID vectorize:true is honoured as TRUE — the positive control, ON direction',
	booleanTrue.all.some((one) => /embedding-client/.test(one)),
	booleanTrue.all.join('\n'),
);
harness.ok(
	'  the two directions differ — a one-direction control proves only that nothing was rejected',
	booleanTrue.all.some((one) => /embedding-client/.test(one)) &&
		!booleanFalse.all.some((one) => /embedding-client/.test(one)),
	`true said:\n${booleanTrue.all.join('\n')}\nfalse said:\n${booleanFalse.all.join('\n')}`,
);
harness.ok(
	'  and BOTH valid runs stopped on a fixture fault, having touched no network — nothing was spent',
	booleanTrue.all.concat(booleanFalse.all).every((one) => /embedding-client|Cannot find module/.test(one)),
	booleanTrue.all.concat(booleanFalse.all).join('\n'),
);

harness.ok(
	'no `vectorize = true` default survives in forger.js',
	!/vectorize\s*=\s*true/.test(codeOf(path.join(__dirname, '..', 'forger.js'))),
	(codeOf(path.join(__dirname, '..', 'forger.js')).match(/.*vectorize\s*=\s*true.*/g) || []).join(
		'\n',
	),
);
harness.match(
	"and build.js — the ONE production caller — now STATES the spend instead of omitting it",
	codeOf(path.join(__dirname, '..', '..', '..', 'lib', 'build.js')),
	/forger\.forge\(\{[\s\S]{0,200}vectorize:/,
);
harness.ok(
	'and interfaces.js declares vectorize REQUIRED, not an optional defaulting to true',
	!/\[vectorize=true\]/.test(
		fs.readFileSync(path.join(__dirname, '..', '..', '..', 'interfaces.js'), 'utf8'),
	),
	(
		fs
			.readFileSync(path.join(__dirname, '..', '..', '..', 'interfaces.js'), 'utf8')
			.match(/.*vectorize.*/g) || []
	).join('\n'),
);

fs.rmSync(unreachableBundleDir, { recursive: true, force: true });
fs.rmSync(spendFixtureDir, { recursive: true, force: true });

// =====================================================================
harness.section('SHAPE-FORGED-GRAPH — the model version is CARRIED, never invented');
// =====================================================================
// A vector's embeddingModelVersion is what vectorIdForInput hashes: substituting one does not
// merely behave oddly, it silently changes what every content address means (polyArch2 §6). A
// bundle that embedded a node without stamping the model that did it is malformed output, and
// this module already knows how to say so — the ragged-dims refusal below is the pattern.

// -----
// forgedWith — the smallest bundle output that carries ONE embedded node, so a test can vary
//   exactly the property under examination and nothing else.

const forgedWith = (embeddingProperties) => ({
	standardKey: 'lif',
	stableUriPropertyName: 'lifPath',
	metadata: { version: '2.0' },
	nodes: [
		{
			stableId: 'lif:embedded',
			labels: ['ForgedNode', 'LifRoot'],
			properties: {
				_id: 'lif:embedded',
				_source: 'LIF',
				name: 'LIF',
				embedding: new Array(1024).fill(0.5),
				...embeddingProperties,
			},
		},
	],
	edges: [],
});

const shapedMissingVersion = shapeForgedGraph({ forged: forgedWith({}) });
harness.rejects(
	'an embedded node with NO embeddingModelVersion is refused, naming the offending node',
	shapedMissingVersion.error ? [shapedMissingVersion.error] : [],
	/node 'lif:embedded'.*embeddingModelVersion/s,
);

const shapedBlankVersion = shapeForgedGraph({
	forged: forgedWith({ embeddingModelVersion: '   ' }),
});
harness.rejects(
	'an embedded node with a BLANK embeddingModelVersion is refused, not normalized',
	shapedBlankVersion.error ? [shapedBlankVersion.error] : [],
	/node 'lif:embedded'.*embeddingModelVersion/s,
);

const shapedConfigured = shapeForgedGraph({
	forged: forgedWith({ embeddingModelVersion: 'voyage-context-3' }),
	declaredEmbeddingDims: 1024,
});
harness.equal(
	'a CARRIED embeddingModelVersion survives verbatim — the positive control',
	shapedConfigured.nodes ? shapedConfigured.nodes[0].embeddingModelVersion : shapedConfigured.error,
	'voyage-context-3',
);

harness.ok(
	'no model-version literal survives anywhere in shape-forged-graph.js',
	!/voyage-[0-9]/.test(codeOf(path.join(__dirname, '..', 'lib', 'shape-forged-graph.js'))),
	(codeOf(path.join(__dirname, '..', 'lib', 'shape-forged-graph.js')).match(/.*voyage-[0-9].*/g) || []).join(
		'\n',
	),
);

// =====================================================================
harness.section('STANDARD-BLOCK SERIALIZER — the model version is CARRIED here too');
// =====================================================================
// This module is the fidelity gate's fixture: it produces the "in-memory" side of the
// in-memory-vs-harvested comparison. A silently stamped side A weakens exactly the comparison
// the fixture exists for, so it holds the same line as shapeForgedGraph — in lockstep, by design.

// -----
// serializedNodeOf — the ONE node line out of a built block, parsed back from its JSONL.

const serializedNodeOf = (built) =>
	built.blockText
		.trim()
		.split('\n')
		.map((oneLine) => JSON.parse(oneLine))
		.find((oneLine) => oneLine.stableId === 'lif:embedded');

const builtMissingVersion = buildStandardBlock({ forged: forgedWith({}) });
harness.rejects(
	'an embedded node with NO embeddingModelVersion is refused, naming the offending node',
	builtMissingVersion.error ? [builtMissingVersion.error] : [],
	/node 'lif:embedded'.*embeddingModelVersion/s,
);

const builtBlankVersion = buildStandardBlock({
	forged: forgedWith({ embeddingModelVersion: '   ' }),
});
harness.rejects(
	'an embedded node with a BLANK embeddingModelVersion is refused, not normalized',
	builtBlankVersion.error ? [builtBlankVersion.error] : [],
	/node 'lif:embedded'.*embeddingModelVersion/s,
);

const builtConfigured = buildStandardBlock({
	forged: forgedWith({ embeddingModelVersion: 'voyage-context-3' }),
	declaredEmbeddingDims: 1024,
});
harness.equal(
	'a CARRIED embeddingModelVersion is serialized verbatim — the positive control',
	builtConfigured.error || serializedNodeOf(builtConfigured).embeddingModelVersion,
	'voyage-context-3',
);

harness.ok(
	'no model-version literal survives anywhere in standard-block.js',
	!/voyage-[0-9]/.test(codeOf(path.join(__dirname, '..', 'lib', 'standard-block.js'))),
	(codeOf(path.join(__dirname, '..', 'lib', 'standard-block.js')).match(/.*voyage-[0-9].*/g) || []).join('\n'),
);

// =====================================================================
harness.section('STATE 1 — CERTIFYING THE DEFECT: an in-code 1024 overrules the configured dims');
// =====================================================================
// These assertions document the behaviour being removed, in its own words. They PASS today.

// -----
// forgedOfDims — the same one-node bundle at an arbitrary vector width.

const forgedOfDims = (dims) => {
	const built = forgedWith({ embeddingModelVersion: 'voyage-context-3' });
	built.nodes[0].properties.embedding = new Array(dims).fill(0.5);
	return built;
};

// =====================================================================
harness.section('SHAPE-FORGED-GRAPH DIMS — the declared width comes from the caller, not the code');
// =====================================================================
// EMBEDDING_DIMS = 1024 shadowed [voyageEmbedding].embeddingDims: set the ini to 512 and every
// vector was refused for disagreeing with a number the operator never typed. §6 permits an
// in-code constant only where nothing is settable, and this is settable.

harness.rejects(
	'an ABSENT declaredEmbeddingDims is refused when vectors are present, naming the key',
	(() => {
		const answer = shapeForgedGraph({ forged: forgedOfDims(1024) });
		return answer.error ? [answer.error] : [];
	})(),
	/declaredEmbeddingDims.*embeddingDims/s,
);

harness.rejects(
	'an INVALID declaredEmbeddingDims is refused rather than corrected',
	(() => {
		const answer = shapeForgedGraph({ forged: forgedOfDims(1024), declaredEmbeddingDims: '102o' });
		return answer.error ? [answer.error] : [];
	})(),
	/declaredEmbeddingDims.*'102o'/s,
);

harness.equal(
	'a CONFIGURED 512 admits a 512-dim vector set — the positive control',
	(() => {
		const answer = shapeForgedGraph({ forged: forgedOfDims(512), declaredEmbeddingDims: 512 });
		return answer.error || answer.embeddingDims;
	})(),
	512,
);

harness.match(
	'and a vector set that disagrees with the DECLARED width is still refused, naming both',
	shapeForgedGraph({ forged: forgedOfDims(512), declaredEmbeddingDims: 1024 }).error,
	/512 does not match the declared 1024/,
);

harness.ok(
	'no dimension literal survives anywhere in shape-forged-graph.js',
	!/\b(1024|512)\b/.test(codeOf(path.join(__dirname, '..', 'lib', 'shape-forged-graph.js'))),
	(codeOf(path.join(__dirname, '..', 'lib', 'shape-forged-graph.js')).match(/.*\b(1024|512)\b.*/g) || []).join('\n'),
);

// =====================================================================
harness.section('STANDARD-BLOCK DIMS — the header declares the width it was given');
// =====================================================================

harness.rejects(
	'an ABSENT declaredEmbeddingDims is refused when vectors are present, naming the key',
	(() => {
		const answer = buildStandardBlock({ forged: forgedOfDims(1024) });
		return answer.error ? [answer.error] : [];
	})(),
	/declaredEmbeddingDims.*embeddingDims/s,
);

harness.rejects(
	'an INVALID declaredEmbeddingDims is refused rather than corrected',
	(() => {
		const answer = buildStandardBlock({ forged: forgedOfDims(1024), declaredEmbeddingDims: '102o' });
		return answer.error ? [answer.error] : [];
	})(),
	/declaredEmbeddingDims.*'102o'/s,
);

harness.equal(
	'a CONFIGURED 512 is what the header declares — the positive control',
	(() => {
		const answer = buildStandardBlock({ forged: forgedOfDims(512), declaredEmbeddingDims: 512 });
		return answer.error || JSON.parse(answer.blockText.split('\n')[0]).embeddingDims;
	})(),
	512,
);

harness.ok(
	'no dimension literal survives anywhere in standard-block.js',
	!/\b(1024|512)\b/.test(codeOf(path.join(__dirname, '..', 'lib', 'standard-block.js'))),
	(codeOf(path.join(__dirname, '..', 'lib', 'standard-block.js')).match(/.*\b(1024|512)\b.*/g) || []).join('\n'),
);

// =====================================================================
harness.section('CAPTURE-BASELINE --vectorize — the spend knob is read ONCE, or refused');
// =====================================================================
// capture-baseline.js read the spend knob as `!== 'false'`: a not-equal test against ONE
// spelling, so 'no', 'off', 'False' and an absent switch alike were read as TRUE and spent real
// Voyage credit against the operator's explicit attempt to turn it off. It now reads through
// requireBooleanValue — exactly 'true' or exactly 'false', absence refused, anything else named.
//
// NO SPEND IS POSSIBLE FROM THESE RUNS, in either polarity. Every spawn carries a --standard
// token that resolveBundle cannot resolve, so the script stops on the known-forges roster error
// before an embedding client is ever constructed; and the --vectorize refusals fire earlier
// still, on the first read after startup. Each run ends in about a fifth of a second having
// touched no network, no docker, and no database.

const NO_SUCH_STANDARD = '__no_such_standard_this_test_only__';
const TREE_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');

// -----
// runEntryPoint — run one of the deliberate integration entry points to the point where it
//   reads --vectorize, and hand back everything it said plus how it exited. stdout and stderr
//   are joined because testAppStartup routes xLog to stdout while an uncaught refusal lands on
//   stderr, and the assertion cares about what the operator sees, which is both.

const runEntryPoint = (entryPath, extraArgs) => {
	const run = spawnSync(
		process.execPath,
		[entryPath, `--standard=${NO_SUCH_STANDARD}`, ...extraArgs],
		{ encoding: 'utf8', cwd: TREE_ROOT, timeout: 60000 },
	);
	return { status: run.status, text: `${run.stdout || ''}${run.stderr || ''}` };
};

const CAPTURE_BASELINE = path.join(__dirname, 'capture-baseline.js');

const captureAbsent = runEntryPoint(CAPTURE_BASELINE, []);
harness.match(
	'an ABSENT --vectorize is refused, naming the switch and both accepted spellings',
	captureAbsent.text,
	/--vectorize is not set[\s\S]*--vectorize=true[\s\S]*--vectorize=false/,
);
harness.equal('  and the run stops rather than choosing for him', captureAbsent.status !== 0, true);

const captureInvalid = runEntryPoint(CAPTURE_BASELINE, ['--vectorize=no']);
harness.match(
	"an INVALID --vectorize=no is refused, naming 'no' and what IS accepted — never read as TRUE",
	captureInvalid.text,
	/--vectorize='no'[\s\S]*--vectorize=true[\s\S]*--vectorize=false/,
);
harness.equal(
	'  and it stops before an embedding client exists, so the typo cannot spend a cent',
	captureInvalid.status !== 0,
	true,
);

const captureTrue = runEntryPoint(CAPTURE_BASELINE, ['--vectorize=true']);
const captureFalse = runEntryPoint(CAPTURE_BASELINE, ['--vectorize=false']);
harness.match(
	'a VALID --vectorize=true is honoured as TRUE — the positive control, ON direction',
	captureTrue.text,
	/vectorize=true/,
);
harness.match(
	'a VALID --vectorize=false is honoured as FALSE — the positive control, OFF direction',
	captureFalse.text,
	/vectorize=false/,
);
harness.ok(
	'  the two directions differ — a one-direction control would not have caught the polarity bug',
	/vectorize=true/.test(captureTrue.text) && !/vectorize=true/.test(captureFalse.text),
	`--vectorize=true said:\n${captureTrue.text}\n--vectorize=false said:\n${captureFalse.text}`,
);
harness.match(
	'  and both valid runs walked past the switch to the roster error, having spent nothing',
	captureFalse.text,
	/no forge bundle for standard/,
);

harness.ok(
	'no hand-rolled --vectorize comparison survives in capture-baseline.js',
	!/values\.vectorize/.test(codeOf(CAPTURE_BASELINE)),
	(codeOf(CAPTURE_BASELINE).match(/.*values\.vectorize.*/g) || []).join('\n'),
);
harness.match(
	'  it reads the switch through the one shared rule instead',
	codeOf(CAPTURE_BASELINE),
	/requireBooleanValue\(/,
);
harness.match(
	'  and its own -help states the switch is REQUIRED with no default — the contract where he looks',
	runEntryPoint(CAPTURE_BASELINE, ['-help']).text,
	/--vectorize=true\|false[\s\S]*REQUIRED, and there is NO DEFAULT/,
);

// =====================================================================
harness.section('INTEGRATION-FORGE --vectorize — the same knob, read the same one way');
// =====================================================================
// integration-forge.js carried the SAME `!== 'false'` reading. It is the heavier of the two — it
// provisions a container AND embeds a whole standard — so the same typo cost more here. It now
// reads through the same requireBooleanValue as capture-baseline, so there is one rule to know.
//
// NO SPEND IS POSSIBLE FROM THESE RUNS EITHER, in either polarity: the spawns carry a --standard
// token with no MIN_NODES floor, so the script exits on that check before replayManager.create
// is ever called; the --vectorize refusals fire before even that.

const INTEGRATION_FORGE = path.join(__dirname, 'integration-forge.js');

const forgeAbsent = runEntryPoint(INTEGRATION_FORGE, []);
harness.match(
	'an ABSENT --vectorize is refused, naming the switch and both accepted spellings',
	forgeAbsent.text,
	/--vectorize is not set[\s\S]*--vectorize=true[\s\S]*--vectorize=false/,
);
harness.equal('  and the run stops rather than choosing for him', forgeAbsent.status !== 0, true);

const forgeInvalid = runEntryPoint(INTEGRATION_FORGE, ['--vectorize=no']);
harness.match(
	"an INVALID --vectorize=no is refused, naming 'no' and what IS accepted — never read as TRUE",
	forgeInvalid.text,
	/--vectorize='no'[\s\S]*--vectorize=true[\s\S]*--vectorize=false/,
);
harness.equal(
	'  and it stops before a container is asked for, so the typo cannot spend a cent',
	forgeInvalid.status !== 0,
	true,
);

const forgeTrue = runEntryPoint(INTEGRATION_FORGE, ['--vectorize=true']);
const forgeFalse = runEntryPoint(INTEGRATION_FORGE, ['--vectorize=false']);
harness.match(
	'a VALID --vectorize=true is honoured as TRUE — the positive control, ON direction',
	forgeTrue.text,
	/vectorize=true/,
);
harness.match(
	'a VALID --vectorize=false is honoured as FALSE — the positive control, OFF direction',
	forgeFalse.text,
	/vectorize=false/,
);
harness.ok(
	'  the two directions differ — a one-direction control would not have caught the polarity bug',
	/vectorize=true/.test(forgeTrue.text) && !/vectorize=true/.test(forgeFalse.text),
	`--vectorize=true said:\n${forgeTrue.text}\n--vectorize=false said:\n${forgeFalse.text}`,
);
harness.match(
	'  and both valid runs walked past the switch to the MIN_NODES floor, having spent nothing',
	forgeFalse.text,
	/no MIN_NODES floor for standard/,
);

harness.ok(
	'no hand-rolled --vectorize comparison survives in integration-forge.js',
	!/values\.vectorize/.test(codeOf(INTEGRATION_FORGE)),
	(codeOf(INTEGRATION_FORGE).match(/.*values\.vectorize.*/g) || []).join('\n'),
);
harness.match(
	'  it reads the switch through the one shared rule instead',
	codeOf(INTEGRATION_FORGE),
	/requireBooleanValue\(/,
);
harness.match(
	'  and its own -help states the switch is REQUIRED with no default — the contract where he looks',
	runEntryPoint(INTEGRATION_FORGE, ['-help']).text,
	/--vectorize=true\|false[\s\S]*REQUIRED, and there is NO DEFAULT/,
);

// =====================================================================
harness.section('THE REPORTED VERSION — the bundle stamps it, or the forge says so');
// =====================================================================
// `version: args.forged.metadata.version || version` collapsed TWO different provenance claims
// into one field: what the BUNDLE read out of the source document, and the version token the
// RECIPE asked for. A bundle that stamped nothing reported the recipe's token as though the
// bundle had stamped it, and no trace of the substitution survived. Both parsers stamp 'unknown'
// rather than empty today, so this arm rarely fires — which is exactly what makes it a good place
// for a lie to live undisturbed (audit B1, forger.js:239).
//
// resolveReportedVersion is the pure reading, exported so it is provable without running a forge.

const FORGER_PATH = path.join(__dirname, '..', 'forger.js');
const { resolveReportedVersion } = forgerModule;
const versionAnswer = (args) => (resolveReportedVersion || (() => ({})))(args) || {};

harness.match(
	'a bundle that stamped NO version is REFUSED — the recipe token never stands in for it',
	versionAnswer({ bundleVersion: undefined, requestedVersion: 'current' }).error,
	/bundle[\s\S]*version[\s\S]*current/i,
);

harness.match(
	'a bundle that stamped a BLANK version is refused too',
	versionAnswer({ bundleVersion: '   ', requestedVersion: 'current' }).error,
	/version/i,
);

harness.match(
	'a forge that requested NO version is refused — the recipe names what it asked for',
	versionAnswer({ bundleVersion: '3.0.1', requestedVersion: undefined }).error,
	/requested|version token/i,
);

harness.equal(
	'a stamped version is reported verbatim as the BUNDLE version — the positive control',
	versionAnswer({ bundleVersion: '3.0.1', requestedVersion: 'current' }).bundleVersion,
	'3.0.1',
);

harness.equal(
	'  and the requested token is reported SEPARATELY, never merged into it',
	versionAnswer({ bundleVersion: '3.0.1', requestedVersion: 'current' }).requestedVersion,
	'current',
);

harness.equal(
	"  and an honest 'unknown' stamp is passed through as the bundle's own word",
	versionAnswer({ bundleVersion: 'unknown', requestedVersion: 'current' }).bundleVersion,
	'unknown',
);

harness.ok(
	'no `metadata.version || version` fallthrough survives in forger.js',
	!/metadata\.version \|\|/.test(codeOf(FORGER_PATH)),
	(codeOf(FORGER_PATH).match(/.*metadata\.version \|\|.*/g) || []).join('\n'),
);

// =====================================================================
harness.section('EVALUATE-AGAINST-GOLDEN — the standard set is asked for, never assumed');
// =====================================================================
// `parseListValue(values.standard, ['ceds'])` gave the tree's own acceptance evaluator a silent
// default: a run with no --standard evaluated ONLY CEDS and then reported success for "the
// comparison", with every other standard unexamined and nothing saying so. --goldenPort and
// --goldenPassword in the same file are REQUIRED and loud; this flag missed the house style
// (audit B1, evaluate-against-golden.js:76).

const EVALUATE_AGAINST_GOLDEN = path.join(TREE_ROOT, 'test', 'evaluate-against-golden.js');

const runEvaluator = (extraArgs) => {
	const run = spawnSync(process.execPath, [EVALUATE_AGAINST_GOLDEN, ...extraArgs], {
		encoding: 'utf8',
		cwd: TREE_ROOT,
		timeout: 60000,
	});
	return { status: run.status, text: `${run.stdout || ''}${run.stderr || ''}` };
};

const evaluatorNoStandard = runEvaluator(['--goldenPort=1', '--goldenPassword=x']);
harness.match(
	'an ABSENT --standard is refused — it never quietly evaluates CEDS alone and calls it the comparison',
	evaluatorNoStandard.text,
	/--standard is not set|--standard[\s\S]*required/i,
);
harness.ok(
	'  having named no standard, it names none in its output either',
	!/=== CEDS ===/.test(evaluatorNoStandard.text),
	evaluatorNoStandard.text.slice(0, 300),
);

// `--standard=,` is the blank-token spelling that survives qtools intact (a bare `--standard=`
// is parsed as a boolean and SWALLOWS the next argument — a qtools code fact, documented in
// require-boolean-value.js, and a different fault from this one).
const evaluatorBlankStandard = runEvaluator([
	'--standard=,',
	'--goldenPort=1',
	'--goldenPassword=x',
]);
harness.match(
	'a --standard given with no value is refused too, naming the switch',
	evaluatorBlankStandard.text,
	/--standard/,
);
harness.ok(
	'  and nothing was forged on that path either',
	!/=== (CEDS|LIF) ===/.test(evaluatorBlankStandard.text),
	evaluatorBlankStandard.text.slice(0, 300),
);

const evaluatorUnknownStandard = runEvaluator([
	'--standard=zorg',
	'--goldenPort=1',
	'--goldenPassword=x',
]);
harness.match(
	"an UNKNOWN standard token is refused BY NAME, not forged and blamed later",
	evaluatorUnknownStandard.text,
	/zorg/,
);

harness.match(
	'-help states --standard as REQUIRED, so the control surface says what the code does',
	runEvaluator(['-help']).text,
	/--standard=<token\[,token\]>[\s\S]*REQUIRED|REQUIRED[\s\S]*--standard/,
);

// =====================================================================
harness.section('EVALUATE-AGAINST-GOLDEN — the spend knob it does NOT have, said out loud');
// =====================================================================
// evaluate-against-golden hard-pins `vectorize: false` in its forge call, and that pin is CORRECT:
// the comparison is a set comparison over stableIds, which do not depend on embeddings, so
// spending Voyage credit here would buy nothing. But it was a constant nobody could see — the
// helpText named no --vectorize, the code named no reason — and a --vectorize=true typed on the
// command line was ACCEPTED AND IGNORED, which is §6's worse fault: the operator who typed it
// believed it took effect and believed he was paying for embeddings.
//
// DISPOSITION: not settable, therefore a legitimate constant (polyArch2 §6, "a constant with
// nothing to shadow is simply a constant") — but DOCUMENTED, and a --vectorize offered to it is
// REFUSED rather than swallowed.

harness.match(
	'-help states that this run never vectorizes, and why',
	runEvaluator(['-help']).text,
	/vectoriz/i,
);

const evaluatorWithVectorize = runEvaluator([
	'--standard=lif',
	'--vectorize=true',
	'--goldenPort=1',
	'--goldenPassword=x',
]);
harness.match(
	'a --vectorize offered to it is REFUSED by name — never accepted and ignored',
	evaluatorWithVectorize.text,
	/--vectorize[\s\S]*(not|no).*(knob|option|spend|embedding)|vectoriz[\s\S]*ignored/i,
);
harness.ok(
	'  and it stops rather than running a comparison the operator misunderstands',
	!/=== LIF ===/.test(evaluatorWithVectorize.text),
	evaluatorWithVectorize.text.slice(0, 400),
);

const evaluatorWithVectorizeFalse = runEvaluator([
	'--standard=lif',
	'--vectorize=false',
	'--goldenPort=1',
	'--goldenPassword=x',
]);
harness.match(
	'  and even --vectorize=false is refused — agreeing with the constant is still asking to set it',
	evaluatorWithVectorizeFalse.text,
	/--vectorize/,
);

const evaluatorNoVectorize = runEvaluator([
	'--standard=lif',
	'--goldenPort=1',
	'--goldenPassword=x',
]);
harness.ok(
	'a run that does NOT offer --vectorize proceeds past the gate — the positive control',
	/=== LIF ===/.test(evaluatorNoVectorize.text),
	evaluatorNoVectorize.text.slice(0, 400),
);
harness.match(
	'  and announces that it is forging WITHOUT embeddings, so the pin is visible in the run',
	evaluatorNoVectorize.text,
	/vectorize OFF/i,
);

harness.report();
