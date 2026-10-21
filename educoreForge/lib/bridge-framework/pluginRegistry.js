'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// pluginRegistry.js — the plugin registry: DATA, built by DISCOVERY (SPEC-bridgeFramework-v1.md §9; RULINGS
// A2, D-S8; BR-003, BR-004). Built ONCE at seam-face construction over the convention
// forges/<standardKey>/bridges/*.js and validated then — BEFORE any forge is spent. Each file exports
// { bridgeDeclaration, bridgeHooks, bridgeTarget } (⟪ctdlHub P5⟫ bridgeTarget: the hub it maps toward, a sibling export kept
// OUT of the content-addressed declaration); the registry KEY is bridgeDeclaration.bridgeName; the registry is frozen
// data entryByBridgeName[bridgeName] = { bridgeName, standardKey, bundleDirPath, pluginFilePath, bridgeDeclaration,
// bridgeHooks, targetHub, channelResolutionByKey, declarationDigest }.
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
//   registerStructuralProducer({ producerModule, producerFilePath, bundleDirPath }) → { entry } | { error }
//   lookupStructuralProducer({ registry, producerName, standardKey }) → { entry } | { error }
//
// ⟪ctdlHub P6, ruling R-3⟫ A SECOND MODULE SHAPE: a file under bridges/ exporting EXACTLY { structuralDeclaration } is a STRUCTURAL
// producer (structuralProducerContract.js), registered into its OWN map, structuralEntryByName, never into entryByBridgeName: every
// reader of entryByBridgeName (the conflict detector, describeBridge, the framework's run) reads a bridgeDeclaration, which a
// structural producer does not have. A name is unique across BOTH maps. Any other export set is still a stray file, refused.

const fs = require('fs');
const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const bridgePluginContractLib = require('./bridgePluginContract');
const structuralProducerContractLib = require('./structuralProducerContract');
// ⟪hub-neutral bridge lane R3, 2026-10-21⟫ the THIRD module shape: a standard bridging file, composed with each paired hub's
// bridging declaration into ordinary plugin modules (bridgeComposer.js), each then registered exactly as a plugin file is
const bridgeComposerLib = require('./bridgeComposer');
const hubBridgingLoaderLib = require('./hubBridgingLoader');

const BRIDGES_DIR_NAME = 'bridges';
const STANDARD_BRIDGING_EXPORT_NAME = 'standardBridging';
const STANDARD_BRIDGING_EXPORT_NAME_LIST = Object.freeze([STANDARD_BRIDGING_EXPORT_NAME, 'bridgeHooksByFacetName']);
const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);

