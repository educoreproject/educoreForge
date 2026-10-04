#!/usr/bin/env node
'use strict';

// test-passportTrustVerdict.js — the build passport's trust verdict reads a MAPPING edge by its mappingKind and the debug
// judge by its mappingSource (lane P, mappingProvenance 2026-10-04: provenanceTier is retired from mapping edges). Before
// lane P the census selected edges by provenanceTier alone; with the tier gone every mapping edge would have fallen out of
// it and every graph would have read as an island, so this reader had to move with the field. Pure.
//   (a) mapping rows (mappingKind inferred, mappingSource bridge-jev) are meaning-bearing and trustworthy
//   (b) a row whose mappingSource is the debug judge's makes the graph untrustworthy, basis invalidDebugPresent
//   (c) the census cypher selects mapping edges by mappingKind and returns mappingSource
//   (d) the writer REFUSES construction without debugMappingSource (no default: without it a debug graph reads as trustworthy)
//   (e) the meaningTierBreakdown row of a MAPPING edge is tallied by mappingKind + mappingSource and carries NO provenanceTier
//       field; a non-mapping row keeps its tier (TQ, 2026-10-04)
// RED TWINS, each observed in memory: (a) the census row ignored → island; (b) the debug test dropped; (c) the cypher back
// to tier-only; (d) the construction refusal removed.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gate: the passport trust verdict reads mappingKind and mappingSource, not provenanceTier
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;

require('../../../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');
const harness = require('../../../../../../../test/testLib/harness')(moduleName);
const vocabulary = require('../../../../../../../lib/vocabulary/vocabulary');
// the double compiles ONLY passport-writer.js with the mutation (its `new require(...)` needs a constructible require,
// which loadBuildJsDouble provides and moduleDouble does not)
const { loadBuildJsDouble } = require('../../../../../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');
const { DEBUG_MAPPING_SOURCE } = require('../../../../../../../lib/bridge-framework/certificationCheck');

const WRITER_PATH = path.join(__dirname, '..', 'passport-writer.js');
const writerFactoryFor = (mutationList) => (mutationList.length === 0 ? require(WRITER_PATH) : loadBuildJsDouble({ buildJsPath: WRITER_PATH, mutationList }));
const writerFor = (mutationList) => writerFactoryFor(mutationList)({ vocabulary, debugMappingSource: DEBUG_MAPPING_SOURCE });

const mappingRow = (mappingSource) => ({ edgeType: 'EXACT_MATCH', provenanceTier: null, mappingKind: 'inferred', mappingSource, tierCount: 5 });

const conjunctJudgeByRefId = {
	a_judgedMappingRowsTrusted: (mutationList) => {
		const verdict = writerFor(mutationList).trustVerdict([mappingRow('bridge-jev')]);
		return { pass: verdict.trustworthyForMeaning === true, detail: `${verdict.trustBasis}` };
	},
	b_debugSourceUntrusted: (mutationList) => {
		const verdict = writerFor(mutationList).trustVerdict([mappingRow('bridge-jev'), mappingRow(DEBUG_MAPPING_SOURCE)]);
		return { pass: verdict.trustworthyForMeaning === false && verdict.trustBasis === 'invalidDebugPresent', detail: `${verdict.trustBasis}` };
	},
	c_censusSelectsMappingKind: (mutationList) => {
		const cypher = writerFor(mutationList).MEANING_TIER_CENSUS_CYPHER;
		const pass = /r\.mappingKind IS NOT NULL/.test(cypher) && /r\.mappingSource AS mappingSource/.test(cypher);
		return { pass, detail: pass ? 'reads mappingKind and mappingSource' : 'the census does not read the mapping fields' };
	},
	e_mappingRowTalliedByKindAndSource: (mutationList) => {
		const rowShape = writerFor(mutationList).MEANING_ROW_SHAPE_BY_EDGE_CLASS;
		const recordOf = (fieldValueByName) => ({ get: (fieldName) => fieldValueByName[fieldName] });
		const mappingRow = rowShape.mapping(recordOf({ edgeType: 'EXACT_MATCH', mappingKind: 'inferred', mappingSource: 'bridge-jev', provenanceTier: null, tierCount: 3 }));
		const otherRow = rowShape.other(recordOf({ edgeType: 'CLASSIFICATION_CROSSWALK', provenanceTier: 'spec-authoritative', tierCount: 2 }));
		const pass = Object.keys(mappingRow).sort().join(',') === 'edgeType,mappingKind,mappingSource,tierCount' && otherRow.provenanceTier === 'spec-authoritative';
		return { pass, detail: `mapping row ${JSON.stringify(mappingRow)}` };
	},
	d_constructionRefusedWithoutDebugSource: (mutationList) => {
		let refusalText = '';
		try {
			writerFactoryFor(mutationList)({ vocabulary });
		} catch (constructionError) {
			refusalText = constructionError.message;
		}
		return { pass: /REFUSED: debugMappingSource is required/.test(refusalText), detail: refusalText ? refusalText.slice(0, 140) : 'constructed without debugMappingSource' };
	},
};

const TWIN_LIST = [
	{ conjunctRefId: 'a_judgedMappingRowsTrusted', twinName: 'censusRowIgnored', find: '\t\t\tconst meaningBearingCount = meaningTierRowList.reduce(', replace: '\t\t\tconst meaningBearingCount = [].reduce(' },
	{ conjunctRefId: 'b_debugSourceUntrusted', twinName: 'debugSourceNotTested', find: 'oneRow.mappingSource === debugMappingSource || ', replace: '' },
	{ conjunctRefId: 'c_censusSelectsMappingKind', twinName: 'censusTierOnly', find: '\t\t\tWHERE r.mappingKind IS NOT NULL\n\t\t\t   OR ', replace: '\t\t\tWHERE ' },
	{ conjunctRefId: 'e_mappingRowTalliedByKindAndSource', twinName: 'mappingRowKeepsTier', find: "\t\t\t\tmappingSource: oneRecord.get('mappingSource'),\n\t\t\t\ttierCount", replace: "\t\t\t\tmappingSource: oneRecord.get('mappingSource'),\n\t\t\t\tprovenanceTier: oneRecord.get('provenanceTier'),\n\t\t\t\ttierCount" },
	{ conjunctRefId: 'd_constructionRefusedWithoutDebugSource', twinName: 'constructionRefusalRemoved', find: "\t\tif (typeof debugMappingSource !== 'string' || !debugMappingSource) {", replace: '\t\tif (false) {' },
];

harness.section('BASELINE — the real passport writer passes every conjunct');
Object.keys(conjunctJudgeByRefId).forEach((oneRefId) => {
	const verdict = conjunctJudgeByRefId[oneRefId]([]);
	harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail);
});

harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under a writer double (in memory)');
harness.equal('every conjunct has exactly one twin', TWIN_LIST.map((oneTwin) => oneTwin.conjunctRefId).sort().join(','), Object.keys(conjunctJudgeByRefId).sort().join(','));
TWIN_LIST.forEach((oneTwin) => {
	const verdict = conjunctJudgeByRefId[oneTwin.conjunctRefId]([{ find: oneTwin.find, replace: oneTwin.replace }]);
	harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
	harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
});

harness.report();
