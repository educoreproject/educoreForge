#!/usr/bin/env node
'use strict';

// noRebuildMaterialiseAll.js — P-a2 of the R0 proof kit (2026-10-21, step 6), ON DEMAND (it loads whole base blocks, hundreds of
// MB each, so it is not part of runAllTests). The CLI over apps/graph-builder/lib/no-rebuild-materialise.js.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- P-a2: every gated recipe of record re-materialised in process from its frozen decision blocks

SYNOPSIS
     node --max-old-space-size=16000 ${moduleName} [--recipeName=<one gated recipe>] [--outputFilePath=<json>] [-help]

DESCRIPTION
     For each gated recipe of record (graphBuilder.ini [noRebuildProof] baselineDirectoryPath: noRebuildGateSet.json), runs
     the REAL bridge framework in materialise mode over the baseline decision store (read-only) for every mapping bridge,
     records what it writes through a writer that applies the bolt writer's own rules, rebuilds the relationship block a
     harvest would mint (from the engine's own functions), and compares it with the block the recipe's manifest holds:
       PASS                       the rebuilt block's refId equals the stored one, byte for byte
       EDGES_EQUAL_BLOCK_DIFFERS  the same edges (engine identity), but the block bytes differ (the first differing line
                                  is shown): the emulated harvest, not the decisions, is what differs
       EDGES_DIFFER               the written edge set is not the stored one
       RUN_REFUSED                the framework refused the materialise (drift, missing block, a writer rule)
       STRUCTURAL_NOT_MATERIALISED a structural pairing: no decision block; its blocks are a live-build (P-z) check
     Reads the baseline stores; never writes them. The engine's vector store opens a copy-on-write CLONE of each
     recipe's standards store (cp -c) in the system temporary directory, removed afterwards. No graph, no judge, no
     embedding call.

EXIT STATUS
     0 every row PASS (or structural);  1 otherwise, or refused.

EXAMPLES
     node --max-old-space-size=16000 apps/graph-builder/tools/noRebuildMaterialiseAll.js --outputFilePath=<lane dataStore>/runs/pA2.json
`;

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const recipeLib = require('../lib/recipe')();

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const { xLog, getConfig, commandLineParameters } = process.global;
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();
const forger = require(path.join(__dirname, '..', 'apps', 'forger'));
const buildStatics = require(path.join(__dirname, '..', 'lib', 'build'));
const pluginRegistryLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'pluginRegistry'));
const materialiseLib = require(path.join(__dirname, '..', 'lib', 'no-rebuild-materialise'));

// xLog.result writes raw text (no newline of its own)
const say = (lineText) => xLog.result(`${lineText}\n`);
const flagValueOf = (flagName) => {
	const flagValue = commandLineParameters.values[flagName];
	return Array.isArray(flagValue) ? flagValue[0] : flagValue;
};
const refuse = (reasonText) => {
	xLog.error(`${moduleName}: REFUSED: ${reasonText}\n(${moduleName} -help for the full page)`);
	process.exit(1);
};

const proofConfig = getConfig('noRebuildProof') || {};
const baselineDirectoryPath = proofConfig.baselineDirectoryPath;
if (typeof baselineDirectoryPath !== 'string' || !fs.existsSync(path.join(baselineDirectoryPath, 'capture.json'))) {
	refuse(`graphBuilder.ini [noRebuildProof] baselineDirectoryPath ${JSON.stringify(baselineDirectoryPath)} holds no capture.json; there is no default`);
}
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const capture = readJson(path.join(baselineDirectoryPath, 'capture.json'));
const gateSet = readJson(path.join(baselineDirectoryPath, 'noRebuildGateSet.json'));
const chosenRecipeName = flagValueOf('recipeName');
if (chosenRecipeName !== undefined && gateSet.gatedRecipeList.indexOf(chosenRecipeName) === -1) {
	refuse(`--recipeName=${chosenRecipeName} is not a gated recipe (${gateSet.gatedRecipeList.join(', ')})`);
}
const recipeNameList = chosenRecipeName === undefined ? gateSet.gatedRecipeList : [chosenRecipeName];

const registry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: path.join(TREE_ROOT, 'forges') });
const scratchDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noRebuildMaterialise-'));
const report = { treeHead: execFileSync('git', ['-C', TREE_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), startedAt: new Date().toISOString(), recipeList: [] };

const taskList = new taskListPlus();
recipeNameList.forEach((recipeName) => {
	taskList.push((args, next) => {
		const recipeCapture = capture.recipeCaptureList.find((oneCapture) => oneCapture.recipeName === recipeName);
		const loadedRecipe = recipeLib.loadRecipe(path.join(TREE_ROOT, 'recipes', `${recipeName}.recipe.jsonc`), { forgesDirPath: path.join(TREE_ROOT, 'forges') });
		if (loadedRecipe.error) {
			refuse(`recipe ${recipeName}: ${loadedRecipe.error}`);
		}
		const recipe = loadedRecipe.recipe;
		const versionByToken = {};
		const standardNameByToken = {};
		recipe.standards.forEach((oneStandard) => {
			const stamp = forger.getVersionStamp({ standard: oneStandard.token });
			const bundle = forger.resolveBundle({ standard: oneStandard.token });
			if (stamp.error || bundle.error) {
				refuse(`${oneStandard.token}: ${stamp.error || bundle.error}`);
			}
			versionByToken[oneStandard.token] = buildStatics.explicitVersionFrom(stamp.value);
			standardNameByToken[oneStandard.token] = bundle.standardName;
		});
		const baselineStandardsPath = path.join(baselineDirectoryPath, recipeName, 'standards.sqlite3');
		const supportStoreClonePath = path.join(scratchDirectoryPath, `${recipeName}.standards.sqlite3`);
		execFileSync('cp', ['-c', baselineStandardsPath, supportStoreClonePath]);
		const startedMs = Date.now();
		say(`== ${recipeName}: manifest ${recipeCapture.manifestRefId.slice(0, 12)}, ${recipe.bridges.length} bridge(s)`);
		materialiseLib.materialiseRecipe(
			{ recipe, registry, versionByToken, standardNameByToken, standardsDatabaseFilePath: baselineStandardsPath, supportStoreFilePath: supportStoreClonePath, decisionStoreFilePath: path.join(baselineDirectoryPath, recipeName, 'decisions.sqlite3'), manifestRefId: recipeCapture.manifestRefId },
			(materialiseError, materialised) => {
				fs.rmSync(supportStoreClonePath, { force: true });
				if (materialiseError) {
					next(`${recipeName}: ${materialiseError}`);
					return;
				}
				const elapsedSeconds = Math.round((Date.now() - startedMs) / 1000);
				materialised.rowList.forEach((oneRow) => say(`  ${oneRow.verdict.padEnd(27)} ${oneRow.bridgeName}${oneRow.edgesWritten === undefined ? '' : ` (${oneRow.edgesWritten} edges, ${oneRow.stampedNodeCount} nodes)`}${oneRow.detail ? ` — ${oneRow.detail}` : ''}`));
				say(`  ${recipeName}: ${materialised.passed ? 'PASS' : 'FAIL'} in ${elapsedSeconds}s`);
				report.recipeList.push({ recipeName, passed: materialised.passed, elapsedSeconds, rowList: materialised.rowList });
				next('', args);
			},
		);
	});
});
pipeRunner(taskList.getList(), {}, (pipeError) => {
	fs.rmSync(scratchDirectoryPath, { recursive: true, force: true });
	if (pipeError) {
		refuse(pipeError);
	}
	report.finishedAt = new Date().toISOString();
	report.passed = report.recipeList.every((oneRecipe) => oneRecipe.passed);
	if (typeof flagValueOf('outputFilePath') === 'string') {
		fs.writeFileSync(flagValueOf('outputFilePath'), `${JSON.stringify(report, null, '\t')}\n`);
		say(`${moduleName}: wrote ${flagValueOf('outputFilePath')}`);
	}
	say(`${moduleName}: ${report.passed ? 'PASS' : 'FAIL'}`);
	process.exit(report.passed ? 0 : 1);
});
