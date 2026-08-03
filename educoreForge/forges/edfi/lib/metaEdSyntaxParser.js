'use strict';

// metaEdSyntaxParser.js — recursive-descent parser for the MetaEd DSL (forge-edfi Phase 1,
// independent parser per R-WO-3/R-WO-6).
//
// AUTHORITY: every parse rule here corresponds one-for-one to a rule in the Ed-Fi Alliance's
// Apache-2.0 reference grammar `MetaEdGrammar.g4` (MetaEd-js repo), read-only reference. Rule
// names appear in comments beside their parsers so an auditor can walk this file against the
// .g4 top to bottom. Nothing from the MetaEd toolchain runs here.
//
// GRAMMAR ENTRY DEVIATION (deliberate, recorded in the DEVLOG): the .g4 entry rule is
// `metaEd : namespace+` (Begin Namespace … End Namespace wrappers), but the published model
// packages ship bare files of topLevelEntity+ — the namespace wrapper is supplied by the
// MetaEd build configuration, not the source files. This parser therefore accepts BOTH: a file
// of bare top-level entities, or one or more explicit namespace blocks. Snapshot 04 exercises
// only the bare form; the namespace form is hermetically tested.
//
// CONTROL FLOW: no exceptions for control flow (house law). The token cursor carries a single
// failureMessage; every parse function checks it after each sub-parse and returns early. The
// first refusal aborts the file parse and surfaces verbatim through the callback.
//
// REFUSAL DOCTRINE (R-WO-6 condition 2): any token that does not fit the grammar at its
// position is a refusal naming file, line, column, what was expected, and what was found.
// There is no resynchronization and no skipping.
//
// Public interface is error-first callback-shaped (RT-8/R7) though the work is synchronous.

// ============================================================
// token cursor — position, peeking, expectation, failure threading
// ============================================================

const makeTokenCursor = ({ tokenList, sourceFileRelativePath }) => {
	let cursorIndex = 0;
	const cursor = {
		failureMessage: '',
		atEnd: () => cursorIndex >= tokenList.length,
		peekToken: (lookaheadOffset = 0) => tokenList[cursorIndex + lookaheadOffset],
		takeToken: () => tokenList[cursorIndex++],
		fail: (message) => {
			if (cursor.failureMessage) {
				return undefined; // first refusal wins; never overwrite it
			}
			const nearToken = tokenList[cursorIndex] || tokenList[tokenList.length - 1];
			const locationText = nearToken
				? `${sourceFileRelativePath}:${nearToken.lineNumber}:${nearToken.columnNumber}`
				: `${sourceFileRelativePath}:end-of-file`;
			const foundText = nearToken
				? `found ${nearToken.tokenType} '${String(nearToken.tokenText).slice(0, 60)}'`
				: 'found end of file';
			cursor.failureMessage = `[forge-edfi metaEdSyntaxParser] REFUSED ${locationText} — ${message}; ${foundText}`;
			return undefined;
		},
		expectToken: (tokenType, contextLabel) => {
			if (cursor.failureMessage) {
				return undefined;
			}
			const candidateToken = tokenList[cursorIndex];
			if (!candidateToken || candidateToken.tokenType !== tokenType) {
				return cursor.fail(`expected ${tokenType} (${contextLabel})`);
			}
			cursorIndex += 1;
			return candidateToken;
		},
		takeIfToken: (tokenType) => {
			if (cursor.failureMessage) {
				return undefined;
			}
			const candidateToken = tokenList[cursorIndex];
			if (candidateToken && candidateToken.tokenType === tokenType) {
				cursorIndex += 1;
				return candidateToken;
			}
			return undefined;
		},
	};
	return cursor;
};

// ============================================================
// small shared clause parsers (each maps to a named .g4 rule)
// ============================================================

// metaEdId : METAED_ID — optional nearly everywhere
const takeOptionalMetaEdId = (cursor) => {
	const metaEdIdToken = cursor.takeIfToken('METAED_ID');
	return metaEdIdToken ? metaEdIdToken.metaEdIdValue : undefined;
};

// deprecated / propertyDeprecated : DEPRECATED TEXT
const takeOptionalDeprecated = (cursor) => {
	if (!cursor.takeIfToken('DEPRECATED')) {
		return undefined;
	}
	const deprecatedTextToken = cursor.expectToken('TEXT', 'deprecated reason string');
	return deprecatedTextToken ? deprecatedTextToken.textValue : undefined;
};

// documentation : DOCUMENTATION TEXT (required on most constructs)
const expectDocumentation = (cursor, contextLabel) => {
	cursor.expectToken('DOCUMENTATION', `'documentation' keyword for ${contextLabel}`);
	const documentationTextToken = cursor.expectToken('TEXT', `documentation string for ${contextLabel}`);
	return documentationTextToken ? documentationTextToken.textValue : undefined;
};

// propertyDocumentation : DOCUMENTATION (TEXT | INHERITED)
const expectPropertyDocumentation = (cursor, contextLabel) => {
	cursor.expectToken('DOCUMENTATION', `'documentation' keyword for ${contextLabel}`);
	if (cursor.failureMessage) {
		return undefined;
	}
	if (cursor.takeIfToken('INHERITED')) {
		return { documentationInherited: true };
	}
	const documentationTextToken = cursor.expectToken(
		'TEXT',
		`documentation string (or 'inherited') for ${contextLabel}`,
	);
	return documentationTextToken
		? { documentationText: documentationTextToken.textValue }
		: undefined;
};

// baseName / extendeeName / propertyName / sharedPropertyType : (namespace PERIOD)? localName
const expectPossiblyNamespacedName = (cursor, contextLabel) => {
	const firstIdToken = cursor.expectToken('ID', contextLabel);
	if (cursor.failureMessage) {
		return undefined;
	}
	if (cursor.peekToken() && cursor.peekToken().tokenType === 'PERIOD') {
		// lookahead: namespaced form only when a second ID follows the period — a PERIOD not
		// followed by an ID belongs to some enclosing rule and must not be consumed here
		const tokenAfterPeriod = cursor.peekToken(1);
		if (tokenAfterPeriod && tokenAfterPeriod.tokenType === 'ID') {
			cursor.takeToken(); // PERIOD
			const localNameToken = cursor.takeToken(); // ID
			return {
				baseNamespace: firstIdToken.tokenText,
				localName: localNameToken.tokenText,
			};
		}
	}
	return { localName: firstIdToken.tokenText };
};

// signed_int : (POS_SIGN | NEG_SIGN)? UNSIGNED_INT
const expectSignedInteger = (cursor, contextLabel) => {
	const signToken =
		cursor.takeIfToken('NEG_SIGN') || cursor.takeIfToken('POS_SIGN') || undefined;
	const integerToken = cursor.expectToken('UNSIGNED_INT', contextLabel);
	if (!integerToken) {
		return undefined;
	}
	const signText = signToken && signToken.tokenType === 'NEG_SIGN' ? '-' : '';
	return `${signText}${integerToken.tokenText}`;
};

// minValue / maxValue : MIN_VALUE|MAX_VALUE (signed_int | BIG)
const takeOptionalIntegerBound = (cursor, boundTokenType, allowBigLiteral) => {
	if (!cursor.takeIfToken(boundTokenType)) {
		return undefined;
	}
	if (allowBigLiteral && cursor.takeIfToken('BIG')) {
		return 'big';
	}
	return expectSignedInteger(cursor, `${boundTokenType} numeric bound`);
};

// minValueDecimal / maxValueDecimal : MIN_VALUE|MAX_VALUE decimalValue
// decimalValue : DECIMAL_VALUE | signed_int
const takeOptionalDecimalBound = (cursor, boundTokenType) => {
	if (!cursor.takeIfToken(boundTokenType)) {
		return undefined;
	}
	const decimalToken = cursor.takeIfToken('DECIMAL_VALUE');
	if (decimalToken) {
		return decimalToken.tokenText;
	}
	return expectSignedInteger(cursor, `${boundTokenType} decimal bound`);
};

