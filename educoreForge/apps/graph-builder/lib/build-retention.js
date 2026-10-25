'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// build-retention.js — which build stores a campaign may delete (EC4, build-store economy, VELVET_RIDGE for BRONZE_CROWN,
// 2026-10-25). The CLI is apps/graph-builder/tools/retainBuilds.js; the rules are DATA (buildRetentionRules.json beside this file).
//
// WHY. The nextStandards campaign kept every store it ever built (a lane ran 6-8 builds; zeroBacklog alone reached 216 GB), because
// builders were rightly told never to delete under dataStores/ and nothing was given the job. This module is that job, written so
// the dangerous direction is the hard one: a store is deleted only when NOTHING keeps it, and the reasons to keep are many.
//
// ONLY STORE FILES ARE CANDIDATES. A file is a candidate only when its NAME matches storeFileNamePatternText (sqlite databases) or is
// such a file's -wal/-shm companion. Logs, buildLogs/, forensics/, buildRequest.json and reports are never candidates: no rule can
// delete them because no rule ever sees them.
//
// KEPT (any one reason keeps a store; every reason found is listed):
//   buildOfRecord     a buildOfRecordMarkerFileName file in the store's directory or an ancestor up to the campaign directory
//   gateReport        a named gate report's text holds the store's directory path (as given, or its real path)
//   promotion         a text file in the store's directory, or a run log beside the directory (<dirName>.<anything>), mentions a
//                     promoted graph (GOLD_ or GOLD_EVAL_ and six digits): a store a GOLD graph was promoted from is never deleted
//   foldNeeded        it holds a judgment or cached vector whose address the store of record lacks (the fold has not happened)
//   noFoldTarget      it holds such rows and no store of record was named to compare against: kept, never guessed
//   deltaReference    it is the reference a KEPT delta reads through (lib/store-reference: a delta never opens without it)
// REFUSED (never touched, listed by name): a backup (a path segment matching backupSegmentPatternText, or a protectedPathFragmentList
// entry such as fileStash_Backups or MILO Backups), the P-a1 baseline, a configured store of record, or a file a live process holds
// open (the CLI asks lsof). A campaign directory that is itself protected is refused whole.
//
//   planRetention({ campaignDirPath, gateReportPathList, foldTargetFilePathByTableName, storeOfRecordFilePathList,
//                   pa1BaselineDirectoryPath, openFilePathSetFor }, callback) -> ('', plan) | (refusal)
//      plan.storeList [{ filePath, dirPath, companionFilePathList, allocatedBytes, verdict: 'DELETE'|'KEEP'|'REFUSED', reasonList }]
//   applyRetention({ plan, openFilePathSetFor, retentionRecordFilePath }, callback) -> ('', { deletedList, ... }) | (refusal)
//      deletes ONLY the plan's DELETE stores (and their companions), re-asking openFilePathSetFor first; writes the record
//   openFilePathSetFor(filePathList, callback) -> ('', Set of real paths a live process holds open) — injected (lsof in the CLI)
//
// ALLOCATED BYTES are stat.blocks x 512, not the apparent size. An APFS clone shares blocks with its source, which no per-file number
// can see, so the real space a deletion frees can be less than the listing says (measure with df, before and after).
//
// Async style: callback(errString, result); camelCase only; no async/await.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const retentionRules = require(path.join(__dirname, 'buildRetentionRules.json'));
const ADDRESS_SEPARATOR = '\u0000';

const storeFileNamePattern = new RegExp(retentionRules.storeFileNamePatternText);
const backupSegmentPattern = new RegExp(retentionRules.backupSegmentPatternText, 'i');
const promotionEvidencePattern = new RegExp(retentionRules.promotionEvidencePatternText);
const promotionEvidenceFileNamePattern = new RegExp(retentionRules.promotionEvidenceFileNamePatternText);

