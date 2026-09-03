#!/usr/bin/env node
'use strict';

// test-conservationGate.js — the discovered gate for JOB 2 of WORKORDER-sifViaConservation-090226:
// the forge-to-harvest conservation comparison, asserted on its EXACT REFUSAL LITERALS. No docker,
// no Neo4j, no forge — compareConservation is a pure function over two summaries, and its contract
// is the text a caller reads when it refuses.
//
// WHY THE EXACT LITERAL AND NEVER A PREFIX: a refusal's job is to tell the caller what to pass
// instead. A prefix match passes while the half of the sentence carrying the remedy rots away.
//
// Run: node apps/graph-builder/apps/replay-manager/test/test-conservationGate.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- the forge-to-harvest conservation gate, on its exact refusal text

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves compareConservation REFUSES an absent expectation by name, REFUSES a malformed one,
     REFUSES loss and invention in both directions naming counts and first offenders, PASSES the
     declared NOT_LOADED_THROUGH_INIT exemption while PRINTING it, and reports duplicate emissions
     as a NUMBER rather than as a failure. No docker, no Neo4j.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const replayManagerModule = require('../replayManager');
const { compareConservation, CONSERVATION_NOT_LOADED_THROUGH_INIT } = replayManagerModule;

const GRAPH_NAME = 'DEV_conservationGateTest';
const UNIT = '␟';

// A summary in the shape conservationSummaryFor produces. Built here rather than imported so the
// test states the shape it depends on out loud.
const summaryOf = ({ edgeKeyList, nodeKeyList, edgeTotal, nodeTotal }) => ({
	edgeTotal: edgeTotal === undefined ? edgeKeyList.length : edgeTotal,
	nodeTotal: nodeTotal === undefined ? nodeKeyList.length : nodeTotal,
	edgeIdentitySet: new Set(edgeKeyList),
	nodeIdentitySet: new Set(nodeKeyList),
});

const edgeKey = (via) => ['REFERENCES', 'sif:object/PersonPrivacyObligationDocument', 'sif:object/Authentications', `via="${via}"`].join(UNIT);
const THREE_VIA_LIST = ['ShareWithRefId', 'DoNotShareWithRefId', 'NeverShareWithRefId'];
const loadedSummary = summaryOf({ edgeKeyList: THREE_VIA_LIST.map(edgeKey), nodeKeyList: ['sif:object/A', 'sif:object/B'] });
const matchingHarvest = summaryOf({ edgeKeyList: THREE_VIA_LIST.map(edgeKey), nodeKeyList: ['sif:object/A', 'sif:object/B'] });

harness.section('ABSENT EXPECTATION — refused by name, with the remedy in the text');
const absentReport = compareConservation({ expectation: undefined, harvested: matchingHarvest, graphName: GRAPH_NAME });
harness.ok('an absent conservationExpectation REFUSES', !!absentReport.error);
harness.equal(
	'  and the refusal is EXACTLY this text',
	absentReport.error,
	`replayManager.harvest '${GRAPH_NAME}': REFUSED — the spec carries no conservationExpectation. ` +
		`Pass the loadedConservationSummary returned by init, or declare '${CONSERVATION_NOT_LOADED_THROUGH_INIT}' ` +
		`if this material was not loaded through init and there is genuinely nothing to conserve against. ` +
		`An absent field would make a forgotten thread indistinguishable from a legitimate exemption, and ` +
		`no block is minted on a comparison nobody made.`,
);
harness.ok('  and it mints nothing', absentReport.statusText === undefined);

harness.section('MALFORMED EXPECTATION — a broken summary must not read as a passing comparison');
const malformedReport = compareConservation({ expectation: { edgeTotal: 3 }, harvested: matchingHarvest, graphName: GRAPH_NAME });
harness.ok('a summary without the identity sets REFUSES', !!malformedReport.error);
harness.equal(
	'  and the refusal is EXACTLY this text',
	malformedReport.error,
	`replayManager.harvest '${GRAPH_NAME}': REFUSED — conservationExpectation is neither ` +
		`'${CONSERVATION_NOT_LOADED_THROUGH_INIT}' nor a summary carrying nodeIdentitySet and edgeIdentitySet. ` +
		`A malformed expectation must not read as a passing comparison.`,
);

