#!/usr/bin/env node
'use strict';

// blockCompare.js — what two stores froze, compared without a graph or a build (R0 proof kit, 2026-10-21, step 4). The CLI
// over apps/graph-builder/lib/block-compare.js; it replaces the out-of-tree compareDecisionBlocks.js (ctdlHub P5) and
// manifestDiff.sh (ctdlHub P8), which resolved better-sqlite3 by absolute path into another worktree.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- compare two stores' frozen decision blocks, or two manifests, without a build (read-only)

SYNOPSIS
     ${moduleName} -decisionBlocks --baselineDecisionStorePath=<sqlite> --candidateDecisionStorePath=<sqlite> [-help]
     ${moduleName} -manifests --baselineStandardsDatabasePath=<sqlite> --baselineManifestRefId=<refId or prefix>
                  --candidateStandardsDatabasePath=<sqlite> --candidateManifestRefId=<refId or prefix> [-help]

DESCRIPTION
     Opens every store read-only and writes nothing.

     -decisionBlocks   per pairKey, the latest frozen block on each side. The candidate's text with its
                       frameworkFingerprint replaced by the baseline's must equal the baseline's text: the fingerprint
                       moves with any lib/bridge-framework or bridge-maker edit while the decisions do not, so a block id
                       or sha comparison would call every re-freeze a change. One line per pairKey:
                         IDENTICAL                 byte-equal frozen texts (the same block id)
                         ONLY_FINGERPRINT_DIFFERS  equal once the fingerprint is substituted
                         DIFFERENT                 something else moved; the differing header names are listed
                         BASELINE_ONLY             frozen in the baseline, absent from the candidate
                         CANDIDATE_ONLY            frozen in the candidate only
                       PASS when every pairKey is IDENTICAL or ONLY_FINGERPRINT_DIFFERS.

     -manifests        each manifest's members as (kind, subject, refId): baseline members absent from the candidate by
                       refId, a subject carried under a different refId, members only the candidate holds, and the
                       identical count. PASS when the member lists are identical. A refId prefix must name exactly one
                       manifest.

EXIT STATUS
     0 PASS;  1 a difference, or refused (missing argument, a path not on disk, an ambiguous manifest prefix).

EXAMPLES
     node apps/graph-builder/tools/blockCompare.js -decisionBlocks \\
          --baselineDecisionStorePath=<lane dataStore>/baseline/goldCtdlHub/decisions.sqlite3 --candidateDecisionStorePath=<run>/decisions.sqlite3
     node apps/graph-builder/tools/blockCompare.js -manifests \\
          --baselineStandardsDatabasePath=<lane dataStore>/baseline/goldCtdlHub/standards.sqlite3 --baselineManifestRefId=335e3c10 \\
          --candidateStandardsDatabasePath=<run>/standards.sqlite3 --candidateManifestRefId=<printed by -build>
`;

const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const { xLog, commandLineParameters } = process.global;
const blockCompareLib = require(path.join(__dirname, '..', 'lib', 'block-compare'));

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
const requireFlags = (flagNameList) => {
	const absentList = flagNameList.filter((flagName) => typeof flagValueOf(flagName) !== 'string' || flagValueOf(flagName) === '');
	if (absentList.length !== 0) {
		refuse(`required and absent: ${absentList.map((flagName) => `--${flagName}`).join(', ')}. There are no defaults.`);
	}
};

const runDecisionBlocks = () => {
	requireFlags(['baselineDecisionStorePath', 'candidateDecisionStorePath']);
	const compared = blockCompareLib.compareDecisionBlockStores({
		baselineDecisionStoreFilePath: flagValueOf('baselineDecisionStorePath'),
		candidateDecisionStoreFilePath: flagValueOf('candidateDecisionStorePath'),
	});
	if (compared.error) {
		refuse(compared.error);
	}
	compared.rowList.forEach((oneRow) => say(JSON.stringify(oneRow)));
	say(`${moduleName} -decisionBlocks: ${compared.rowList.length} pairKey(s); ${compared.passed ? 'PASS: every block is identical or differs ONLY in header.frameworkFingerprint' : 'FAIL'}`);
	return compared.passed;
};

const runManifests = () => {
	requireFlags(['baselineStandardsDatabasePath', 'baselineManifestRefId', 'candidateStandardsDatabasePath', 'candidateManifestRefId']);
	const compared = blockCompareLib.compareManifests({
		baselineStandardsDatabaseFilePath: flagValueOf('baselineStandardsDatabasePath'),
		baselineManifestRefId: flagValueOf('baselineManifestRefId'),
		candidateStandardsDatabaseFilePath: flagValueOf('candidateStandardsDatabasePath'),
		candidateManifestRefId: flagValueOf('candidateManifestRefId'),
	});
	if (compared.error) {
		refuse(compared.error);
	}
	const { comparison } = compared;
	const memberLine = (oneMember) => `  ${oneMember.kind} ${oneMember.subject} ${oneMember.refId}${oneMember.candidateRefId ? ` -> ${oneMember.candidateRefId}` : ''}`;
	say(`baseline members: ${comparison.baselineMemberCount}   candidate members: ${comparison.candidateMemberCount}`);
	say('== baseline refIds ABSENT from the candidate:');
	comparison.baselineOnlyList.forEach((oneMember) => say(memberLine(oneMember)));
	say('== the same subject under a DIFFERENT refId:');
	comparison.subjectMovedList.forEach((oneMember) => say(memberLine(oneMember)));
	say('== members ONLY in the candidate:');
	comparison.candidateOnlyList.forEach((oneMember) => say(memberLine(oneMember)));
	say(`== identical members: ${comparison.identicalCount}`);
	say(`${moduleName} -manifests: ${compared.passed ? 'PASS: identical member lists' : 'FAIL'}`);
	return compared.passed;
};

// the action registry: one row per action switch
const ACTION_BY_SWITCH_NAME = { decisionBlocks: runDecisionBlocks, manifests: runManifests };
const chosenSwitchNameList = Object.keys(ACTION_BY_SWITCH_NAME).filter((switchName) => commandLineParameters.switches[switchName]);
if (chosenSwitchNameList.length !== 1) {
	refuse(`exactly one action is required (-${Object.keys(ACTION_BY_SWITCH_NAME).join(' or -')}); given: ${chosenSwitchNameList.length === 0 ? 'none' : chosenSwitchNameList.map((switchName) => `-${switchName}`).join(' ')}`);
}
process.exit(ACTION_BY_SWITCH_NAME[chosenSwitchNameList[0]]() ? 0 : 1);
