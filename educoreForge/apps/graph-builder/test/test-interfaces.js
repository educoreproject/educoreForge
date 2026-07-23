#!/usr/bin/env node
'use strict';

// test-interfaces.js — the formal contracts of interfaces.js, ENFORCED. polyArch2 requires
// declared interfaces so implementations cannot drift; this suite is what gives the declaration
// teeth.
//
// THERE IS ONE SET OF IMPLEMENTATIONS. Until 2026-07-23 this suite also held a parallel
// stub-components.js to the same shapes, on the theory that gating both sides would keep them
// together. It did not: the shapes matched while the ARGUMENTS drifted (a positional
// manifest.add, an id() the real manifest never had, a create() called three ways), and the
// orchestrator was written against the stubs. The stubs are deleted; build.js drives the real
// modules and its own suite injects doubles where Docker and Voyage would otherwise be reached.
//
// AND UNTIL 2026-07-23 THIS SUITE CHECKED NAMES ONLY. A declared method existed and was a
// function, and that was the whole of conformance — which is exactly how the drift above stayed
// green for weeks. COMPONENT_SHAPES now declares arity, argument keys and result keys as DATA,
// and this suite holds every implementation to them. The historical drift is reconstructed
// verbatim at the bottom and shown caught: a gate never observed failing is not a gate.
//
// Run: node apps/graph-builder/test/test-interfaces.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- enforce the formal component contracts declared in interfaces.js

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Instantiates every component implementation and holds each to the SHAPE COMPONENT_SHAPES
     declares: exactly the declared methods, each with the declared arity, each visibly reading
     the declared argument keys off its argument object, and -- wherever the method can be
     invoked without Docker, Voyage or a database -- producing the declared result keys.
     Proven in the failure direction: deliberately drifted components, including the historical
     phase-2 drift reconstructed verbatim, are shown to be caught.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');

const harness = require('../../../test/testLib/harness')(moduleName);

const { COMPONENT_SHAPES, MANIFEST_HANDLE_SHAPE } = require('../interfaces');

const TREE_LIB = path.join(__dirname, '..', '..', '..', 'lib');
const contentAddress = require(path.join(TREE_LIB, 'content-address', 'content-address'))();
const { SCHEMA_BLOCK_KIND } = require(path.join(TREE_LIB, 'vocabulary', 'vocabulary'));

const realComponents = {
	forger: require('../apps/forger'),
	replayManager: require('../apps/replay-manager'),
	bridgeMaker: require('../apps/bridge-maker'),
	manifestEditor: require('../apps/manifest-editor'),
};
const buildLib = require('../lib/build')();

// =====================================================================
// THE CHECKERS — one per declared field, each returning '' for conformance and a NAMED violation
// otherwise. They are the whole of the enforcement; interfaces.js states exactly this list.
// =====================================================================

// 1. METHOD SET — exactly the declared methods, each a function.
const methodSetViolation = (instance, declaredShape) => {
	if (!instance || typeof instance !== 'object') {
		return `not an object: ${typeof instance}`;
	}
	const declared = Object.keys(declaredShape);
	const missing = declared.filter((oneName) => typeof instance[oneName] !== 'function');
	const extra = Object.keys(instance).filter((oneName) => !declared.includes(oneName));
	if (missing.length) {
		return `missing/not-a-function: ${missing.join(', ')}`;
	}
	if (extra.length) {
		return `undeclared extras: ${extra.join(', ')}`;
	}
	return '';
};

// 2. ARITY — the field that catches POSITIONAL DRIFT. add({...}, callback) is arity 2;
// add(key, kind, blockId) is arity 3, and no amount of correct naming hides the difference.
const arityViolation = (oneFunction, oneMethodShape, label) =>
	oneFunction.length === oneMethodShape.arity
		? ''
		: `${label} takes ${oneFunction.length} argument(s); the contract declares ${oneMethodShape.arity}` +
			` (a positional signature where the contract declares ONE named-argument object looks exactly like this)`;

