'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// verdictAssembler.js — the ONE verdict assembler (SPEC-forgeFramework-v1.md §3.3 harness table;
// Profile §8.2, §8.3, §8.6; FR18): the five normative names as the REQUIRED core (`round-trip-stage.js:99-105`
// adjudicates on exactly these), verifyVerdictShape (PESC's discipline, pesc260805/roundTripValidator.js:90-115,
// generalised), the A13 identity ASSERTED — roundTripClean === (contentGapTotal === 0 && inventedTotal === 0) —
// every LOST item labelled with a lostCategory of explicitlyOmitted | contentGap and lostTotal counting
// contentGap ALONE, the A8 census (wall-clock, peak memory, statement census — every count assertion
// naming the two quantities it compares), and forge-declared extra fields allowed.
//
// The DIFF here is the harness's default comparator — a set difference over the two statement Maps
// (Map<statementKey, statement>): invented = in the graph, not in the source; lost = in the source,
// not in the graph. A source statement whose value carries `explicitlyOmitted: true` (the limit says
// this dimension is deliberately not modelled on the graph side) is a lost item of category
// explicitlyOmitted; every other lost item is a contentGap. A forge whose existing diff engine models
// more (the four cousins, R2 — deferred) hands `diffStatements` to validatorFrom and the assembler
// takes its { inventedList, lostList } instead (D8: per-forge diffs run BEHIND the contract).
//
// PURE and synchronous: assemble → { verdict } or { error }; the harness writes the file.

const NORMATIVE_VERDICT_FIELD_LIST = Object.freeze([
	Object.freeze({ fieldName: 'roundTripClean', expectedType: 'boolean' }),
	Object.freeze({ fieldName: 'inventedTotal', expectedType: 'number' }),
	Object.freeze({ fieldName: 'lostTotal', expectedType: 'number' }),
	Object.freeze({ fieldName: 'contentGapTotal', expectedType: 'number' }),
	Object.freeze({ fieldName: 'explicitlyOmittedTotal', expectedType: 'number' }),
]);
const NORMATIVE_VERDICT_FIELD_NAME_LIST = Object.freeze(NORMATIVE_VERDICT_FIELD_LIST.map((oneField) => oneField.fieldName));
const LOST_CATEGORY = Object.freeze({ EXPLICITLY_OMITTED: 'explicitlyOmitted', CONTENT_GAP: 'contentGap' });
const LOST_CATEGORY_LIST = Object.freeze(Object.values(LOST_CATEGORY));

const isPlainObject = (candidate) =>
	candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);

// diffStatementMaps — the default comparator
const diffStatementMaps = ({ sourceStatements, graphStatements }) => {
	const inventedList = [];
	const lostList = [];
	graphStatements.forEach((oneStatement, oneStatementKey) => {
		if (!sourceStatements.has(oneStatementKey)) {
			inventedList.push({ statementKey: oneStatementKey, statement: oneStatement });
		}
	});
	sourceStatements.forEach((oneStatement, oneStatementKey) => {
		if (!graphStatements.has(oneStatementKey)) {
			lostList.push({
				statementKey: oneStatementKey,
				statement: oneStatement,
				lostCategory: isPlainObject(oneStatement) && oneStatement.explicitlyOmitted === true ? LOST_CATEGORY.EXPLICITLY_OMITTED : LOST_CATEGORY.CONTENT_GAP,
			});
		}
	});
	return { inventedList, lostList, matchedCount: sourceStatements.size - lostList.length };
};

