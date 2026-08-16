'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// pluginRegistry.js — the plugin registry: DATA, built by DISCOVERY (SPEC-bridgeFramework-v1.md §9; RULINGS
// A2, D-S8; BR-003, BR-004). Built ONCE at seam-face construction over the convention
// forges/<standardKey>/bridges/*.js and validated then — BEFORE any forge is spent. Each file exports
// { bridgeDeclaration, bridgeHooks }; the registry KEY is bridgeDeclaration.bridgeName; the registry is frozen
// data entryByBridgeName[bridgeName] = { bridgeName, standardKey, bundleDirPath, pluginFilePath, bridgeDeclaration,
// bridgeHooks, channelResolutionByKey, declarationDigest }.
//
// Refusals, all by name, all at construction: a duplicate bridgeName (both paths named); a plugin whose
// standardKey ≠ its directory; a file under bridges/ that does not export the two names (a STRAY file is a
// REFUSAL, not an ignored file — "declared-but-broken refuses every build"); any declaration/hook drift; the
// forbidden-substrate scan. bridges/lib/ subdirectories are NOT scanned (only bridges/*.js), so a plugin may
// keep helpers beside itself (D-S8). At run: an unregistered spec.bridge → refused LISTING the registered
// names; a registered plugin whose standardKey ≠ spec.source → refused.
//
//   registerPlugin({ pluginModule, pluginFilePath, bundleDirPath })   → { entry } | { error }   (pure save the header read)
//   buildRegistryFromDirectory({ forgesDirPath })                    → frozen { entryByBridgeName, pluginFilePathList } | THROWS
//   lookupPlugin({ registry, bridgeName, standardKey })              → { entry } | { error }

const fs = require('fs');
const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const bridgePluginContractLib = require('./bridgePluginContract');

const BRIDGES_DIR_NAME = 'bridges';
const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);

const registerPlugin = ({ pluginModule, pluginFilePath, bundleDirPath } = {}) => {
	if (!isPlainObject(pluginModule) || !Object.prototype.hasOwnProperty.call(pluginModule, 'bridgeDeclaration') || !Object.prototype.hasOwnProperty.call(pluginModule, 'bridgeHooks')) {
		return { error: refuse.byName({ moduleName, what: `plugin file ${pluginFilePath} does not export { bridgeDeclaration, bridgeHooks }`, where: 'a stray or non-conforming file under bridges/ is a REFUSAL, not an ignored file (D-S8)' }) };
	}
	const validated = bridgePluginContractLib.validateBridgeDeclaration({ bridgeDeclaration: pluginModule.bridgeDeclaration, bundleDirPath });
	if (validated.error) {
		return { error: new Error(`${validated.error.message} [plugin ${pluginFilePath}]`) };
	}
	const hookError = bridgePluginContractLib.validateBridgeHooks({ bridgeHooks: pluginModule.bridgeHooks, bridgeDeclaration: pluginModule.bridgeDeclaration });
	if (hookError) {
		return { error: new Error(`${hookError.message} [plugin ${pluginFilePath}]`) };
	}
	const substrateReason = bridgePluginContractLib.forbiddenSubstrateReason({ pluginFilePath });
	if (substrateReason) {
		return { error: refuse.byName({ moduleName, what: substrateReason, where: 'a plugin declares assertions; it never reaches a driver, a store, a judge or an embedder' }) };
	}
	const expectedStandardKey = path.basename(path.dirname(path.dirname(pluginFilePath)));
	if (pluginModule.bridgeDeclaration.standardKey !== expectedStandardKey) {
		return { error: refuse.byName({ moduleName, what: `plugin ${pluginFilePath} declares standardKey '${pluginModule.bridgeDeclaration.standardKey}' but sits under bundle '${expectedStandardKey}'`, where: 'standardKey MUST equal the bundle directory (BR-009)' }) };
	}
	const declarationDigest = bridgePluginContractLib.canonicalJsonText(pluginModule.bridgeDeclaration);
	return {
		entry: Object.freeze({
			bridgeName: pluginModule.bridgeDeclaration.bridgeName,
			standardKey: pluginModule.bridgeDeclaration.standardKey,
			bundleDirPath,
			pluginFilePath,
			bridgeDeclaration: pluginModule.bridgeDeclaration,
			bridgeHooks: pluginModule.bridgeHooks,
			channelResolutionByKey: validated.channelResolutionByKey,
			declarationCanonicalText: declarationDigest,
		}),
	};
};