// 3. ARGUMENT KEYS — a declared key is honored when the method's own source READS it off the
// argument object: destructured from it (`({inGraph}, callback) =>`, `const {inGraph} = spec`) or
// accessed on it (`spec.inGraph`). This is a source-text check and can pass for the wrong reason;
// it cannot pass a signature that never mentions the key, which is what drift looks like.
const readsArgumentKey = (functionSource, oneKey) =>
	new RegExp(`[{,]\\s*${oneKey}\\s*[,:=}]`).test(functionSource) ||
	new RegExp(`\\.${oneKey}\\b`).test(functionSource);

const argumentKeyViolation = (oneFunction, oneMethodShape, label) => {
	if (!oneMethodShape.argKeys) {
		return '';
	}
	const functionSource = oneFunction.toString();
	const unread = oneMethodShape.argKeys.filter(
		(oneKey) => !readsArgumentKey(functionSource, oneKey),
	);
	return unread.length
		? `${label} never reads declared argument key(s) off its argument object: ${unread.join(', ')}`
		: '';
};

// 4. RESULT KEYS — checked against the value the method ACTUALLY PRODUCED. Requires invoking it,
// so it reaches only what can run without Docker, Voyage or a database (see the gap declared
// below with harness.note).
const resultKeysOf = (oneMethodShape) =>
	oneMethodShape.resultShape ? Object.keys(oneMethodShape.resultShape) : oneMethodShape.resultKeys;

const resultShapeViolation = (producedValue, oneMethodShape, label) => {
	const required = resultKeysOf(oneMethodShape);
	if (!required) {
		return '';
	}
	if (!producedValue || typeof producedValue !== 'object') {
		return (
			`${label} produced ${typeof producedValue} ${JSON.stringify(producedValue)}; the contract ` +
			`declares an object carrying ${required.join(', ')}`
		);
	}
	const absent = required.filter((oneKey) => producedValue[oneKey] === undefined);
	return absent.length ? `${label} result is missing declared key(s): ${absent.join(', ')}` : '';
};

// The three checks that need no invocation, over a whole instance. '' = conforms.
const staticShapeViolation = (instance, declaredShape, instanceLabel) => {
	const setViolation = methodSetViolation(instance, declaredShape);
	if (setViolation) {
		return `${instanceLabel}: ${setViolation}`;
	}
	return Object.keys(declaredShape)
		.reduce(
			(accumulator, oneMethodName) =>
				accumulator.concat([
					arityViolation(
						instance[oneMethodName],
						declaredShape[oneMethodName],
						`${instanceLabel}.${oneMethodName}()`,
					),
					argumentKeyViolation(
						instance[oneMethodName],
						declaredShape[oneMethodName],
						`${instanceLabel}.${oneMethodName}()`,
					),
				]),
			[],
		)
		.filter((oneViolation) => oneViolation)
		.join(' | ');
};

// The NAME-ONLY verdict this suite used to render, kept for ONE purpose: to show, at the bottom,
// that the historical drift passed it. It is not used to gate anything.
const nameOnlyViolation = (instance, declaredShape) =>
	methodSetViolation(instance, declaredShape);

// =====================================================================
// AN IN-MEMORY STORE DOUBLE — no database is opened. manifestEditor is the one component whose
// verbs can be driven inside this suite, which is what makes its result shapes observable.
// =====================================================================

