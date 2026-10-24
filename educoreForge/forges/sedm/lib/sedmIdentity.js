'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sedmIdentity.js — the identity rule of the SEDM forge bundle (nextStandards-102326 wave 2, lane G; DESIGN-G0-sedm-102426.md §4):
//   DmeStandardRoot  sedm:root
//   DmeClass         sedm:entity/<Entity>
//   DmeProperty      sedm:entity/<Entity>/element/<Element Name>                       (a record with no Category)
//                    sedm:entity/<Entity>/category/<Category>/element/<Element Name>   (Category is in the identity: (Entity, Element
//                                                                                      Name) alone repeats six times in snapshot 01)
//   DmeOptionSet     <element>/optionSet                 the element's own inline code list
//   DmeOptionValue   <element>/optionSet/<code>
//   DmeOptionSet     sedm:declaredOptionSet/<name>       a code list the structures JSON declares, owned by the root
//   DmeOptionValue   sedm:declaredOptionSet/<name>/<value name>
//   DmeSupport       sedm:<supportKind>/<number or name>[/<subtype or subcomponent name>]
// plus the framework's embed-text nodes under the root (<root>/embedText/<sha256>, lib/forge-framework/embedTextDerivation.js).
//
// A segment is the source text with every character outside [A-Za-z0-9@_$.:-] percent-encoded as UTF-8 (the member rule of
// lib/openapi-forge/openapiIdentity.js, restated here so this bundle depends on no kit): 'K12 Student' -> 'K12%20Student',
// 'Parent/Guardian' -> 'Parent%2FGuardian'. The node's name stays verbatim. The fixed words (entity, category, element, optionSet)
// are positional, so no source text can be mistaken for one.

const path = require('path');
const refuse = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'refuse'));

const ROOT_STABLE_ID = 'sedm:root';
const STABLE_ID_PREFIX = 'sedm:';
const SEGMENT_SAFE_CHARACTER_PATTERN = /[A-Za-z0-9@_$.:-]/;
const SEGMENT_PATTERN_SOURCE = '[A-Za-z0-9@_$.:%-]+';
// the DmeSupport kinds, each its own id word (and its own per-standard label, sedmStructuresWalk.js)
const SUPPORT_KIND_LIST = Object.freeze(['ontologyClass', 'complianceCategory', 'ideaIndicator', 'eventMilestone', 'iepComponent', 'etlTemplate', 'useCase', 'entityHierarchy']);
const DECLARED_OPTION_SET_WORD = 'declaredOptionSet';

const escapedForPattern = (literalText) => literalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// segmentOf — one source text as an id segment: safe characters kept, every other character percent-encoded (UTF-8)
const segmentOf = (sourceText) => Array.from(sourceText)
	.map((oneCharacter) => (SEGMENT_SAFE_CHARACTER_PATTERN.test(oneCharacter) ? oneCharacter : encodeURIComponent(oneCharacter).replace(/[!'()*]/g, (unescaped) => `%${unescaped.charCodeAt(0).toString(16).toUpperCase()}`)))
	.join('');

const entityStableIdOf = ({ entityName }) => `${STABLE_ID_PREFIX}entity/${segmentOf(entityName)}`;
const elementStableIdOf = ({ entityName, categoryName, elementName }) => (categoryName === ''
	? `${entityStableIdOf({ entityName })}/element/${segmentOf(elementName)}`
	: `${entityStableIdOf({ entityName })}/category/${segmentOf(categoryName)}/element/${segmentOf(elementName)}`);
const elementOptionSetStableIdOf = ({ elementStableId }) => `${elementStableId}/optionSet`;
const elementOptionValueStableIdOf = ({ elementStableId, codeText }) => `${elementStableId}/optionSet/${segmentOf(codeText)}`;
const declaredOptionSetStableIdOf = ({ optionSetName }) => `${STABLE_ID_PREFIX}${DECLARED_OPTION_SET_WORD}/${segmentOf(optionSetName)}`;
const declaredOptionValueStableIdOf = ({ optionSetName, valueName }) => `${declaredOptionSetStableIdOf({ optionSetName })}/${segmentOf(valueName)}`;
const supportStableIdOf = ({ supportKind, identityText, subIdentityText }) => {
	if (SUPPORT_KIND_LIST.indexOf(supportKind) === -1) {
		throw refuse.byName({ moduleName, what: `supportKind '${supportKind}' is not a SEDM support kind`, where: `SUPPORT_KIND_LIST: ${SUPPORT_KIND_LIST.join(', ')}` });
	}
	const supportStableId = `${STABLE_ID_PREFIX}${supportKind}/${segmentOf(identityText)}`;
	return subIdentityText === undefined ? supportStableId : `${supportStableId}/${segmentOf(subIdentityText)}`;
};

// the declaration's { pattern, trimmed }: every id the rules above can mint, and nothing else
const SEGMENT = SEGMENT_PATTERN_SOURCE;
const STABLE_ID_PATTERN = Object.freeze({
	pattern: `^(${escapedForPattern(ROOT_STABLE_ID)}(/embedText/[0-9a-f]{64})?`
		+ `|${escapedForPattern(STABLE_ID_PREFIX)}entity/${SEGMENT}((/category/${SEGMENT})?/element/${SEGMENT}(/optionSet(/${SEGMENT})?)?)?`
		+ `|${escapedForPattern(STABLE_ID_PREFIX)}${DECLARED_OPTION_SET_WORD}/${SEGMENT}(/${SEGMENT})?`
		+ `|${escapedForPattern(STABLE_ID_PREFIX)}(${SUPPORT_KIND_LIST.join('|')})/${SEGMENT}(/${SEGMENT})?)$`,
	trimmed: true,
});

module.exports = {
	ROOT_STABLE_ID,
	SUPPORT_KIND_LIST,
	STABLE_ID_PATTERN,
	segmentOf,
	entityStableIdOf,
	elementStableIdOf,
	elementOptionSetStableIdOf,
	elementOptionValueStableIdOf,
	declaredOptionSetStableIdOf,
	declaredOptionValueStableIdOf,
	supportStableIdOf,
	moduleName,
};
