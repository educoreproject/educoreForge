'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// toyScenario.js — TEST SUPPORT: the SUBJECT every framework unit gate evaluates and every twin
// mutates. A scenario is DATA describing one run of the framework over the toy fixture:
//   frameworkMutationList  textual mutations to framework files (productionMutation twins; moduleDouble)
//   deps                   the factory deps ({ embedder, xLog?, migratingBundleListOverride? })
//   forgeDeclaration       a deep clone of the toy H1 (inputFault twins edit it)
//   hookOverrides          functions laid over a FRESH toyHooks() at run time (twins replace a hook)
//   forgeArgs              the seam call's argument object
//   sourceDirOverride      a scratch snapshot copy (G-CHECKSUM twins alter bytes there)
// runScenario(scenario, cb) → { injectionError?, forgeError?, thrownFromForge?, result?, bundle?, forgeFramework? }
// — a refusal is a RESULT here (a measured outcome), never an exception; the try/catch below is the
// test's observation instrument (tests are outside the DOCTRINE's non-test rule; the harness's own
// doesNotThrow does the same).

const path = require('path');
const fs = require('fs');
const os = require('os');
const moduleDouble = require('./moduleDouble');

const FRAMEWORK_DIR = path.resolve(__dirname, '..', '..');
const FRAMEWORK_MODULE_PATH = path.join(FRAMEWORK_DIR, 'forge-framework.js');
const TOY_DIR = path.join(FRAMEWORK_DIR, 'test', 'fixtures', 'toyForge');
const TOY_SNAPSHOT_DIR = path.join(TOY_DIR, 'assets', 'standardSourceData', '01');
const TOY_ENTRY_PATH = path.join(TOY_DIR, 'forgeToy.js');
const toyForgeDeclaration = require(path.join(TOY_DIR, 'lib', 'toyForgeDeclaration'));
const toyHooksFactory = require(path.join(TOY_DIR, 'lib', 'toyHooks'));

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const makeScenario = () => ({
	frameworkMutationList: [],
	deps: { embedder: null },
	forgeDeclaration: cloneJson(toyForgeDeclaration),
	hookOverrides: {},
	forgeArgs: { sourcePath: TOY_SNAPSHOT_DIR, owner: ':golden', skipEmbedding: true },
	sourceDirOverride: null,
});

const cloneScenario = (scenario) => ({
	frameworkMutationList: scenario.frameworkMutationList.slice(),
	deps: { ...scenario.deps },
	forgeDeclaration: cloneJson(scenario.forgeDeclaration),
	hookOverrides: { ...scenario.hookOverrides },
	forgeArgs: { ...scenario.forgeArgs },
	sourceDirOverride: scenario.sourceDirOverride,
});

// a scratch copy of the toy snapshot in a temp dir (never inside the tree) → its path
const makeScratchSnapshotCopy = () => {
	const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toyForgeScratch-'));
	const scratchSnapshotDir = path.join(scratchRoot, 'standardSourceData', '01');
	fs.mkdirSync(scratchSnapshotDir, { recursive: true });
	fs.readdirSync(TOY_SNAPSHOT_DIR).forEach((oneName) => {
		fs.copyFileSync(path.join(TOY_SNAPSHOT_DIR, oneName), path.join(scratchSnapshotDir, oneName));
	});
	return scratchSnapshotDir;
};

const loadFrameworkFactory = (scenario) =>
	scenario.frameworkMutationList.length
		? moduleDouble.loadWithMutations({ modulePath: FRAMEWORK_MODULE_PATH, mutationList: scenario.frameworkMutationList })
		: require(FRAMEWORK_MODULE_PATH);

const buildHooks = (scenario) => ({ ...toyHooksFactory(), ...scenario.hookOverrides });

// runScenario — inject + forge; every outcome is a value
const runScenario = (scenario, callback) => {
	let forgeFramework;
	let bundle;
	try {
		forgeFramework = loadFrameworkFactory(scenario)(scenario.deps);
		bundle = forgeFramework.injectStandardHooks({ forgeDeclaration: scenario.forgeDeclaration, hooks: buildHooks(scenario) });
	} catch (injectionThrow) {
		if (String(injectionThrow.message).startsWith(moduleDouble.MUTATION_REFUSAL_TAG)) {
			throw injectionThrow; // FA1: a fault that could not be applied is NOT a framework refusal — surface it as UNMEASURED
		}
		callback('', { injectionError: injectionThrow.message });
		return;
	}
	const forgeArgs = scenario.sourceDirOverride ? { ...scenario.forgeArgs, sourcePath: scenario.sourceDirOverride } : scenario.forgeArgs;
	let calledBack = false;
	try {
		bundle.forge(forgeArgs, (forgeError, result) => {
			calledBack = true;
			callback('', { forgeError, result, bundle, forgeFramework });
		});
	} catch (forgeThrow) {
		if (!calledBack) {
			callback('', { thrownFromForge: forgeThrow.message, bundle, forgeFramework });
		}
	}
};

// injectOnly — for gates about injection itself
const injectOnly = (scenario) => {
	try {
		const forgeFramework = loadFrameworkFactory(scenario)(scenario.deps);
		const bundle = forgeFramework.injectStandardHooks({ forgeDeclaration: scenario.forgeDeclaration, hooks: buildHooks(scenario) });
		return { bundle, forgeFramework };
	} catch (injectionThrow) {
		if (String(injectionThrow.message).startsWith(moduleDouble.MUTATION_REFUSAL_TAG)) {
			throw injectionThrow; // FA1
		}
		return { injectionError: injectionThrow.message };
	}
};

// a spy embedder: deterministic fake vectors, counts calls, optional throw-on-call
const makeSpyEmbedder = ({ throwOnCall = false, dims = 4, modelVersion = 'toy-embed-1', vectorCountDelta = 0, omitModelVersion = false, failOnCall = false } = {}) => {
	const spy = { callCount: 0, textsSeen: [] };
	spy.embedTexts = ({ texts }, callback) => {
		spy.callCount += 1;
		spy.textsSeen.push(texts.slice());
		if (throwOnCall) {
			throw new Error('spy embedder was called');
		}
		if (failOnCall) {
			callback('voyage said no');
			return;
		}
		const vectors = texts.map((oneText, oneIndex) => Array.from({ length: dims }, (unused, dimIndex) => (String(oneText === undefined ? '' : oneText).length + oneIndex + dimIndex) % 7));
		for (let deltaIndex = 0; deltaIndex < vectorCountDelta; deltaIndex++) {
			vectors.push(vectors[0]);
		}
		callback('', omitModelVersion ? { vectors } : { vectors, embeddingModelVersion: modelVersion });
	};
	return spy;
};

module.exports = {
	FRAMEWORK_DIR,
	FRAMEWORK_MODULE_PATH,
	TOY_DIR,
	TOY_SNAPSHOT_DIR,
	TOY_ENTRY_PATH,
	toyForgeDeclaration,
	toyHooksFactory,
	makeScenario,
	cloneScenario,
	makeScratchSnapshotCopy,
	runScenario,
	injectOnly,
	buildHooks,
	makeSpyEmbedder,
	cloneJson,
	moduleName,
};
