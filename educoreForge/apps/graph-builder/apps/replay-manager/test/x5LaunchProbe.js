'use strict';
// x5LaunchProbe.js — P4b (GOLDEN_ECHO) one-off evidence driver, NOT a suite (no test- prefix, so no fleet runs it):
// launches a DEV_* container through the REAL replayManager.create, prints its name, waits for the operator's probe,
// then deletes it through the real delete verb. Usage: node x5LaunchProbe.js <probeScriptPath>
const moduleName = 'x5LaunchProbe';
require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: 'x5LaunchProbe <probeScriptPath>' });
const { spawnSync } = require('child_process');
const manager = require('../replayManager')();
const probeScriptPath = process.argv[2];
if (!probeScriptPath) { console.error(`${moduleName}: probeScriptPath is REQUIRED`); process.exit(2); }
manager.create({ graphName: 'DEV_P4b_x5create' }, (createError, handle) => {
	if (createError) { console.error(`create failed: ${createError}`); process.exit(1); }
	console.log(`created ${handle.graphName || 'DEV_P4b_x5create'}`);
	const probe = spawnSync(probeScriptPath, ['DEV_P4b_x5create', '-writeProbes'], { encoding: 'utf8' });
	console.log(probe.stdout);
	manager.delete(handle, (deleteError) => {
		console.log(deleteError ? `delete failed: ${deleteError}` : 'deleted DEV_P4b_x5create');
		process.exit(deleteError ? 1 : 0);
	});
});
