'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// classification.js — CLASSIFICATION_REGISTRY + the Profile §5.1 filter / count / classify (SPEC-
// bridgeFramework-v1.md §5.4; RULINGS A4, BF4, BF15; BR-032, BR-060..064). PURE over records.
//
//   makeCardListByCanonicalKey({ cardList })  the MULTIMAP — a bare assignment path is unreachable: the
//                                             index type has add() and get(); set() on an existing key is
//                                             REFUSED by name (BG-P1 c)
//   filterPoolByTuple({ keyPool, suppliedTupleFields })  every supplied tuple field must EQUAL the card's;
//                                             list fields (qualifierKeys) compared as SORTED LISTS
//   sortByStableId(list)                      the rendered pool order (RULING R2) — BEFORE any render/pick
//   CLASSIFICATION_REGISTRY                   closed, ORDERED, walked FIRST-MATCH; every value has a census
//                                             row; row 9 (unreachable) refuses by name if reached
//   classifyTarget(context)                   → { classification, reason? }

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { TUPLE_LIST_FIELD_LIST } = require('./bridgePluginContract');

const compareStrings = (leftValue, rightValue) => (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0);
const sortByStableId = (list) => list.slice().sort((leftCard, rightCard) => compareStrings(String(leftCard.stableId), String(rightCard.stableId)));

// the multimap: get() returns a LIST for every key ([] when absent); set() on an existing key is refused
const makeCardListByCanonicalKey = ({ cardList } = {}) => {
	if (!Array.isArray(cardList)) {
		throw refuse.byName({ moduleName, what: 'makeCardListByCanonicalKey needs cardList (an array)', where: 'the resolver builds the index from reader.readHubCards' });
	}
	const listByKey = {};
	let cardCount = 0;
	const add = (oneCard) => {
		if (!oneCard || typeof oneCard.canonicalKey !== 'string' || oneCard.canonicalKey.length === 0) {
			throw refuse.byName({ moduleName, what: `a card without a canonicalKey cannot be indexed (stableId ${JSON.stringify(oneCard && oneCard.stableId)})`, where: 'every HubReference card carries canonicalKey (UNIQUENESS/REQUIRED_PROPERTIES)' });
		}
		(listByKey[oneCard.canonicalKey] = listByKey[oneCard.canonicalKey] || []).push(oneCard);
		cardCount += 1;
	};
	cardList.forEach(add);
	const get = (canonicalKey) => (listByKey[canonicalKey] === undefined ? [] : listByKey[canonicalKey].slice());
	const set = ({ canonicalKey, card } = {}) => {
		if (listByKey[canonicalKey] !== undefined) {
			throw refuse.byName({ moduleName, what: `set() on existing key '${canonicalKey}' would overwrite ${listByKey[canonicalKey].length} card(s)`, where: 'the index is a MULTIMAP (BR-032 RULED): use add(); a bare assignment is unreachable' });
		}
		add(card);
	};
	const keyList = () => Object.keys(listByKey).sort();
	const distinctKeyCount = () => Object.keys(listByKey).length;
	const contendedKeyCount = () => Object.keys(listByKey).filter((oneKey) => listByKey[oneKey].length > 1).length;
	const worstContention = () => Object.keys(listByKey).reduce((soFar, oneKey) => Math.max(soFar, listByKey[oneKey].length), 0);
	const sumOfListLengths = () => Object.keys(listByKey).reduce((soFar, oneKey) => soFar + listByKey[oneKey].length, 0);
	return Object.freeze({ get, add, set, keyList, cardCount: () => cardCount, distinctKeyCount, contendedKeyCount, worstContention, sumOfListLengths });
};

const asSortedList = (value) => (Array.isArray(value) ? value.map(String).sort() : value === undefined || value === null || value === '' ? [] : [String(value)]);

// tupleFieldEquals — list fields compare as sorted lists; scalars compare as strings
const tupleFieldEquals = ({ fieldName, suppliedValue, cardValue }) =>
	TUPLE_LIST_FIELD_LIST.indexOf(fieldName) !== -1
		? JSON.stringify(asSortedList(suppliedValue)) === JSON.stringify(asSortedList(cardValue))
		: String(suppliedValue) === String(cardValue === undefined || cardValue === null ? '' : cardValue);