// minLength / maxLength / totalDigits / decimalPlaces : KEYWORD UNSIGNED_INT
const takeOptionalUnsignedClause = (cursor, clauseTokenType) => {
	if (!cursor.takeIfToken(clauseTokenType)) {
		return undefined;
	}
	const valueToken = cursor.expectToken('UNSIGNED_INT', `${clauseTokenType} value`);
	return valueToken ? Number(valueToken.tokenText) : undefined;
};

const expectUnsignedClause = (cursor, clauseTokenType, contextLabel) => {
	cursor.expectToken(clauseTokenType, `'${clauseTokenType}' clause required for ${contextLabel}`);
	const valueToken = cursor.expectToken('UNSIGNED_INT', `${clauseTokenType} value`);
	return valueToken ? Number(valueToken.tokenText) : undefined;
};

// roleName : ROLE_NAME roleNameName (SHORTEN_TO shortenToName)?
const takeOptionalRoleName = (cursor) => {
	if (!cursor.takeIfToken('ROLE_NAME')) {
		return undefined;
	}
	const roleNameToken = cursor.expectToken('ID', 'role name');
	if (!roleNameToken) {
		return undefined;
	}
	if (cursor.takeIfToken('SHORTEN_TO')) {
		const shortenToToken = cursor.expectToken('ID', 'shorten to name');
		if (!shortenToToken) {
			return undefined;
		}
		return { roleNameName: roleNameToken.tokenText, shortenToName: shortenToToken.tokenText };
	}
	return { roleNameName: roleNameToken.tokenText };
};

// propertyAnnotation : identity | identityRename | required | optional | collection | isQueryableOnly
const ANNOTATION_TOKEN_TO_KIND = {
	IDENTITY: 'identity',
	REQUIRED: 'required',
	OPTIONAL: 'optional',
	REQUIRED_COLLECTION: 'requiredCollection',
	OPTIONAL_COLLECTION: 'optionalCollection',
	IS_QUERYABLE_ONLY: 'queryableOnly',
};

const expectPropertyAnnotation = (cursor, contextLabel) => {
	if (cursor.failureMessage) {
		return undefined;
	}
	if (cursor.takeIfToken('IDENTITY_RENAME')) {
		const renamedNameToken = cursor.expectToken('ID', 'renamed identity property name');
		return renamedNameToken
			? { annotationKind: 'identityRename', renamesIdentityPropertyName: renamedNameToken.tokenText }
			: undefined;
	}
	const nextToken = cursor.peekToken();
	const annotationKind = nextToken && ANNOTATION_TOKEN_TO_KIND[nextToken.tokenType];
	if (!annotationKind) {
		return cursor.fail(
			`expected a property annotation (is part of identity / is required / is optional / is required collection / is optional collection / is queryable only / renames identity property) for ${contextLabel}`,
		);
	}
	cursor.takeToken();
	return { annotationKind };
};

// propertyComponents : propertyDeprecated? propertyDocumentation propertyAnnotation roleName? isQueryableField?
const expectPropertyComponents = (cursor, contextLabel) => {
	const deprecatedText = takeOptionalDeprecated(cursor);
	const documentationParts = expectPropertyDocumentation(cursor, contextLabel);
	const annotationParts = expectPropertyAnnotation(cursor, contextLabel);
	const roleNameParts = takeOptionalRoleName(cursor);
	const isQueryableField = cursor.takeIfToken('IS_QUERYABLE_FIELD') ? true : undefined;
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		...(deprecatedText !== undefined ? { deprecatedText } : {}),
		...documentationParts,
		...annotationParts,
		...(roleNameParts || {}),
		...(isQueryableField ? { isQueryableField } : {}),
	};
};

// mergeDirective : MERGE_REFERENCE sourcePropertyPath WITH targetPropertyPath
// propertyPath : ID (PERIOD ID)*
const expectPropertyPath = (cursor, contextLabel) => {
	const firstSegmentToken = cursor.expectToken('ID', contextLabel);
	if (!firstSegmentToken) {
		return undefined;
	}
	const pathSegments = [firstSegmentToken.tokenText];
	while (
		cursor.peekToken() &&
		cursor.peekToken().tokenType === 'PERIOD' &&
		cursor.peekToken(1) &&
		cursor.peekToken(1).tokenType === 'ID'
	) {
		cursor.takeToken(); // PERIOD
		pathSegments.push(cursor.takeToken().tokenText);
	}
	return pathSegments.join('.');
};

const takeMergeDirectiveList = (cursor) => {
	const mergeDirectiveList = [];
	while (cursor.takeIfToken('MERGE_REFERENCE')) {
		const sourcePropertyPath = expectPropertyPath(cursor, 'merge source property path');
		cursor.expectToken('WITH', "'with' in merge directive");
		const targetPropertyPath = expectPropertyPath(cursor, 'merge target property path');
		if (cursor.failureMessage) {
			return undefined;
		}
		mergeDirectiveList.push({ sourcePropertyPath, targetPropertyPath });
	}
	return mergeDirectiveList.length ? mergeDirectiveList : undefined;
};

// ============================================================
// property parsers — one per .g4 property rule, dispatched by REGISTRY (house law: registry
// over switch). Each returns a property object or undefined on refusal.
// ============================================================

const makeSimplePropertyParser = (propertyType) => (cursor) => {
	const leadToken = cursor.takeToken(); // the property-type keyword
	const propertyNameToken = cursor.expectToken('ID', `${propertyType} property name`);
	if (!propertyNameToken) {
		return undefined;
	}
	const metaEdId = takeOptionalMetaEdId(cursor);
	const componentParts = expectPropertyComponents(cursor, `${propertyType} property '${propertyNameToken.tokenText}'`);
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		propertyType,
		propertyName: propertyNameToken.tokenText,
		...(metaEdId !== undefined ? { metaEdId } : {}),
		...componentParts,
		sourceLineNumber: leadToken.lineNumber,
	};
};

const makeReferencePropertyParser = (propertyType) => (cursor) => {
	// associationProperty / domainEntityProperty / descriptorProperty / enumerationProperty —
	// name may be namespaced; reference forms add potentiallyLogical / isWeakReference / merges
	const leadToken = cursor.takeToken();
	const nameParts = expectPossiblyNamespacedName(cursor, `${propertyType} property name`);
	if (!nameParts) {
		return undefined;
	}
	const metaEdId = takeOptionalMetaEdId(cursor);
	const componentParts = expectPropertyComponents(
		cursor,
		`${propertyType} property '${nameParts.localName}'`,
	);
	if (cursor.failureMessage) {
		return undefined;
	}
	const potentiallyLogical = cursor.takeIfToken('POTENTIALLY_LOGICAL') ? true : undefined;
	const isWeakReference = cursor.takeIfToken('IS_WEAK_REFERENCE') ? true : undefined;
	const mergeDirectiveList = takeMergeDirectiveList(cursor);
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		propertyType,
		...(nameParts.baseNamespace ? { propertyNamespace: nameParts.baseNamespace } : {}),
		propertyName: nameParts.localName,
		...(metaEdId !== undefined ? { metaEdId } : {}),
		...componentParts,
		...(potentiallyLogical ? { potentiallyLogical } : {}),
		...(isWeakReference ? { isWeakReference } : {}),
		...(mergeDirectiveList ? { mergeDirectiveList } : {}),
		sourceLineNumber: leadToken.lineNumber,
	};
};

