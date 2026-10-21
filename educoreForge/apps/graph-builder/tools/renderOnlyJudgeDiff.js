#!/usr/bin/env node
'use strict';

// renderOnlyJudgeDiff.js — P-b of the R0 proof kit (2026-10-21, step 7): the CLI over apps/graph-builder/lib/render-only-judge.js.
// -capture writes the baseline (and is the R0 gate: every sampled promptHash reproduced); -compare re-renders the same sample under
// the code in this tree and lists every unit whose judgment-cache key would move.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- re-render a fixed sample of real judge questions under this tree's code; no graph, no judge, no spend

SYNOPSIS
     node --max-old-space-size=24000 ${moduleName} -capture --outputDirPath=<dir> [-help]
     node --max-old-space-size=24000 ${moduleName} -compare --baselineRenderOnlyDirPath=<dir written by -capture> --outputDirPath=<dir>

DESCRIPTION
     The sample, the stores and the forensic trail are DECLARED in graphBuilder.ini [noRebuildProof] baselineDirectoryPath:
     noRebuildGateSet.json renderOnly { sampleSize, forensicsDirectoryPath }. Every judged (derived) pairing of the gated
     recipes of record, once per frozen decision block: the first sampleSize judged records by subject stableId.

     For each sampled unit the question is rebuilt from the recipe's stored base blocks and the frozen record, rendered by
     evidenceRenderer.renderQuestion, and keyed as the judgment cache keys it: promptHash, the cache model key (the judge's
     identity joined to the digest of its config header, whose tool-schema sha is recomputed from today's tool text), and
     the renderer version. Reads the baseline stores read-only; the engine's vector store opens a copy-on-write clone of each
     standards store (cp -c) in the system temporary directory, removed afterwards.

     -capture   writes <outputDirPath>/<pair>.units.jsonl (every unit: keys and the rendered texts) and summary.json. PASS
                only if EVERY sampled promptHash equals the one frozen in its decision record, every sampled promptHash is
                present in the forensic trail of the run that froze the block, and every unit's full cache key is a row of
                the baseline judgment cache. A miss is named, with the first differing prompt line against the forensic text.
     -compare   re-renders the baseline's sample and writes the units whose promptHash, cache model key or renderer version
                moved (the re-keyed set), with the first differing line of each prompt, to <outputDirPath>/rekeyed.json.
                Exit 0 when nothing re-keyed. Prices nothing: the re-keyed counts are priced from the spend ledger's table
                by the phase that proposes the change.

EXIT STATUS
     0 PASS (capture) / nothing re-keyed (compare);  1 otherwise, or refused.
`;

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const recipeLib = require('../lib/recipe')();
const Database = require('better-sqlite3');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const { xLog, getConfig, commandLineParameters } = process.global;
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();
const forger = require(path.join(__dirname, '..', 'apps', 'forger'));
const buildStatics = require(path.join(__dirname, '..', 'lib', 'build'));
const { makeVectorStoreResolver } = require(path.join(__dirname, '..', 'lib', 'build'))();
const renderOnlyLib = require(path.join(__dirname, '..', 'lib', 'render-only-judge'));
const pluginRegistryLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'pluginRegistry'));
const frozenDecisionBlockRuleLib = require(path.join(__dirname, '..', 'lib', 'frozenDecisionBlockRule'));
const replayBlockLib = require(path.join(TREE_ROOT, 'lib', 'replay', 'replay-block'))();
const replayEngineLib = require(path.join(TREE_ROOT, 'lib', 'replay', 'replay-engine'))();
const vocabulary = require(path.join(TREE_ROOT, 'lib', 'vocabulary', 'vocabulary'));
const graphSeamRulesLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'graphSeamRules'));

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
const textOf = (storedText) => (Buffer.isBuffer(storedText) ? storedText.toString('utf8') : String(storedText));
const fileNameFor = (pairKey) => pairKey.replace(/[^A-Za-z0-9.@-]+/g, '_');
const firstDifferingLine = (leftText, rightText) => {
	const leftLineList = String(leftText).split('\n');
	const rightLineList = String(rightText).split('\n');
	const lineIndex = leftLineList.findIndex((oneLine, oneIndex) => oneLine !== rightLineList[oneIndex]);
	return lineIndex === -1 ? (leftLineList.length === rightLineList.length ? null : { lineNumber: leftLineList.length + 1, left: '', right: rightLineList[leftLineList.length] || '' }) : { lineNumber: lineIndex + 1, left: leftLineList[lineIndex], right: rightLineList[lineIndex] || '' };
};

const ACTION_NAME_LIST = ['capture', 'compare'];
const chosenActionList = ACTION_NAME_LIST.filter((actionName) => commandLineParameters.switches[actionName]);
if (chosenActionList.length !== 1) {
	refuse(`exactly one action is required (-${ACTION_NAME_LIST.join(' or -')})`);
}
const actionName = chosenActionList[0];
const outputDirPath = flagValueOf('outputDirPath');
if (typeof outputDirPath !== 'string' || outputDirPath === '') {
	refuse('--outputDirPath is required and absent. There is no default.');
}
const baselineRenderOnlyDirPath = flagValueOf('baselineRenderOnlyDirPath');
if (actionName === 'compare' && (typeof baselineRenderOnlyDirPath !== 'string' || !fs.existsSync(path.join(baselineRenderOnlyDirPath, 'summary.json')))) {
	refuse('-compare needs --baselineRenderOnlyDirPath naming a directory -capture wrote (summary.json)');
}
const proofConfig = getConfig('noRebuildProof') || {};
const baselineDirectoryPath = proofConfig.baselineDirectoryPath;
if (typeof baselineDirectoryPath !== 'string' || !fs.existsSync(path.join(baselineDirectoryPath, 'noRebuildGateSet.json'))) {
	refuse(`graphBuilder.ini [noRebuildProof] baselineDirectoryPath ${JSON.stringify(baselineDirectoryPath)} holds no noRebuildGateSet.json; there is no default`);
}
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const capture = readJson(path.join(baselineDirectoryPath, 'capture.json'));
const gateSet = readJson(path.join(baselineDirectoryPath, 'noRebuildGateSet.json'));
if (!gateSet.renderOnly || !Number.isInteger(gateSet.renderOnly.sampleSize) || gateSet.renderOnly.sampleSize < 1 || typeof gateSet.renderOnly.forensicsDirectoryPath !== 'string') {
	refuse('noRebuildGateSet.json renderOnly must declare { sampleSize: <positive integer>, forensicsDirectoryPath: <dir> }; there are no defaults');
}
fs.mkdirSync(outputDirPath, { recursive: true });

// every judged pairing of the gated recipes, ONCE per frozen decision block (two recipes may hold the same block)
const registry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: path.join(TREE_ROOT, 'forges') });
const pairByBlockHash = {};
gateSet.gatedRecipeList.forEach((recipeName) => {
	const recipeCapture = capture.recipeCaptureList.find((oneCapture) => oneCapture.recipeName === recipeName);
	recipeCapture.bridgeList.filter((oneBridge) => oneBridge.pairKey && oneBridge.producerKind === 'inferred').forEach((oneBridge) => {
		if (pairByBlockHash[oneBridge.decisionBlockHash] === undefined) {
			pairByBlockHash[oneBridge.decisionBlockHash] = { recipeName, manifestRefId: recipeCapture.manifestRefId, bridge: oneBridge };
		}
	});
});
const scratchDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'renderOnlyJudge-'));
const summary = { action: actionName, treeHead: execFileSync('git', ['-C', TREE_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sampleSize: gateSet.renderOnly.sampleSize, forensicsDirectoryPath: gateSet.renderOnly.forensicsDirectoryPath, startedAt: new Date().toISOString(), pairList: [] };
const rekeyedList = [];
const cloneByRecipe = {};
const hubCardRecordListByCacheName = {};

const taskList = new taskListPlus();
Object.keys(pairByBlockHash).forEach((decisionBlockHash) => {
	taskList.push((args, next) => {
		const { recipeName, manifestRefId, bridge } = pairByBlockHash[decisionBlockHash];
		const loadedRecipe = recipeLib.loadRecipe(path.join(TREE_ROOT, 'recipes', `${recipeName}.recipe.jsonc`), { forgesDirPath: path.join(TREE_ROOT, 'forges') });
		if (loadedRecipe.error) {
			refuse(`recipe ${recipeName}: ${loadedRecipe.error}`);
		}
		const recipe = loadedRecipe.recipe;
		const recipeBridge = recipe.bridges.find((oneBridge) => oneBridge.bridge === bridge.bridgeName && oneBridge.source === bridge.source);
		const versionOf = (token) => buildStatics.explicitVersionFrom(forger.getVersionStamp({ standard: token }).value);
		const standardNameOf = (token) => forger.resolveBundle({ standard: token }).standardName;
		const pairKey = frozenDecisionBlockRuleLib.pairKeyFor({ hubToken: recipeBridge.hub, hubVersion: versionOf(recipeBridge.hub), sourceToken: recipeBridge.source, sourceVersion: versionOf(recipeBridge.source), bridgeName: bridge.bridgeName, producerKind: bridge.producerKind });
		const standardsPath = path.join(baselineDirectoryPath, recipeName, 'standards.sqlite3');
		if (cloneByRecipe[recipeName] === undefined) {
			cloneByRecipe[recipeName] = path.join(scratchDirectoryPath, `${recipeName}.standards.sqlite3`);
			execFileSync('cp', ['-c', standardsPath, cloneByRecipe[recipeName]]);
		}
		const storeResolver = makeVectorStoreResolver({ supportStoreFilePath: cloneByRecipe[recipeName] });
		const standardsDatabase = new Database(standardsPath, { readonly: true, fileMustExist: true });
		const baseBlockTextFor = (token) => {
			const subject = vocabulary.baseSubject({ standardKey: token, version: versionOf(token) }).subject;
			const row = standardsDatabase.prepare('select b.text from manifestBlocks m join blocks b on b.refId = m.schemaBlockRefId where m.manifestRefId = ? and b.subject = ?').get(manifestRefId, subject);
			return textOf(row.text);
		};
		const decisionDatabase = new Database(path.join(baselineDirectoryPath, recipeName, 'decisions.sqlite3'), { readonly: true, fileMustExist: true });
		const frozenBlock = JSON.parse(textOf(decisionDatabase.prepare('select frozenText from decisionBlocks where decisionBlockHash = ?').get(decisionBlockHash).frozenText));
		decisionDatabase.close();
		const sourceBlock = replayBlockLib.deserializeBlock(baseBlockTextFor(recipeBridge.source));
		const sourceRawRecordList = sourceBlock.nodes.map((oneNode) => renderOnlyLib.rawRecordFor(oneNode));
		const hubStandardName = standardNameOf(recipeBridge.hub);
		const hubCardRecordCacheName = `${recipeName}::${recipeBridge.hub}`;
		const withHubCards = (hubDone) => {
			if (hubCardRecordListByCacheName[hubCardRecordCacheName] !== undefined) {
				hubDone('', hubCardRecordListByCacheName[hubCardRecordCacheName]);
				return;
			}
			const hubBlock = replayBlockLib.deserializeBlock(baseBlockTextFor(recipeBridge.hub));
			const cardNodeList = hubBlock.nodes
				.filter((oneNode) => oneNode.labels.indexOf(graphSeamRulesLib.HUB_REFERENCE_LABEL) !== -1)
				.map((oneNode) => ({ ...oneNode, _standardKey: hubBlock.header.blockType === 'standardBase' ? hubBlock.header.standardKey : undefined }))
				.filter((oneNode) => replayEngineLib.pgToStored(oneNode.properties).referenceTier === renderOnlyLib.RETRIEVAL_CARD_TIER);
			replayEngineLib.resolveNodeVectors({ nodes: cardNodeList, storeResolver, header: hubBlock.header }, (resolveError) => {
				if (resolveError) {
					hubDone(resolveError);
					return;
				}
				hubCardRecordListByCacheName[hubCardRecordCacheName] = cardNodeList.map((oneNode) => renderOnlyLib.rawRecordFor(oneNode));
				hubDone('', hubCardRecordListByCacheName[hubCardRecordCacheName]);
			});
		};
		withHubCards((hubError, hubCardRawRecordList) => {
			standardsDatabase.close();
			if (hubError) {
				next(`${pairKey}: hub cards: ${hubError}`);
				return;
			}
			const rendered = renderOnlyLib.renderSampleFor({ bridgeEntry: registry.entryByBridgeName[bridge.bridgeName], frozenBlock, sampleSize: gateSet.renderOnly.sampleSize, sourceStandardName: standardNameOf(recipeBridge.source), hubStandardName, baseNodeIndex: { sourceRawRecordList, hubCardRawRecordList } });
			if (rendered.error) {
				next(`${pairKey}: ${rendered.error}`);
				return;
			}
			const unitsFileName = `${fileNameFor(pairKey)}.units.jsonl`;
			if (actionName === 'capture') {
				const forensicsPairDirPath = path.join(gateSet.renderOnly.forensicsDirectoryPath, pairKey);
				const forensicsFileName = fs.existsSync(forensicsPairDirPath) ? fs.readdirSync(forensicsPairDirPath).find((fileName) => fileName.endsWith('.jsonl')) : undefined;
				const forensicByPromptHash = {};
				if (forensicsFileName !== undefined) {
					fs.readFileSync(path.join(forensicsPairDirPath, forensicsFileName), 'utf8').split('\n').filter((oneLine) => oneLine.trim() !== '').forEach((oneLine) => {
						const oneRecord = JSON.parse(oneLine);
						if (typeof oneRecord.promptHash === 'string') {
							forensicByPromptHash[oneRecord.promptHash] = oneRecord;
						}
					});
				}
				const cacheDatabase = new Database(path.join(baselineDirectoryPath, recipeName, 'judgmentCache.sqlite3'), { readonly: true, fileMustExist: true });
				const cacheRowFor = cacheDatabase.prepare('select count(*) as rowCount from judgmentCacheEntries where promptHash = ? and model = ? and rendererVersion = ?');
				const unitList = rendered.unitList.map((oneUnit) => {
					const forensic = forensicByPromptHash[oneUnit.frozenPromptHash];
					return {
						...oneUnit,
						inForensics: forensic !== undefined,
						cacheRowPresent: oneUnit.error === undefined && cacheRowFor.get(oneUnit.promptHash, oneUnit.cacheModelKey, oneUnit.renderedRendererVersion).rowCount > 0,
						firstDifferingUserPromptLine: oneUnit.promptHashReproduced === false && forensic !== undefined ? firstDifferingLine(forensic.userPrompt, oneUnit.userPrompt) : null,
						firstDifferingSystemPromptLine: oneUnit.promptHashReproduced === false && forensic !== undefined ? firstDifferingLine(forensic.systemPrompt, oneUnit.systemPrompt) : null,
					};
				});
				cacheDatabase.close();
				fs.writeFileSync(path.join(outputDirPath, unitsFileName), `${unitList.map((oneUnit) => JSON.stringify(oneUnit)).join('\n')}\n`);
				const pairRow = {
					pairKey,
					decisionBlockHash,
					recipeName,
					judgePromptVariant: rendered.judgePromptVariant,
					forensicsFilePath: forensicsFileName === undefined ? null : path.join(forensicsPairDirPath, forensicsFileName),
					sampledCount: unitList.length,
					reproducedCount: unitList.filter((oneUnit) => oneUnit.promptHashReproduced === true).length,
					inForensicsCount: unitList.filter((oneUnit) => oneUnit.inForensics).length,
					cacheRowPresentCount: unitList.filter((oneUnit) => oneUnit.cacheRowPresent).length,
					toolSchemaSha256: rendered.toolSchemaSha256,
					frozenToolSchemaSha256: rendered.frozenToolSchemaSha256,
					missList: unitList.filter((oneUnit) => oneUnit.promptHashReproduced !== true || !oneUnit.inForensics || !oneUnit.cacheRowPresent).map((oneUnit) => ({ subjectStableId: oneUnit.subjectStableId, error: oneUnit.error, reproduced: oneUnit.promptHashReproduced, inForensics: oneUnit.inForensics, cacheRowPresent: oneUnit.cacheRowPresent, firstDifferingUserPromptLine: oneUnit.firstDifferingUserPromptLine, firstDifferingSystemPromptLine: oneUnit.firstDifferingSystemPromptLine })),
					unitsFileName,
				};
				pairRow.passed = pairRow.sampledCount > 0 && pairRow.missList.length === 0 && pairRow.toolSchemaSha256 === pairRow.frozenToolSchemaSha256;
				summary.pairList.push(pairRow);
				say(`  ${pairRow.passed ? 'PASS' : 'FAIL'} ${pairKey}: reproduced ${pairRow.reproducedCount}/${pairRow.sampledCount}, in forensics ${pairRow.inForensicsCount}, cache rows ${pairRow.cacheRowPresentCount}, tool schema ${pairRow.toolSchemaSha256 === pairRow.frozenToolSchemaSha256 ? 'unchanged' : 'MOVED'}`);
				next('', args);
				return;
			}
			// -compare: the baseline's units for this pair against today's rendering of the same sample
			const baselineUnitsPath = path.join(baselineRenderOnlyDirPath, unitsFileName);
			if (!fs.existsSync(baselineUnitsPath)) {
				next(`${pairKey}: the baseline holds no ${unitsFileName}`);
				return;
			}
			const baselineUnitBySubject = fs.readFileSync(baselineUnitsPath, 'utf8').split('\n').filter((oneLine) => oneLine.trim() !== '').map((oneLine) => JSON.parse(oneLine)).reduce((soFar, oneUnit) => Object.assign(soFar, { [`${oneUnit.subjectStableId}|${oneUnit.targetKey}`]: oneUnit }), {});
			const pairRekeyedList = rendered.unitList
				.map((oneUnit) => ({ oneUnit, baselineUnit: baselineUnitBySubject[`${oneUnit.subjectStableId}|${oneUnit.targetKey}`] }))
				.filter(({ oneUnit, baselineUnit }) => baselineUnit === undefined || oneUnit.promptHash !== baselineUnit.promptHash || oneUnit.cacheModelKey !== baselineUnit.cacheModelKey || oneUnit.renderedRendererVersion !== baselineUnit.renderedRendererVersion)
				.map(({ oneUnit, baselineUnit }) => ({
					pairKey,
					subjectStableId: oneUnit.subjectStableId,
					movedKeyPartList: baselineUnit === undefined ? ['notInBaseline'] : ['promptHash', 'cacheModelKey', 'renderedRendererVersion'].filter((partName) => oneUnit[partName] !== baselineUnit[partName]),
					firstDifferingUserPromptLine: baselineUnit === undefined ? null : firstDifferingLine(baselineUnit.userPrompt, oneUnit.userPrompt),
					firstDifferingSystemPromptLine: baselineUnit === undefined ? null : firstDifferingLine(baselineUnit.systemPrompt, oneUnit.systemPrompt),
				}));
			rekeyedList.push(...pairRekeyedList);
			summary.pairList.push({ pairKey, sampledCount: rendered.unitList.length, rekeyedCount: pairRekeyedList.length });
			say(`  ${pairKey}: ${pairRekeyedList.length}/${rendered.unitList.length} unit(s) re-keyed`);
			next('', args);
		});
	});
});
pipeRunner(taskList.getList(), {}, (pipeError) => {
	fs.rmSync(scratchDirectoryPath, { recursive: true, force: true });
	if (pipeError) {
		refuse(pipeError);
	}
	summary.finishedAt = new Date().toISOString();
	if (actionName === 'capture') {
		summary.passed = summary.pairList.length > 0 && summary.pairList.every((onePair) => onePair.passed);
		fs.writeFileSync(path.join(outputDirPath, 'summary.json'), `${JSON.stringify(summary, null, '\t')}\n`);
		say(`${moduleName} -capture: ${summary.pairList.length} pair(s); ${summary.passed ? 'PASS — every sampled promptHash reproduced, in the forensic trail, and keyed in the baseline cache' : 'FAIL'}`);
		process.exit(summary.passed ? 0 : 1);
	}
	summary.rekeyedCount = rekeyedList.length;
	fs.writeFileSync(path.join(outputDirPath, 'rekeyed.json'), `${JSON.stringify({ ...summary, rekeyedList }, null, '\t')}\n`);
	say(`${moduleName} -compare: ${rekeyedList.length} unit(s) re-keyed across ${summary.pairList.length} pair(s)`);
	process.exit(rekeyedList.length === 0 ? 0 : 1);
});
