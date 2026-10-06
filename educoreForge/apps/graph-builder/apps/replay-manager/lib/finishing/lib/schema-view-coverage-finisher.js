'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// schema-view-coverage-finisher.js — registry member, mode 'apply', after the schema view is written (campaign P2, W-A-6 /
// V1-C20, V2-C31; ruling G15).
//
// The whereDoIStart caveat tells a bolt-only reader that the schema view is complete: a term absent from it is absent from
// the registry. Until P2 that was false for the graph's largest edge population (HAS_CEDS_*, 374,573 edges), StandardBase
// and three Dme* labels. Now it is a GATE: every label and relationship type the finished graph holds is a SchemaView member
// (kind nodeLabel / edgeType) OR matches a declared producer-local pattern (graph-contract PRODUCER_LOCAL_LABEL_PATTERN_
// SOURCE_LIST). A residue refuses the verb, naming every uncatalogued term. Nothing is written.
//
//   factory({ vocabulary }) → { apply, residueFor }
//   residueFor({ labelList, relationshipTypeList, memberValueList }) → the uncatalogued terms (pure)
//
// Async style: qtools taskListPlus/pipeRunner; callback(errString, result). No async/await, no try/catch-for-control-flow.

const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ vocabulary } = {}) => {
		const { SCHEMA_VIEW, PRODUCER_LOCAL_LABEL_PATTERN_SOURCE_LIST } = vocabulary;
		const producerLocalPatternList = PRODUCER_LOCAL_LABEL_PATTERN_SOURCE_LIST.map((oneSource) => new RegExp(oneSource));
		const COVERAGE_CENSUS_CYPHER = `
			CALL { CALL db.labels() YIELD label RETURN collect(label) AS labelList }
			CALL { CALL db.relationshipTypes() YIELD relationshipType RETURN collect(relationshipType) AS relationshipTypeList }
			CALL { MATCH (m:\`${SCHEMA_VIEW.LABEL}\`) WHERE m.kind IN ['${SCHEMA_VIEW.KINDS.NODE_LABEL}', '${SCHEMA_VIEW.KINDS.EDGE_TYPE}'] RETURN collect(m.value) AS memberValueList }
			RETURN labelList, relationshipTypeList, memberValueList`;

		const residueFor = ({ labelList, relationshipTypeList, memberValueList }) => {
			const memberValueSet = new Set(memberValueList || []);
			return (labelList || []).concat(relationshipTypeList || []).filter((oneTerm) => !memberValueSet.has(oneTerm) && !producerLocalPatternList.some((onePattern) => onePattern.test(oneTerm))).sort();
		};

		const apply = ({ runCypher } = {}, callback) => {
			if (typeof runCypher !== 'function') {
				callback(`${moduleName}: a runCypher is REQUIRED`);
				return;
			}
			const taskList = new taskListPlus();
			taskList.push((args, next) => {
				runCypher({ cypher: COVERAGE_CENSUS_CYPHER }, (err, result) => {
					const rows = (result && result.records) || [];
					if (err || rows.length !== 1) {
						next(`${moduleName}: the coverage census failed${err ? `: ${err}` : ` (${rows.length} rows)`}`);
						return;
					}
					const censusRow = { labelList: rows[0].get('labelList'), relationshipTypeList: rows[0].get('relationshipTypeList'), memberValueList: rows[0].get('memberValueList') };
					next('', { ...args, censusRow, residue: residueFor(censusRow) });
				});
			});
			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				if (args.residue.length) {
					callback(`${moduleName} REFUSED: ${args.residue.length} live label(s)/relationship type(s) are neither SchemaView members nor declared producer-local patterns — the schema view would claim a completeness it does not have: ${args.residue.join(', ')}`);
					return;
				}
				callback('', { summary: `schema view coverage: ${args.censusRow.labelList.length} label(s) and ${args.censusRow.relationshipTypeList.length} relationship type(s), every one a member or producer-local` });
			});
		};

		return { apply, residueFor, COVERAGE_CENSUS_CYPHER };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
