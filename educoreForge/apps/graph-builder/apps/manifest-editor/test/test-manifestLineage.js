#!/usr/bin/env node
'use strict';

// test-manifestLineage.js — gate for W-C-8 (V1-C39, V1-S45; campaign P2, option A): manifest ancestry has a WRITER. The
// operator names a parent (-build --basedOnManifestRefId), manifestEditor carries it, save() refuses a parent not in the
// store, the store keeps it, and the recipe finisher records WHY the field is or is not there (basedOnManifestRefIdBasis).
//
// PROVES (over a scratch standards database):
//   (a) init refuses a malformed parent by name (blank, short, not hex)
//   (b) a manifest saved naming a real parent reads back with basedOnManifestRefId = that parent
//   (c) a parent that is not in the store is refused by name at save, and nothing is written
//   (d) the recipe finisher's ManifestRecipe node carries basedOnManifestRefIdBasis 'operatorNamed' with a parent and
//       'none named at build' without
// RED TWINS (in memory, manifestEditor double): parentDroppedAtSave -> (b) red; parentCheckSkipped -> (c) red.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: manifest ancestry is written when the operator names a parent
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadBuildJsDouble } = require('../../../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');
const standardsDatabaseModule = require('../../../../../lib/standards-database/standards-database')();
const contentAddress = require('../../../../../lib/content-address/content-address')();
const vocabulary = require('../../../../../lib/vocabulary/vocabulary');

const EDITOR_PATH = path.join(__dirname, '..', 'manifestEditor.js');
const editorFor = (mutationList) => (mutationList.length === 0 ? require(EDITOR_PATH) : loadBuildJsDouble({ buildJsPath: EDITOR_PATH, mutationList }));
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2ManifestLineage-'));
const blockOf = (standardKey) => {
	const blockText = `{"kind":"header","blockType":"standardBase","standardKey":"${standardKey}","version":"1.0"}\n{"kind":"node","stableId":"urn:${standardKey}:1","labels":["StandardBase"]}\n`;
	return { blockText, blockId: contentAddress.blockIdForText(blockText) };
};
const refusalFrom = (thunk) => {
	try {
		thunk();
	} catch (refusal) {
		return refusal.message;
	}
	return '';
};
const composeAndSave = ({ editorModule, standardsDatabase, name, standardKey, basedOnManifestRefId }, done) => {
	const manifest = editorModule({ standardsDatabase }).init({ name, description: `${name} for the lineage gate`, recipe: { recipeName: name }, ...(basedOnManifestRefId !== undefined ? { basedOnManifestRefId } : {}) });
	manifest.add({ subject: `${standardKey}@1.0_base`, kind: 'standardBase', version: '1.0', description: 'gate block', schemaBlock: blockOf(standardKey) }, (addError) => {
		if (addError) {
			done({ err: addError });
			return;
		}
		manifest.save((saveError, saveReport) => done({ err: saveError || '', saveReport }));
	});
};

