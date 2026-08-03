'use strict';

// metaEdSourceLoader.js — snapshot source acquisition for the forge-edfi independent MetaEd
// parser (Phase 1). Resolves the pinned snapshot directory, REFUSES BY NAME when source bytes
// are missing or corrupt (RT-3), verifies every loaded file against the committed SHA256SUMS
// peer, and returns the .metaed source inputs with their project metadata.
//
// F3 (binding, Phase 0 review): every missing-source refusal TEXTUALLY names
// README_PROVENANCE.md and its path — a git-clone consumer without the license-gated MetaEd
// bytes must be told exactly which file explains how to get them.
//
// SCOPE (R-WO-7): Phase 1 loads the two .metaed source inputs only (metaEdModel/ and
// tpdmCommunityModel/). The descriptor code-value XMLs and the authored crosswalk CSVs are
// forge inputs, consumed in Phase 2 — their checksums are NOT verified here because their
// bytes are not read here; each phase verifies what it consumes.
//
// Public interface is error-first callback-shaped (RT-8/R7).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// the two Phase 1 source inputs, in parse order: core model first, then the TPDM extension
const METAED_SOURCE_INPUT_NAMES = ['metaEdModel', 'tpdmCommunityModel'];

const moduleFunction = () => {
	const readmeProvenancePathFor = (snapshotPath) =>
		path.join(snapshotPath, 'README_PROVENANCE.md');

	const refuseMissingSource = ({ snapshotPath, missingPath, missingLabel }) =>
		`[forge-edfi metaEdSourceLoader] REFUSED (RT-3): ${missingLabel} is MISSING at ${missingPath}. ` +
		`The MetaEd model bytes are license-gated (Ed-Fi Alliance License Agreement) and are NOT committed to git — ` +
		`a fresh clone will not have them. The acquisition recipe lives in README_PROVENANCE.md at ` +
		`${readmeProvenancePathFor(snapshotPath)} — run its steps, then re-run this parse. A missing source ` +
		`fails the build; it is never skipped.`;

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

	const listFilesRecursively = (directoryPath) => {
		const filePathList = [];
		const walkDirectory = (currentPath) => {
			fs.readdirSync(currentPath, { withFileTypes: true })
				.sort((left, right) => left.name.localeCompare(right.name))
				.forEach((directoryEntry) => {
					const entryPath = path.join(currentPath, directoryEntry.name);
					if (directoryEntry.isDirectory()) {
						walkDirectory(entryPath);
						return;
					}
					filePathList.push(entryPath);
				});
		};
		walkDirectory(directoryPath);
		return filePathList;
	};

	// --------------------------------------------------------
	// loadMetaEdSourceFiles — the one public operation.
	//   inputs:  { snapshotPath }
	//   callback(errString, { sourceInputList, snapshotPath })
	// Each source input: { inputName, projectName, projectVersion, metaEdFileList } where each
	// file entry is { sourceFileRelativePath, sourceText } (path relative to the snapshot dir).
	// --------------------------------------------------------
	const loadMetaEdSourceFiles = ({ snapshotPath }, callback) => {
		if (!snapshotPath) {
			callback(
				'[forge-edfi metaEdSourceLoader] REFUSED: snapshotPath is required (the pinned snapshot version directory)',
			);
			return;
		}
		if (!fs.existsSync(snapshotPath)) {
			callback(
				`[forge-edfi metaEdSourceLoader] REFUSED (RT-3): snapshot directory not found: ${snapshotPath}. ` +
					`A valid snapshot directory carries README_PROVENANCE.md, SHA256SUMS, standardSourceLocation ` +
					`and the source-input subfolders.`,
			);
			return;
		}

		const readmeProvenancePath = readmeProvenancePathFor(snapshotPath);
		if (!fs.existsSync(readmeProvenancePath)) {
			callback(
				`[forge-edfi metaEdSourceLoader] REFUSED (RT-3): ${snapshotPath} is not a provenanced snapshot ` +
					`directory — its README_PROVENANCE.md is missing (expected at ${readmeProvenancePath}). ` +
					`Refusing rather than guessing at an unprovenanced source.`,
			);
			return;
		}

		const sha256SumsPath = path.join(snapshotPath, 'SHA256SUMS');
		if (!fs.existsSync(sha256SumsPath)) {
			callback(
				`[forge-edfi metaEdSourceLoader] REFUSED (RT-3): SHA256SUMS peer file is missing at ${sha256SumsPath}. ` +
					`Without it 'same bytes' cannot be proven. See README_PROVENANCE.md at ${readmeProvenancePath}.`,
			);
			return;
		}
		const checksumByRelativePath = parseSha256SumsText(
			fs.readFileSync(sha256SumsPath, 'utf-8'),
		);

		const sourceInputList = [];
		for (const inputName of METAED_SOURCE_INPUT_NAMES) {
			const inputDirectoryPath = path.join(snapshotPath, inputName);
			if (!fs.existsSync(inputDirectoryPath)) {
				callback(
					refuseMissingSource({
						snapshotPath,
						missingPath: inputDirectoryPath,
						missingLabel: `MetaEd source input '${inputName}'`,
					}),
				);
				return;
			}

			// project metadata — the package.json metaEdProject binding is the authoritative
			// version stamp for a MetaEd model package; absent metadata is a refusal, not a default
			const packageJsonPath = path.join(inputDirectoryPath, 'package.json');
			if (!fs.existsSync(packageJsonPath)) {
				callback(
					refuseMissingSource({
						snapshotPath,
						missingPath: packageJsonPath,
						missingLabel: `package.json (metaEdProject version binding) for source input '${inputName}'`,
					}),
				);
				return;
			}
			let packageJsonParsed;
			try {
				packageJsonParsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
			} catch (parseError) {
				// localized parse boundary (house-sanctioned): the refusal, not the throw, is the flow
				callback(
					`[forge-edfi metaEdSourceLoader] REFUSED (RT-3): package.json for source input '${inputName}' is ` +
						`unparseable (${parseError.message}) at ${packageJsonPath}. Source is corrupt — reacquire per ` +
						`README_PROVENANCE.md at ${readmeProvenancePath}.`,
				);
				return;
			}
			const metaEdProjectMetadata = packageJsonParsed.metaEdProject;
			if (
				!metaEdProjectMetadata ||
				!metaEdProjectMetadata.projectName ||
				!metaEdProjectMetadata.projectVersion
			) {
				callback(
					`[forge-edfi metaEdSourceLoader] REFUSED (RT-3): package.json for source input '${inputName}' ` +
						`carries no metaEdProject { projectName, projectVersion } binding at ${packageJsonPath}. ` +
						`Refusing rather than inventing a version. See README_PROVENANCE.md at ${readmeProvenancePath}.`,
				);
				return;
			}

			const metaEdFilePathList = listFilesRecursively(inputDirectoryPath).filter(
				(filePath) => filePath.endsWith('.metaed'),
			);
			if (!metaEdFilePathList.length) {
				callback(
					refuseMissingSource({
						snapshotPath,
						missingPath: inputDirectoryPath,
						missingLabel: `.metaed source files for input '${inputName}' (directory exists but holds none)`,
					}),
				);
				return;
			}

			// checksum verification: every loaded byte proves itself against the committed
			// manifest, and every manifest entry for this input proves its file exists (RT-3:
			// corrupt or checksum-failing source stops the forge by name)
			const metaEdFileList = [];
			for (const metaEdFilePath of metaEdFilePathList) {
				const sourceFileRelativePath = path
					.relative(snapshotPath, metaEdFilePath)
					.split(path.sep)
					.join('/');
				const expectedChecksum = checksumByRelativePath[sourceFileRelativePath];
				if (!expectedChecksum) {
					callback(
						`[forge-edfi metaEdSourceLoader] REFUSED (RT-3): ${sourceFileRelativePath} is present on disk ` +
							`but has NO entry in SHA256SUMS — the snapshot has drifted from its manifest. Reacquire per ` +
							`README_PROVENANCE.md at ${readmeProvenancePath}.`,
					);
					return;
				}
				const sourceFileBuffer = fs.readFileSync(metaEdFilePath);
				const computedChecksum = crypto
					.createHash('sha256')
					.update(sourceFileBuffer)
					.digest('hex');
				if (computedChecksum !== expectedChecksum) {
					callback(
						`[forge-edfi metaEdSourceLoader] REFUSED (RT-3): checksum MISMATCH for ${sourceFileRelativePath} — ` +
							`SHA256SUMS records ${expectedChecksum}, the bytes on disk hash to ${computedChecksum}. ` +
							`Source is corrupt or locally modified. Reacquire per README_PROVENANCE.md at ${readmeProvenancePath}.`,
					);
					return;
				}
				metaEdFileList.push({
					sourceFileRelativePath,
					sourceText: sourceFileBuffer.toString('utf-8'),
				});
			}

			// the reverse direction: every .metaed manifest entry under this input must exist on disk
			const inputManifestPrefix = `${inputName}/`;
			const missingManifestEntryList = Object.keys(checksumByRelativePath).filter(
				(manifestRelativePath) =>
					manifestRelativePath.startsWith(inputManifestPrefix) &&
					manifestRelativePath.endsWith('.metaed') &&
					!fs.existsSync(path.join(snapshotPath, manifestRelativePath)),
			);
			if (missingManifestEntryList.length) {
				callback(
					refuseMissingSource({
						snapshotPath,
						missingPath: `${missingManifestEntryList.length} manifest-listed file(s), first: ${path.join(snapshotPath, missingManifestEntryList[0])}`,
						missingLabel: `manifest-listed .metaed files for input '${inputName}'`,
					}),
				);
				return;
			}

			sourceInputList.push({
				inputName,
				projectName: metaEdProjectMetadata.projectName,
				projectVersion: metaEdProjectMetadata.projectVersion,
				metaEdFileList,
			});
		}

		callback('', { sourceInputList, snapshotPath });
	};

	return { loadMetaEdSourceFiles };
};

module.exports = moduleFunction;
