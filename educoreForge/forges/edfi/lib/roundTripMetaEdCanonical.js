'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// roundTripMetaEdCanonical.js — forge-edfi Phase 3 (R-WO-14): the INDEPENDENT statement
// reducer. Reduces MetaEd source text, descriptor code-value XML text, and authored-crosswalk
// CSV text to canonical statement sets — the ANSWER-KEY side of the round-trip diff (and the
// shared statement grammar the graph-side emitter targets).
//
// INDEPENDENCE (R-WO-14, the pesc campaign's independent-canonicalizer principle): this module
// shares ZERO code with the Phase 1 parser (metaEdLexer.js / metaEdSyntaxParser.js /
// metaEdParser.js) and with the Phase 2 loaders (descriptorCodeValueLoader.js /
// crosswalkCarrier.js). The forge's input parser IS the Phase 1 parser; if this instrument
// reused it, a parser bug would cancel on both sides of the diff and a dropped statement would
// read as REPRODUCED. The implementation strategy also differs on purpose: a masking scanner
// plus a flat keyword-phrase extractor emitting surface statements — no token-type registry, no
// recursive descent, no resolved model.
//
// HONEST LIMIT (stated per R-WO-14): the independence is of CODE PATH and FAILURE MODE, not of
// mind — same author, same reference grammar (Ed-Fi Alliance Apache-2.0 MetaEdGrammar.g4 /
// BaseLexer.g4, read-only reference). The bounding instruments are the adversarial-pair
// fixtures (cosmetic variants MUST collapse; semantic variants MUST NOT) and the
// two-independent-readers census cross-check against the Phase 1 census of record —
// disagreement is a finding either way.
//
// STATEMENT GRAMMAR (RT-5: a serializer may know its own output grammar, never data):
//   statement = { subject, predicate, object } — all strings; identity = the three joined by
//   NUL (statementKey). Subjects use the instrument scheme
//     edfi://<constructType>/<constructName>
//     edfi://<constructType>/<ownerName>/property/<localName>[/roleName/<roleNameName>]
//     edfi://<setConstructType>/<setName>/value/<trimmedValueText>
//   The scheme is instrument grammar; every OBJECT value comes verbatim from the reduced text.
//
// DECLARED EQUIVALENCE POLICY (R-WO-15, all stated, none silent):
//   (a) `//` comment lines are NON-SEMANTIC by the publisher's own grammar (LINE_COMMENT ->
//       skip) and are EXCLUDED from the statement domain; each one is CENSUSED with file:line
//       (explicitly-omitted material for the verdict — visible, never silently dropped;
//       the category was named declaredContext until doctrine amendment A13, 2026-08-04).
//   (b) domain-item and interchange-component statements carry the ITEM NAME only; the declared
//       item KEYWORD is excluded from statement identity uniformly (the source itself uses the
//       keyword loosely — 3 censused drift cases; an embedded exception list would be data in
//       the serializer, an RT-5 violation).
//   (c) option-value subjects use the TRIMMED value text; the statement OBJECT carries the
//       source-verbatim string (house line: trimmed identity, verbatim value).
//   (e) declaration ORDER within a construct is not measured (set semantics — statement-map
//       identity; pesc precedent, stated instrument limit).
//
// SCOPE LIMIT (stated): this reducer accepts the published packages' bare topLevelEntity file
// form (all 849 corpus files). An explicit `Begin Namespace` wrapper is a REFUSAL by name, not
// a skip — if a future snapshot ships wrapped files, the refusal surfaces for adjudication.
//
// REFUSAL DOCTRINE: any text this reducer cannot classify is a CANONICALIZATION FAULT — fatal,
// never advisory (a half-reduced document must not produce a verdict someone might believe).
//
// Async style: error-first callbacks on the public interface (RT-8/R7); no async/await; no
// try/catch as control flow. camelCase only.

const xml2js = require('xml2js');

const STATEMENT_KEY_SEPARATOR = '\u0000';

// ============================================================
// statement assembly
// ============================================================

const statementKey = ({ subject, predicate, object }) =>
	`${subject}${STATEMENT_KEY_SEPARATOR}${predicate}${STATEMENT_KEY_SEPARATOR}${object}`;

// collapse internal whitespace and trim — applied to DOCUMENTATION prose on BOTH sides of the
// diff identically (the graph does not promise byte-level whitespace in prose; a differing
// collapse rule between the two sides would manufacture false loss)
const collapseWhitespace = (textValue) => `${textValue}`.replace(/\s+/g, ' ').trim();

// ============================================================
// the MetaEd lexical scanner — masking pass
// ============================================================
// Produces a flat ordered unit list:
//   { unitKind: 'word'|'text'|'metaEdId'|'punct', unitText, lineNumber }
// TEXT strings are recognized FIRST (multi-line, "" escapes) so a // inside prose can never
// read as a comment; comment lines are censused and excluded (policy a).

const scanMetaEdLexicalUnits = ({ sourceText, sourceFileRelativePath }) => {
	const unitList = [];
	const commentCensusList = [];
	let scanIndex = 0;
	let lineNumber = 1;

	const faultAt = (message) => ({
		fault: `${moduleName}.scanMetaEdLexicalUnits FAULT ${sourceFileRelativePath}:${lineNumber} — ${message}`,
	});

	while (scanIndex < sourceText.length) {
		const currentCharacter = sourceText[scanIndex];

		if (currentCharacter === '\n') {
			lineNumber += 1;
			scanIndex += 1;
			continue;
		}
		if (currentCharacter === ' ' || currentCharacter === '\t' || currentCharacter === '\r') {
			scanIndex += 1;
			continue;
		}

		// quoted TEXT — multi-line, "" escapes an embedded quote
		if (currentCharacter === '"') {
			const openingLineNumber = lineNumber;
			let cursorIndex = scanIndex + 1;
			let contentText = '';
			let terminated = false;
			while (cursorIndex < sourceText.length) {
				const scanCharacter = sourceText[cursorIndex];
				if (scanCharacter === '"') {
					if (sourceText[cursorIndex + 1] === '"') {
						contentText += '"';
						cursorIndex += 2;
						continue;
					}
					terminated = true;
					cursorIndex += 1;
					break;
				}
				if (scanCharacter === '\n') {
					lineNumber += 1;
				}
				contentText += scanCharacter;
				cursorIndex += 1;
			}
			if (!terminated) {
				return faultAt(`unterminated quoted string opened at line ${openingLineNumber}`);
			}
			unitList.push({ unitKind: 'text', unitText: contentText, lineNumber: openingLineNumber });
			scanIndex = cursorIndex;
			continue;
		}

		// line comment — censused and excluded (policy a); never inside a string (strings are
		// consumed above)
		if (sourceText.startsWith('//', scanIndex)) {
			const newlineIndex = sourceText.indexOf('\n', scanIndex);
			const commentText =
				newlineIndex === -1
					? sourceText.slice(scanIndex)
					: sourceText.slice(scanIndex, newlineIndex);
			commentCensusList.push({ sourceFileRelativePath, lineNumber, commentText });
			scanIndex = newlineIndex === -1 ? sourceText.length : newlineIndex;
			continue;
		}

		// bracketed MetaEd id: [digits] or [digits-digits]
		if (currentCharacter === '[') {
			const bracketMatch = sourceText.slice(scanIndex).match(/^\[(\d+(?:-\d+)?)\]/);
			if (!bracketMatch) {
				return faultAt(`unclassifiable bracket sequence '${sourceText.slice(scanIndex, scanIndex + 20)}'`);
			}
			unitList.push({ unitKind: 'metaEdId', unitText: bracketMatch[1], lineNumber });
			scanIndex += bracketMatch[0].length;
			continue;
		}

		// word: identifier/keyword fragments, dotted names, signed numbers, decimals
		const wordMatch = sourceText.slice(scanIndex).match(/^[A-Za-z0-9_.+-]+/);
		if (wordMatch) {
			unitList.push({ unitKind: 'word', unitText: wordMatch[0], lineNumber });
			scanIndex += wordMatch[0].length;
			continue;
		}

		return faultAt(`unclassifiable character '${currentCharacter}'`);
	}

	return { unitList, commentCensusList };
};

