'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// verdictAssembler.js — the ONE verdict assembler (SPEC-forgeFramework-v1.md §3.3 harness table;
// Profile §8.2, §8.3, §8.6; FR18): the five normative names as the REQUIRED core (`round-trip-stage.js:99-105`
// adjudicates on exactly these), verifyVerdictShape (PESC's discipline, pesc260805/roundTripValidator.js:90-115,
// generalised), the A13 identity ASSERTED — roundTripClean === (contentGapTotal === 0 && inventedTotal === 0) —
// lostTotal counting contentGap ALONE, the A8 census (wall-clock, peak memory, statement census — every count assertion
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
//
// ⟪G21 (PLAN-knownIssues G21), 2026-10-07⟫ OMISSIONS ARE DECLARED, NOT LOST. Until G21 every omitted item rode inside
// lostList beside a lostTotal that excluded it (a PESC verdict: lostTotal 0, lostList 29,339 entries), and the reader
// had to filter by lostCategory to learn that nothing was lost. Now the verdict carries TWO lists:
//   lostList               ONLY true losses (lostCategory contentGap), so lostList.length === lostTotal
//   explicitlyOmittedList  every omitted item as { statementKey, kind, rule }, so its length === explicitlyOmittedTotal
// and the declaration that licenses the omissions, explicitOmissionDeclaration = { rule, kindPropertyName, kindList,
// caveatText }: `rule` names the module that declares them (a reader goes THERE to judge the rule), `kindList` the only
// kinds it may omit (an item of any other kind is refused, never filed), `caveatText` what a reader should know about
// what those kinds can hold ('' when the declaring forge states none). The forge supplies the declaration
// (validatorFrom's omissionDeclaration); a bespoke validator builds its part with partitionLostList. A declaration
// with an empty kindList (CEDS, Ed-Fi: registries empty by ruling) admits no omission at all.

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
// ⟪G21⟫ the members of one explicitlyOmittedList entry, each a non-blank string
const OMITTED_ENTRY_MEMBER_NAME_LIST = Object.freeze(['statementKey', 'kind', 'rule']);
const isNonBlankString = (candidate) => typeof candidate === 'string' && candidate.trim().length > 0;

// omissionDeclarationError — ⟪G21⟫ '' | the named fault of a declaration { rule, kindPropertyName, kindList, caveatText }
const omissionDeclarationError = (declaration) => {
	if (!isPlainObject(declaration)) {
		return `${moduleName} REFUSED: the omission declaration is ${declaration === undefined ? 'absent' : 'not an object'} — every round trip declares the rule that licenses its omissions, even when it omits nothing (G21)`;
	}
	if (!isNonBlankString(declaration.rule)) {
		return `${moduleName} REFUSED: the omission declaration names no rule — the module that declares the omissions, where a reader goes to judge them (G21)`;
	}
	if (!isNonBlankString(declaration.kindPropertyName)) {
		return `${moduleName} REFUSED: the omission declaration (${declaration.rule}) names no kindPropertyName — the statement member that carries an omitted item's kind`;
	}
	if (!Array.isArray(declaration.kindList) || !declaration.kindList.every(isNonBlankString)) {
		return `${moduleName} REFUSED: the omission declaration (${declaration.rule}) kindList must be a list of kind names ([] when nothing may be omitted)`;
	}
	if (typeof declaration.caveatText !== 'string') {
		return `${moduleName} REFUSED: the omission declaration (${declaration.rule}) caveatText must be a string ('' when the rule states no caveat)`;
	}
	return '';
};

