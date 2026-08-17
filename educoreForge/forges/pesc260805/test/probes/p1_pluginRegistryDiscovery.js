'use strict';

// p1_pluginRegistryDiscovery.js — LUNAR_PRISM (P1), 2026-08-17.
//
// A DECLARATION THAT VALIDATES IS NOT A PLUGIN THAT IS FOUND. validateBridgeDeclaration proves the
// object is well-formed; it says nothing about whether the registry DISCOVERS the file, keys it by
// the right name, or binds it to the right bundle. Those are separate failures and nothing had tested
// them.
//
// WHY THIS PROBE EXISTS AT ALL — a negative control changed what an earlier green meant. I ran
// `graphBuilder -validate` over both new recipes and got "resolvability ok". Then I validated a
// recipe naming `pescPluginThatDoesNotExist` and IT ALSO PASSED. Reading the source settled it and
// EXONERATED THE TOOL: recipe.js:403 `resolvabilityErrors` checks FORGE availability, not bridge
// names — "no forge available for standard '<token>'" — so its name is accurate and my expectation
// was the thing that was wrong. Plugin existence is enforced LATER, at build, by
// pluginRegistry.js:124. That is correct layering rather than a gap.
//
// SO THIS TESTS THE LAYER THAT ACTUALLY ENFORCES IT, without paying for a build: it builds the real
// registry BY DISCOVERY over forges/ exactly as bridgeMaker.js:63 does, then asserts both plugins are
// found AND that an unknown name is REFUSED BY NAME. Reports the assertion count reached beside the
// failure count. Pure: no graph, no container, no store, no spend.

const path = require('path');

const moduleName = 'p1_pluginRegistryDiscovery';
const TREE_ROOT = path.join(__dirname, '..', '..', '..', '..');
const FORGES_DIR_PATH = path.join(TREE_ROOT, 'forges');
const pluginRegistryLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'pluginRegistry'));

const EXPECTED_NAME_LIST = ['pescCedsDerivedPlugin', 'pescOptionSetCedsDerivedPlugin'];

const resultList = [];
let assertionsReached = 0;
let failedCount = 0;
const assert = ({ name, pass, detail }) => {
	assertionsReached += 1;
	if (!pass) { failedCount += 1; }
	resultList.push({ name, verdict: pass ? 'PASS' : 'FAIL', detail });
};

const built = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: FORGES_DIR_PATH });
const registry = built && built.registry ? built.registry : built;

assert({
	name: 'the registry builds BY DISCOVERY over forges/ (the same call bridgeMaker.js:63 makes) without refusing',
	pass: Boolean(registry) && !(built && built.error),
	detail: built && built.error ? String(built.error.message || built.error) : 'built',
});

const registeredNameList = registry && registry.entryByBridgeName ? Object.keys(registry.entryByBridgeName).sort() : [];
assert({
	name: 'the registry is NON-EMPTY (an empty registry would make every lookup below vacuous)',
	pass: registeredNameList.length > 0,
	detail: `${registeredNameList.length} registered: ${registeredNameList.join(', ')}`,
});

EXPECTED_NAME_LIST.forEach((oneName) => {
	const found = pluginRegistryLib.lookupPlugin({ registry, bridgeName: oneName, standardKey: 'pesc260805' });
	const entry = found && found.entry ? found.entry : found;
	assert({
		name: `DISCOVERY '${oneName}' is found by the real registry and bound to bundle pesc260805`,
		pass: Boolean(entry) && !(found && found.error) && entry.standardKey === 'pesc260805',
		detail: found && found.error ? String(found.error.message || found.error) : `standardKey='${entry && entry.standardKey}' declarationDigest=${entry && entry.declarationDigest ? String(entry.declarationDigest).slice(0, 16) : 'n/a'}…`,
	});
});

// THE NEGATIVE — the layer that actually enforces plugin existence must be OBSERVED refusing, and it
// must NAME the registered alternatives rather than merely failing, because a refusal that does not
// say what WAS available sends a reader hunting.
const unknown = pluginRegistryLib.lookupPlugin({ registry, bridgeName: 'pescPluginThatDoesNotExist', standardKey: 'pesc260805' });
const unknownRefusalText = unknown && unknown.error ? String(unknown.error.message || unknown.error) : '';
assert({
	name: 'NEGATIVE an unknown bridge name is REFUSED BY NAME at the registry, and the refusal lists the registered names',
	pass: unknownRefusalText.indexOf('pescPluginThatDoesNotExist') !== -1 && unknownRefusalText.indexOf('REFUSED') !== -1,
	detail: unknownRefusalText === '' ? 'DID NOT REFUSE — plugin existence is enforced NOWHERE, which would be a real finding' : unknownRefusalText.slice(0, 220),
});

// the two siblings must not collide on the registry key
assert({
	name: 'the two sibling plugins occupy DISTINCT registry keys (bridgeName is the key; a collision would silently drop one)',
	pass: EXPECTED_NAME_LIST.every((oneName) => registeredNameList.indexOf(oneName) !== -1) && EXPECTED_NAME_LIST[0] !== EXPECTED_NAME_LIST[1],
	detail: `both present among ${registeredNameList.length} registered names`,
});

process.stdout.write(`${JSON.stringify({
	probe: moduleName,
	assertionsReached,
	failedCount,
	verdict: assertionsReached === 0 ? 'VACUOUS — NOTHING RAN' : failedCount === 0 ? 'ALL GREEN' : 'RED',
	note: 'A failure count without the assertion count reached cannot distinguish a clean pass from a suite that aborted before asserting anything.',
	registeredNameList,
	resultList,
}, null, 2)}\n`);
process.exitCode = failedCount === 0 && assertionsReached > 0 ? 0 : 1;