// ============================================================
// keyword phrase registries (house law: registry over switch)
// ============================================================
// Phrases are word SEQUENCES matched longest-first at a unit position. The literals mirror the
// reference grammar's keyword strings; matching is case-sensitive (top-level construct keywords
// are capitalized, member keywords lowercase — the grammar's own disambiguation).

// top-level construct phrase -> constructType (the graph's constructType vocabulary)
const TOP_LEVEL_CONSTRUCT_PHRASE_REGISTRY = {
	'Abstract Entity': 'abstractEntity',
	'Association': 'association',
	'Choice': 'choice',
	'Common': 'common',
	'Descriptor': 'descriptor',
	'Domain Entity': 'domainEntity',
	'Domain': 'domain',
	'Enumeration': 'enumeration',
	'Inline Common': 'inlineCommon',
	'Interchange': 'interchange',
	'Shared Decimal': 'sharedDecimal',
	'Shared Integer': 'sharedInteger',
	'Shared Short': 'sharedShort',
	'Shared String': 'sharedString',
	'Subdomain': 'subdomain',
};

// constructTypes whose header may be followed by 'additions' (extension form) and the
// constructType that form becomes
const EXTENSION_FORM_REGISTRY = {
	association: 'associationExtension',
	common: 'commonExtension',
	domainEntity: 'domainEntityExtension',
	interchange: 'interchangeExtension',
};

// constructTypes whose header may carry 'based on' (subclass form)
const SUBCLASS_FORM_REGISTRY = {
	association: 'associationSubclass',
	common: 'commonSubclass',
	domainEntity: 'domainEntitySubclass',
};

// property-type phrase -> propertyType (the graph's propertyType vocabulary). Longest-first
// matching makes 'domain entity identity' win over 'domain entity', etc.
const PROPERTY_TYPE_PHRASE_REGISTRY = {
	'association': 'association',
	'bool': 'boolean',
	'choice': 'choice',
	'common extension': 'commonExtensionOverride', // handled as common + override flag below
	'common': 'common',
	'currency': 'currency',
	'date': 'date',
	'datetime': 'datetime',
	'decimal': 'decimal',
	'descriptor': 'descriptor',
	'domain entity': 'domainEntity',
	'duration': 'duration',
	'enumeration': 'enumeration',
	'inline common': 'inlineCommon',
	'integer': 'integer',
	'percent': 'percent',
	'shared decimal': 'sharedDecimal',
	'shared integer': 'sharedInteger',
	'shared short': 'sharedShort',
	'shared string': 'sharedString',
	'short': 'short',
	'string': 'string',
	'time': 'time',
	'year': 'year',
};

// annotation phrase -> annotationKind (the graph's annotationKind vocabulary)
const ANNOTATION_PHRASE_REGISTRY = {
	'is part of identity': 'identity',
	'is required collection': 'requiredCollection',
	'is optional collection': 'optionalCollection',
	'is required': 'required',
	'is optional': 'optional',
	'is queryable only': 'queryableOnly',
};

// interchange component phrases -> componentKind (policy 4d: the kind is a SOURCE statement the
// graph cannot reproduce — emitted here so the diff reports it LOST contentGap, located)
const INTERCHANGE_COMPONENT_PHRASE_REGISTRY = {
	'domain entity identity': { componentKind: 'identityTemplate' },
	'association identity': { componentKind: 'identityTemplate' },
	'domain entity element': { componentKind: 'element' },
	'association element': { componentKind: 'element' },
	'domain entity': { componentKind: 'element' },
	'association': { componentKind: 'element' },
	'element': { componentKind: 'element' },
};

// domain item phrases (keyword excluded from identity — policy b)
const DOMAIN_ITEM_PHRASE_LIST = [
	'domain entity',
	'association',
	'common',
	'inline common',
	'descriptor',
	'domain item',
];

// construct-scalar clause phrases that take one numeric-ish word (verbatim carriage; the graph
// stores signed bounds as verbatim strings and unsigned counts as no-leading-zero numbers, so
// String() on the graph side reproduces these exactly)
const NUMERIC_CLAUSE_PHRASE_REGISTRY = {
	'min length': 'minLength',
	'max length': 'maxLength',
	'total digits': 'totalDigits',
	'decimal places': 'decimalPlaces',
	'position': 'subdomainPosition',
};

const BOUND_CLAUSE_PHRASE_REGISTRY = {
	'min value': 'minValue',
	'max value': 'maxValue',
};

const matchPhraseAt = ({ unitList, unitIndex, phraseTextList }) => {
	for (const phraseText of phraseTextList) {
		const phraseWordList = phraseText.split(' ');
		let matched = true;
		for (let wordOffset = 0; wordOffset < phraseWordList.length; wordOffset++) {
			const candidateUnit = unitList[unitIndex + wordOffset];
			if (
				!candidateUnit ||
				candidateUnit.unitKind !== 'word' ||
				candidateUnit.unitText !== phraseWordList[wordOffset]
			) {
				matched = false;
				break;
			}
		}
		if (matched) {
			return { phraseText, wordCount: phraseWordList.length };
		}
	}
	return undefined;
};

