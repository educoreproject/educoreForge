'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// openapiProfileContract.js — the declared interface of the OpenAPI kit's seam (nextStandards-102326 K0). A bundle plugs into
// lib/openapi-forge ONLY through its openapi profile (a JSON file in the bundle), so the profile's shape is the contract: every
// field below is REQUIRED (none is defaulted), its kind is checked, and a field the contract does not name is refused, so a
// misspelt field cannot become an ignored one. Validated once by every factory that reads a profile (loader, walk, pair, hooks).
//
// sourceFormat is a closed list. 'yaml' is refused by its own name in K0 (ruled 2026-10-23): CASE's lane adds the reader with its
// own twin; js-yaml is already a dependency, so that is a row here and a loader branch, not a new package.

const path = require('path');
const { DME_ROLES } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));

const READABLE_SOURCE_FORMAT_LIST = Object.freeze(['json']);
const NOT_YET_READABLE_SOURCE_FORMAT_LIST = Object.freeze(['yaml']);
const LABELLED_ROLE_LIST = Object.freeze([DME_ROLES.CLASS, DME_ROLES.PROPERTY, DME_ROLES.OPTION_SET, DME_ROLES.OPTION_VALUE]);
// a prefix is a standard token and a colon (openbadges:); a root id is that prefix and a name
const STABLE_ID_PREFIX_PATTERN = /^[a-z][a-z0-9]*:$/;

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isStringList = (candidate) => Array.isArray(candidate) && candidate.every((oneValue) => typeof oneValue === 'string' && oneValue.length > 0);

const KIND_CHECK_BY_KIND = Object.freeze({
	nonEmptyString: (candidate) => typeof candidate === 'string' && candidate.length > 0,
	stringList: isStringList,
	stableIdPrefix: (candidate) => typeof candidate === 'string' && STABLE_ID_PREFIX_PATTERN.test(candidate),
	sourceFormat: (candidate) => READABLE_SOURCE_FORMAT_LIST.indexOf(candidate) !== -1,
	perStandardLabelByRole: (candidate) => isPlainObject(candidate)
		&& JSON.stringify(Object.keys(candidate).sort()) === JSON.stringify(LABELLED_ROLE_LIST.slice().sort())
		&& Object.values(candidate).every((oneLabel) => typeof oneLabel === 'string' && /^[A-Z][A-Za-z0-9]*$/.test(oneLabel)),
});

const OPENAPI_PROFILE_FIELD_KIND = Object.freeze({
	profileNote: 'nonEmptyString',
	sourceFileName: 'nonEmptyString',
	sourceFormat: 'sourceFormat',
	stableIdPrefix: 'stableIdPrefix',
	rootStableId: 'nonEmptyString',
	perStandardLabelByRole: 'perStandardLabelByRole',
	schemaExclusionList: 'stringList',
});

const refused = (what) => new Error(`${moduleName} REFUSED: ${what} — the openapi profile is the kit's whole seam; see lib/openapi-forge/openapiProfileContract.js`);

// validateOpenapiProfile — throws a named refusal, or returns the profile unchanged
const validateOpenapiProfile = (openapiProfile) => {
	if (!isPlainObject(openapiProfile)) {
		throw refused(`the profile is ${openapiProfile === null ? 'null' : typeof openapiProfile}, not an object`);
	}
	const unknownFieldName = Object.keys(openapiProfile).find((fieldName) => OPENAPI_PROFILE_FIELD_KIND[fieldName] === undefined);
	if (unknownFieldName !== undefined) {
		throw refused(`field '${unknownFieldName}' is not in the contract (known: ${Object.keys(OPENAPI_PROFILE_FIELD_KIND).join(', ')})`);
	}
	const missingFieldName = Object.keys(OPENAPI_PROFILE_FIELD_KIND).find((fieldName) => openapiProfile[fieldName] === undefined);
	if (missingFieldName !== undefined) {
		throw refused(`required field '${missingFieldName}' is absent; no field is defaulted`);
	}
	if (NOT_YET_READABLE_SOURCE_FORMAT_LIST.indexOf(openapiProfile.sourceFormat) !== -1) {
		throw refused(`sourceFormat '${openapiProfile.sourceFormat}' is not read by the K0 kit (readable: ${READABLE_SOURCE_FORMAT_LIST.join(', ')}); the YAML reader arrives with its own twin in the lane that needs it`);
	}
	const misKindedFieldName = Object.keys(OPENAPI_PROFILE_FIELD_KIND).find((fieldName) => !KIND_CHECK_BY_KIND[OPENAPI_PROFILE_FIELD_KIND[fieldName]](openapiProfile[fieldName]));
	if (misKindedFieldName !== undefined) {
		throw refused(`field '${misKindedFieldName}' is ${JSON.stringify(openapiProfile[misKindedFieldName])}, not a valid ${OPENAPI_PROFILE_FIELD_KIND[misKindedFieldName]}`);
	}
	if (!openapiProfile.rootStableId.startsWith(openapiProfile.stableIdPrefix)) {
		throw refused(`rootStableId '${openapiProfile.rootStableId}' does not begin with stableIdPrefix '${openapiProfile.stableIdPrefix}'`);
	}
	return openapiProfile;
};

module.exports = { validateOpenapiProfile, OPENAPI_PROFILE_FIELD_KIND, READABLE_SOURCE_FORMAT_LIST, LABELLED_ROLE_LIST, moduleName };
