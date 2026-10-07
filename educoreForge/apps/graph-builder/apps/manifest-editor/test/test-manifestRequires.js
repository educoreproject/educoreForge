#!/usr/bin/env node
'use strict';

// test-manifestRequires.js — gate for W-C-7 (V1-S37/S38, V1-C37/C38; campaign P3): a relationship block names the two base
// blocks it was built over (blocks.requires) and its primary (hub) version (blocks.version), and every block names a
// version. Live before P3: 19/19 blocks requires NULL; 9/9 relationship rows version NULL.
//
// PROVES (over a scratch standards database):
//   (a) a relationship added with its two member bases (sorted) reads back from the store with requires = that list and
//       version = the hub's; the recipe finisher's RecipeBlock carries requiresSchemaBlockRefIdList, pairA, pairAVersion
//       (the row's version), pairB and pairBVersion (pairB's base member's version)
//   (b) refused by name: a relationship with no requires; one naming a block that is not a member; an unsorted list; a
//       standardBase claiming requires
//   (c) the store refuses a block with a blank version, naming it
// RED TWINS (in memory): requiresDroppedAtSave (manifestEditor) -> (a) red; requiresCheckSkipped (manifestEditor) -> (b)
// red; versionCheckRemoved (standards-database) -> (c) red.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: relationship blocks name their bases and their version (W-C-7)
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
const contentAddress = require('../../../../../lib/content-address/content-address')();
const vocabulary = require('../../../../../lib/vocabulary/vocabulary');

const EDITOR_PATH = path.join(__dirname, '..', 'manifestEditor.js');
const STORE_PATH = path.join(__dirname, '..', '..', '..', '..', '..', 'lib', 'standards-database', 'standards-database.js');
const editorFor = (mutationList) => (mutationList.length === 0 ? require(EDITOR_PATH) : loadBuildJsDouble({ buildJsPath: EDITOR_PATH, mutationList }));
const storeModuleFor = (mutationList) => (mutationList.length === 0 ? require(STORE_PATH) : loadBuildJsDouble({ buildJsPath: STORE_PATH, mutationList }))();
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3ManifestRequires-'));

const blockOf = ({ blockType, marker }) => {
	const blockText = `{"kind":"header","blockType":"${blockType}","marker":"${marker}"}\n{"kind":"node","stableId":"urn:${marker}:1","labels":["StandardBase"]}\n`;
	return { blockText, blockId: contentAddress.blockIdForText(blockText) };
};

let databaseSequence = 0;
const withStore = (storeMutationList, work) => {
	databaseSequence += 1;
	storeModuleFor(storeMutationList).open({ databaseFilePath: path.join(scratchDir, `requires${databaseSequence}.sqlite3`) }, (openError, standardsDatabase) => work(openError, standardsDatabase));
};

// two bases then a relationship over them; relationshipArgs may override requires / version
const composeThree = ({ editorModule, standardsDatabase, tag, relationshipOverride }, done) => {
	const manifest = editorModule({ standardsDatabase }).init({ name: `requires${tag}`, description: `the W-C-7 gate (${tag})`, recipe: { recipeName: `requires${tag}` } });
	const hubBlock = blockOf({ blockType: 'standardBase', marker: `hub${tag}` });
	const sourceBlock = blockOf({ blockType: 'standardBase', marker: `source${tag}` });
	manifest.add({ subject: 'ceds@14_0_0_0_base', kind: 'standardBase', version: '14.0.0.0', description: 'hub base', schemaBlock: hubBlock }, (hubError) => {
		manifest.add({ subject: 'edfi@5_2_0_base', kind: 'standardBase', version: '5.2.0', description: 'source base', schemaBlock: sourceBlock }, (sourceError) => {
			const relationshipArgs = {
				subject: 'ceds@14_0_0_0_rel_edfi@5_2_0_close',
				kind: 'relationship',
				version: '14.0.0.0',
				requires: [hubBlock.blockId, sourceBlock.blockId].sort(),
				description: 'relationship over both',
				schemaBlock: blockOf({ blockType: 'relationship', marker: `relationship${tag}` }),
				...(relationshipOverride ? relationshipOverride({ hubBlock, sourceBlock }) : {}),
			};
			manifest.add(relationshipArgs, (relationshipError) => done({ manifest, err: hubError || sourceError || relationshipError || '', hubBlock, sourceBlock }));
		});
	});
};