const makeMergeCapablePropertyParser = (propertyType) => (cursor) => {
	// commonProperty / inlineCommonProperty / choiceProperty — components then merges
	const leadToken = cursor.takeToken();
	const commonExtensionOverride =
		leadToken.tokenType === 'COMMON_EXTENSION' ? true : undefined;
	const nameParts = expectPossiblyNamespacedName(cursor, `${propertyType} property name`);
	if (!nameParts) {
		return undefined;
	}
	const metaEdId = takeOptionalMetaEdId(cursor);
	const componentParts = expectPropertyComponents(
		cursor,
		`${propertyType} property '${nameParts.localName}'`,
	);
	const mergeDirectiveList = takeMergeDirectiveList(cursor);
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		propertyType,
		...(commonExtensionOverride ? { commonExtensionOverride } : {}),
		...(nameParts.baseNamespace ? { propertyNamespace: nameParts.baseNamespace } : {}),
		propertyName: nameParts.localName,
		...(metaEdId !== undefined ? { metaEdId } : {}),
		...componentParts,
		...(mergeDirectiveList ? { mergeDirectiveList } : {}),
		sourceLineNumber: leadToken.lineNumber,
	};
};

const makeSharedPropertyParser = (propertyType) => (cursor) => {
	// sharedStringProperty etc: SHARED_X_KEYWORD sharedPropertyType (SHARED_NAMED name)?
	//   metaEdId? propertyComponents mergeDirective*
	const leadToken = cursor.takeToken();
	const typeParts = expectPossiblyNamespacedName(cursor, `${propertyType} shared type name`);
	if (!typeParts) {
		return undefined;
	}
	let sharedPropertyName;
	if (cursor.takeIfToken('SHARED_NAMED')) {
		const sharedNameToken = cursor.expectToken('ID', `${propertyType} 'named' property name`);
		if (!sharedNameToken) {
			return undefined;
		}
		sharedPropertyName = sharedNameToken.tokenText;
	}
	const metaEdId = takeOptionalMetaEdId(cursor);
	const componentParts = expectPropertyComponents(
		cursor,
		`${propertyType} property '${sharedPropertyName || typeParts.localName}'`,
	);
	const mergeDirectiveList = takeMergeDirectiveList(cursor);
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		propertyType,
		...(typeParts.baseNamespace ? { sharedTypeNamespace: typeParts.baseNamespace } : {}),
		sharedTypeName: typeParts.localName,
		...(sharedPropertyName !== undefined ? { sharedPropertyName } : {}),
		...(metaEdId !== undefined ? { metaEdId } : {}),
		...componentParts,
		...(mergeDirectiveList ? { mergeDirectiveList } : {}),
		sourceLineNumber: leadToken.lineNumber,
	};
};

const parseDecimalProperty = (cursor) => {
	// decimalProperty : DECIMAL name metaEdId? propertyComponents totalDigits decimalPlaces
	//                   minValueDecimal? maxValueDecimal?
	const baseProperty = makeSimplePropertyParser('decimal')(cursor);
	if (!baseProperty) {
		return undefined;
	}
	const totalDigits = expectUnsignedClause(cursor, 'TOTAL_DIGITS', 'decimal property');
	const decimalPlaces = expectUnsignedClause(cursor, 'DECIMAL_PLACES', 'decimal property');
	const minValueDecimal = takeOptionalDecimalBound(cursor, 'MIN_VALUE');
	const maxValueDecimal = takeOptionalDecimalBound(cursor, 'MAX_VALUE');
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		...baseProperty,
		totalDigits,
		decimalPlaces,
		...(minValueDecimal !== undefined ? { minValueDecimal } : {}),
		...(maxValueDecimal !== undefined ? { maxValueDecimal } : {}),
	};
};

const parseIntegerProperty = (cursor) => {
	// integerProperty : INTEGER name metaEdId? propertyComponents minValue? maxValue?
	const baseProperty = makeSimplePropertyParser('integer')(cursor);
	if (!baseProperty) {
		return undefined;
	}
	const minValue = takeOptionalIntegerBound(cursor, 'MIN_VALUE', true);
	const maxValue = takeOptionalIntegerBound(cursor, 'MAX_VALUE', true);
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		...baseProperty,
		...(minValue !== undefined ? { minValue } : {}),
		...(maxValue !== undefined ? { maxValue } : {}),
	};
};

const parseShortProperty = (cursor) => {
	// shortProperty : SHORT name metaEdId? propertyComponents minValueShort? maxValueShort?
	// (short bounds take signed_int only — no 'big' — per the .g4)
	const baseProperty = makeSimplePropertyParser('short')(cursor);
	if (!baseProperty) {
		return undefined;
	}
	const minValue = takeOptionalIntegerBound(cursor, 'MIN_VALUE', false);
	const maxValue = takeOptionalIntegerBound(cursor, 'MAX_VALUE', false);
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		...baseProperty,
		...(minValue !== undefined ? { minValue } : {}),
		...(maxValue !== undefined ? { maxValue } : {}),
	};
};

const parseStringProperty = (cursor) => {
	// stringProperty : STRING name metaEdId? propertyComponents minLength? maxLength
	// maxLength is REQUIRED by the .g4
	const baseProperty = makeSimplePropertyParser('string')(cursor);
	if (!baseProperty) {
		return undefined;
	}
	const minLength = takeOptionalUnsignedClause(cursor, 'MIN_LENGTH');
	const maxLength = expectUnsignedClause(cursor, 'MAX_LENGTH', 'string property');
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		...baseProperty,
		...(minLength !== undefined ? { minLength } : {}),
		maxLength,
	};
};

// the property dispatch registry — tokenType of the leading keyword -> parser (.g4 `property`)
const propertyParserRegistry = {
	ASSOCIATION_KEYWORD: makeReferencePropertyParser('association'),
	BOOLEAN: makeSimplePropertyParser('boolean'),
	CHOICE_KEYWORD: makeMergeCapablePropertyParser('choice'),
	COMMON_KEYWORD: makeMergeCapablePropertyParser('common'),
	COMMON_EXTENSION: makeMergeCapablePropertyParser('common'),
	CURRENCY: makeSimplePropertyParser('currency'),
	DATE: makeSimplePropertyParser('date'),
	DATETIME: makeSimplePropertyParser('datetime'),
	DECIMAL: parseDecimalProperty,
	DESCRIPTOR_KEYWORD: makeReferencePropertyParser('descriptor'),
	DOMAIN_ENTITY_KEYWORD: makeReferencePropertyParser('domainEntity'),
	DURATION: makeSimplePropertyParser('duration'),
	ENUMERATION_KEYWORD: makeReferencePropertyParser('enumeration'),
	INLINE_COMMON_KEYWORD: makeMergeCapablePropertyParser('inlineCommon'),
	INTEGER: parseIntegerProperty,
	PERCENT: makeSimplePropertyParser('percent'),
	SHARED_DECIMAL_KEYWORD: makeSharedPropertyParser('sharedDecimal'),
	SHARED_INTEGER_KEYWORD: makeSharedPropertyParser('sharedInteger'),
	SHARED_SHORT_KEYWORD: makeSharedPropertyParser('sharedShort'),
	SHARED_STRING_KEYWORD: makeSharedPropertyParser('sharedString'),
	SHORT: parseShortProperty,
	STRING: parseStringProperty,
	TIME: makeSimplePropertyParser('time'),
	YEAR: makeSimplePropertyParser('year'),
};

// enumeration/descriptor reference properties are simple names in the .g4 (no weak/logical/
// merge tail) — but descriptorProperty/enumerationProperty allow namespaced names, which
// makeReferencePropertyParser handles; the extra optional tails it probes for simply never
// match. The .g4 shapes are honored because those tokens cannot appear there in valid input.

const parsePropertyList = (cursor, { minimumCount, contextLabel }) => {
	const propertyList = [];
	while (
		!cursor.failureMessage &&
		!cursor.atEnd() &&
		propertyParserRegistry[cursor.peekToken().tokenType]
	) {
		const parsedProperty = propertyParserRegistry[cursor.peekToken().tokenType](cursor);
		if (!parsedProperty) {
			return undefined;
		}
		propertyList.push(parsedProperty);
	}
	if (cursor.failureMessage) {
		return undefined;
	}
	if (propertyList.length < minimumCount) {
		return cursor.fail(
			`${contextLabel} requires at least ${minimumCount} propert${minimumCount === 1 ? 'y' : 'ies'}, found ${propertyList.length}`,
		);
	}
	return propertyList;
};

