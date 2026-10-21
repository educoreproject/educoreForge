#!/usr/bin/env node
'use strict';

// test-frozenDecisionBlockRule.js — gate for trap T1 (R0 proof kit, 2026-10-21, step 8): a plain build that finds no frozen
// decision block for a pairing logs one line and yields ZERO edges, which would let a bad migration (a renamed bridge, a moved
// plugin) look like a clean one. In a recipe whose kind REQUIRES frozen blocks (RECIPE_KIND_RULE, golden), a mapping bridge
// with no frozen block and no --rebridge in scope is now REFUSED by name; a dev recipe keeps today's status line.
//
// PROVES (pure rule, apps/graph-builder/lib/frozenDecisionBlockRule.js):
//   (a) golden + mapping bridge + not in --rebridge scope + no frozen block → refused: "no frozen decision block for
//       <pairKey> in golden recipe <name>"
//   (b) not refused: a dev or subset recipe; a pair IN the --rebridge scope; a frozen block present; a structural (hubless)
//       pairing, which has no decision block by construction
//   (c) RECIPE_KIND_RULE states frozenDecisionBlockRequired for EVERY kind (no kind is left to a default)
//   (d) pairKeyFor composes the key the framework looks up: the framework's inline
//       template is pinned to it
// The wiring through build() is gated in test-build.js (stage FROZEN BLOCK REQUIRED).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: a golden recipe refuses a bridge with no frozen decision block (trap T1)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');

const frozenDecisionBlockRuleLib = require('../lib/frozenDecisionBlockRule');
const recipeLib = require('../lib/recipe')();

const PAIR_KEY = 'hubx@1.0::toy@2.0::toyDerivedPlugin::inferred';
const MAPPING_BRIDGE = { source: 'toy', hub: 'hubx', bridge: 'toyDerivedPlugin' };
const STRUCTURAL_BRIDGE = { source: 'toy', pairWith: 'toy2', bridge: 'toyStructure' };
const NO_BLOCK_REPORT = { decisionBlock: null, producer: 'inferred' };
const BLOCK_REPORT = { decisionBlock: { decisionBlockHash: 'f'.repeat(64), pairKey: PAIR_KEY }, producer: 'inferred' };
const refusalFor = (overrideByName) => frozenDecisionBlockRuleLib.refusalFor({
	recipeName: 'toyGold',
	recipeKind: 'golden',
	kindRule: recipeLib.RECIPE_KIND_RULE.golden,
	bridge: MAPPING_BRIDGE,
	pairRebridges: false,
	runReport: NO_BLOCK_REPORT,
	pairKey: PAIR_KEY,
	...overrideByName,
});

harness.section('(a) golden, mapping, not rebridged, no frozen block → refused by name');
harness.equal('the refusal names the pairKey and the recipe', refusalFor({}), `no frozen decision block for ${PAIR_KEY} in golden recipe toyGold — a golden recipe materialises every mapping bridge from a frozen block; a missing one would yield zero edges silently (a renamed or moved bridge looks clean). Freeze it with --rebridge=<source>, or correct the bridge name`);

harness.section('(b) not refused');
harness.equal('a dev recipe keeps the status line', refusalFor({ recipeKind: 'dev', kindRule: recipeLib.RECIPE_KIND_RULE.dev }), '');
harness.equal('a subset recipe keeps the status line', refusalFor({ recipeKind: 'subset', kindRule: recipeLib.RECIPE_KIND_RULE.subset }), '');
harness.equal('a pair in the --rebridge scope', refusalFor({ pairRebridges: true }), '');
harness.equal('a frozen block present', refusalFor({ runReport: BLOCK_REPORT }), '');
harness.equal('a structural (hubless) pairing', refusalFor({ bridge: STRUCTURAL_BRIDGE }), '');

harness.section('(c) every recipe kind states the rule');
const kindNameList = Object.keys(recipeLib.RECIPE_KIND_RULE);
harness.equal('frozenDecisionBlockRequired is a boolean on every kind row', kindNameList.filter((kindName) => typeof recipeLib.RECIPE_KIND_RULE[kindName].frozenDecisionBlockRequired !== 'boolean').join(','), '');
harness.equal('only golden requires frozen blocks', kindNameList.filter((kindName) => recipeLib.RECIPE_KIND_RULE[kindName].frozenDecisionBlockRequired).join(','), 'golden');

harness.section('(d) one pairKey composition');
harness.equal('pairKeyFor composes hub@ver::source@ver::bridgeName::producerKind', frozenDecisionBlockRuleLib.pairKeyFor({ hubToken: 'hubx', hubVersion: '1.0', sourceToken: 'toy', sourceVersion: '2.0', bridgeName: 'toyDerivedPlugin', producerKind: 'inferred' }), PAIR_KEY);
const frameworkText = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'lib', 'bridge-framework', 'bridge-framework.js'), 'utf8');
// the framework spells the template inline (its lines are twin find-text); these two pins hold it to pairKeyFor's composition
harness.ok('the framework\'s pairKeyPrefix is hub@ver::source@ver, as pairKeyFor composes it', frameworkText.indexOf('const pairKeyPrefix = `${hubToken}@${hubVersion}::${sourceToken}@${sourceVersion}`;') !== -1, 'bridge-framework.js changed its pairKeyPrefix template: change frozenDecisionBlockRule.pairKeyFor with it');
harness.ok('the framework\'s pairKey is prefix::bridgeName::producerKind, as pairKeyFor composes it', frameworkText.indexOf('const pairKey = `${pairKeyPrefix}::${bridgeDeclaration.bridgeName}::${bridgeDeclaration.producerKind}`;') !== -1, 'bridge-framework.js changed its pairKey template: change frozenDecisionBlockRule.pairKeyFor with it');

harness.report();
