'use strict';

// sif260928ContextText.js — a Question's readable path, contextText (PLAN §3 A5; SPEC §3.3 as amended
// by §9 A22). PURE and synchronous.
//
//   contextTextOf(relativePath) → each segment rendered by segmentRenderingOf, joined by ' / ':
//     'Demographics/BirthDate' → 'Demographics / Birth Date'.
//   segmentRenderingOf(segment) → A22's rule, in this order:
//     a leading '@' is dropped (the attribute marker); '_' becomes a space;
//     a space goes before a capital that follows a lowercase letter or a digit ('W4Date' → 'W4 Date');
//     a space goes before the LAST capital of an uppercase run when a lowercase letter follows it
//       ('LEAInfo' → 'LEA Info', 'TitleIProgram' → 'Title I Program'),
//       EXCEPT a plural acronym: the lowercase letter is a lone 's', then the segment ends or a
//       capital follows, and the run stays whole ('OtherLEAs' → 'Other LEAs');
//     digits stay attached to the letters before them, and case is preserved.
//
// C1's per-segment table (sifTextCountWitness-51d3db06b2e6.json, 1,825 rows) is the reference this
// rendering must equal; the forge shares no code with it.

const SEGMENT_SEPARATOR = '/';
const CONTEXT_TEXT_SEPARATOR = ' / ';
const ATTRIBUTE_NAME_PREFIX = '@';
const WORD_SEPARATOR_PATTERN = /_/g;
const UPPERCASE_PATTERN = /[A-Z]/;
const LOWERCASE_PATTERN = /[a-z]/;
const LOWERCASE_OR_DIGIT_PATTERN = /[a-z0-9]/;
const PLURAL_ACRONYM_SUFFIX = 's';

const isUppercase = (character) => character !== undefined && UPPERCASE_PATTERN.test(character);
const isLowercase = (character) => character !== undefined && LOWERCASE_PATTERN.test(character);

// the capital at characterIndex ends an uppercase run and is followed by exactly 's', then the end or
// another capital: the run is a plural acronym and stays whole
const endsPluralAcronym = ({ characterList, characterIndex }) => {
	const followingCharacter = characterList[characterIndex + 1];
	const afterFollowingCharacter = characterList[characterIndex + 2];
	return followingCharacter === PLURAL_ACRONYM_SUFFIX && (afterFollowingCharacter === undefined || isUppercase(afterFollowingCharacter));
};

// a space goes before the capital at characterIndex
const opensWord = ({ characterList, characterIndex }) => {
	const character = characterList[characterIndex];
	const precedingCharacter = characterList[characterIndex - 1];
	if (!isUppercase(character) || precedingCharacter === undefined) {
		return false;
	}
	if (LOWERCASE_OR_DIGIT_PATTERN.test(precedingCharacter)) {
		return true;
	}
	return isUppercase(precedingCharacter) && isLowercase(characterList[characterIndex + 1]) && !endsPluralAcronym({ characterList, characterIndex });
};

const segmentRenderingOf = (segment) => {
	const unmarkedSegment = segment.startsWith(ATTRIBUTE_NAME_PREFIX) ? segment.slice(ATTRIBUTE_NAME_PREFIX.length) : segment;
	const characterList = [...unmarkedSegment.replace(WORD_SEPARATOR_PATTERN, ' ')];
	return characterList.map((character, characterIndex) => (opensWord({ characterList, characterIndex }) ? ` ${character}` : character)).join('');
};

const contextTextOf = (relativePath) => relativePath.split(SEGMENT_SEPARATOR).map(segmentRenderingOf).join(CONTEXT_TEXT_SEPARATOR);

module.exports = { contextTextOf, segmentRenderingOf };
