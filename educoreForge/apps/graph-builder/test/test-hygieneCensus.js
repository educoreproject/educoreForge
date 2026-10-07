'use strict';

// test-hygieneCensus.js — ⟪campaign P4b, W-C-18 (V1-C50) and W-C-19 (V1-C51)⟫ comments say what the code does, and the
// bridge source is text.
//
//   a  no STALE TEXT survives at the site that carried it (STALE_TEXT_SITE_LIST: each row names the file, the text that
//      was false, and the fact measured instead)
//   b  lib/bridge-framework/candidateRetrieval.js holds no literal NUL byte (`file` called it data; grep treated it as
//      binary). The edge identity it builds is written with the '\u0000' escape instead, the same string at run time
//
// RED TWINS (in-memory text doubles; nothing written):
//   staleTextRestored   one row's stale text is put back into its file's text -> a red
//   literalNulRestored  a NUL byte is put back into candidateRetrieval.js's text -> b red
//
// The census reads named SITES, not the whole tree: several of these phrases are still true where they appear in history
// notes (forger.js's "contrast with the incumbent cli/lib.d/forger"), and a tree-wide ban would make those lie instead.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- W-C-18 / W-C-19: stale comments gone from their sites; bridge source is text

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');

const PESC_RELEASE_BUNDLE_NAME_LIST = Object.freeze([
	'pescacademiceportfolio1v0v0',
	'pesccollegetranscript1v8v0',
	'pescdocumentrequest1v0v0',
	'pescdocumentresponse1v0v0',
	'peschighschooltranscript1v6v0',
	'pesclearningrecord1v0v0',
	'pesctestscorereport1v1v0',
]);

const PESC_STUB_TEXT = 'refusing stub until phase F4';
const PESC_STUB_FACT = 'harness-backed since F4 (lib/pesc-release-forge/roundTripValidatorFor.js)';

const STALE_TEXT_SITE_LIST = Object.freeze([
	{ relativeFilePath: 'lib/decision-store/decision-store.js', staleText: 'semanticBridge', measuredFact: 'no semanticBridge.js exists; the bridge framework (bridge-framework.js) freezes and stores the block' },
	{ relativeFilePath: 'lib/decision-store/decision-store.js', staleText: 'decisionFreezer', measuredFact: 'no decisionFreezer exists; decisionBlock.js computes the hash' },
	{ relativeFilePath: 'lib/decision-store/decision-store.js', staleText: 'every materialized CLOSE_MATCH edge is stamped', measuredFact: 'all four match types carry decisionBlockHash' },
	{ relativeFilePath: 'lib/embedding/vectorCache.js', staleText: 'every forge and every', measuredFact: 'no bridge embeds; the forger\'s embed passes are the only writers' },
	{ relativeFilePath: 'lib/embedding/vectorCache.js', staleText: 'bridge vectorizer', measuredFact: 'no bridge vectorizer exists' },
	{ relativeFilePath: 'lib/embedding/embedding-client.js', staleText: 'every forge and every bridge', measuredFact: 'no bridge embeds' },
	{ relativeFilePath: 'lib/embedding/embedding-client.js', staleText: 'bridge vectorizer', measuredFact: 'no bridge vectorizer exists' },
	{ relativeFilePath: 'apps/graph-builder/lib/build.js', staleText: 'cli/lib.d/edf-migrate-embeddings all still reference vector-store', measuredFact: 'the incumbent CLI lives only in system/codeAttic' },
	{ relativeFilePath: 'lib/replay/replay-engine.js', staleText: 'every edge MUST carry a provenanceTier', measuredFact: 'match edges carry mappingKind and must NOT carry a provenanceTier' },
	{ relativeFilePath: 'forges/ceds/lib/cedsForgeDeclaration.js', staleText: 'golden_vector', measuredFact: 'two indexes: <graphName>_vector and <graphName>_embedText_vector' },
	{ relativeFilePath: 'lib/hub-framework/hub-framework.js', staleText: '~52%', measuredFact: 'GOLD_EVAL_261006_jevContract: 21,114 of 91,825 value cards carry a definition (23% present, 77% absent)' },
	{ relativeFilePath: 'lib/pesc-release-forge/tools/bundleTemplates.js', staleText: PESC_STUB_TEXT, measuredFact: PESC_STUB_FACT },
	...PESC_RELEASE_BUNDLE_NAME_LIST.map((oneBundleName) => ({ relativeFilePath: `forges/${oneBundleName}/roundTripValidator.js`, staleText: PESC_STUB_TEXT, measuredFact: PESC_STUB_FACT })),
	...PESC_RELEASE_BUNDLE_NAME_LIST.map((oneBundleName) => ({ relativeFilePath: `forges/${oneBundleName}/parserDescriptor.ini`, staleText: PESC_STUB_TEXT, measuredFact: PESC_STUB_FACT })),
]);