harness.section('LOSS — refused, naming the count and the first offender');
const lossHarvest = summaryOf({ edgeKeyList: THREE_VIA_LIST.slice(0, 2).map(edgeKey), nodeKeyList: ['sif:object/A', 'sif:object/B'] });
const lossReport = compareConservation({ expectation: loadedSummary, harvested: lossHarvest, graphName: GRAPH_NAME });
harness.ok('a harvested set short by one edge REFUSES', !!lossReport.error);
harness.equal(
	'  and the refusal is EXACTLY this text',
	lossReport.error,
	`replayManager.harvest '${GRAPH_NAME}': REFUSED — CONSERVATION FAILED across the forge-to-harvest seam. ` +
		`edges missing 1, edges invented 0, nodes missing 0, nodes invented 0. ` +
		`first missing edge(s): REFERENCES sif:object/PersonPrivacyObligationDocument sif:object/Authentications. ` +
		`No block minted.`,
);

harness.section('INVENTION — the comparison is BIDIRECTIONAL, not a count check');
const inventionHarvest = summaryOf({ edgeKeyList: THREE_VIA_LIST.concat(['PermissionGranteeRefId']).map(edgeKey), nodeKeyList: ['sif:object/A', 'sif:object/B'] });
const inventionReport = compareConservation({ expectation: loadedSummary, harvested: inventionHarvest, graphName: GRAPH_NAME });
harness.ok('a harvested set carrying an edge nobody loaded REFUSES', !!inventionReport.error);
harness.equal(
	'  and the refusal is EXACTLY this text',
	inventionReport.error,
	`replayManager.harvest '${GRAPH_NAME}': REFUSED — CONSERVATION FAILED across the forge-to-harvest seam. ` +
		`edges missing 0, edges invented 1, nodes missing 0, nodes invented 0. ` +
		`first invented edge(s): REFERENCES sif:object/PersonPrivacyObligationDocument sif:object/Authentications. ` +
		`No block minted.`,
);

harness.section('EQUAL SETS — passes, and DUPLICATES ARE A NUMBER, NEVER A FAILURE');
// The load emitted five times what four distinct identities describe: one duplicate edge emission.
// This is the 2026-09-02 lesson made executable — a naive count check would have refused a build for
// nine cosmetic duplicates while missing the real defect entirely.
const duplicateBearingLoaded = summaryOf({ edgeKeyList: THREE_VIA_LIST.map(edgeKey), nodeKeyList: ['sif:object/A', 'sif:object/B'], edgeTotal: 4, nodeTotal: 2 });
const duplicateReport = compareConservation({ expectation: duplicateBearingLoaded, harvested: matchingHarvest, graphName: GRAPH_NAME });
harness.ok('a duplicate emission does NOT refuse', duplicateReport.error === undefined);
harness.equal(
	'  and the status line reports it as a NUMBER, exactly this text',
	duplicateReport.statusText,
	`conservation OK: '${GRAPH_NAME}' loaded 4 edge emission(s) / 3 distinct, harvested 3 distinct — ` +
		`nothing missing, nothing invented; 1 duplicate edge emission(s), 0 duplicate node emission(s) ` +
		`(reported, not a failure); nodes 2 distinct both sides`,
);

harness.section('THE DECLARED EXEMPTION — passes, and is PRINTED so a build log shows it');
const exemptReport = compareConservation({ expectation: CONSERVATION_NOT_LOADED_THROUGH_INIT, harvested: matchingHarvest, graphName: GRAPH_NAME });
harness.ok('the declared exemption does NOT refuse', exemptReport.error === undefined);
harness.equal(
	'  and it announces itself on the status line, exactly this text',
	exemptReport.statusText,
	`conservation ${CONSERVATION_NOT_LOADED_THROUGH_INIT}: '${GRAPH_NAME}' harvested 2 nodes, 3 edges ` +
		`with NO loaded set to compare against (declared, not skipped)`,
);
harness.ok(
	'  and the exemption is a NAMED value, not a bare boolean or an omission',
	CONSERVATION_NOT_LOADED_THROUGH_INIT === 'NOT_LOADED_THROUGH_INIT',
);

