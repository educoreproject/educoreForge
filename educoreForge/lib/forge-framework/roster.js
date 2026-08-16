'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// roster.js — roster.assertUniqueStandardNames({ forgesDirPath }) → Error | null (SPEC-forgeFramework-v1.md
// §3.3, §10 G-UNIQUE; RULING 00:15 gate 9; §14 D13). standardName — and therefore every node's
// _source — MUST be UNIQUE among enabled bundles: two bundles sharing one standardName would write
// into one _source scope and harvest as one block. This helper reads every
// forges/*/parserDescriptor.ini (a bundle IS its own registration; a directory without the file is
// not a bundle and is skipped, exactly the forger's rule, forger.js:159-171) and refuses a duplicate
// naming BOTH directories. The forger's roster is NOT modified — this is a gate, run by every
// bundle's suite and by the fleet suite.
//
// Reads the ini the way qtools-config-file-processor sees it: only keys INSIDE the
// [parserDescriptor] section count (sectionless keys are discarded, forger.js:186-195). A bundle
// whose descriptor lacks the section or a non-blank standardName is refused by name — it cannot
// be compared, and an uncomparable bundle is not "unique".
//
// PURE apart from reading the descriptors; synchronous; returns, never throws.

const fs = require('fs');
const path = require('path');
const refuse = require('./refuse');

const DESCRIPTOR_FILE_NAME = 'parserDescriptor.ini';
const DESCRIPTOR_SECTION_NAME = 'parserDescriptor';

// readDescriptorSection(descriptorPath) → { sectionPresent, valueByName }
const readDescriptorSection = (descriptorPath) => {
	const valueByName = {};
	let currentSectionName = null;
	let sectionPresent = false;
	fs.readFileSync(descriptorPath, 'utf8')
		.split('\n')
		.forEach((oneRawLine) => {
			const oneLine = oneRawLine.trim();
			if (oneLine === '' || oneLine.startsWith('#') || oneLine.startsWith(';')) {
				return;
			}
			const sectionMatch = oneLine.match(/^\[([^\]]+)\]$/);
			if (sectionMatch) {
				currentSectionName = sectionMatch[1].trim();
				if (currentSectionName === DESCRIPTOR_SECTION_NAME) {
					sectionPresent = true;
				}
				return;
			}
			if (currentSectionName !== DESCRIPTOR_SECTION_NAME) {
				return;
			}
			const equalsIndex = oneLine.indexOf('=');
			if (equalsIndex === -1) {
				return;
			}
			const propertyName = oneLine.slice(0, equalsIndex).trim();
			const propertyValue = oneLine.slice(equalsIndex + 1).trim();
			if (valueByName[propertyName] === undefined) {
				valueByName[propertyName] = propertyValue;
			}
		});
	return { sectionPresent, valueByName };
};

const assertUniqueStandardNames = ({ forgesDirPath } = {}) => {
	if (typeof forgesDirPath !== 'string' || !fs.existsSync(forgesDirPath) || !fs.statSync(forgesDirPath).isDirectory()) {
		return refuse.byName({
			moduleName,
			what: `forgesDirPath ${JSON.stringify(forgesDirPath)} is not a directory`,
			where: 'pass the forges/ directory holding the bundle directories',
		});
	}
	const bundleDirNameList = fs
		.readdirSync(forgesDirPath, { withFileTypes: true })
		.filter((oneEntry) => oneEntry.isDirectory())
		.map((oneEntry) => oneEntry.name)
		.filter((oneName) => fs.existsSync(path.join(forgesDirPath, oneName, DESCRIPTOR_FILE_NAME)))
		.sort();
	const bundleDirNameByStandardName = {};
	for (let dirIndex = 0; dirIndex < bundleDirNameList.length; dirIndex++) {
		const oneDirName = bundleDirNameList[dirIndex];
		const descriptorPath = path.join(forgesDirPath, oneDirName, DESCRIPTOR_FILE_NAME);
		const { sectionPresent, valueByName } = readDescriptorSection(descriptorPath);
		if (!sectionPresent) {
			return refuse.byName({
				moduleName,
				what: `${descriptorPath} has no [${DESCRIPTOR_SECTION_NAME}] section`,
				where: 'the section header is required; sectionless keys are discarded by the ini reader',
			});
		}
		const standardName = valueByName.standardName;
		if (typeof standardName !== 'string' || standardName.length === 0) {
			return refuse.byName({
				moduleName,
				what: `${descriptorPath} declares no non-blank standardName`,
				where: 'a bundle without a standardName cannot be compared for uniqueness',
			});
		}
		if (bundleDirNameByStandardName[standardName] !== undefined) {
			return refuse.byName({
				moduleName,
				what: `standardName '${standardName}' is declared by TWO bundle directories: '${bundleDirNameByStandardName[standardName]}' and '${oneDirName}'`,
				where: 'standardName (and therefore _source) must be unique among enabled bundles; rename or disable one',
			});
		}
		bundleDirNameByStandardName[standardName] = oneDirName;
	}
	return null;
};

module.exports = { assertUniqueStandardNames, readDescriptorSection, DESCRIPTOR_FILE_NAME, DESCRIPTOR_SECTION_NAME, moduleName };