const registerPlugin = ({ pluginModule, pluginFilePath, bundleDirPath } = {}) => {
	if (!isPlainObject(pluginModule) || ['bridgeDeclaration', 'bridgeHooks', 'bridgeTarget'].some((exportName) => !Object.prototype.hasOwnProperty.call(pluginModule, exportName))) {
		return { error: refuse.byName({ moduleName, what: `plugin file ${pluginFilePath} does not export { bridgeDeclaration, bridgeHooks, bridgeTarget }`, where: 'a stray or non-conforming file under bridges/ is a REFUSAL, not an ignored file (D-S8)' }) };
	}
	const targetError = bridgePluginContractLib.validateBridgeTarget({ bridgeTarget: pluginModule.bridgeTarget });
	if (targetError) {
		return { error: new Error(`${targetError.message} [plugin ${pluginFilePath}]`) };
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
	const declarationCanonicalText = bridgePluginContractLib.canonicalJsonText(pluginModule.bridgeDeclaration);
	return {
		entry: Object.freeze({
			bridgeName: pluginModule.bridgeDeclaration.bridgeName,
			standardKey: pluginModule.bridgeDeclaration.standardKey,
			bundleDirPath,
			pluginFilePath,
			bridgeDeclaration: pluginModule.bridgeDeclaration,
			bridgeHooks: pluginModule.bridgeHooks,
			targetHub: pluginModule.bridgeTarget.targetHub,
			channelResolutionByKey: validated.channelResolutionByKey,
			declarationCanonicalText,
		}),
	};
};

// registerStructuralProducer — the second shape: exactly { structuralDeclaration }, validated, its locator table read and checked
const registerStructuralProducer = ({ producerModule, producerFilePath, bundleDirPath } = {}) => {
	const exportNameList = isPlainObject(producerModule) ? Object.keys(producerModule) : [];
	if (exportNameList.length !== 1 || exportNameList[0] !== 'structuralDeclaration') {
		return { error: refuse.byName({ moduleName, what: `structural producer file ${producerFilePath} exports [${exportNameList.join(', ')}], not exactly { structuralDeclaration }`, where: 'a structural producer is pure data; the algorithm is the framework\'s (structuralRunner.js)' }) };
	}
	const validated = structuralProducerContractLib.validateStructuralDeclaration({ structuralDeclaration: producerModule.structuralDeclaration, bundleDirPath });
	if (validated.error) {
		return { error: new Error(`${validated.error.message} [structural producer ${producerFilePath}]`) };
	}
	const expectedStandardKey = path.basename(path.dirname(path.dirname(producerFilePath)));
	if (producerModule.structuralDeclaration.standardKey !== expectedStandardKey) {
		return { error: refuse.byName({ moduleName, what: `structural producer ${producerFilePath} declares standardKey '${producerModule.structuralDeclaration.standardKey}' but sits under bundle '${expectedStandardKey}'`, where: 'standardKey MUST equal the bundle directory (BR-009)' }) };
	}
	return {
		entry: Object.freeze({
			producerName: producerModule.structuralDeclaration.producerName,
			standardKey: producerModule.structuralDeclaration.standardKey,
			bundleDirPath,
			producerFilePath,
			structuralDeclaration: producerModule.structuralDeclaration,
			locatorTable: validated.locatorTable,
			locatorTableFilePath: validated.locatorTableFilePath,
		}),
	};
};

// buildRegistryFromDirectory — discovery over forges/<standardKey>/bridges/*.js; THROWS by name on any refusal
const buildRegistryFromDirectory = ({ forgesDirPath, requireModule } = {}) => {
	if (typeof forgesDirPath !== 'string' || !fs.existsSync(forgesDirPath) || !fs.statSync(forgesDirPath).isDirectory()) {
		throw refuse.byName({ moduleName, what: `forgesDirPath ${JSON.stringify(forgesDirPath)} is not a directory`, where: 'the seam face passes the tree\'s forges/ directory' });
	}
	const loadModule = typeof requireModule === 'function' ? requireModule : (oneFilePath) => require(oneFilePath);
	// each paired hub's bridging declaration, loaded once per registry by the hub bundle's declared location
	const hubBridgingByToken = {};
	const hubBridgingFor = (hubToken) => {
		if (hubBridgingByToken[hubToken] === undefined) {
			const loaded = hubBridgingLoaderLib.loadHubBridging({ forgesDirPath, hubToken });
			if (loaded.error) {
				throw loaded.error;
			}
			hubBridgingByToken[hubToken] = loaded.hubBridging;
		}
		return hubBridgingByToken[hubToken];
	};
	const composedPluginModuleListFor = ({ bridgingModule, bridgingFilePath, bundleName }) => {
		const exportNameList = Object.keys(bridgingModule).sort();
		if (exportNameList.join(',') !== STANDARD_BRIDGING_EXPORT_NAME_LIST.slice().sort().join(',')) {
			throw refuse.byName({ moduleName, what: `standard bridging file ${bridgingFilePath} exports [${exportNameList.join(', ')}], not exactly { ${STANDARD_BRIDGING_EXPORT_NAME_LIST.join(', ')} }`, where: 'a standard bridging file is its declaration plus its hooks' });
		}
		const standardBridging = bridgingModule[STANDARD_BRIDGING_EXPORT_NAME];
		const pairedHubTokenList = Array.isArray(standardBridging && standardBridging.facetList)
			? Array.from(new Set([].concat(...standardBridging.facetList.map((oneFacet) => Object.keys((oneFacet && oneFacet.pairByHubToken) || {}))))).sort()
			: [];
		const composed = bridgeComposerLib.composePluginModuleList({
			standardBridging,
			bridgeHooksByFacetName: bridgingModule.bridgeHooksByFacetName,
			hubBridgingByToken: pairedHubTokenList.reduce((soFar, hubToken) => Object.assign(soFar, { [hubToken]: hubBridgingFor(hubToken) }), {}),
			bundleDirName: bundleName,
		});
		if (composed.error) {
			throw new Error(`${composed.error.message} [standard bridging file ${bridgingFilePath}]`);
		}
		return composed.pluginModuleList;
	};
	const entryByBridgeName = {};
	const structuralEntryByName = {};
	const pluginFilePathList = [];
	const structuralProducerFilePathList = [];
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
			// the forbidden-substrate scan runs on the FILE TEXT before the file is loaded: a plugin that requires a
			// driver is refused by name, never executed (its require would otherwise run — or throw for its own reason)
			const substrateReason = bridgePluginContractLib.forbiddenSubstrateReason({ pluginFilePath });
			if (substrateReason) {
				throw refuse.byName({ moduleName, what: substrateReason, where: 'a plugin declares assertions; it never reaches a driver, a store, a judge or an embedder' });
			}
			// ⟪ctdlHub P6⟫ the second shape, told apart by its one export (require is cached, so the plugin path below loads the same
			// module); its name is unique across both maps, and its file is listed apart from the plugin files
			const candidateModule = loadModule(pluginFilePath);
			if (isPlainObject(candidateModule) && Object.prototype.hasOwnProperty.call(candidateModule, 'structuralDeclaration')) {
				pluginFilePathList.pop();
				structuralProducerFilePathList.push(pluginFilePath);
				const registeredProducer = registerStructuralProducer({ producerModule: candidateModule, producerFilePath: pluginFilePath, bundleDirPath });
				if (registeredProducer.error) {
					throw registeredProducer.error;
				}
				const clashing = structuralEntryByName[registeredProducer.entry.producerName] || entryByBridgeName[registeredProducer.entry.producerName];
				if (clashing !== undefined) {
					throw refuse.byName({ moduleName, what: `name '${registeredProducer.entry.producerName}' is declared by TWO files: ${clashing.pluginFilePath || clashing.producerFilePath} and ${pluginFilePath}`, where: 'a bridge name is unique across plugins and structural producers' });
				}
				structuralEntryByName[registeredProducer.entry.producerName] = registeredProducer.entry;
				return;
			}
			// ⟪hub-neutral bridge lane R3⟫ a standard bridging file composes one plugin module per (facet, paired hub); every one
			// passes the SAME registration below as a plugin file's module, and names the bridging file as its pluginFilePath
			const pluginModuleList = isPlainObject(candidateModule) && Object.prototype.hasOwnProperty.call(candidateModule, STANDARD_BRIDGING_EXPORT_NAME)
				? composedPluginModuleListFor({ bridgingModule: candidateModule, bridgingFilePath: pluginFilePath, bundleName: oneBundleName })
				: [loadModule(pluginFilePath)];
			pluginModuleList.forEach((onePluginModule) => {
				const registered = registerPlugin({ pluginModule: onePluginModule, pluginFilePath, bundleDirPath });
				if (registered.error) {
					throw registered.error;
				}
				if (structuralEntryByName[registered.entry.bridgeName] !== undefined) {
					throw refuse.byName({ moduleName, what: `name '${registered.entry.bridgeName}' is declared by TWO files: ${structuralEntryByName[registered.entry.bridgeName].producerFilePath} and ${pluginFilePath}`, where: 'a bridge name is unique across plugins and structural producers' });
				}
				const existing = entryByBridgeName[registered.entry.bridgeName];
				if (existing !== undefined) {
					throw refuse.byName({ moduleName, what: `bridgeName '${registered.entry.bridgeName}' is declared by TWO plugin files: ${existing.pluginFilePath} and ${pluginFilePath}`, where: 'the registry key is unique; rename one' });
				}
				entryByBridgeName[registered.entry.bridgeName] = registered.entry;
			});
		});
	});
	return Object.freeze({ entryByBridgeName: Object.freeze(entryByBridgeName), structuralEntryByName: Object.freeze(structuralEntryByName), pluginFilePathList: Object.freeze(pluginFilePathList), structuralProducerFilePathList: Object.freeze(structuralProducerFilePathList), forgesDirPath });
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

// lookupStructuralProducer — the run-time resolution of a structural producer, refusing an unregistered name and a wrong source
const lookupStructuralProducer = ({ registry, producerName, standardKey } = {}) => {
	const producerEntry = registry && isPlainObject(registry.structuralEntryByName) ? registry.structuralEntryByName[producerName] : undefined;
	if (producerEntry === undefined) {
		return { error: refuse.byName({ moduleName, what: `structural producer '${producerName}' is not registered`, where: 'a structural producer is a file under forges/<standardKey>/bridges/ exporting { structuralDeclaration }' }) };
	}
	if (producerEntry.standardKey !== standardKey) {
		return { error: refuse.byName({ moduleName, what: `structural producer '${producerName}' is registered for standardKey '${producerEntry.standardKey}' but the recipe's source is '${standardKey}'`, where: 'a producer runs only for the standard it sits under (BR-009)' }) };
	}
	return { entry: producerEntry };
};

module.exports = { registerPlugin, registerStructuralProducer, buildRegistryFromDirectory, lookupPlugin, lookupStructuralProducer, registeredNameText, BRIDGES_DIR_NAME, moduleName };
