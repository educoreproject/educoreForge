#!/usr/bin/env node
'use strict';

// test-hubAnchorValueRetired.js — zeroBacklog lane D, D3-6 (2026-10-22; TQ ruling Q-Z4 under the mandate, BRONZE_CROWN grant): the
// kit's hub-generic anchor normalizer hubAnchorValue (deCeds R5 S2) is RETIRED with its last production caller, the old SIF forge,
// now codeAttic/forges/sif. With it went the forger's hubAnchorPrefixByHubTokenFor, the factory dep hubAnchorPrefixByHubToken, and
// the CEDS bundle's anchorPrefixDeclaration= (forges/ceds/lib/cedsAnchorPrefixDeclaration.js).
//
// PROVES:
//   (a) the kit surface declares no hubAnchorValue, and the forger exports no hubAnchorPrefixByHubTokenFor
//   (b) NO CALLER REMAINS: no tracked .js outside codeAttic/ calls .hubAnchorValue( or hands a hubAnchorPrefixByHubToken dep, and no
//       forge bundle's parserDescriptor.ini declares anchorPrefixDeclaration=
//   (c) the forge-framework factory REFUSES a hubAnchorPrefixByHubToken dep by name, as any unknown dep
// TWINS, each observed red: (a) the surface with the member put back; (b) the census over the tree plus one synthetic caller line;
// (c) the dep list with the name put back (in memory, loadBuildJsDouble).
//
// Run: node lib/forge-framework/test/test-hubAnchorValueRetired.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: the kit's hubAnchorValue is retired and nothing calls it
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadBuildJsDouble } = require('../../bridge-framework/test/testSupport/bridgeTwinFactories');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const FRAMEWORK_PATH = path.join(__dirname, '..', 'forge-framework.js');
const { CONTRACT_GRAPH_KIT_SURFACE } = require('../contractGraphKit');
const forgerModule = require(path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'forger', 'forger'));

const RETIRED_CALL_RE = /\.hubAnchorValue\(|hubAnchorPrefixByHubToken\s*:/;
const RETIRED_DESCRIPTOR_RE = /^\s*anchorPrefixDeclaration\s*=/m;

// trackedTextByPath — every tracked .js (and every forge descriptor) outside codeAttic/, read from the working tree
const trackedPathList = String(spawnSync('git', ['ls-files', '--', '*.js', 'forges/*/parserDescriptor.ini'], { cwd: TREE_ROOT, encoding: 'utf8' }).stdout || '')
	.split('\n')
	.filter((onePath) => onePath !== '' && !/^codeAttic\//.test(onePath) && onePath !== path.relative(TREE_ROOT, __filename));
const callerListOf = (textByPath) =>
	Object.keys(textByPath).filter((onePath) => (/\.ini$/.test(onePath) ? RETIRED_DESCRIPTOR_RE : RETIRED_CALL_RE).test(textByPath[onePath]));
const treeTextByPath = trackedPathList.reduce((soFar, onePath) => ({ ...soFar, [onePath]: fs.existsSync(path.join(TREE_ROOT, onePath)) ? fs.readFileSync(path.join(TREE_ROOT, onePath), 'utf8') : '' }), {});

const depRefusalFor = (mutationList) => {
	const factory = mutationList.length === 0 ? require(FRAMEWORK_PATH) : loadBuildJsDouble({ buildJsPath: FRAMEWORK_PATH, mutationList });
	let refusalText = '';
	try {
		factory({ embedder: null, hubAnchorPrefixByHubToken: {} });
	} catch (constructionFault) {
		refusalText = constructionFault.message;
	}
	return refusalText;
};

harness.section('(a) the kit surface and the forger carry no retired member');
harness.ok('CONTRACT_GRAPH_KIT_SURFACE declares no hubAnchorValue', !Object.prototype.hasOwnProperty.call(CONTRACT_GRAPH_KIT_SURFACE, 'hubAnchorValue'), Object.keys(CONTRACT_GRAPH_KIT_SURFACE).join(', '));
harness.ok('the forger exports no hubAnchorPrefixByHubTokenFor', forgerModule.hubAnchorPrefixByHubTokenFor === undefined);
const surfaceTwin = { ...CONTRACT_GRAPH_KIT_SURFACE, hubAnchorValue: { arity: 1, kind: 'function' } };
harness.ok("(a) observed RED under 'memberPutBack'", Object.prototype.hasOwnProperty.call(surfaceTwin, 'hubAnchorValue'));

harness.section('(b) no caller remains outside codeAttic/');
const callerList = callerListOf(treeTextByPath);
harness.equal(`no tracked file of ${trackedPathList.length} calls hubAnchorValue, hands hubAnchorPrefixByHubToken or declares anchorPrefixDeclaration=`, callerList.join(', '), '');
const twinCallerList = callerListOf({ ...treeTextByPath, 'forges/probe/lib/probe.js': "const anchor = kit.hubAnchorValue({ hubToken: 'probe', kind: 'property', rawValue: '1' });" });
harness.ok("(b) observed RED under 'syntheticCallerAdded'", twinCallerList.indexOf('forges/probe/lib/probe.js') !== -1, twinCallerList.join(', '));
harness.note(`RED-OBSERVED b_noCallerRemains twin='syntheticCallerAdded' → callers [${twinCallerList.join(', ')}]`);

harness.section('(c) the factory refuses the retired dep by name');
const realRefusal = depRefusalFor([]);
harness.ok("a hubAnchorPrefixByHubToken dep is refused as an unknown dep, by name", /unknown dep 'hubAnchorPrefixByHubToken'/.test(realRefusal), realRefusal.slice(0, 240));
const twinRefusal = depRefusalFor([{ find: "const DEP_NAME_LIST = Object.freeze(['embedder', 'xLog', 'migratingBundleListOverride']);", replace: "const DEP_NAME_LIST = Object.freeze(['embedder', 'xLog', 'migratingBundleListOverride', 'hubAnchorPrefixByHubToken']);" }]);
harness.ok("(c) observed RED under 'depNamePutBack'", !/unknown dep 'hubAnchorPrefixByHubToken'/.test(twinRefusal), twinRefusal.slice(0, 240) || 'accepted');
harness.note(`RED-OBSERVED c_depRefused twin='depNamePutBack' → ${twinRefusal ? twinRefusal.slice(0, 120) : 'accepted'}`);

harness.report();
