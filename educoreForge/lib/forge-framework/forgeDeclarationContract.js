'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeDeclarationContract.js — FORGE_DECLARATION_CONTRACT and its table-driven validator
// (SPEC-forgeFramework-v1.md §4). H1 is a declaration OBJECT — DATA a forge author writes instead of
// code: everything the Profile §3.5 lists as descriptor-shaped constants, plus root data, the
// non-embeddable role list, the anchor sentinel list, the declared additional source inputs and
// the compatibility declaration list.
//
// Validation is a TABLE WALK over the contract, never a switch: every property has a `kind`
// checked by ONE registry of kind-checkers; closed values are enumerated as data; the
// mappingInstruction's six keys are a frozen ordered list compared by position (the JSON string is
// a block byte, SPEC §10 G-JSONKEYS). Refused BY NAME at injectStandardHooks: a missing required
// property; an UNKNOWN property (a typo must not become a silently ignored declaration); a wrong
// kind; a closed-value violation; a permuted/missing/extra mappingInstruction key; a role not in
// DME_ROLES; an unknown allowance id; an allowance id whose declarableBy does not name this
// bundle; an offline-precondition row without probeEvidence; a non-empty allowance list on a
// standardKey outside MIGRATING_BUNDLE_LIST; a stableIdPattern that is not { pattern, trimmed }; a
// nonEmbeddableRoleList that lists a FRAMEWORK-owned role (DmeEmbedText, R-ET-3); an
// embedTextDeclaration that is neither null nor exactly { embedTextLabel, textPropertyListByRole } —
// an unknown inner property, a missing or empty embedTextLabel, an empty role map, a role outside
// DME_ROLES, the DmeEmbedText role itself, an empty or non-list property list, a non-string or empty
// property name, a duplicate name, or a framework-stamped / vector name
// (EMBED_TEXT_FORBIDDEN_PROPERTY_NAME_LIST, plus the bundle's stableUriPropertyName). `name` and
// `description` ARE legitimate text properties.
//
// PURE: returns an Error or null; the caller (forge-framework.js) throws it at injection.

const path = require('path');
const { DME_ROLES } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const refuse = require('./refuse');
const { FRAMEWORK_NON_EMBEDDABLE_ROLE_LIST } = require('./frameworkNonEmbeddableRoles');
const {
	MIGRATION_ALLOWANCE_REGISTRY,
	MIGRATING_BUNDLE_LIST,
	ALLOWANCE_KIND,
} = require('./migrationAllowanceRegistry');

// the SIX keys of mappingInstruction, in the ONE order the four forges stringify them (Ed-Fi
// cg:68-75; SIF forgeSif.js:119-126; CEDS forgeCeds.js:88-95; PESC forgePesc260805.js:67-74)
const MAPPING_INSTRUCTION_KEY_ORDER = Object.freeze([
	'cedsOriginalAnchorPropertyName',
	'cedsOptionOriginalAnchorPropertyName',
	'crosswalkPrefix',
	'crosswalkResolveProperty',
	'includeInImplied',
	'impliedTargets',
]);

const ROOT_STABLE_ID_FROM_VALUES = Object.freeze(['declared', 'sourceUrl']);

const FORGE_DECLARATION_CONTRACT = Object.freeze({
	standardKey: Object.freeze({ required: true, kind: 'lowercaseString' }),
	standardSource: Object.freeze({ required: true, kind: 'nonEmptyString' }),
	standardDisplayName: Object.freeze({ required: true, kind: 'nonEmptyString' }),
	stableUriPropertyName: Object.freeze({ required: true, kind: 'nonEmptyString' }),
	stableIdPattern: Object.freeze({ required: true, kind: 'stableIdPattern' }),
	rootStableIdFrom: Object.freeze({
		required: true,
		kind: 'closedValue',
		allowedValueList: ROOT_STABLE_ID_FROM_VALUES,
	}),
	rootStableId: Object.freeze({ required: false, kind: 'nonEmptyString', requiredWhen: { rootStableIdFrom: 'declared' }, forbiddenWhen: { rootStableIdFrom: 'sourceUrl' } }),
	rootLabel: Object.freeze({ required: true, kind: 'nonEmptyString' }),
	parserVersion: Object.freeze({ required: true, kind: 'nonEmptyString' }),
	mappingInstruction: Object.freeze({ required: true, kind: 'mappingInstruction' }),
	nonEmbeddableRoleList: Object.freeze({ required: true, kind: 'nonEmbeddableRoleList' }),
	// null, or { embedTextLabel, textPropertyListByRole } — REQUIRED on every bundle (R-ET-19): a bundle
	// that embeds no text says so with null
	embedTextDeclaration: Object.freeze({ required: true, kind: 'embedTextDeclaration' }),
	cedsAnchorAbsentSentinelList: Object.freeze({ required: true, kind: 'stringList' }),
	additionalSourceInputList: Object.freeze({ required: true, kind: 'additionalSourceInputList' }),
	compatibilityDeclarationList: Object.freeze({ required: true, kind: 'compatibilityDeclarationList' }),
});

