#!/usr/bin/env node
'use strict';

// test-startup.js — gates for the process/environment plumbing: CONFIG DISCOVERY (loadConfig)
// and the shared LIST-VALUE parameter rule.
//
// Discovery is proven in BOTH directions:
//   - the HAPPY PATH runs against the REAL project layout — the tests live in this tree, so
//     findSystemRoot resolves from here exactly as it does from the app, and the real
//     graphBuilder.ini IS the fixture (TQ's point, 2026-07-22: no seam needed);
//   - the FAILURE directions (zero inis -> {} defaults; TWO inis -> loud refusal) run against
//     THROWAWAY temp copies of the tree shape — fault-inject on a copy, never the real configs
//     (a crashed test must not leave the app broken). The refusal is watched actually firing:
//     a guard never observed refusing is unproven.
//
// Run: node apps/graph-builder/test/test-startup.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const fs = require('fs');
const os = require('os');
const path = require('path');

const helpText = () => `
NAME
     ${moduleName} -- gates for config discovery (loadConfig) and the list-value parameter rule

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves loadConfig finds the real graphBuilder.ini from the real project layout, answers {}
     for unknown sections; and on throwaway tree copies: zero inis -> null path + {} sections,
     a single ini in either legal home -> found, TWO inis -> the loud ambiguity refusal, proven
     to actually fire. Also gates parseListValue (the comma/array rule for qtools values).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const { loadConfig } = require('../lib/startup');
const { parseListValue } = require('../../../test/testLib/parse-list-value');

// =====================================================================
harness.section('DISCOVERY happy path — the REAL project layout is the fixture');
// =====================================================================

const real = loadConfig();
harness.ok('a config file is discovered in the real tree', !!real.configFilePath, real.configFilePath);
harness.match('  and it is a graphBuilder.ini', real.configFilePath || '', /graphBuilder\.ini$/);
harness.ok(
	'[forger] section parses with a voyageConfigFilePath pointer',
	!!real.getConfig('forger').voyageConfigFilePath,
	JSON.stringify(real.getConfig('forger')),
);
harness.ok(
	'[replay-manager] section parses with provisioning knobs',
	!!real.getConfig('replay-manager').neo4jImage,
	JSON.stringify(real.getConfig('replay-manager')),
);
harness.equal(
	'an unknown section answers {} (never undefined, never a throw)',
	JSON.stringify(real.getConfig('noSuchSection')),
	'{}',
);
harness.equal(
	"getConfig('allConfigs') returns the whole config",
	real.getConfig('allConfigs'),
	real.wholeConfig,
);

// =====================================================================
harness.section('DISCOVERY failure directions — throwaway tree copies, refusal proven RED');
// =====================================================================
// Each scenario builds its own fabricated /system/ skeleton in a fresh temp dir (findSystemRoot
// only needs a /system/ path node), copies the REAL startup.js into the tree position it
// occupies here, and symlinks node_modules so its requires resolve. Fresh require() per
// scenario (cache purged) because each one re-reads a different configs state.

const realStartupPath = path.join(__dirname, '..', 'lib', 'startup.js');
const realNodeModules = path.join(__dirname, '..', '..', '..', 'node_modules');

const buildScenarioTree = (scenarioName) => {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `gbStartup-${scenarioName}-`));
	const libDir = path.join(tempRoot, 'system', 'code', 'educoreForge', 'apps', 'graph-builder', 'lib');
	const configsDir = path.join(tempRoot, 'system', 'configs');
	fs.mkdirSync(libDir, { recursive: true });
	fs.mkdirSync(configsDir, { recursive: true });
	fs.copyFileSync(realStartupPath, path.join(libDir, 'startup.js'));
	fs.symlinkSync(realNodeModules, path.join(tempRoot, 'system', 'code', 'educoreForge', 'node_modules'));
	return { tempRoot, libDir, configsDir, startupPath: path.join(libDir, 'startup.js') };
};

const freshLoadConfig = (startupPath) => {
	delete require.cache[require.resolve(startupPath)];
	return require(startupPath).loadConfig;
};

const iniText = '[replay-manager]\nportSearchStart=7777\n';

// --- zero inis: relocated-tree behavior, in-code defaults ---
const zero = buildScenarioTree('zero');
const zeroResult = freshLoadConfig(zero.startupPath)();
harness.equal('ZERO inis: configFilePath is null', zeroResult.configFilePath, null);
harness.equal(
	'  and every section answers {} so in-code defaults govern',
	JSON.stringify(zeroResult.getConfig('replay-manager')),
	'{}',
);

// --- one ini, instanceSpecific home ---
const oneInstance = buildScenarioTree('oneInstance');
fs.mkdirSync(path.join(oneInstance.configsDir, 'instanceSpecific', 'someBox'), { recursive: true });
fs.writeFileSync(
	path.join(oneInstance.configsDir, 'instanceSpecific', 'someBox', 'graphBuilder.ini'),
	iniText,
);
const oneInstanceResult = freshLoadConfig(oneInstance.startupPath)();
harness.match(
	'ONE ini in instanceSpecific/<box>/ is found',
	oneInstanceResult.configFilePath || '',
	/instanceSpecific[\/\\]someBox[\/\\]graphBuilder\.ini$/,
);
harness.equal(
	'  and its values parse',
	Number(oneInstanceResult.getConfig('replay-manager').portSearchStart),
	7777,
);

// --- one ini, flat home ---
const oneFlat = buildScenarioTree('oneFlat');
fs.writeFileSync(path.join(oneFlat.configsDir, 'graphBuilder.ini'), iniText);
const oneFlatResult = freshLoadConfig(oneFlat.startupPath)();
harness.match(
	'ONE ini in configs/ flat is found',
	oneFlatResult.configFilePath || '',
	/configs[\/\\]graphBuilder\.ini$/,
);

// --- TWO inis: the ambiguity refusal, watched firing ---
const two = buildScenarioTree('two');
fs.mkdirSync(path.join(two.configsDir, 'instanceSpecific', 'someBox'), { recursive: true });
fs.writeFileSync(path.join(two.configsDir, 'instanceSpecific', 'someBox', 'graphBuilder.ini'), iniText);
fs.writeFileSync(path.join(two.configsDir, 'graphBuilder.ini'), iniText);
let refusalMessage = '';
try {
	freshLoadConfig(two.startupPath)();
} catch (refusalError) {
	refusalMessage = refusalError.message;
}
harness.match(
	'TWO inis REFUSE loudly rather than silently picking one',
	refusalMessage,
	/MORE THAN ONE graphBuilder\.ini/,
);
harness.match('  naming both candidates so the operator can fix it', refusalMessage, /someBox.*graphBuilder\.ini/);

// cleanup the throwaway trees (best-effort; they are in tmpdir regardless)
[zero, oneInstance, oneFlat, two].forEach((oneScenario) => {
	fs.rmSync(oneScenario.tempRoot, { recursive: true, force: true });
});

// =====================================================================
harness.section('LIST-VALUE RULE — qtools pre-splits commas; consume the WHOLE array');
// =====================================================================

harness.equal(
	'the qtools pre-split form ([a,b]) yields both tokens',
	JSON.stringify(parseListValue(['ceds', 'lif'])),
	JSON.stringify(['ceds', 'lif']),
);
harness.equal(
	'an unsplit comma value (JSON-stdin channel) still yields both',
	JSON.stringify(parseListValue(['ceds,lif'])),
	JSON.stringify(['ceds', 'lif']),
);
harness.equal(
	'the regression shape: [0]-only consumption would have dropped lif — the rule keeps it',
	JSON.stringify(parseListValue(['ceds', 'lif']).slice(1)),
	JSON.stringify(['lif']),
);
harness.equal(
	'no values -> the defaults',
	JSON.stringify(parseListValue(undefined, ['lif'])),
	JSON.stringify(['lif']),
);
harness.equal(
	'whitespace and empty fragments are cleaned',
	JSON.stringify(parseListValue([' ceds , ', ',lif'])),
	JSON.stringify(['ceds', 'lif']),
);

harness.report();