const standardsDatabaseDouble = () => {
	const savedBlocks = {};
	const savedManifests = [];
	let storedManifest = null;
	return {
		savedBlocks,
		savedManifests,
		databaseFilePath: '(in-memory standardsDatabase double — no database is opened)',
		saveBlock: ({ text, kind, subjectRefId, producedBy }, callback) => {
			const refId = contentAddress.blockIdForText(text);
			const alreadyPresent = !!savedBlocks[refId];
			savedBlocks[refId] = { text, refId, kind, subjectRefId, producedBy };
			callback('', { refId, alreadyPresent });
		},
		getBlock: ({ refId }, callback) => callback('', savedBlocks[refId] || null),
		saveManifest: (spec, callback) => {
			savedManifests.push(spec);
			storedManifest = {
				name: spec.name,
				description: spec.description,
				recipeName: spec.recipeName,
				recipeRefId: spec.recipeRefId,
				members: spec.members.map((oneMember) => ({ ...oneMember })),
			};
			callback('', {
				refId: `manifestDouble:${savedManifests.length}`,
				memberCount: spec.members.length,
				alreadyPresent: false,
			});
		},
		getManifest: (spec, callback) => callback('', storedManifest),
	};
};

const schemaBlockDouble = (text) => ({ text, refId: contentAddress.blockIdForText(text) });

// =====================================================================
harness.section('DECLARATION — interfaces.js is present and names every component');
// =====================================================================

harness.equal(
	'COMPONENT_SHAPES declares exactly the four components build.js wires',
	Object.keys(COMPONENT_SHAPES).sort().join(','),
	'bridgeMaker,forger,manifestEditor,replayManager',
);

harness.equal(
	'every declared method declares arity, argKeys and a result declaration',
	Object.keys(COMPONENT_SHAPES)
		.reduce(
			(accumulator, oneComponentName) =>
				accumulator.concat(
					Object.keys(COMPONENT_SHAPES[oneComponentName])
						.filter((oneMethodName) => {
							const oneShape = COMPONENT_SHAPES[oneComponentName][oneMethodName];
							return (
								typeof oneShape.arity !== 'number' ||
								!('argKeys' in oneShape) ||
								!('resultKeys' in oneShape || 'resultShape' in oneShape)
							);
						})
						.map((oneMethodName) => `${oneComponentName}.${oneMethodName}`),
				),
			[],
		)
		.join(', '),
	'',
);

harness.equal(
	'the manifest handle shape is declared once and serves BOTH manifestEditor doors',
	String(
		COMPONENT_SHAPES.manifestEditor.init.resultShape === MANIFEST_HANDLE_SHAPE &&
			COMPONENT_SHAPES.manifestEditor.open.resultShape === MANIFEST_HANDLE_SHAPE,
	),
	'true',
);

// =====================================================================
harness.section('CONFORMANCE — method set, ARITY and ARGUMENT KEYS, on every real component');
// =====================================================================

Object.keys(COMPONENT_SHAPES).forEach((oneComponentName) => {
	const declared = COMPONENT_SHAPES[oneComponentName];
	harness.equal(
		`REAL ${oneComponentName}() conforms ({${Object.keys(declared).join(', ')}}, arities and argument keys)`,
		staticShapeViolation(realComponents[oneComponentName](), declared, oneComponentName),
		'',
	);
	// and the orchestrator's DEFAULT for that component IS that same real module — not a
	// look-alike with its own arguments. This is what the deleted stub-conformance assertion was
	// reaching for and never actually held.
	harness.ok(
		`  and -build's default ${oneComponentName} IS that module`,
		buildLib.defaultComponents[oneComponentName] === realComponents[oneComponentName],
		`default was ${typeof buildLib.defaultComponents[oneComponentName]}`,
	);
});

// =====================================================================
harness.section('RESULT SHAPES — checked against what the implementation ACTUALLY produces');
// =====================================================================

harness.note(
	'DECLARED GAP: result shapes are checked only where the method can be invoked without Docker,',
);
harness.note(
	'Voyage or a database. forger.forge and replayManager.create/init/harvest/delete are NOT',
);
harness.note(
	'invoked here; their declared result shapes are enforced against the fixtures below and',
);
harness.note('nowhere else. interfaces.js says so in the same words.');