// buildRegistryFromDirectory — discovery over forges/<standardKey>/bridges/*.js; THROWS by name on any refusal
const buildRegistryFromDirectory = ({ forgesDirPath, requireModule } = {}) => {
	if (typeof forgesDirPath !== 'string' || !fs.existsSync(forgesDirPath) || !fs.statSync(forgesDirPath).isDirectory()) {
		throw refuse.byName({ moduleName, what: `forgesDirPath ${JSON.stringify(forgesDirPath)} is not a directory`, where: 'the seam face passes the tree\'s forges/ directory' });
	}
	const loadModule = typeof requireModule === 'function' ? requireModule : (oneFilePath) => require(oneFilePath);
	const entryByBridgeName = {};
	const pluginFilePathList = [];
	const bundleNameList = fs
		.readdirSync(forgesDirPath, { withFileTypes: true })
		.filter((oneEntry) => oneEntry.isDirectory())
		.map((oneEntry) => oneEntry.name)
		.sort();
	bundleNameList.forEach((oneBundleName) => {
		const bundleDirPath = path.join(forgesDirPath, oneBundleName);
		const bridgesDirPath = path.join(bundleDirPath, BRIDGES_DIR_NAME);
		if (!fs.existsSync(bridgesDirPath) || !fs.statSync(bridgesDirPath).isDirectory()) {
			return;
		}
		const fileNameList = fs
			.readdirSync(bridgesDirPath, { withFileTypes: true })
			.filter((oneEntry) => oneEntry.isFile() && /\.js$/.test(oneEntry.name))
			.map((oneEntry) => oneEntry.name)
			.sort();
		fileNameList.forEach((oneFileName) => {
			const pluginFilePath = path.join(bridgesDirPath, oneFileName);
			pluginFilePathList.push(pluginFilePath);
			const registered = registerPlugin({ pluginModule: loadModule(pluginFilePath), pluginFilePath, bundleDirPath });
			if (registered.error) {
				throw registered.error;
			}
			const existing = entryByBridgeName[registered.entry.bridgeName];
			if (existing !== undefined) {
				throw refuse.byName({ moduleName, what: `bridgeName '${registered.entry.bridgeName}' is declared by TWO plugin files: ${existing.pluginFilePath} and ${pluginFilePath}`, where: 'the registry key is unique; rename one' });
			}
			entryByBridgeName[registered.entry.bridgeName] = registered.entry;
		});
	});
	return Object.freeze({ entryByBridgeName: Object.freeze(entryByBridgeName), pluginFilePathList: Object.freeze(pluginFilePathList), forgesDirPath });
};

const registeredNameText = (registry) => {
	const nameList = Object.keys(registry.entryByBridgeName).sort();
	return nameList.length ? nameList.join(', ') : '(none registered)';
};

// lookupPlugin — the run-time resolution: refuses an unregistered name (listing the registered) and a standardKey ≠ spec.source
const lookupPlugin = ({ registry, bridgeName, standardKey } = {}) => {
	if (!registry || !isPlainObject(registry.entryByBridgeName)) {
		return { error: refuse.byName({ moduleName, what: 'no registry', where: 'the framework factory receives pluginRegistry (the seam face builds it by discovery; a suite passes a fixture registry)' }) };
	}
	const entry = registry.entryByBridgeName[bridgeName];
	if (entry === undefined) {
		return { error: refuse.byName({ moduleName, what: `bridge '${bridgeName}' is REFUSED — no registered plugin declares it; registered names: ${registeredNameText(registry)}`, where: 'a recipe names a plugin under forges/<standardKey>/bridges/ by its bridgeName (BR-003); nothing is substituted' }) };
	}
	if (entry.standardKey !== standardKey) {
		return { error: refuse.byName({ moduleName, what: `bridge '${bridgeName}' is registered for standardKey '${entry.standardKey}' but the recipe pairing's source is '${standardKey}'`, where: 'a plugin runs only for the standard it sits under (BR-009)' }) };
	}
	return { entry };
};

module.exports = { registerPlugin, buildRegistryFromDirectory, lookupPlugin, registeredNameText, BRIDGES_DIR_NAME, moduleName };