// verifyVerdictShape — refuses a missing normative field, a wrong type, a NaN/Infinity count, a lost
// item without a valid lostCategory, a lostTotal that is not the contentGap count, a broken A13 identity
const verifyVerdictShape = (verdict) => {
	if (!isPlainObject(verdict)) {
		return { error: `${moduleName} REFUSED: verdict is not an object` };
	}
	for (let fieldIndex = 0; fieldIndex < NORMATIVE_VERDICT_FIELD_LIST.length; fieldIndex++) {
		const { fieldName, expectedType } = NORMATIVE_VERDICT_FIELD_LIST[fieldIndex];
		const value = verdict[fieldName];
		if (value === undefined) {
			return { error: `${moduleName} REFUSED: verdict lacks normative field '${fieldName}' (Profile §8.2: the stage adjudicates on ${NORMATIVE_VERDICT_FIELD_NAME_LIST.join(', ')} and never reads through an alternative-name chain)` };
		}
		if (typeof value !== expectedType) {
			return { error: `${moduleName} REFUSED: verdict field '${fieldName}' is a ${typeof value}, expected ${expectedType}` };
		}
		if (expectedType === 'number' && !Number.isFinite(value)) {
			return { error: `${moduleName} REFUSED: verdict field '${fieldName}' is ${String(value)} — a count must be finite` };
		}
	}
	if (!Array.isArray(verdict.lostList)) {
		return { error: `${moduleName} REFUSED: verdict lacks lostList — every LOST item must be listed with its lostCategory (A7/A13)` };
	}
	for (let lostIndex = 0; lostIndex < verdict.lostList.length; lostIndex++) {
		const oneLost = verdict.lostList[lostIndex];
		if (!isPlainObject(oneLost) || LOST_CATEGORY_LIST.indexOf(oneLost.lostCategory) === -1) {
			return { error: `${moduleName} REFUSED: lost item ${lostIndex} (${oneLost && oneLost.statementKey}) carries lostCategory ${JSON.stringify(oneLost && oneLost.lostCategory)}, not one of ${LOST_CATEGORY_LIST.join(', ')}` };
		}
	}
	const contentGapCount = verdict.lostList.filter((oneLost) => oneLost.lostCategory === LOST_CATEGORY.CONTENT_GAP).length;
	const explicitlyOmittedCount = verdict.lostList.length - contentGapCount;
	if (verdict.contentGapTotal !== contentGapCount) {
		return { error: `${moduleName} REFUSED: contentGapTotal ${verdict.contentGapTotal} !== the contentGap count of lostList (${contentGapCount})` };
	}
	if (verdict.explicitlyOmittedTotal !== explicitlyOmittedCount) {
		return { error: `${moduleName} REFUSED: explicitlyOmittedTotal ${verdict.explicitlyOmittedTotal} !== the explicitlyOmitted count of lostList (${explicitlyOmittedCount})` };
	}
	if (verdict.lostTotal !== contentGapCount) {
		return { error: `${moduleName} REFUSED: lostTotal ${verdict.lostTotal} !== contentGapTotal ${contentGapCount} — lostTotal counts contentGap ALONE (Profile §8.3)` };
	}
	if (verdict.roundTripClean !== (verdict.contentGapTotal === 0 && verdict.inventedTotal === 0)) {
		return { error: `${moduleName} REFUSED: A13 identity broken — roundTripClean ${verdict.roundTripClean} !== (contentGapTotal ${verdict.contentGapTotal} === 0 && inventedTotal ${verdict.inventedTotal} === 0)` };
	}
	if (typeof verdict.semanticValidationLimit !== 'string' || verdict.semanticValidationLimit.trim().length === 0) {
		return { error: `${moduleName} REFUSED: verdict lacks a non-blank semanticValidationLimit (Profile §8.4: MUST for every forge)` };
	}
	if (!isPlainObject(verdict.census) || typeof verdict.census.wallClockMs !== 'number' || typeof verdict.census.peakMemoryBytes !== 'number' || !isPlainObject(verdict.census.statementCensus)) {
		return { error: `${moduleName} REFUSED: verdict lacks the A8 census { wallClockMs, peakMemoryBytes, statementCensus }` };
	}
	return { error: '' };
};

