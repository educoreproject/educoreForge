#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// scratchRunCheckpointArtifacts.js — the PATH-PARAMETERISED TWIN of derivedCheckpointArtifacts.js, for
// scoring a run whose decision store and forensics trail are NOT the acceptance harness's own.
//
// WHY IT EXISTS (judgeProviderRegistry JOB 7, STEEL_SUMMIT, 2026-09-08; DAWN_TOWER ruling).
// derivedCheckpointArtifacts.js takes the decision store and the forensics dir from
// acceptanceCommands.jsonc's entry and offers NO command-line override for either. JOB 7 must rebridge with
// a different judge while writing NOTHING canonical, so its stores live in scratch — and the scorer cannot
// see them. Worse than not seeing them: the generation string is composed from framework version, plugin
// version and RENDERER version and does NOT encode the judge (evidenceRenderer.js:48,
// DERIVED_RENDERER_VERSION = 'bridgeEvidenceRenderer-derived-v1'), so a second judge's run of the same
// generation writes to a file of the SAME NAME as the first's. Pointed at the canonical forensics dir, an
// Ollama rebridge would APPEND its records to the 2026-08-17 yardstick's own trail. That is unrecoverable,
// and it is the reason this file exists rather than a --matchForensicsDirPath being added to its twin.
//
// WHAT IT IS NOT. It is not a second opinion and it does not re-derive anything. derivedEval.scoreDerivedRun
// and renderingAudit.buildRenderingAudit already take their paths as ARGUMENTS — all the reasoning lives
// there — so this file differs from its twin ONLY in where the two paths come from. The TRUTH store, the
// TRUTH block id and the measured ceiling curve are COPIED VERBATIM from the twin and are deliberately NOT
// parameterised: a scorer that could be pointed at a different truth is a scorer whose numbers cannot be
// compared to 80.9%, which is the one thing this instrument exists to make possible.
//
// PROVEN BEFORE USE, NOT ASSERTED EQUIVALENT. Aimed at the CANONICAL paths and the 08-17 block it must emit
// a score JSON whose sha256 is 60e1ac572b9bbfb4995fc21b9a6762251e6170cbd8a2a6029492ba0c414cf8de — byte-
// identical to the artifact of 2026-08-17. An instrument that reproduces a known answer exactly is evidence;
// one believed equivalent is a claim. Run that proof before trusting any number this file prints.
//
//   node apps/graph-builder/test/bridgeAcceptance/scratchRunCheckpointArtifacts.js \
//     --bridgeName=edfiCedsDerivedPlugin --derivedBlockId=<64-hex> \
//     --derivedStoreFilePath=<path> --matchForensicsDirPath=<dir> --outDirPath=<dir> [--sampleCount=5]
//
// EVERY PARAMETER IS REQUIRED AND REFUSED BY NAME. There is no default for any of the three paths — and
// especially not for --outDirPath, whose default in the twin is the CANONICAL artifact directory, which is
// the one place this file must never write. Absence is the shape a silent overwrite needs.
//
// READ-ONLY on all three stores. It never builds, never judges, never writes to a decision store. (A
// read-only better-sqlite3 connection to a WAL database still materialises the -shm index beside the file;
// that is SQLite's, not this tool's, and a name+size+mtime census over a store directory will show it.)

const fs = require('fs');
const path = require('path');

const helpText = () => `
NAME
     ${moduleName} -- score a SCRATCH derived run (score + rendering audit) against the standing truth block

SYNOPSIS
     ${moduleName} --bridgeName=<plugin> --derivedBlockId=<64-hex> --derivedStoreFilePath=<path>
                   --matchForensicsDirPath=<dir> --outDirPath=<dir> [--sampleCount=N]

DESCRIPTION
     The path-parameterised twin of derivedCheckpointArtifacts.js. Identical computation; the decision
     store and forensics dir are NAMED rather than read from acceptanceCommands.jsonc, so a run that
     wrote nothing canonical can still be scored against the same truth block as the 2026-08-17 yardstick.

EXIT STATUS
     0 written;  1 refused by name.
`;
const commandLineParameters = require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const { xLog } = process.global;

const derivedEvalLib = require('./derivedEval');
const renderingAuditLib = require('./renderingAudit');

// COPIED VERBATIM from derivedCheckpointArtifacts.js and deliberately not parameterised — see the header.
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

// THE ONLY THING STILL TAKEN FROM THE ENTRY IS standardKey, and only to locate the plugin file. The
// DECLARATION remains the authority for the allow-list the audit prints — read from the plugin itself,
// never restated here, so the document cannot describe an allow-list the run did not use. The two STORE
// paths are named on the command line instead; that difference is this file's whole reason to exist.
const pluginFilePath = path.join(__dirname, '..', '..', '..', '..', 'forges', entry.standardKey, 'bridges', `${bridgeName}.js`);
if (!fs.existsSync(pluginFilePath)) {
	refuse(`the plugin is not on disk at ${pluginFilePath}`);
}
const bridgeDeclaration = require(pluginFilePath).bridgeDeclaration;

