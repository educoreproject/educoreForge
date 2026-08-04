'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// roundTripSnapshotIntake.js — forge-edfi Phase 3: the validator's snapshot intake. Each phase
// verifies what it consumes (the standing checksum doctrine): before a byte of the answer key
// is reduced, every consumed file is verified against the committed SHA256SUMS peer, BOTH
// directions within the consumed inputs (a file on disk but absent from the manifest is
// manifest drift; a manifest entry with no file is a missing input). Refusals TEXTUALLY name
// README_PROVENANCE.md and its path (RT-3 / supervisor note F3).
//
// The intake also produces the verdict's SNAPSHOT IDENTITY (RT-6): per-input file counts and
// digests, plus a combined digest over the consumed inputs (sha256 of the sorted per-file
// digest lines).
//
// CONSUMED INPUTS (the five declared source inputs of snapshot 04):
//   metaEdModel/**.metaed, tpdmCommunityModel/**.metaed          (the MetaEd sources)
//   descriptorCodeValues/*.xml, tpdmDescriptorCodeValues/*.xml   (code-value XMLs)
//   cedsAuthoredCrosswalk/*.csv                                  (the authored crosswalk)
// Non-consumed peers (LICENSE, package.json, provenance files) are NOT checksum-audited here —
// they belong to the forge's own consumers.
//
// Async style: error-first callbacks (RT-8/R7); no async/await. camelCase only.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// input directory -> file suffix consumed from it
const CONSUMED_INPUT_REGISTRY = {
	metaEdModel: '.metaed',
	tpdmCommunityModel: '.metaed',
	descriptorCodeValues: '.xml',
	tpdmDescriptorCodeValues: '.xml',
	cedsAuthoredCrosswalk: '.csv',
};

const sha256HexOf = (bufferValue) => crypto.createHash('sha256').update(bufferValue).digest('hex');

const listFilesRecursive = ({ rootPath, suffix }) => {
	const foundList = [];
	const walk = (currentPath) => {
		fs.readdirSync(currentPath, { withFileTypes: true }).forEach((oneEntry) => {
			const fullPath = path.join(currentPath, oneEntry.name);
			if (oneEntry.isDirectory()) {
				walk(fullPath);
				return;
			}
			if (oneEntry.name.endsWith(suffix)) {
				foundList.push(fullPath);
			}
		});
	};
	walk(rootPath);
	return foundList.sort();
};

const moduleFunction = () => {
	// --------------------------------------------------------
	// intakeSnapshot — verify and read every consumed file.
	//   inputs:  { snapshotPath }
	//   callback(errString, {
	//     fileEntryList: [ { inputName, sourceFileRelativePath, suffix, fileText } ],
	//     snapshotIdentity: { snapshotPath, perInput: { <inputName>: { fileCount, inputDigest } },
	//                         combinedDigest }
	//   })
	// --------------------------------------------------------
	const intakeSnapshot = ({ snapshotPath }, callback) => {
		if (!snapshotPath) {
			callback(`${moduleName}.intakeSnapshot: snapshotPath is REQUIRED and has no default.`);
			return;
		}
		const readmeProvenancePath = path.join(snapshotPath, 'README_PROVENANCE.md');
		const refuse = (message) => {
			callback(
				`${moduleName} REFUSED (RT-3): ${message} The acquisition recipe lives in README_PROVENANCE.md at ${readmeProvenancePath}.`,
			);
		};

		if (!fs.existsSync(snapshotPath)) {
			refuse(`snapshot directory '${snapshotPath}' does not exist.`);
			return;
		}
		const shaSumsPath = path.join(snapshotPath, 'SHA256SUMS');
		if (!fs.existsSync(shaSumsPath)) {
			refuse(`'${shaSumsPath}' is missing — the checksum manifest is a required committed peer.`);
			return;
		}

		// manifest: '<hex>  <relativePath>' lines
		const manifestDigestByRelativePath = {};
		fs.readFileSync(shaSumsPath, 'utf8')
			.split('\n')
			.filter((oneLine) => oneLine.trim() !== '')
			.forEach((oneLine) => {
				const lineMatch = oneLine.match(/^([0-9a-f]{64})\s+[* ]?(.+)$/);
				if (lineMatch) {
					manifestDigestByRelativePath[lineMatch[2].trim()] = lineMatch[1];
				}
			});

		const fileEntryList = [];
		const perInputIdentity = {};
		const allDigestLineList = [];
		let refusalMessage = '';

		Object.entries(CONSUMED_INPUT_REGISTRY).forEach(([inputName, suffix]) => {
			if (refusalMessage) {
				return;
			}
			const inputPath = path.join(snapshotPath, inputName);
			if (!fs.existsSync(inputPath)) {
				refusalMessage = `consumed input directory '${inputName}/' is missing from '${snapshotPath}'.`;
				return;
			}
			const inputFileList = listFilesRecursive({ rootPath: inputPath, suffix });
			if (inputFileList.length === 0) {
				refusalMessage = `consumed input '${inputName}/' contains no ${suffix} files.`;
				return;
			}
			const inputDigestLineList = [];
			inputFileList.forEach((oneFilePath) => {
				if (refusalMessage) {
					return;
				}
				const sourceFileRelativePath = path.relative(snapshotPath, oneFilePath);
				const manifestDigest = manifestDigestByRelativePath[sourceFileRelativePath];
				if (!manifestDigest) {
					refusalMessage = `'${sourceFileRelativePath}' exists on disk but is ABSENT from SHA256SUMS — manifest drift.`;
					return;
				}
				const fileBuffer = fs.readFileSync(oneFilePath);
				const actualDigest = sha256HexOf(fileBuffer);
				if (actualDigest !== manifestDigest) {
					refusalMessage =
						`'${sourceFileRelativePath}' checksum MISMATCH — manifest ${manifestDigest}, ` +
						`actual ${actualDigest}.`;
					return;
				}
				fileEntryList.push({
					inputName,
					sourceFileRelativePath,
					suffix,
					fileText: fileBuffer.toString('utf8'),
				});
				inputDigestLineList.push(`${actualDigest}  ${sourceFileRelativePath}`);
				allDigestLineList.push(`${actualDigest}  ${sourceFileRelativePath}`);
			});
			if (refusalMessage) {
				return;
			}
			// reverse direction: every manifest entry under this input must exist on disk
			const onDiskRelativeSet = new Set(
				inputFileList.map((oneFilePath) => path.relative(snapshotPath, oneFilePath)),
			);
			Object.keys(manifestDigestByRelativePath).forEach((oneRelativePath) => {
				if (refusalMessage) {
					return;
				}
				if (
					oneRelativePath.startsWith(`${inputName}/`) &&
					oneRelativePath.endsWith(suffix) &&
					!onDiskRelativeSet.has(oneRelativePath)
				) {
					refusalMessage = `SHA256SUMS names '${oneRelativePath}' but the file is MISSING from disk.`;
				}
			});
			perInputIdentity[inputName] = {
				fileCount: inputDigestLineList.length,
				inputDigest: sha256HexOf(inputDigestLineList.sort().join('\n')),
			};
		});

		if (refusalMessage) {
			refuse(refusalMessage);
			return;
		}

		callback('', {
			fileEntryList,
			snapshotIdentity: {
				snapshotPath,
				perInput: perInputIdentity,
				combinedDigest: sha256HexOf(allDigestLineList.sort().join('\n')),
			},
		});
	};

	return { intakeSnapshot, CONSUMED_INPUT_REGISTRY };
};

module.exports = moduleFunction;
