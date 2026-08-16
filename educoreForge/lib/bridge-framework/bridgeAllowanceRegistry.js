'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// bridgeAllowanceRegistry.js — BRIDGE_ALLOWANCE_REGISTRY, EMPTY in v1 (SPEC-bridgeFramework-v1.md §4.1
// compatibilityDeclarationList; RULING D-S2; mirrors lib/forge-framework/migrationAllowanceRegistry.js).
// Nothing pre-existing must be reproduced by a bridge plugin, so no row exists; the KEY and the validator
// exist so the mechanism is the forge framework's, not a later bolt-on. A NON-EMPTY
// compatibilityDeclarationList is refused by name (there is no row it could name).

const BRIDGE_ALLOWANCE_REGISTRY = Object.freeze({});
const BRIDGE_ALLOWANCE_ID_LIST = Object.freeze(Object.keys(BRIDGE_ALLOWANCE_REGISTRY));

// allowanceListReason(list) → '' | reason
const allowanceListReason = (compatibilityDeclarationList) => {
	if (!Array.isArray(compatibilityDeclarationList)) {
		return `compatibilityDeclarationList must be a list (got ${JSON.stringify(compatibilityDeclarationList)})`;
	}
	if (compatibilityDeclarationList.length === 0) {
		return '';
	}
	const firstEntry = compatibilityDeclarationList[0];
	const allowanceId = firstEntry && typeof firstEntry === 'object' ? firstEntry.allowanceId : undefined;
	if (allowanceId === undefined || BRIDGE_ALLOWANCE_REGISTRY[allowanceId] === undefined) {
		return `compatibilityDeclarationList is non-empty (${compatibilityDeclarationList.length}) but BRIDGE_ALLOWANCE_REGISTRY has ${BRIDGE_ALLOWANCE_ID_LIST.length ? `rows ${BRIDGE_ALLOWANCE_ID_LIST.join(', ')}` : 'NO rows'} in v1 — a bridge plugin declares no allowance (${JSON.stringify(allowanceId)} is not a row)`;
	}
	return '';
};

module.exports = { BRIDGE_ALLOWANCE_REGISTRY, BRIDGE_ALLOWANCE_ID_LIST, allowanceListReason, moduleName };