// assembleVerdict — { verdict } | { error }
const assembleVerdict = ({
	verdictVersion,
	semanticValidationLimit,
	sourceStatements,
	graphStatements,
	diffResult,
	wallClockMs,
	peakMemoryBytes,
	sourceStats,
	graphStats,
	extraFields,
	extraVerdictFieldList,
} = {}) => {
	if (typeof verdictVersion !== 'string' || verdictVersion.length === 0) {
		return { error: `${moduleName} REFUSED: verdictVersion is required (R9)` };
	}
	if (typeof semanticValidationLimit !== 'string' || semanticValidationLimit.trim().length === 0) {
		return { error: `${moduleName} REFUSED: semanticValidationLimit is blank or absent — a validator MUST state what the round trip models (Profile §8.4)` };
	}
	if (!(sourceStatements instanceof Map) || !(graphStatements instanceof Map)) {
		return { error: `${moduleName} REFUSED: sourceStatements and graphStatements must both be Map<statementKey, statement>` };
	}
	if (typeof wallClockMs !== 'number' || !Number.isFinite(wallClockMs) || typeof peakMemoryBytes !== 'number' || !Number.isFinite(peakMemoryBytes)) {
		return { error: `${moduleName} REFUSED: the A8 census needs finite wallClockMs and peakMemoryBytes` };
	}
	const diff = diffResult === undefined ? diffStatementMaps({ sourceStatements, graphStatements }) : diffResult;
	if (!isPlainObject(diff) || !Array.isArray(diff.inventedList) || !Array.isArray(diff.lostList)) {
		return { error: `${moduleName} REFUSED: diffResult must carry inventedList[] and lostList[]` };
	}
	const contentGapTotal = diff.lostList.filter((oneLost) => oneLost.lostCategory === LOST_CATEGORY.CONTENT_GAP).length;
	const explicitlyOmittedTotal = diff.lostList.filter((oneLost) => oneLost.lostCategory === LOST_CATEGORY.EXPLICITLY_OMITTED).length;
	const inventedTotal = diff.inventedList.length;
	const extras = isPlainObject(extraFields) ? extraFields : {};
	if (Array.isArray(extraVerdictFieldList)) {
		for (let extraIndex = 0; extraIndex < extraVerdictFieldList.length; extraIndex++) {
			const oneExtra = extraVerdictFieldList[extraIndex];
			if (extras[oneExtra.fieldName] === undefined || typeof extras[oneExtra.fieldName] !== oneExtra.expectedType) {
				return { error: `${moduleName} REFUSED: declared extra verdict field '${oneExtra.fieldName}' (${oneExtra.expectedType}) is missing or mistyped in extraFields` };
			}
		}
	}
	const collidingExtraName = Object.keys(extras).find((oneName) => NORMATIVE_VERDICT_FIELD_NAME_LIST.indexOf(oneName) !== -1);
	if (collidingExtraName !== undefined) {
		return { error: `${moduleName} REFUSED: extraFields may not overwrite normative field '${collidingExtraName}'` };
	}
	const verdict = {
		verdictVersion,
		roundTripClean: contentGapTotal === 0 && inventedTotal === 0,
		inventedTotal,
		lostTotal: contentGapTotal,
		contentGapTotal,
		explicitlyOmittedTotal,
		semanticValidationLimit,
		inventedList: diff.inventedList,
		lostList: diff.lostList,
		census: {
			wallClockMs,
			peakMemoryBytes,
			statementCensus: {
				sourceStatementCount: sourceStatements.size,
				graphStatementCount: graphStatements.size,
				matchedCount: typeof diff.matchedCount === 'number' ? diff.matchedCount : sourceStatements.size - diff.lostList.length,
				comparisonBasis: 'source statement set (canonicalizeSource) vs graph statement set (emitFromGraph), keyed by statementKey; invented = graph − source; lost = source − graph',
			},
			sourceStats: sourceStats === undefined ? {} : sourceStats,
			graphStats: graphStats === undefined ? {} : graphStats,
		},
		...extras,
	};
	const shape = verifyVerdictShape(verdict);
	if (shape.error) {
		return { error: shape.error };
	}
	return { verdict };
};

module.exports = {
	assembleVerdict,
	verifyVerdictShape,
	diffStatementMaps,
	NORMATIVE_VERDICT_FIELD_LIST,
	NORMATIVE_VERDICT_FIELD_NAME_LIST,
	LOST_CATEGORY,
	LOST_CATEGORY_LIST,
	moduleName,
};
