'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// edcUri.js — mint and parse edc: URIs (mappingLayers ML1-a, SPEC-mappingLayers-102326 §5; design ruled by BRONZE_CROWN
// 2026-10-24, DESIGN-ML1a-uriSchemeAndAssertionId-102426.md). The kinds are DATA (uriScheme.json beside this file); an
// unlisted kind is refused by name. PURE and synchronous: every function RETURNS { error } or its result, never throws,
// except that a malformed uriScheme.json is refused at load (a scheme that cannot be read is no scheme).
//
//   mint({ kind, ...partByName }) → { uri, curie, kind } | { error }   every placeholder required; an unknown part refused
//   parse(uriOrCurie)             → { kind, partByName } | { error }   exactly ONE kind must match (zero: no kind; two: ambiguous)
//   encodeSegment(text)           → { segmentText } | { error }        NFC, UTF-8, keep the literal list, %XX the rest
//   decodeSegment(segmentText)    → { text } | { error }               refuses a malformed escape or an unencoded character
//
// TRAP: a stableId is NOT URI-safe (measured on the gold: spaces, commas, and '@' in 9,577 SIF ids). Inside a value '/' and
// '@' are always encoded, which is what lets the interpretation kinds use a literal '@' and a template use literal '/'.
// TRAP: a placeholder in the FIRST segment may not take a value equal to another kind's literal first segment ('layer',
// 'agent', …): {standardName}/{standardVersion}/{elementStableId} would otherwise swallow agent/judge/<id>.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

const URI_SCHEME = require(path.join(__dirname, 'uriScheme.json'));

const PLACEHOLDER_PATTERN = /\{([A-Za-z][A-Za-z0-9]*)\}/g;
const HEX_DIGIT_LIST = '0123456789ABCDEF';

// templateTokenListFor(segmentTemplate) → [{ literalText } | { partName }] in order
const templateTokenListFor = (segmentTemplate) => {
	const tokenList = [];
	let cursor = 0;
	segmentTemplate.replace(PLACEHOLDER_PATTERN, (wholeMatch, partName, matchIndex) => {
		if (matchIndex > cursor) {
			tokenList.push({ literalText: segmentTemplate.slice(cursor, matchIndex) });
		}
		tokenList.push({ partName });
		cursor = matchIndex + wholeMatch.length;
		return wholeMatch;
	});
	if (cursor < segmentTemplate.length) {
		tokenList.push({ literalText: segmentTemplate.slice(cursor) });
	}
	return tokenList;
};

const escapeForPattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// a placeholder matches encoded text only: the literal characters plus '%' escapes, never a template literal such as '@'
const literalCharacterSet = new Set(URI_SCHEME.segmentEncoding.literalCharacterList.split(''));
const ENCODED_VALUE_PATTERN_TEXT = `(?:[${escapeForPattern(URI_SCHEME.segmentEncoding.literalCharacterList).replace(/-/g, '\\-')}]|%[0-9A-F]{2})+`;

// KIND_ROW_BY_KIND — each kind compiled once: its segment token lists, its part names, and one anchored pattern per segment
const compileKindRow = (kindRow) => {
	const segmentTemplateList = kindRow.template.split('/');
	const segmentList = segmentTemplateList.map((oneSegmentTemplate) => {
		const tokenList = templateTokenListFor(oneSegmentTemplate);
		const patternText = tokenList.map((oneToken) => (oneToken.partName === undefined ? escapeForPattern(oneToken.literalText) : `(${ENCODED_VALUE_PATTERN_TEXT})`)).join('');
		return { tokenList, segmentPattern: new RegExp(`^${patternText}$`) };
	});
	const partNameList = segmentList.reduce((soFar, oneSegment) => soFar.concat(oneSegment.tokenList.filter((oneToken) => oneToken.partName !== undefined).map((oneToken) => oneToken.partName)), []);
	return { ...kindRow, segmentList, partNameList };
};

