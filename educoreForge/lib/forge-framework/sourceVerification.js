'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sourceVerification.js — provenance.verifySnapshotChecksums (SPEC-forgeFramework-v1.md §3.3,
// §6.1 step 2; Profile §4.1, §10.1; FR8). The ONE module that serves forge time AND the validator's
// intake: every forge, from day one, consumes only bytes verified against the snapshot's SHA256SUMS
// (Profile §13.1 P11/C5 are discharged BY CONSTRUCTION here).
//
// SEMANTICS (FR8):
//   - a caller-named file ABSENT from SHA256SUMS      → refused, naming the file
//   - a listed file missing or mismatched on disk      → refused, naming the file and the recipe
//   - a file on disk the list does not name            → IGNORED (every snapshot carries
//     README_PROVENANCE.md, SHA256SUMS, standardSourceLocation beside the bytes)
//   - no relativePathList given                        → every LISTED file is verified
//   - SHA256SUMS absent                                → refused, naming the path
//
// SHA256SUMS line format (code fact, every snapshot in the tree): `<64-hex><two spaces><relative path>`.
// callback(errString, { verifiedFileList }) — the orchestration-side shape; sync fs at the leaf.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const refuse = require('./refuse');

const CHECKSUM_FILE_NAME = 'SHA256SUMS';
const RECIPE_FILE_NAME = 'README_PROVENANCE.md';
const CHECKSUM_LINE_RE = /^([0-9a-f]{64})[ \t]+\*?(.+?)\s*$/;

const parseChecksumFile = (checksumFileText) =>
	checksumFileText
		.split('\n')
		.map((oneLine) => oneLine.trim())
		.filter((oneLine) => oneLine.length > 0 && !oneLine.startsWith('#'))
		.map((oneLine) => {
			const lineMatch = oneLine.match(CHECKSUM_LINE_RE);
			return lineMatch ? { expectedSha256: lineMatch[1], relativePath: lineMatch[2] } : { malformedLine: oneLine };
		});

const sha256OfFile = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

const verifySnapshotChecksums = ({ snapshotDirPath, relativePathList } = {}, callback) => {
	if (typeof snapshotDirPath !== 'string' || snapshotDirPath.length === 0) {
		callback(
			refuse.byName({
				moduleName,
				what: `snapshotDirPath is ${JSON.stringify(snapshotDirPath)}`,
				where: 'verifySnapshotChecksums needs the snapshot directory that holds SHA256SUMS',
			}).message,
		);
		return;
	}
	const checksumFilePath = path.join(snapshotDirPath, CHECKSUM_FILE_NAME);
	const recipeFilePath = path.join(snapshotDirPath, RECIPE_FILE_NAME);
	if (!fs.existsSync(checksumFilePath)) {
		callback(
			refuse.byName({
				moduleName,
				what: `${CHECKSUM_FILE_NAME} is absent at ${checksumFilePath}`,
				where: `every snapshot carries ${CHECKSUM_FILE_NAME} beside its bytes; the acquisition recipe is ${recipeFilePath}`,
			}).message,
		);
		return;
	}
	const parsedLineList = parseChecksumFile(fs.readFileSync(checksumFilePath, 'utf8'));
	const malformedEntry = parsedLineList.find((oneEntry) => oneEntry.malformedLine !== undefined);
	if (malformedEntry) {
		callback(
			refuse.byName({
				moduleName,
				what: `${checksumFilePath} carries a malformed line: '${malformedEntry.malformedLine}'`,
				where: 'each line is <64-hex><spaces><relative path>',
			}).message,
		);
		return;
	}
	const expectedByRelativePath = {};
	parsedLineList.forEach((oneEntry) => {
		expectedByRelativePath[oneEntry.relativePath] = oneEntry.expectedSha256;
	});
	if (relativePathList !== undefined && !Array.isArray(relativePathList)) {
		callback(
			refuse.byName({
				moduleName,
				what: `relativePathList is ${typeof relativePathList}, not an array`,
				where: 'name the files to verify as a list of paths relative to the snapshot directory, or omit it to verify every listed file',
			}).message,
		);
		return;
	}
	const pathsToVerify = relativePathList === undefined ? Object.keys(expectedByRelativePath) : relativePathList;
	if (pathsToVerify.length === 0) {
		callback(
			refuse.byName({
				moduleName,
				what: `${checksumFilePath} lists no files`,
				where: `a snapshot with nothing to verify has nothing to forge; see ${recipeFilePath}`,
			}).message,
		);
		return;
	}
	const verifiedFileList = [];
	for (let pathIndex = 0; pathIndex < pathsToVerify.length; pathIndex++) {
		const oneRelativePath = pathsToVerify[pathIndex];
		const expectedSha256 = expectedByRelativePath[oneRelativePath];
		if (expectedSha256 === undefined) {
			callback(
				refuse.byName({
					moduleName,
					what: `'${oneRelativePath}' is not listed in ${checksumFilePath}`,
					where: `a consumed file must be provenanced; add it to ${CHECKSUM_FILE_NAME} per the recipe in ${recipeFilePath}`,
				}).message,
			);
			return;
		}
		const absoluteFilePath = path.join(snapshotDirPath, oneRelativePath);
		if (!fs.existsSync(absoluteFilePath)) {
			callback(
				refuse.byName({
					moduleName,
					what: `listed file '${oneRelativePath}' is missing on disk (${absoluteFilePath})`,
					where: `re-acquire it per the recipe in ${recipeFilePath}`,
				}).message,
			);
			return;
		}
		const actualSha256 = sha256OfFile(absoluteFilePath);
		if (actualSha256 !== expectedSha256) {
			callback(
				refuse.byName({
					moduleName,
					what: `'${oneRelativePath}' sha256 MISMATCH — ${CHECKSUM_FILE_NAME} says ${expectedSha256}, disk has ${actualSha256}`,
					where: `the bytes are not the provenanced bytes; re-acquire per the recipe in ${recipeFilePath} or re-pin the snapshot deliberately`,
				}).message,
			);
			return;
		}
		verifiedFileList.push(oneRelativePath);
	}
	callback('', { verifiedFileList });
};

module.exports = { verifySnapshotChecksums, parseChecksumFile, CHECKSUM_FILE_NAME, RECIPE_FILE_NAME, moduleName };
