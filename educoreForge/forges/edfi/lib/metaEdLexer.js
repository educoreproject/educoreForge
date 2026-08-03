'use strict';

// metaEdLexer.js — tokenizer for the MetaEd DSL (forge-edfi Phase 1, independent parser per
// R-WO-3/R-WO-6).
//
// AUTHORITY: the token inventory below mirrors the Ed-Fi Alliance's Apache-2.0 reference lexer
// grammar `BaseLexer.g4` (MetaEd-js repo) VERBATIM — every literal keyword string and every
// token-type name is copied from that file so an auditor can diff this table against the
// reference line by line. The grammar is the REFERENCE ONLY: nothing from the MetaEd toolchain
// runs here (R-WO-3 — no runtime dependency on the Ed-Fi Alliance toolchain).
//
// LEXICAL FACTS the reference grammar establishes (and this lexer reproduces):
//   - whitespace INCLUDING NEWLINES is skipped: the language is not line-oriented at the token
//     level; multi-word keywords are single tokens matched case-sensitively
//   - `//` line comments are skipped BY THE GRAMMAR (LINE_COMMENT -> skip); preserving them is
//     a re-emission-policy question for Phase 3, not a lexing question
//   - TEXT strings are double-quoted, may span MULTIPLE LINES, and escape an embedded quote by
//     doubling it ("")
//   - IDs begin with an uppercase letter; keyword literals that collide with an ID prefix win
//     by maximal munch, bounded by a word boundary (a keyword whose last character is
//     alphanumeric never matches when the next character is alphanumeric — 'DomainX' is an ID,
//     not the keyword 'Domain' plus junk)
//   - METAED_ID is a bracketed stable id: [digits] or [digits-digits]
//
// REFUSAL DOCTRINE (R-WO-6 condition 2, RT-3): any character sequence this lexer cannot
// classify is a REFUSAL naming the file, line, column, and the offending text. There is no
// error recovery, no token skipping, no resynchronization — a misparse must be impossible to
// miss. (ANTLR's default recovery resynchronizes by skipping tokens; that silent-substitution
// class is banned, and its absence here is a design feature, not an omission.)
//
// Public interface is error-first callback-shaped (RT-8/R7) though the work is synchronous.

// ============================================================
// Token inventory — [tokenTypeName, literalText], mirrored from BaseLexer.g4.
// Token-type names keep the reference grammar's UPPER_SNAKE spelling ON PURPOSE: they are data
// values (not identifiers), and keeping the reference spelling makes every token in a parse
// dump greppable straight back to the .g4 line that defines it. (Supervisor-approved,
// AMBER_TOWER Phase 1 sign-off 2026-08-03: casing-from-source-authority for auditability.)
// ============================================================

