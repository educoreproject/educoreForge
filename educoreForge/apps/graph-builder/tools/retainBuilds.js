#!/usr/bin/env node
'use strict';

// retainBuilds.js — automatic retention of a campaign's build stores (EC4, build-store economy, VELVET_RIDGE for BRONZE_CROWN,
// 2026-10-25). The CLI over apps/graph-builder/lib/build-retention.js; the rules are buildRetentionRules.json beside it.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- list (and, with --apply=true, delete) the build stores of a campaign that nothing keeps

SYNOPSIS
     ${moduleName} --campaignDirPath=<dir> [--gateReportPathList=<file>[,<file>...]]
                  [--foldTargetJudgmentCacheFilePath=<sqlite>] [--foldTargetVectorCacheFilePath=<sqlite>] [--apply=true] [-help]

DESCRIPTION
     READS every sqlite store under --campaignDirPath (symbolic links are not followed) and gives each one a verdict, with every
     reason: DELETE, KEEP or REFUSED. WITHOUT --apply=true IT WRITES AND DELETES NOTHING: the listing, with allocated sizes, is the
     whole output. With --apply=true it first writes a retention record (retentionRecord-<time>.json in the campaign directory),
     then deletes ONLY the DELETE stores and their -wal/-shm companions, asking lsof again immediately before each deletion.

     ONLY STORE FILES ARE EVER CANDIDATES (*.sqlite3, *.sqlite and their -wal/-shm). Logs, buildLogs/, forensics/,
     buildRequest.json, reports and every other file are never touched.

     KEEP, for any one of: a .buildOfRecord marker file in the store's directory or an ancestor up to the campaign directory (its
     content is your reason, for the next reader); a gate report (--gateReportPathList) whose text holds the store's directory
     path; a text file beside the store, or a run log beside its directory (<dirName>.*.log), naming a promoted graph (GOLD_ or
     GOLD_EVAL_ and six digits); a judgment or cached vector the store of record lacks (the fold has not happened; the stores of
     record are [stores] graphBuilderSupportFilePath for judgments and vectorCacheFilePath for cached vectors, unless the
     --foldTarget* flags name others); being the reference a kept delta store reads through.

     REFUSED, never touched, listed by name: a backup (a path segment containing 'backup', any case; anything under
     fileStash_Backups or MILO Backups), the P-a1 baseline ([noRebuildProof] baselineDirectoryPath), a configured store of
     record, a store a live process holds open (lsof), or one that cannot be read. A campaign directory that is itself protected,
     or contains the P-a1 baseline, is refused whole.

     The deletion of anything under system/dataStores is only ever this tool's --apply=true on a directory the supervisor names.

EXIT STATUS
     0 a plan was listed (or applied);  1 refused (a missing argument, a path not on disk, a protected campaign directory,
     an unreadable store of record), or an applied run that could not delete a DELETE store.

EXAMPLES
     node apps/graph-builder/tools/retainBuilds.js --campaignDirPath=/Users/tqwhite/educoreForgeScratch/ec/measure
          (lists; deletes nothing)
     node apps/graph-builder/tools/retainBuilds.js --campaignDirPath=<a directory BRONZE_CROWN named> --apply=true
          (DELETES the stores the listing marked DELETE)

FILES
     apps/graph-builder/lib/buildRetentionRules.json   the rules (patterns, marker name, protected locations)
     graphBuilder.ini [stores], [noRebuildProof]        the stores of record and the P-a1 baseline

NOTES
     Sizes are ALLOCATED bytes (blocks x 512). An APFS clone shares blocks with its source, so the space a deletion frees can be
     smaller than the listing; measure with df before and after.
