'use strict';

// descriptorCodeValueLoader.js — forge-edfi Phase 2 (R-WO-8): loads the descriptor code-value
// XML source inputs of the pinned snapshot (descriptorCodeValues/ + tpdmDescriptorCodeValues/),
// VERIFYING their checksums against the committed SHA256SUMS peer before reading a byte —
// the checksum-verification debt named in the Phase 1 handoff travels with the consumer, and
// this module is the consumer (each phase verifies what it consumes).
//
// REFUSAL DOCTRINE (RT-3, F3): a missing input folder, a file missing from disk, a file present
// on disk but absent from SHA256SUMS (manifest drift), a checksum mismatch, an unparseable XML,
// or a record shape outside the uniform grammar is a refusal that NAMES the offender and
// TEXTUALLY names README_PROVENANCE.md and its path. Never a skip.
//
// SOURCE GRAMMAR (verified against all 230 files this campaign): each XML is an
// <InterchangeDescriptors> document whose record elements are all of ONE element name ending in
// 'Descriptor'; each record carries CodeValue (required), and optionally ShortDescription,
// Description, Namespace. The MetaEd descriptor construct name is the record ELEMENT name minus
// its 'Descriptor' suffix — the FILENAME is not authoritative (one core file's name drifts from
// its element; the element joins the model, the filename does not).
//
// DUPLICATE DOCTRINE: six descriptors receive values from BOTH folders (TPDM extends core value
// sets). Identity is (descriptorName, codeValue). A duplicate identity with byte-identical
// fields collapses to one value (counted in the census); a duplicate with DIFFERING fields is a
// contradiction between two declared inputs of one snapshot — refusal by name (R-WO-10 class).
//
// The in-memory result shape (the formally declared interface of this module):
//
//   {
//     codeValueListByDescriptorName: {
//       <descriptorName>: [ { codeValue, shortDescription?, description?, namespace?,
//                             sourceInputName, sourceFileRelativePath } ]
//     },
//     census: { xmlFileCount, codeValueRecordCount, distinctDescriptorNameCount,
//               duplicateIdenticalCollapsedCount, recordCountByInput }
//   }
//
// Public interface is error-first callback-shaped (RT-8/R7). Async style: qtools taskListPlus.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const xml2js = require('xml2js');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// the two code-value source inputs, in load order: core first, then the TPDM extension
const CODE_VALUE_INPUT_NAMES = ['descriptorCodeValues', 'tpdmDescriptorCodeValues'];

// the uniform record grammar: the one required field and the optional carried fields
const REQUIRED_RECORD_FIELD_NAME = 'CodeValue';
const OPTIONAL_RECORD_FIELD_REGISTRY = {
	ShortDescription: 'shortDescription',
	Description: 'description',
	Namespace: 'namespace',
};
const RECORD_ELEMENT_SUFFIX = 'Descriptor';
const XML_ROOT_ELEMENT_NAME = 'InterchangeDescriptors';

