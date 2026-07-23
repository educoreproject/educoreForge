#!/usr/bin/env node
'use strict';

// test-startup.js — gates for the process/environment plumbing: CONFIG DISCOVERY (loadConfig)
// and the shared LIST-VALUE parameter rule.
//
// Discovery is proven in BOTH directions:
//   - the HAPPY PATH runs against the REAL project layout — the tests live in this tree, so
//     findSystemRoot resolves from here exactly as it does from the app, and the real
//     graphBuilder.ini IS the fixture (TQ's point, 2026-07-22: no seam needed);
//   - the FAILURE directions (zero inis -> LOUD refusal; TWO inis -> loud refusal) run against
//     THROWAWAY temp copies of the tree shape — fault-inject on a copy, never the real configs
//     (a crashed test must not leave the app broken). Both refusals are watched actually firing:
//     a guard never observed refusing is unproven. Absence and ambiguity are both fatal now.
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
     for unknown sections; and on throwaway tree copies: zero inis -> loud refusal naming both
     legal homes, a single ini in either legal home -> found, TWO inis -> the loud ambiguity
     refusal, both proven to actually fire. Also gates parseListValue (the comma/array rule).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const { loadConfig } = require('../lib/startup')();
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
	return require(startupPath)().loadConfig;
};

const iniText = '[replay-manager]\nportSearchStart=7777\n';

// --- zero inis: discovery finds NOTHING and must say so and STOP ---
// The module already refuses TWO inis ("refusing to guess which governs"); it treated ZERO as
// acceptable and reverted the whole tree to in-code values silently. That asymmetry is the defect.
// Now both directions are fatal. polyArch2 §6: "Discovery that finds nothing must say so and stop."
const zero = buildScenarioTree('zero');
let zeroRefusalMessage = '';
try {
	freshLoadConfig(zero.startupPath)();
} catch (zeroError) {
	zeroRefusalMessage = zeroError.message;
}
harness.match(
	'ZERO inis REFUSE loudly rather than silently reverting to in-code values',
	zeroRefusalMessage,
	/NO graphBuilder\.ini/,
);
harness.match(
	'  naming BOTH legal homes so the operator knows where the file belongs',
	zeroRefusalMessage,
	/instanceSpecific[\s\S]*graphBuilder\.ini[\s\S]*configs[\/\\]graphBuilder\.ini/,
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

// =====================================================================
harness.section('BOOLEAN-VALUE RULE — one spelling, one polarity, and nothing else guessed at');
// =====================================================================
// Phase 4, work group 3. Four entry points read --vectorize four times in TWO OPPOSITE
// POLARITIES (`!== 'false'` and `=== 'true'`), so one spelling — --vectorize=no — meant TRUE in
// two of them and FALSE in the other two, and neither told the operator anything. requireBooleanValue
// is now the ONE reading: exactly 'true' or exactly 'false', anything else refused by name.
// polyArch2 §6 — a value someone TYPED and had silently overruled is the worse of the two faults.

// -----
// readBoolean — the helper's answer, or {error} carrying why it refused. try/catch is localized
//   to this one test boundary, never used for control flow in the code under test.
const readBoolean = (commandLineParameters) => {
	let answer;
	try {
		const {
			requireBooleanValue,
		} = require('../../../test/testLib/require-boolean-value');
		answer = {
			value: requireBooleanValue({
				name: 'vectorize',
				commandLineParameters,
				moduleName: 'someEntryPoint',
				whatItControls: 'whether real Voyage embeddings are requested',
			}),
		};
	} catch (error) {
		answer = { error: error.message };
	}
	return answer;
};
const booleanRefusal = (commandLineParameters) => {
	const answer = readBoolean(commandLineParameters);
	return answer.error === undefined ? [] : [answer.error];
};

// the shapes qtools-parse-command-line actually produces (probed against this tree's copy)
const asValue = (given) => ({ values: { vectorize: given }, switches: {} });

harness.rejects(
	'an ABSENT --vectorize is refused, naming the switch and both accepted spellings',
	booleanRefusal({ values: {}, switches: {} }),
	/--vectorize is not set[\s\S]*--vectorize=true[\s\S]*--vectorize=false/,
);
harness.rejects(
	"an INVALID --vectorize=no is refused, naming 'no' and what IS accepted — never guessed at",
	booleanRefusal(asValue(['no'])),
	/--vectorize='no'[\s\S]*--vectorize=true[\s\S]*--vectorize=false/,
);
harness.rejects(
	"an INVALID --vectorize=yes is refused, naming 'yes' — the opposite-polarity twin of 'no'",
	booleanRefusal(asValue(['yes'])),
	/--vectorize='yes'/,
);
harness.rejects(
	"an INVALID --vectorize=1 is refused, naming '1' — a number is not a spelling of true",
	booleanRefusal(asValue(['1'])),
	/--vectorize='1'/,
);
harness.rejects(
	"case is NOT a synonym: --vectorize=True is refused, naming 'True'",
	booleanRefusal(asValue(['True'])),
	/--vectorize='True'/,
);
harness.rejects(
	'--vectorize with NO value (qtools hands back the boolean true, not an array) is refused',
	booleanRefusal(asValue(true)),
	/--vectorize was given with no value/,
);
harness.rejects(
	'-vectorize (single hyphen) lands in switches and is refused, not silently unseen',
	booleanRefusal({ values: {}, switches: { vectorize: true } }),
	/'-vectorize' is a switch spelling/,
);
harness.rejects(
	'--vectorize=true,false (qtools splits commas) is refused rather than resolved to one of them',
	booleanRefusal(asValue(['true', 'false'])),
	/--vectorize was given 2 values \('true', 'false'\)/,
);
harness.equal(
	'a VALID --vectorize=true is honoured as TRUE — the positive control, ON direction',
	readBoolean(asValue(['true'])).value,
	true,
);
harness.equal(
	'a VALID --vectorize=false is honoured as FALSE — the positive control, OFF direction',
	readBoolean(asValue(['false'])).value,
	false,
);
harness.rejects(
	'the helper holds ITSELF to §6: an omitted name argument is refused, not defaulted',
	(() => {
		let messages = [];
		try {
			require('../../../test/testLib/require-boolean-value').requireBooleanValue({
				commandLineParameters: { values: {}, switches: {} },
				moduleName: 'someEntryPoint',
				whatItControls: 'something',
			});
		} catch (error) {
			messages = [error.message];
		}
		return messages;
	})(),
	/requireBooleanValue.*name/s,
);

harness.report();
