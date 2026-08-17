'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// predicateSource.js — the closed predicateSource kinds and their application (SPEC-bridgeFramework-v1.md
// §5.6.0, §5.2 step 6; RULINGS P4, P5, BF5, R9; BR-012, BR-019, BR-044, BR-046). PURE.
//   column | labelTable  → the row's label in `column` looked up in `table` (a DATA-declared row per label);
//                          predicateAssertedBy 'source' (the column asserts a relation) / 'labelTable' (the
//                          plugin's table reads the source's confidence label)
//   channelAssertion     → the ONE declared predicate for every row; predicateAssertedBy 'channelAssertion'
// The judge is NEVER a source of predicate (v1). A label with no table row, or a sentinelOnly label on a
// real-target row, refuses the RUN (labelCensus); a `refused`-disposition row is refused BY ROW and counted.

const path = require('path');
const { PREDICATE_ASSERTED_BY_BY_SOURCE_KIND } = require('./bridgePluginContract');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

// labelRowFor({ predicateSource, assertion }) → the table row applied to this assertion:
//   { disposition: 'predicate', predicate, predicateAssertedBy, sourceLabel }
//   { disposition: 'tentative', predicateIfPicked, predicateAssertedBy, sourceLabel }
//   { disposition: 'refused', reason, sourceLabel } | { disposition: 'sentinelOnly', sourceLabel }
//   { disposition: 'unmapped', sourceLabel }   — no table row (blank included)
// PREDICATE_SOURCE_KIND_REGISTRY — one row per kind (SPEC §4.1 predicateSource): how a row's label is read and what the
// kind exports as set-level provenance. A registry, never a branch on predicateSource.kind (BG-COMPOSE c).
const tableRowFor = ({ predicateSource, assertion }) => {
	const rawLabel = assertion.sourceLabelByColumn === undefined ? undefined : assertion.sourceLabelByColumn[predicateSource.column];
	const sourceLabel = rawLabel === undefined || rawLabel === null ? '' : String(rawLabel);
	return { sourceLabel, tableRow: Object.prototype.hasOwnProperty.call(predicateSource.table, sourceLabel) ? predicateSource.table[sourceLabel] : undefined };
};
const PREDICATE_SOURCE_KIND_REGISTRY = Object.freeze({
	column: Object.freeze({ readsTable: true, rowFor: tableRowFor, provenanceOf: (predicateSource) => predicateSource.table, provenanceSlotName: 'labelTableProvenance' }),
	labelTable: Object.freeze({ readsTable: true, rowFor: tableRowFor, provenanceOf: (predicateSource) => predicateSource.table, provenanceSlotName: 'labelTableProvenance' }),
	channelAssertion: Object.freeze({ readsTable: false, rowFor: () => null, provenanceOf: (predicateSource) => predicateSource, provenanceSlotName: 'channelAssertionProvenance' }),
	// judge — the relation comes from the JUDGE, through the plugin's declared predicateByCategory table
	// (RULING §11.7 (a)). readsTable is FALSE in this registry's sense: there is no per-ROW label to look up,
	// because a derived subject has no source row. The set-level provenance it exports is the RULE ITSELF —
	// the category→predicate table plus the name of the rule — so a reader of the SSSOM can see exactly what
	// turned a confidence category into a relation, and see that it was an approximation.
	judge: Object.freeze({
		readsTable: false,
		rowFor: () => null,
		provenanceOf: (predicateSource) => predicateSource,
		provenanceSlotName: 'predicateRuleProvenance',
	}),
});

const labelRowFor = ({ predicateSource, assertion } = {}) => {
	const predicateAssertedBy = PREDICATE_ASSERTED_BY_BY_SOURCE_KIND[predicateSource.kind];
	const kindRow = PREDICATE_SOURCE_KIND_REGISTRY[predicateSource.kind];
	if (!kindRow.readsTable) {
		// channelAssertion names ONE predicate for every row. The judge kind names none here BY DESIGN — its
		// relation is resolved after the judgment, from the category, in the framework's pick-predicate
		// resolver — so it yields a null predicate rather than a wrong one.
		return { disposition: 'predicate', predicate: predicateSource.predicate === undefined ? null : predicateSource.predicate, predicateAssertedBy, sourceLabel: null };
	}
	const rawLabel = assertion.sourceLabelByColumn === undefined ? undefined : assertion.sourceLabelByColumn[predicateSource.column];
	const sourceLabel = rawLabel === undefined || rawLabel === null ? '' : String(rawLabel);
	const tableRow = Object.prototype.hasOwnProperty.call(predicateSource.table, sourceLabel) ? predicateSource.table[sourceLabel] : undefined;
	if (tableRow === undefined) {
		return { disposition: 'unmapped', sourceLabel };
	}
	if (tableRow.disposition === 'predicate') {
		return { disposition: 'predicate', predicate: tableRow.predicate, predicateAssertedBy, sourceLabel };
	}
	if (tableRow.disposition === 'tentative') {
		return { disposition: 'tentative', predicateIfPicked: tableRow.predicateIfPicked, predicateAssertedBy, sourceLabel };
	}
	if (tableRow.disposition === 'refused') {
		return { disposition: 'refused', reason: tableRow.reason, sourceLabel };
	}
	return { disposition: 'sentinelOnly', sourceLabel };
};

