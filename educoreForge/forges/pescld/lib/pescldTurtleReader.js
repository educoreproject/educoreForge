'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// pescldTurtleReader.js — a strict reader for the Turtle the PESC_LD package's SHACL file is written in (zeroBacklog lane C1). It
// serves ONLY the second oracle (lib/pescldTtlOracle.js); the forge never reads the TTL. The tree carries no RDF library, and the
// file is serializer output in a small regular subset of Turtle 1.1, so the reader implements that subset and REFUSES by name
// everything outside it rather than skipping it:
//   directives   @base <iri> .   @prefix p: <iri> .   ('#' comments to end of line)
//   statements   subject predicateObjectList '.'  with ';' between predicates and ',' between objects
//   subject      <iri>
//   predicate    'a' (rdf:type) | prefixed name
//   object       <iri> | prefixed name | "string" or """long string""" with an optional @lang or ^^datatype | integer |
//                true / false | ( collection ) | [ blank node property list ]
// PURE: text in, subjects out. A result is { refusalText } or { baseIri, iriByPrefix, subjectList: [{ subjectIri, predicateMap }] }
// where predicateMap maps a predicate (as written: 'a' becomes 'rdf:type') to its object terms in source order:
//   { termKind: 'iri', iriText }  { termKind: 'prefixedName', nameText }  { termKind: 'literal', literalText, languageTag?, datatypeName? }
//   { termKind: 'integer', integerValue }  { termKind: 'boolean', booleanValue }  { termKind: 'collection', itemList }
//   { termKind: 'blankNode', predicateMap }

const PREFIXED_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*:[A-Za-z0-9_.-]*[A-Za-z0-9_-]|^[A-Za-z][A-Za-z0-9_-]*:/;
const LANGUAGE_TAG_RE = /^@[A-Za-z]+(-[A-Za-z0-9]+)*/;
const INTEGER_RE = /^[+-]?[0-9]+/;
const STRING_ESCAPE_BY_CHAR = Object.freeze({ t: '\t', n: '\n', r: '\r', '"': '"', "'": "'", '\\': '\\', b: '\b', f: '\f' });

