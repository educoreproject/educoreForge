'use strict';

// cedsPropertyNameTable — ⟪campaign P3, W-C-17 (V1-C49)⟫ the CEDS node shape, DECLARED rather than discovered.
//
// The parser carries every predicate it does not interpret as a generic annotation named by its local name
// (parser.js extractGenericAnnotations). Before this table that set was OPEN: whatever a CEDS release asserted
// became a node property, silently. Now a predicate whose local name is not declared here is a parse fault
// refused by name, so a new CEDS predicate reaches the graph only after someone has looked at it and added it.
//
// MEASURED 2026-10-06 over standardSourceData/01 (the full ontology): exactly these fourteen local names, with
// element counts creator 24,618 · prefLabel 21,478 · definition 14,390 · comment 407 · minInclusive 138 ·
// decimalPlaces 114 · deprecated 35 · minLength 26 · maxInclusive 20 · range 6 · alternative 4 · isDefinedBy 4 ·
// equivalentProperty 2 · closeMatch 1. PLUS three the ontology DECLARES but 14.0 uses on no entity: minCount and
// maxCount (two of CEDS's own owl:AnnotationProperty declarations) and issueLink (a CEDS predicate the round-trip
// compiler already names); the round-trip fixture carries all three. maxLength is NOT here: the property extractor
// reads it itself (INTERPRETED_PREDICATES), so it never reaches the generic path.
const CEDS_DECLARED_ANNOTATION_NAME_LIST = Object.freeze([
	'alternative',
	'closeMatch',
	'comment',
	'creator',
	'decimalPlaces',
	'definition',
	'deprecated',
	'equivalentProperty',
	'isDefinedBy',
	'issueLink',
	'maxCount',
	'maxInclusive',
	'minCount',
	'minInclusive',
	'minLength',
	'prefLabel',
	'range',
]);

// the facet names CEDS writes as text but which mean a count: carried as INTEGERS, one type per name across every
// standard (graph-contract §2 INTEGER_VALUED_PROPERTY_NAME_LIST; Ed-Fi already carries them as numbers). The source
// text must be a canonical non-negative integer so String(value) reproduces it byte for byte in the round trip.
// minInclusive / maxInclusive are deliberately absent: they are bounds, not counts, and may be decimal.
const CEDS_INTEGER_ANNOTATION_NAME_LIST = Object.freeze(['decimalPlaces', 'maxCount', 'maxLength', 'minCount', 'minLength']);

const CANONICAL_INTEGER_TEXT_PATTERN = /^(0|[1-9][0-9]*)$/;

module.exports = {
	CEDS_DECLARED_ANNOTATION_NAME_LIST,
	CEDS_INTEGER_ANNOTATION_NAME_LIST,
	CANONICAL_INTEGER_TEXT_PATTERN,
};
