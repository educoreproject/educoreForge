#!/usr/bin/env node
'use strict';

// test-sifVocabularyInvariance.js — phase V1 of the SIF replacement, gate (e): the invariance oracle (ii-a)
// (PLAN-sifReplacement-smallPhases-092826 §1.6 ii-a, §3 V1). The pure-layer PROXY fingerprint of each of
// ceds, edfi, sif and pesc260805 must equal the literal G0 recorded before any campaign edit. The vocabulary
// is outside frameworkFingerprint's reach (decisionBlock.js hashes lib/bridge-framework and bridge-maker, not
// lib/vocabulary), so these proxies and the schema-view count gate are what show that V1's rows changed no
// standard's pure output.
//
// TWIN: a vocabulary double with EDGE_TYPES.HAS_PROPERTY's value changed is installed in a child process's
// module cache, and the edfi proxy must move. Without that, an equal proxy could mean the proxy never sees
// the vocabulary at all.
//
// Each forge runs in a child process (testSupport/pureProxyFingerprintProbe.js), so the twin's double never
// reaches this process. About ten seconds. Pure: no docker, no network, no embedding.
//
// Run: node lib/vocabulary/test/test-sifVocabularyInvariance.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- phase V1 gate (e): the four pure PROXY fingerprints equal G0's literals
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
DESCRIPTION
     Forges ceds, edfi, sif and pesc260805 in pure mode in a child process and compares each PROXY
     pureLayerFingerprint with the literal G0 froze. Then forges edfi again under a vocabulary double
     (HAS_PROPERTY's value changed) and requires the proxy to move. Pure; about ten seconds.
EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const harness = require('../../../test/testLib/harness')(moduleName);
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const PROBE_PATH = path.join(__dirname, 'testSupport', 'pureProxyFingerprintProbe.js');

// FROZEN LITERALS: G0's four PROXY fingerprints (sifReplacementBaseline/baselineLiterals.json,
// proxyFingerprintByStandard; DEVLOG-G0 deliverable 2), measured at 97feee9. Never edited to match a
// measurement.
const G0_PROXY_FINGERPRINT_BY_STANDARD = Object.freeze({
	ceds: 'd167724b10cf391f5ab0225fed717e131023242bb2205ea2d8e16c0caeab15b6',
	// edfi RE-PINNED 2026-10-02 (PRISM_LATTICE, goldJev lane F): G0's 814ce961570c… -> 04abc77b…. NOT edited to match a
	// measurement: a RULED base move. TQ excluded the CEDS-authored crosswalk from every graph (2026-09-10, 2026-10-01), so the
	// Ed-Fi forge no longer stamps its CEDS ids (3,045 nodes) and its root no longer names it; expectedFingerprints.json
	// carries the same move with the evidence (runEdfiPreMigrationProbes: 937734f EQUAL 814ce961…, lane F 04abc77b…). The
	// other three are G0's literals, unchanged.
	// ALL FOUR RE-PINNED 2026-10-05 (EMERALD_OCEAN, leftovers lane R item 1): NOT edited to match a measurement: a RULED base
	// move. TQ moved standardKind + standardUsageTips into each forge declaration (2026-10-04 TODO, WORKORDER-leftovers-100526),
	// and the framework stamps them on every root. ceds ed4785ba… -> 2ca57656…, edfi 04abc77b… -> 75695d22…, sif 72029d9a… ->
	// dcf20728…, pesc260805 87c90588… -> 10fccef6…. With exactly those two root lines removed from rootNode.js this suite measured
	// all four EQUAL to the previous literals (8/8); expectedFingerprints.json carries the same move.
	// ALL FOUR RE-PINNED 2026-10-06 (CARDINAL_HORIZON, campaign P3 W-C-4): NOT edited to match a measurement: a RULED base
	// move. Each forge declares standardFamily + releaseLabel and the framework stamps both on every root; with exactly those two root lines (and their REQUIRED_PROPERTIES rows) removed the probe measured all four EQUAL to the previous literals (evidence/P3/WC4-proxy-withoutTheTwoRootLines.json); expectedFingerprints.json carries the same move. ceds 2ca57656… -> 264e995d…, edfi 75695d22… -> 1aa1a1a9…, sif dcf20728… -> 6d808b95…, pesc260805 10fccef6… -> 4cc1c778….
	// ALL FOUR RE-PINNED 2026-10-06 (CARDINAL_HORIZON, campaign P3 P3 W-C-16): NOT edited to match a measurement: a RULED base
	// move. G14 b1 CEDS mappingInstruction includeInImplied false / impliedTargets [] (root mappingInstruction string); G14 c1 Ed-Fi root sourceUrl filled, E6 retired ceds 264e995d… -> b24ad4d6…, edfi 1aa1a1a9… -> eeeefa88…, sif 6d808b95… -> 6d808b95…, pesc260805 4cc1c778… -> 4cc1c778….
	// ALL FOUR RE-PINNED 2026-10-06 (CARDINAL_HORIZON, campaign P3 W-C-17): NOT edited to match a measurement: a RULED base
	// move. CEDS count facets (maxLength, minLength, decimalPlaces) typed INTEGER at the parser; pesc260805 integer-declared facets (minLength, maxLength, totalDigits) likewise. ceds b24ad4d6… -> d167724b…, edfi eeeefa88… -> eeeefa88…, sif 6d808b95… -> 6d808b95…, pesc260805 4cc1c778… -> cc1ab741….
	edfi: 'eeeefa88f56b14bc2d07e86150ab83a704a44e8602260ddc2054838b9ad23ea7',
	sif: '6d808b95326d4e251cc96d5803a33fc22beb8d4722bad532bf096a90cc42c04d',
	pesc260805: 'cc1ab74134541c77b503f1483cfbe7def8344ace6571b4626af4d961caf6956e',
});
const STANDARD_TOKEN_LIST = Object.keys(G0_PROXY_FINGERPRINT_BY_STANDARD);

const scratchDirPath = fs.mkdtempSync(path.join(os.tmpdir(), `${moduleName}-`));

// runProbe — one child process; callback(errString, probeReport)
const runProbe = ({ standardTokenList, edgeTypeTwinIsActive, reportFileName }, callback) => {
	const outputFilePath = path.join(scratchDirPath, reportFileName);
	const argumentList = [PROBE_PATH, `--standardList=${standardTokenList.join(',')}`, `--outputFilePath=${outputFilePath}`, '-quiet'].concat(edgeTypeTwinIsActive ? ['-edgeTypeTwin'] : []);
	execFile(process.execPath, argumentList, { maxBuffer: 64 * 1024 * 1024 }, (probeError, stdoutText, stderrText) => {
		if (probeError) {
			callback(`probe ${reportFileName} failed: ${probeError.message}\n${stdoutText}\n${stderrText}`);
			return;
		}
		callback('', JSON.parse(fs.readFileSync(outputFilePath, 'utf8')));
	});
};

const taskList = new taskListPlus();

taskList.push((args, next) => {
	runProbe({ standardTokenList: STANDARD_TOKEN_LIST, edgeTypeTwinIsActive: false, reportFileName: 'proxy-real.json' }, (probeError, realReport) => {
		next(probeError, { ...args, realReport });
	});
});

taskList.push((args, next) => {
	runProbe({ standardTokenList: ['edfi'], edgeTypeTwinIsActive: true, reportFileName: 'proxy-twin.json' }, (probeError, twinReport) => {
		next(probeError, { ...args, twinReport });
	});
});

pipeRunner(taskList.getList(), {}, (pipelineError, args) => {
	fs.rmSync(scratchDirPath, { recursive: true, force: true });
	if (pipelineError) {
		harness.ok(`the probes ran (${pipelineError})`, false);
		harness.report();
		return;
	}
	const { realReport, twinReport } = args;

	harness.section('(e) oracle ii-a — each PROXY pureLayerFingerprint equals the literal G0 froze');
	harness.equal('every value is labelled PROXY', realReport.label, 'PROXY');
	harness.equal('the real run used the registry HAS_PROPERTY value', realReport.hasPropertyValueInUse, 'HAS_PROPERTY');
	STANDARD_TOKEN_LIST.forEach((standardToken) => {
		harness.equal(`e_proxyEqualsG0 ${standardToken} PASS`, realReport.fingerprintByStandard[standardToken], G0_PROXY_FINGERPRINT_BY_STANDARD[standardToken]);
	});

	harness.section('THE TWIN — a changed vocabulary value moves the edfi proxy');
	harness.equal('the twin ran under the double (HAS_PROPERTY value changed)', twinReport.hasPropertyValueInUse, 'HAS_PROPERTY_V1TWIN');
	const twinFingerprint = twinReport.fingerprintByStandard.edfi;
	const twinIsRed = typeof twinFingerprint === 'string' && twinFingerprint !== G0_PROXY_FINGERPRINT_BY_STANDARD.edfi;
	harness.ok("e_proxyEqualsG0 edfi observed RED under twin 'hasPropertyValueChanged'", twinIsRed, `${twinFingerprint} vs ${G0_PROXY_FINGERPRINT_BY_STANDARD.edfi}`);
	process.global.xLog.status(`  RED-OBSERVED SIF-VOCABULARY-INVARIANCE/e_proxyEqualsG0 edfi twin='hasPropertyValueChanged' lever=productionMutation → ${twinIsRed ? 'FAIL' : 'PASS (DEFECTIVE)'}: PROXY ${twinFingerprint} vs G0 ${G0_PROXY_FINGERPRINT_BY_STANDARD.edfi}`);

	harness.report();
});
