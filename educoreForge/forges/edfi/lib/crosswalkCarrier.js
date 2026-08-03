'use strict';

// crosswalkCarrier.js — forge-edfi Phase 2 (R-WO-8): loads the authored Ed-Fi→CEDS crosswalk
// CSVs (cedsAuthoredCrosswalk/, acquisition class human-artifact-snapshot, carried verbatim per
// R-WO-4 ruling 1), VERIFYING their checksums against the committed SHA256SUMS peer before
// reading a byte. Emits cross-reference REGISTRIES for the contract-graph builder to MATCH
// against the MetaEd-derived model — this module does no matching itself, because the model does
// not exist here.
//
// CARRIAGE SCOPE (R-WO-4 ruling; enrichment backlog is a later phase): the same four authored
// columns the incumbent forge stashed — CEDSGlobalId (elements + descriptors), CEDSOptionCode
// (+ CEDSOptionDescription rides inside the crossRefs annotation exactly as the incumbent
// carried it) — plus the row-location names needed for the R-WO-11 unmatched-row report.
//
// REFUSAL DOCTRINE (RT-3): missing folder/file, checksum mismatch, or manifest drift refuses by
// name, textually naming README_PROVENANCE.md and its path. The '000000' no-mapping sentinel is
// ABSENT, not data (incumbent normalize.js doctrine, restated here because this module carries
// its own normalization — the incumbent's lib is scheduled for closeout removal and new code
// takes no dependency on it).
//
// The in-memory result shape (the formally declared interface of this module):
//
//   {
//     propertyCrossRefRegistry:    { '<EdFiEntity>.<EdFiElementName>': { edfiEntityName,
//                                     edfiElementName, cedsGlobalIdList } }
//     descriptorCrossRefRegistry:  { '<descriptorName>': { descriptorName, cedsGlobalId } }
//     optionValueCrossRefRegistry: { '<descriptorName>.<codeValue>': { descriptorName,
//                                     codeValue, cedsOptionCode, cedsOptionDescription? } }
//     census: { elementsRowCount, descriptorsRowCount, propertyCrossRefCount,
//               descriptorCrossRefCount, optionValueCrossRefCount }
//   }
//
// Public interface is error-first callback-shaped (RT-8/R7).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CROSSWALK_INPUT_NAME = 'cedsAuthoredCrosswalk';
const ELEMENTS_CSV_FILE_NAME = 'EdFiEntityElementsToCEDS.csv';
const DESCRIPTORS_CSV_FILE_NAME = 'EdFiEntityDescriptorsToCEDS.csv';

// the old parser's "no CEDS mapping" placeholder — ABSENT, never data
const CEDS_NO_MAPPING_SENTINEL = '000000';

// the descriptors CSV repeats 'EdFiDescription' at columns 4 and 8; column 8 is the
// element/path description (incumbent-established column fact, carried forward)
const DESCRIPTORS_CSV_HEADER_OVERRIDES = { 8: 'EdFiElementDescription' };