// longest-first phrase lists, precomputed once
const byPhraseLengthDescending = (leftText, rightText) => rightText.length - leftText.length;
const TOP_LEVEL_PHRASES = Object.keys(TOP_LEVEL_CONSTRUCT_PHRASE_REGISTRY).sort(byPhraseLengthDescending);
const PROPERTY_TYPE_PHRASES = Object.keys(PROPERTY_TYPE_PHRASE_REGISTRY).sort(byPhraseLengthDescending);
const ANNOTATION_PHRASES = Object.keys(ANNOTATION_PHRASE_REGISTRY).sort(byPhraseLengthDescending);
const INTERCHANGE_COMPONENT_PHRASES = Object.keys(INTERCHANGE_COMPONENT_PHRASE_REGISTRY).sort(byPhraseLengthDescending);
const DOMAIN_ITEM_PHRASES = [...DOMAIN_ITEM_PHRASE_LIST].sort(byPhraseLengthDescending);
const NUMERIC_CLAUSE_PHRASES = Object.keys(NUMERIC_CLAUSE_PHRASE_REGISTRY).sort(byPhraseLengthDescending);
const BOUND_CLAUSE_PHRASES = Object.keys(BOUND_CLAUSE_PHRASE_REGISTRY).sort(byPhraseLengthDescending);

const isUpperInitialIdentifier = (unitText) => /^[A-Z][A-Za-z0-9]*$/.test(unitText);
const isQualifiedIdentifier = (unitText) => /^(?:[A-Z][A-Za-z0-9]*\.)?[A-Z][A-Za-z0-9]*$/.test(unitText);

// ============================================================
// the extractor — flat statement emission over the unit stream
// ============================================================

