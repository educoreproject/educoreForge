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
//     --bridgeName=edfiCedsDerivedPlugin --derivedBlockId=<64-hex, REQUIRED> [--sampleCount=5]
//
// READ-ONLY on both stores. It never builds, never judges, never writes to a decision store.

const fs = require('fs');
const path = require('path');

const helpText = () => `
NAME
     ${moduleName} -- write the derived checkpoint artifacts (score + rendering audit) for a frozen block

SYNOPSIS
     ${moduleName} --bridgeName=<plugin> --derivedBlockId=<64-hex> [--sampleCount=N] [--outDirPath=<dir>]

EXIT STATUS
     0 written;  1 refused by name.
`;
const commandLineParameters = require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const { xLog } = process.global;

const derivedEvalLib = require('./derivedEval');
const renderingAuditLib = require('./renderingAudit');

// measured 2026-08-17, retrievalCeiling.js against DEV_edfiDerived_260817 (bolt 7817), 655 subjects with a
// picked truth object; reproduces the D0-era curve exactly. 30 of 655 are never retrieved at ANY K to 200.
const MEASURED_CEILING_CURVE = Object.freeze({ 1: 0.4153, 5: 0.6916, 10: 0.7679, 15: 0.8153, 25: 0.858, 50: 0.8901, 100: 0.9237, 200: 0.9542 });

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

// ⟪DR-11⟫ 'latest' is gone with the fallback it depended on. Resolving a block by store order is how a score
// silently lands on a debug block or a PARTIAL window (F-C2 measured exactly that in the crosswalk store), so
// the id is REQUIRED and named. The old spelling is refused BY NAME rather than quietly treated as absent.
const askedBlockId = firstValue('derivedBlockId');
if (askedBlockId === 'latest') {
	refuse("--derivedBlockId=latest is no longer accepted: the newest row in a store can be a debug block, a PARTIAL window, or another run entirely (F-C2). Name the 64-hex block id.");
}
if (typeof askedBlockId !== 'string' || !/^[0-9a-f]{64}$/.test(askedBlockId)) {
	refuse(`--derivedBlockId must be the 64-hex id of the block to score (got ${JSON.stringify(askedBlockId)}); there is no default and no 'latest'`);
}
const derivedBlockId = askedBlockId;
const outDirPath = firstValue('outDirPath') === undefined ? path.dirname(entry.decisionStoreFilePath) : firstValue('outDirPath');

// the CEILING is measured by a DIFFERENT tool against a live graph (retrievalCeiling.js) and is passed in
// as a number rather than recomputed here. Two reasons: this driver must stay read-only on stores and touch
// no graph, and a ceiling silently recomputed by the same code that computes recall would stop being an
// independent check. Omit it and the retrieval-loss block reports the recoverable count as null rather than
// guessing one.
const ceilingRecallAt25 = firstValue('ceilingRecallAt25') === undefined ? undefined : Number(firstValue('ceilingRecallAt25'));
if (ceilingRecallAt25 !== undefined && (!Number.isFinite(ceilingRecallAt25) || ceilingRecallAt25 < 0 || ceilingRecallAt25 > 1)) {
	refuse(`--ceilingRecallAt25 ${JSON.stringify(firstValue('ceilingRecallAt25'))} is not a recall fraction in [0, 1]`);
}
// the RENDERING-TIE index must be built BEFORE scoring, because the score needs it — so the block is resolved
// first, its generation read, and the trail parsed. Supplying it is what turns renderingTieMeasured true; a
// score written without it says so in words rather than reporting a zero it never measured.
const preRead = derivedEvalLib.readFrozenBlock({ storeFilePath: entry.decisionStoreFilePath, blockId: derivedBlockId, roleName: 'derived' });
if (preRead.error) {
	refuse(preRead.error.message);
}
const preHeader = preRead.block.header;
const trailRead = renderingAuditLib.readPromptRecordList({
	forensicsDirPath: entry.matchForensicsDirPath,
	pairKey: `${preHeader.hubName.toLowerCase()}@${preHeader.hubVersion}::${preHeader.sourceStandardName.toLowerCase()}@${preHeader.sourceVersion}::${preHeader.bridgeName}::${preHeader.producerKind}`,
	generation: preHeader.generation,
});
if (trailRead.error) {
	refuse(trailRead.error.message);
}
const textIndex = renderingAuditLib.renderedCandidateTextIndexFrom({ recordList: trailRead.recordList });
if (textIndex.error) {
	refuse(textIndex.error.message);
}
// the per-field view of the SAME rendered bytes — the sameNameDifferentDomain class asks what distinguished
// two cards ON THE PAGE, so it reads the page, not the graph
const renderedFieldsByStableId = Object.keys(textIndex.textByStableId).reduce((soFar, oneStableId) => ({ ...soFar, [oneStableId]: renderingAuditLib.renderedFieldsFrom({ renderedText: textIndex.textByStableId[oneStableId] }) }), {});
const scored = derivedEvalLib.scoreDerivedRun({
	truthStoreFilePath: TRUTH_STORE_FILE_PATH,
	truthBlockId: TRUTH_BLOCK_ID,
	derivedStoreFilePath: entry.decisionStoreFilePath,
	derivedBlockId,
	ceilingRecallByK: ceilingRecallAt25 === undefined ? undefined : { 25: ceilingRecallAt25 },
	renderedCandidateTextByStableId: textIndex.textByStableId,
	renderedFieldsByStableId,
	// ⟪DR-4⟫ the UNBOUNDED curve measured by retrievalCeiling.js against DEV_edfiDerived_260817 on 2026-08-17.
	// Carried as DATA so the score document can print the answer to the K question beside the capped rows that
	// cannot answer it. Re-measure and replace these if the graph or the embedding model changes.
	measuredCeilingCurve: MEASURED_CEILING_CURVE,
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