// partitionLostList — ⟪G21⟫ a diff's lost items → { lostList, explicitlyOmittedList } | { error }. A contentGap item stays
// in lostList as it was; an explicitlyOmitted item becomes { statementKey, kind, rule }, its kind read from
// statement[declaration.kindPropertyName] and held to declaration.kindList. An item of neither category is refused.
const partitionLostList = ({ lostList, omissionDeclaration }) => {
	const declarationError = omissionDeclarationError(omissionDeclaration);
	if (declarationError) {
		return { error: declarationError };
	}
	if (!Array.isArray(lostList)) {
		return { error: `${moduleName} REFUSED: partitionLostList needs the diff's lostList` };
	}
	const trueLostList = [];
	const explicitlyOmittedList = [];
	for (let lostIndex = 0; lostIndex < lostList.length; lostIndex++) {
		const oneLost = lostList[lostIndex];
		if (!isPlainObject(oneLost) || LOST_CATEGORY_LIST.indexOf(oneLost.lostCategory) === -1) {
			return { error: `${moduleName} REFUSED: lost item ${lostIndex} (${oneLost && oneLost.statementKey}) carries lostCategory ${JSON.stringify(oneLost && oneLost.lostCategory)}, not one of ${LOST_CATEGORY_LIST.join(', ')}` };
		}
		if (oneLost.lostCategory === LOST_CATEGORY.CONTENT_GAP) {
			trueLostList.push(oneLost);
			continue;
		}
		const kind = isPlainObject(oneLost.statement) ? oneLost.statement[omissionDeclaration.kindPropertyName] : undefined;
		if (omissionDeclaration.kindList.indexOf(kind) === -1) {
			return { error: `${moduleName} REFUSED: omitted item ${lostIndex} (${oneLost.statementKey}) has kind ${JSON.stringify(kind)} (statement.${omissionDeclaration.kindPropertyName}), which its declaration (${omissionDeclaration.rule}) does not list [${omissionDeclaration.kindList.join(', ')}] — an undeclared omission is not an omission` };
		}
		explicitlyOmittedList.push({ statementKey: oneLost.statementKey, kind, rule: omissionDeclaration.rule });
	}
	return { lostList: trueLostList, explicitlyOmittedList };
};

// the shape members beyond the five normative counts, which extraFields may not overwrite either (G21 adds the last two)
const SHAPE_MEMBER_NAME_LIST = Object.freeze(['lostList', 'inventedList', 'census', 'explicitlyOmittedList', 'explicitOmissionDeclaration']);

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

// normativeFieldShapeError — ⟪campaign P2, W-C-14⟫ the NORMATIVE half of the shape rule, which every verdict must meet
// (the RT-13 stage adjudicates every bundle on it): each normative field present, of its declared type, and finite. Split
// out of verifyVerdictShape so the stage applies exactly this half to the bespoke CEDS / Ed-Fi verdicts too, which carry
// counts but no per-item lostList or A8 census (their diffs keep a capped sample per predicate — code fact).
const normativeFieldShapeError = (verdict) => {
	if (!isPlainObject(verdict)) {
		return `${moduleName} REFUSED: verdict is not an object`;
	}
	for (let fieldIndex = 0; fieldIndex < NORMATIVE_VERDICT_FIELD_LIST.length; fieldIndex++) {
		const { fieldName, expectedType } = NORMATIVE_VERDICT_FIELD_LIST[fieldIndex];
		const value = verdict[fieldName];
		if (value === undefined) {
			return `${moduleName} REFUSED: verdict lacks normative field '${fieldName}' (Profile §8.2: the stage adjudicates on ${NORMATIVE_VERDICT_FIELD_NAME_LIST.join(', ')} and never reads through an alternative-name chain)`;
		}
		if (typeof value !== expectedType || value === null) {
			return `${moduleName} REFUSED: verdict field '${fieldName}' is ${value === null ? 'null' : `a ${typeof value}`}, expected ${expectedType}`;
		}
		if (expectedType === 'number' && !Number.isFinite(value)) {
			return `${moduleName} REFUSED: verdict field '${fieldName}' is ${String(value)} — a count must be finite`;
		}
	}
	return '';
};

