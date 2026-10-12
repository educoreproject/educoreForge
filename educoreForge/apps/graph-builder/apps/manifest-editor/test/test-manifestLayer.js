#!/usr/bin/env node
'use strict';

// test-manifestLayer.js — the LAYER block in a manifest (lane DES, campaign cedsRichness-101226, 2026-10-12): a layer requires
// exactly the one standardBase of its standard, already a member, and nothing else; the store's kind gate accepts a layer
// subject only under kind 'layer'. Over a scratch standards database. Each refusal is shown firing on the fault it names, and
// one twin (the layer requires-check removed, in memory) is shown letting a layer with no base through — RED.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: a layer block requires its one base, already a member
SYNOPSIS
     ${moduleName} [-verbose] [-help]
EXIT STATUS
     0 all assertions passed and the twin observed red;  1 otherwise.
`;
require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadBuildJsDouble } = require('../../../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');
const contentAddress = require('../../../../../lib/content-address/content-address')();

const EDITOR_PATH = path.join(__dirname, '..', 'manifestEditor.js');
const STORE_PATH = path.join(__dirname, '..', '..', '..', '..', '..', 'lib', 'standards-database', 'standards-database.js');
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifestLayer-'));

const blockOf = ({ blockType, marker }) => {
	const blockText = `{"kind":"header","blockType":"${blockType}","marker":"${marker}"}\n{"kind":"node","stableId":"urn:${marker}:1","labels":["StandardLayer"]}\n`;
	return { blockText, blockId: contentAddress.blockIdForText(blockText) };
};

let databaseSequence = 0;
// one base, then a layer whose add arguments the case may override; done({ err })
const addBaseThenLayer = ({ editorModule, layerOverride }, done) => {
	databaseSequence += 1;
	require(STORE_PATH)().open({ databaseFilePath: path.join(scratchDir, `layer${databaseSequence}.sqlite3`) }, (openError, standardsDatabase) => {
		if (openError) {
			done({ err: openError });
			return;
		}
		const manifest = editorModule({ standardsDatabase }).init({ name: `layer${databaseSequence}`, description: 'the layer manifest gate', recipe: { recipeName: `layer${databaseSequence}` } });
		const baseBlock = blockOf({ blockType: 'standardBase', marker: `base${databaseSequence}` });
		manifest.add({ subject: 'ceds@14_0_0_0_base', kind: 'standardBase', version: '14.0.0.0', description: 'the base', schemaBlock: baseBlock }, (baseError) => {
			const layerArgs = {
				subject: 'ceds@14_0_0_0_layer_des@13',
				kind: 'layer',
				version: '14.0.0.0',
				requires: [baseBlock.blockId],
				description: 'layer schema block for ceds@14_0_0_0_layer_des@13 (layer test), forged by recipe layerTest',
				schemaBlock: blockOf({ blockType: 'layer', marker: `layer${databaseSequence}` }),
				...(layerOverride ? layerOverride({ baseBlock }) : {}),
			};
			manifest.add(layerArgs, (layerError) => done({ err: baseError || layerError || '', manifest }));
		});
	});
};

const caseList = [
	['a layer requiring its base is accepted', null, /^$/],
	['a layer requiring nothing is refused', () => ({ requires: undefined }), /requires must list exactly the one base block refId/],
	['a layer requiring a block that is not a member is refused', () => ({ requires: ['f'.repeat(64)] }), /not a member of this manifest/],
	['a layer requiring two blocks is refused', ({ baseBlock }) => ({ requires: [baseBlock.blockId, baseBlock.blockId] }), /exactly the one base block/],
	['a layer subject stored under kind standardBase is refused by the store', () => ({ kind: 'standardBase', requires: undefined, schemaBlock: blockOf({ blockType: 'standardBase', marker: 'misnamed' }) }), /does not carry the '_base' role marker/],
];

const eachCase = (caseIndex) => {
	if (caseIndex >= caseList.length) {
		harness.section('twin — the layer requires-check removed, OBSERVED red');
		const twinEditor = loadBuildJsDouble({ buildJsPath: EDITOR_PATH, mutationList: [{ find: "} else if (kind === 'layer') {", replace: "} else if (kind === 'layerCheckRemoved') {" }] });
		addBaseThenLayer({ editorModule: twinEditor, layerOverride: () => ({ requires: undefined }) }, ({ err }) => {
			harness.ok("twin 'layerRequiresCheckRemoved' is RED: a layer with no base is no longer refused for want of one", !/requires must list exactly the one base block refId/.test(String(err)));
			fs.rmSync(scratchDir, { recursive: true, force: true });
			harness.report();
		});
		return;
	}
	const [caseLabel, layerOverride, expectedPattern] = caseList[caseIndex];
	addBaseThenLayer({ editorModule: require(EDITOR_PATH), layerOverride }, ({ err }) => {
		harness.match(caseLabel, String(err), expectedPattern);
		eachCase(caseIndex + 1);
	});
};
harness.section('a layer in a manifest');
eachCase(0);
