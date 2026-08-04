#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     runEdfiStageAgainstLiveGraph.js — RT-13 stage machinery vs the REAL edfi validator

DESCRIPTION
     Phase 4 proof runner: drives the graphBuilder's runRoundTripStage (the ONE code path a
     -build invokes post-materialization) with an explicitly composed roster row for edfi —
     validatorPath = this bundle's roundTripValidator.js, snapshotPath = snapshot 04 — against
     the LIVE container DEV_edfiRoundTrip_080326 (left running by Phase 3 for exactly this).

     WHY THE ROSTER ROW IS HAND-COMPOSED: the descriptor-composed path uses the PINNED
     defaultSnapshot (01 — the incumbent's, until Phase 5 flips it with entryModule), and a
     stage-on edfi build in the Phase 4->5 window refuses honestly at snapshot intake. This
     runner exercises the SAME stage code with the snapshot the V2 validator was built for,
     so the uniform signature is proven against BOTH campaigns' validators through one path
     (pesc's proof is the pescOnlyRoundTrip recipe build).

     Bolt endpoint + credential are resolved from the RUNNING container (docker inspect) and
     handed to the stage as the containerHandle — exactly the triple a replayManager handle
     carries in a real build.

     ASSERTED (exit 1 on any miss):
       - the stage reports stageRan true with the edfi row ran:true
       - inventedTotal === 0, lostTotal === 349 (the ruled enrichment backlog), roundTripClean
         false stated honestly
       - the verdict artifact AND the stage summary land under test-artifacts/stageRun/
       - the summary row's verdictPath exists on disk

SYNOPSIS
     node forges/edfi/test/runEdfiStageAgainstLiveGraph.js

     Requires the running container and the gitignored MetaEd bytes (snapshot 04).
`;

if (process.argv.includes('-help') || process.argv.includes('--help')) {
	console.log(helpText());
	process.exit(0);
}

const fs = require('fs');
const path = require('path');

const CONTAINER_NAME = 'DEV_edfiRoundTrip_080326';
const BUNDLE_DIR = path.join(__dirname, '..');
const SNAPSHOT_PATH = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '04');
const OUTPUT_DIR_PATH = path.join(__dirname, 'test-artifacts', 'stageRun');
const EXPECTED_LOST_TOTAL = 349;

const roundTripStageLib = require(
	path.join(BUNDLE_DIR, '..', '..', 'apps', 'graph-builder', 'lib', 'round-trip-stage'),
)();
const roundTripStageStatics = require(
	path.join(BUNDLE_DIR, '..', '..', 'apps', 'graph-builder', 'lib', 'round-trip-stage'),
);
const compilerLib = require(path.join(BUNDLE_DIR, 'lib', 'roundTripEdfiCompiler'))();
const validatorApi = require(path.join(BUNDLE_DIR, 'roundTripValidator.js'))();

const failures = [];
const assertEqual = (label, actual, expected) => {
	if (actual === expected) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

const xLog = {
	status: (line) => console.log(line),
	error: (line) => console.error(line),
	result: (line) => console.log(line),
	verbose: () => {},
};

compilerLib.resolveContainerBolt({ containerName: CONTAINER_NAME }, (resolveError, resolved) => {
	if (resolveError) {
		console.error(`${moduleName}: cannot resolve the live container: ${resolveError}`);
		process.exit(1);
	}
	fs.rmSync(OUTPUT_DIR_PATH, { recursive: true, force: true });
	roundTripStageLib.runRoundTripStage(
		{
			stageSpec: {
				mode: 'build',
				enabled: true,
				roster: {
					rosterRows: [
						{
							token: 'edfi',
							standardName: 'EdFi',
							disposition: 'declared',
							validatorPath: path.join(BUNDLE_DIR, 'roundTripValidator.js'),
							validatorApi,
							snapshotDirPath: SNAPSHOT_PATH,
						},
					],
					declaredTokens: ['edfi'],
					absentTokens: [],
					unresolvableTokens: [],
				},
				outputDirPath: OUTPUT_DIR_PATH,
			},
			containerHandle: {
				containerName: resolved.containerName || CONTAINER_NAME,
				boltUrl: resolved.boltUrl,
				user: resolved.user,
				password: resolved.password,
			},
			xLog,
		},
		(stageError, stageReport) => {
			if (stageError) {
				console.error(`${moduleName}: the stage FAILED: ${stageError}`);
				process.exit(1);
			}
			assertEqual('stageRan', stageReport.stageRan, true);
			const edfiRow = (stageReport.standards || []).find((oneRow) => oneRow.token === 'edfi') || {};
			assertEqual('edfi row ran', edfiRow.ran, true);
			assertEqual('inventedTotal === 0 (the hard line)', edfiRow.inventedTotal, 0);
			assertEqual(`lostTotal === ${EXPECTED_LOST_TOTAL} (the ruled backlog)`, edfiRow.lostTotal, EXPECTED_LOST_TOTAL);
			assertEqual('roundTripClean stated honestly false', edfiRow.roundTripClean, false);
			assertEqual('verdict artifact exists on disk', fs.existsSync(edfiRow.verdictPath), true);
			assertEqual(
				'stage summary landed',
				fs.existsSync(
					path.join(
						OUTPUT_DIR_PATH,
						roundTripStageStatics.STAGE_SUBDIR_NAME,
						roundTripStageStatics.STAGE_SUMMARY_FILE_NAME,
					),
				),
				true,
			);
			if (failures.length) {
				console.error(`${moduleName}: ${failures.length} assertion(s) FAILED`);
				process.exit(1);
			}
			console.log(`[${moduleName}] STAGE RAN AND ASSERTED — uniform signature proven against the edfi validator`);
			process.exit(0);
		},
	);
});