const moduleFunction = () => {
	const readmeProvenancePathFor = (snapshotPath) =>
		path.join(snapshotPath, 'README_PROVENANCE.md');

	const refusalPreamble = '[forge-edfi crosswalkCarrier] REFUSED';

	const parseSha256SumsText = (sha256SumsText) => {
		const checksumByRelativePath = {};
		sha256SumsText
			.split('\n')
			.filter((lineText) => lineText.trim().length)
			.forEach((lineText) => {
				const lineMatch = lineText.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
				if (lineMatch) {
					checksumByRelativePath[lineMatch[2].trim()] = lineMatch[1];
				}
			});
		return checksumByRelativePath;
	};

	// --------------------------------------------------------
	// quote-aware CSV line split (same algorithm class as the incumbent parser; written fresh
	// here because the incumbent lib is closeout-scheduled)
	// --------------------------------------------------------
	const parseCsvLine = (lineText) => {
		const fieldList = [];
		let currentField = '';
		let insideQuotes = false;
		for (let charIndex = 0; charIndex < lineText.length; charIndex++) {
			const oneChar = lineText[charIndex];
			if (oneChar === '"') {
				if (insideQuotes && charIndex + 1 < lineText.length && lineText[charIndex + 1] === '"') {
					currentField += '"';
					charIndex++;
				} else {
					insideQuotes = !insideQuotes;
				}
			} else if (oneChar === ',' && !insideQuotes) {
				fieldList.push(currentField.trim());
				currentField = '';
			} else {
				currentField += oneChar;
			}
		}
		fieldList.push(currentField.trim());
		return fieldList;
	};

	const parseCsvText = ({ csvText, headerOverrides }) => {
		const lineList = csvText.split('\n').filter((lineText) => lineText.trim());
		if (lineList.length < 2) {
			return { headerList: [], rowList: [] };
		}
		const rawHeaderList = parseCsvLine(lineList[0]);
		const headerList = rawHeaderList.map((oneHeader, headerIndex) =>
			headerOverrides && headerOverrides[headerIndex]
				? headerOverrides[headerIndex]
				: oneHeader,
		);
		const rowList = [];
		for (let lineIndex = 1; lineIndex < lineList.length; lineIndex++) {
			const fieldValueList = parseCsvLine(lineList[lineIndex]);
			const oneRow = {};
			headerList.forEach((oneHeader, headerIndex) => {
				oneRow[oneHeader] = (fieldValueList[headerIndex] || '').trim();
			});
			rowList.push(oneRow);
		}
		return { headerList, rowList };
	};

	// --------------------------------------------------------
	// verifyCrosswalkChecksums — both directions for the crosswalk folder.
	// --------------------------------------------------------
	const verifyCrosswalkChecksums = ({ snapshotPath, checksumByRelativePath }) => {
		const readmeProvenancePath = readmeProvenancePathFor(snapshotPath);
		const inputDirectoryPath = path.join(snapshotPath, CROSSWALK_INPUT_NAME);
		if (!fs.existsSync(inputDirectoryPath)) {
			return {
				refusalMessage:
					`${refusalPreamble} (RT-3): source input folder '${CROSSWALK_INPUT_NAME}' is MISSING ` +
					`at ${inputDirectoryPath}. The acquisition recipe lives in README_PROVENANCE.md at ` +
					`${readmeProvenancePath}. A missing source fails the build; it is never skipped.`,
			};
		}
		const manifestRelativePathList = Object.keys(checksumByRelativePath).filter(
			(oneRelativePath) => oneRelativePath.startsWith(`${CROSSWALK_INPUT_NAME}/`),
		);
		for (const requiredFileName of [ELEMENTS_CSV_FILE_NAME, DESCRIPTORS_CSV_FILE_NAME]) {
			const requiredRelativePath = `${CROSSWALK_INPUT_NAME}/${requiredFileName}`;
			if (!manifestRelativePathList.includes(requiredRelativePath)) {
				return {
					refusalMessage:
						`${refusalPreamble} (RT-3): SHA256SUMS does not list '${requiredRelativePath}' — ` +
						`the manifest does not cover this declared source input. See README_PROVENANCE.md ` +
						`at ${readmeProvenancePath}.`,
				};
			}
		}
		for (const oneRelativePath of manifestRelativePathList) {
			const oneFilePath = path.join(snapshotPath, oneRelativePath);
			if (!fs.existsSync(oneFilePath)) {
				return {
					refusalMessage:
						`${refusalPreamble} (RT-3): '${oneRelativePath}' is listed in SHA256SUMS but ` +
						`MISSING on disk at ${oneFilePath}. See README_PROVENANCE.md at ` +
						`${readmeProvenancePath}. A missing source fails the build; it is never skipped.`,
				};
			}
			const actualChecksum = crypto
				.createHash('sha256')
				.update(fs.readFileSync(oneFilePath))
				.digest('hex');
			if (actualChecksum !== checksumByRelativePath[oneRelativePath]) {
				return {
					refusalMessage:
						`${refusalPreamble} (RT-3): checksum MISMATCH for '${oneRelativePath}' — ` +
						`SHA256SUMS says ${checksumByRelativePath[oneRelativePath]}, the bytes on disk ` +
						`hash to ${actualChecksum}. The source is corrupt or locally modified. See ` +
						`README_PROVENANCE.md at ${readmeProvenancePath} for the acquisition recipe.`,
				};
			}
		}
		const onDiskNameList = fs
			.readdirSync(inputDirectoryPath, { withFileTypes: true })
			.filter((directoryEntry) => directoryEntry.isFile())
			.map((directoryEntry) => `${CROSSWALK_INPUT_NAME}/${directoryEntry.name}`);
		for (const oneRelativePath of onDiskNameList) {
			if (!checksumByRelativePath[oneRelativePath]) {
				return {
					refusalMessage:
						`${refusalPreamble} (RT-3): '${oneRelativePath}' exists on disk but is NOT listed ` +
						`in SHA256SUMS — manifest drift; the snapshot no longer matches its own manifest. ` +
						`See README_PROVENANCE.md at ${readmeProvenancePath}.`,
				};
			}
		}
		return {};
	};

	// --------------------------------------------------------
	// loadAuthoredCrosswalk — the one public operation.
	//   inputs:  { snapshotPath }
	//   callback(errString, { propertyCrossRefRegistry, descriptorCrossRefRegistry,
	//                         optionValueCrossRefRegistry, census })
	// --------------------------------------------------------
	const loadAuthoredCrosswalk = ({ snapshotPath }, callback) => {
		if (!snapshotPath) {
			callback(
				`${refusalPreamble}: snapshotPath is required (the pinned snapshot version directory)`,
			);
			return;
		}
		const readmeProvenancePath = readmeProvenancePathFor(snapshotPath);
		if (!fs.existsSync(readmeProvenancePath)) {
			callback(
				`${refusalPreamble} (RT-3): ${snapshotPath} is not a provenanced snapshot directory — ` +
					`its README_PROVENANCE.md is missing (expected at ${readmeProvenancePath}). Refusing ` +
					`rather than guessing at an unprovenanced source.`,
			);
			return;
		}
		const sha256SumsPath = path.join(snapshotPath, 'SHA256SUMS');
		if (!fs.existsSync(sha256SumsPath)) {
			callback(
				`${refusalPreamble} (RT-3): SHA256SUMS peer file is missing at ${sha256SumsPath}. ` +
					`Without it 'same bytes' cannot be proven. See README_PROVENANCE.md at ` +
					`${readmeProvenancePath}.`,
			);
			return;
		}
		const checksumByRelativePath = parseSha256SumsText(fs.readFileSync(sha256SumsPath, 'utf-8'));

		const verification = verifyCrosswalkChecksums({ snapshotPath, checksumByRelativePath });
		if (verification.refusalMessage) {
			callback(verification.refusalMessage);
			return;
		}

		// ---- elements CSV -> property cross-ref registry (grouped by entity.element; a row
		// mapping to several CEDS elements contributes several global-ids to one registry entry) ----
		const elementsCsv = parseCsvText({
			csvText: fs.readFileSync(
				path.join(snapshotPath, CROSSWALK_INPUT_NAME, ELEMENTS_CSV_FILE_NAME),
				'utf-8',
			),
		});
		const propertyCrossRefRegistry = {};
		elementsCsv.rowList.forEach((oneRow) => {
			const edfiEntityName = oneRow.EdFiEntity;
			const edfiElementName = oneRow.EdFiElementName;
			if (!edfiEntityName || !edfiElementName) {
				return; // a row with no element identity carries no cross-ref to anything
			}
			const registryRefId = `${edfiEntityName}.${edfiElementName}`;
			const registryEntry = (propertyCrossRefRegistry[registryRefId] = propertyCrossRefRegistry[
				registryRefId
			] || { edfiEntityName, edfiElementName, cedsGlobalIdList: [] });
			const cedsGlobalId = oneRow.CEDSGlobalId;
			if (
				cedsGlobalId &&
				cedsGlobalId !== CEDS_NO_MAPPING_SENTINEL &&
				!registryEntry.cedsGlobalIdList.includes(cedsGlobalId)
			) {
				registryEntry.cedsGlobalIdList.push(cedsGlobalId);
			}
		});

		// ---- descriptors CSV -> descriptor + option-value cross-ref registries ----
		const descriptorsCsv = parseCsvText({
			csvText: fs.readFileSync(
				path.join(snapshotPath, CROSSWALK_INPUT_NAME, DESCRIPTORS_CSV_FILE_NAME),
				'utf-8',
			),
			headerOverrides: DESCRIPTORS_CSV_HEADER_OVERRIDES,
		});
		const descriptorCrossRefRegistry = {};
		const optionValueCrossRefRegistry = {};
		descriptorsCsv.rowList.forEach((oneRow) => {
			// the CSV's element name carries the 'Descriptor' suffix; the MetaEd construct does not
			const suffixedDescriptorName = oneRow.EdFiElementName;
			const codeValue = oneRow.EdFiCodeValue;
			if (!suffixedDescriptorName || !codeValue) {
				return;
			}
			const descriptorName = suffixedDescriptorName.replace(/Descriptor$/, '');

			const descriptorCedsGlobalId = oneRow.CEDSGlobalId;
			if (
				descriptorCedsGlobalId &&
				descriptorCedsGlobalId !== CEDS_NO_MAPPING_SENTINEL &&
				!descriptorCrossRefRegistry[descriptorName]
			) {
				descriptorCrossRefRegistry[descriptorName] = {
					descriptorName,
					cedsGlobalId: descriptorCedsGlobalId,
				};
			}

			const cedsOptionCode = oneRow.CEDSOptionCode;
			const valueRefId = `${descriptorName}.${codeValue}`;
			if (cedsOptionCode && !optionValueCrossRefRegistry[valueRefId]) {
				optionValueCrossRefRegistry[valueRefId] = {
					descriptorName,
					codeValue,
					cedsOptionCode,
					...(oneRow.CEDSOptionDescription
						? { cedsOptionDescription: oneRow.CEDSOptionDescription }
						: {}),
				};
			}
		});

		callback('', {
			propertyCrossRefRegistry,
			descriptorCrossRefRegistry,
			optionValueCrossRefRegistry,
			census: {
				elementsRowCount: elementsCsv.rowList.length,
				descriptorsRowCount: descriptorsCsv.rowList.length,
				propertyCrossRefCount: Object.keys(propertyCrossRefRegistry).length,
				descriptorCrossRefCount: Object.keys(descriptorCrossRefRegistry).length,
				optionValueCrossRefCount: Object.keys(optionValueCrossRefRegistry).length,
			},
		});
	};

	return { loadAuthoredCrosswalk };
};

module.exports = moduleFunction;