// the two names a non-null embedTextDeclaration carries, exactly
const EMBED_TEXT_DECLARATION_PROPERTY_NAME_LIST = Object.freeze(['embedTextLabel', 'textPropertyListByRole']);

// names a declared text property may NOT be: what the kit, the finalizers or the embed passes stamp,
// and the vector bookkeeping of a text node (the bundle's stableUriPropertyName is added at check time)
const EMBED_TEXT_FORBIDDEN_PROPERTY_NAME_LIST = Object.freeze([
	'searchText',
	'embedding',
	'textEmbedding',
	'embeddingModelVersion',
	'embedSourceProperty',
	'vectorPropertyName',
	'_id',
	'_source',
	'role',
	'parentId',
	'path',
	'stableId',
	'crossRefs',
	'depth',
]);

const isPlainObject = (candidate) =>
	candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);

const DME_ROLE_VALUE_LIST = Object.freeze(Object.values(DME_ROLES));

// ONE registry of kind checkers: (value, { propertyName, forgeDeclaration }) → '' or a reason
const KIND_CHECKER_REGISTRY = Object.freeze({
	nonEmptyString: (value) =>
		typeof value === 'string' && value.length > 0 ? '' : `must be a non-empty string (got ${JSON.stringify(value)})`,
	lowercaseString: (value) =>
		typeof value === 'string' && value.length > 0 && value === value.toLowerCase()
			? ''
			: `must be a non-empty lowercase string (got ${JSON.stringify(value)})`,
	closedValue: (value, { contractEntry }) =>
		contractEntry.allowedValueList.indexOf(value) !== -1
			? ''
			: `'${value}' is not one of: ${contractEntry.allowedValueList.join(', ')}`,
	stringList: (value) =>
		Array.isArray(value) && value.every((oneEntry) => typeof oneEntry === 'string')
			? ''
			: `must be a list of strings (got ${JSON.stringify(value)})`,
	dmeRoleList: (value) => {
		if (!Array.isArray(value)) {
			return `must be a list of DME_ROLES members (got ${JSON.stringify(value)})`;
		}
		const firstNonMember = value.find((oneRole) => DME_ROLE_VALUE_LIST.indexOf(oneRole) === -1);
		return firstNonMember === undefined
			? ''
			: `'${firstNonMember}' is not a DME_ROLES member (allowed: ${DME_ROLE_VALUE_LIST.join(', ')})`;
	},
	// a dmeRoleList that lists no FRAMEWORK-owned role (R-ET-3): the framework owns those roles'
	// non-embeddability and unions them in itself (frameworkNonEmbeddableRoles.js)
	nonEmbeddableRoleList: (value) => {
		const roleListReason = KIND_CHECKER_REGISTRY.dmeRoleList(value);
		if (roleListReason !== '') {
			return roleListReason;
		}
		const frameworkOwnedRole = value.find((oneRole) => FRAMEWORK_NON_EMBEDDABLE_ROLE_LIST.indexOf(oneRole) !== -1);
		if (frameworkOwnedRole !== undefined) {
			return `lists '${frameworkOwnedRole}', a role the framework owns — the framework makes it non-embeddable itself (R-ET-3); remove it from the declaration`;
		}
		return '';
	},
	embedTextDeclaration: (value, { forgeDeclaration }) => {
		if (value === null) {
			return '';
		}
		if (!isPlainObject(value)) {
			return `must be null or { ${EMBED_TEXT_DECLARATION_PROPERTY_NAME_LIST.join(', ')} } (got ${JSON.stringify(value)})`;
		}
		const unknownInnerName = Object.keys(value).find((oneName) => EMBED_TEXT_DECLARATION_PROPERTY_NAME_LIST.indexOf(oneName) === -1);
		if (unknownInnerName !== undefined) {
			return `carries unknown property '${unknownInnerName}'; the shape is exactly { ${EMBED_TEXT_DECLARATION_PROPERTY_NAME_LIST.join(', ')} } or null`;
		}
		if (typeof value.embedTextLabel !== 'string' || value.embedTextLabel.length === 0) {
			return `embedTextLabel must be a non-empty string, the per-standard text-node label verbatim (got ${JSON.stringify(value.embedTextLabel)})`;
		}
		if (!isPlainObject(value.textPropertyListByRole)) {
			return `textPropertyListByRole must be an object { <DME role>: [property names] } (got ${JSON.stringify(value.textPropertyListByRole)})`;
		}
		const declaredRoleList = Object.keys(value.textPropertyListByRole);
		if (declaredRoleList.length === 0) {
			return 'textPropertyListByRole declares no role; a bundle that embeds no text declares embedTextDeclaration: null instead';
		}
		const forbiddenPropertyNameList = EMBED_TEXT_FORBIDDEN_PROPERTY_NAME_LIST.concat([forgeDeclaration.stableUriPropertyName]);
		for (let roleIndex = 0; roleIndex < declaredRoleList.length; roleIndex++) {
			const declaredRole = declaredRoleList[roleIndex];
			const propertyNameList = value.textPropertyListByRole[declaredRole];
			if (DME_ROLE_VALUE_LIST.indexOf(declaredRole) === -1) {
				return `textPropertyListByRole names '${declaredRole}', which is not a DME_ROLES member (allowed: ${DME_ROLE_VALUE_LIST.join(', ')})`;
			}
			if (FRAMEWORK_NON_EMBEDDABLE_ROLE_LIST.indexOf(declaredRole) !== -1) {
				return `textPropertyListByRole names '${declaredRole}', the framework's own text-node role; a text node is never itself a text source`;
			}
			if (!Array.isArray(propertyNameList) || propertyNameList.length === 0) {
				return `textPropertyListByRole.${declaredRole} must be a non-empty list of property names (got ${JSON.stringify(propertyNameList)})`;
			}
			const invalidPropertyName = propertyNameList.find((onePropertyName) => typeof onePropertyName !== 'string' || onePropertyName.length === 0);
			if (invalidPropertyName !== undefined) {
				return `textPropertyListByRole.${declaredRole} lists ${JSON.stringify(invalidPropertyName)}, not a non-empty property name`;
			}
			const duplicatePropertyName = propertyNameList.find((onePropertyName, nameIndex) => propertyNameList.indexOf(onePropertyName) !== nameIndex);
			if (duplicatePropertyName !== undefined) {
				return `textPropertyListByRole.${declaredRole} lists '${duplicatePropertyName}' twice`;
			}
			const forbiddenPropertyName = propertyNameList.find((onePropertyName) => forbiddenPropertyNameList.indexOf(onePropertyName) !== -1);
			if (forbiddenPropertyName !== undefined) {
				return `textPropertyListByRole.${declaredRole} lists '${forbiddenPropertyName}', a framework-stamped, structural or vector property (forbidden: ${forbiddenPropertyNameList.join(', ')}); declare source text only — name and description are legitimate`;
			}
		}
		return '';
	},
	stableIdPattern: (value) => {
		if (!isPlainObject(value)) {
			return `must be { pattern, trimmed } (got ${JSON.stringify(value)})`;
		}
		const extraNames = Object.keys(value).filter((oneName) => oneName !== 'pattern' && oneName !== 'trimmed');
		if (extraNames.length) {
			return `carries unknown property '${extraNames[0]}'; the shape is exactly { pattern, trimmed }`;
		}
		if (typeof value.pattern !== 'string' || value.pattern.length === 0) {
			return `pattern must be a non-empty regex source string (got ${JSON.stringify(value.pattern)})`;
		}
		if (typeof value.trimmed !== 'boolean') {
			return `trimmed must be a boolean (got ${JSON.stringify(value.trimmed)})`;
		}
		return '';
	},
	mappingInstruction: (value) => {
		if (!isPlainObject(value)) {
			return `must be a six-key object (got ${JSON.stringify(value)})`;
		}
		const actualOrder = Object.keys(value);
		if (actualOrder.length !== MAPPING_INSTRUCTION_KEY_ORDER.length) {
			return `must carry exactly the six keys ${MAPPING_INSTRUCTION_KEY_ORDER.join(', ')} (got ${actualOrder.length}: ${actualOrder.join(', ')})`;
		}
		const firstMismatchIndex = MAPPING_INSTRUCTION_KEY_ORDER.findIndex(
			(oneName, oneIndex) => actualOrder[oneIndex] !== oneName,
		);
		if (firstMismatchIndex !== -1) {
			return `key ${firstMismatchIndex + 1} must be '${MAPPING_INSTRUCTION_KEY_ORDER[firstMismatchIndex]}' (got '${actualOrder[firstMismatchIndex]}'); the six keys are stringified onto the root IN THIS ORDER and the string is a block byte`;
		}
		return '';
	},
	additionalSourceInputList: (value) => {
		if (!Array.isArray(value)) {
			return `must be a list of { inputName, relativePathFromSourcePath } (got ${JSON.stringify(value)})`;
		}
		const seenNames = {};
		for (let entryIndex = 0; entryIndex < value.length; entryIndex++) {
			const oneEntry = value[entryIndex];
			if (!isPlainObject(oneEntry)) {
				return `entry ${entryIndex} is not an object`;
			}
			if (typeof oneEntry.inputName !== 'string' || oneEntry.inputName.length === 0) {
				return `entry ${entryIndex} needs a non-empty inputName`;
			}
			if (typeof oneEntry.relativePathFromSourcePath !== 'string' || oneEntry.relativePathFromSourcePath.length === 0) {
				return `entry '${oneEntry.inputName}' needs a non-empty relativePathFromSourcePath`;
			}
			if (path.isAbsolute(oneEntry.relativePathFromSourcePath)) {
				return `entry '${oneEntry.inputName}' relativePathFromSourcePath must be RELATIVE to sourcePath (got an absolute path)`;
			}
			if (seenNames[oneEntry.inputName]) {
				return `inputName '${oneEntry.inputName}' is declared twice`;
			}
			seenNames[oneEntry.inputName] = true;
		}
		return '';
	},
	compatibilityDeclarationList: (value, { forgeDeclaration, migratingBundleList }) => {
		if (!Array.isArray(value)) {
			return `must be a list of { allowanceId, probeEvidence?, ...allowanceData } (got ${JSON.stringify(value)})`;
		}
		if (value.length > 0 && migratingBundleList.indexOf(forgeDeclaration.standardKey) === -1) {
			return `is non-empty but standardKey '${forgeDeclaration.standardKey}' is not in MIGRATING_BUNDLE_LIST (${migratingBundleList.join(', ')}); a NEW forge declares no allowance`;
		}
		const seenIds = {};
		for (let entryIndex = 0; entryIndex < value.length; entryIndex++) {
			const oneEntry = value[entryIndex];
			if (!isPlainObject(oneEntry) || typeof oneEntry.allowanceId !== 'string') {
				return `entry ${entryIndex} must be an object carrying allowanceId`;
			}
			const registryRow = MIGRATION_ALLOWANCE_REGISTRY[oneEntry.allowanceId];
			if (!registryRow) {
				return `allowanceId '${oneEntry.allowanceId}' is not a MIGRATION_ALLOWANCE_REGISTRY row (known: ${Object.keys(MIGRATION_ALLOWANCE_REGISTRY).join(', ')})`;
			}
			if (registryRow.declarableBy.indexOf(forgeDeclaration.standardKey) === -1) {
				return `allowanceId '${oneEntry.allowanceId}' is declarable only by ${registryRow.declarableBy.join(', ')}, not by '${forgeDeclaration.standardKey}'`;
			}
			if (seenIds[oneEntry.allowanceId]) {
				return `allowanceId '${oneEntry.allowanceId}' is declared twice`;
			}
			seenIds[oneEntry.allowanceId] = true;
			if (registryRow.kind === ALLOWANCE_KIND.OFFLINE && !isPlainObject(oneEntry.probeEvidence)) {
				return `allowanceId '${oneEntry.allowanceId}' is an offline-precondition row and must carry probeEvidence { probeName, probeDate, probeResult }`;
			}
			const dataNames = Object.keys(registryRow.allowanceDataContract);
			for (let dataIndex = 0; dataIndex < dataNames.length; dataIndex++) {
				const oneDataName = dataNames[dataIndex];
				const dataContract = registryRow.allowanceDataContract[oneDataName];
				const dataValue = oneEntry[oneDataName];
				if (dataValue === undefined) {
					return `allowanceId '${oneEntry.allowanceId}' must carry allowanceData '${oneDataName}'`;
				}
				if (dataContract.kind === 'stringList' && KIND_CHECKER_REGISTRY.stringList(dataValue) !== '') {
					return `allowanceId '${oneEntry.allowanceId}' ${oneDataName} must be a list of strings`;
				}
				if (dataContract.mustEqual && JSON.stringify(dataValue) !== JSON.stringify(dataContract.mustEqual)) {
					return `allowanceId '${oneEntry.allowanceId}' ${oneDataName} must equal ${JSON.stringify(dataContract.mustEqual)} (got ${JSON.stringify(dataValue)})`;
				}
				if (dataContract.kind === 'stringToEdgeTypeObject' && (!isPlainObject(dataValue) || Object.values(dataValue).some((oneTarget) => typeof oneTarget !== 'string'))) {
					return `allowanceId '${oneEntry.allowanceId}' ${oneDataName} must be an object mapping native type → edge type string`;
				}
			}
			const unknownEntryNames = Object.keys(oneEntry).filter(
				(oneName) => oneName !== 'allowanceId' && oneName !== 'probeEvidence' && dataNames.indexOf(oneName) === -1,
			);
			if (unknownEntryNames.length) {
				return `allowanceId '${oneEntry.allowanceId}' carries unknown property '${unknownEntryNames[0]}' (its allowanceData is ${dataNames.length ? dataNames.join(', ') : 'none'})`;
			}
		}
		return '';
	},
});