// verifyVerdictShape — refuses a missing normative field, a wrong type, a NaN/Infinity count, a lost
// item without a valid lostCategory, a lostTotal that is not the contentGap count, a broken A13 identity
const verifyVerdictShape = (verdict) => {
	// the normative half first, in its own words (a null names itself as null) — ONE implementation (campaign P3, W-C-14)
	const normativeError = normativeFieldShapeError(verdict);
	if (normativeError) {
		return { error: normativeError };
	}
	if (!Array.isArray(verdict.lostList)) {
		return { error: `${moduleName} REFUSED: verdict lacks lostList — every LOST item must be listed with its lostCategory (A7/A13)` };
	}
	// ⟪G21⟫ lostList holds ONLY true losses: an omitted item belongs in explicitlyOmittedList
	for (let lostIndex = 0; lostIndex < verdict.lostList.length; lostIndex++) {
		const oneLost = verdict.lostList[lostIndex];
		if (!isPlainObject(oneLost) || oneLost.lostCategory !== LOST_CATEGORY.CONTENT_GAP) {
			return { error: `${moduleName} REFUSED: lost item ${lostIndex} (${oneLost && oneLost.statementKey}) carries lostCategory ${JSON.stringify(oneLost && oneLost.lostCategory)} — lostList holds only true losses (${LOST_CATEGORY.CONTENT_GAP}); an omitted item is declared in explicitlyOmittedList (G21)` };
		}
	}
	if (verdict.lostList.length !== verdict.lostTotal) {
		return { error: `${moduleName} REFUSED: lostList has ${verdict.lostList.length} item(s) but lostTotal is ${verdict.lostTotal} — every true loss is listed, and only true losses (G21)` };
	}
	if (verdict.contentGapTotal !== verdict.lostTotal) {
		return { error: `${moduleName} REFUSED: lostTotal ${verdict.lostTotal} !== contentGapTotal ${verdict.contentGapTotal} — lostTotal counts contentGap ALONE (Profile §8.3)` };
	}
	// ⟪G21⟫ the declared omissions: the list, its total, every entry's kind and rule, and the declaration that licenses them
	if (!Array.isArray(verdict.explicitlyOmittedList)) {
		return { error: `${moduleName} REFUSED: verdict lacks explicitlyOmittedList — every omitted item is declared with its kind and rule, an empty list when none (G21)` };
	}
	if (verdict.explicitlyOmittedList.length !== verdict.explicitlyOmittedTotal) {
		return { error: `${moduleName} REFUSED: explicitlyOmittedList has ${verdict.explicitlyOmittedList.length} item(s) but explicitlyOmittedTotal is ${verdict.explicitlyOmittedTotal} (G21)` };
	}
	const declaration = verdict.explicitOmissionDeclaration;
	const declarationError = omissionDeclarationError(declaration);
	if (declarationError) {
		return { error: `${declarationError} [verdict.explicitOmissionDeclaration]` };
	}
	for (let omittedIndex = 0; omittedIndex < verdict.explicitlyOmittedList.length; omittedIndex++) {
		const oneEntry = verdict.explicitlyOmittedList[omittedIndex];
		const missingEntryMemberName = OMITTED_ENTRY_MEMBER_NAME_LIST.find((memberName) => !isPlainObject(oneEntry) || !isNonBlankString(oneEntry[memberName]));
		if (missingEntryMemberName !== undefined) {
			return { error: `${moduleName} REFUSED: explicitly omitted item ${omittedIndex} (${oneEntry && oneEntry.statementKey}) carries no ${missingEntryMemberName} — each entry is { ${OMITTED_ENTRY_MEMBER_NAME_LIST.join(', ')} } (G21)` };
		}
		if (declaration.kindList.indexOf(oneEntry.kind) === -1) {
			return { error: `${moduleName} REFUSED: explicitly omitted item ${omittedIndex} (${oneEntry.statementKey}) has kind '${oneEntry.kind}', which its declaration (${declaration.rule}) does not list [${declaration.kindList.join(', ')}]` };
		}
		if (oneEntry.rule !== declaration.rule) {
			return { error: `${moduleName} REFUSED: explicitly omitted item ${omittedIndex} (${oneEntry.statementKey}) names rule '${oneEntry.rule}', not its verdict's declaration (${declaration.rule})` };
		}
	}
	if (verdict.roundTripClean !== (verdict.contentGapTotal === 0 && verdict.inventedTotal === 0)) {
		return { error: `${moduleName} REFUSED: A13 identity broken — roundTripClean ${verdict.roundTripClean} !== (contentGapTotal ${verdict.contentGapTotal} === 0 && inventedTotal ${verdict.inventedTotal} === 0)` };
	}
	// ⟪campaign P3, W-C-14 (ONE shape, no exceptions)⟫ the invented ITEMS too: every bundle lists what it invented, so a
	// reader of a non-zero inventedTotal has the statements, not only the count
	if (!Array.isArray(verdict.inventedList) || verdict.inventedList.length !== verdict.inventedTotal) {
		return { error: `${moduleName} REFUSED: verdict inventedList ${Array.isArray(verdict.inventedList) ? `has ${verdict.inventedList.length} item(s)` : 'is absent'} but inventedTotal is ${verdict.inventedTotal} — every INVENTED item is listed (W-C-14)` };
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
	omissionDeclaration,
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
	const partitioned = partitionLostList({ lostList: diff.lostList, omissionDeclaration });
	if (partitioned.error) {
		return { error: partitioned.error };
	}
	const contentGapTotal = partitioned.lostList.length;
	const explicitlyOmittedTotal = partitioned.explicitlyOmittedList.length;
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
	const collidingExtraName = Object.keys(extras).find((oneName) => NORMATIVE_VERDICT_FIELD_NAME_LIST.concat(SHAPE_MEMBER_NAME_LIST).indexOf(oneName) !== -1);
	if (collidingExtraName !== undefined) {
		return { error: `${moduleName} REFUSED: extraFields may not overwrite the verdict's own field '${collidingExtraName}'` };
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
		lostList: partitioned.lostList,
		explicitlyOmittedList: partitioned.explicitlyOmittedList,
		explicitOmissionDeclaration: omissionDeclaration,
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

// omittedCountByKindListOf — ⟪G21⟫ a conforming verdict → [{ kind, count, rule }], largest count first (kind name breaks a
// tie), one row per (rule, kind) the explicitlyOmittedList holds
const omittedCountByKindListOf = (verdict) => {
	const rowByRuleAndKind = new Map();
	verdict.explicitlyOmittedList.forEach((oneEntry) => {
		const rowIdentity = `${oneEntry.rule}\u001f${oneEntry.kind}`;
		const row = rowByRuleAndKind.get(rowIdentity) || { kind: oneEntry.kind, count: 0, rule: oneEntry.rule };
		row.count++;
		rowByRuleAndKind.set(rowIdentity, row);
	});
	return [...rowByRuleAndKind.values()].sort((leftRow, rightRow) => rightRow.count - leftRow.count || (leftRow.kind < rightRow.kind ? -1 : leftRow.kind > rightRow.kind ? 1 : 0));
};

// omissionDeclarationTextFor — ⟪G21⟫ one standard's omission declaration in words, for the stage summary and the in-graph
// certificate: '<token>: whitespace 28,428, comment 907, processingInstruction 4 (rule: <rule>); <caveat>', or
// '<token>: nothing omitted (rule: <rule>)' when the declaration admitted nothing. Counts are grouped by rule.
const omissionDeclarationTextFor = ({ token, verdict }) => {
	const countByKindList = omittedCountByKindListOf(verdict);
	const declaration = verdict.explicitOmissionDeclaration;
	const ruleList = countByKindList.length === 0 ? [declaration.rule] : [...new Set(countByKindList.map((oneRow) => oneRow.rule))];
	const ruleSegmentList = ruleList.map((oneRule) => {
		const kindTextList = countByKindList.filter((oneRow) => oneRow.rule === oneRule).map((oneRow) => `${oneRow.kind} ${oneRow.count.toLocaleString('en-US')}`);
		return `${kindTextList.length === 0 ? 'nothing omitted' : kindTextList.join(', ')} (rule: ${oneRule})`;
	});
	return `${token}: ${ruleSegmentList.join('; ')}${declaration.caveatText ? `; ${declaration.caveatText}` : ''}`;
};

module.exports = {
	assembleVerdict,
	partitionLostList,
	omissionDeclarationError,
	omittedCountByKindListOf,
	omissionDeclarationTextFor,
	OMITTED_ENTRY_MEMBER_NAME_LIST,
	verifyVerdictShape,
	normativeFieldShapeError,
	diffStatementMaps,
	NORMATIVE_VERDICT_FIELD_LIST,
	NORMATIVE_VERDICT_FIELD_NAME_LIST,
	LOST_CATEGORY,
	LOST_CATEGORY_LIST,
	moduleName,
};