// ⟪DR-11⟫ inherited from the twin: resolving a block by store order is how a score silently lands on a debug
// block or a PARTIAL window, so the id is REQUIRED and named, and the old spelling is refused BY NAME.
const askedBlockId = firstValue('derivedBlockId');
if (askedBlockId === 'latest') {
	refuse("--derivedBlockId=latest is no longer accepted: the newest row in a store can be a debug block, a PARTIAL window, or another run entirely (F-C2). Name the 64-hex block id.");
}
if (typeof askedBlockId !== 'string' || !/^[0-9a-f]{64}$/.test(askedBlockId)) {
	refuse(`--derivedBlockId must be the 64-hex id of the block to score (got ${JSON.stringify(askedBlockId)}); there is no default and no 'latest'`);
}
const derivedBlockId = askedBlockId;

// THE THREE PATHS THIS FILE ADDS. Each is required and refused BY NAME, with no default whatsoever.
// --outDirPath in particular: the twin defaults it to the directory holding the 2026-08-17 yardstick
// artifacts, and a twin that inherited that default would overwrite the very thing it is measured against.
const derivedStoreFilePath = firstValue('derivedStoreFilePath');
if (typeof derivedStoreFilePath !== 'string' || derivedStoreFilePath === '') {
	refuse('--derivedStoreFilePath is required; there is no default. Name the decision store holding the block to score.');
}
if (!fs.existsSync(derivedStoreFilePath)) {
	refuse(`--derivedStoreFilePath names no file on disk: ${derivedStoreFilePath}`);
}
const matchForensicsDirPath = firstValue('matchForensicsDirPath');
if (typeof matchForensicsDirPath !== 'string' || matchForensicsDirPath === '') {
	refuse('--matchForensicsDirPath is required; there is no default. Name the forensics dir holding this run\'s rendering trail.');
}
if (!fs.existsSync(matchForensicsDirPath)) {
	refuse(`--matchForensicsDirPath names no directory on disk: ${matchForensicsDirPath}`);
}
const outDirPath = firstValue('outDirPath');
if (typeof outDirPath !== 'string' || outDirPath === '') {
	refuse('--outDirPath is required; there is no default. The twin defaults it to the canonical artifact directory, which is exactly where this tool must not write.');
}
if (!fs.existsSync(outDirPath)) {
	refuse(`--outDirPath names no directory on disk: ${outDirPath}`);
}

const ceilingRecallAt25 = firstValue('ceilingRecallAt25') === undefined ? undefined : Number(firstValue('ceilingRecallAt25'));
if (ceilingRecallAt25 !== undefined && (!Number.isFinite(ceilingRecallAt25) || ceilingRecallAt25 < 0 || ceilingRecallAt25 > 1)) {
	refuse(`--ceilingRecallAt25 ${JSON.stringify(firstValue('ceilingRecallAt25'))} is not a recall fraction in [0, 1]`);
}

// the RENDERING-TIE index must be built BEFORE scoring, because the score needs it — so the block is
// resolved first, its generation read, and the trail parsed. Supplying it is what turns renderingTieMeasured
// true; a score written without it says so in words rather than reporting a zero it never measured.
const preRead = derivedEvalLib.readFrozenBlock({ storeFilePath: derivedStoreFilePath, blockId: derivedBlockId, roleName: 'derived' });
if (preRead.error) {
	refuse(preRead.error.message);
}
const preHeader = preRead.block.header;
const trailRead = renderingAuditLib.readPromptRecordList({
	forensicsDirPath: matchForensicsDirPath,
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
	derivedStoreFilePath,
	derivedBlockId,
	ceilingRecallByK: ceilingRecallAt25 === undefined ? undefined : { 25: ceilingRecallAt25 },
	renderedCandidateTextByStableId: textIndex.textByStableId,
	renderedFieldsByStableId,
	// ⟪DR-4⟫ the UNBOUNDED curve measured by retrievalCeiling.js against DEV_edfiDerived_260817 on 2026-08-17.
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
const blockRead = derivedEvalLib.readFrozenBlock({ storeFilePath: derivedStoreFilePath, blockId: resolvedBlockId, roleName: 'derived' });
if (blockRead.error) {
	refuse(blockRead.error.message);
}
const header = blockRead.block.header;
const pairKey = `${header.hubName.toLowerCase()}@${header.hubVersion}::${header.sourceStandardName.toLowerCase()}@${header.sourceVersion}::${header.bridgeName}::${header.producerKind}`;
const audit = renderingAuditLib.buildRenderingAudit({
	forensicsDirPath: matchForensicsDirPath,
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
xLog.status(`  derived store → ${derivedStoreFilePath}`);
xLog.status(`  forensics     → ${matchForensicsDirPath}`);
xLog.status(`  score         → derivedScore-${resolvedBlockId}.json / .md`);
xLog.status(`  audit         → renderingAudit-${resolvedBlockId}.md (${audit.promptCount} prompt(s), ${audit.hitList.length} id-gate hit(s), ${audit.advisoryUrlCount} advisory URL prompt(s))`);
xLog.status(`  recall@1/5/15/25 = ${[1, 5, 15, 25].map((oneK) => `${oneK}:${scored.score.retrieval.recallByK[oneK] === null || scored.score.retrieval.recallByK[oneK] === undefined ? '—' : (scored.score.retrieval.recallByK[oneK] * 100).toFixed(1) + '%'}`).join('  ')}`);
xLog.result(JSON.stringify({ derivedBlockId: resolvedBlockId, truthBlockId: TRUTH_BLOCK_ID, idGateHitCount: audit.hitList.length, promptCount: audit.promptCount, population: scored.score.population, judgment: scored.score.judgment, abstentionQuality: scored.score.abstentionQuality }, null, '\t'));