// readTurtleText({ turtleText, sourceFileName }) → { refusalText } | { baseIri, iriByPrefix, subjectList }
const readTurtleText = ({ turtleText, sourceFileName }) => {
	let cursor = 0;
	let refusalText;
	const fail = (what) => {
		if (refusalText === undefined) {
			const lineNumber = turtleText.slice(0, cursor).split('\n').length;
			refusalText = `${moduleName} REFUSED: '${sourceFileName}' line ${lineNumber}: ${what} (near ${JSON.stringify(turtleText.slice(cursor, cursor + 30))})`;
		}
		return undefined;
	};
	const skipSpace = () => {
		while (cursor < turtleText.length) {
			if (/\s/.test(turtleText[cursor])) {
				cursor += 1;
			} else if (turtleText[cursor] === '#') {
				const lineEnd = turtleText.indexOf('\n', cursor);
				cursor = lineEnd === -1 ? turtleText.length : lineEnd + 1;
			} else {
				return;
			}
		}
	};
	const isAt = (tokenText) => turtleText.startsWith(tokenText, cursor);
	const expect = (tokenText) => {
		skipSpace();
		if (!isAt(tokenText)) {
			return fail(`expected '${tokenText}'`);
		}
		cursor += tokenText.length;
		return true;
	};
	const readIri = () => {
		const closeIndex = turtleText.indexOf('>', cursor);
		if (closeIndex === -1 || /[\s<"{}|^`\\]/.test(turtleText.slice(cursor + 1, closeIndex))) {
			return fail('an IRI reference does not close cleanly');
		}
		const iriText = turtleText.slice(cursor + 1, closeIndex);
		cursor = closeIndex + 1;
		return { termKind: 'iri', iriText };
	};
	const readPrefixedName = () => {
		const nameMatch = turtleText.slice(cursor).match(PREFIXED_NAME_RE);
		if (nameMatch === null) {
			return fail('expected a prefixed name');
		}
		cursor += nameMatch[0].length;
		return { termKind: 'prefixedName', nameText: nameMatch[0] };
	};
	const readStringBody = () => {
		const quoteText = isAt('"""') ? '"""' : '"';
		cursor += quoteText.length;
		let literalText = '';
		while (cursor < turtleText.length) {
			if (isAt(quoteText)) {
				cursor += quoteText.length;
				return literalText;
			}
			const oneChar = turtleText[cursor];
			if (oneChar === '\\') {
				const escapedChar = turtleText[cursor + 1];
				if (escapedChar === 'u' || escapedChar === 'U') {
					const hexLength = escapedChar === 'u' ? 4 : 8;
					const hexText = turtleText.slice(cursor + 2, cursor + 2 + hexLength);
					if (!/^[0-9A-Fa-f]+$/.test(hexText) || hexText.length !== hexLength) {
						return fail('a \\u escape is malformed');
					}
					literalText += String.fromCodePoint(parseInt(hexText, 16));
					cursor += 2 + hexLength;
					continue;
				}
				if (STRING_ESCAPE_BY_CHAR[escapedChar] === undefined) {
					return fail(`unknown string escape '\\${escapedChar}'`);
				}
				literalText += STRING_ESCAPE_BY_CHAR[escapedChar];
				cursor += 2;
				continue;
			}
			if (quoteText === '"' && oneChar === '\n') {
				return fail('a short string spans a line');
			}
			literalText += oneChar;
			cursor += 1;
		}
		return fail('a string literal is not closed');
	};
	const readLiteral = () => {
		const literalText = readStringBody();
		if (literalText === undefined) {
			return undefined;
		}
		const languageMatch = turtleText.slice(cursor).match(LANGUAGE_TAG_RE);
		if (languageMatch !== null) {
			cursor += languageMatch[0].length;
			return { termKind: 'literal', literalText, languageTag: languageMatch[0].slice(1) };
		}
		if (isAt('^^')) {
			cursor += 2;
			const datatype = isAt('<') ? readIri() : readPrefixedName();
			return datatype === undefined ? undefined : { termKind: 'literal', literalText, datatypeName: datatype.iriText || datatype.nameText };
		}
		return { termKind: 'literal', literalText };
	};

	let readPredicateObjectList; // declared ahead: an object may hold a blank node property list
	const readObject = () => {
		skipSpace();
		if (isAt('<')) {
			return readIri();
		}
		if (isAt('"')) {
			return readLiteral();
		}
		if (isAt('(')) {
			cursor += 1;
			const itemList = [];
			skipSpace();
			while (!isAt(')')) {
				if (cursor >= turtleText.length) {
					return fail('a collection is not closed');
				}
				const oneItem = readObject();
				if (oneItem === undefined) {
					return undefined;
				}
				itemList.push(oneItem);
				skipSpace();
			}
			cursor += 1;
			return { termKind: 'collection', itemList };
		}
		if (isAt('[')) {
			cursor += 1;
			const predicateMap = readPredicateObjectList({ closingText: ']' });
			return predicateMap === undefined || expect(']') === undefined ? undefined : { termKind: 'blankNode', predicateMap };
		}
		const integerMatch = turtleText.slice(cursor).match(INTEGER_RE);
		if (integerMatch !== null && !/[A-Za-z:]/.test(turtleText[cursor + integerMatch[0].length] || '')) {
			cursor += integerMatch[0].length;
			return { termKind: 'integer', integerValue: parseInt(integerMatch[0], 10) };
		}
		if (/^(true|false)\b/.test(turtleText.slice(cursor))) {
			const booleanValue = isAt('true');
			cursor += booleanValue ? 4 : 5;
			return { termKind: 'boolean', booleanValue };
		}
		return readPrefixedName();
	};
	readPredicateObjectList = ({ closingText }) => {
		const predicateMap = {};
		for (;;) {
			skipSpace();
			if (isAt(closingText)) {
				return predicateMap;
			}
			let predicateName;
			if (/^a\s/.test(turtleText.slice(cursor))) {
				cursor += 1;
				predicateName = 'rdf:type';
			} else {
				const predicate = readPrefixedName();
				if (predicate === undefined) {
					return undefined;
				}
				predicateName = predicate.nameText;
			}
			for (;;) {
				const oneObject = readObject();
				if (oneObject === undefined) {
					return undefined;
				}
				predicateMap[predicateName] = (predicateMap[predicateName] || []).concat([oneObject]);
				skipSpace();
				if (!isAt(',')) {
					break;
				}
				cursor += 1;
			}
			skipSpace();
			if (!isAt(';')) {
				return predicateMap;
			}
			cursor += 1;
		}
	};

	let baseIri;
	const iriByPrefix = {};
	const subjectList = [];
	for (;;) {
		skipSpace();
		if (cursor >= turtleText.length || refusalText !== undefined) {
			break;
		}
		if (isAt('@base')) {
			cursor += 5;
			skipSpace();
			const baseTerm = readIri();
			if (baseTerm === undefined || expect('.') === undefined) {
				break;
			}
			baseIri = baseTerm.iriText;
			continue;
		}
		if (isAt('@prefix')) {
			cursor += 7;
			skipSpace();
			const prefixMatch = turtleText.slice(cursor).match(/^([A-Za-z][A-Za-z0-9_-]*)?:/);
			if (prefixMatch === null) {
				fail('a @prefix directive names no prefix');
				break;
			}
			cursor += prefixMatch[0].length;
			skipSpace();
			const prefixTerm = readIri();
			if (prefixTerm === undefined || expect('.') === undefined) {
				break;
			}
			iriByPrefix[prefixMatch[1] || ''] = prefixTerm.iriText;
			continue;
		}
		if (!isAt('<')) {
			fail('a statement subject is not an IRI reference (this reader reads only <iri> subjects)');
			break;
		}
		const subjectTerm = readIri();
		const predicateMap = subjectTerm === undefined ? undefined : readPredicateObjectList({ closingText: '.' });
		if (predicateMap === undefined || expect('.') === undefined) {
			break;
		}
		subjectList.push({ subjectIri: subjectTerm.iriText, predicateMap });
	}
	if (refusalText !== undefined) {
		return { refusalText };
	}
	return { baseIri, iriByPrefix, subjectList };
};

module.exports = { readTurtleText, moduleName };