// attemptFs — the ONE boundary where a filesystem or better-sqlite3 exception becomes an error string
const attemptFs = (work) => {
	let result = null;
	let fault = '';
	try {
		result = work();
	} catch (thrownError) {
		fault = thrownError.message;
	}
	return fault ? { error: fault } : { result };
};
const realPathOf = (filePath) => {
	const resolved = attemptFs(() => fs.realpathSync(filePath));
	return resolved.error ? path.resolve(filePath) : resolved.result;
};
const isUnder = (filePath, dirPath) => filePath === dirPath || filePath.startsWith(`${dirPath}${path.sep}`);

// segmentsBelowVolumeName — a path's segments, without a mounted volume's own name: /Volumes/<name>/... names a DEVICE, and the
// scratch SSD's is 'qMaxBackup - Data', which is no backup of anything (measured: the first dry run refused the whole SSD on it)
const segmentsBelowVolumeName = (filePath) => {
	const segmentList = filePath.split(path.sep);
	return isUnder(filePath, retentionRules.volumeMountRootPath) ? segmentList.slice(retentionRules.volumeMountRootPath.split(path.sep).length + 1) : segmentList;
};

// protectionReasonFor — why a path may never be touched, or '' (the path as given and its real path are both checked)
const protectionReasonFor = ({ filePath, pa1BaselineRealPath, storeOfRecordRealPathList }) => {
	const realPath = realPathOf(filePath);
	const fragment = retentionRules.protectedPathFragmentList.find((oneFragment) => filePath.indexOf(oneFragment) !== -1 || realPath.indexOf(oneFragment) !== -1);
	if (fragment) {
		return `a protected backup location ('${fragment.replace(/\//g, '')}')`;
	}
	const backupSegment = segmentsBelowVolumeName(filePath).concat(segmentsBelowVolumeName(realPath)).find((oneSegment) => backupSegmentPattern.test(oneSegment));
	if (backupSegment) {
		return `a backup (path segment '${backupSegment}')`;
	}
	if (pa1BaselineRealPath && isUnder(realPath, pa1BaselineRealPath)) {
		return `the P-a1 baseline ([noRebuildProof] baselineDirectoryPath ${pa1BaselineRealPath})`;
	}
	if (storeOfRecordRealPathList.indexOf(realPath) !== -1) {
		return 'a configured store of record ([stores])';
	}
	return '';
};

// collectStoreFileList — every store file under the directory (symbolic links are not followed: a link can lead out of the campaign)
const collectStoreFileList = (dirPath) => {
	const listed = attemptFs(() => fs.readdirSync(dirPath, { withFileTypes: true }));
	if (listed.error) {
		return { error: `reading '${dirPath}': ${listed.error}` };
	}
	return listed.result.reduce(
		(soFar, oneEntry) => {
			if (soFar.error) {
				return soFar;
			}
			const entryPath = path.join(dirPath, oneEntry.name);
			if (oneEntry.isDirectory()) {
				const below = collectStoreFileList(entryPath);
				return below.error ? below : { fileList: soFar.fileList.concat(below.fileList) };
			}
			return oneEntry.isFile() && storeFileNamePattern.test(oneEntry.name) ? { fileList: soFar.fileList.concat([entryPath]) } : soFar;
		},
		{ fileList: [] },
	);
};

const allocatedBytesOf = (filePathList) => filePathList.reduce((soFar, filePath) => soFar + (fs.existsSync(filePath) ? fs.statSync(filePath).blocks * 512 : 0), 0);

// markerPathFor — the nearest buildOfRecord marker from the store's directory up to (and including) the campaign directory
const markerPathFor = ({ dirPath, campaignDirPath }) => {
	const markerPath = path.join(dirPath, retentionRules.buildOfRecordMarkerFileName);
	if (fs.existsSync(markerPath)) {
		return markerPath;
	}
	return dirPath === campaignDirPath || !isUnder(dirPath, campaignDirPath) ? '' : markerPathFor({ dirPath: path.dirname(dirPath), campaignDirPath });
};