// the scheme is refused AT LOAD when it cannot be read as a scheme: a duplicate kind, a part named twice in one template, a
// verbatim part the template does not carry, or a literal character list that would let a value contain '/', '@' or '%'
const schemeLoadRefusal = () => {
	if (typeof URI_SCHEME.baseIri !== 'string' || !/^https?:\/\/.+\/$/.test(URI_SCHEME.baseIri)) {
		return `baseIri ${JSON.stringify(URI_SCHEME.baseIri)} is not an http(s) IRI ending in '/'`;
	}
	const unsafeLiteral = ['/', '@', '%', ' '].find((oneCharacter) => literalCharacterSet.has(oneCharacter));
	if (unsafeLiteral !== undefined) {
		return `segmentEncoding.literalCharacterList keeps '${unsafeLiteral}' literal; a value carrying it could not be parsed back`;
	}
	if (!Array.isArray(URI_SCHEME.kindList) || URI_SCHEME.kindList.length === 0) {
		return 'kindList is absent or empty';
	}
	const seenKindSet = new Set();
	for (let kindIndex = 0; kindIndex < URI_SCHEME.kindList.length; kindIndex++) {
		const kindRow = URI_SCHEME.kindList[kindIndex];
		if (seenKindSet.has(kindRow.kind)) {
			return `kind '${kindRow.kind}' is listed twice`;
		}
		seenKindSet.add(kindRow.kind);
		if (!Array.isArray(kindRow.verbatimPartList)) {
			return `kind '${kindRow.kind}' has no verbatimPartList (an empty list is stated, never assumed)`;
		}
		const compiled = compileKindRow(kindRow);
		if (new Set(compiled.partNameList).size !== compiled.partNameList.length) {
			return `kind '${kindRow.kind}' names a part twice in '${kindRow.template}'`;
		}
		const strayVerbatim = kindRow.verbatimPartList.find((onePartName) => compiled.partNameList.indexOf(onePartName) === -1);
		if (strayVerbatim !== undefined) {
			return `kind '${kindRow.kind}' lists verbatim part '${strayVerbatim}' that its template does not carry`;
		}
	}
	return '';
};
const loadRefusalText = schemeLoadRefusal();
if (loadRefusalText) {
	throw refuse.byName({ moduleName, what: `uriScheme.json REFUSED AT LOAD: ${loadRefusalText}`, where: 'lib/edc-uri/uriScheme.json' });
}

const KIND_ROW_BY_KIND = Object.freeze(URI_SCHEME.kindList.reduce((soFar, oneKindRow) => ({ ...soFar, [oneKindRow.kind]: compileKindRow(oneKindRow) }), {}));
const KIND_LIST = Object.freeze(Object.keys(KIND_ROW_BY_KIND));
// the literal first segments ('layer', 'manifest', 'assertion', 'agent'): a first-segment placeholder may not take one of these
const RESERVED_FIRST_SEGMENT_LIST = Object.freeze(
	Array.from(new Set(KIND_LIST.map((oneKind) => KIND_ROW_BY_KIND[oneKind].segmentList[0].tokenList).filter((oneTokenList) => oneTokenList.length === 1 && oneTokenList[0].literalText !== undefined).map((oneTokenList) => oneTokenList[0].literalText))).sort(),
);

const encodeSegment = (text) => {
	if (typeof text !== 'string') {
		return { error: refuse.byName({ moduleName, what: `a segment value ${JSON.stringify(text)} is not a string`, where: 'encodeSegment(text)' }).message };
	}
	const normalisedText = text.normalize('NFC');
	if (URI_SCHEME.segmentEncoding.forbiddenSegmentTextList.indexOf(normalisedText) !== -1) {
		return { error: refuse.byName({ moduleName, what: `the segment value ${JSON.stringify(normalisedText)} is forbidden`, where: `uriScheme.json segmentEncoding.forbiddenSegmentTextList (${JSON.stringify(URI_SCHEME.segmentEncoding.forbiddenSegmentTextList)})` }).message };
	}
	const byteList = Buffer.from(normalisedText, 'utf8');
	let segmentText = '';
	for (let byteIndex = 0; byteIndex < byteList.length; byteIndex++) {
		const oneByte = byteList[byteIndex];
		const asCharacter = oneByte < 128 ? String.fromCharCode(oneByte) : '';
		segmentText += literalCharacterSet.has(asCharacter) ? asCharacter : `%${HEX_DIGIT_LIST[oneByte >> 4]}${HEX_DIGIT_LIST[oneByte & 15]}`;
	}
	return { segmentText };
};