// bridgeMaker is stub-bodied by design, so its whole contract runs in-process.
(() => {
	let observed = null;
	realComponents.bridgeMaker().run(
		{ inGraph: { graphName: 'DEV_shapeProbe' }, mapper: 'probeMapper', applyLabel: 'ProbeEdge' },
		(err, result) => {
			observed = { err, result };
		},
	);
	harness.equal('bridgeMaker.run calls back with no error', observed.err, '');
	harness.equal(
		'bridgeMaker.run result carries every declared key',
		resultShapeViolation(observed.result, COMPONENT_SHAPES.bridgeMaker.run, 'bridgeMaker.run'),
		'',
	);
})();

// manifestEditor — both doors and the handle they hand back, against the standardsDatabase double.
(() => {
	const standardsDatabase = standardsDatabaseDouble();
	const manifest = realComponents.manifestEditor({ standardsDatabase }).init({
		name: 'shapeProbeManifest',
		description: 'composed by test-interfaces to observe the declared result shape',
		recipe: { recipeName: 'shapeProbeRecipe' },
	});

	harness.equal(
		'manifestEditor.init returns a handle carrying every declared key',
		resultShapeViolation(manifest, COMPONENT_SHAPES.manifestEditor.init, 'manifestEditor.init'),
		'',
	);
	harness.equal(
		'  and that handle conforms to MANIFEST_HANDLE_SHAPE (arities and argument keys too)',
		staticShapeViolation(manifest, MANIFEST_HANDLE_SHAPE, 'manifest handle'),
		'',
	);

	let addObserved = null;
	manifest.add(
		{
			subjectRefId: 'probe@1.0',
			kind: SCHEMA_BLOCK_KIND.STANDARD_BASE,
			description: 'the one member of the probe manifest',
			schemaBlock: schemaBlockDouble('#probe schema block text\n'),
		},
		(err, result) => {
			addObserved = { err, result };
		},
	);
	harness.equal('manifest.add accepts the declared named-argument object', addObserved.err, '');
	harness.equal(
		'  and its result carries every declared key',
		resultShapeViolation(addObserved.result, MANIFEST_HANDLE_SHAPE.add, 'manifest.add'),
		'',
	);

	let saveObserved = null;
	manifest.save((err, result) => {
		saveObserved = { err, result };
	});
	harness.equal('manifest.save succeeds against the standardsDatabase double', saveObserved.err, '');
	harness.equal(
		'  and its result carries every declared key',
		resultShapeViolation(saveObserved.result, MANIFEST_HANDLE_SHAPE.save, 'manifest.save'),
		'',
	);

	let openObserved = null;
	realComponents.manifestEditor({ standardsDatabase }).open(
		{ manifestRefId: 'manifestDouble:1' },
		(err, reopened) => {
			openObserved = { err, reopened };
		},
	);
	harness.equal('manifestEditor.open succeeds against the standardsDatabase double', openObserved.err, '');
	harness.equal(
		'manifestEditor.open hands back a handle carrying every declared key',
		resultShapeViolation(
			openObserved.reopened,
			COMPONENT_SHAPES.manifestEditor.open,
			'manifestEditor.open',
		),
		'',
	);
	harness.equal(
		'  and that handle conforms to MANIFEST_HANDLE_SHAPE as well',
		staticShapeViolation(openObserved.reopened, MANIFEST_HANDLE_SHAPE, 'reopened manifest handle'),
		'',
	);
})();

// =====================================================================
harness.section('THE GATE BITES — drifted shapes are caught (failure side proven)');
// =====================================================================

harness.match(
	'a missing method is caught and named',
	methodSetViolation({ create: () => {}, delete: () => {} }, COMPONENT_SHAPES.replayManager),
	/missing.*harvest/,
);
harness.match(
	'an undeclared extra method is caught and named',
	methodSetViolation({ forge: () => {}, sneakyExtra: () => {} }, COMPONENT_SHAPES.forger),
	/undeclared extras: sneakyExtra/,
);
harness.match(
	'a method that is not a function is caught',
	methodSetViolation({ forge: 'not a function' }, COMPONENT_SHAPES.forger),
	/missing\/not-a-function: forge/,
);
harness.match(
	'a non-object is caught',
	methodSetViolation(undefined, COMPONENT_SHAPES.forger),
	/not an object/,
);

