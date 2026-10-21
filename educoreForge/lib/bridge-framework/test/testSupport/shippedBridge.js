'use strict';

// shippedBridge.js — ⟪hub-neutral bridge lane R3, 2026-10-21⟫ a shipped bridge, read the way the build reads it: through the
// discovery registry over the tree's forges/. A bridge may be composed from a standard bridging file and its hub's declaration, so
// a suite that used to require a plugin FILE for its declaration asks for the bridge by NAME here instead. One registry per process.

const path = require('path');
const pluginRegistryLib = require(path.join(__dirname, '..', '..', 'pluginRegistry'));

const SHIPPED_FORGES_DIR_PATH = path.join(__dirname, '..', '..', '..', '..', 'forges');
let shippedRegistry = null;

const shippedBridgeEntryFor = (bridgeName) => {
	shippedRegistry = shippedRegistry === null ? pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: SHIPPED_FORGES_DIR_PATH }) : shippedRegistry;
	const entry = shippedRegistry.entryByBridgeName[bridgeName];
	if (entry === undefined) {
		throw new Error(`shippedBridge: no shipped bridge '${bridgeName}' (registered: ${Object.keys(shippedRegistry.entryByBridgeName).sort().join(', ')})`);
	}
	return entry;
};

// a fresh deep copy every call, so a suite may edit it
const shippedBridgeDeclarationFor = (bridgeName) => JSON.parse(JSON.stringify(shippedBridgeEntryFor(bridgeName).bridgeDeclaration));

module.exports = { shippedBridgeEntryFor, shippedBridgeDeclarationFor, SHIPPED_FORGES_DIR_PATH };