// ============================================================
// construct parsers — one per .g4 topLevelEntity alternative
// ============================================================

// enumerationItem : ENUMERATION_ITEM shortDescription metaEdId? enumerationItemDocumentation?
const parseEnumerationItemList = (cursor, { minimumCount, contextLabel }) => {
	const enumerationItemList = [];
	while (cursor.takeIfToken('ENUMERATION_ITEM')) {
		const shortDescriptionToken = cursor.expectToken('TEXT', 'enumeration item short description');
		if (!shortDescriptionToken) {
			return undefined;
		}
		const metaEdId = takeOptionalMetaEdId(cursor);
		let itemDocumentationText;
		if (cursor.peekToken() && cursor.peekToken().tokenType === 'DOCUMENTATION') {
			itemDocumentationText = expectDocumentation(cursor, 'enumeration item');
			if (cursor.failureMessage) {
				return undefined;
			}
		}
		enumerationItemList.push({
			shortDescription: shortDescriptionToken.textValue,
			...(metaEdId !== undefined ? { metaEdId } : {}),
			...(itemDocumentationText !== undefined ? { documentationText: itemDocumentationText } : {}),
		});
	}
	if (enumerationItemList.length < minimumCount) {
		return cursor.fail(`${contextLabel} requires at least ${minimumCount} 'item' entr${minimumCount === 1 ? 'y' : 'ies'}`);
	}
	return enumerationItemList;
};

// abstractEntity : ABSTRACT_ENTITY name metaEdId? deprecated? documentation property+
const parseAbstractEntity = (cursor) => {
	const leadToken = cursor.takeToken();
	const entityNameToken = cursor.expectToken('ID', 'Abstract Entity name');
	if (!entityNameToken) {
		return undefined;
	}
	const metaEdId = takeOptionalMetaEdId(cursor);
	const deprecatedText = takeOptionalDeprecated(cursor);
	const documentationText = expectDocumentation(cursor, `Abstract Entity ${entityNameToken.tokenText}`);
	const propertyList = parsePropertyList(cursor, {
		minimumCount: 1,
		contextLabel: `Abstract Entity ${entityNameToken.tokenText}`,
	});
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		constructType: 'abstractEntity',
		entityName: entityNameToken.tokenText,
		...(metaEdId !== undefined ? { metaEdId } : {}),
		...(deprecatedText !== undefined ? { deprecatedText } : {}),
		documentationText,
		propertyList,
		sourceLineNumber: leadToken.lineNumber,
	};
};

// entityConfiguration : cascadeUpdate : CASCADE_UPDATE
const takeOptionalCascadeUpdate = (cursor) =>
	cursor.takeIfToken('CASCADE_UPDATE') ? true : undefined;

// definingDomainEntity : DOMAIN_ENTITY_KEYWORD propertyName metaEdId? propertyDeprecated?
//                        propertyDocumentation roleName? mergeDirective*
const expectDefiningDomainEntity = (cursor, contextLabel) => {
	cursor.expectToken('DOMAIN_ENTITY_KEYWORD', `defining 'domain entity' for ${contextLabel}`);
	const nameParts = expectPossiblyNamespacedName(cursor, `defining domain entity name for ${contextLabel}`);
	if (!nameParts) {
		return undefined;
	}
	const metaEdId = takeOptionalMetaEdId(cursor);
	const deprecatedText = takeOptionalDeprecated(cursor);
	const documentationParts = expectPropertyDocumentation(cursor, `defining domain entity '${nameParts.localName}'`);
	const roleNameParts = takeOptionalRoleName(cursor);
	const mergeDirectiveList = takeMergeDirectiveList(cursor);
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		...(nameParts.baseNamespace ? { propertyNamespace: nameParts.baseNamespace } : {}),
		propertyName: nameParts.localName,
		...(metaEdId !== undefined ? { metaEdId } : {}),
		...(deprecatedText !== undefined ? { deprecatedText } : {}),
		...documentationParts,
		...(roleNameParts || {}),
		...(mergeDirectiveList ? { mergeDirectiveList } : {}),
	};
};

// association / associationExtension / associationSubclass — disambiguated by lookahead after
// the name: ADDITIONS -> extension, BASED_ON -> subclass, else base form
const parseAssociationFamily = (cursor) => {
	const leadToken = cursor.takeToken(); // ASSOCIATION
	const nameParts = expectPossiblyNamespacedName(cursor, 'Association name');
	if (!nameParts) {
		return undefined;
	}
	if (cursor.takeIfToken('ADDITIONS')) {
		// associationExtension : ASSOCIATION extendeeName ADDITIONS metaEdId? deprecated? property+
		const metaEdId = takeOptionalMetaEdId(cursor);
		const deprecatedText = takeOptionalDeprecated(cursor);
		const propertyList = parsePropertyList(cursor, {
			minimumCount: 1,
			contextLabel: `Association ${nameParts.localName} additions`,
		});
		if (cursor.failureMessage) {
			return undefined;
		}
		return {
			constructType: 'associationExtension',
			...(nameParts.baseNamespace ? { extendeeNamespace: nameParts.baseNamespace } : {}),
			extendeeName: nameParts.localName,
			...(metaEdId !== undefined ? { metaEdId } : {}),
			...(deprecatedText !== undefined ? { deprecatedText } : {}),
			propertyList,
			sourceLineNumber: leadToken.lineNumber,
		};
	}
	if (cursor.takeIfToken('BASED_ON')) {
		// associationSubclass : ASSOCIATION name BASED_ON baseName metaEdId? deprecated?
		//                       documentation property+
		const baseNameParts = expectPossiblyNamespacedName(cursor, 'Association base name');
		if (!baseNameParts) {
			return undefined;
		}
		const metaEdId = takeOptionalMetaEdId(cursor);
		const deprecatedText = takeOptionalDeprecated(cursor);
		const documentationText = expectDocumentation(cursor, `Association ${nameParts.localName}`);
		const propertyList = parsePropertyList(cursor, {
			minimumCount: 1,
			contextLabel: `Association subclass ${nameParts.localName}`,
		});
		if (cursor.failureMessage) {
			return undefined;
		}
		return {
			constructType: 'associationSubclass',
			associationName: nameParts.localName,
			...(baseNameParts.baseNamespace ? { baseNamespace: baseNameParts.baseNamespace } : {}),
			baseName: baseNameParts.localName,
			...(metaEdId !== undefined ? { metaEdId } : {}),
			...(deprecatedText !== undefined ? { deprecatedText } : {}),
			documentationText,
			propertyList,
			sourceLineNumber: leadToken.lineNumber,
		};
	}
	// association : ASSOCIATION name metaEdId? deprecated? documentation entityConfiguration?
	//               definingDomainEntity definingDomainEntity property*
	const metaEdId = takeOptionalMetaEdId(cursor);
	const deprecatedText = takeOptionalDeprecated(cursor);
	const documentationText = expectDocumentation(cursor, `Association ${nameParts.localName}`);
	const allowPrimaryKeyUpdates = takeOptionalCascadeUpdate(cursor);
	const firstDefiningDomainEntity = expectDefiningDomainEntity(cursor, `Association ${nameParts.localName}`);
	const secondDefiningDomainEntity = expectDefiningDomainEntity(cursor, `Association ${nameParts.localName}`);
	const propertyList = parsePropertyList(cursor, {
		minimumCount: 0,
		contextLabel: `Association ${nameParts.localName}`,
	});
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		constructType: 'association',
		associationName: nameParts.localName,
		...(metaEdId !== undefined ? { metaEdId } : {}),
		...(deprecatedText !== undefined ? { deprecatedText } : {}),
		documentationText,
		...(allowPrimaryKeyUpdates ? { allowPrimaryKeyUpdates } : {}),
		definingDomainEntityList: [firstDefiningDomainEntity, secondDefiningDomainEntity],
		propertyList,
		sourceLineNumber: leadToken.lineNumber,
	};
};