const moduleFunction = () => {
	// --------------------------------------------------------
	// reduceMetaEdSourceText — ONE source text -> statements + comment census + local census.
	//   inputs:  { sourceText, sourceFileRelativePath }
	//   callback(errString, { statementList, commentCensusList, reducerCensus })
	// Statements carry sourceFileRelativePath/sourceLineNumber as LOCATED detail (never part of
	// identity).
	// --------------------------------------------------------
	const reduceMetaEdSourceText = ({ sourceText, sourceFileRelativePath }, callback) => {
		if (typeof sourceText !== 'string' || !sourceFileRelativePath) {
			callback(
				`${moduleName}.reduceMetaEdSourceText: sourceText (string) and sourceFileRelativePath are REQUIRED and have no default.`,
			);
			return;
		}

		const scanned = scanMetaEdLexicalUnits({ sourceText, sourceFileRelativePath });
		if (scanned.fault) {
			callback(scanned.fault);
			return;
		}
		const { unitList, commentCensusList } = scanned;

		const statementList = [];
		const reducerCensus = {
			constructCountByType: {},
			propertyCount: 0,
			enumerationItemCount: 0,
			domainItemCount: 0,
			interchangeComponentCount: 0,
		};

		// extraction state
		let currentConstruct; // { constructType, constructName, subject }
		let currentProperty; // { subject, propertyType }
		let currentValueSubject; // enumeration/map-type item subject (for trailing documentation)
		let pendingMapTypeContext = false; // inside a `with [optional] map type` block

		let faultMessage = '';
		let unitIndex = 0;

		const fault = (message) => {
			if (!faultMessage) {
				const nearUnit = unitList[unitIndex];
				const lineNumber = nearUnit ? nearUnit.lineNumber : '?';
				faultMessage = `${moduleName} FAULT ${sourceFileRelativePath}:${lineNumber} — ${message}`;
			}
		};

		const emit = (subject, predicate, objectValue, lineNumber) => {
			statementList.push({
				subject,
				predicate,
				object: `${objectValue}`,
				sourceFileRelativePath,
				sourceLineNumber: lineNumber,
			});
		};

		// innermost open subject: value item, then property, then construct
		const innermostSubject = () => {
			if (currentValueSubject) {
				return currentValueSubject;
			}
			if (currentProperty) {
				return currentProperty.subject;
			}
			return currentConstruct ? currentConstruct.subject : undefined;
		};

		const takeWord = (contextLabel, validator) => {
			const candidateUnit = unitList[unitIndex];
			if (!candidateUnit || candidateUnit.unitKind !== 'word' || (validator && !validator(candidateUnit.unitText))) {
				fault(`expected ${contextLabel}, found ${candidateUnit ? `${candidateUnit.unitKind} '${candidateUnit.unitText}'` : 'end of file'}`);
				return undefined;
			}
			unitIndex += 1;
			return candidateUnit;
		};

		const takeText = (contextLabel) => {
			const candidateUnit = unitList[unitIndex];
			if (!candidateUnit || candidateUnit.unitKind !== 'text') {
				fault(`expected quoted text for ${contextLabel}, found ${candidateUnit ? `${candidateUnit.unitKind} '${candidateUnit.unitText}'` : 'end of file'}`);
				return undefined;
			}
			unitIndex += 1;
			return candidateUnit;
		};

		const takeOptionalMetaEdId = (subject) => {
			const candidateUnit = unitList[unitIndex];
			if (candidateUnit && candidateUnit.unitKind === 'metaEdId') {
				unitIndex += 1;
				emit(subject, 'metaEdId', candidateUnit.unitText, candidateUnit.lineNumber);
			}
		};

		// documentation clause on the innermost subject; 'inherited' literal supported
		const handleDocumentation = () => {
			const subject = innermostSubject();
			const keywordUnit = unitList[unitIndex];
			unitIndex += 1; // consume 'documentation'
			const followingUnit = unitList[unitIndex];
			if (followingUnit && followingUnit.unitKind === 'word' && followingUnit.unitText === 'inherited') {
				unitIndex += 1;
				emit(subject, 'documentationInherited', 'true', keywordUnit.lineNumber);
				return;
			}
			const textUnit = takeText('documentation');
			if (textUnit) {
				emit(subject, 'documentation', collapseWhitespace(textUnit.unitText), textUnit.lineNumber);
			}
		};

		// merge directive: merge A.B with C.D  (verbatim dotted paths, joined '|')
		const handleMergeDirective = () => {
			if (!currentProperty) {
				fault(`'merge' outside a property`);
				return;
			}
			const keywordUnit = unitList[unitIndex];
			unitIndex += 1; // consume 'merge'
			const firstPathUnit = takeWord('merge source path', (word) => /^[A-Z]/.test(word));
			const withUnit = takeWord(`'with' in merge directive`, (word) => word === 'with');
			const secondPathUnit = takeWord('merge target path', (word) => /^[A-Z]/.test(word));
			if (firstPathUnit && withUnit && secondPathUnit) {
				emit(
					currentProperty.subject,
					'merge',
					`${firstPathUnit.unitText}|${secondPathUnit.unitText}`,
					keywordUnit.lineNumber,
				);
			}
		};

		// property opener: <typePhrase> [Namespace.]Name [named LocalName] [metaEdId] ...
		const handlePropertyOpen = ({ phraseText, wordCount }) => {
			const keywordUnit = unitList[unitIndex];
			unitIndex += wordCount;
			currentValueSubject = undefined;

			const isCommonExtensionOverride = phraseText === 'common extension';
			const propertyType = isCommonExtensionOverride
				? 'common'
				: PROPERTY_TYPE_PHRASE_REGISTRY[phraseText];

			const nameUnit = takeWord(`${phraseText} property name`, isQualifiedIdentifier);
			if (!nameUnit) {
				return;
			}
			const qualifiedNameText = nameUnit.unitText;
			const dotIndex = qualifiedNameText.indexOf('.');
			const namespacePrefixText = dotIndex === -1 ? undefined : qualifiedNameText.slice(0, dotIndex);
			const typeLocalNameText = dotIndex === -1 ? qualifiedNameText : qualifiedNameText.slice(dotIndex + 1);

			// optional 'named' override (shared properties)
			let localNameText = typeLocalNameText;
			let namedOverride = false;
			const namedCandidate = unitList[unitIndex];
			if (namedCandidate && namedCandidate.unitKind === 'word' && namedCandidate.unitText === 'named') {
				unitIndex += 1;
				const overrideUnit = takeWord(`'named' local name`, isUpperInitialIdentifier);
				if (!overrideUnit) {
					return;
				}
				localNameText = overrideUnit.unitText;
				namedOverride = true;
			}

			// association defining-domain-entity slots: inside association-family constructs, a
			// domain-entity property with NO annotation is a defining slot. Detected AFTER clause
			// consumption via the absence of an annotation statement — here we open the property
			// subject; propertyType is finalized then.
			const ownerSubjectBase = `${currentConstruct.subject}/property/${localNameText}`;
			currentProperty = {
				subject: ownerSubjectBase,
				subjectBase: ownerSubjectBase,
				propertyType,
				openLineNumber: keywordUnit.lineNumber,
				firstStatementIndex: statementList.length, // rekey scope: this property's OWN statements only
				sawAnnotation: false,
				isSharedForm: phraseText.startsWith('shared '),
				// grammar fact: decimalValue accepts signed integers, so a bound inside a decimal
				// context is ALWAYS the Decimal predicate regardless of the token's text shape
				boundsAreDecimal: phraseText === 'decimal',
				sharedTypeQualifiedText: qualifiedNameText,
				namedOverride,
				localNameText,
				namespacePrefixText,
				isCommonExtensionOverride,
			};
			reducerCensus.propertyCount += 1;

			emit(currentProperty.subject, 'propertyType', propertyType, keywordUnit.lineNumber);
			if (currentProperty.isSharedForm) {
				emit(currentProperty.subject, 'sharedType', qualifiedNameText, keywordUnit.lineNumber);
			} else if (namespacePrefixText) {
				emit(currentProperty.subject, 'propertyNamespace', namespacePrefixText, keywordUnit.lineNumber);
			}
			if (isCommonExtensionOverride) {
				emit(currentProperty.subject, 'commonExtensionOverride', 'true', keywordUnit.lineNumber);
			}
			takeOptionalMetaEdId(currentProperty.subject);
		};

		// role name X [shorten to Y] — RE-KEYS the property subject (role-name context is part of
		// the property's source identity; two same-named references differ by role)
		const handleRoleName = () => {
			if (!currentProperty) {
				fault(`'role name' outside a property`);
				return;
			}
			const keywordLineNumber = unitList[unitIndex].lineNumber;
			unitIndex += 2; // consume 'role' 'name'
			const roleUnit = takeWord('role name identifier', isUpperInitialIdentifier);
			if (!roleUnit) {
				return;
			}
			let shortenToText;
			const shortenCandidate = matchPhraseAt({ unitList, unitIndex, phraseTextList: ['shorten to'] });
			if (shortenCandidate) {
				unitIndex += shortenCandidate.wordCount;
				const shortenUnit = takeWord(`'shorten to' identifier`, isUpperInitialIdentifier);
				if (!shortenUnit) {
					return;
				}
				shortenToText = shortenUnit.unitText;
			}
			const rekeyedSubject = `${currentProperty.subjectBase}/roleName/${roleUnit.unitText}`;
			// rekey ONLY this property's own statements — an earlier same-named sibling property
			// (the association defining-slot pair pattern) shares the pre-rekey subject text and
			// must not be dragged along (a real corpus bug caught on the first full diff)
			for (
				let statementIndex = currentProperty.firstStatementIndex;
				statementIndex < statementList.length;
				statementIndex++
			) {
				if (statementList[statementIndex].subject === currentProperty.subject) {
					statementList[statementIndex].subject = rekeyedSubject;
				}
			}
			currentProperty.subject = rekeyedSubject;
			emit(currentProperty.subject, 'roleName', roleUnit.unitText, keywordLineNumber);
			if (shortenToText !== undefined) {
				emit(currentProperty.subject, 'shortenTo', shortenToText, keywordLineNumber);
			}
		};

		// finalize an open property (defining-slot detection) before closing it
		const closeCurrentProperty = () => {
			if (!currentProperty) {
				return;
			}
			const associationFamily =
				currentConstruct &&
				['association', 'associationSubclass'].includes(currentConstruct.constructType);
			if (
				associationFamily &&
				currentProperty.propertyType === 'domainEntity' &&
				!currentProperty.sawAnnotation
			) {
				// defining-domain-entity slot: rewrite the already-emitted propertyType statement
				statementList.forEach((oneStatement) => {
					if (
						oneStatement.subject === currentProperty.subject &&
						oneStatement.predicate === 'propertyType' &&
						oneStatement.object === 'domainEntity'
					) {
						oneStatement.object = 'definingDomainEntity';
					}
				});
			}
			currentProperty = undefined;
		};

		// construct opener
		const handleConstructOpen = ({ phraseText, wordCount }) => {
			closeCurrentProperty();
			currentValueSubject = undefined;
			pendingMapTypeContext = false;

			const keywordUnit = unitList[unitIndex];
			unitIndex += wordCount;
			let constructType = TOP_LEVEL_CONSTRUCT_PHRASE_REGISTRY[phraseText];

			const nameUnit = takeWord(`${phraseText} construct name`, isQualifiedIdentifier);
			if (!nameUnit) {
				return;
			}
			const qualifiedNameText = nameUnit.unitText;
			const dotIndex = qualifiedNameText.indexOf('.');
			const namespacePrefixText = dotIndex === -1 ? undefined : qualifiedNameText.slice(0, dotIndex);
			const localNameText = dotIndex === -1 ? qualifiedNameText : qualifiedNameText.slice(dotIndex + 1);

			// header forms: 'additions' (extension), 'based on Y' (subclass), 'of Y' (subdomain)
			let extendeeStatementValue;
			let baseStatementValue;
			let parentDomainValue;
			const followingCandidate = unitList[unitIndex];
			if (
				followingCandidate &&
				followingCandidate.unitKind === 'word' &&
				followingCandidate.unitText === 'additions' &&
				EXTENSION_FORM_REGISTRY[constructType]
			) {
				unitIndex += 1;
				constructType = EXTENSION_FORM_REGISTRY[constructType];
				extendeeStatementValue = qualifiedNameText;
			} else {
				const basedOnCandidate = matchPhraseAt({ unitList, unitIndex, phraseTextList: ['based on'] });
				if (basedOnCandidate && SUBCLASS_FORM_REGISTRY[constructType]) {
					unitIndex += basedOnCandidate.wordCount;
					const baseUnit = takeWord(`'based on' base name`, isQualifiedIdentifier);
					if (!baseUnit) {
						return;
					}
					constructType = SUBCLASS_FORM_REGISTRY[constructType];
					baseStatementValue = baseUnit.unitText;
				} else if (constructType === 'subdomain') {
					const ofCandidate = unitList[unitIndex];
					if (!(ofCandidate && ofCandidate.unitKind === 'word' && ofCandidate.unitText === 'of')) {
						fault(`Subdomain '${qualifiedNameText}' requires 'of <parent domain>'`);
						return;
					}
					unitIndex += 1;
					const parentUnit = takeWord('subdomain parent domain name', isQualifiedIdentifier);
					if (!parentUnit) {
						return;
					}
					parentDomainValue = parentUnit.unitText;
				}
			}

			const subject = `edfi://${constructType}/${localNameText}`;
			currentConstruct = { constructType, constructName: localNameText, subject };
			reducerCensus.constructCountByType[constructType] =
				(reducerCensus.constructCountByType[constructType] || 0) + 1;

			emit(subject, 'declaredAs', constructType, keywordUnit.lineNumber);
			if (namespacePrefixText) {
				emit(subject, 'constructNamespace', namespacePrefixText, keywordUnit.lineNumber);
			}
			if (extendeeStatementValue !== undefined) {
				emit(subject, 'extends', extendeeStatementValue, keywordUnit.lineNumber);
			}
			if (baseStatementValue !== undefined) {
				emit(subject, 'basedOn', baseStatementValue, keywordUnit.lineNumber);
			}
			if (parentDomainValue !== undefined) {
				emit(subject, 'subdomainOf', parentDomainValue, keywordUnit.lineNumber);
			}
			takeOptionalMetaEdId(subject);
		};

		// enumeration item / map-type item: item "text" [metaEdId]
		const handleEnumerationItem = () => {
			closeCurrentProperty();
			const keywordUnit = unitList[unitIndex];
			unitIndex += 1;
			const textUnit = takeText('item value text');
			if (!textUnit) {
				return;
			}
			const verbatimValueText = textUnit.unitText;
			const trimmedValueText = verbatimValueText.trim();
			const subject = `${currentConstruct.subject}/value/${trimmedValueText}`;
			currentValueSubject = subject;
			reducerCensus.enumerationItemCount += 1;
			emit(subject, 'itemOf', currentConstruct.constructName, keywordUnit.lineNumber);
			emit(subject, 'shortDescription', verbatimValueText, textUnit.lineNumber);
			emit(
				subject,
				'itemOrigin',
				pendingMapTypeContext ? 'mapTypeItem' : 'enumerationItem',
				keywordUnit.lineNumber,
			);
			takeOptionalMetaEdId(subject);
		};

		// main walk
		while (unitIndex < unitList.length && !faultMessage) {
			const currentUnit = unitList[unitIndex];

			if (currentUnit.unitKind === 'word') {
				// namespace wrapper: stated scope limit — refusal, not a skip
				if (matchPhraseAt({ unitList, unitIndex, phraseTextList: ['Begin Namespace', 'End Namespace'] })) {
					fault(
						`explicit 'Begin/End Namespace' wrapper — outside this reducer's declared scope (bare topLevelEntity files); adjudicate before proceeding`,
					);
					break;
				}

				// top-level construct?
				const topLevelMatch = matchPhraseAt({ unitList, unitIndex, phraseTextList: TOP_LEVEL_PHRASES });
				if (topLevelMatch) {
					handleConstructOpen({ phraseText: topLevelMatch.phraseText, wordCount: topLevelMatch.wordCount });
					continue;
				}

				if (!currentConstruct) {
					fault(`text before any construct header: '${currentUnit.unitText}'`);
					break;
				}

				// construct-scoped member handling by construct family
				const constructType = currentConstruct.constructType;

				// domains: items (keyword excluded from identity — policy b)
				if (['domain', 'subdomain'].includes(constructType)) {
					const itemMatch = matchPhraseAt({ unitList, unitIndex, phraseTextList: DOMAIN_ITEM_PHRASES });
					if (itemMatch) {
						unitIndex += itemMatch.wordCount;
						const itemNameUnit = takeWord('domain item name', isQualifiedIdentifier);
						if (itemNameUnit) {
							reducerCensus.domainItemCount += 1;
							// item identity at LOCAL-name precision; a namespace qualifier is a separate
							// attribute statement (the graph's item edges carry no qualifier, so it
							// surfaces as located LOST contentGap — measured, never silently excluded)
							const itemDotIndex = itemNameUnit.unitText.indexOf('.');
							const itemLocalName =
								itemDotIndex === -1 ? itemNameUnit.unitText : itemNameUnit.unitText.slice(itemDotIndex + 1);
							emit(currentConstruct.subject, 'hasItem', itemLocalName, itemNameUnit.lineNumber);
							if (itemDotIndex !== -1) {
								emit(
									currentConstruct.subject,
									`itemNamespace/${itemLocalName}`,
									itemNameUnit.unitText.slice(0, itemDotIndex),
									itemNameUnit.lineNumber,
								);
							}
							// a per-item metaEdId is edge content the graph does not carry — its own
							// predicate family so it lands as a NAMED backlog class, never blurred
							// into the construct's own metaEdId
							const itemIdUnit =
								unitList[unitIndex] && unitList[unitIndex].unitKind === 'metaEdId'
									? unitList[unitIndex++]
									: undefined;
							if (itemIdUnit) {
								emit(
									currentConstruct.subject,
									`itemMetaEdId/${itemLocalName}`,
									itemIdUnit.unitText,
									itemIdUnit.lineNumber,
								);
							}
						}
						continue;
					}
				}

				// interchanges: components (kind emitted — policy 4d, expected LOST contentGap)
				if (['interchange', 'interchangeExtension'].includes(constructType)) {
					const componentMatch = matchPhraseAt({
						unitList,
						unitIndex,
						phraseTextList: INTERCHANGE_COMPONENT_PHRASES,
					});
					if (componentMatch) {
						const componentSpec = INTERCHANGE_COMPONENT_PHRASE_REGISTRY[componentMatch.phraseText];
						unitIndex += componentMatch.wordCount;
						const componentNameUnit = takeWord('interchange component name', isQualifiedIdentifier);
						if (componentNameUnit) {
							reducerCensus.interchangeComponentCount += 1;
							// component identity at LOCAL-name precision; qualifier and kind are separate
							// attribute statements (the graph carries neither — both surface as located
							// LOST contentGap per R-WO-15(d) and its extension)
							const componentDotIndex = componentNameUnit.unitText.indexOf('.');
							const componentLocalName =
								componentDotIndex === -1
									? componentNameUnit.unitText
									: componentNameUnit.unitText.slice(componentDotIndex + 1);
							emit(
								currentConstruct.subject,
								'hasComponent',
								componentLocalName,
								componentNameUnit.lineNumber,
							);
							emit(
								currentConstruct.subject,
								`componentKind/${componentLocalName}`,
								componentSpec.componentKind,
								componentNameUnit.lineNumber,
							);
							if (componentDotIndex !== -1) {
								emit(
									currentConstruct.subject,
									`itemNamespace/${componentLocalName}`,
									componentNameUnit.unitText.slice(0, componentDotIndex),
									componentNameUnit.lineNumber,
								);
							}
							const componentIdUnit =
								unitList[unitIndex] && unitList[unitIndex].unitKind === 'metaEdId'
									? unitList[unitIndex++]
									: undefined;
							if (componentIdUnit) {
								emit(
									currentConstruct.subject,
									`itemMetaEdId/${componentLocalName}`,
									componentIdUnit.unitText,
									componentIdUnit.lineNumber,
								);
							}
						}
						continue;
					}
				}

				// enumeration/map-type items
				if (currentUnit.unitText === 'item' && ['enumeration', 'descriptor'].includes(constructType)) {
					handleEnumerationItem();
					continue;
				}

				// map-type blocks on descriptors
				const mapTypeMatch = matchPhraseAt({
					unitList,
					unitIndex,
					phraseTextList: ['with optional map type', 'with map type'],
				});
				if (mapTypeMatch && constructType === 'descriptor') {
					closeCurrentProperty();
					pendingMapTypeContext = true;
					currentValueSubject = undefined;
					emit(
						currentConstruct.subject,
						'mapTypeRequired',
						mapTypeMatch.phraseText === 'with map type' ? 'true' : 'false',
						currentUnit.lineNumber,
					);
					unitIndex += mapTypeMatch.wordCount;
					continue;
				}

				// documentation family (longest-first)
				const documentationMatch = matchPhraseAt({
					unitList,
					unitIndex,
					phraseTextList: ['use case documentation', 'extended documentation', 'footer documentation'],
				});
				if (documentationMatch) {
					const predicateByPhrase = {
						'use case documentation': 'useCaseDocumentation',
						'extended documentation': 'extendedDocumentation',
						'footer documentation': 'footerDocumentation',
					};
					const lineNumber = currentUnit.lineNumber;
					unitIndex += documentationMatch.wordCount;
					const textUnit = takeText(documentationMatch.phraseText);
					if (textUnit) {
						// construct-level clauses attach to the CONSTRUCT even while a property is open
						emit(
							currentConstruct.subject,
							predicateByPhrase[documentationMatch.phraseText],
							collapseWhitespace(textUnit.unitText),
							lineNumber,
						);
					}
					continue;
				}

				if (currentUnit.unitText === 'documentation') {
					// map-type documentation belongs to the descriptor's map type, distinctly
					if (pendingMapTypeContext && !currentValueSubject) {
						unitIndex += 1;
						const textUnit = takeText('map type documentation');
						if (textUnit) {
							emit(
								currentConstruct.subject,
								'mapTypeDocumentation',
								collapseWhitespace(textUnit.unitText),
								textUnit.lineNumber,
							);
						}
						continue;
					}
					handleDocumentation();
					continue;
				}

				if (currentUnit.unitText === 'deprecated') {
					const subject = innermostSubject();
					unitIndex += 1;
					const textUnit = takeText('deprecated reason');
					if (textUnit) {
						emit(subject, 'deprecated', collapseWhitespace(textUnit.unitText), textUnit.lineNumber);
					}
					continue;
				}

				// annotations
				const annotationMatch = matchPhraseAt({ unitList, unitIndex, phraseTextList: ANNOTATION_PHRASES });
				if (annotationMatch) {
					if (!currentProperty) {
						fault(`annotation '${annotationMatch.phraseText}' outside a property`);
						break;
					}
					currentProperty.sawAnnotation = true;
					emit(
						currentProperty.subject,
						'annotation',
						ANNOTATION_PHRASE_REGISTRY[annotationMatch.phraseText],
						currentUnit.lineNumber,
					);
					unitIndex += annotationMatch.wordCount;
					continue;
				}

				const identityRenameMatch = matchPhraseAt({
					unitList,
					unitIndex,
					phraseTextList: ['renames identity property'],
				});
				if (identityRenameMatch) {
					if (!currentProperty) {
						fault(`'renames identity property' outside a property`);
						break;
					}
					currentProperty.sawAnnotation = true;
					const lineNumber = currentUnit.lineNumber;
					unitIndex += identityRenameMatch.wordCount;
					const renamedUnit = takeWord('renamed identity property name', isUpperInitialIdentifier);
					if (renamedUnit) {
						emit(currentProperty.subject, 'annotation', 'identityRename', lineNumber);
						emit(currentProperty.subject, 'renamesIdentityProperty', renamedUnit.unitText, lineNumber);
					}
					continue;
				}

				if (matchPhraseAt({ unitList, unitIndex, phraseTextList: ['is queryable field'] })) {
					if (!currentProperty) {
						fault(`'is queryable field' outside a property`);
						break;
					}
					emit(currentProperty.subject, 'queryableField', 'true', currentUnit.lineNumber);
					unitIndex += 3;
					continue;
				}

				if (matchPhraseAt({ unitList, unitIndex, phraseTextList: ['role name'] })) {
					handleRoleName();
					continue;
				}

				if (currentUnit.unitText === 'merge') {
					handleMergeDirective();
					continue;
				}

				if (matchPhraseAt({ unitList, unitIndex, phraseTextList: ['allow primary key updates'] })) {
					emit(currentConstruct.subject, 'allowPrimaryKeyUpdates', 'true', currentUnit.lineNumber);
					unitIndex += 4;
					continue;
				}

				if (matchPhraseAt({ unitList, unitIndex, phraseTextList: ['potentially logical'] })) {
					if (!currentProperty) {
						fault(`'potentially logical' outside a property`);
						break;
					}
					emit(currentProperty.subject, 'potentiallyLogical', 'true', currentUnit.lineNumber);
					unitIndex += 2;
					continue;
				}

				if (matchPhraseAt({ unitList, unitIndex, phraseTextList: ['is weak'] })) {
					if (!currentProperty) {
						fault(`'is weak' outside a property`);
						break;
					}
					emit(currentProperty.subject, 'isWeakReference', 'true', currentUnit.lineNumber);
					unitIndex += 2;
					continue;
				}

				if (matchPhraseAt({ unitList, unitIndex, phraseTextList: ['big integer'] })) {
					emit(currentConstruct.subject, 'isBigInteger', 'true', currentUnit.lineNumber);
					unitIndex += 2;
					continue;
				}

				// numeric clauses (innermost subject: shared-type constructs carry these at
				// construct level; typed properties carry them at property level)
				const boundMatch = matchPhraseAt({ unitList, unitIndex, phraseTextList: BOUND_CLAUSE_PHRASES });
				if (boundMatch) {
					const subject = innermostSubject();
					const lineNumber = currentUnit.lineNumber;
					unitIndex += boundMatch.wordCount;
					const valueUnit = takeWord(
						`${boundMatch.phraseText} bound`,
						(word) => word === 'big' || /^[+-]?\d/.test(word),
					);
					if (valueUnit) {
						const boundBaseName = BOUND_CLAUSE_PHRASE_REGISTRY[boundMatch.phraseText];
						// decimal-context bounds are ALWAYS the Decimal predicate (grammar:
						// decimalValue accepts signed integers); integer contexts never see a
						// decimal-shaped token
						const contextIsDecimal = currentProperty
							? currentProperty.boundsAreDecimal
							: currentConstruct.constructType === 'sharedDecimal';
						const predicate = contextIsDecimal ? `${boundBaseName}Decimal` : boundBaseName;
						const normalizedBoundText = valueUnit.unitText.replace(/^\+/, '');
						emit(subject, predicate, normalizedBoundText, lineNumber);
					}
					continue;
				}

				const numericMatch = matchPhraseAt({ unitList, unitIndex, phraseTextList: NUMERIC_CLAUSE_PHRASES });
				if (numericMatch) {
					const subject = innermostSubject();
					const lineNumber = currentUnit.lineNumber;
					unitIndex += numericMatch.wordCount;
					const valueUnit = takeWord(`${numericMatch.phraseText} value`, (word) => /^\d+$/.test(word));
					if (valueUnit) {
						emit(subject, NUMERIC_CLAUSE_PHRASE_REGISTRY[numericMatch.phraseText], valueUnit.unitText, lineNumber);
					}
					continue;
				}

				// property opener (checked AFTER all clause phrases so 'shared string' the CLAUSE
				// keywords above cannot be shadowed; property-type phrases are lowercase, construct
				// headers uppercase — no collision)
				const propertyMatch = matchPhraseAt({ unitList, unitIndex, phraseTextList: PROPERTY_TYPE_PHRASES });
				if (propertyMatch) {
					const constructAcceptsProperties = ![
						'domain',
						'subdomain',
						'interchange',
						'interchangeExtension',
						'enumeration',
					].includes(constructType);
					if (!constructAcceptsProperties) {
						fault(
							`property phrase '${propertyMatch.phraseText}' inside '${constructType}' which carries no properties`,
						);
						break;
					}
					closeCurrentProperty();
					handlePropertyOpen({ phraseText: propertyMatch.phraseText, wordCount: propertyMatch.wordCount });
					continue;
				}

				fault(`unclassifiable text '${currentUnit.unitText}'`);
				break;
			}

			if (currentUnit.unitKind === 'metaEdId') {
				fault(`stray MetaEd id [${currentUnit.unitText}] with no owning declaration`);
				break;
			}
			if (currentUnit.unitKind === 'text') {
				fault(`stray quoted text with no owning clause`);
				break;
			}
			fault(`unclassifiable unit kind '${currentUnit.unitKind}'`);
			break;
		}

		closeCurrentProperty();

		if (faultMessage) {
			callback(faultMessage);
			return;
		}
		callback('', { statementList, commentCensusList, reducerCensus });
	};

	// --------------------------------------------------------
	// reduceDescriptorXmlText — ONE code-value XML text -> statements (R-WO-12: in-domain).
	//   inputs:  { xmlText, sourceFileRelativePath }
	//   callback(errString, { statementList, recordCount, descriptorName })
	// The instrument's OWN walk (not descriptorCodeValueLoader): root InterchangeDescriptors,
	// uniform record elements named *Descriptor; fields CodeValue (required) +
	// ShortDescription/Description/Namespace (optional). Descriptor name = record ELEMENT name
	// minus 'Descriptor' (the FILENAME is not authoritative — one core file drifts).
	// --------------------------------------------------------
	const reduceDescriptorXmlText = ({ xmlText, sourceFileRelativePath }, callback) => {
		if (typeof xmlText !== 'string' || !sourceFileRelativePath) {
			callback(
				`${moduleName}.reduceDescriptorXmlText: xmlText (string) and sourceFileRelativePath are REQUIRED and have no default.`,
			);
			return;
		}
		const xmlParser = new xml2js.Parser({ explicitArray: true, explicitCharkey: false });
		xmlParser.parseString(xmlText, (parseError, parsedDocument) => {
			if (parseError) {
				callback(
					`${moduleName}.reduceDescriptorXmlText FAULT ${sourceFileRelativePath} — unparseable XML: ${parseError.message}`,
				);
				return;
			}
			const rootElementName = Object.keys(parsedDocument || {})[0];
			if (rootElementName !== 'InterchangeDescriptors') {
				callback(
					`${moduleName}.reduceDescriptorXmlText FAULT ${sourceFileRelativePath} — root element '${rootElementName}' is not InterchangeDescriptors`,
				);
				return;
			}
			const rootElement = parsedDocument[rootElementName];
			const recordElementNameList = Object.keys(rootElement).filter(
				(candidateName) => candidateName !== '$',
			);
			if (recordElementNameList.length !== 1 || !recordElementNameList[0].endsWith('Descriptor')) {
				callback(
					`${moduleName}.reduceDescriptorXmlText FAULT ${sourceFileRelativePath} — expected exactly one *Descriptor record element family, found [${recordElementNameList.join(', ')}]`,
				);
				return;
			}
			const recordElementName = recordElementNameList[0];
			const descriptorName = recordElementName.replace(/Descriptor$/, '');
			const statementList = [];
			let faultMessage = '';
			rootElement[recordElementName].forEach((oneRecord, recordIndex) => {
				if (faultMessage) {
					return;
				}
				const codeValueList = oneRecord.CodeValue;
				if (!codeValueList || codeValueList.length !== 1) {
					faultMessage = `${moduleName}.reduceDescriptorXmlText FAULT ${sourceFileRelativePath} — record ${recordIndex + 1} of ${recordElementName} lacks exactly one CodeValue`;
					return;
				}
				const verbatimCodeText = `${codeValueList[0]}`;
				const trimmedCodeText = verbatimCodeText.trim();
				if (trimmedCodeText === '') {
					faultMessage = `${moduleName}.reduceDescriptorXmlText FAULT ${sourceFileRelativePath} — record ${recordIndex + 1} has an all-whitespace CodeValue`;
					return;
				}
				const subject = `edfi://descriptor/${descriptorName}/value/${trimmedCodeText}`;
				statementList.push({
					subject,
					predicate: 'codeValue',
					object: verbatimCodeText,
					sourceFileRelativePath,
					sourceLineNumber: undefined,
				});
				[
					['ShortDescription', 'shortDescription'],
					['Description', 'valueDescription'],
					['Namespace', 'namespace'],
				].forEach(([fieldElementName, predicate]) => {
					const fieldList = oneRecord[fieldElementName];
					if (fieldList && fieldList.length === 1) {
						statementList.push({
							subject,
							predicate,
							object: collapseWhitespace(`${fieldList[0]}`),
							sourceFileRelativePath,
							sourceLineNumber: undefined,
						});
					} else if (fieldList && fieldList.length > 1) {
						faultMessage = `${moduleName}.reduceDescriptorXmlText FAULT ${sourceFileRelativePath} — record ${recordIndex + 1} carries ${fieldList.length} ${fieldElementName} elements`;
					}
				});
			});
			if (faultMessage) {
				callback(faultMessage);
				return;
			}
			callback('', {
				statementList,
				recordCount: rootElement[recordElementName].length,
				descriptorName,
			});
		});
	};

	// --------------------------------------------------------
	// reduceCrosswalkCsvText — ONE crosswalk CSV text -> the raw-value sets for the R-WO-12
	// invention guard (pure set-membership; deliberately NO row matching — reimplementing the
	// forge's matching here would cancel its bugs).
	//   inputs:  { csvText, sourceFileRelativePath }
	//   returns { headerFieldList, rawValuesByHeaderField: { <headerField>: Set }, rowCount }
	//   (synchronous return-shaped internals; the public wrapper below is callback-shaped R7)
	// --------------------------------------------------------
	const parseCsvRows = (csvText) => {
		// minimal RFC-4180 reader: quoted cells, "" escapes, CRLF/newline rows
		const rowList = [];
		let currentRow = [];
		let currentCell = '';
		let insideQuotes = false;
		let charIndex = 0;
		while (charIndex < csvText.length) {
			const currentCharacter = csvText[charIndex];
			if (insideQuotes) {
				if (currentCharacter === '"') {
					if (csvText[charIndex + 1] === '"') {
						currentCell += '"';
						charIndex += 2;
						continue;
					}
					insideQuotes = false;
					charIndex += 1;
					continue;
				}
				currentCell += currentCharacter;
				charIndex += 1;
				continue;
			}
			if (currentCharacter === '"') {
				insideQuotes = true;
				charIndex += 1;
				continue;
			}
			if (currentCharacter === ',') {
				currentRow.push(currentCell);
				currentCell = '';
				charIndex += 1;
				continue;
			}
			if (currentCharacter === '\r') {
				charIndex += 1;
				continue;
			}
			if (currentCharacter === '\n') {
				currentRow.push(currentCell);
				rowList.push(currentRow);
				currentRow = [];
				currentCell = '';
				charIndex += 1;
				continue;
			}
			currentCell += currentCharacter;
			charIndex += 1;
		}
		if (currentCell !== '' || currentRow.length > 0) {
			currentRow.push(currentCell);
			rowList.push(currentRow);
		}
		return rowList;
	};

	const reduceCrosswalkCsvText = ({ csvText, sourceFileRelativePath }, callback) => {
		if (typeof csvText !== 'string' || !sourceFileRelativePath) {
			callback(
				`${moduleName}.reduceCrosswalkCsvText: csvText (string) and sourceFileRelativePath are REQUIRED and have no default.`,
			);
			return;
		}
		const rowList = parseCsvRows(csvText);
		if (rowList.length < 1) {
			callback(`${moduleName}.reduceCrosswalkCsvText FAULT ${sourceFileRelativePath} — empty CSV`);
			return;
		}
		const headerFieldList = rowList[0].map((headerCell) => headerCell.trim());
		const rawValuesByHeaderField = {};
		headerFieldList.forEach((headerField) => {
			rawValuesByHeaderField[headerField] = new Set();
		});
		rowList.slice(1).forEach((oneRow) => {
			oneRow.forEach((cellValue, cellIndex) => {
				const headerField = headerFieldList[cellIndex];
				if (headerField !== undefined && `${cellValue}`.trim() !== '') {
					rawValuesByHeaderField[headerField].add(`${cellValue}`);
				}
			});
		});
		callback('', { headerFieldList, rawValuesByHeaderField, rowCount: rowList.length - 1 });
	};

	// --------------------------------------------------------
	// assembleStatementMap — statement list -> Map keyed by statementKey; identical duplicates
	// collapse (censused), so set semantics are explicit rather than accidental.
	// --------------------------------------------------------
	const assembleStatementMap = ({ statementList }) => {
		const statementMap = new Map();
		let duplicatesCollapsedCount = 0;
		statementList.forEach((oneStatement) => {
			const mapRefId = statementKey(oneStatement);
			if (statementMap.has(mapRefId)) {
				duplicatesCollapsedCount += 1;
				return;
			}
			statementMap.set(mapRefId, oneStatement);
		});
		return { statementMap, duplicatesCollapsedCount };
	};

	return {
		reduceMetaEdSourceText,
		reduceDescriptorXmlText,
		reduceCrosswalkCsvText,
		assembleStatementMap,
		statementKey,
		collapseWhitespace,
		STATEMENT_KEY_SEPARATOR,
	};
};

module.exports = moduleFunction;
