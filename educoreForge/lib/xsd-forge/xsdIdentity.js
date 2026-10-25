'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// xsdIdentity.js — the identity rule of every XSD-kit standard (wave 3 lane I, K3, ruled by BRONZE_CROWN 2026-10-24), from the profile's
// prefix. Keyed on the NAMESPACE, as PESC's §2.3 is, never on the file, so two files of one namespace share one identity space and a
// name defined twice refuses instead of colliding silently:
//   schema file          <prefix>schemaFile/<snapshot-relative path>
//   top-level definition <prefix><symbol space>/<namespace path>#<name>        symbol space: type | element | group | attributeGroup
//   nested node          <owner id>/<segment>/<name>                           segment: el | attr | elRef | attrRef (a property)
//                        <declaration id>/anon                                 the declaration's anonymous type
//                        <option set id>/code/<encoded value>                  an enumeration
// The namespace path is the namespace URI without its http:// or https:// scheme and its trailing slash ('http://ns.medbiq.org/member/v2/'
// -> 'ns.medbiq.org/member/v2'). A value's segment percent-encodes every character outside [A-Za-z0-9@_$.:-] (UTF-8), the openapiIdentity
// rule, copied rather than required so neither kit's ids depend on the other's code. A name the pattern does not admit is refused by the
// framework kit at mint, never repaired.

const refuse = require(require('path').join(__dirname, '..', 'forge-framework', 'refuse'));

const SCHEMA_FILE_SEGMENT = 'schemaFile';
const ANONYMOUS_SEGMENT = 'anon';
const VALUE_SEGMENT = 'code';
const NAMESPACE_SCHEME_PATTERN = /^https?:\/\//;
const NAMESPACE_PATH_PATTERN_SOURCE = '[A-Za-z0-9._~-]+(/[A-Za-z0-9._~-]+)*';
const NAMESPACE_PATH_PATTERN = new RegExp(`^${NAMESPACE_PATH_PATTERN_SOURCE}$`);
const NCNAME_PATTERN_SOURCE = '[A-Za-z_][A-Za-z0-9._-]*';
const RELATIVE_PATH_PATTERN_SOURCE = '[A-Za-z0-9._ -]+(/[A-Za-z0-9._ -]+)*';
const ENCODED_VALUE_PATTERN_SOURCE = '[A-Za-z0-9@_$.:%-]+';
const VALUE_SAFE_CHARACTER_PATTERN = /[A-Za-z0-9@_$.:-]/;
const TOP_LEVEL_SEGMENT_LIST = Object.freeze(['type', 'element', 'group', 'attributeGroup']);
const PROPERTY_SEGMENT_LIST = Object.freeze(['el', 'attr', 'elRef', 'attrRef']);

const escapedForPattern = (literalText) => literalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// namespacePathOf — a namespace URI's identity path, or a named refusal (a URN or other scheme is not taught)
const namespacePathOf = (namespaceUri) => {
	const namespacePath = `${namespaceUri}`.replace(NAMESPACE_SCHEME_PATTERN, '').replace(/\/+$/, '');
	if (!NAMESPACE_SCHEME_PATTERN.test(namespaceUri) || !NAMESPACE_PATH_PATTERN.test(namespacePath)) {
		throw refuse.byName({ moduleName, what: `namespace '${namespaceUri}' has no identity path (it gives '${namespacePath}')`, where: `the kit keys identity on http(s) namespaces whose path matches ${NAMESPACE_PATH_PATTERN}; another form is an identity-rule decision` });
	}
	return namespacePath;
};

// valueSegmentOf — an enumeration value's id segment: safe characters kept, every other character percent-encoded as UTF-8
const valueSegmentOf = (valueText) => Array.from(valueText)
	.map((oneCharacter) => (VALUE_SAFE_CHARACTER_PATTERN.test(oneCharacter) ? oneCharacter : encodeURIComponent(oneCharacter).replace(/[!'()*]/g, (unescaped) => `%${unescaped.charCodeAt(0).toString(16).toUpperCase()}`)))
	.join('');

const schemaFileStableIdOf = ({ stableIdPrefix, schemaFileRelativePath }) => `${stableIdPrefix}${SCHEMA_FILE_SEGMENT}/${schemaFileRelativePath}`;
const topLevelStableIdOf = ({ stableIdPrefix, stableIdSegment, namespaceUri, localName }) => `${stableIdPrefix}${stableIdSegment}/${namespacePathOf(namespaceUri)}#${localName}`;
const nestedStableIdOf = ({ ownerStableId, stableIdSegment, localName }) => `${ownerStableId}/${stableIdSegment}/${localName}`;
const anonymousStableIdOf = ({ declarationStableId }) => `${declarationStableId}/${ANONYMOUS_SEGMENT}`;
const valueStableIdOf = ({ optionSetStableId, valueText }) => `${optionSetStableId}/${VALUE_SEGMENT}/${valueSegmentOf(valueText)}`;

// stableIdPatternFor — the declaration's { pattern, trimmed } for one profile
const stableIdPatternFor = ({ stableIdPrefix, rootStableId }) => {
	const prefix = escapedForPattern(stableIdPrefix);
	const nestedSource = `(/(${PROPERTY_SEGMENT_LIST.join('|')})/${NCNAME_PATTERN_SOURCE}|/${ANONYMOUS_SEGMENT})*(/${VALUE_SEGMENT}/${ENCODED_VALUE_PATTERN_SOURCE})?`;
	return Object.freeze({
		pattern: `^(${escapedForPattern(rootStableId)}(/embedText/[0-9a-f]{64})?|${prefix}${SCHEMA_FILE_SEGMENT}/${RELATIVE_PATH_PATTERN_SOURCE}|${prefix}(${TOP_LEVEL_SEGMENT_LIST.join('|')})/${NAMESPACE_PATH_PATTERN_SOURCE}#${NCNAME_PATTERN_SOURCE}${nestedSource})$`,
		trimmed: true,
	});
};

module.exports = {
	schemaFileStableIdOf,
	topLevelStableIdOf,
	nestedStableIdOf,
	anonymousStableIdOf,
	valueStableIdOf,
	stableIdPatternFor,
	moduleName,
};
