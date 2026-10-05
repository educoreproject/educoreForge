#!/usr/bin/env node
'use strict';

// test-standardDefinitionDisposition.js — a StandardDefinition says what kind of mappings its standard has, and who made
// them, in the SAME vocabulary as the edges: mappingKindList / mappingSourceList, the distinct values its own match edges
// carry, read from the graph (lane P, mappingProvenance 2026-10-04; TQ). They replace mappingDisposition, which was read from
// the RELATION TYPE (any EXACT_MATCH => 'authored') and called 9 of 10 standards in GOLD_EVAL_261002_jevFresh authored while
// all 12,698 edges were Jev judgments. Pure: the finisher's shapeOne and emit, over rows a readQuery double returns.
//   (a) a standard with EXACT_MATCH edges that are all inferred/bridge-jev reports exactly those, and no mappingDisposition
//   (b) the lists are SORTED (the node is in fingerprint scope), and the hub with no match edge reports two EMPTY lists
//   (c) a mapping edge with NO mappingKind is REFUSED by name, naming the standard
//   (d) the derivation cypher collects mappingKind and mappingSource from the edges
//   (e) a card whose ROOT carries standardKind and standardUsageTips (declared by the standard's forge; lane R, 2026-10-05)
//       carries exactly those; a card whose root carries neither carries NEITHER (never invented text)
//   (f) the derivation cypher reads standardKind and standardUsageTips FROM THE ROOT (not from a side file)
//   (the declaration's own refusals — missing kind, kind outside STANDARD_KIND_LIST, empty tips — are gated in
//   lib/forge-framework/test/test-gStandardMetadata.js)
// RED TWINS, each observed: the relation-type rule restored (a red); the sort removed (b red); the refusal removed (c red);
// the cypher collecting the relation type instead (d red); a kind invented for a root without one (e red); the cypher reading
// the tips from somewhere other than the root (f red).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gate: StandardDefinition's mappingKindList / mappingSourceList come from the edges, not the relation type
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;

require('../../../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');
const harness = require('../../../../../../../test/testLib/harness')(moduleName);
const vocabulary = require('../../../../../../../lib/vocabulary/vocabulary');
const moduleDouble = require('../../../../../../../lib/forge-framework/test/testSupport/moduleDouble');

const FINISHER_PATH = path.join(__dirname, '..', 'lib', 'standard-definition-finisher.js');
const realFinisherFactory = require(FINISHER_PATH);
const finisherFor = (mutationList) => (mutationList.length === 0 ? realFinisherFactory : moduleDouble.loadWithMutations({ modulePath: FINISHER_PATH, mutationList }))({ vocabulary });

// a root row as the derivation query returns it; the counts are what the conjunct varies
const rootRow = ({ exactMappedProperties, mappingKindList, mappingSourceList, unkindedMappingEdgeCount = 0, standardKind = null, standardUsageTips = null }) => ({
	sourceKey: 'Toy',
	standardKey: 'toy',
	standardName: 'Toy',
	version: '1',
	rootStableId: 'toy:root',
	propertyCount: 10,
	classCount: 2,
	optionValueCount: 0,
	exactMappedProperties,
	closeMappedProperties: 0,
	mappingKindList,
	mappingSourceList,
	unkindedMappingEdgeCount,
	mappingEdgeTypes: exactMappedProperties > 0 ? ['EXACT_MATCH'] : [],
	standardKind,
	standardUsageTips,
});
const readQueryOver = (rowList) => (queryArguments, callback) => callback('', { records: rowList.map((oneRow) => ({ get: (fieldName) => oneRow[fieldName] })) });

