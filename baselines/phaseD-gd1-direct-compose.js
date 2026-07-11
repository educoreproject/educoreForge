#!/usr/bin/env node
'use strict';

// phaseD-gd1-direct-compose.js — G-D1's DIRECT arm (the RECIPE §0B method): assemble the
// pure-3-standard manifest from the GOLDEN-of-record members by direct saveManifest —
// -combine would collapse the two same-(mapping,SIF) blocks (supersede identity), which is
// precisely the defect --group expansion fixes; the direct arm therefore uses the store
// primitive, exactly as RECIPE-pureNoLegacyGraph-063026.md §2 did for the instrument lineage.
//
// Membership = the DEVLOG §3.3 pre-declared table (ruling D-D3, golden-of-record lineage):
// 3 standards + reference + the FOUR ORIGINAL golden mapping blocks whose pair-keyed twins
// constitute the CURRENT CEDS::EdFi/CEDS::SIF groups. Idempotent: the manifestKey is
// content-derived; a re-run dedups to the same manifest.
//
// Usage: node phaseD-gd1-direct-compose.js [--db=<sqlitePath>]  (default: the canonical store)

const path = require('path');

process.global = {
	xLog: { status: console.error, error: console.error, result: console.log },
	getConfig: () => undefined,
	commandLineParameters: { switches: {}, values: {}, fileList: [] },
	rawConfig: {},
};

const projectRoot = path.join(__dirname, '..', '..');
const forgeStoreFactory = require(
	path.join(__dirname, '..', 'npm', 'qtools-graph-forge-core', 'lib', 'forge-store', 'forge-store'),
);

const dbArg = process.argv.find((oneArg) => oneArg.startsWith('--db='));
const dbPath = dbArg
	? dbArg.slice('--db='.length)
	: path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3');

// the DEVLOG §3.3 direct-arm table, verbatim
const MEMBERS = [
	'a84cd4b2917adbcbfe8814fba1f0126167a283186d522e8d87a69ead0497f93f', // standard/CEDS
	'4b27112d4081e492245630cfcd0d4bd6ec9a5f9005d0fb2ccbbd6bce189f522a', // standard/EdFi
	'053e7e14ce4f4265f984273ade930d86831d20463f4074a0d6a17fdb324a9b8d', // standard/SIF
	'7c5d9ace970a7520d95794199ca01ded60277350f80b15013eec265b3dd3f2ab', // reference/CEDS
	'907f73dcfd020250df8e31009a1b3af5de5bd79e6901372e6d18fa9bb063ee78', // mapping/EdFi (orig)
	'07f0b78a19cc9dce18282e8b6197bd8505cb89572b1d64777aee556e4bf8d634', // mapping/SIF (orig)
	'b28e9c7136a708bd48069821a946c1adb9dad54811a6b41c22ef3352086be9ad', // mapping/SIF (orig)
	'23890153b36915dd8693169774b9ef028bd429be5f23b1c9f7b1304385731cff', // mapping/SIF-value (orig)
];

const forgeStore = forgeStoreFactory();
forgeStore.init({ dbPath }, (initErr) => {
	if (initErr) {
		console.error(`init failed: ${initErr}`);
		process.exitCode = 1;
		return;
	}
	forgeStore.saveManifest(
		{
			label: 'phaseD-GD1-direct',
			basedOn: null,
			note:
				'G-D1 direct arm (RECIPE method): golden-of-record pure-3 membership assembled by ' +
				'direct saveManifest; the group arm composes the SAME pairs via --group expansion ' +
				'of the CURRENT pair-groups (DEVLOG §3.3).',
			members: MEMBERS.map((blockId) => ({ blockId, position: null })),
		},
		(saveErr, result) => {
			if (saveErr) {
				console.error(`saveManifest failed: ${saveErr}`);
				process.exitCode = 1;
				return;
			}
			console.log(JSON.stringify({ manifestKey: result.manifestKey, memberCount: MEMBERS.length }));
		},
	);
});
