'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// xsdProfileContract.js — the declared interface of the XSD kit's seam (wave 3 lane I, K3, ruled by BRONZE_CROWN 2026-10-24). A bundle
// plugs into lib/xsd-forge ONLY through its xsd profile (a JSON file in the bundle), so the profile's shape is the contract: every field
// below is REQUIRED (none is defaulted), its kind is checked, and a field the contract does not name is refused, so a misspelt field
// cannot become an ignored one (the openapiProfileContract.js form). Validated once by every factory that reads a profile.
//
//   profileNote                 why this profile reads its snapshot the way it does
//   schemaSetList               [{ schemaSetName, entryFileList }]: a set is its entry files plus their import/include CLOSURE; the forged
//                               files are the union of the closures. A file outside every closure must be excluded by name.
//   schemaLocationTable         { '<schemaLocation exactly as written>': '<snapshot-relative path>' }: where an absolute URL (MedBiquitous
//                               writes http://ns.medbiq.org/…) is held in the snapshot. A relative location needs no row.
//   foreignNamespaceList        [{ namespace, reason }]: another body's namespace. Its import is not followed, and a reference into it
//                               stays EXTERNAL (carried as written, never resolved, FBB-001). An unlisted namespace outside the corpus
//                               refuses; a listed one no file references is refused as stale.
//   schemaFileExclusionList     [{ schemaFile, reason }]: an .xsd/.wsdl in the snapshot the forge does not read. A closure that reaches
//                               an excluded file refuses; an excluded file that is not in the snapshot refuses.
//   enumerationRepeatList       [{ schemaFile, enumerationLocator, reason }]: an enumeration that repeats an earlier value of its own
//                               restriction. It is carried verbatim on the option set's xsdStructureList, not minted again (one value,
//                               one node). An unlisted repeat refuses; a listed locator that is not a repeat refuses as stale.
//   stableIdPrefix              '<token>:'
//   rootStableId                '<token>:root'
//   perStandardLabelByNodeKind  { schemaFile, class, property, optionSet, optionValue, support }: the per-standard label of each node kind

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

const PROFILE_FIELD_NAME_LIST = Object.freeze(['profileNote', 'schemaSetList', 'schemaLocationTable', 'foreignNamespaceList', 'schemaFileExclusionList', 'enumerationRepeatList', 'stableIdPrefix', 'rootStableId', 'perStandardLabelByNodeKind']);
const NODE_KIND_LIST = Object.freeze(['schemaFile', 'class', 'property', 'optionSet', 'optionValue', 'support']);
const STABLE_ID_PREFIX_PATTERN = /^[a-z][a-z0-9]*:$/;
const LABEL_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonEmptyString = (candidate) => typeof candidate === 'string' && candidate.length > 0;
// a snapshot-relative path: forward slashes, no leading slash, no '..' segment
const isSnapshotRelativePath = (candidate) => isNonEmptyString(candidate) && !candidate.startsWith('/') && candidate.split('/').every((oneSegment) => oneSegment !== '' && oneSegment !== '..' && oneSegment !== '.');

const refusalOf = (what, where) => refuse.byName({ moduleName, what, where });

// recordListRefusal — '' when candidate is a list of objects with exactly the named non-empty-string fields, distinct by distinctTextOf
const recordListRefusal = ({ fieldName, candidate, recordFieldNameList, distinctTextOf, pathFieldName }) => {
	if (!Array.isArray(candidate)) {
		return `${fieldName} is not a list`;
	}
	const badIndex = candidate.findIndex((oneRecord) => !isPlainObject(oneRecord)
		|| Object.keys(oneRecord).sort().join('|') !== recordFieldNameList.slice().sort().join('|')
		|| recordFieldNameList.some((oneName) => !isNonEmptyString(oneRecord[oneName])));
	if (badIndex !== -1) {
		return `${fieldName}[${badIndex}] is not { ${recordFieldNameList.join(', ')} } with every field a non-empty string`;
	}
	if (pathFieldName !== undefined) {
		const badPathRecord = candidate.find((oneRecord) => !isSnapshotRelativePath(oneRecord[pathFieldName]));
		if (badPathRecord !== undefined) {
			return `${fieldName} ${pathFieldName} '${badPathRecord[pathFieldName]}' is not a snapshot-relative path`;
		}
	}
	const distinctTextList = candidate.map(distinctTextOf);
	const repeatedText = distinctTextList.find((oneText, textIndex) => distinctTextList.indexOf(oneText) !== textIndex);
	if (repeatedText !== undefined) {
		return `${fieldName} names '${repeatedText}' twice`;
	}
	return '';
};