const KEYWORD_TOKEN_TABLE = [
	// top-level construct keywords (uppercase-initial)
	['ABSTRACT_ENTITY', 'Abstract Entity'],
	['ASSOCIATION', 'Association'],
	['BEGIN_NAMESPACE', 'Begin Namespace'],
	['END_NAMESPACE', 'End Namespace'],
	['CHOICE', 'Choice'],
	['COMMON', 'Common'],
	['DESCRIPTOR', 'Descriptor'],
	['DOMAIN', 'Domain'],
	['DOMAIN_ENTITY', 'Domain Entity'],
	['ENUMERATION', 'Enumeration'],
	['INLINE', 'Inline'],
	['INTERCHANGE', 'Interchange'],
	['INLINE_COMMON', 'Inline Common'],
	['SHARED_DECIMAL', 'Shared Decimal'],
	['SHARED_INTEGER', 'Shared Integer'],
	['SHARED_SHORT', 'Shared Short'],
	['SHARED_STRING', 'Shared String'],
	['SUBDOMAIN', 'Subdomain'],
	['TYPE', 'Type'],

	// property / member keywords (lowercase)
	['ASSOCIATION_KEYWORD', 'association'],
	['ASSOCIATION_IDENTITY', 'association identity'],
	['BOOLEAN', 'bool'],
	['CHOICE_KEYWORD', 'choice'],
	['COMMON_KEYWORD', 'common'],
	['COMMON_EXTENSION', 'common extension'],
	['CURRENCY', 'currency'],
	['DATE', 'date'],
	['DATETIME', 'datetime'],
	['DECIMAL', 'decimal'],
	['DESCRIPTOR_KEYWORD', 'descriptor'],
	['DOMAIN_ENTITY_KEYWORD', 'domain entity'],
	['DOMAIN_ENTITY_IDENTITY', 'domain entity identity'],
	['DOMAIN_ITEM', 'domain item'],
	['DURATION', 'duration'],
	['ELEMENT', 'element'],
	['ENUMERATION_KEYWORD', 'enumeration'],
	['ENUMERATION_ITEM', 'item'],
	['INLINE_COMMON_KEYWORD', 'inline common'],
	['INTEGER', 'integer'],
	['PERCENT', 'percent'],
	['REFERENCE', 'reference'],
	['SHARED_DECIMAL_KEYWORD', 'shared decimal'],
	['SHARED_INTEGER_KEYWORD', 'shared integer'],
	['SHARED_SHORT_KEYWORD', 'shared short'],
	['SHARED_STRING_KEYWORD', 'shared string'],
	['SHARED_NAMED', 'named'],
	['SHORT', 'short'],
	['STRING', 'string'],
	['TIME', 'time'],
	['YEAR', 'year'],

	// clause / annotation keywords
	['ADDITIONS', 'additions'],
	['BIG', 'big'],
	['BASED_ON', 'based on'],
	['CORE', 'core'],
	['CASCADE_UPDATE', 'allow primary key updates'],
	['DECIMAL_PLACES', 'decimal places'],
	['IDENTITY', 'is part of identity'],
	['IDENTITY_RENAME', 'renames identity property'],
	['IS_QUERYABLE_FIELD', 'is queryable field'],
	['IS_QUERYABLE_ONLY', 'is queryable only'],
	['IS_WEAK_REFERENCE', 'is weak'],
	['POTENTIALLY_LOGICAL', 'potentially logical'],
	['MERGE_REFERENCE', 'merge'],
	['MIN_LENGTH', 'min length'],
	['MAX_LENGTH', 'max length'],
	['MIN_VALUE', 'min value'],
	['MAX_VALUE', 'max value'],
	['OPTIONAL', 'is optional'],
	['OPTIONAL_COLLECTION', 'is optional collection'],
	['REQUIRED', 'is required'],
	['REQUIRED_COLLECTION', 'is required collection'],
	['ROLE_NAME', 'role name'],
	['SHORTEN_TO', 'shorten to'],
	['SUBDOMAIN_OF', 'of'],
	['SUBDOMAIN_POSITION', 'position'],
	['TOTAL_DIGITS', 'total digits'],
	['WITH', 'with'],
	['WITH_OPTIONAL_MAP_TYPE', 'with optional map type'],
	['WITH_MAP_TYPE', 'with map type'],
	['DEPRECATED', 'deprecated'],

	// documentation keywords
	['DOCUMENTATION', 'documentation'],
	['INHERITED', 'inherited'],
	['EXTENDED_DOCUMENTATION', 'extended documentation'],
	['USE_CASE_DOCUMENTATION', 'use case documentation'],
	['FOOTER_DOCUMENTATION', 'footer documentation'],
];

// maximal munch: longest literal wins ('use case documentation' before 'documentation',
// 'is optional collection' before 'is optional', 'domain entity identity' before 'domain
// entity'). Sorted once at module load; the table above stays in .g4 order for auditability.
const keywordTableLongestFirst = [...KEYWORD_TOKEN_TABLE].sort(
	(left, right) => right[1].length - left[1].length,
);

const isAlphanumericCharacter = (character) => /[A-Za-z0-9]/.test(character);

