'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// xsdSetLoader.js — the H2 loaders of the XSD kit (wave 3 lane I, K3, ruled by BRONZE_CROWN 2026-10-24): the schema sets, and the
// snapshot's standardSourceLocation (where the root's sourceUrl is read from, never hard-coded). This is where the publisher's bytes enter
// the forge.
//
// THE CLOSURE. Each set of the profile's schemaSetList starts at its entry files and follows every import and include:
//   * an import whose namespace the profile declares foreign is recorded and NOT followed (its references stay external, FBB-001);
//   * any other import or include is followed through its schemaLocation: the profile's schemaLocationTable row for that location
//     EXACTLY as written, or else the location read relative to the importing file; a location that reaches no file of the snapshot
//     refuses. The file reached must declare the import's namespace (an include: the includer's namespace).
// The forged files are the union of the closures, in path order (so reordering the profile's sets moves no byte). Each forged file
// carries the names of the sets whose closure holds it.
//
// THE ACCOUNTING. Every .xsd and .wsdl under the snapshot (registry accountedSourceFileExtensionList) is forged or excluded by name, with
// a reason: an unaccounted file refuses (a file silently ignored is content silently lost), a closure that reaches an excluded file
// refuses, and a stale exclusion, location row or foreign namespace refuses.

const fs = require('fs');
const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { validateXsdProfile } = require('./xsdProfileContract');
const { parseXsdFile } = require('./xsdParser');
const constructRegistry = require('./xsdConstructRegistry.json');

const LOCATION_URL_PATTERN = /^upstreamUrl:[ \t]*(\S+)[ \t]*$/m;
const IMPORT_CONSTRUCT = 'import';
const INCLUDE_CONSTRUCT = 'include';

const refusal = (what, where) => refuse.byName({ moduleName, what, where });
const attributeValueOf = (node, attributeName) => (node.attributeList.find((oneAttribute) => oneAttribute.attributeName === attributeName) || {}).attributeValue;

// accountedFileListUnder — every accounted source file under the snapshot, as sorted snapshot-relative paths
const accountedFileListUnder = (snapshotDirPath) => {
	const foundList = [];
	const visit = (relativeDirPath) => {
		fs.readdirSync(path.join(snapshotDirPath, relativeDirPath), { withFileTypes: true }).forEach((oneEntry) => {
			const relativePath = relativeDirPath === '' ? oneEntry.name : `${relativeDirPath}/${oneEntry.name}`;
			if (oneEntry.isDirectory()) {
				visit(relativePath);
				return;
			}
			if (constructRegistry.accountedSourceFileExtensionList.indexOf(path.extname(oneEntry.name)) !== -1) {
				foundList.push(relativePath);
			}
		});
	};
	visit('');
	return foundList.sort();
};

