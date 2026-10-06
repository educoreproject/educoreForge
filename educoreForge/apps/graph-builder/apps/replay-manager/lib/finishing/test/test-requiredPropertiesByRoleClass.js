#!/usr/bin/env node
'use strict';

// test-requiredPropertiesByRoleClass.js — gate for W-A-10 (V1-C26; campaign P2): REQUIRED_PROPERTIES.NODE is restated per
// role class (NODE_BY_ROLE_CLASS), projected into the schema view one member per class, and enforced over the finished
// graph by required-property-finisher (the forge-time half is G-KIT postMintSearchTextEmptied, re-anchored).
//
// PROVES:
//   (a) the declaration: NODE is gone; NODE_BY_ROLE_CLASS holds exactly embeddable, nonEmbeddable, embedText, hubReference,
//       hubDefinition; embeddable requires searchText and nonEmbeddable does not; name is only RECOMMENDED
//   (b) the schema view carries requiredPropertySet:NODE_<class> for every class, each with its list and a definition
//   (c) the finisher refuses when a class census answers a violation, naming the class, the missing name and the sample
//   (d) the finisher passes when every census answers 0, and issues one census per class
// RED TWINS (in memory): violationIgnored (finisher) -> (c); classMemberDropped (schema-view: the class loop skipped) -> (b);
// predicateTableShort (finisher: one class unrecognised) -> construction refused, observed as (d) red.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: required properties declared per role class and enforced over the finished graph
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../../../../../test/testLib/harness')(moduleName);

const path = require('path');
const vocabulary = require('../../../../../../../lib/vocabulary/vocabulary');
const { loadBuildJsDouble } = require('../../../../../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');

const FINISHER_PATH = path.join(__dirname, '..', 'lib', 'required-property-finisher.js');
const VIEW_PATH = path.join(__dirname, '..', 'lib', 'schema-view-finisher.js');
const doubleOrReal = (modulePath, mutationList) => (mutationList.length === 0 ? require(modulePath) : loadBuildJsDouble({ buildJsPath: modulePath, mutationList }));
const CLASS_LIST = ['embeddable', 'nonEmbeddable', 'embedText', 'hubReference', 'hubDefinition'];

const runFinisher = ({ mutationList, violatingClassName }, done) => {
	let finisher;
	try {
		finisher = doubleOrReal(FINISHER_PATH, mutationList)({ vocabulary });
	} catch (constructionError) {
		done({ err: `construction: ${constructionError.message}`, statementList: [] });
		return;
	}
	const statementList = [];
	const runCypher = ({ cypher }, callback) => {
		statementList.push(cypher);
		const isViolating = violatingClassName && cypher.indexOf(finisher.ROLE_CLASS_PREDICATE_BY_CLASS[violatingClassName]) !== -1;
		const fieldValueByName = isViolating ? { violationCount: 2, sampleList: ['toy:a', 'toy:b'], missingNameList: ['searchText'] } : { violationCount: 0, sampleList: [], missingNameList: [] };
		callback('', { records: [{ get: (fieldName) => fieldValueByName[fieldName] }] });
	};
	finisher.apply({ runCypher }, (err, result) => done({ err: err || '', result, statementList }));
};

const conjunctJudgeByRefId = {
	a_declaredPerRoleClass: (mutationList, done) => {
		const required = vocabulary.REQUIRED_PROPERTIES;
		const pass = required.NODE === undefined && Object.keys(required.NODE_BY_ROLE_CLASS).sort().join(',') === CLASS_LIST.slice().sort().join(',') &&
			required.NODE_BY_ROLE_CLASS.embeddable.indexOf('searchText') !== -1 && required.NODE_BY_ROLE_CLASS.nonEmbeddable.indexOf('searchText') === -1 &&
			CLASS_LIST.every((oneClassName) => required.NODE_BY_ROLE_CLASS[oneClassName].indexOf('name') === -1) && required.NODE_RECOMMENDED.join(',') === 'name';
		done({ pass, detail: JSON.stringify(Object.keys(required.NODE_BY_ROLE_CLASS)) });
	},
	b_schemaViewMemberPerClass: (mutationList, done) => {
		const { members, missingDefinitions } = doubleOrReal(VIEW_PATH, mutationList)({ vocabulary }).buildMembers();
		const lackingList = CLASS_LIST.filter((oneClassName) => {
			const member = members.find((oneMember) => oneMember.stableId.endsWith(`requiredPropertySet:NODE_${oneClassName}`));
			return !member || JSON.stringify(member.properties) !== JSON.stringify(vocabulary.REQUIRED_PROPERTIES.NODE_BY_ROLE_CLASS[oneClassName]) || !member.description;
		});
		done({ pass: lackingList.length === 0 && missingDefinitions.length === 0, detail: `lacking [${lackingList.join(', ')}]; missing definitions [${missingDefinitions.join(', ')}]` });
	},
	c_violationRefusedByClass: (mutationList, done) =>
		runFinisher({ mutationList, violatingClassName: 'embeddable' }, ({ err }) =>
			done({ pass: /REFUSED: .*embeddable: 2 node\(s\) lack searchText \(e\.g\. toy:a, toy:b\)/.test(err), detail: err || 'no refusal' })),
	d_cleanGraphPassesOneCensusPerClass: (mutationList, done) =>
		runFinisher({ mutationList }, ({ err, statementList }) => done({ pass: !err && statementList.length === CLASS_LIST.length, detail: err || `${statementList.length} census statement(s)` })),
};
const TWIN_LIST = [
	{ conjunctRefId: 'c_violationRefusedByClass', twinName: 'violationIgnored', find: '						if (violationCount > 0) {', replace: '						if (false) {' },
	{ conjunctRefId: 'b_schemaViewMemberPerClass', twinName: 'classMemberDropped', find: "			Object.keys(REQUIRED_PROPERTIES.NODE_BY_ROLE_CLASS).forEach((oneClassName) =>", replace: "			[].forEach((oneClassName) =>" },
	{ conjunctRefId: 'd_cleanGraphPassesOneCensusPerClass', twinName: 'predicateTableShort', find: "			hubDefinition: 'n:`HubDefinition`',\n", replace: '' },
];

const refIdList = Object.keys(conjunctJudgeByRefId);
const runSequence = (stepList, whenDone) => {
	const nextStep = (stepIndex) => (stepIndex >= stepList.length ? whenDone() : stepList[stepIndex](() => nextStep(stepIndex + 1)));
	nextStep(0);
};
harness.section('BASELINE — the real declaration and modules pass every conjunct');
runSequence(
	refIdList.map((oneRefId) => (stepDone) => conjunctJudgeByRefId[oneRefId]([], (verdict) => { harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail); stepDone(); })),
	() => {
		harness.section('THE TWIN SWEEP — each twin OBSERVED RED under a module double (in memory)');
		runSequence(
			TWIN_LIST.map((oneTwin) => (stepDone) =>
				conjunctJudgeByRefId[oneTwin.conjunctRefId]([{ find: oneTwin.find, replace: oneTwin.replace }], (verdict) => {
					harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
					harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
					stepDone();
				})),
			() => harness.report(),
		);
	},
);