const NUL_FREE_RELATIVE_FILE_PATH = 'lib/bridge-framework/candidateRetrieval.js';

const readTextByRelativePath = () => {
	const relativePathList = Array.from(new Set(STALE_TEXT_SITE_LIST.map((oneSite) => oneSite.relativeFilePath).concat([NUL_FREE_RELATIVE_FILE_PATH])));
	return relativePathList.reduce((soFar, oneRelativePath) => {
		const absolutePath = path.join(TREE_ROOT, oneRelativePath);
		if (!fs.existsSync(absolutePath)) {
			throw new Error(`${moduleName}: census site ${oneRelativePath} does not exist; a census row naming a vanished file is a row nobody re-checked`);
		}
		soFar[oneRelativePath] = fs.readFileSync(absolutePath, 'latin1');
		return soFar;
	}, {});
};

const judgeByConjunct = {
	a_noStaleTextAtItsSite: (textByRelativePath) => {
		const survivorList = STALE_TEXT_SITE_LIST.filter((oneSite) => textByRelativePath[oneSite.relativeFilePath].indexOf(oneSite.staleText) !== -1);
		return { pass: survivorList.length === 0, detail: survivorList.map((oneSite) => `${oneSite.relativeFilePath}: "${oneSite.staleText}" (fact: ${oneSite.measuredFact})`).join('; ') || 'no stale text at any site' };
	},
	b_bridgeSourceHasNoNulByte: (textByRelativePath) => {
		const nulCount = textByRelativePath[NUL_FREE_RELATIVE_FILE_PATH].split('\u0000').length - 1;
		return { pass: nulCount === 0, detail: `${NUL_FREE_RELATIVE_FILE_PATH}: ${nulCount} NUL byte(s)` };
	},
};

const twinList = [
	{ conjunctRefId: 'a_noStaleTextAtItsSite', twinName: 'staleTextRestored', mutate: (textByRelativePath) => ({ ...textByRelativePath, [STALE_TEXT_SITE_LIST[0].relativeFilePath]: `${textByRelativePath[STALE_TEXT_SITE_LIST[0].relativeFilePath]}\n// ${STALE_TEXT_SITE_LIST[0].staleText}\n` }) },
	{ conjunctRefId: 'b_bridgeSourceHasNoNulByte', twinName: 'literalNulRestored', mutate: (textByRelativePath) => ({ ...textByRelativePath, [NUL_FREE_RELATIVE_FILE_PATH]: `${textByRelativePath[NUL_FREE_RELATIVE_FILE_PATH]}\u0000` }) },
];

const textByRelativePath = readTextByRelativePath();

harness.section(`BASELINE — ${STALE_TEXT_SITE_LIST.length} stale-text sites and one NUL-free file`);
Object.keys(judgeByConjunct).forEach((conjunctRefId) => {
	const verdict = judgeByConjunct[conjunctRefId](textByRelativePath);
	harness.ok(`${conjunctRefId} PASS`, verdict.pass, verdict.detail);
});

harness.section('THE TWIN SWEEP — each conjunct OBSERVED RED under an in-memory text double');
const reddenedConjunctList = [];
twinList.forEach((oneTwin) => {
	const verdict = judgeByConjunct[oneTwin.conjunctRefId](oneTwin.mutate(textByRelativePath));
	harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
	harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail.slice(0, 200)}`);
	if (!verdict.pass) reddenedConjunctList.push(oneTwin.conjunctRefId);
});
harness.equal('every conjunct has an observed twin', Object.keys(judgeByConjunct).filter((conjunctRefId) => reddenedConjunctList.indexOf(conjunctRefId) === -1).join(','), '');

harness.report();
