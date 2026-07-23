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
const { buildStandardBlock } = require('../lib/standard-block');
const { shapeForgedGraph } = require('../lib/shape-forged-graph');

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
harness.section('VOYAGE CONFIG PATH — the precedence rule: param > config > default');
// =====================================================================

const { resolveVoyageConfigPath, DEFAULT_VOYAGE_CONFIG_PATH } = forgerModule;

harness.equal(
	'the call param wins over everything',
	resolveVoyageConfigPath({
		paramPath: '/tmp/override.ini',
		getConfig: () => ({ voyageConfigFilePath: '/configured/path.ini' }),
	}),
	'/tmp/override.ini',
);
harness.equal(
	'the configured path wins when no param',
	resolveVoyageConfigPath({ getConfig: () => ({ voyageConfigFilePath: '/configured/path.ini' }) }),
	'/configured/path.ini',
);
harness.equal(
	'the in-code default governs when neither is given',
	resolveVoyageConfigPath({ getConfig: () => ({}) }),
	DEFAULT_VOYAGE_CONFIG_PATH,
);
harness.match(
	'and the default points at voyageEmbedding.ini (the secret stays in its own file)',
	DEFAULT_VOYAGE_CONFIG_PATH,
	/voyageEmbedding\.ini$/,
);

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

harness.report();