`;

const path = require('path');
const { execFile } = require('child_process');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const { xLog, commandLineParameters, getConfig } = process.global;
const buildRetentionLib = require(path.join(__dirname, '..', 'lib', 'build-retention'));

const say = (lineText) => xLog.result(`${lineText}\n`);
const flagValueOf = (flagName) => {
	const flagValue = commandLineParameters.values[flagName];
	return Array.isArray(flagValue) ? flagValue[0] : flagValue;
};
const refuse = (reasonText) => {
	xLog.error(`${moduleName}: REFUSED: ${reasonText}\n(${moduleName} -help for the full page)`);
	process.exit(1);
};

// openFilePathSetFor — lsof over the listed files: the real paths a live process holds open. lsof exits 1 when none of them is
// open, which is an answer, not a fault; a missing lsof is a fault (the guard it provides would be silently absent).
const openFilePathSetFor = (filePathList, callback) => {
	if (filePathList.length === 0) {
		callback('', new Set());
		return;
	}
	execFile('lsof', ['-F', 'n', '--'].concat(filePathList), { maxBuffer: 64 * 1024 * 1024 }, (lsofErr, stdoutText) => {
		if (lsofErr && lsofErr.code === 'ENOENT') {
			callback('lsof is not on the PATH, so a store a live process holds open could not be refused');
			return;
		}
		callback('', new Set(String(stdoutText || '').split('\n').filter((oneLine) => oneLine.startsWith('n')).map((oneLine) => oneLine.slice(1))));
	});
};

const formatBytes = (byteCount) => `${(byteCount / 1e9).toFixed(3)} GB`;

const campaignDirPath = flagValueOf('campaignDirPath');
if (typeof campaignDirPath !== 'string' || campaignDirPath.trim() === '') {
	refuse('--campaignDirPath is required. There is no default.');
}
const applyText = flagValueOf('apply');
if (applyText !== undefined && applyText !== 'true') {
	refuse(`--apply must be 'true' when given (got '${applyText}'); without it the run lists and deletes nothing.`);
}
const storesConfig = getConfig('stores') || {};
const proofConfig = getConfig('noRebuildProof') || {};
const absentConfigList = [['[stores] graphBuilderSupportFilePath', storesConfig.graphBuilderSupportFilePath], ['[stores] vectorCacheFilePath', storesConfig.vectorCacheFilePath], ['[noRebuildProof] baselineDirectoryPath', proofConfig.baselineDirectoryPath]].filter((oneSetting) => typeof oneSetting[1] !== 'string' || oneSetting[1].trim() === '').map((oneSetting) => oneSetting[0]);
if (absentConfigList.length > 0) {
	refuse(`graphBuilder.ini lacks ${absentConfigList.join(', ')}: the stores of record and the P-a1 baseline must be known to be protected.`);
}
const gateReportListText = flagValueOf('gateReportPathList');
const gateReportPathList = typeof gateReportListText === 'string' && gateReportListText.trim() !== '' ? gateReportListText.split(',').map((onePath) => onePath.trim()).filter(Boolean) : [];
// a fold target: the flag when it speaks (a blank one is refused), else the configured store of record (documented in -help)
const foldTargetFor = (flagName, configuredFilePath) => {
	const flagValue = flagValueOf(flagName);
	if (typeof flagValue === 'string' && flagValue.trim() === '') {
		refuse(`--${flagName} was given but blank; name a store of record or omit it.`);
	}
	return flagValue === undefined ? configuredFilePath : flagValue;
};
const foldTargetFilePathByTableName = {
	judgmentCacheEntries: foldTargetFor('foldTargetJudgmentCacheFilePath', storesConfig.graphBuilderSupportFilePath),
	vectorCacheEntries: foldTargetFor('foldTargetVectorCacheFilePath', storesConfig.vectorCacheFilePath),
};

buildRetentionLib.planRetention(
	{
		campaignDirPath,
		gateReportPathList,
		foldTargetFilePathByTableName,
		storeOfRecordFilePathList: [storesConfig.graphBuilderSupportFilePath, storesConfig.vectorCacheFilePath],
		pa1BaselineDirectoryPath: proofConfig.baselineDirectoryPath,
		openFilePathSetFor,
	},
	(planErr, plan) => {
		if (planErr) {
			refuse(planErr);
		}
		say(`${moduleName}: ${plan.campaignDirPath}${applyText === 'true' ? '' : '   (DRY RUN: nothing is deleted)'}`);
		plan.storeList.forEach((oneStore) => {
			say(`  ${oneStore.verdict.padEnd(8)} ${formatBytes(oneStore.allocatedBytes).padStart(10)}  ${oneStore.filePath}`);
			oneStore.reasonList.forEach((reasonText) => say(`             ${reasonText}`));
		});
		say(`  DELETE ${plan.storeList.filter((oneStore) => oneStore.verdict === 'DELETE').length} store(s), ${formatBytes(plan.deleteAllocatedBytes)} allocated; KEEP ${plan.storeList.filter((oneStore) => oneStore.verdict === 'KEEP').length} (${formatBytes(plan.keepAllocatedBytes)}); REFUSED ${plan.storeList.filter((oneStore) => oneStore.verdict === 'REFUSED').length} (${formatBytes(plan.refusedAllocatedBytes)})`);
		if (applyText !== 'true') {
			process.exit(0);
		}
		const retentionRecordFilePath = path.join(plan.campaignDirPath, `retentionRecord-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
		buildRetentionLib.applyRetention({ plan, openFilePathSetFor, retentionRecordFilePath }, (applyErr, applied) => {
			if (applyErr) {
				refuse(applyErr);
			}
			applied.outcomeList.filter((oneOutcome) => !oneOutcome.deleted).forEach((oneOutcome) => say(`  NOT DELETED ${oneOutcome.filePath}: ${oneOutcome.note}`));
			say(`  APPLIED: deleted ${applied.deletedCount} store(s), ${formatBytes(applied.deletedAllocatedBytes)} allocated; record ${applied.retentionRecordFilePath}`);
			process.exit(applied.outcomeList.every((oneOutcome) => oneOutcome.deleted) ? 0 : 1);
		});
	},
);