const conjunctJudgeByRefId = {
	a_requiresAndVersionRoundTrip: ({ editorMutationList }, done) =>
		withStore([], (openError, standardsDatabase) =>
			composeThree({ editorModule: editorFor(editorMutationList), standardsDatabase, tag: `a${editorMutationList.length}` }, ({ manifest, err, hubBlock, sourceBlock }) => {
				if (openError || err) {
					done({ pass: false, detail: openError || err });
					return;
				}
				manifest.save((saveError, saveReport) => {
					if (saveError) {
						done({ pass: false, detail: saveError });
						return;
					}
					standardsDatabase.getManifest({ refId: saveReport.manifestRefId }, (getError, stored) => {
						const relationshipRow = ((stored || {}).members || []).find((oneMember) => oneMember.kind === 'relationship') || {};
						const finisher = require('../../replay-manager/lib/finishing/lib/manifest-recipe-finisher')({ vocabulary });
						finisher.emit({ storeReader: standardsDatabase, manifestRefId: saveReport.manifestRefId }, (emitError, emitted) => {
							const recipeBlock = (((emitted || {}).nodes || []).find((oneNode) => oneNode.properties.kind === 'relationship') || { properties: {} }).properties;
							const expectedRequires = [hubBlock.blockId, sourceBlock.blockId].sort();
							const pass = !getError && !emitError
								&& JSON.stringify(relationshipRow.requires) === JSON.stringify(expectedRequires) && relationshipRow.version === '14.0.0.0'
								&& JSON.stringify(recipeBlock.requiresSchemaBlockRefIdList) === JSON.stringify(expectedRequires)
								&& recipeBlock.pairA === 'ceds' && recipeBlock.pairAVersion === '14.0.0.0' && recipeBlock.pairB === 'edfi' && recipeBlock.pairBVersion === '5.2.0';
							done({ pass, detail: getError || emitError || `store requires ${JSON.stringify(relationshipRow.requires)} version ${relationshipRow.version}; RecipeBlock ${JSON.stringify({ requires: recipeBlock.requiresSchemaBlockRefIdList, pairA: recipeBlock.pairA, pairAVersion: recipeBlock.pairAVersion, pairB: recipeBlock.pairB, pairBVersion: recipeBlock.pairBVersion })}` });
						});
					});
				});
			})),
	b_badRequiresRefusedByName: ({ editorMutationList }, done) =>
		withStore([], (openError, standardsDatabase) => {
			const editorModule = editorFor(editorMutationList);
			const caseList = [
				{ tag: 'none', override: () => ({ requires: undefined }), regex: /requires must list the two base block refIds/ },
				{ tag: 'stranger', override: ({ hubBlock }) => ({ requires: [hubBlock.blockId, 'f'.repeat(64)].sort() }), regex: /is not a member of this manifest/ },
				{ tag: 'unsorted', override: ({ hubBlock, sourceBlock }) => ({ requires: [hubBlock.blockId, sourceBlock.blockId].sort().reverse() }), regex: /requires must be sorted/ },
			];
			const outcomeList = [];
			const runCase = (caseIndex) => {
				if (caseIndex >= caseList.length) {
					const manifest = editorModule({ standardsDatabase }).init({ name: 'baseClaims', description: 'a base claiming requires', recipe: { recipeName: 'baseClaims' } });
					manifest.add({ subject: 'lif@1_0_base', kind: 'standardBase', version: '1.0', requires: ['a'.repeat(64)], description: 'base', schemaBlock: blockOf({ blockType: 'standardBase', marker: `baseClaims${editorMutationList.length}` }) }, (baseError) => {
						outcomeList.push({ tag: 'baseClaims', ok: /a standardBase block requires nothing/.test(baseError || ''), text: baseError || 'ADMITTED' });
						done({ pass: !openError && outcomeList.every((oneOutcome) => oneOutcome.ok), detail: outcomeList.map((oneOutcome) => `${oneOutcome.tag}: ${String(oneOutcome.text).slice(0, 80)}`).join(' | ') });
					});
					return;
				}
				const oneCase = caseList[caseIndex];
				composeThree({ editorModule, standardsDatabase, tag: `b${oneCase.tag}${editorMutationList.length}`, relationshipOverride: oneCase.override }, ({ err }) => {
					outcomeList.push({ tag: oneCase.tag, ok: oneCase.regex.test(err), text: err || 'ADMITTED' });
					runCase(caseIndex + 1);
				});
			};
			runCase(0);
		}),
	c_blankVersionRefusedAtTheStore: ({ storeMutationList }, done) =>
		withStore(storeMutationList, (openError, standardsDatabase) => {
			const block = blockOf({ blockType: 'standardBase', marker: `blank${storeMutationList.length}` });
			standardsDatabase.saveBlock({ text: block.blockText, kind: 'standardBase', subject: 'lif@1_0_base', version: '  ' }, (saveError) =>
				done({ pass: !openError && /version "  " is blank/.test(saveError || ''), detail: openError || saveError || 'ADMITTED a blank version' }));
		}),
};

const TWIN_LIST = [
	{ conjunctRefId: 'a_requiresAndVersionRoundTrip', twinName: 'requiresDroppedAtSave', target: 'editor', find: '				version,\n				requires,\n				producedBy: recipeName', replace: '				version,\n				producedBy: recipeName' },
	{ conjunctRefId: 'b_badRequiresRefusedByName', twinName: 'requiresCheckSkipped', target: 'editor', find: "		if (kind === 'relationship') {\n			const requiresFault", replace: "		if (false) {\n			const requiresFault" },
	{ conjunctRefId: 'c_blankVersionRefusedAtTheStore', twinName: 'versionCheckRemoved', target: 'store', find: "		if (typeof version !== 'string' || version.trim() === '') {", replace: '		if (false) {' },
];

const runSequence = (stepList, whenDone) => {
	const nextStep = (stepIndex) => (stepIndex >= stepList.length ? whenDone() : stepList[stepIndex](() => nextStep(stepIndex + 1)));
	nextStep(0);
};
harness.section('BASELINE — the real manifestEditor, store and finisher pass every conjunct');
runSequence(
	Object.keys(conjunctJudgeByRefId).map((oneRefId) => (stepDone) => conjunctJudgeByRefId[oneRefId]({ editorMutationList: [], storeMutationList: [] }, (verdict) => { harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail); stepDone(); })),
	() => {
		harness.section('THE TWIN SWEEP — each twin OBSERVED RED under an in-memory double');
		runSequence(
			TWIN_LIST.map((oneTwin) => (stepDone) => {
				const mutationList = [{ find: oneTwin.find, replace: oneTwin.replace }];
				const twinSubject = oneTwin.target === 'editor' ? { editorMutationList: mutationList, storeMutationList: [] } : { editorMutationList: [], storeMutationList: mutationList };
				conjunctJudgeByRefId[oneTwin.conjunctRefId](twinSubject, (verdict) => {
					harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
					harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail.slice(0, 200)}`);
					stepDone();
				});
			}),
			() => {
				fs.rmSync(scratchDir, { recursive: true, force: true });
				harness.report();
			},
		);
	},
);