// promotionEvidenceFor — the first file beside the store (or the run log beside its directory) that names a promoted graph
const promotionEvidenceFor = ({ dirPath }) => {
	const besideList = attemptFs(() => fs.readdirSync(dirPath).filter((oneName) => promotionEvidenceFileNamePattern.test(oneName)).map((oneName) => path.join(dirPath, oneName)));
	const runLogList = attemptFs(() => fs.readdirSync(path.dirname(dirPath)).filter((oneName) => oneName.startsWith(`${path.basename(dirPath)}.`) && promotionEvidenceFileNamePattern.test(oneName)).map((oneName) => path.join(path.dirname(dirPath), oneName)));
	const candidateList = (besideList.result || []).concat(runLogList.result || []);
	const evidenceFilePath = candidateList.find((filePath) => {
		const read = attemptFs(() => fs.readFileSync(filePath, 'utf8'));
		return !read.error && promotionEvidencePattern.test(read.result);
	});
	return evidenceFilePath || '';
};

// foldNeedFor — for each fold-needed table the store holds: how many of its addresses the store of record lacks (0 = folded)
const foldNeedFor = ({ filePath, targetAddressSetByTableName, foldTargetFilePathByTableName }) => {
	const opened = attemptFs(() => new Database(filePath, { readonly: true, fileMustExist: true }));
	if (opened.error) {
		return { error: `opening '${filePath}' read-only: ${opened.error}` };
	}
	const counted = attemptFs(() =>
		retentionRules.foldNeededTableList
			.filter((tableRow) => opened.result.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).all(tableRow.tableName).length > 0)
			.map((tableRow) => {
				const targetAddressSet = targetAddressSetByTableName[tableRow.tableName];
				if (!targetAddressSet) {
					return { tableRow, rowCount: opened.result.prepare(`SELECT COUNT(*) AS rowCount FROM ${tableRow.tableName}`).get().rowCount, unfoldedCount: null };
				}
				let unfoldedCount = 0;
				let rowCount = 0;
				for (const oneRow of opened.result.prepare(`SELECT ${tableRow.addressColumnList.join(', ')} FROM ${tableRow.tableName}`).iterate()) {
					rowCount += 1;
					if (!targetAddressSet.has(tableRow.addressColumnList.map((columnName) => String(oneRow[columnName])).join(ADDRESS_SEPARATOR))) {
						unfoldedCount += 1;
					}
				}
				return { tableRow, rowCount, unfoldedCount };
			}),
	);
	opened.result.close();
	if (counted.error) {
		return { error: `reading '${filePath}': ${counted.error}` };
	}
	return {
		reasonList: counted.result
			.filter((oneCount) => oneCount.rowCount > 0 && (oneCount.unfoldedCount === null || oneCount.unfoldedCount > 0))
			.map((oneCount) =>
				oneCount.unfoldedCount === null
					? { reasonName: 'noFoldTarget', reasonText: `holds ${oneCount.rowCount} ${oneCount.tableRow.rowWord}(s) and no store of record was named for ${oneCount.tableRow.tableName}: kept, not guessed` }
					: { reasonName: 'foldNeeded', reasonText: `holds ${oneCount.unfoldedCount} ${oneCount.tableRow.rowWord}(s) the store of record '${foldTargetFilePathByTableName[oneCount.tableRow.tableName]}' lacks: fold first` },
			),
	};
};