const decodeSegment = (segmentText) => {
	if (typeof segmentText !== 'string' || segmentText.length === 0) {
		return { error: refuse.byName({ moduleName, what: `segment ${JSON.stringify(segmentText)} is not a non-empty string`, where: 'decodeSegment(segmentText)' }).message };
	}
	const byteList = [];
	for (let characterIndex = 0; characterIndex < segmentText.length; characterIndex++) {
		const oneCharacter = segmentText[characterIndex];
		if (oneCharacter === '%') {
			const hexText = segmentText.slice(characterIndex + 1, characterIndex + 3);
			if (!/^[0-9A-F]{2}$/.test(hexText)) {
				return { error: refuse.byName({ moduleName, what: `segment '${segmentText}' carries a malformed escape at ${characterIndex} ('%${hexText}')`, where: 'an escape is % plus two UPPERCASE hex digits (uriScheme.json segmentEncoding)' }).message };
			}
			byteList.push(parseInt(hexText, 16));
			characterIndex += 2;
			continue;
		}
		if (!literalCharacterSet.has(oneCharacter)) {
			return { error: refuse.byName({ moduleName, what: `segment '${segmentText}' carries the unencoded character '${oneCharacter}'`, where: 'only segmentEncoding.literalCharacterList stands unencoded' }).message };
		}
		byteList.push(oneCharacter.charCodeAt(0));
	}
	const text = Buffer.from(byteList).toString('utf8');
	// a byte run that is not UTF-8, or an encoding of a non-NFC text, does not re-encode to itself: refused, never repaired
	const reEncoded = encodeSegment(text);
	if (reEncoded.error || reEncoded.segmentText !== segmentText) {
		return { error: refuse.byName({ moduleName, what: `segment '${segmentText}' does not decode to a text that encodes back to it`, where: 'the canonical encoding is NFC UTF-8 with the literal list kept (one spelling per value)' }).message };
	}
	return { text };
};

// pathTextFor(uriOrCurie) → { pathText } | { error }: the part after baseIri or after 'edc:'
const pathTextFor = (uriOrCurie) => {
	if (typeof uriOrCurie !== 'string') {
		return { error: refuse.byName({ moduleName, what: `${JSON.stringify(uriOrCurie)} is not a string`, where: 'parse(uriOrCurie)' }).message };
	}
	const curieHead = `${URI_SCHEME.curiePrefix}:`;
	if (uriOrCurie.indexOf(URI_SCHEME.baseIri) === 0) {
		return { pathText: uriOrCurie.slice(URI_SCHEME.baseIri.length) };
	}
	if (uriOrCurie.indexOf(curieHead) === 0) {
		return { pathText: uriOrCurie.slice(curieHead.length) };
	}
	return { error: refuse.byName({ moduleName, what: `'${uriOrCurie}' is neither under ${URI_SCHEME.baseIri} nor a '${curieHead}' CURIE`, where: 'uriScheme.json baseIri / curiePrefix' }).message };
};

// matchKind(kindRow, segmentTextList) → { partByName } | null
const matchKind = (kindRow, segmentTextList) => {
	if (kindRow.segmentList.length !== segmentTextList.length) {
		return null;
	}
	const partByName = {};
	for (let segmentIndex = 0; segmentIndex < segmentTextList.length; segmentIndex++) {
		const { tokenList, segmentPattern } = kindRow.segmentList[segmentIndex];
		const matched = segmentPattern.exec(segmentTextList[segmentIndex]);
		if (matched === null) {
			return null;
		}
		const partTokenList = tokenList.filter((oneToken) => oneToken.partName !== undefined);
		for (let partIndex = 0; partIndex < partTokenList.length; partIndex++) {
			const onePartName = partTokenList[partIndex].partName;
			const encodedText = matched[partIndex + 1];
			if (segmentIndex === 0 && RESERVED_FIRST_SEGMENT_LIST.indexOf(encodedText) !== -1) {
				return null;
			}
			if (kindRow.verbatimPartList.indexOf(onePartName) !== -1) {
				partByName[onePartName] = encodedText;
				continue;
			}
			const decoded = decodeSegment(encodedText);
			if (decoded.error) {
				return null;
			}
			partByName[onePartName] = decoded.text;
		}
	}
	return { partByName };
};

const parse = (uriOrCurie) => {
	const located = pathTextFor(uriOrCurie);
	if (located.error) {
		return located;
	}
	const segmentTextList = located.pathText.split('/');
	const matchList = KIND_LIST.map((oneKind) => ({ kind: oneKind, matched: matchKind(KIND_ROW_BY_KIND[oneKind], segmentTextList) })).filter((oneCandidate) => oneCandidate.matched !== null);
	if (matchList.length === 0) {
		return { error: refuse.byName({ moduleName, what: `'${uriOrCurie}' matches no kind`, where: `uriScheme.json kindList (${KIND_LIST.join(', ')})` }).message };
	}
	if (matchList.length > 1) {
		return { error: refuse.byName({ moduleName, what: `'${uriOrCurie}' is ambiguous: it matches ${matchList.map((oneCandidate) => oneCandidate.kind).join(' and ')}`, where: 'a URI names exactly one kind; uriScheme.json templates must stay disjoint' }).message };
	}
	return { kind: matchList[0].kind, partByName: matchList[0].matched.partByName };
};