// labelCensus({ predicateSource, assertionList, isSentinelAssertion, subjectKeyFor }) → { error } |
//   { sentinelLabelledRowCount, labelRefusedCount, labelCountByLabel, refusedRowIndexSet }
// SCOPED to non-sentinel rows (RULING BF5): a label with no row (blank included) or a sentinelOnly label on a
// real-target row refuses the RUN by name with the count and three sample subjects; sentinel rows carrying a
// non-sentinelOnly label are COUNTED (sentinelLabelledRowCount) and never judged.
const labelCensus = ({ predicateSource, assertionList, isSentinelAssertion, subjectKeyFor } = {}) => {
	const labelCountByLabel = {};
	const unmappedSubjectsByLabel = {};
	const sentinelOnlyOnRealTargetSubjectsByLabel = {};
	const refusedRowIndexSet = new Set();
	let sentinelLabelledRowCount = 0;
	let labelRefusedCount = 0;
	assertionList.forEach((oneAssertion, assertionIndex) => {
		const labelRow = labelRowFor({ predicateSource, assertion: oneAssertion });
		const sourceLabel = labelRow.sourceLabel === null ? '(channelAssertion)' : labelRow.sourceLabel;
		labelCountByLabel[sourceLabel] = (labelCountByLabel[sourceLabel] || 0) + 1;
		if (isSentinelAssertion(oneAssertion)) {
			if (labelRow.disposition !== 'sentinelOnly') {
				sentinelLabelledRowCount += 1;
			}
			return;
		}
		if (labelRow.disposition === 'unmapped') {
			(unmappedSubjectsByLabel[sourceLabel] = unmappedSubjectsByLabel[sourceLabel] || []).push(subjectKeyFor(oneAssertion));
			return;
		}
		if (labelRow.disposition === 'sentinelOnly') {
			(sentinelOnlyOnRealTargetSubjectsByLabel[sourceLabel] = sentinelOnlyOnRealTargetSubjectsByLabel[sourceLabel] || []).push(subjectKeyFor(oneAssertion));
			return;
		}
		if (labelRow.disposition === 'refused') {
			labelRefusedCount += 1;
			refusedRowIndexSet.add(assertionIndex);
		}
	});
	const firstUnmapped = Object.keys(unmappedSubjectsByLabel)[0];
	if (firstUnmapped !== undefined) {
		const subjectList = unmappedSubjectsByLabel[firstUnmapped];
		return {
			error: refuse.byName({
				moduleName,
				what: `label ${JSON.stringify(firstUnmapped)} in column '${predicateSource.column}' (${subjectList.length} row${subjectList.length === 1 ? '' : 's'}; sample subjects: ${subjectList.slice(0, 3).join(' | ')}) has no entry in the table`,
				where: 'add the row or refuse the label explicitly (BR-046, RULING P4); a table that has quietly stopped covering its source must not stay green',
			}),
		};
	}
	const firstSentinelOnly = Object.keys(sentinelOnlyOnRealTargetSubjectsByLabel)[0];
	if (firstSentinelOnly !== undefined) {
		const subjectList = sentinelOnlyOnRealTargetSubjectsByLabel[firstSentinelOnly];
		return {
			error: refuse.byName({
				moduleName,
				what: `sentinelOnly label ${JSON.stringify(firstSentinelOnly)} appears on ${subjectList.length} REAL-target row${subjectList.length === 1 ? '' : 's'} (sample subjects: ${subjectList.slice(0, 3).join(' | ')})`,
				where: 'a sentinelOnly label is lawful only on a row whose target is the channel sentinel (RULING BF5)',
			}),
		};
	}
	return { sentinelLabelledRowCount, labelRefusedCount, labelCountByLabel, refusedRowIndexSet };
};

module.exports = { labelRowFor, labelCensus, PREDICATE_SOURCE_KIND_REGISTRY, moduleName };