// validateForgeDeclaration({ forgeDeclaration, migratingBundleList }) → Error | null
const validateForgeDeclaration = ({ forgeDeclaration, migratingBundleList = MIGRATING_BUNDLE_LIST } = {}) => {
	if (!isPlainObject(forgeDeclaration)) {
		return refuse.byName({
			moduleName,
			what: `forgeDeclaration is ${forgeDeclaration === null ? 'null' : Array.isArray(forgeDeclaration) ? 'an array' : `a ${typeof forgeDeclaration}`}`,
			where: 'injectStandardHooks({ forgeDeclaration, hooks }) needs the H1 declaration object',
		});
	}
	const contractNames = Object.keys(FORGE_DECLARATION_CONTRACT);

	// unknown properties first — a typo must not become a silently ignored declaration
	const unknownName = Object.keys(forgeDeclaration).find((oneName) => contractNames.indexOf(oneName) === -1);
	if (unknownName !== undefined) {
		return refuse.byName({
			moduleName,
			what: `forgeDeclaration carries unknown property '${unknownName}'`,
			where: `FORGE_DECLARATION_CONTRACT names ${contractNames.join(', ')}; remove or rename it`,
		});
	}

	for (let nameIndex = 0; nameIndex < contractNames.length; nameIndex++) {
		const propertyName = contractNames[nameIndex];
		const contractEntry = FORGE_DECLARATION_CONTRACT[propertyName];
		const value = forgeDeclaration[propertyName];
		const isRequiredHere =
			contractEntry.required ||
			(contractEntry.requiredWhen &&
				Object.keys(contractEntry.requiredWhen).every(
					(oneConditionName) => forgeDeclaration[oneConditionName] === contractEntry.requiredWhen[oneConditionName],
				));
		const isForbiddenHere =
			contractEntry.forbiddenWhen &&
			Object.keys(contractEntry.forbiddenWhen).every(
				(oneConditionName) => forgeDeclaration[oneConditionName] === contractEntry.forbiddenWhen[oneConditionName],
			);
		if (value === undefined) {
			if (isRequiredHere) {
				return refuse.byName({
					moduleName,
					what: `forgeDeclaration is missing required property '${propertyName}'`,
					where: `declare ${propertyName} (${contractEntry.kind}) in the H1 declaration object; absent is absent, never defaulted`,
				});
			}
			continue;
		}
		if (isForbiddenHere) {
			return refuse.byName({
				moduleName,
				what: `forgeDeclaration '${propertyName}' is present but forbidden when ${JSON.stringify(contractEntry.forbiddenWhen)}`,
				where: `remove ${propertyName} or change ${Object.keys(contractEntry.forbiddenWhen)[0]}`,
			});
		}
		const reason = KIND_CHECKER_REGISTRY[contractEntry.kind](value, {
			propertyName,
			contractEntry,
			forgeDeclaration,
			migratingBundleList,
		});
		if (reason !== '') {
			return refuse.byName({
				moduleName,
				what: `forgeDeclaration '${propertyName}' ${reason}`,
				where: `fix ${propertyName} in the H1 declaration object`,
			});
		}
	}
	return null;
};

module.exports = {
	FORGE_DECLARATION_CONTRACT,
	MAPPING_INSTRUCTION_KEY_ORDER,
	ROOT_STABLE_ID_FROM_VALUES,
	validateForgeDeclaration,
	moduleName,
};
