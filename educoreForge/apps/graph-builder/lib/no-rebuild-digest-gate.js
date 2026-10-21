'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// no-rebuild-digest-gate.js — P-a1 of the R0 proof kit (2026-10-21, step 5): without a graph and without a build, would every
// mapping bridge of a recipe MATERIALISE from the frozen decision blocks of its baseline store? A plain build looks a block up
// by pairKey and refuses it when the run's declarationDigest differs from the frozen one (bridge-framework materialise, BG-REPLAY
// f), and a pairKey it cannot find yields zero edges (trap T1). This gate answers both questions per bridge, from:
//   the registry the build uses (pluginRegistry.buildRegistryFromDirectory over forges/), its declarationCanonicalText digested
//   exactly as the framework digests it; the versions phase A resolves (forger.getVersionStamp → build.explicitVersionFrom);
//   the pairKey composed by frozenDecisionBlockRule.pairKeyFor; and the frozen headers of the baseline decision store.
//
//   digestGateFor({ recipe, registry, versionByToken, frozenHeaderByPairKey }) → { rowList, passed }
//     recipe                 the recipe object (its bridges[])
//     registry               { entryByBridgeName, structuralEntryByName } as pluginRegistry builds it
//     versionByToken         { <token>: <resolved version> } for every standard the recipe names
//     frozenHeaderByPairKey  block-compare.latestFrozenHeaderByPairKey(...).headerByPairKey
//   one row per recipe bridge, verdict:
//     PASS                   the pairKey is frozen and its declarationDigest equals the composed declaration's
//     PAIRKEY_ABSENT         nothing frozen under the composed pairKey (a plain build would yield zero edges)
//     DIGEST_DIFFERS         frozen, but the declaration moved (a plain build would refuse, "re-judge required")
//     NOT_REGISTERED         the registry has no plugin of that name for that source
//     STRUCTURAL             a hubless structural producer: registered, and it has no decision block by construction

const crypto = require('crypto');
const path = require('path');
const frozenDecisionBlockRuleLib = require(path.join(__dirname, 'frozenDecisionBlockRule'));

const VERDICT_PASS = 'PASS';
const VERDICT_PAIRKEY_ABSENT = 'PAIRKEY_ABSENT';
const VERDICT_DIGEST_DIFFERS = 'DIGEST_DIFFERS';
const VERDICT_NOT_REGISTERED = 'NOT_REGISTERED';
const VERDICT_STRUCTURAL = 'STRUCTURAL';
const PASSING_VERDICT_LIST = Object.freeze([VERDICT_PASS, VERDICT_STRUCTURAL]);

const sha256Hex = (text) => crypto.createHash('sha256').update(text).digest('hex');

const rowForBridge = ({ bridge, registry, versionByToken, frozenHeaderByPairKey }) => {
	const identity = { bridgeName: bridge.bridge, source: bridge.source, hub: bridge.hub };
	if (bridge.hub === undefined) {
		const structuralEntry = registry.structuralEntryByName[bridge.bridge];
		return structuralEntry !== undefined && structuralEntry.standardKey === bridge.source ? { ...identity, verdict: VERDICT_STRUCTURAL } : { ...identity, verdict: VERDICT_NOT_REGISTERED };
	}
	const entry = registry.entryByBridgeName[bridge.bridge];
	if (entry === undefined || entry.standardKey !== bridge.source) {
		return { ...identity, verdict: VERDICT_NOT_REGISTERED };
	}
	const declaration = entry.bridgeDeclaration;
	const pairKey = frozenDecisionBlockRuleLib.pairKeyFor({
		hubToken: bridge.hub,
		hubVersion: versionByToken[bridge.hub],
		sourceToken: bridge.source,
		sourceVersion: versionByToken[bridge.source],
		bridgeName: declaration.bridgeName,
		producerKind: declaration.producerKind,
	});
	const composedDigest = sha256Hex(entry.declarationCanonicalText);
	const frozen = frozenHeaderByPairKey[pairKey];
	if (frozen === undefined) {
		return { ...identity, pairKey, verdict: VERDICT_PAIRKEY_ABSENT, composedDigest };
	}
	const frozenDigest = frozen.header.declarationDigest;
	return { ...identity, pairKey, verdict: frozenDigest === composedDigest ? VERDICT_PASS : VERDICT_DIGEST_DIFFERS, composedDigest, frozenDigest, decisionBlockHash: frozen.decisionBlockHash };
};

const digestGateFor = ({ recipe, registry, versionByToken, frozenHeaderByPairKey }) => {
	const rowList = recipe.bridges.map((bridge) => rowForBridge({ bridge, registry, versionByToken, frozenHeaderByPairKey }));
	return { rowList, passed: rowList.length > 0 && rowList.every((oneRow) => PASSING_VERDICT_LIST.indexOf(oneRow.verdict) !== -1) };
};

module.exports = {
	digestGateFor,
	VERDICT_PASS,
	VERDICT_PAIRKEY_ABSENT,
	VERDICT_DIGEST_DIFFERS,
	VERDICT_NOT_REGISTERED,
	VERDICT_STRUCTURAL,
	moduleName,
};