// choice : CHOICE name metaEdId? deprecated? documentation property+
const parseChoice = (cursor) => {
	const leadToken = cursor.takeToken();
	const choiceNameToken = cursor.expectToken('ID', 'Choice name');
	if (!choiceNameToken) {
		return undefined;
	}
	const metaEdId = takeOptionalMetaEdId(cursor);
	const deprecatedText = takeOptionalDeprecated(cursor);
	const documentationText = expectDocumentation(cursor, `Choice ${choiceNameToken.tokenText}`);
	const propertyList = parsePropertyList(cursor, {
		minimumCount: 1,
		contextLabel: `Choice ${choiceNameToken.tokenText}`,
	});
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		constructType: 'choice',
		choiceName: choiceNameToken.tokenText,
		...(metaEdId !== undefined ? { metaEdId } : {}),
		...(deprecatedText !== undefined ? { deprecatedText } : {}),
		documentationText,
		propertyList,
		sourceLineNumber: leadToken.lineNumber,
	};
};

// sharedDecimal : SHARED_DECIMAL name metaEdId? deprecated? documentation totalDigits
//                 decimalPlaces minValueDecimal? maxValueDecimal?
const parseSharedDecimal = (cursor) => {
	const leadToken = cursor.takeToken();
	const sharedDecimalNameToken = cursor.expectToken('ID', 'Shared Decimal name');
	if (!sharedDecimalNameToken) {
		return undefined;
	}
	const metaEdId = takeOptionalMetaEdId(cursor);
	const deprecatedText = takeOptionalDeprecated(cursor);
	const documentationText = expectDocumentation(cursor, `Shared Decimal ${sharedDecimalNameToken.tokenText}`);
	const totalDigits = expectUnsignedClause(cursor, 'TOTAL_DIGITS', 'Shared Decimal');
	const decimalPlaces = expectUnsignedClause(cursor, 'DECIMAL_PLACES', 'Shared Decimal');
	const minValueDecimal = takeOptionalDecimalBound(cursor, 'MIN_VALUE');
	const maxValueDecimal = takeOptionalDecimalBound(cursor, 'MAX_VALUE');
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		constructType: 'sharedDecimal',
		sharedDecimalName: sharedDecimalNameToken.tokenText,
		...(metaEdId !== undefined ? { metaEdId } : {}),
		...(deprecatedText !== undefined ? { deprecatedText } : {}),
		documentationText,
		totalDigits,
		decimalPlaces,
		...(minValueDecimal !== undefined ? { minValueDecimal } : {}),
		...(maxValueDecimal !== undefined ? { maxValueDecimal } : {}),
		sourceLineNumber: leadToken.lineNumber,
	};
};

// sharedInteger / sharedShort : name metaEdId? deprecated? documentation minValue? maxValue?
const makeSharedIntegerFamilyParser = (constructType, constructLabel, nameField) => (cursor) => {
	const leadToken = cursor.takeToken();
	const sharedNameToken = cursor.expectToken('ID', `${constructLabel} name`);
	if (!sharedNameToken) {
		return undefined;
	}
	const metaEdId = takeOptionalMetaEdId(cursor);
	const deprecatedText = takeOptionalDeprecated(cursor);
	const documentationText = expectDocumentation(cursor, `${constructLabel} ${sharedNameToken.tokenText}`);
	// the .g4 gives sharedInteger/sharedShort minValue/maxValue, which admit BIG
	const minValue = takeOptionalIntegerBound(cursor, 'MIN_VALUE', true);
	const maxValue = takeOptionalIntegerBound(cursor, 'MAX_VALUE', true);
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		constructType,
		[nameField]: sharedNameToken.tokenText,
		...(metaEdId !== undefined ? { metaEdId } : {}),
		...(deprecatedText !== undefined ? { deprecatedText } : {}),
		documentationText,
		...(minValue !== undefined ? { minValue } : {}),
		...(maxValue !== undefined ? { maxValue } : {}),
		sourceLineNumber: leadToken.lineNumber,
	};
};

// sharedString : SHARED_STRING name metaEdId? deprecated? documentation minLength? maxLength
const parseSharedString = (cursor) => {
	const leadToken = cursor.takeToken();
	const sharedStringNameToken = cursor.expectToken('ID', 'Shared String name');
	if (!sharedStringNameToken) {
		return undefined;
	}
	const metaEdId = takeOptionalMetaEdId(cursor);
	const deprecatedText = takeOptionalDeprecated(cursor);
	const documentationText = expectDocumentation(cursor, `Shared String ${sharedStringNameToken.tokenText}`);
	const minLength = takeOptionalUnsignedClause(cursor, 'MIN_LENGTH');
	const maxLength = expectUnsignedClause(cursor, 'MAX_LENGTH', `Shared String ${sharedStringNameToken.tokenText}`);
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		constructType: 'sharedString',
		sharedStringName: sharedStringNameToken.tokenText,
		...(metaEdId !== undefined ? { metaEdId } : {}),
		...(deprecatedText !== undefined ? { deprecatedText } : {}),
		documentationText,
		...(minLength !== undefined ? { minLength } : {}),
		maxLength,
		sourceLineNumber: leadToken.lineNumber,
	};
};

// common / commonExtension / commonSubclass — same lookahead family as association
const parseCommonFamily = (cursor) => {
	const leadToken = cursor.takeToken(); // COMMON
	const nameParts = expectPossiblyNamespacedName(cursor, 'Common name');
	if (!nameParts) {
		return undefined;
	}
	if (cursor.takeIfToken('ADDITIONS')) {
		const metaEdId = takeOptionalMetaEdId(cursor);
		const deprecatedText = takeOptionalDeprecated(cursor);
		const propertyList = parsePropertyList(cursor, {
			minimumCount: 1,
			contextLabel: `Common ${nameParts.localName} additions`,
		});
		if (cursor.failureMessage) {
			return undefined;
		}
		return {
			constructType: 'commonExtension',
			...(nameParts.baseNamespace ? { extendeeNamespace: nameParts.baseNamespace } : {}),
			extendeeName: nameParts.localName,
			...(metaEdId !== undefined ? { metaEdId } : {}),
			...(deprecatedText !== undefined ? { deprecatedText } : {}),
			propertyList,
			sourceLineNumber: leadToken.lineNumber,
		};
	}
	if (cursor.takeIfToken('BASED_ON')) {
		const baseNameParts = expectPossiblyNamespacedName(cursor, 'Common base name');
		if (!baseNameParts) {
			return undefined;
		}
		const metaEdId = takeOptionalMetaEdId(cursor);
		const deprecatedText = takeOptionalDeprecated(cursor);
		const documentationText = expectDocumentation(cursor, `Common ${nameParts.localName}`);
		const propertyList = parsePropertyList(cursor, {
			minimumCount: 1,
			contextLabel: `Common subclass ${nameParts.localName}`,
		});
		if (cursor.failureMessage) {
			return undefined;
		}
		return {
			constructType: 'commonSubclass',
			commonName: nameParts.localName,
			...(baseNameParts.baseNamespace ? { baseNamespace: baseNameParts.baseNamespace } : {}),
			baseName: baseNameParts.localName,
			...(metaEdId !== undefined ? { metaEdId } : {}),
			...(deprecatedText !== undefined ? { deprecatedText } : {}),
			documentationText,
			propertyList,
			sourceLineNumber: leadToken.lineNumber,
		};
	}
	const metaEdId = takeOptionalMetaEdId(cursor);
	const deprecatedText = takeOptionalDeprecated(cursor);
	const documentationText = expectDocumentation(cursor, `Common ${nameParts.localName}`);
	const propertyList = parsePropertyList(cursor, {
		minimumCount: 1,
		contextLabel: `Common ${nameParts.localName}`,
	});
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		constructType: 'common',
		commonName: nameParts.localName,
		...(metaEdId !== undefined ? { metaEdId } : {}),
		...(deprecatedText !== undefined ? { deprecatedText } : {}),
		documentationText,
		propertyList,
		sourceLineNumber: leadToken.lineNumber,
	};
};