// THE ASSERTION THAT MATTERS: correct method NAMES, wrong ARGUMENT SHAPE.
const positionallyDriftedManifestEditor = () => ({
	init: (name, recipe) => ({
		add: (subjectRefId, kind, schemaBlock) => members.length,
		members: () => [],
		refId: () => 'x',
		schemaBlocks: (callback) => callback('', []),
		save: (callback) => callback('', {}),
		recipeName: () => recipe,
		recipeRefId: () => '',
	}),
	open: ({ manifestRefId }, callback) => callback('nothing to open'),
});

harness.match(
	'THE ONE THAT MATTERS: right method names, POSITIONAL arguments — caught by arity',
	staticShapeViolation(
		positionallyDriftedManifestEditor(),
		COMPONENT_SHAPES.manifestEditor,
		'driftedManifestEditor',
	),
	/driftedManifestEditor\.init\(\) takes 2 argument\(s\); the contract declares 1/,
);
harness.match(
	'  and the same drift names the argument keys it never reads',
	staticShapeViolation(
		positionallyDriftedManifestEditor(),
		COMPONENT_SHAPES.manifestEditor,
		'driftedManifestEditor',
	),
	/never reads declared argument key\(s\).*name.*description/,
);
harness.match(
	'  and the handle it returns is caught positionally too',
	staticShapeViolation(
		positionallyDriftedManifestEditor().init('n', 'r'),
		MANIFEST_HANDLE_SHAPE,
		'driftedHandle',
	),
	/driftedHandle\.add\(\) takes 3 argument\(s\); the contract declares 2/,
);

// a component whose method names and arities are right and whose ARGUMENT KEYS are renamed.
harness.match(
	'a renamed argument key is caught and named',
	argumentKeyViolation(
		({ graph, selectionLabels, header }, callback) => callback(''),
		COMPONENT_SHAPES.replayManager.harvest,
		'renamedHarvest',
	),
	/never reads declared argument key\(s\).*inGraph/,
);

// a component that hands back a string where the contract declares a GraphHandle.
harness.match(
	'a bolt-url STRING where a GraphHandle is declared is caught',
	resultShapeViolation(
		'bolt://localhost:7811',
		COMPONENT_SHAPES.replayManager.create,
		'stringyCreate',
	),
	/produced string .* the contract declares an object carrying graphName, containerName, boltUrl/,
);
harness.match(
	'a result missing one declared key is caught and named',
	resultShapeViolation(
		{ standard: 'lif', version: '1.0', nodeEdges: {}, nodeCount: 1, edgeCount: 1 },
		COMPONENT_SHAPES.forger.forge,
		'shortForge',
	),
	/missing declared key\(s\): embedCallCount/,
);

// =====================================================================
harness.section('THE PHASE-2 DRIFT — reconstructed verbatim, and caught');
// =====================================================================

// The components below are lib/stub-components.js as it stood at 68fcd5c, the file build.js was
// actually written against and which this suite certified as conforming. They are reproduced here
// ONLY as fixtures: the retrospective claim of phase 3 is that this gate would have caught the
// three drifts phase 2 found by hand, and a claim of that kind is worth what its fixture is worth.

