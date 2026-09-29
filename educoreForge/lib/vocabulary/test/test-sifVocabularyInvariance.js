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
	ceds: 'ed4785ba9212999d005608357abdfc9d5db9a32b6f57830eae91864fed517252',
	edfi: '814ce961570cd707b2648dd02f6bccfe28dea3bbebf3daad2d95d638f2662127',
	sif: '72029d9ac1f366a6bb0f470863077bf5f9837eda7844602b86056e2b09b1d90b',
	pesc260805: '87c90588c87fd73fe4838b1662da3b08b9a1d373ba839779977deb6685b6bc61',
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