// descriptor : DESCRIPTOR name metaEdId? deprecated? documentation property* withMapType?
const parseDescriptor = (cursor) => {
	const leadToken = cursor.takeToken();
	const descriptorNameToken = cursor.expectToken('ID', 'Descriptor name');
	if (!descriptorNameToken) {
		return undefined;
	}
	const metaEdId = takeOptionalMetaEdId(cursor);
	const deprecatedText = takeOptionalDeprecated(cursor);
	const documentationText = expectDocumentation(cursor, `Descriptor ${descriptorNameToken.tokenText}`);
	const propertyList = parsePropertyList(cursor, {
		minimumCount: 0,
		contextLabel: `Descriptor ${descriptorNameToken.tokenText}`,
	});
	if (cursor.failureMessage) {
		return undefined;
	}
	// withMapType : (WITH_MAP_TYPE | WITH_OPTIONAL_MAP_TYPE) mapTypeDocumentation enumerationItem+
	let mapTypeParts;
	const requiredMapTypeToken = cursor.takeIfToken('WITH_MAP_TYPE');
	const optionalMapTypeToken = requiredMapTypeToken ? undefined : cursor.takeIfToken('WITH_OPTIONAL_MAP_TYPE');
	if (requiredMapTypeToken || optionalMapTypeToken) {
		const mapTypeDocumentationText = expectDocumentation(cursor, `Descriptor ${descriptorNameToken.tokenText} map type`);
		const mapTypeItemList = parseEnumerationItemList(cursor, {
			minimumCount: 1,
			contextLabel: `Descriptor ${descriptorNameToken.tokenText} map type`,
		});
		if (cursor.failureMessage) {
			return undefined;
		}
		mapTypeParts = {
			mapTypeRequired: Boolean(requiredMapTypeToken),
			mapTypeDocumentationText,
			mapTypeItemList,
		};
	}
	return {
		constructType: 'descriptor',
		descriptorName: descriptorNameToken.tokenText,
		...(metaEdId !== undefined ? { metaEdId } : {}),
		...(deprecatedText !== undefined ? { deprecatedText } : {}),
		documentationText,
		propertyList,
		...(mapTypeParts || {}),
		sourceLineNumber: leadToken.lineNumber,
	};
};

// domainItem : (association|common|domain entity|descriptor|inline common keyword)
//              (baseNamespace PERIOD)? localDomainItemName metaEdId?
const DOMAIN_ITEM_TOKEN_TO_REFERENCE_TYPE = {
	ASSOCIATION_KEYWORD: 'association',
	COMMON_KEYWORD: 'common',
	DOMAIN_ENTITY_KEYWORD: 'domainEntity',
	DESCRIPTOR_KEYWORD: 'descriptor',
	INLINE_COMMON_KEYWORD: 'inlineCommon',
};

const parseDomainItemList = (cursor, { minimumCount, contextLabel }) => {
	const domainItemList = [];
	while (
		!cursor.atEnd() &&
		DOMAIN_ITEM_TOKEN_TO_REFERENCE_TYPE[cursor.peekToken().tokenType]
	) {
		const referenceType = DOMAIN_ITEM_TOKEN_TO_REFERENCE_TYPE[cursor.takeToken().tokenType];
		const nameParts = expectPossiblyNamespacedName(cursor, `${contextLabel} domain item name`);
		if (!nameParts) {
			return undefined;
		}
		const metaEdId = takeOptionalMetaEdId(cursor);
		domainItemList.push({
			referenceType,
			...(nameParts.baseNamespace ? { baseNamespace: nameParts.baseNamespace } : {}),
			localDomainItemName: nameParts.localName,
			...(metaEdId !== undefined ? { metaEdId } : {}),
		});
	}
	if (cursor.failureMessage) {
		return undefined;
	}
	if (domainItemList.length < minimumCount) {
		return cursor.fail(`${contextLabel} requires at least ${minimumCount} domain item(s)`);
	}
	return domainItemList;
};

// domain : DOMAIN name metaEdId? deprecated? documentation domainItem+ footerDocumentation?
const parseDomain = (cursor) => {
	const leadToken = cursor.takeToken();
	const domainNameToken = cursor.expectToken('ID', 'Domain name');
	if (!domainNameToken) {
		return undefined;
	}
	const metaEdId = takeOptionalMetaEdId(cursor);
	const deprecatedText = takeOptionalDeprecated(cursor);
	const documentationText = expectDocumentation(cursor, `Domain ${domainNameToken.tokenText}`);
	const domainItemList = parseDomainItemList(cursor, {
		minimumCount: 1,
		contextLabel: `Domain ${domainNameToken.tokenText}`,
	});
	if (cursor.failureMessage) {
		return undefined;
	}
	let footerDocumentationText;
	if (cursor.takeIfToken('FOOTER_DOCUMENTATION')) {
		const footerTextToken = cursor.expectToken('TEXT', 'footer documentation string');
		if (!footerTextToken) {
			return undefined;
		}
		footerDocumentationText = footerTextToken.textValue;
	}
	return {
		constructType: 'domain',
		domainName: domainNameToken.tokenText,
		...(metaEdId !== undefined ? { metaEdId } : {}),
		...(deprecatedText !== undefined ? { deprecatedText } : {}),
		documentationText,
		domainItemList,
		...(footerDocumentationText !== undefined ? { footerDocumentationText } : {}),
		sourceLineNumber: leadToken.lineNumber,
	};
};

// domainEntity / domainEntityExtension / domainEntitySubclass — lookahead family
const parseDomainEntityFamily = (cursor) => {
	const leadToken = cursor.takeToken(); // DOMAIN_ENTITY
	const nameParts = expectPossiblyNamespacedName(cursor, 'Domain Entity name');
	if (!nameParts) {
		return undefined;
	}
	if (cursor.takeIfToken('ADDITIONS')) {
		const metaEdId = takeOptionalMetaEdId(cursor);
		const deprecatedText = takeOptionalDeprecated(cursor);
		const propertyList = parsePropertyList(cursor, {
			minimumCount: 1,
			contextLabel: `Domain Entity ${nameParts.localName} additions`,
		});
		if (cursor.failureMessage) {
			return undefined;
		}
		return {
			constructType: 'domainEntityExtension',
			...(nameParts.baseNamespace ? { extendeeNamespace: nameParts.baseNamespace } : {}),
			extendeeName: nameParts.localName,
			...(metaEdId !== undefined ? { metaEdId } : {}),
			...(deprecatedText !== undefined ? { deprecatedText } : {}),
			propertyList,
			sourceLineNumber: leadToken.lineNumber,
		};
	}
	if (cursor.takeIfToken('BASED_ON')) {
		const baseNameParts = expectPossiblyNamespacedName(cursor, 'Domain Entity base name');
		if (!baseNameParts) {
			return undefined;
		}
		const metaEdId = takeOptionalMetaEdId(cursor);
		const deprecatedText = takeOptionalDeprecated(cursor);
		const documentationText = expectDocumentation(cursor, `Domain Entity ${nameParts.localName}`);
		const propertyList = parsePropertyList(cursor, {
			minimumCount: 1,
			contextLabel: `Domain Entity subclass ${nameParts.localName}`,
		});
		if (cursor.failureMessage) {
			return undefined;
		}
		return {
			constructType: 'domainEntitySubclass',
			entityName: nameParts.localName,
			...(baseNameParts.baseNamespace ? { baseNamespace: baseNameParts.baseNamespace } : {}),
			baseName: baseNameParts.localName,
			...(metaEdId !== undefined ? { metaEdId } : {}),
			...(deprecatedText !== undefined ? { deprecatedText } : {}),
			documentationText,
			propertyList,
			sourceLineNumber: leadToken.lineNumber,
		};
	}
	// domainEntity : DOMAIN_ENTITY name metaEdId? deprecated? documentation
	//                entityConfiguration? property+
	const metaEdId = takeOptionalMetaEdId(cursor);
	const deprecatedText = takeOptionalDeprecated(cursor);
	const documentationText = expectDocumentation(cursor, `Domain Entity ${nameParts.localName}`);
	const allowPrimaryKeyUpdates = takeOptionalCascadeUpdate(cursor);
	const propertyList = parsePropertyList(cursor, {
		minimumCount: 1,
		contextLabel: `Domain Entity ${nameParts.localName}`,
	});
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		constructType: 'domainEntity',
		entityName: nameParts.localName,
		...(metaEdId !== undefined ? { metaEdId } : {}),
		...(deprecatedText !== undefined ? { deprecatedText } : {}),
		documentationText,
		...(allowPrimaryKeyUpdates ? { allowPrimaryKeyUpdates } : {}),
		propertyList,
		sourceLineNumber: leadToken.lineNumber,
	};
};