const conjunctJudgeByRefId = {
	a_kindAndSourceFromEdgesNotRelation: (finisher, done) => {
		const properties = finisher.shapeOne(rootRow({ exactMappedProperties: 5, mappingKindList: ['inferred'], mappingSourceList: ['bridge-jev'] })).properties;
		const pass = JSON.stringify(properties.mappingKindList) === '["inferred"]' && JSON.stringify(properties.mappingSourceList) === '["bridge-jev"]' && properties.mappingDisposition === undefined;
		done({ pass, detail: `five EXACT_MATCH edges → kinds ${JSON.stringify(properties.mappingKindList)}, sources ${JSON.stringify(properties.mappingSourceList)}, mappingDisposition ${JSON.stringify(properties.mappingDisposition)}` });
	},
	b_sortedAndHubEmpty: (finisher, done) => {
		const mixed = finisher.shapeOne(rootRow({ exactMappedProperties: 3, mappingKindList: ['inferred', 'authored'], mappingSourceList: ['crosswalk-edfiCrosswalkPlugin', 'bridge-jev'] })).properties;
		const hub = finisher.shapeOne(rootRow({ exactMappedProperties: 0, mappingKindList: [], mappingSourceList: [] })).properties;
		const pass = JSON.stringify(mixed.mappingKindList) === '["authored","inferred"]' && JSON.stringify(mixed.mappingSourceList) === '["bridge-jev","crosswalk-edfiCrosswalkPlugin"]' && hub.mappingKindList.length === 0 && hub.mappingSourceList.length === 0;
		done({ pass, detail: `mixed ${JSON.stringify(mixed.mappingKindList)} ${JSON.stringify(mixed.mappingSourceList)}; hub ${JSON.stringify(hub.mappingKindList)}` });
	},
	c_unkindedEdgeRefusedByName: (finisher, done) => {
		finisher.emit({ readQuery: readQueryOver([rootRow({ exactMappedProperties: 2, mappingKindList: [], mappingSourceList: [], unkindedMappingEdgeCount: 2 })]) }, (emitError) => {
			const refusedByName = typeof emitError === 'string' && /REFUSED: Toy \(2\) carry mapping edges with no mappingKind/.test(emitError);
			done({ pass: refusedByName, detail: emitError ? emitError.slice(0, 160) : 'emitted without refusing' });
		});
	},
	e_tipsFromRootNeverInvented: (finisher, done) => {
		const otherRow = { ...rootRow({ exactMappedProperties: 0, mappingKindList: [], mappingSourceList: [] }), sourceKey: 'Unlisted' };
		finisher.emit({ readQuery: readQueryOver([rootRow({ exactMappedProperties: 1, mappingKindList: ['inferred'], mappingSourceList: ['bridge-jev'], standardKind: 'dataStandard', standardUsageTips: 'Toy tips.' }), otherRow]) }, (emitError, emitted) => {
			const byKey = emitError ? {} : emitted.nodes.reduce((soFar, oneNode) => ({ ...soFar, [oneNode.properties.sourceKey]: oneNode.properties }), {});
			const listed = byKey.Toy || {};
			const unlisted = byKey.Unlisted || {};
			const pass = !emitError && listed.standardKind === 'dataStandard' && listed.standardUsageTips === 'Toy tips.' && !('standardKind' in unlisted) && !('standardUsageTips' in unlisted);
			done({ pass, detail: emitError || `Toy ${listed.standardKind}/${listed.standardUsageTips}; Unlisted keys ${Object.keys(unlisted).filter((oneName) => /standard(Kind|UsageTips)/.test(oneName)).join(',') || 'none'}` });
		});
	},
	f_cypherReadsKindAndTipsFromRoot: (finisher, done) => {
		const pass = finisher.DERIVATION_CYPHER.indexOf('root.standardKind AS standardKind, root.standardUsageTips AS standardUsageTips') !== -1;
		done({ pass, detail: pass ? 'reads standardKind and standardUsageTips from the root' : 'the derivation cypher does not read them from the root' });
	},
	d_cypherCollectsKindAndSource: (finisher, done) => {
		const pass = finisher.DERIVATION_CYPHER.indexOf('collect(DISTINCT mkEdge.mappingKind) AS mappingKindList') !== -1 && finisher.DERIVATION_CYPHER.indexOf('collect(DISTINCT mkEdge.mappingSource) AS mappingSourceList') !== -1;
		done({ pass, detail: pass ? 'collects mappingKind and mappingSource from the edges' : 'the derivation cypher does not collect them' });
	},
};

