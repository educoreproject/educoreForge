'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// rootNode.js — the ONE DmeStandardRoot, framework-built from DECLARED data
// (SPEC-forgeFramework-v1.md §6.5; Profile §10.4). Shape: forgeEdfiContractGraph.js:455-495,
// forgeSif.js:366-404, forgeCeds.js:462-500 made one. A forge MUST NOT hand-roll the root;
// describeRoot's { description?, extraProperties? } is the only per-standard input.
//
// ENFORCED (refused by name unless an allowance licenses the omission): REQUIRED_PROPERTIES.STANDARD_ROOT
// (the eight, vocabulary.js) AND the five (snapshotKey, publishedVersion, versionSource,
// parserVersion, coreVersion). P5 (PESC, not an F3a row) will license omitting exactly FOUR via
// `rootOmitPropertyList`; parserVersion is NEVER licensed (FR10). extraProperties are refused
// unless an active allowance's `rootExtraPropertyNameList` names each key.
//
// sourceUrl: stamped as describeSource returned it; '' survives ONLY through E6/S4/P16 (already
// admitted at forge() step 4); a describeSource `null` means "this standard has no source URL"
// and the root OMITS the property (Profile §10.4: absent is absent) — that null IS the declared
// reason the enforcement of the eight accepts. sourceFiles is stamped as returned ([] only under S7).

const path = require('path');
const { DME_ROLES, NODE_LABELS, REQUIRED_PROPERTIES } = require(
	path.join(__dirname, '..', 'vocabulary', 'vocabulary'),
);
const { buildSearchText } = require(path.join(__dirname, '..', 'search-text', 'build-search-text'))();
const refuse = require('./refuse');

const CORE_VERSION = '2.0.0';

// the five beyond REQUIRED_PROPERTIES.STANDARD_ROOT (Profile §10.4 v1.0.2 MUST)
const ROOT_PROVENANCE_PROPERTY_LIST = Object.freeze([
	'snapshotKey',
	'publishedVersion',
	'versionSource',
	'parserVersion',
	'coreVersion',
]);
const NEVER_OMITTABLE_ROOT_PROPERTY_LIST = Object.freeze(['parserVersion']);

const isPlainObject = (candidate) =>
	candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);

// resolveRootStableId — 'declared' → forgeDeclaration.rootStableId; 'sourceUrl' → metadata.sourceUrl (CEDS)
const resolveRootStableId = ({ forgeDeclaration, metadata }) => {
	if (forgeDeclaration.rootStableIdFrom === 'declared') {
		return forgeDeclaration.rootStableId;
	}
	if (typeof metadata.sourceUrl !== 'string' || metadata.sourceUrl.length === 0) {
		throw refuse.byName({
			moduleName,
			what: `rootStableIdFrom is 'sourceUrl' but metadata.sourceUrl is ${JSON.stringify(metadata.sourceUrl)}`,
			where: "a root addressed by its sourceUrl needs describeSource to return a non-empty sourceUrl (CEDS, forgeCeds.js:469)",
		});
	}
	return metadata.sourceUrl;
};