const moduleFunction = () => {
	const readmeProvenancePathFor = (snapshotPath) =>
		path.join(snapshotPath, 'README_PROVENANCE.md');

	const refusalPreamble = '[forge-edfi descriptorCodeValueLoader] REFUSED';

	// parse the SHA256SUMS peer file: lines of '<64-hex-hash>  <relativePath>'
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
	// verifyInputChecksums — BOTH-DIRECTION verification for one input folder: every SHA256SUMS
	// entry under the folder exists on disk with a matching hash, and every file on disk is
	// listed in SHA256SUMS. Returns { verifiedRelativePathList } or { refusalMessage }.
	// Synchronous by nature; the public interface above it stays callback-shaped (RT-8).
	// --------------------------------------------------------
	const verifyInputChecksums = ({ snapshotPath, inputName, checksumByRelativePath }) => {
		const readmeProvenancePath = readmeProvenancePathFor(snapshotPath);
		const inputDirectoryPath = path.join(snapshotPath, inputName);

		if (!fs.existsSync(inputDirectoryPath)) {
			return {
				refusalMessage:
					`${refusalPreamble} (RT-3): source input folder '${inputName}' is MISSING at ` +
					`${inputDirectoryPath}. The acquisition recipe lives in README_PROVENANCE.md at ` +
					`${readmeProvenancePath} — run its steps, then re-run this forge. A missing source ` +
					`fails the build; it is never skipped.`,
			};
		}

		const manifestRelativePathList = Object.keys(checksumByRelativePath).filter(
			(oneRelativePath) => oneRelativePath.startsWith(`${inputName}/`),
		);
		if (!manifestRelativePathList.length) {
			return {
				refusalMessage:
					`${refusalPreamble} (RT-3): SHA256SUMS lists NO files under '${inputName}/' — the ` +
					`manifest does not cover this declared source input. See README_PROVENANCE.md at ` +
					`${readmeProvenancePath}.`,
			};
		}

		// direction 1: every manifest entry exists on disk with matching bytes
		for (const oneRelativePath of manifestRelativePathList) {
			const oneFilePath = path.join(snapshotPath, oneRelativePath);
			if (!fs.existsSync(oneFilePath)) {
				return {
					refusalMessage:
						`${refusalPreamble} (RT-3): '${oneRelativePath}' is listed in SHA256SUMS but MISSING ` +
						`on disk at ${oneFilePath}. The acquisition recipe lives in README_PROVENANCE.md at ` +
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
						`SHA256SUMS says ${checksumByRelativePath[oneRelativePath]}, the bytes on disk hash to ` +
						`${actualChecksum}. The source is corrupt or locally modified. See ` +
						`README_PROVENANCE.md at ${readmeProvenancePath} for the acquisition recipe.`,
				};
			}
		}

		// direction 2: every file on disk is in the manifest (manifest drift)
		const onDiskNameList = fs
			.readdirSync(inputDirectoryPath, { withFileTypes: true })
			.filter((directoryEntry) => directoryEntry.isFile())
			.map((directoryEntry) => `${inputName}/${directoryEntry.name}`);
		for (const oneRelativePath of onDiskNameList) {
			if (!checksumByRelativePath[oneRelativePath]) {
				return {
					refusalMessage:
						`${refusalPreamble} (RT-3): '${oneRelativePath}' exists on disk but is NOT listed in ` +
						`SHA256SUMS — manifest drift; the snapshot no longer matches its own manifest. See ` +
						`README_PROVENANCE.md at ${readmeProvenancePath}.`,
				};
			}
		}

		return {
			verifiedRelativePathList: manifestRelativePathList.filter((oneRelativePath) =>
				oneRelativePath.endsWith('.xml'),
			),
		};
	};

	// --------------------------------------------------------
	// extractRecordListFromParsedXml — one parsed xml2js document -> { recordElementName,
	// recordList } or { refusalMessage }. Enforces the uniform grammar stated in the header.
	// --------------------------------------------------------
	const extractRecordListFromParsedXml = ({ parsedXml, sourceFileRelativePath }) => {
		const rootElement = parsedXml && parsedXml[XML_ROOT_ELEMENT_NAME];
		if (!rootElement) {
			return {
				refusalMessage:
					`${refusalPreamble}: ${sourceFileRelativePath} — root element is not ` +
					`<${XML_ROOT_ELEMENT_NAME}>; this file is outside the descriptor code-value grammar.`,
			};
		}
		const recordElementNameList = Object.keys(rootElement).filter(
			(oneElementName) => oneElementName !== '$',
		);
		if (recordElementNameList.length !== 1) {
			return {
				refusalMessage:
					`${refusalPreamble}: ${sourceFileRelativePath} — expected exactly ONE record element ` +
					`name under <${XML_ROOT_ELEMENT_NAME}>, found ${recordElementNameList.length} ` +
					`(${recordElementNameList.join(', ') || 'none'}).`,
			};
		}
		const recordElementName = recordElementNameList[0];
		if (!recordElementName.endsWith(RECORD_ELEMENT_SUFFIX)) {
			return {
				refusalMessage:
					`${refusalPreamble}: ${sourceFileRelativePath} — record element ` +
					`<${recordElementName}> does not end in '${RECORD_ELEMENT_SUFFIX}'; it cannot name a ` +
					`MetaEd descriptor construct.`,
			};
		}
		const recordList = rootElement[recordElementName];
		if (!Array.isArray(recordList) || !recordList.length) {
			return {
				refusalMessage:
					`${refusalPreamble}: ${sourceFileRelativePath} — <${recordElementName}> carries no ` +
					`records.`,
			};
		}
		return { recordElementName, recordList };
	};

	// xml2js leaf: an element parsed with default options is an array of strings
	const scalarFieldFromRecord = ({ oneRecord, fieldElementName }) => {
		const fieldValueList = oneRecord[fieldElementName];
		if (!Array.isArray(fieldValueList) || !fieldValueList.length) {
			return undefined;
		}
		return `${fieldValueList[0]}`;
	};

	// --------------------------------------------------------
	// loadDescriptorCodeValues — the one public operation.
	//   inputs:  { snapshotPath }
	//   callback(errString, { codeValueListByDescriptorName, census })
	// --------------------------------------------------------
	const loadDescriptorCodeValues = ({ snapshotPath }, callback) => {
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

		const taskList = new taskListPlus();

		// STAGE 1 — checksum-verify both input folders (the debt), collect verified xml paths
		taskList.push((args, next) => {
			const verifiedFileEntryList = [];
			for (const inputName of CODE_VALUE_INPUT_NAMES) {
				const verification = verifyInputChecksums({
					snapshotPath,
					inputName,
					checksumByRelativePath,
				});
				if (verification.refusalMessage) {
					next(verification.refusalMessage);
					return;
				}
				verification.verifiedRelativePathList.forEach((oneRelativePath) => {
					verifiedFileEntryList.push({ inputName, sourceFileRelativePath: oneRelativePath });
				});
			}
			next('', { ...args, verifiedFileEntryList });
		});

		// STAGE 2 — parse every verified XML; first refusal aborts, naming its file
		taskList.push((args, next) => {
			const codeValueListByDescriptorName = {};
			const seenValueIdentityRegistry = {}; // `${descriptorName} ${codeValue}` -> stored value
			const census = {
				xmlFileCount: args.verifiedFileEntryList.length,
				codeValueRecordCount: 0,
				duplicateIdenticalCollapsedCount: 0,
				recordCountByInput: {},
			};

			const parseNextVerifiedFile = (fileIndex) => {
				if (fileIndex >= args.verifiedFileEntryList.length) {
					census.distinctDescriptorNameCount = Object.keys(
						codeValueListByDescriptorName,
					).length;
					next('', { ...args, codeValueListByDescriptorName, census });
					return;
				}
				const { inputName, sourceFileRelativePath } = args.verifiedFileEntryList[fileIndex];
				const xmlText = fs.readFileSync(path.join(snapshotPath, sourceFileRelativePath), 'utf-8');
				xml2js.parseString(xmlText, (xmlParseError, parsedXml) => {
					if (xmlParseError) {
						next(
							`${refusalPreamble}: ${sourceFileRelativePath} — XML parse failure: ` +
								`${xmlParseError.message}`,
						);
						return;
					}
					const extraction = extractRecordListFromParsedXml({
						parsedXml,
						sourceFileRelativePath,
					});
					if (extraction.refusalMessage) {
						next(extraction.refusalMessage);
						return;
					}
					const descriptorName = extraction.recordElementName.slice(
						0,
						-RECORD_ELEMENT_SUFFIX.length,
					);
					for (const oneRecord of extraction.recordList) {
						const codeValue = scalarFieldFromRecord({
							oneRecord,
							fieldElementName: REQUIRED_RECORD_FIELD_NAME,
						});
						if (codeValue === undefined || codeValue.trim() === '') {
							next(
								`${refusalPreamble}: ${sourceFileRelativePath} — a ` +
									`<${extraction.recordElementName}> record has no ${REQUIRED_RECORD_FIELD_NAME}; ` +
									`a code value without an identity cannot be carried.`,
							);
							return;
						}
						const codeValueEntry = {
							codeValue,
							sourceInputName: inputName,
							sourceFileRelativePath,
						};
						Object.entries(OPTIONAL_RECORD_FIELD_REGISTRY).forEach(
							([fieldElementName, carriedFieldName]) => {
								const fieldValue = scalarFieldFromRecord({ oneRecord, fieldElementName });
								if (fieldValue !== undefined) {
									codeValueEntry[carriedFieldName] = fieldValue;
								}
							},
						);

						const valueIdentity = `${descriptorName} ${codeValue}`;
						const priorEntry = seenValueIdentityRegistry[valueIdentity];
						if (priorEntry) {
							const fieldsMatch = Object.keys(OPTIONAL_RECORD_FIELD_REGISTRY).every(
								(fieldElementName) => {
									const carriedFieldName = OPTIONAL_RECORD_FIELD_REGISTRY[fieldElementName];
									return priorEntry[carriedFieldName] === codeValueEntry[carriedFieldName];
								},
							);
							if (!fieldsMatch) {
								next(
									`${refusalPreamble}: duplicate code value '${codeValue}' for descriptor ` +
										`'${descriptorName}' with DIFFERING fields — first seen in ` +
										`${priorEntry.sourceFileRelativePath}, contradicted by ` +
										`${sourceFileRelativePath}. Two declared inputs of one snapshot ` +
										`disagree; a contradiction is a broken snapshot, not a choice.`,
								);
								return;
							}
							census.duplicateIdenticalCollapsedCount += 1;
							continue;
						}
						seenValueIdentityRegistry[valueIdentity] = codeValueEntry;
						(codeValueListByDescriptorName[descriptorName] =
							codeValueListByDescriptorName[descriptorName] || []).push(codeValueEntry);
						census.codeValueRecordCount += 1;
						census.recordCountByInput[inputName] =
							(census.recordCountByInput[inputName] || 0) + 1;
					}
					setImmediate(() => parseNextVerifiedFile(fileIndex + 1));
				});
			};
			parseNextVerifiedFile(0);
		});

		pipeRunner(taskList.getList(), {}, (pipelineError, args) => {
			if (pipelineError) {
				callback(pipelineError);
				return;
			}
			callback('', {
				codeValueListByDescriptorName: args.codeValueListByDescriptorName,
				census: args.census,
			});
		});
	};

	return { loadDescriptorCodeValues };
};

module.exports = moduleFunction;
