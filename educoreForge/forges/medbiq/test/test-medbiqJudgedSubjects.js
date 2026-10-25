#!/usr/bin/env node
'use strict';

// test-medbiqJudgedSubjects.js — the MedBiquitous judged facet's scope (nextStandards wave 3 lane I2; the LIF C2 form). Docker-free. It
// proves four things:
//   * the committed medbiqJudgedSubjects.json is EXACTLY medbiqJudgedSubjectRule's output over the forged snapshot, so it cannot drift from
//     the scope file or the hubs' scans;
//   * the scope is the 1,229 fields of the current-version files (Phase 0 ruling 6), with the legacy v1 libraries, the IEEE LOM binding and
//     journaltypes out;
//   * the bridging declaration points at the file;
//   * the rule is observed RED: a subject whose text carries a hub identifier is excluded, an out-of-scope file's field is excluded, a clean
//     in-scope field is kept.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the MedBiquitous judged facet's scope: the current-version files' fields, minus any carrying a hub identifier (no Docker)

SYNOPSIS
     node forges/medbiq/test/${moduleName}.js [-verbose] [-help]

EXIT STATUS
     0 every assertion passed;  1 otherwise.
`;

const fs = require('fs');
const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const harness = require(path.join(TREE_ROOT, 'test', 'testLib', 'harness'))(moduleName);

const BUNDLE_DIR_PATH = path.join(__dirname, '..');
const { judgedSubjectsOf } = require(path.join(BUNDLE_DIR_PATH, 'bridgeData', 'medbiqJudgedSubjectRule'));
const { standardBridging } = require(path.join(BUNDLE_DIR_PATH, 'bridges', 'medbiqBridging'));
const bundle = require(path.join(BUNDLE_DIR_PATH, 'forgeMedbiq'))({ embedder: null });
const committedStableIdList = JSON.parse(fs.readFileSync(path.join(BUNDLE_DIR_PATH, 'bridges', 'medbiqJudgedSubjects.json'), 'utf8'));
const SNAPSHOT_DIR_PATH = path.join(BUNDLE_DIR_PATH, 'assets', 'standardSourceData', '02');

if (!fs.existsSync(path.join(SNAPSHOT_DIR_PATH, 'member', 'v2', 'member.xsd'))) {
	harness.ok('the git-ignored publisher files are present (else run the recipe in 02/README_PROVENANCE.md)', false, 'the MedBiquitous publisher bytes are absent: run the acquisition recipe in forges/medbiq/assets/standardSourceData/02/README_PROVENANCE.md');
	harness.report();
}

bundle.forge({ sourcePath: SNAPSHOT_DIR_PATH, owner: 'test', skipEmbedding: true }, (forgeError, forged) => {
	harness.section('SECTION 1 — the committed scope is the rule\'s output');
	harness.accepts('the snapshot forges', forgeError ? [forgeError] : []);
	if (forgeError) {
		harness.report();
		return;
	}
	const { judgedStableIdList, outOfScopeCount, excludedList } = judgedSubjectsOf({ nodeList: forged.nodes });
	harness.equal('medbiqJudgedSubjects.json equals the rule over the forged snapshot (1,229 ids, sorted)', `${committedStableIdList.length}|${JSON.stringify(committedStableIdList) === JSON.stringify(judgedStableIdList)}`, '1229|true');
	harness.equal('539 fields of the legacy, LOM and journal files are out of scope; no in-scope field carries a hub identifier', `${outOfScopeCount}|${excludedList.length}`, '539|0');
	harness.ok('no judged field lives in a legacy v1, IEEE LOM or journal file', committedStableIdList.every((oneStableId) => !/\/(member|address|name|activityreport|curriculuminventory)\/v1#|ltsc\.ieee\.org|journal\/service/.test(oneStableId)));
	harness.equal('the judged facet reads this file as its scope', standardBridging.facetList[0].declarationTemplate.subjectSource.scopeStableIdListPath, 'bridges/medbiqJudgedSubjects.json');

	harness.section('SECTION 2 — the rule observed RED on planted subjects');
	const plantedNodeList = [
		{ stableId: 'medbiq:type/ns.medbiq.org/member/v2#Planted/el/cedsPropertyId', role: 'DmeProperty', properties: { schemaFile: 'member/v2/member.xsd', name: 'plantedA', path: 'Planted.plantedA', owningTypeDescription: 'See P000021 for the meaning.' } },
		{ stableId: 'medbiq:type/ns.medbiq.org/member/v2#Planted/el/ctdlCurie', role: 'DmeProperty', properties: { schemaFile: 'member/v2/member.xsd', name: 'plantedB', path: 'Planted.plantedB', typeQName: 'ceterms:Credential' } },
		{ stableId: 'medbiq:type/ns.medbiq.org/member/v1#Planted/el/legacy', role: 'DmeProperty', properties: { schemaFile: 'member/v1/member.xsd', name: 'plantedC', path: 'Planted.plantedC' } },
		{ stableId: 'medbiq:type/ns.medbiq.org/member/v2#Planted/el/clean', role: 'DmeProperty', properties: { schemaFile: 'member/v2/member.xsd', name: 'plantedD', path: 'Planted.plantedD', optionValueNameList: '["2021"]' } },
	];
	const planted = judgedSubjectsOf({ nodeList: plantedNodeList });
	harness.equal('a CEDS id and a CTDL curie are each excluded by their own hub, a legacy file\'s field is out of scope, a clean field (and a bare year) is kept', `${planted.judgedStableIdList.join(',')}|${planted.outOfScopeCount}|${planted.excludedList.map((oneExcluded) => `${oneExcluded.hubToken}:${oneExcluded.patternName}`).sort().join(',')}`, 'medbiq:type/ns.medbiq.org/member/v2#Planted/el/clean|1|ceds:cedsPropertyId,ctdl:ctdlTermCurie');
	harness.report();
});