// referencePathListOf — the references a delta store is stamped with (lib/store-reference's storeReferenceStamps), [] for a standalone
const referencePathListOf = (filePath) => {
	const read = attemptFs(() => {
		const connection = new Database(filePath, { readonly: true, fileMustExist: true });
		const hasStamps = connection.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='storeReferenceStamps'`).all().length > 0;
		const stampList = hasStamps ? connection.prepare('SELECT referenceDatabaseFilePath FROM storeReferenceStamps').all() : [];
		connection.close();
		return stampList.map((oneStamp) => realPathOf(oneStamp.referenceDatabaseFilePath));
	});
	return read.error ? [] : read.result;
};

const targetAddressSetFor = ({ filePath, tableRow }) => {
	const read = attemptFs(() => {
		const connection = new Database(filePath, { readonly: true, fileMustExist: true });
		const addressSet = new Set(connection.prepare(`SELECT ${tableRow.addressColumnList.join(', ')} FROM ${tableRow.tableName}`).all().map((oneRow) => tableRow.addressColumnList.map((columnName) => String(oneRow[columnName])).join(ADDRESS_SEPARATOR)));
		connection.close();
		return addressSet;
	});
	return read.error ? { error: `reading the store of record '${filePath}' (${tableRow.tableName}): ${read.error}` } : { addressSet: read.result };
};

// -----
// planRetention — read-only: the verdict on every store file under the campaign directory, with every reason
const planRetention = ({ campaignDirPath, gateReportPathList = [], foldTargetFilePathByTableName = {}, storeOfRecordFilePathList = [], pa1BaselineDirectoryPath, openFilePathSetFor }, callback) => {
	if (typeof campaignDirPath !== 'string' || campaignDirPath.trim() === '' || !fs.existsSync(campaignDirPath) || !fs.statSync(campaignDirPath).isDirectory()) {
		callback(`${moduleName}: campaignDirPath '${campaignDirPath}' is not an existing directory; there is no default`);
		return;
	}
	if (typeof pa1BaselineDirectoryPath !== 'string' || pa1BaselineDirectoryPath.trim() === '') {
		callback(`${moduleName}: the P-a1 baseline path ([noRebuildProof] baselineDirectoryPath) is REQUIRED: without it the baseline could not be refused by name, so nothing is planned`);
		return;
	}
	if (typeof openFilePathSetFor !== 'function') {
		callback(`${moduleName}: openFilePathSetFor is REQUIRED: without it a store a live process holds open could not be refused`);
		return;
	}
	const absoluteCampaignDirPath = path.resolve(campaignDirPath);
	const pa1BaselineRealPath = realPathOf(pa1BaselineDirectoryPath);
	const storeOfRecordRealPathList = storeOfRecordFilePathList.concat(Object.values(foldTargetFilePathByTableName)).map(realPathOf);
	const campaignProtection = protectionReasonFor({ filePath: absoluteCampaignDirPath, pa1BaselineRealPath, storeOfRecordRealPathList });
	if (campaignProtection || isUnder(pa1BaselineRealPath, realPathOf(absoluteCampaignDirPath))) {
		callback(`${moduleName}: REFUSED — the campaign directory '${absoluteCampaignDirPath}' ${campaignProtection ? `is ${campaignProtection}` : `contains the P-a1 baseline '${pa1BaselineRealPath}'`}; retention never runs over it`);
		return;
	}
	const missingReportList = gateReportPathList.filter((reportPath) => !fs.existsSync(reportPath));
	if (missingReportList.length > 0) {
		callback(`${moduleName}: gate report(s) not on disk: ${missingReportList.join(', ')}. A build of record named by a report that cannot be read would be deleted; nothing is planned.`);
		return;
	}
	const gateReportTextList = gateReportPathList.map((reportPath) => ({ reportPath, reportText: fs.readFileSync(reportPath, 'utf8') }));
	const targetAddressSetByTableName = {};
	const targetError = retentionRules.foldNeededTableList.reduce((firstError, tableRow) => {
		const targetFilePath = foldTargetFilePathByTableName[tableRow.tableName];
		if (firstError || targetFilePath === undefined) {
			return firstError;
		}
		const loaded = targetAddressSetFor({ filePath: targetFilePath, tableRow });
		targetAddressSetByTableName[tableRow.tableName] = loaded.addressSet;
		return loaded.error || '';
	}, '');
	if (targetError) {
		callback(`${moduleName}: ${targetError}`);
		return;
	}
	const collected = collectStoreFileList(absoluteCampaignDirPath);
	if (collected.error) {
		callback(`${moduleName}: ${collected.error}`);
		return;
	}
	const allFilePathList = collected.fileList.reduce((soFar, filePath) => soFar.concat([filePath], retentionRules.companionSuffixList.map((suffix) => `${filePath}${suffix}`).filter((companionPath) => fs.existsSync(companionPath))), []);
	openFilePathSetFor(allFilePathList, (openErr, openRealPathSet) => {
		if (openErr) {
			callback(`${moduleName}: asking which stores a live process holds open: ${openErr}`);
			return;
		}
		const planned = collected.fileList.map((filePath) => {
			const dirPath = path.dirname(filePath);
			const companionFilePathList = retentionRules.companionSuffixList.map((suffix) => `${filePath}${suffix}`).filter((companionPath) => fs.existsSync(companionPath));
			const allocatedBytes = allocatedBytesOf([filePath].concat(companionFilePathList));
			const protection = protectionReasonFor({ filePath, pa1BaselineRealPath, storeOfRecordRealPathList });
			const openPath = [filePath].concat(companionFilePathList).find((oneFilePath) => openRealPathSet.has(realPathOf(oneFilePath)));
			const refusalList = [protection ? `is ${protection}` : '', openPath ? `held open by a live process ('${path.basename(openPath)}')` : ''].filter(Boolean);
			const reasonList = [];
			const markerPath = markerPathFor({ dirPath, campaignDirPath: absoluteCampaignDirPath });
			if (markerPath) {
				reasonList.push({ reasonName: 'buildOfRecord', reasonText: `build of record (marker ${markerPath})` });
			}
			const namingReport = gateReportTextList.find((oneReport) => oneReport.reportText.indexOf(dirPath) !== -1 || oneReport.reportText.indexOf(realPathOf(dirPath)) !== -1);
			if (namingReport) {
				reasonList.push({ reasonName: 'gateReport', reasonText: `named by gate report ${namingReport.reportPath}` });
			}
			const promotionFilePath = promotionEvidenceFor({ dirPath });
			if (promotionFilePath) {
				reasonList.push({ reasonName: 'promotion', reasonText: `a promoted graph is named in ${promotionFilePath}` });
			}
			const foldNeed = refusalList.length > 0 ? { reasonList: [] } : foldNeedFor({ filePath, targetAddressSetByTableName, foldTargetFilePathByTableName });
			if (foldNeed.error) {
				refusalList.push(`unreadable, so whether a fold still needs it is unknown (${foldNeed.error})`);
			}
			return { filePath, dirPath, companionFilePathList, allocatedBytes, refusalList, reasonList: reasonList.concat(foldNeed.reasonList || []), referenceRealPathList: refusalList.length > 0 ? [] : referencePathListOf(filePath) };
		});
		// a kept delta's references are kept with it, to a fixed point (a reference may itself be a kept delta)
		const keptRealPathSet = new Set(planned.filter((oneStore) => oneStore.refusalList.length > 0 || oneStore.reasonList.length > 0).map((oneStore) => realPathOf(oneStore.filePath)));
		let addedAReference = true;
		while (addedAReference) {
			addedAReference = false;
			planned.forEach((oneStore) => {
				if (!keptRealPathSet.has(realPathOf(oneStore.filePath))) {
					return;
				}
				oneStore.referenceRealPathList.forEach((referenceRealPath) => {
					const referencedStore = planned.find((candidateStore) => realPathOf(candidateStore.filePath) === referenceRealPath);
					if (referencedStore && !keptRealPathSet.has(referenceRealPath)) {
						referencedStore.reasonList.push({ reasonName: 'deltaReference', reasonText: `the reference the kept delta ${oneStore.filePath} reads through` });
						keptRealPathSet.add(referenceRealPath);
						addedAReference = true;
					}
				});
			});
		}
		const storeList = planned.map((oneStore) => ({
			filePath: oneStore.filePath,
			dirPath: oneStore.dirPath,
			companionFilePathList: oneStore.companionFilePathList,
			allocatedBytes: oneStore.allocatedBytes,
			verdict: oneStore.refusalList.length > 0 ? 'REFUSED' : oneStore.reasonList.length > 0 ? 'KEEP' : 'DELETE',
			reasonList: oneStore.refusalList.length > 0 ? oneStore.refusalList : oneStore.reasonList.map((oneReason) => oneReason.reasonText),
		}));
		const bytesFor = (verdict) => storeList.filter((oneStore) => oneStore.verdict === verdict).reduce((soFar, oneStore) => soFar + oneStore.allocatedBytes, 0);
		callback('', { campaignDirPath: absoluteCampaignDirPath, storeList, deleteAllocatedBytes: bytesFor('DELETE'), keepAllocatedBytes: bytesFor('KEEP'), refusedAllocatedBytes: bytesFor('REFUSED') });
	});
};

// -----
// applyRetention — delete the plan's DELETE stores and nothing else. Every DELETE store and companion is checked AGAIN for a live
// holder immediately before the deletion (a build may have started since the plan); one that is open is skipped and listed. The
// record of what was deleted is written FIRST, so an interrupted run still says what it set out to remove.
const applyRetention = ({ plan, openFilePathSetFor, retentionRecordFilePath }, callback) => {
	if (!plan || !Array.isArray(plan.storeList) || typeof retentionRecordFilePath !== 'string' || retentionRecordFilePath.trim() === '') {
		callback(`${moduleName}.applyRetention: a plan from planRetention and a retentionRecordFilePath are both REQUIRED`);
		return;
	}
	const deleteStoreList = plan.storeList.filter((oneStore) => oneStore.verdict === 'DELETE');
	const deleteFilePathList = deleteStoreList.reduce((soFar, oneStore) => soFar.concat([oneStore.filePath], oneStore.companionFilePathList), []);
	const recorded = attemptFs(() => fs.writeFileSync(retentionRecordFilePath, `${JSON.stringify({ plannedAt: new Date().toISOString(), campaignDirPath: plan.campaignDirPath, deleteStoreList }, null, 2)}\n`));
	if (recorded.error) {
		callback(`${moduleName}.applyRetention: writing the retention record '${retentionRecordFilePath}' failed, so nothing was deleted: ${recorded.error}`);
		return;
	}
	openFilePathSetFor(deleteFilePathList, (openErr, openRealPathSet) => {
		if (openErr) {
			callback(`${moduleName}.applyRetention: asking which stores a live process holds open, so nothing was deleted: ${openErr}`);
			return;
		}
		const outcomeList = deleteStoreList.map((oneStore) => {
			const storeFilePathList = [oneStore.filePath].concat(oneStore.companionFilePathList);
			if (storeFilePathList.some((oneFilePath) => openRealPathSet.has(realPathOf(oneFilePath)))) {
				return { filePath: oneStore.filePath, deleted: false, note: 'held open by a live process at deletion time: skipped' };
			}
			const removed = attemptFs(() => storeFilePathList.forEach((oneFilePath) => fs.rmSync(oneFilePath, { force: true })));
			return { filePath: oneStore.filePath, deleted: !removed.error, allocatedBytes: oneStore.allocatedBytes, note: removed.error || '' };
		});
		callback('', { retentionRecordFilePath, outcomeList, deletedCount: outcomeList.filter((oneOutcome) => oneOutcome.deleted).length, deletedAllocatedBytes: outcomeList.filter((oneOutcome) => oneOutcome.deleted).reduce((soFar, oneOutcome) => soFar + oneOutcome.allocatedBytes, 0) });
	});
};

module.exports = { planRetention, applyRetention, retentionRules };