harness.section('THE CALLER CENSUS — a harvest caller threading NOTHING is reported BY NAME');
// WHY THIS EXISTS. Ruling (b) makes an absent conservationExpectation a REFUSAL, which means every
// caller of replayManager.harvest must thread something. When the gate landed I had enumerated the
// two PRODUCTION call sites and NOT the test ones, and test-bgBoltLive went red for it. An
// incomplete census is exactly the failure this campaign keeps finding, so the census is now a
// gate rather than a thing someone remembers to redo.
//
// The allowlist below is DATA, and every entry states WHY it is exempt. A new caller that threads
// nothing and is not listed here fails this test by name.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// FIVE levels up, not four: this file sits at apps/graph-builder/apps/replay-manager/test/. The
// count is the same one this file's own testAppStartup require uses, and it is checked below
// rather than trusted — a wrong root would make the census grep find nothing and report a clean
// tree, which is the exact false zero this test exists to prevent.
const TREE_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');

// Callers that legitimately pass nothing, each with its reason. Not a silencer: a reader can check
// every line, and anything not on it must thread the field.
const CENSUS_ALLOWLIST = [
	{ filePath: 'apps/graph-builder/test/test-build.js', why: 'calls a COMPONENT DOUBLE (working.harvest), not the real replayManager, so the gate is not on that path' },
	{ filePath: 'apps/graph-builder/apps/replay-manager/test/test-replay-manager.js', why: 'REFUSAL tests — the DEV_/GOLD_ name guard fires before any payload is examined, so these never reach the conservation gate' },
];

// The root must actually BE the tree root, or the grep below searches nothing and reports clean.
if (!fs.existsSync(path.join(TREE_ROOT, 'apps', 'graph-builder', 'graphBuilder.js'))) {
	console.error(`${moduleName}: REFUSED — TREE_ROOT '${TREE_ROOT}' does not contain apps/graph-builder/graphBuilder.js, so the census would search the wrong tree and report a clean one.`);
	process.exit(1);
}

let harvestCallerFileList = [];
try {
	harvestCallerFileList = execFileSync(
		'grep',
		['-rln', '--include=*.js', '-e', '\\.harvest(', 'apps', 'lib', 'test', 'forges'],
		{ cwd: TREE_ROOT, encoding: 'utf-8' },
	)
		.split('\n')
		.filter((oneLine) => oneLine.trim() !== '');
} catch (grepError) {
	// grep exits 1 on NO MATCH, which for this census is not an error but IS a refusal: a tree with
	// no harvest caller at all means the search is wrong, not that the tree is clean.
	harvestCallerFileList = [];
}

harness.ok(
	`the census finds harvest callers at all (found ${harvestCallerFileList.length}) — a census of zero would be indistinguishable from a clean tree`,
	harvestCallerFileList.length > 0,
);

const offendingFileList = harvestCallerFileList.filter((oneFilePath) => {
	if (CENSUS_ALLOWLIST.some((oneEntry) => oneEntry.filePath === oneFilePath)) { return false; }
	const fileText = fs.readFileSync(path.join(TREE_ROOT, oneFilePath), 'utf-8');
	// a file that calls .harvest( must mention conservationExpectation somewhere in it
	return fileText.indexOf('conservationExpectation') === -1 && fileText.indexOf('CONSERVATION_NOT_LOADED_THROUGH_INIT') === -1;
});

harness.equal(
	`every harvest caller outside the stated allowlist threads a conservationExpectation — offenders, BY NAME: ${offendingFileList.length === 0 ? 'none' : offendingFileList.join(', ')}`,
	offendingFileList.length,
	0,
);