// build({ forgeDeclaration, metadata, describedRoot, activeAllowanceById, activeAllowanceRowList }) → root node
//   activeAllowanceById   — the declaration entries (allowanceData) keyed by id
//   activeAllowanceRowList — the registry rows of those ids (rootEmptyPermittedPropertyList lives on the row)
const build = ({ forgeDeclaration, metadata, describedRoot, activeAllowanceById = {}, activeAllowanceRowList = [] } = {}) => {
	if (!isPlainObject(describedRoot)) {
		throw refuse.byName({
			moduleName,
			what: `describeRoot returned ${describedRoot === null ? 'null' : `a ${typeof describedRoot}`}, not an object`,
			where: 'describeRoot({ parsed, metadata }) returns { description?, extraProperties? }',
		});
	}
	const unknownDescribedName = Object.keys(describedRoot).find(
		(oneName) => oneName !== 'description' && oneName !== 'extraProperties',
	);
	if (unknownDescribedName !== undefined) {
		throw refuse.byName({
			moduleName,
			what: `describeRoot returned unknown property '${unknownDescribedName}'`,
			where: 'describeRoot returns only { description?, extraProperties? }; a root field is framework-built from the declaration',
		});
	}
	if (describedRoot.description !== undefined && typeof describedRoot.description !== 'string') {
		throw refuse.byName({
			moduleName,
			what: `describeRoot.description is a ${typeof describedRoot.description}`,
			where: 'description is a source-stated string, or absent (then the root carries no description)',
		});
	}

	const rootOmitPropertyList = Object.keys(activeAllowanceById).reduce(
		(soFar, oneAllowanceId) => soFar.concat(activeAllowanceById[oneAllowanceId].rootOmitPropertyList || []),
		[],
	);
	const rootExtraPropertyNameList = Object.keys(activeAllowanceById).reduce(
		(soFar, oneAllowanceId) => soFar.concat(activeAllowanceById[oneAllowanceId].rootExtraPropertyNameList || []),
		[],
	);
	const rootEmptyPermittedPropertyList = activeAllowanceRowList.reduce(
		(soFar, oneRow) => soFar.concat(oneRow.rootEmptyPermittedPropertyList || []),
		[],
	);
	const forbiddenOmission = rootOmitPropertyList.find(
		(oneName) => NEVER_OMITTABLE_ROOT_PROPERTY_LIST.indexOf(oneName) !== -1,
	);
	if (forbiddenOmission !== undefined) {
		throw refuse.byName({
			moduleName,
			what: `an allowance licenses omitting root '${forbiddenOmission}'`,
			where: `${forbiddenOmission} is never licensed for omission (FR10)`,
		});
	}

	const extraProperties = describedRoot.extraProperties === undefined ? {} : describedRoot.extraProperties;
	if (!isPlainObject(extraProperties)) {
		throw refuse.byName({
			moduleName,
			what: 'describeRoot.extraProperties is not a plain object',
			where: 'extraProperties is an object whose every key an active allowance names, or absent',
		});
	}
	const unlicensedExtraName = Object.keys(extraProperties).find(
		(oneName) => rootExtraPropertyNameList.indexOf(oneName) === -1,
	);
	if (unlicensedExtraName !== undefined) {
		throw refuse.byName({
			moduleName,
			what: `describeRoot.extraProperties carries '${unlicensedExtraName}' and no active allowance names it`,
			where: 'a root field is framework-built; a per-standard extra needs a registry row (P5: pescTier)',
		});
	}

	const rootStableId = resolveRootStableId({ forgeDeclaration, metadata });
	const { standardKey, standardSource, standardDisplayName, stableUriPropertyName, rootLabel, parserVersion, mappingInstruction } = forgeDeclaration;

	const candidateProperties = {
		_id: rootStableId,
		_source: standardSource,
		name: standardSource,
		role: DME_ROLES.STANDARD_ROOT,
		[stableUriPropertyName]: rootStableId,
		searchText: buildSearchText({ role: DME_ROLES.STANDARD_ROOT, name: standardSource, standardName: standardDisplayName }),
		...(describedRoot.description !== undefined ? { description: describedRoot.description } : {}),
		standardKey,
		standardName: standardDisplayName,
		version: metadata.version,
		sourceFormat: metadata.sourceFormat,
		sourceFiles: metadata.sourceFiles,
		...(metadata.sourceUrl === null ? {} : { sourceUrl: metadata.sourceUrl }),
		stableUriPropertyName,
		mappingInstruction: JSON.stringify(mappingInstruction),
		snapshotKey: metadata.snapshotKey,
		publishedVersion: metadata.publishedVersion,
		versionSource: metadata.versionSource,
		parserVersion,
		coreVersion: CORE_VERSION,
		...extraProperties,
	};
	rootOmitPropertyList.forEach((oneName) => {
		delete candidateProperties[oneName];
	});

	// ENFORCE the eight + the five, refusing by name (sourceUrl null = declared absence)
	const requiredNameList = REQUIRED_PROPERTIES.STANDARD_ROOT.concat(ROOT_PROVENANCE_PROPERTY_LIST);
	for (let nameIndex = 0; nameIndex < requiredNameList.length; nameIndex++) {
		const oneName = requiredNameList[nameIndex];
		if (rootOmitPropertyList.indexOf(oneName) !== -1) {
			continue;
		}
		if (oneName === 'sourceUrl' && metadata.sourceUrl === null) {
			continue;
		}
		const value = candidateProperties[oneName];
		const isAbsent = value === undefined || value === null;
		const isEmpty = value === '' || (Array.isArray(value) && value.length === 0);
		if (isAbsent || (isEmpty && rootEmptyPermittedPropertyList.indexOf(oneName) === -1)) {
			throw refuse.byName({
				moduleName,
				what: `the root is missing required property '${oneName}' (got ${JSON.stringify(value)})`,
				where: `the root carries ${requiredNameList.join(', ')}; a missing value is a declaration or describeSource defect, never defaulted`,
			});
		}
	}

	return {
		labels: [NODE_LABELS.FORGED_NODE, rootLabel, DME_ROLES.STANDARD_ROOT],
		stableId: rootStableId,
		role: DME_ROLES.STANDARD_ROOT,
		properties: candidateProperties,
	};
};

module.exports = { build, resolveRootStableId, CORE_VERSION, ROOT_PROVENANCE_PROPERTY_LIST, moduleName };