const TWIN_LIST = [
	{
		conjunctRefId: 'e_tipsFromRootNeverInvented',
		twinName: 'kindInventedForUnlisted',
		find: '...(oneRow.standardKind ? { standardKind: oneRow.standardKind } : {}),',
		replace: "...(oneRow.standardKind ? { standardKind: oneRow.standardKind } : { standardKind: 'dataStandard' }),",
	},
	{
		conjunctRefId: 'f_cypherReadsKindAndTipsFromRoot',
		twinName: 'tipsNotReadFromRoot',
		find: 'root.standardKind AS standardKind, root.standardUsageTips AS standardUsageTips',
		replace: 'null AS standardKind, null AS standardUsageTips',
	},
	{
		conjunctRefId: 'a_kindAndSourceFromEdgesNotRelation',
		twinName: 'relationTypeRuleRestored',
		find: "const mappingKindList = sorted(oneRow.mappingKindList).filter((oneValue) => oneValue !== 'null');",
		replace: "const mappingKindList = Number(oneRow.exactMappedProperties || 0) > 0 ? ['authored'] : sorted(oneRow.mappingKindList).filter((oneValue) => oneValue !== 'null');",
	},
	{
		conjunctRefId: 'b_sortedAndHubEmpty',
		twinName: 'sortRemoved',
		find: "const mappingSourceList = sorted(oneRow.mappingSourceList).filter((oneValue) => oneValue !== 'null');",
		replace: "const mappingSourceList = (oneRow.mappingSourceList || []).filter((oneValue) => oneValue !== 'null');",
	},
	{ conjunctRefId: 'c_unkindedEdgeRefusedByName', twinName: 'refusalRemoved', find: '\t\t\t\tif (unkindedRowList.length > 0) {', replace: '\t\t\t\tif (false) {' },
	{
		conjunctRefId: 'd_cypherCollectsKindAndSource',
		twinName: 'cypherCollectsRelation',
		find: 'collect(DISTINCT mkEdge.mappingKind) AS mappingKindList',
		replace: 'collect(DISTINCT type(mkEdge)) AS mappingKindList',
	},
];

const runJudge = (refId, finisher, callback) => conjunctJudgeByRefId[refId](finisher, callback);
const refIdList = Object.keys(conjunctJudgeByRefId);

harness.section('BASELINE — the real finisher passes every conjunct');
let baselineIndex = 0;
const nextBaseline = () => {
	if (baselineIndex >= refIdList.length) {
		runTwins();
		return;
	}
	const refId = refIdList[baselineIndex];
	baselineIndex += 1;
	runJudge(refId, finisherFor([]), (verdict) => {
		harness.ok(`${refId} PASS`, verdict.pass, verdict.detail);
		nextBaseline();
	});
};

const runTwins = () => {
	harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under a finisher double (in memory)');
	harness.equal('every conjunct has exactly one twin', TWIN_LIST.map((oneTwin) => oneTwin.conjunctRefId).sort().join(','), refIdList.slice().sort().join(','));
	let twinIndex = 0;
	const nextTwin = () => {
		if (twinIndex >= TWIN_LIST.length) {
			harness.report();
			return;
		}
		const oneTwin = TWIN_LIST[twinIndex];
		twinIndex += 1;
		moduleDouble.assertMutationApplies({ modulePath: FINISHER_PATH, find: oneTwin.find });
		runJudge(oneTwin.conjunctRefId, finisherFor([{ modulePath: FINISHER_PATH, find: oneTwin.find, replace: oneTwin.replace }]), (verdict) => {
			harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
			harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
			nextTwin();
		});
	};
	nextTwin();
};

nextBaseline();
