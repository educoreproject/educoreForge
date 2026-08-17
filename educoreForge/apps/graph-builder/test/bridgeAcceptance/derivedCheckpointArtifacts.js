#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// derivedCheckpointArtifacts.js — writes the CHECKPOINT artifacts for a derived run: the score
// (derivedScore-<blockId>.json + .md) and the rendering audit (renderingAudit-<blockId>.md). Thin glue over
// derivedEval.js and renderingAudit.js, which own all the reasoning; this file only resolves paths, reads the
// declaration for the allow-list, and writes bytes.
//
// It exists so the supervisor can REPRODUCE the checkpoint artifacts from one command instead of trusting a
// transcript. An artifact a reviewer cannot regenerate is a claim, not evidence.
//
//   node apps/graph-builder/test/bridgeAcceptance/derivedCheckpointArtifacts.js \
//     --bridgeName=edfiCedsDerivedPlugin --derivedBlockId=<id|latest> [--sampleCount=5]
//
// READ-ONLY on both stores. It never builds, never judges, never writes to a decision store.

const fs = require('fs');
const path = require('path');

const helpText = () => `
NAME
     ${moduleName} -- write the derived checkpoint artifacts (score + rendering audit) for a frozen block

SYNOPSIS
     ${moduleName} --bridgeName=<plugin> [--derivedBlockId=<64-hex|latest>] [--sampleCount=N] [--outDirPath=<dir>]

EXIT STATUS
     0 written;  1 refused by name.
`;
const commandLineParameters = require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const { xLog } = process.global;

const derivedEvalLib = require('./derivedEval');
const renderingAuditLib = require('./renderingAudit');

const ACCEPTANCE_FILE_PATH = path.join(__dirname, '..', '..', '..', '..', 'lib', 'bridge-framework', 'test', 'acceptance', 'acceptanceCommands.jsonc');
const TRUTH_STORE_FILE_PATH = '/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/bridgeAcceptance/edfi/edfiBridge.decisions.sqlite3';
const TRUTH_BLOCK_ID = 'e15acd6b5a43df3ce11b4e3f3bb55d97441c14658908d3518a55494cf24a322c';

const firstValue = (name) => (Array.isArray(commandLineParameters.values[name]) ? commandLineParameters.values[name][0] : commandLineParameters.values[name]);
const refuse = (what) => {
	xLog.error(`${moduleName} REFUSED: ${what}`);
	process.exit(1);
};

const bridgeName = firstValue('bridgeName');
if (typeof bridgeName !== 'string' || bridgeName === '') {
	refuse('--bridgeName is required; there is no default');
}
const acceptanceCommands = JSON.parse(fs.readFileSync(ACCEPTANCE_FILE_PATH, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const entry = acceptanceCommands[bridgeName];
if (entry === undefined) {
	refuse(`acceptanceCommands.jsonc names no bridge '${bridgeName}' (${Object.keys(acceptanceCommands).join(', ')})`);
}

// the DECLARATION is the authority for the allow-list the audit prints — read from the plugin itself, never
// restated here, so the document cannot describe an allow-list the run did not use
const pluginFilePath = path.join(__dirname, '..', '..', '..', '..', 'forges', entry.standardKey, 'bridges', `${bridgeName}.js`);
if (!fs.existsSync(pluginFilePath)) {
	refuse(`the plugin is not on disk at ${pluginFilePath}`);
}
const bridgeDeclaration = require(pluginFilePath).bridgeDeclaration;

const askedBlockId = firstValue('derivedBlockId');
const derivedBlockId = askedBlockId === undefined || askedBlockId === 'latest' ? undefined : askedBlockId;
const outDirPath = firstValue('outDirPath') === undefined ? path.dirname(entry.decisionStoreFilePath) : firstValue('outDirPath');

const scored = derivedEvalLib.scoreDerivedRun({
	truthStoreFilePath: TRUTH_STORE_FILE_PATH,
	truthBlockId: TRUTH_BLOCK_ID,
	derivedStoreFilePath: entry.decisionStoreFilePath,
	derivedBlockId,
});
if (scored.error) {
	refuse(scored.error.message);
}
const resolvedBlockId = scored.score.derivedBlockId;

fs.writeFileSync(path.join(outDirPath, `derivedScore-${resolvedBlockId}.json`), `${JSON.stringify(scored.score, null, '\t')}\n`);
fs.writeFileSync(path.join(outDirPath, `derivedScore-${resolvedBlockId}.md`), `${scored.markdownText}\n`);

// the rendering audit needs the GENERATION, which is the forensic file's name. Read it off the block rather
// than reconstructing it: a reconstructed generation that is subtly wrong reads the wrong trail and audits
// prompts that were never sent.
const blockRead = derivedEvalLib.readFrozenBlock({ storeFilePath: entry.decisionStoreFilePath, blockId: resolvedBlockId, roleName: 'derived' });
if (blockRead.error) {
	refuse(blockRead.error.message);
}
const header = blockRead.block.header;
const pairKey = `${header.hubName.toLowerCase()}@${header.hubVersion}::${header.sourceStandardName.toLowerCase()}@${header.sourceVersion}::${header.bridgeName}::${header.producerKind}`;
const audit = renderingAuditLib.buildRenderingAudit({
	forensicsDirPath: entry.matchForensicsDirPath,
	pairKey,
	generation: header.generation,
	blockId: resolvedBlockId,
	renderingAllowList: bridgeDeclaration.renderingAllowList,
	judgePromptVariant: bridgeDeclaration.judgePromptVariant,
	sampleCount: firstValue('sampleCount') === undefined ? undefined : Number(firstValue('sampleCount')),
});
if (audit.error) {
	refuse(audit.error.message);
}
fs.writeFileSync(path.join(outDirPath, `renderingAudit-${resolvedBlockId}.md`), `${audit.markdownText}\n`);

xLog.status(`${moduleName}: block ${resolvedBlockId}`);
xLog.status(`  score        → derivedScore-${resolvedBlockId}.json / .md`);
xLog.status(`  audit        → renderingAudit-${resolvedBlockId}.md (${audit.promptCount} prompt(s), ${audit.hitList.length} id-gate hit(s), ${audit.advisoryUrlCount} advisory URL prompt(s))`);
xLog.status(`  recall@1/5/15/25 = ${[1, 5, 15, 25].map((oneK) => `${oneK}:${scored.score.retrieval.recallByK[oneK] === null || scored.score.retrieval.recallByK[oneK] === undefined ? '—' : (scored.score.retrieval.recallByK[oneK] * 100).toFixed(1) + '%'}`).join('  ')}`);
xLog.result(JSON.stringify({ derivedBlockId: resolvedBlockId, idGateHitCount: audit.hitList.length, promptCount: audit.promptCount, population: scored.score.population }, null, '\t'));