const moduleFunction =
	({ moduleName } = {}) =>
	({ xsdProfile }) => {
		validateXsdProfile(xsdProfile);
		const { schemaSetList, schemaLocationTable, foreignNamespaceList, schemaFileExclusionList } = xsdProfile;
		const foreignNamespaceUriList = foreignNamespaceList.map((oneRow) => oneRow.namespace);
		const excludedFileList = schemaFileExclusionList.map((oneRow) => oneRow.schemaFile);

		// loadSchemaSets — the profile's sets over the snapshot directory → the forged files, parsed, with their imports resolved.
		// Throws a named refusal inside; the callback boundary below hands its message on.
		const loadSchemaSetsOrThrow = ({ snapshotDirPath, xLog }) => {
			const accountedFileList = accountedFileListUnder(snapshotDirPath);
			const staleExclusion = excludedFileList.find((oneFile) => accountedFileList.indexOf(oneFile) === -1);
			if (staleExclusion !== undefined) {
				throw refusal(`schemaFileExclusionList names '${staleExclusion}', which the snapshot does not hold`, 'an exclusion names a file the snapshot holds; remove the stale row');
			}
			const loadedFileByPath = {};
			const usedLocationRowList = [];
			const usedForeignNamespaceList = [];

			// resolvedLocationOf — an import/include's schemaLocation as written → a snapshot-relative path, or a named refusal
			const resolvedLocationOf = ({ schemaLocation, importingFilePath, siteText }) => {
				if (schemaLocationTable[schemaLocation] !== undefined) {
					usedLocationRowList.push(schemaLocation);
					return schemaLocationTable[schemaLocation];
				}
				const relativeCandidate = path.posix.normalize(path.posix.join(path.posix.dirname(importingFilePath), schemaLocation));
				if (/^[a-z][a-z0-9+.-]*:/i.test(schemaLocation) || relativeCandidate.startsWith('..') || accountedFileList.indexOf(relativeCandidate) === -1) {
					throw refusal(`${siteText}: schemaLocation '${schemaLocation}' reaches no file of the snapshot`, "add a schemaLocationTable row mapping it, exactly as written, to the snapshot file that holds it, or declare the namespace foreign");
				}
				return relativeCandidate;
			};

			// loadFile — parse one file once; returns its record
			const loadFile = (relativePath) => {
				if (loadedFileByPath[relativePath] === undefined) {
					const parsedFile = parseXsdFile({ fileText: fs.readFileSync(path.join(snapshotDirPath, relativePath), 'utf8'), schemaFileRelativePath: relativePath });
					loadedFileByPath[relativePath] = { schemaFileRelativePath: relativePath, parsedFile, schemaSetNameList: [], importRecordList: [] };
				}
				return loadedFileByPath[relativePath];
			};

			schemaSetList.forEach(({ schemaSetName, entryFileList }) => {
				const pendingPathList = entryFileList.slice();
				const visitedPathList = [];
				entryFileList.forEach((entryPath) => {
					if (accountedFileList.indexOf(entryPath) === -1) {
						throw refusal(`set '${schemaSetName}' entry '${entryPath}' is not in the snapshot`, 'an entry file is a snapshot-relative path to an .xsd the snapshot holds');
					}
				});
				while (pendingPathList.length !== 0) {
					const relativePath = pendingPathList.shift();
					if (visitedPathList.indexOf(relativePath) !== -1) {
						continue;
					}
					if (excludedFileList.indexOf(relativePath) !== -1) {
						throw refusal(`set '${schemaSetName}' reaches '${relativePath}', which schemaFileExclusionList excludes`, 'a file a closure reaches is forged; exclude only an unreachable file');
					}
					visitedPathList.push(relativePath);
					const fileRecord = loadFile(relativePath);
					if (fileRecord.schemaSetNameList.indexOf(schemaSetName) === -1) {
						fileRecord.schemaSetNameList.push(schemaSetName);
					}
					const isFirstVisit = fileRecord.importRecordList.length === 0 && fileRecord.importsResolved !== true;
					fileRecord.parsedFile.rootNode.children.filter((oneChild) => oneChild.construct === IMPORT_CONSTRUCT || oneChild.construct === INCLUDE_CONSTRUCT).forEach((importNode) => {
						const siteText = `'${relativePath}' ${importNode.locator}`;
						const schemaLocation = attributeValueOf(importNode, 'schemaLocation');
						const importedNamespace = importNode.construct === INCLUDE_CONSTRUCT ? fileRecord.parsedFile.targetNamespace : attributeValueOf(importNode, 'namespace');
						if (importedNamespace === undefined || importedNamespace === '') {
							throw refusal(`${siteText}: the import names no namespace`, 'a no-namespace import is untaught');
						}
						if (importNode.construct === IMPORT_CONSTRUCT && foreignNamespaceUriList.indexOf(importedNamespace) !== -1) {
							usedForeignNamespaceList.push(importedNamespace);
							if (isFirstVisit) {
								fileRecord.importRecordList.push({ construct: importNode.construct, namespace: importedNamespace, isForeign: true, resolvedRelativePath: null });
							}
							return;
						}
						if (schemaLocation === undefined) {
							throw refusal(`${siteText}: the ${importNode.construct} of '${importedNamespace}' gives no schemaLocation`, 'the kit follows an import through its schemaLocation, or the namespace is declared foreign');
						}
						const resolvedRelativePath = resolvedLocationOf({ schemaLocation, importingFilePath: relativePath, siteText });
						const targetRecord = loadFile(resolvedRelativePath);
						if (targetRecord.parsedFile.targetNamespace !== importedNamespace) {
							throw refusal(`${siteText}: '${schemaLocation}' reaches '${resolvedRelativePath}', whose targetNamespace is '${targetRecord.parsedFile.targetNamespace}', not '${importedNamespace}'`, 'an import reaches its own namespace; an include reaches the includer\'s');
						}
						if (isFirstVisit) {
							fileRecord.importRecordList.push({ construct: importNode.construct, namespace: importedNamespace, isForeign: false, resolvedRelativePath });
						}
						pendingPathList.push(resolvedRelativePath);
					});
					fileRecord.importsResolved = true;
				}
			});

			const forgedFileList = Object.keys(loadedFileByPath).sort();
			const unaccountedFile = accountedFileList.find((oneFile) => forgedFileList.indexOf(oneFile) === -1 && excludedFileList.indexOf(oneFile) === -1);
			if (unaccountedFile !== undefined) {
				throw refusal(`'${unaccountedFile}' is in the snapshot but in no set's closure and not excluded`, 'every .xsd and .wsdl of the snapshot is forged or excluded by name with a reason');
			}
			const staleLocationRow = Object.keys(schemaLocationTable).find((oneLocation) => usedLocationRowList.indexOf(oneLocation) === -1);
			if (staleLocationRow !== undefined) {
				throw refusal(`schemaLocationTable row '${staleLocationRow}' is used by no import`, 'a stale row is refused; remove it');
			}
			const staleForeignNamespace = foreignNamespaceUriList.find((oneNamespace) => usedForeignNamespaceList.indexOf(oneNamespace) === -1);
			if (staleForeignNamespace !== undefined) {
				throw refusal(`foreignNamespaceList names '${staleForeignNamespace}', which no forged file imports`, 'a stale foreign namespace is refused; remove it');
			}
			const schemaFileList = forgedFileList.map((relativePath) => {
				const { importsResolved, ...fileRecord } = loadedFileByPath[relativePath];
				return { ...fileRecord, schemaSetNameList: fileRecord.schemaSetNameList.slice().sort() };
			});
			xLog.status(`[${moduleName}] ${schemaSetList.length} schema sets: ${schemaFileList.length} files forged, ${excludedFileList.length} excluded, ${foreignNamespaceUriList.length} foreign namespaces`);
			return { snapshotDirPath, schemaFileList, excludedFileList: excludedFileList.slice().sort() };
		};

		// loadSchemaSets — H2 loader: the snapshot directory → { snapshotDirPath, schemaFileList, excludedFileList }
		const loadSchemaSets = ({ sourcePath, additionalSourceInputPathByName, xLog }, callback) => {
			if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
				callback(refusal(`the source '${sourcePath}' is not a snapshot directory`, 'an XSD bundle reads its snapshot DIRECTORY: leave sourceFile out of parserDescriptor.ini').message);
				return;
			}
			let loaded;
			try {
				loaded = loadSchemaSetsOrThrow({ snapshotDirPath: sourcePath, xLog });
			} catch (loadError) {
				// localized refusal boundary (the openapiSourceParser.js form): a named refusal thrown in the pure walk of the bytes
				// becomes this loader's callback error, the one channel the framework reads
				callback(loadError.message);
				return;
			}
			callback('', loaded);
		};

		// loadSourceLocation — the snapshot's standardSourceLocation, for the upstream URL the root states
		const loadSourceLocation = ({ sourcePath, additionalSourceInputPathByName, xLog }, callback) => {
			const locationFilePath = additionalSourceInputPathByName.sourceLocation;
			const locationMatch = fs.readFileSync(locationFilePath, 'utf8').match(LOCATION_URL_PATTERN);
			if (!locationMatch) {
				callback(refusal(`'${locationFilePath}' states no 'upstreamUrl:' line`, "the root's sourceUrl is read from it and never assumed").message);
				return;
			}
			callback('', { upstreamUrl: locationMatch[1] });
		};

		return { loadSchemaSets, loadSourceLocation };
	};

module.exports = moduleFunction({ moduleName });