const ID_PATTERN = /^[A-Z][A-Za-z0-9]*/;
const METAED_ID_PATTERN = /^\[\d+(-\d+)?\]/;
// INT_FRAG in the reference grammar is 0 | [1-9][0-9]* — no leading zeros
const DECIMAL_VALUE_PATTERN = /^-?(0|[1-9][0-9]*)\.[0-9]*/;
const UNSIGNED_INT_PATTERN = /^(0|[1-9][0-9]*)/;

const SINGLE_CHARACTER_TOKEN_TABLE = {
	'+': 'POS_SIGN',
	'-': 'NEG_SIGN',
	'.': 'PERIOD',
};

const moduleFunction = () => {
	// --------------------------------------------------------
	// tokenizeMetaEdSource — the one public operation.
	//   inputs:  { sourceText, sourceFileRelativePath }
	//   callback(errString, { tokenList })
	// Each token: { tokenType, tokenText, lineNumber, columnNumber } plus textValue on TEXT
	// (the string content with "" unescaped) and metaEdIdValue on METAED_ID (brackets removed).
	// --------------------------------------------------------
	const tokenizeMetaEdSource = ({ sourceText, sourceFileRelativePath }, callback) => {
		if (typeof sourceText !== 'string') {
			callback(
				`[forge-edfi metaEdLexer] REFUSED: sourceText is required and must be a string (got ${typeof sourceText}) for ${sourceFileRelativePath}`,
			);
			return;
		}
		if (!sourceFileRelativePath) {
			callback(
				'[forge-edfi metaEdLexer] REFUSED: sourceFileRelativePath is required so refusals can name their file',
			);
			return;
		}

		const tokenList = [];
		let positionIndex = 0;
		let lineNumber = 1;
		let columnNumber = 1;

		const advanceOverSpan = (spanText) => {
			for (const character of spanText) {
				if (character === '\n') {
					lineNumber += 1;
					columnNumber = 1;
				} else {
					columnNumber += 1;
				}
			}
			positionIndex += spanText.length;
		};

		while (positionIndex < sourceText.length) {
			const currentCharacter = sourceText[positionIndex];

			// whitespace (including newlines) — skipped per the reference grammar
			if (/[ \t\r\n]/.test(currentCharacter)) {
				advanceOverSpan(currentCharacter);
				continue;
			}

			// line comment — skipped per the reference grammar (LINE_COMMENT -> skip)
			if (sourceText.startsWith('//', positionIndex)) {
				const newlineIndex = sourceText.indexOf('\n', positionIndex);
				const commentSpan =
					newlineIndex === -1
						? sourceText.slice(positionIndex)
						: sourceText.slice(positionIndex, newlineIndex);
				advanceOverSpan(commentSpan);
				continue;
			}

			// TEXT — double-quoted, multi-line, "" escapes an embedded quote
			if (currentCharacter === '"') {
				let scanIndex = positionIndex + 1;
				let terminated = false;
				while (scanIndex < sourceText.length) {
					if (sourceText[scanIndex] === '"') {
						if (sourceText[scanIndex + 1] === '"') {
							scanIndex += 2; // escaped quote, keep scanning
							continue;
						}
						terminated = true;
						break;
					}
					scanIndex += 1;
				}
				if (!terminated) {
					callback(
						`[forge-edfi metaEdLexer] REFUSED ${sourceFileRelativePath}:${lineNumber}:${columnNumber} — unterminated string literal (opening quote never closed)`,
					);
					return;
				}
				const tokenText = sourceText.slice(positionIndex, scanIndex + 1);
				tokenList.push({
					tokenType: 'TEXT',
					tokenText,
					textValue: tokenText.slice(1, -1).replace(/""/g, '"'),
					lineNumber,
					columnNumber,
				});
				advanceOverSpan(tokenText);
				continue;
			}

			// METAED_ID — [123] or [123-456]
			if (currentCharacter === '[') {
				const remainingText = sourceText.slice(positionIndex);
				const metaEdIdMatch = remainingText.match(METAED_ID_PATTERN);
				if (!metaEdIdMatch) {
					callback(
						`[forge-edfi metaEdLexer] REFUSED ${sourceFileRelativePath}:${lineNumber}:${columnNumber} — '[' does not open a well-formed MetaEd id ([digits] or [digits-digits]); found '${remainingText.slice(0, 40)}'`,
					);
					return;
				}
				const tokenText = metaEdIdMatch[0];
				tokenList.push({
					tokenType: 'METAED_ID',
					tokenText,
					metaEdIdValue: tokenText.slice(1, -1),
					lineNumber,
					columnNumber,
				});
				advanceOverSpan(tokenText);
				continue;
			}

			// keywords — longest literal first, word-boundary bounded
			const remainingText = sourceText.slice(positionIndex);
			let matchedKeyword = null;
			for (const [tokenType, literalText] of keywordTableLongestFirst) {
				if (!remainingText.startsWith(literalText)) {
					continue;
				}
				const followingCharacter = remainingText[literalText.length];
				const literalEndsAlphanumeric = isAlphanumericCharacter(
					literalText[literalText.length - 1],
				);
				if (
					literalEndsAlphanumeric &&
					followingCharacter !== undefined &&
					isAlphanumericCharacter(followingCharacter)
				) {
					continue; // 'DomainX' must lex as an ID, not 'Domain'+junk
				}
				matchedKeyword = { tokenType, literalText };
				break;
			}
			if (matchedKeyword) {
				tokenList.push({
					tokenType: matchedKeyword.tokenType,
					tokenText: matchedKeyword.literalText,
					lineNumber,
					columnNumber,
				});
				advanceOverSpan(matchedKeyword.literalText);
				continue;
			}

			// ID — uppercase-initial alphanumeric
			const idMatch = remainingText.match(ID_PATTERN);
			if (idMatch) {
				tokenList.push({
					tokenType: 'ID',
					tokenText: idMatch[0],
					lineNumber,
					columnNumber,
				});
				advanceOverSpan(idMatch[0]);
				continue;
			}

			// DECIMAL_VALUE before the sign/int tokens (maximal munch: '-3.14' is one token)
			const decimalMatch = remainingText.match(DECIMAL_VALUE_PATTERN);
			if (decimalMatch) {
				tokenList.push({
					tokenType: 'DECIMAL_VALUE',
					tokenText: decimalMatch[0],
					lineNumber,
					columnNumber,
				});
				advanceOverSpan(decimalMatch[0]);
				continue;
			}

			const unsignedIntMatch = remainingText.match(UNSIGNED_INT_PATTERN);
			if (unsignedIntMatch) {
				tokenList.push({
					tokenType: 'UNSIGNED_INT',
					tokenText: unsignedIntMatch[0],
					lineNumber,
					columnNumber,
				});
				advanceOverSpan(unsignedIntMatch[0]);
				continue;
			}

			const singleCharacterTokenType = SINGLE_CHARACTER_TOKEN_TABLE[currentCharacter];
			if (singleCharacterTokenType) {
				tokenList.push({
					tokenType: singleCharacterTokenType,
					tokenText: currentCharacter,
					lineNumber,
					columnNumber,
				});
				advanceOverSpan(currentCharacter);
				continue;
			}

			// nothing classified this character sequence — REFUSAL BY NAME, never a skip
			const offendingLineEnd = sourceText.indexOf('\n', positionIndex);
			const offendingSnippet = sourceText
				.slice(positionIndex, offendingLineEnd === -1 ? positionIndex + 60 : offendingLineEnd)
				.slice(0, 60);
			callback(
				`[forge-edfi metaEdLexer] REFUSED ${sourceFileRelativePath}:${lineNumber}:${columnNumber} — unclassifiable text: '${offendingSnippet}'. No MetaEd token matches here; this lexer does not skip (RT-3 applied to the parser's own competence).`,
			);
			return;
		}

		callback('', { tokenList });
	};

	return { tokenizeMetaEdSource };
};

module.exports = moduleFunction;