const phase2DriftedComponents = () => {
	let graphSeq = 0;
	let manifestSeq = 0;
	return {
		replayManager: () => ({
			// DRIFT 3: calls back a bolt url STRING; the contract declares a GraphHandle.
			create: (spec, callback) => {
				graphSeq += 1;
				const purpose = (spec && spec.purpose) || 'graph';
				callback('', `stub://graph/${purpose}/${graphSeq}`);
			},
			init: (spec, callback) => callback('', { note: 'stub init' }),
			harvest: (spec, callback) => callback('', { blockId: 'stub-block:1' }),
			delete: (boltUrl, callback) => callback(''),
		}),
		manifestEditor: () => ({
			// DRIFT 1 and 2: init takes POSITIONAL (name, recipe); its handle takes a POSITIONAL
			// add(key, kind, blockRef) and answers to id() rather than refId().
			init: (name, recipe) => {
				manifestSeq += 1;
				const manifestId = `stub-manifest:${name || 'unnamed'}:${manifestSeq}`;
				const members = [];
				return {
					add: (key, kind, blockRef) => {
						members.push({ key, kind, blockRef });
						return members.length;
					},
					id: () => manifestId,
					members: () => members.slice(),
					recipeName: () => (recipe && recipe.recipeName) || name,
				};
			},
			open: ({ manifestRefId }, callback) => callback(`stub open '${manifestRefId}'`),
		}),
	};
};

// FIRST — the gate as it stood. This is not rhetoric; it is the reason the drift survived.
harness.equal(
	'the OLD name-only gate passed the drifted replayManager',
	nameOnlyViolation(phase2DriftedComponents().replayManager(), COMPONENT_SHAPES.replayManager),
	'',
);
harness.equal(
	'the OLD name-only gate passed the drifted manifestEditor',
	nameOnlyViolation(phase2DriftedComponents().manifestEditor(), COMPONENT_SHAPES.manifestEditor),
	'',
);

// NOW — every one of the three drifts, named by the shape-aware gate.
harness.match(
	'DRIFT 1 caught: manifest.add(key, kind, blockRef) is positional where the contract is named',
	staticShapeViolation(
		phase2DriftedComponents().manifestEditor().init('n', {}),
		MANIFEST_HANDLE_SHAPE,
		'phase2Handle',
	),
	/phase2Handle: (missing\/not-a-function|undeclared extras)/,
);
// The same drifted handle with every NAME corrected — the exact state the old gate would have
// been satisfied by. The argument shape is still wrong, and that is now all it takes.
const phase2HandleWithNamesCorrected = () => {
	const drifted = phase2DriftedComponents().manifestEditor().init('n', {});
	return {
		add: drifted.add,
		members: drifted.members,
		refId: () => 'stub-manifest-address',
		schemaBlocks: (callback) => callback('', []),
		save: (callback) => callback('', {}),
		recipeName: drifted.recipeName,
		recipeRefId: () => '',
	};
};

harness.equal(
	'  every NAME corrected: the old name-only gate is satisfied',
	nameOnlyViolation(phase2HandleWithNamesCorrected(), MANIFEST_HANDLE_SHAPE),
	'',
);
harness.match(
	'  and the positional add is STILL caught, by arity alone',
	staticShapeViolation(phase2HandleWithNamesCorrected(), MANIFEST_HANDLE_SHAPE, 'phase2Handle'),
	/phase2Handle\.add\(\) takes 3 argument\(s\); the contract declares 2/,
);
harness.match(
	'DRIFT 2 caught: id() where the contract says refId()',
	methodSetViolation(
		phase2DriftedComponents().manifestEditor().init('n', {}),
		MANIFEST_HANDLE_SHAPE,
	),
	/missing\/not-a-function: refId/,
);
harness.match(
	'DRIFT 3 caught: create() hands back a bolt url string, not a GraphHandle',
	(() => {
		let observed;
		phase2DriftedComponents()
			.replayManager()
			.create({ purpose: 'materialize' }, (err, result) => {
				observed = result;
			});
		return resultShapeViolation(
			observed,
			COMPONENT_SHAPES.replayManager.create,
			'phase2Create',
		);
	})(),
	/phase2Create produced string .*the contract declares an object carrying graphName/,
);
harness.match(
	'  and init(name, recipe) itself is caught before the handle is ever built',
	staticShapeViolation(
		phase2DriftedComponents().manifestEditor(),
		COMPONENT_SHAPES.manifestEditor,
		'phase2ManifestEditor',
	),
	/phase2ManifestEditor\.init\(\) takes 2 argument\(s\); the contract declares 1/,
);

harness.report();