const mint = ({ kind, ...partByName } = {}) => {
	const kindRow = KIND_ROW_BY_KIND[kind];
	if (kindRow === undefined) {
		return { error: refuse.byName({ moduleName, what: `kind ${JSON.stringify(kind)} is not in the scheme`, where: `uriScheme.json kindList (${KIND_LIST.join(', ')})` }).message };
	}
	const strayPartName = Object.keys(partByName).find((onePartName) => kindRow.partNameList.indexOf(onePartName) === -1);
	if (strayPartName !== undefined) {
		return { error: refuse.byName({ moduleName, what: `kind '${kind}' has no part '${strayPartName}'`, where: `its template '${kindRow.template}' carries ${kindRow.partNameList.join(', ')}` }).message };
	}
	const absentPartName = kindRow.partNameList.find((onePartName) => typeof partByName[onePartName] !== 'string' || partByName[onePartName].length === 0);
	if (absentPartName !== undefined) {
		return { error: refuse.byName({ moduleName, what: `kind '${kind}' needs part '${absentPartName}' (got ${JSON.stringify(partByName[absentPartName])})`, where: `template '${kindRow.template}'; no part is ever defaulted` }).message };
	}
	const segmentTextList = [];
	for (let segmentIndex = 0; segmentIndex < kindRow.segmentList.length; segmentIndex++) {
		let segmentText = '';
		const { tokenList } = kindRow.segmentList[segmentIndex];
		for (let tokenIndex = 0; tokenIndex < tokenList.length; tokenIndex++) {
			const oneToken = tokenList[tokenIndex];
			if (oneToken.partName === undefined) {
				segmentText += oneToken.literalText;
				continue;
			}
			const partText = partByName[oneToken.partName];
			if (kindRow.verbatimPartList.indexOf(oneToken.partName) !== -1) {
				// a verbatim part was minted by its owner; it must already be a well-formed encoded segment, never re-encoded
				if (!new RegExp(`^${ENCODED_VALUE_PATTERN_TEXT}$`).test(partText) || decodeSegment(partText).error) {
					return { error: refuse.byName({ moduleName, what: `verbatim part '${oneToken.partName}' ${JSON.stringify(partText)} is not an already-encoded segment`, where: `kind '${kind}' copies it from a minted URI (uriScheme.json verbatimPartList)` }).message };
				}
				segmentText += partText;
				continue;
			}
			const encoded = encodeSegment(partText);
			if (encoded.error) {
				return { error: `${moduleName}: kind '${kind}' part '${oneToken.partName}': ${encoded.error}` };
			}
			segmentText += encoded.segmentText;
		}
		segmentTextList.push(segmentText);
	}
	const pathText = segmentTextList.join('/');
	const uri = `${URI_SCHEME.baseIri}${pathText}`;
	// the mint is checked by its own parse: a minted URI that names another kind too, or reads back other parts, is refused
	const parsedBack = parse(uri);
	if (parsedBack.error) {
		return { error: `${moduleName}: kind '${kind}' minted '${uri}', which does not parse back: ${parsedBack.error}` };
	}
	const verbatimAwarePartByName = kindRow.partNameList.reduce((soFar, onePartName) => ({ ...soFar, [onePartName]: kindRow.verbatimPartList.indexOf(onePartName) !== -1 ? partByName[onePartName] : partByName[onePartName].normalize('NFC') }), {});
	if (parsedBack.kind !== kind || JSON.stringify(parsedBack.partByName) !== JSON.stringify(verbatimAwarePartByName)) {
		return { error: refuse.byName({ moduleName, what: `kind '${kind}' minted '${uri}', which parses back as '${parsedBack.kind}' ${JSON.stringify(parsedBack.partByName)}`, where: 'a reserved first segment, or templates that are not disjoint (uriScheme.json)' }).message };
	}
	return { uri, curie: `${URI_SCHEME.curiePrefix}:${pathText}`, kind };
};

module.exports = { mint, parse, encodeSegment, decodeSegment, KIND_LIST, RESERVED_FIRST_SEGMENT_LIST, URI_SCHEME, moduleName };