// filterPoolByTuple → { filteredPool, filterFieldList, mismatchByField } — mismatchByField names, per supplied
// field, how many key-pool cards it eliminated (the sourceSideMismatch record's { tupleField, suppliedValue })
const filterPoolByTuple = ({ keyPool, suppliedTupleFields } = {}) => {
	const filterFieldList = Object.keys(suppliedTupleFields).filter((oneField) => oneField !== 'canonicalKey').sort();
	const mismatchByField = {};
	const filteredPool = keyPool.filter((oneCard) =>
		filterFieldList.every((oneField) => {
			const equal = tupleFieldEquals({ fieldName: oneField, suppliedValue: suppliedTupleFields[oneField], cardValue: oneCard[oneField] });
			if (!equal) {
				mismatchByField[oneField] = (mismatchByField[oneField] || 0) + 1;
			}
			return equal;
		}),
	);
	return { filteredPool: sortByStableId(filteredPool), filterFieldList, mismatchByField };
};

// ---------------------------------------------------------------------
// CLASSIFICATION_REGISTRY — the Profile §5.1 table as ONE ordered registry (first match wins). Rows 1–3 are
// SUBJECT-level, rows 4–8 per (subject, target). `condition(context)`; context is built by the framework:
//   { subjectUnresolvable, subjectCollision, valueTier, allLabelsTentative, allLabelsPredicate, labelsMixed,
//     keyPoolSize, filteredPoolSize }
// ---------------------------------------------------------------------
const CLASSIFICATION_REGISTRY = Object.freeze([
	Object.freeze({ row: 1, classification: 'sourceGap', scope: 'subject', condition: (context) => context.subjectUnresolvable === true }),
	Object.freeze({ row: 2, classification: 'subjectCollision', scope: 'subject', condition: (context) => context.subjectCollision === true }),
	Object.freeze({ row: 3, classification: 'valueTierRefused', scope: 'target', condition: (context) => context.valueTier === true }),
	Object.freeze({ row: 4, classification: 'judged', scope: 'target', reason: 'tentative', condition: (context) => context.allLabelsTentative === true && context.filteredPoolSize >= 1 }),
	Object.freeze({ row: 5, classification: 'orphan', scope: 'target', condition: (context) => context.filteredPoolSize === 0 && context.keyPoolSize === 0 }),
	Object.freeze({ row: 6, classification: 'judged', scope: 'target', reason: 'sourceSideMismatch', condition: (context) => context.filteredPoolSize === 0 && context.keyPoolSize > 0 }),
	Object.freeze({ row: 7, classification: 'judged', scope: 'target', reason: 'many', condition: (context) => context.filteredPoolSize > 1 }),
	// row 7, second entry: labels MIXED predicate + tentative over ONE surviving card → judged over the union
	// (SPEC §5.4 BR-064 c) — the union record's predicate is the table row of the row that named the pick
	Object.freeze({ row: 7, classification: 'judged', scope: 'target', reason: 'mixedLabels', condition: (context) => context.filteredPoolSize === 1 && context.labelsMixed === true }),
	Object.freeze({ row: 8, classification: 'specified', scope: 'target', condition: (context) => context.filteredPoolSize === 1 && context.allLabelsPredicate === true }),
]);
const CLASSIFICATION_LIST = Object.freeze(['specified', 'judged', 'orphan', 'sourceGap', 'subjectCollision', 'valueTierRefused']);
const JUDGED_REASON_LIST = Object.freeze(['tentative', 'sourceSideMismatch', 'many', 'mixedLabels']);

// classifyTarget(context) → { row, classification, reason } | { error } — row 9 is unreachable; reaching it is a refusal
const classifyTarget = (context) => {
	for (let rowIndex = 0; rowIndex < CLASSIFICATION_REGISTRY.length; rowIndex++) {
		const oneRow = CLASSIFICATION_REGISTRY[rowIndex];
		if (oneRow.condition(context)) {
			return { row: oneRow.row, classification: oneRow.classification, reason: oneRow.reason === undefined ? null : oneRow.reason };
		}
	}
	// row 4 requires ≥1 card; an all-tentative target over an EMPTY filtered pool falls to rows 5/6 above.
	// Anything else is a registry hole — refused by name as a VALUE (the caller stringifies).
	return { error: refuse.byName({ moduleName, what: `no CLASSIFICATION_REGISTRY row matched context ${JSON.stringify(context)}`, where: 'row 9 is unreachable by construction (SPEC §5.4); a context that reaches it names a registry hole' }) };
};

module.exports = {
	makeCardListByCanonicalKey,
	filterPoolByTuple,
	tupleFieldEquals,
	sortByStableId,
	asSortedList,
	CLASSIFICATION_REGISTRY,
	CLASSIFICATION_LIST,
	JUDGED_REASON_LIST,
	classifyTarget,
	moduleName,
};