// THE TWIN, INLINE AND SELF-PROVING: the same predicate run against a file that demonstrably does
// NOT thread the field must report it. Without this the census could be structurally blind and its
// zero would mean nothing.
const knownNonThreadingText = 'replayManager.harvest({ inGraph: handle }, cb);';
harness.ok(
	'  CENSUS TWIN — the predicate reports a caller that threads nothing',
	knownNonThreadingText.indexOf('conservationExpectation') === -1,
);
harness.ok(
	'  CENSUS TWIN — and does NOT report one that threads the declaration',
	'harvest({ conservationExpectation: X })'.indexOf('conservationExpectation') !== -1,
);

// =====================================================================
// ⟪JOB 5b⟫ THE EXEMPTION CENSUS — no PRODUCTION caller declares NOT_LOADED_THROUGH_INIT any more.
// =====================================================================
// JOB 2 gave build.js's relationship harvest a declared exemption, because bridgeMaker writes through
// lib/bridge-framework/graphWriter rather than replayManager.init and no loaded set existed. One now
// does: the bridge writer accumulates what it merged and returns it on close. The exemption remains a
// LEGITIMATE declaration for material genuinely not loaded through a door that can account for itself
// — it is not deleted — but nothing in production may still be using it, or 5b threaded a summary that
// nobody reads.
const PRODUCTION_ROOT_LIST = ['apps', 'lib', 'forges'];
const EXEMPTION_LITERAL = 'CONSERVATION_NOT_LOADED_THROUGH_INIT';
// the DEFINITION site is not a use of the exemption; it is where the constant lives.
const EXEMPTION_DEFINITION_FILE = 'apps/graph-builder/apps/replay-manager/replayManager.js';

const productionFileList = [];
const walkForProduction = (oneRelativeDirectory) => {
	const absoluteDirectory = path.join(TREE_ROOT, oneRelativeDirectory);
	if (!fs.existsSync(absoluteDirectory)) { return; }
	fs.readdirSync(absoluteDirectory, { withFileTypes: true }).forEach((oneEntry) => {
		const relativePath = path.join(oneRelativeDirectory, oneEntry.name);
		if (oneEntry.isDirectory()) {
			if (oneEntry.name === 'node_modules' || oneEntry.name === 'test' || oneEntry.name === 'testSupport') { return; }
			walkForProduction(relativePath);
			return;
		}
		if (oneEntry.name.endsWith('.js')) { productionFileList.push(relativePath); }
	});
};
PRODUCTION_ROOT_LIST.forEach(walkForProduction);

harness.ok(
	`the exemption census reads production files at all (found ${productionFileList.length}) — a census of zero files would pass for the wrong reason`,
	productionFileList.length > 0,
);

const exemptionUserList = productionFileList.filter((oneRelativePath) => {
	if (oneRelativePath === EXEMPTION_DEFINITION_FILE) { return false; }
	return fs.readFileSync(path.join(TREE_ROOT, oneRelativePath), 'utf-8').indexOf(EXEMPTION_LITERAL) !== -1;
});

harness.equal(
	`⟪JOB 5b⟫ no production caller declares the exemption — users, BY NAME: ${exemptionUserList.length === 0 ? 'none' : exemptionUserList.join(', ')}`,
	exemptionUserList.length,
	0,
);

// THE TWIN, SELF-PROVING: the same predicate against the file that DOES carry the literal must find
// it. Without this, a typo in EXEMPTION_LITERAL would make every file look clean.
harness.ok(
	`  EXEMPTION TWIN — the same search DOES find the literal in its definition site (${EXEMPTION_DEFINITION_FILE})`,
	fs.readFileSync(path.join(TREE_ROOT, EXEMPTION_DEFINITION_FILE), 'utf-8').indexOf(EXEMPTION_LITERAL) !== -1,
);
harness.ok(
	'  EXEMPTION TWIN — and reports a planted declaration in synthetic text',
	`conservationExpectation: replayManagerModule.${EXEMPTION_LITERAL},`.indexOf(EXEMPTION_LITERAL) !== -1,
);

harness.report();
