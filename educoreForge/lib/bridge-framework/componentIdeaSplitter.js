'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// componentIdeaSplitter.js — THE ONE DECOMPOSITION, shared by the prompt and by anything that scores it.
//
// WHY THIS IS CODE AND NOT A PROMPT INSTRUCTION. The judge was asked, in prose, to split compound names into
// bare nouns. It mostly did — and it did so INCONSISTENTLY: the same subject yielded `person` in one run and
// not the next, and on one subject it emitted ideas that appear nowhere in the element's names at all. An
// instruction is weighed by this judge, never executed (measured across forty-odd prompt arms, 2026-09-11/13).
// A splitter is executed.
//
// COMPARABILITY IS THE REAL ARGUMENT. While the judge did the splitting, any checker scoring the result was
// comparing ITS decomposition against the judge's, so a flag partly measured their disagreement rather than
// the judge's error. One splitter, used on both sides, collapses that confound.
//
// DELIBERATELY NEUTRAL. This splits names; it does NOT interpret them. `contact` does not become `person`
// here. Synonym judgement lives in whatever is doing the scoring, so that a checker keeps an opinion the
// judge was not handed (TQ ruling, 2026-09-13: "no synonyms").

// Structural words that carry no idea. Kept SHORT on purpose: every entry is a small act of interpretation,
// and the point of this module is not to interpret.
const NOISE_WORD_LIST = Object.freeze(['a', 'an', 'the', 'of', 'or', 'and', 'for', 'to', 'in', 'on', 'by', 'is', 'as', 'at', 'with', 'has']);

// splitCompoundText — camelCase, PascalCase, ACRONYMFollowed, digit boundaries, and any non-alphanumeric
// separator. 'StudentSchoolAssociation' -> student, school, association. 'K12Course' -> k12, course.
const splitCompoundText = (text) =>
	String(text === undefined || text === null ? '' : text)
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.replace(/([a-zA-Z])([0-9])/g, '$1$2')
		.split(/[^A-Za-z0-9]+/)
		.map((oneWord) => oneWord.toLowerCase())
		.filter((oneWord) => oneWord !== '' && NOISE_WORD_LIST.indexOf(oneWord) === -1);

// componentIdeaListFor — the ordered, de-duplicated ideas carried by a list of NAME-BEARING strings.
// Callers pass names ONLY. Descriptions and definitions are never passed: the judge was measured mining a
// fundamental idea out of a candidate's definition prose to justify a pick, and admitting prose here would
// rebuild that loophole inside the shared instrument.
const componentIdeaListFor = ({ nameList } = {}) => {
	if (!Array.isArray(nameList)) {
		throw new Error(`${moduleName}: REFUSED — componentIdeaListFor requires { nameList: [] }, given ${JSON.stringify(nameList)}`);
	}
	const seen = new Set();
	const ideaList = [];
	nameList.forEach((oneName) => splitCompoundText(oneName).forEach((oneWord) => {
		if (!seen.has(oneWord)) {
			seen.add(oneWord);
			ideaList.push(oneWord);
		}
	}));
	return ideaList;
};

module.exports = { componentIdeaListFor, splitCompoundText, NOISE_WORD_LIST };
