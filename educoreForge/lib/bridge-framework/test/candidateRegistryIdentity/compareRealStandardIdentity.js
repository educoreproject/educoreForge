#!/usr/bin/env node
'use strict';

// compareRealStandardIdentity.js <outDir> — the comparison half of runRealStandardIdentity.sh (lane C proof P2). For
// every pairKey, the latest frozen decision block of the base run against the branch run; for every forensics file, the
// two runs' records. Each side's OWN frameworkFingerprint (read from its blocks' headers, never typed in) and its own
// block hashes are replaced by tokens; nothing else is normalised.
//
// Forensics are compared as MULTISETS of whole records (each line, tokenised, sorted): judging is concurrent, so the
// append order of a forensics file is not deterministic, and a line-by-line comparison reports reordering as change.
// The frozen block has no such freedom (decisionBlock sorts its records), so it is compared byte for byte.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const fs = require('fs');
const path = require('path');
const Database = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', 'better-sqlite3'));

const outDirPath = process.argv[2];
if (typeof outDirPath !== 'string' || !fs.existsSync(path.join(outDirPath, 'base')) || !fs.existsSync(path.join(outDirPath, 'branch'))) {
	process.stderr.write(`${moduleName}: name the run directory holding base/ and branch/ (got ${JSON.stringify(outDirPath)})\n`);
	process.exit(1);
}

const readSide = (sideName) => {
	const database = new Database(path.join(outDirPath, sideName, `${sideName}.decisions.sqlite3`), { readonly: true });
	const rowList = database.prepare('SELECT seq, decisionBlockHash, pairKey, frozenText FROM decisionBlocks ORDER BY seq').all();
	database.close();
	const latestRowByPairKey = rowList.reduce((soFar, oneRow) => Object.assign(soFar, { [oneRow.pairKey]: oneRow }), {});
	const fingerprintList = Array.from(new Set(Object.keys(latestRowByPairKey).map((onePairKey) => JSON.parse(String(latestRowByPairKey[onePairKey].frozenText)).header.frameworkFingerprint)));
	if (fingerprintList.length !== 1) {
		process.stderr.write(`${moduleName}: ${sideName} blocks carry ${fingerprintList.length} frameworkFingerprints (${fingerprintList.join(', ')}); one run has one\n`);
		process.exit(1);
	}
	const tokenise = (text) =>
		Object.keys(latestRowByPairKey)
			.sort()
			.reduce((soFar, onePairKey) => soFar.split(latestRowByPairKey[onePairKey].decisionBlockHash).join(`<BLOCK ${onePairKey}>`), text.split(fingerprintList[0]).join('<FINGERPRINT>'));
	return { latestRowByPairKey, tokenise, frameworkFingerprint: fingerprintList[0], blockCount: rowList.length };
};

const sideByName = { base: readSide('base'), branch: readSide('branch') };
const reportLineList = [`fingerprints: base ${sideByName.base.frameworkFingerprint}, branch ${sideByName.branch.frameworkFingerprint}`];
let differenceCount = 0;

const pairKeyList = Array.from(new Set(Object.keys(sideByName.base.latestRowByPairKey).concat(Object.keys(sideByName.branch.latestRowByPairKey)))).sort();
pairKeyList.forEach((onePairKey) => {
	const baseRow = sideByName.base.latestRowByPairKey[onePairKey];
	const branchRow = sideByName.branch.latestRowByPairKey[onePairKey];
	if (baseRow === undefined || branchRow === undefined) {
		differenceCount += 1;
		reportLineList.push(`BLOCK ${onePairKey}: present only on ${baseRow === undefined ? 'branch' : 'base'}`);
		return;
	}
	const baseText = sideByName.base.tokenise(String(baseRow.frozenText));
	const branchText = sideByName.branch.tokenise(String(branchRow.frozenText));
	const recordCount = JSON.parse(String(baseRow.frozenText)).decisionRecordList.length;
	const isSame = baseText === branchText;
	differenceCount += isSame ? 0 : 1;
	reportLineList.push(`BLOCK ${onePairKey}: ${isSame ? 'IDENTICAL' : 'DIFFERENT'} (${recordCount} records, ${baseText.length} bytes; base ${baseRow.decisionBlockHash}, branch ${branchRow.decisionBlockHash})`);
});

const listFiles = (dirPath) =>
	fs.existsSync(dirPath)
		? fs.readdirSync(dirPath, { withFileTypes: true }).reduce((soFar, oneEntry) => soFar.concat(oneEntry.isDirectory() ? listFiles(path.join(dirPath, oneEntry.name)).map((oneName) => path.join(oneEntry.name, oneName)) : [oneEntry.name]), [])
		: [];
const recordMultisetOf = (sideName, fileName) =>
	fs
		.readFileSync(path.join(outDirPath, sideName, 'forensics', fileName), 'utf8')
		.split('\n')
		.filter((oneLine) => oneLine.length > 0)
		.map((oneLine) => sideByName[sideName].tokenise(oneLine))
		.sort();
const branchFileNameByTokenName = listFiles(path.join(outDirPath, 'branch', 'forensics')).reduce((soFar, oneName) => Object.assign(soFar, { [sideByName.branch.tokenise(oneName)]: oneName }), {});
const baseFileList = listFiles(path.join(outDirPath, 'base', 'forensics'));
let promptCount = 0;
baseFileList.forEach((oneName) => {
	const tokenName = sideByName.base.tokenise(oneName);
	const branchName = branchFileNameByTokenName[tokenName];
	if (branchName === undefined) {
		differenceCount += 1;
		reportLineList.push(`FORENSICS ${tokenName}: absent on branch`);
		return;
	}
	const baseRecordList = recordMultisetOf('base', oneName);
	const branchRecordList = recordMultisetOf('branch', branchName);
	promptCount += baseRecordList.filter((oneLine) => oneLine.indexOf('"userPrompt"') !== -1).length;
	const isSame = baseRecordList.join('\n') === branchRecordList.join('\n');
	differenceCount += isSame ? 0 : 1;
	reportLineList.push(`FORENSICS ${tokenName}: ${isSame ? 'IDENTICAL' : 'DIFFERENT'} as a record multiset (${baseRecordList.length} vs ${branchRecordList.length} records)`);
});
if (Object.keys(branchFileNameByTokenName).length !== baseFileList.length) {
	differenceCount += 1;
	reportLineList.push(`FORENSICS file count: base ${baseFileList.length}, branch ${Object.keys(branchFileNameByTokenName).length}`);
}
reportLineList.push(`blocks in the stores: base ${sideByName.base.blockCount}, branch ${sideByName.branch.blockCount}; forensics files ${baseFileList.length}; records carrying a userPrompt ${promptCount}`);
reportLineList.push(differenceCount === 0 ? 'P2 VERDICT: IDENTICAL' : `P2 VERDICT: ${differenceCount} DIFFERENCE(S)`);
process.stdout.write(`${reportLineList.join('\n')}\n`);
process.exit(differenceCount === 0 ? 0 : 1);