// enumeration : ENUMERATION name metaEdId? deprecated? documentation enumerationItem+
const parseEnumeration = (cursor) => {
	const leadToken = cursor.takeToken();
	const enumerationNameToken = cursor.expectToken('ID', 'Enumeration name');
	if (!enumerationNameToken) {
		return undefined;
	}
	const metaEdId = takeOptionalMetaEdId(cursor);
	const deprecatedText = takeOptionalDeprecated(cursor);
	const documentationText = expectDocumentation(cursor, `Enumeration ${enumerationNameToken.tokenText}`);
	const enumerationItemList = parseEnumerationItemList(cursor, {
		minimumCount: 1,
		contextLabel: `Enumeration ${enumerationNameToken.tokenText}`,
	});
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		constructType: 'enumeration',
		enumerationName: enumerationNameToken.tokenText,
		...(metaEdId !== undefined ? { metaEdId } : {}),
		...(deprecatedText !== undefined ? { deprecatedText } : {}),
		documentationText,
		enumerationItemList,
		sourceLineNumber: leadToken.lineNumber,
	};
};

// inlineCommon : INLINE_COMMON name metaEdId? deprecated? documentation property+
const parseInlineCommon = (cursor) => {
	const leadToken = cursor.takeToken();
	const inlineCommonNameToken = cursor.expectToken('ID', 'Inline Common name');
	if (!inlineCommonNameToken) {
		return undefined;
	}
	const metaEdId = takeOptionalMetaEdId(cursor);
	const deprecatedText = takeOptionalDeprecated(cursor);
	const documentationText = expectDocumentation(cursor, `Inline Common ${inlineCommonNameToken.tokenText}`);
	const propertyList = parsePropertyList(cursor, {
		minimumCount: 1,
		contextLabel: `Inline Common ${inlineCommonNameToken.tokenText}`,
	});
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		constructType: 'inlineCommon',
		inlineCommonName: inlineCommonNameToken.tokenText,
		...(metaEdId !== undefined ? { metaEdId } : {}),
		...(deprecatedText !== undefined ? { deprecatedText } : {}),
		documentationText,
		propertyList,
		sourceLineNumber: leadToken.lineNumber,
	};
};

// interchangeElement / interchangeIdentity — the component entries of an interchange
const INTERCHANGE_ELEMENT_TOKEN_TO_REFERENCE_TYPE = {
	ASSOCIATION_KEYWORD: 'association',
	DESCRIPTOR_KEYWORD: 'descriptor',
	DOMAIN_ENTITY_KEYWORD: 'domainEntity',
};

const INTERCHANGE_IDENTITY_TOKEN_TO_REFERENCE_TYPE = {
	ASSOCIATION_IDENTITY: 'association',
	DOMAIN_ENTITY_IDENTITY: 'domainEntity',
};

const parseInterchangeComponentList = (cursor, { contextLabel, requireElement }) => {
	const interchangeComponentList = [];
	let elementCount = 0;
	while (!cursor.atEnd()) {
		const nextTokenType = cursor.peekToken().tokenType;
		const elementReferenceType = INTERCHANGE_ELEMENT_TOKEN_TO_REFERENCE_TYPE[nextTokenType];
		const identityReferenceType = INTERCHANGE_IDENTITY_TOKEN_TO_REFERENCE_TYPE[nextTokenType];
		if (!elementReferenceType && !identityReferenceType) {
			break;
		}
		cursor.takeToken();
		const nameParts = expectPossiblyNamespacedName(cursor, `${contextLabel} component name`);
		if (!nameParts) {
			return undefined;
		}
		const metaEdId = takeOptionalMetaEdId(cursor);
		if (elementReferenceType) {
			elementCount += 1;
		}
		interchangeComponentList.push({
			componentKind: elementReferenceType ? 'element' : 'identityTemplate',
			referenceType: elementReferenceType || identityReferenceType,
			...(nameParts.baseNamespace ? { baseNamespace: nameParts.baseNamespace } : {}),
			localInterchangeItemName: nameParts.localName,
			...(metaEdId !== undefined ? { metaEdId } : {}),
		});
	}
	if (cursor.failureMessage) {
		return undefined;
	}
	if (!interchangeComponentList.length) {
		return cursor.fail(`${contextLabel} requires at least one component entry`);
	}
	if (requireElement && elementCount === 0) {
		return cursor.fail(`${contextLabel} requires at least one interchange ELEMENT (association / descriptor / domain entity entry)`);
	}
	return interchangeComponentList;
};

// interchange / interchangeExtension — lookahead family
const parseInterchangeFamily = (cursor) => {
	const leadToken = cursor.takeToken(); // INTERCHANGE
	const nameParts = expectPossiblyNamespacedName(cursor, 'Interchange name');
	if (!nameParts) {
		return undefined;
	}
	if (cursor.takeIfToken('ADDITIONS')) {
		// interchangeExtension : INTERCHANGE extendeeName ADDITIONS metaEdId? deprecated?
		//                        (interchangeElement | interchangeIdentity)+
		const metaEdId = takeOptionalMetaEdId(cursor);
		const deprecatedText = takeOptionalDeprecated(cursor);
		const interchangeComponentList = parseInterchangeComponentList(cursor, {
			contextLabel: `Interchange ${nameParts.localName} additions`,
			requireElement: false,
		});
		if (cursor.failureMessage) {
			return undefined;
		}
		return {
			constructType: 'interchangeExtension',
			...(nameParts.baseNamespace ? { extendeeNamespace: nameParts.baseNamespace } : {}),
			extendeeName: nameParts.localName,
			...(metaEdId !== undefined ? { metaEdId } : {}),
			...(deprecatedText !== undefined ? { deprecatedText } : {}),
			interchangeComponentList,
			sourceLineNumber: leadToken.lineNumber,
		};
	}
	// interchange : INTERCHANGE name metaEdId? deprecated? documentation
	//               extendedDocumentation? useCaseDocumentation? interchangeComponent
	const metaEdId = takeOptionalMetaEdId(cursor);
	const deprecatedText = takeOptionalDeprecated(cursor);
	const documentationText = expectDocumentation(cursor, `Interchange ${nameParts.localName}`);
	let extendedDocumentationText;
	if (cursor.takeIfToken('EXTENDED_DOCUMENTATION')) {
		const extendedTextToken = cursor.expectToken('TEXT', 'extended documentation string');
		if (!extendedTextToken) {
			return undefined;
		}
		extendedDocumentationText = extendedTextToken.textValue;
	}
	let useCaseDocumentationText;
	if (cursor.takeIfToken('USE_CASE_DOCUMENTATION')) {
		const useCaseTextToken = cursor.expectToken('TEXT', 'use case documentation string');
		if (!useCaseTextToken) {
			return undefined;
		}
		useCaseDocumentationText = useCaseTextToken.textValue;
	}
	const interchangeComponentList = parseInterchangeComponentList(cursor, {
		contextLabel: `Interchange ${nameParts.localName}`,
		requireElement: true,
	});
	if (cursor.failureMessage) {
		return undefined;
	}
	return {
		constructType: 'interchange',
		interchangeName: nameParts.localName,
		...(metaEdId !== undefined ? { metaEdId } : {}),
		...(deprecatedText !== undefined ? { deprecatedText } : {}),
		documentationText,
		...(extendedDocumentationText !== undefined ? { extendedDocumentationText } : {}),
		...(useCaseDocumentationText !== undefined ? { useCaseDocumentationText } : {}),
		interchangeComponentList,
		sourceLineNumber: leadToken.lineNumber,
	};
};

