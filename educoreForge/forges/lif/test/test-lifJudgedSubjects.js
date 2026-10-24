#!/usr/bin/env node
'use strict';

// test-lifJudgedSubjects.js — the LIF judged facet's scope (nextStandards-102326 C2), Docker-free: the committed lifJudgedSubjects.json is
// EXACTLY lifJudgedSubjectRule's output over the forged snapshot (so it cannot drift from the hubs' scans), it leaves out exactly the six
// properties whose own description cites a CEDS element id (README_ERRATA E8), the bridging declaration points at it, and the rule is
// observed RED: a subject whose text carries a hub identifier is excluded, one without is kept.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the LIF judged facet's scope: derived from the hubs' identifier scans, the six E8 subjects out (no Docker)

SYNOPSIS
     node forges/lif/test/${moduleName}.js [-verbose] [-help]

EXIT STATUS
     0 every assertion passed;  1 otherwise.
`;

const fs = require('fs');
const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const harness = require(path.join(TREE_ROOT, 'test', 'testLib', 'harness'))(moduleName);

const BUNDLE_DIR_PATH = path.join(__dirname, '..');
const { judgedSubjectsOf } = require(path.join(BUNDLE_DIR_PATH, 'bridgeData', 'lifJudgedSubjectRule'));
const { standardBridging } = require(path.join(BUNDLE_DIR_PATH, 'bridges', 'lifBridging'));
const bundle = require(path.join(BUNDLE_DIR_PATH, 'forgeLif'))({ embedder: null });
const committedStableIdList = JSON.parse(fs.readFileSync(path.join(BUNDLE_DIR_PATH, 'bridges', 'lifJudgedSubjects.json'), 'utf8'));

// the six properties LIF's own descriptions tie to a CEDS element (README_ERRATA E8), with the id each cites
const EXPECTED_EXCLUDED_TEXT_LIST = Object.freeze([
	'lif:Assessment/subject ceds 000021',
	'lif:Credential/level ceds 001301',
	'lif:Person/EmploymentLearningExperience/inline/employedAfterExit ceds 000988',
	'lif:Person/EmploymentLearningExperience/inline/employedPriorToEnrollment ceds 001342',
	'lif:Person/EmploymentLearningExperience/inline/militaryEnlistmentAfterExit ceds 001412',
	'lif:Position/JobCode/inline/jobCodeValue ceds 000731',
]);

bundle.forge({ sourcePath: path.join(BUNDLE_DIR_PATH, 'assets', 'standardSourceData', '02', 'lif-schema.json'), owner: 'test', skipEmbedding: true }, (forgeError, forged) => {
	harness.section('SECTION 1 — the committed scope is the rule\'s output');
	harness.accepts('the snapshot forges', forgeError ? [forgeError] : []);
	if (forgeError) {
		harness.report();
		return;
	}
	const { judgedStableIdList, excludedList } = judgedSubjectsOf({ nodeList: forged.nodes });
	harness.equal('lifJudgedSubjects.json equals the rule over the forged snapshot (1,387 ids, sorted)', JSON.stringify(committedStableIdList), JSON.stringify(judgedStableIdList));
	harness.equal('the rule leaves out exactly the six E8 properties, each for the CEDS id its description cites', excludedList.map((oneExcluded) => `${oneExcluded.stableId} ${oneExcluded.hubToken} ${oneExcluded.matchedText}`).sort().join('\n'), EXPECTED_EXCLUDED_TEXT_LIST.join('\n'));
	harness.equal('the judged facet reads this file as its scope', standardBridging.facetList[0].declarationTemplate.subjectSource.scopeStableIdListPath, 'bridges/lifJudgedSubjects.json');

	harness.section('SECTION 2 — the rule observed RED on planted text');
	const plantedNodeList = [
		{ stableId: 'lif:Planted/cedsPropertyId', role: 'DmeProperty', properties: { name: 'plantedA', path: 'Planted/plantedA', description: 'See P000021 for the meaning.' } },
		{ stableId: 'lif:Planted/ctdlCurie', role: 'DmeProperty', properties: { name: 'plantedB', path: 'Planted/plantedB', description: 'Equivalent to ceterms:Credential.' } },
		{ stableId: 'lif:Planted/clean', role: 'DmeProperty', properties: { name: 'plantedC', path: 'Planted/plantedC', description: 'A plain description with the number 2021.' } },
	];
	const planted = judgedSubjectsOf({ nodeList: plantedNodeList });
	harness.equal('a CEDS property id and a CTDL term curie are each excluded by their own hub; a clean subject (and a bare year) is kept', `${planted.judgedStableIdList.join(',')}|${planted.excludedList.map((oneExcluded) => `${oneExcluded.hubToken}:${oneExcluded.patternName}`).sort().join(',')}`, 'lif:Planted/clean|ceds:cedsPropertyId,ctdl:ctdlTermCurie');
	harness.report();
});