standardsDatabaseModule.open({ databaseFilePath: path.join(scratchDir, 'lineage.sqlite3') }, (openError, standardsDatabase) => {
	if (openError) {
		harness.ok('the scratch standards database opens', false, openError);
		harness.report();
		return;
	}
	const conjunctJudgeByRefId = {
		a_malformedParentRefused: (mutationList, done) => {
			const refusalList = ['', 'abc', 'Z'.repeat(64)].map((badValue) => refusalFrom(() => editorFor(mutationList)({ standardsDatabase }).init({ name: 'bad', description: 'bad parent', basedOnManifestRefId: badValue })));
			done({ pass: refusalList.every((oneRefusal) => /is not a 64-hex manifest address/.test(oneRefusal)), detail: refusalList.map((oneRefusal) => oneRefusal.slice(0, 50) || 'ADMITTED').join(' | ') });
		},
		b_namedParentStored: (mutationList, done) =>
			composeAndSave({ editorModule: editorFor([]), standardsDatabase, name: `parent${mutationList.length}`, standardKey: `PARENT${mutationList.length}` }, (parentOutcome) =>
				composeAndSave({ editorModule: editorFor(mutationList), standardsDatabase, name: `child${mutationList.length}`, standardKey: `CHILD${mutationList.length}`, basedOnManifestRefId: (parentOutcome.saveReport || {}).manifestRefId }, (childOutcome) => {
					if (childOutcome.err) {
						done({ pass: false, detail: childOutcome.err });
						return;
					}
					standardsDatabase.getManifest({ refId: childOutcome.saveReport.manifestRefId }, (getError, storedChild) =>
						done({ pass: !getError && storedChild.basedOnManifestRefId === parentOutcome.saveReport.manifestRefId, detail: getError || `stored parent ${storedChild.basedOnManifestRefId}` }));
				})),
		c_absentParentRefused: (mutationList, done) =>
			composeAndSave({ editorModule: editorFor(mutationList), standardsDatabase, name: `orphan${mutationList.length}`, standardKey: `ORPHAN${mutationList.length}`, basedOnManifestRefId: 'a'.repeat(64) }, ({ err }) =>
				done({ pass: /basedOnManifestRefId a{64} is not a manifest in this store/.test(err), detail: err || 'saved an orphan' })),
		d_finisherRecordsTheBasis: (mutationList, done) => {
			const finisher = require('../../replay-manager/lib/finishing/lib/manifest-recipe-finisher')({ vocabulary });
			composeAndSave({ editorModule: editorFor([]), standardsDatabase, name: 'basisParent', standardKey: 'BASISPARENT' }, (parentOutcome) =>
				composeAndSave({ editorModule: editorFor([]), standardsDatabase, name: 'basisChild', standardKey: 'BASISCHILD', basedOnManifestRefId: parentOutcome.saveReport.manifestRefId }, (childOutcome) =>
					finisher.emit({ storeReader: standardsDatabase, manifestRefId: childOutcome.saveReport.manifestRefId }, (childEmitError, childEmit) =>
						finisher.emit({ storeReader: standardsDatabase, manifestRefId: parentOutcome.saveReport.manifestRefId }, (parentEmitError, parentEmit) => {
							const basisOf = (emitted, manifestRefId) => (((emitted || {}).nodes || []).find((oneNode) => oneNode.properties.manifestRefId === manifestRefId) || { properties: {} }).properties.basedOnManifestRefIdBasis;
							const childBasis = basisOf(childEmit, childOutcome.saveReport.manifestRefId);
							const parentBasis = basisOf(parentEmit, parentOutcome.saveReport.manifestRefId);
							done({ pass: !childEmitError && !parentEmitError && childBasis === 'operatorNamed' && parentBasis === 'none named at build', detail: childEmitError || parentEmitError || `child ${childBasis} | parent ${parentBasis}` });
						}))));
		},
	};
	const TWIN_LIST = [
		{ conjunctRefId: 'b_namedParentStored', twinName: 'parentDroppedAtSave', find: '...(basedOnManifestRefId !== undefined ? { basedOnManifestRefId } : {}) },', replace: '},' },
		{ conjunctRefId: 'c_absentParentRefused', twinName: 'parentCheckSkipped', find: '			if (basedOnManifestRefId === undefined) {\n				checked(\'\');', replace: '			if (true) {\n				checked(\'\');' },
	];
	const refIdList = Object.keys(conjunctJudgeByRefId);
	const runSequence = (stepList, whenDone) => {
		const nextStep = (stepIndex) => (stepIndex >= stepList.length ? whenDone() : stepList[stepIndex](() => nextStep(stepIndex + 1)));
		nextStep(0);
	};
	harness.section('BASELINE — the real manifestEditor and recipe finisher pass every conjunct');
	runSequence(
		refIdList.map((oneRefId) => (stepDone) => conjunctJudgeByRefId[oneRefId]([], (verdict) => { harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail); stepDone(); })),
		() => {
			harness.section('THE TWIN SWEEP — each twin OBSERVED RED under a manifestEditor double (in memory)');
			runSequence(
				TWIN_LIST.map((oneTwin) => (stepDone) =>
					conjunctJudgeByRefId[oneTwin.conjunctRefId]([{ find: oneTwin.find, replace: oneTwin.replace }], (verdict) => {
						harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
						harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
						stepDone();
					})),
				() => {
					fs.rmSync(scratchDir, { recursive: true, force: true });
					harness.report();
				},
			);
		},
	);
});
