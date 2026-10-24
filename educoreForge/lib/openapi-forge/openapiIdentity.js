'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// openapiIdentity.js — the identity rule of every OpenAPI-kit standard (nextStandards-102326 K0, K1), from the profile's prefix:
//   DmeClass        <prefix><Schema>                         a components.schemas member
//   DmeProperty     <prefix><Schema>/<property>              one per (schema, property)
//   DmeOptionSet    <prefix><Schema>/<property>/enum         the ONE enum in that property's shape
//   DmeOptionValue  <prefix><Schema>/<property>/enum/<member>
// and, for the dereferenced layout (K1) only:
//   DmeClass        <owner>/<property>/inline                an inline object matching no component (nested: …/inline/<p>/inline;
//                   <owner>/<property>/items, <owner>/allOf/<n>, <owner>/definitions/<name>: the site's own path segments)
//   DmeOptionSet    <prefix>codeList/<Schema>                a code-list component (an enum-only component), owned by the root
//   DmeOptionValue  <prefix>codeList/<Schema>/<member>
// plus the root and the framework's embed-text nodes under it (<root>/embedText/<sha256>, lib/forge-framework/embedTextDerivation.js).
//
// A member's segment is the member text with every character outside [A-Za-z0-9@_$.:-] percent-encoded (UTF-8): 'Joint Venture' ->
// 'Joint%20Venture', 'application/pdf' -> 'application%2Fpdf'. The node's name stays verbatim. Open Badges' members need no encoding, so
// its ids are the K0 ids. A component named after a reserved segment (codeList, inline, items, allOf, anyOf, oneOf, definitions, enum) is
// refused by the dereferenced walk, so the two id spaces can never collide (K1 ruling, 2026-10-24).
//
// stableIdPatternFor builds the forge declaration's stableIdPattern for the profile's layout, so a bundle restates none of it. A name the
// pattern does not admit is refused by the framework kit at mint, never repaired.

const NAME_PATTERN_SOURCE = '[A-Za-z@_$][A-Za-z0-9@_$.-]*';
const MEMBER_PATTERN_SOURCE = '[A-Za-z0-9@_$.:-]+';
const ENCODED_MEMBER_PATTERN_SOURCE = '[A-Za-z0-9@_$.:%-]+';
// a dereferenced site segment: a property or definition name, a literal segment, or a branch index
const SITE_SEGMENT_PATTERN_SOURCE = '[A-Za-z0-9@_$.-]+';
const ENUM_SEGMENT = 'enum';
const CODE_LIST_SEGMENT = 'codeList';
const SITE_SEGMENT = Object.freeze({ INLINE: 'inline', ITEMS: 'items', DEFINITIONS: 'definitions' });
const RESERVED_SEGMENT_LIST = Object.freeze([CODE_LIST_SEGMENT, SITE_SEGMENT.INLINE, SITE_SEGMENT.ITEMS, SITE_SEGMENT.DEFINITIONS, 'allOf', 'anyOf', 'oneOf', ENUM_SEGMENT]);
const MEMBER_SAFE_CHARACTER_PATTERN = /[A-Za-z0-9@_$.:-]/;

const escapedForPattern = (literalText) => literalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// memberSegmentOf — a member's id segment: safe characters kept, every other character percent-encoded as UTF-8
const memberSegmentOf = (memberText) => Array.from(memberText)
	.map((oneCharacter) => (MEMBER_SAFE_CHARACTER_PATTERN.test(oneCharacter) ? oneCharacter : encodeURIComponent(oneCharacter).replace(/[!'()*]/g, (unescaped) => `%${unescaped.charCodeAt(0).toString(16).toUpperCase()}`)))
	.join('');

const schemaStableIdOf = ({ stableIdPrefix, schemaName }) => `${stableIdPrefix}${schemaName}`;
const propertyStableIdOf = ({ stableIdPrefix, schemaName, propertyName }) => `${stableIdPrefix}${schemaName}/${propertyName}`;
const enumStableIdOf = ({ stableIdPrefix, schemaName, propertyName }) => `${stableIdPrefix}${schemaName}/${propertyName}/${ENUM_SEGMENT}`;
const enumValueStableIdOf = ({ stableIdPrefix, schemaName, propertyName, memberText }) => `${stableIdPrefix}${schemaName}/${propertyName}/${ENUM_SEGMENT}/${memberSegmentOf(memberText)}`;
// K1: an owner's sub-id (a property, an inline class, a site), and the code-list ids
const subStableIdOf = ({ ownerStableId, segmentList }) => [ownerStableId].concat(segmentList).join('/');
const codeListStableIdOf = ({ stableIdPrefix, schemaName }) => `${stableIdPrefix}${CODE_LIST_SEGMENT}/${schemaName}`;
const codeListValueStableIdOf = ({ stableIdPrefix, schemaName, memberText }) => `${stableIdPrefix}${CODE_LIST_SEGMENT}/${schemaName}/${memberSegmentOf(memberText)}`;

// stableIdPatternFor — the declaration's { pattern, trimmed } for one profile. referencedSingleFile is K0's pattern, byte for byte.
const stableIdPatternFor = ({ stableIdPrefix, rootStableId, sourceLayout }) => {
	const rootAlternative = `${escapedForPattern(rootStableId)}(/embedText/[0-9a-f]{64})?`;
	const prefix = escapedForPattern(stableIdPrefix);
	if (sourceLayout === 'dereferencedMultiFile') {
		return Object.freeze({
			pattern: `^(${rootAlternative}|${prefix}${CODE_LIST_SEGMENT}/${NAME_PATTERN_SOURCE}(/${ENCODED_MEMBER_PATTERN_SOURCE})?|${prefix}${NAME_PATTERN_SOURCE}(/${SITE_SEGMENT_PATTERN_SOURCE})*(/${ENUM_SEGMENT}(/${ENCODED_MEMBER_PATTERN_SOURCE})?)?)$`,
			trimmed: true,
		});
	}
	return Object.freeze({
		pattern: `^(${rootAlternative}|${prefix}${NAME_PATTERN_SOURCE}(/${NAME_PATTERN_SOURCE}(/${ENUM_SEGMENT}(/${MEMBER_PATTERN_SOURCE})?)?)?)$`,
		trimmed: true,
	});
};

module.exports = {
	schemaStableIdOf,
	propertyStableIdOf,
	enumStableIdOf,
	enumValueStableIdOf,
	subStableIdOf,
	codeListStableIdOf,
	codeListValueStableIdOf,
	memberSegmentOf,
	stableIdPatternFor,
	ENUM_SEGMENT,
	CODE_LIST_SEGMENT,
	SITE_SEGMENT,
	RESERVED_SEGMENT_LIST,
	moduleName,
};