// subdomain : SUBDOMAIN name SUBDOMAIN_OF parentDomainName metaEdId? deprecated? documentation
//             domainItem+ (SUBDOMAIN_POSITION UNSIGNED_INT)?
const parseSubdomain = (cursor) => {
	const leadToken = cursor.takeToken();
	const subdomainNameToken = cursor.expectToken('ID', 'Subdomain name');
	if (!subdomainNameToken) {
		return undefined;
	}
	cursor.expectToken('SUBDOMAIN_OF', "'of' in Subdomain declaration");
	const parentDomainNameToken = cursor.expectToken('ID', 'Subdomain parent domain name');
	if (!parentDomainNameToken) {
		return undefined;
	}
	const metaEdId = takeOptionalMetaEdId(cursor);
	const deprecatedText = takeOptionalDeprecated(cursor);
	const documentationText = expectDocumentation(cursor, `Subdomain ${subdomainNameToken.tokenText}`);
	const domainItemList = parseDomainItemList(cursor, {
		minimumCount: 1,
		contextLabel: `Subdomain ${subdomainNameToken.tokenText}`,
	});
	if (cursor.failureMessage) {
		return undefined;
	}
	let subdomainPosition;
	if (cursor.takeIfToken('SUBDOMAIN_POSITION')) {
		const positionToken = cursor.expectToken('UNSIGNED_INT', 'subdomain position value');
		if (!positionToken) {
			return undefined;
		}
		subdomainPosition = Number(positionToken.tokenText);
	}
	return {
		constructType: 'subdomain',
		subdomainName: subdomainNameToken.tokenText,
		parentDomainName: parentDomainNameToken.tokenText,
		...(metaEdId !== undefined ? { metaEdId } : {}),
		...(deprecatedText !== undefined ? { deprecatedText } : {}),
		documentationText,
		domainItemList,
		...(subdomainPosition !== undefined ? { subdomainPosition } : {}),
		sourceLineNumber: leadToken.lineNumber,
	};
};

// the top-level dispatch registry (.g4 `topLevelEntity`) — house law: registry over switch
const topLevelParserRegistry = {
	ABSTRACT_ENTITY: parseAbstractEntity,
	ASSOCIATION: parseAssociationFamily,
	CHOICE: parseChoice,
	SHARED_DECIMAL: parseSharedDecimal,
	SHARED_INTEGER: makeSharedIntegerFamilyParser('sharedInteger', 'Shared Integer', 'sharedIntegerName'),
	SHARED_SHORT: makeSharedIntegerFamilyParser('sharedShort', 'Shared Short', 'sharedShortName'),
	SHARED_STRING: parseSharedString,
	COMMON: parseCommonFamily,
	DESCRIPTOR: parseDescriptor,
	DOMAIN_ENTITY: parseDomainEntityFamily,
	ENUMERATION: parseEnumeration,
	INLINE_COMMON: parseInlineCommon,
	INTERCHANGE: parseInterchangeFamily,
	DOMAIN: parseDomain,
	SUBDOMAIN: parseSubdomain,
};

// ============================================================
// file-level parse — topLevelEntity+ with optional explicit namespace blocks (see the
// GRAMMAR ENTRY DEVIATION note in the header)
// ============================================================

const parseTopLevelEntityRun = (cursor, namespaceContext) => {
	const constructList = [];
	while (!cursor.failureMessage && !cursor.atEnd()) {
		const nextTokenType = cursor.peekToken().tokenType;
		if (nextTokenType === 'END_NAMESPACE' || nextTokenType === 'BEGIN_NAMESPACE') {
			break;
		}
		const constructParser = topLevelParserRegistry[nextTokenType];
		if (!constructParser) {
			cursor.fail(
				'expected a top-level MetaEd construct keyword (Abstract Entity / Association / Choice / Common / Descriptor / Domain / Domain Entity / Enumeration / Inline Common / Interchange / Shared Decimal / Shared Integer / Shared Short / Shared String / Subdomain)',
			);
			return undefined;
		}
		const parsedConstruct = constructParser(cursor);
		if (!parsedConstruct) {
			return undefined;
		}
		constructList.push(
			namespaceContext ? { ...parsedConstruct, ...namespaceContext } : parsedConstruct,
		);
	}
	return cursor.failureMessage ? undefined : constructList;
};

const moduleFunction = () => {
	// --------------------------------------------------------
	// parseTokenList — the one public operation.
	//   inputs:  { tokenList, sourceFileRelativePath }
	//   callback(errString, { constructList })
	// --------------------------------------------------------
	const parseTokenList = ({ tokenList, sourceFileRelativePath }, callback) => {
		if (!Array.isArray(tokenList)) {
			callback(
				`[forge-edfi metaEdSyntaxParser] REFUSED: tokenList is required and must be an array for ${sourceFileRelativePath}`,
			);
			return;
		}
		if (!sourceFileRelativePath) {
			callback(
				'[forge-edfi metaEdSyntaxParser] REFUSED: sourceFileRelativePath is required so refusals can name their file',
			);
			return;
		}
		if (!tokenList.length) {
			callback(
				`[forge-edfi metaEdSyntaxParser] REFUSED ${sourceFileRelativePath} — file contains no MetaEd tokens (empty or comment-only source is not a model file)`,
			);
			return;
		}

		const cursor = makeTokenCursor({ tokenList, sourceFileRelativePath });
		const constructList = [];

		while (!cursor.failureMessage && !cursor.atEnd()) {
			if (cursor.peekToken().tokenType === 'BEGIN_NAMESPACE') {
				// namespace : BEGIN_NAMESPACE namespaceName (CORE | ID) topLevelEntity+ END_NAMESPACE
				cursor.takeToken();
				const namespaceNameToken = cursor.expectToken('ID', 'namespace name');
				if (!namespaceNameToken) {
					break;
				}
				const coreToken = cursor.takeIfToken('CORE');
				const namespaceTypeToken = coreToken || cursor.takeIfToken('ID');
				if (!namespaceTypeToken) {
					cursor.fail("expected namespace type ('core' or a project identifier) after the namespace name");
					break;
				}
				const namespaceConstructList = parseTopLevelEntityRun(cursor, {
					namespaceName: namespaceNameToken.tokenText,
					namespaceType: namespaceTypeToken.tokenType === 'CORE' ? 'core' : namespaceTypeToken.tokenText,
				});
				if (!namespaceConstructList) {
					break;
				}
				if (!namespaceConstructList.length) {
					cursor.fail('a namespace block requires at least one top-level entity');
					break;
				}
				if (!cursor.expectToken('END_NAMESPACE', 'namespace block terminator')) {
					break;
				}
				constructList.push(...namespaceConstructList);
				continue;
			}
			const bareConstructList = parseTopLevelEntityRun(cursor, undefined);
			if (!bareConstructList) {
				break;
			}
			constructList.push(...bareConstructList);
		}

		if (cursor.failureMessage) {
			callback(cursor.failureMessage);
			return;
		}
		callback('', { constructList });
	};

	return { parseTokenList };
};

module.exports = moduleFunction;
