'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// openapiIdentity.js — the identity rule of every OpenAPI-kit standard (nextStandards-102326 K0), from the profile's prefix:
//   DmeClass        <prefix><Schema>                         a components.schemas member
//   DmeProperty     <prefix><Schema>/<property>              one per (schema, property)
//   DmeOptionSet    <prefix><Schema>/<property>/enum         the ONE enum in that property's shape
//   DmeOptionValue  <prefix><Schema>/<property>/enum/<member>
// plus the root and the framework's embed-text nodes under it (<root>/embedText/<sha256>, lib/forge-framework/embedTextDerivation.js).
// stableIdPatternFor builds the forge declaration's stableIdPattern from the same rule, so a bundle restates none of it. A name
// the pattern does not admit (a '/' or a space in a member) is refused by the framework kit at mint, never repaired.

const NAME_PATTERN_SOURCE = '[A-Za-z@_$][A-Za-z0-9@_$.-]*';
const MEMBER_PATTERN_SOURCE = '[A-Za-z0-9@_$.:-]+';
const ENUM_SEGMENT = 'enum';

const escapedForPattern = (literalText) => literalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const schemaStableIdOf = ({ stableIdPrefix, schemaName }) => `${stableIdPrefix}${schemaName}`;
const propertyStableIdOf = ({ stableIdPrefix, schemaName, propertyName }) => `${stableIdPrefix}${schemaName}/${propertyName}`;
const enumStableIdOf = ({ stableIdPrefix, schemaName, propertyName }) => `${stableIdPrefix}${schemaName}/${propertyName}/${ENUM_SEGMENT}`;
const enumValueStableIdOf = ({ stableIdPrefix, schemaName, propertyName, memberText }) => `${stableIdPrefix}${schemaName}/${propertyName}/${ENUM_SEGMENT}/${memberText}`;

// stableIdPatternFor — the declaration's { pattern, trimmed } for one profile
const stableIdPatternFor = ({ stableIdPrefix, rootStableId }) => Object.freeze({
	pattern: `^(${escapedForPattern(rootStableId)}(/embedText/[0-9a-f]{64})?|${escapedForPattern(stableIdPrefix)}${NAME_PATTERN_SOURCE}(/${NAME_PATTERN_SOURCE}(/${ENUM_SEGMENT}(/${MEMBER_PATTERN_SOURCE})?)?)?)$`,
	trimmed: true,
});

module.exports = { schemaStableIdOf, propertyStableIdOf, enumStableIdOf, enumValueStableIdOf, stableIdPatternFor, ENUM_SEGMENT, moduleName };