// validateXsdProfile — throws a named refusal on the first defect; returns the profile unchanged
const validateXsdProfile = (xsdProfile) => {
	if (!isPlainObject(xsdProfile)) {
		throw refusalOf(`the xsd profile is ${xsdProfile === null ? 'null' : typeof xsdProfile}`, 'a bundle hands the kit its profile JSON object');
	}
	const unknownFieldName = Object.keys(xsdProfile).find((oneName) => PROFILE_FIELD_NAME_LIST.indexOf(oneName) === -1);
	if (unknownFieldName !== undefined) {
		throw refusalOf(`the xsd profile carries '${unknownFieldName}'`, `the profile's fields are ${PROFILE_FIELD_NAME_LIST.join(', ')} (lib/xsd-forge/xsdProfileContract.js)`);
	}
	const missingFieldName = PROFILE_FIELD_NAME_LIST.find((oneName) => xsdProfile[oneName] === undefined);
	if (missingFieldName !== undefined) {
		throw refusalOf(`the xsd profile has no '${missingFieldName}'`, 'every profile field is required; none is defaulted');
	}
	if (!isNonEmptyString(xsdProfile.profileNote)) {
		throw refusalOf('profileNote is not a non-empty string', 'say why the profile reads its snapshot this way');
	}
	if (!Array.isArray(xsdProfile.schemaSetList) || xsdProfile.schemaSetList.length === 0) {
		throw refusalOf('schemaSetList is not a non-empty list', 'a profile names at least one schema set: { schemaSetName, entryFileList }');
	}
	const badSetIndex = xsdProfile.schemaSetList.findIndex((oneSet) => !isPlainObject(oneSet)
		|| Object.keys(oneSet).sort().join('|') !== 'entryFileList|schemaSetName'
		|| !isNonEmptyString(oneSet.schemaSetName)
		|| !Array.isArray(oneSet.entryFileList) || oneSet.entryFileList.length === 0 || !oneSet.entryFileList.every(isSnapshotRelativePath));
	if (badSetIndex !== -1) {
		throw refusalOf(`schemaSetList[${badSetIndex}] is not { schemaSetName, entryFileList: [snapshot-relative paths] }`, 'a set names itself and at least one entry file');
	}
	const setNameList = xsdProfile.schemaSetList.map((oneSet) => oneSet.schemaSetName);
	const repeatedSetName = setNameList.find((oneName, nameIndex) => setNameList.indexOf(oneName) !== nameIndex);
	if (repeatedSetName !== undefined) {
		throw refusalOf(`schemaSetList names set '${repeatedSetName}' twice`, 'a set name is unique');
	}
	if (!isPlainObject(xsdProfile.schemaLocationTable) || Object.keys(xsdProfile.schemaLocationTable).some((asWritten) => asWritten === '' || !isSnapshotRelativePath(xsdProfile.schemaLocationTable[asWritten]))) {
		throw refusalOf('schemaLocationTable is not { as-written location: snapshot-relative path }', 'each row maps one schemaLocation, exactly as the source writes it, to a file in the snapshot');
	}
	const foreignRefusal = recordListRefusal({ fieldName: 'foreignNamespaceList', candidate: xsdProfile.foreignNamespaceList, recordFieldNameList: ['namespace', 'reason'], distinctTextOf: (oneRecord) => oneRecord.namespace });
	if (foreignRefusal !== '') {
		throw refusalOf(foreignRefusal, 'a foreign namespace is { namespace, reason }, each named once');
	}
	const exclusionRefusal = recordListRefusal({ fieldName: 'schemaFileExclusionList', candidate: xsdProfile.schemaFileExclusionList, recordFieldNameList: ['reason', 'schemaFile'], distinctTextOf: (oneRecord) => oneRecord.schemaFile, pathFieldName: 'schemaFile' });
	if (exclusionRefusal !== '') {
		throw refusalOf(exclusionRefusal, 'an exclusion is { schemaFile, reason }, each file named once');
	}
	const repeatRefusal = recordListRefusal({ fieldName: 'enumerationRepeatList', candidate: xsdProfile.enumerationRepeatList, recordFieldNameList: ['enumerationLocator', 'reason', 'schemaFile'], distinctTextOf: (oneRecord) => `${oneRecord.schemaFile} ${oneRecord.enumerationLocator}`, pathFieldName: 'schemaFile' });
	if (repeatRefusal !== '') {
		throw refusalOf(repeatRefusal, 'a declared repeat is { schemaFile, enumerationLocator, reason }');
	}
	if (typeof xsdProfile.stableIdPrefix !== 'string' || !STABLE_ID_PREFIX_PATTERN.test(xsdProfile.stableIdPrefix)) {
		throw refusalOf(`stableIdPrefix ${JSON.stringify(xsdProfile.stableIdPrefix)} is not '<token>:'`, `a prefix matches ${STABLE_ID_PREFIX_PATTERN}`);
	}
	if (xsdProfile.rootStableId !== `${xsdProfile.stableIdPrefix}root`) {
		throw refusalOf(`rootStableId ${JSON.stringify(xsdProfile.rootStableId)} is not '${xsdProfile.stableIdPrefix}root'`, 'the root is the prefix and the word root');
	}
	const labelTable = xsdProfile.perStandardLabelByNodeKind;
	if (!isPlainObject(labelTable) || Object.keys(labelTable).sort().join('|') !== NODE_KIND_LIST.slice().sort().join('|') || NODE_KIND_LIST.some((oneKind) => typeof labelTable[oneKind] !== 'string' || !LABEL_PATTERN.test(labelTable[oneKind]))) {
		throw refusalOf('perStandardLabelByNodeKind is not one label per node kind', `name exactly ${NODE_KIND_LIST.join(', ')}, each a label matching ${LABEL_PATTERN}`);
	}
	return xsdProfile;
};

module.exports = { validateXsdProfile, moduleName };
