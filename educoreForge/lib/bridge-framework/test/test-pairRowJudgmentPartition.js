#!/usr/bin/env node
'use strict';

// test-pairRowJudgmentPartition.js — zeroBacklog lane B (BRONZE_CROWN ruling 2026-10-23, from lane A's measurement): sif260928's
// judgmentPartition sits in its SHARED declarationTemplate, so the B3 sif260928→ctdl run was split into judgment units BY CEDS DOMAIN
// (5,017 subjects → 6,010 units): a CEDS structure shaping CTDL judging, the cross-hub leak the refactor exists to prevent. A pair row may
// now state its own judgmentPartition: an object overrides the template's for that pairing alone, null declares that the pairing has no
// partition, and a row that does not state it keeps the template's (so no existing pairing's declaration moves: P-a1).
// ⟪zeroBacklog A2-5, PEARL_CIPHER 2026-10-23 (BRONZE_CROWN grant)⟫ the shipped fixture moved: sif260928's partition now sits on its CEDS
// PAIR ROW and the template carries none. The partition of record is therefore the ceds row's; the inheritance case (a row that does not
// state it keeps the template's) is proved on a working copy that puts that partition back on the template and removes it from the row.
//
// PROVES:
//   (a) a pair row's judgmentPartition: null composes a declaration with NO judgmentPartition key, while its sibling row (not stating
//       one) keeps the template's, byte for byte
//   (b) a pair row's partition object overrides the template's for that pairing only
//   (c) a pair row whose judgmentPartition is neither null nor a partition declaration is refused by name
//   (a') a row that does not state one keeps the template's (working copy: the partition moved back onto the template)
//   (d) shipped: the template carries no partition; sif260928→ctdl composes with none; sif260928→ceds carries its row's (its digest is P-a1's)

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: a pair row may state its own judgmentPartition (null = none), overriding the shared template's
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const FORGES_DIR_PATH = path.join(TREE_ROOT, 'forges');
const bridgeComposerLib = require('../bridgeComposer');
const hubBridgingLoaderLib = require('../hubBridgingLoader');
const pluginRegistryLib = require('../pluginRegistry');
const { canonicalJsonText } = require('../bridgePluginContract');

const cloneJson = (value) => JSON.parse(JSON.stringify(value));
const hubBridgingByToken = ['ceds', 'ctdl'].reduce((soFar, hubToken) => ({ ...soFar, [hubToken]: hubBridgingLoaderLib.loadHubBridging({ forgesDirPath: FORGES_DIR_PATH, hubToken }).hubBridging }), {});
const sifModule = require(path.join(FORGES_DIR_PATH, 'sif260928', 'bridges', 'sif260928Bridging.js'));
const shippedFacet = sifModule.standardBridging.facetList[0];
const cedsRowPartition = shippedFacet.pairByHubToken.ceds.judgmentPartition;
harness.ok('the sif260928 ceds pair row carries a judgmentPartition (the fixture this suite rests on)', cedsRowPartition !== undefined && cedsRowPartition !== null);
harness.ok('the sif260928 template carries none (A2-5 moved it onto the ceds row)', !Object.prototype.hasOwnProperty.call(shippedFacet.declarationTemplate, 'judgmentPartition'));

// a working copy of the shipped bridging with the ctdl row's judgmentPartition set (or removed) as each case needs
const withCtdlRowPartition = (partitionValue) => {
	const standardBridging = cloneJson(sifModule.standardBridging);
	const ctdlRow = standardBridging.facetList[0].pairByHubToken.ctdl;
	if (partitionValue === undefined) {
		delete ctdlRow.judgmentPartition;
	} else {
		ctdlRow.judgmentPartition = partitionValue;
	}
	return standardBridging;
};
const composeByHub = (standardBridging) => {
	const composed = bridgeComposerLib.composePluginModuleList({ standardBridging, bridgeHooksByFacetName: sifModule.bridgeHooksByFacetName, hubBridgingByToken, bundleDirName: 'sif260928' });
	return composed.error ? { error: composed.error } : { declarationByHub: composed.pluginModuleList.reduce((soFar, onePluginModule) => ({ ...soFar, [onePluginModule.bridgeTarget.targetHub]: onePluginModule.bridgeDeclaration }), {}) };
};

harness.section('(a) null: this pairing has no partition; the sibling keeps the template\'s');
const nullComposed = composeByHub(withCtdlRowPartition(null));
harness.ok('the bridging composes', !nullComposed.error, nullComposed.error && nullComposed.error.message);
harness.ok('sif260928→ctdl carries no judgmentPartition key', !nullComposed.error && !Object.prototype.hasOwnProperty.call(nullComposed.declarationByHub.ctdl, 'judgmentPartition'));
harness.equal('sif260928→ceds keeps its row\'s partition, byte for byte', nullComposed.error ? 'not composed' : canonicalJsonText(nullComposed.declarationByHub.ceds.judgmentPartition), canonicalJsonText(cedsRowPartition));

harness.section('(a\') a row that does not state one keeps the template\'s');
const inheritingBridging = withCtdlRowPartition(null);
inheritingBridging.facetList[0].declarationTemplate.judgmentPartition = cloneJson(cedsRowPartition);
delete inheritingBridging.facetList[0].pairByHubToken.ceds.judgmentPartition;
const inheritingComposed = composeByHub(inheritingBridging);
harness.equal('sif260928→ceds, stating none, carries the template\'s partition, byte for byte', inheritingComposed.error ? inheritingComposed.error.message : canonicalJsonText(inheritingComposed.declarationByHub.ceds.judgmentPartition), canonicalJsonText(cedsRowPartition));
harness.ok('sif260928→ctdl, stating null, still carries no judgmentPartition key', !inheritingComposed.error && !Object.prototype.hasOwnProperty.call(inheritingComposed.declarationByHub.ctdl, 'judgmentPartition'));

harness.section('(b) an object overrides the template\'s for that pairing only');
const overridePartition = { ...cloneJson(cedsRowPartition), renderedPropertyName: 'overrideProbe' };
const overrideComposed = composeByHub(withCtdlRowPartition(overridePartition));
harness.equal('sif260928→ctdl carries the row\'s partition', overrideComposed.error ? overrideComposed.error.message : canonicalJsonText(overrideComposed.declarationByHub.ctdl.judgmentPartition), canonicalJsonText(overridePartition));
harness.equal('sif260928→ceds still carries its own row\'s', overrideComposed.error ? 'not composed' : canonicalJsonText(overrideComposed.declarationByHub.ceds.judgmentPartition), canonicalJsonText(cedsRowPartition));

harness.section('(c) a malformed value is refused by name');
const malformedComposed = composeByHub(withCtdlRowPartition('none'));
harness.match('a string in place of null or a partition is refused, naming judgmentPartition', String((malformedComposed.error || {}).message), /judgmentPartition/);

harness.section('(d) shipped');
const registry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: FORGES_DIR_PATH });
const shippedCtdl = registry.entryByBridgeName.sif260928CtdlDerivedPlugin;
const shippedCeds = registry.entryByBridgeName.sif260928CedsDerivedPlugin;
harness.ok('sif260928CtdlDerivedPlugin is judged with NO partition (no CEDS domain shapes its units)', shippedCtdl !== undefined && !Object.prototype.hasOwnProperty.call(shippedCtdl.bridgeDeclaration, 'judgmentPartition'));
harness.equal('sif260928CedsDerivedPlugin carries its ceds row\'s partition', shippedCeds === undefined ? 'not registered' : canonicalJsonText(shippedCeds.bridgeDeclaration.judgmentPartition), canonicalJsonText(cedsRowPartition));

harness.report();
