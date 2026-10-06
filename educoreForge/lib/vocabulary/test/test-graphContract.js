#!/usr/bin/env node
'use strict';

// test-graphContract.js — gate for lib/vocabulary/graph-contract.js and its JSON emitter (campaign P0, W-A declarations;
// CONTRACTS-declared-100626 §0-§5).
//
// PROVES:
//   SECTION 1 — the declarations: every field row carries a name, a declared type and a required flag; names are unique
//     within each list; the list-valued and integer-valued registries are disjoint; no exemption is also registered;
//     no retired passport name is still declared live; the whole module is frozen.
//   SECTION 2 — the ONE import surface: vocabulary.js re-exports every graph-contract declaration (the same objects).
//   SECTION 3 — the canonical JSON: byte-stable across calls, keys sorted at every depth, and it parses back to the
//     document; graphContractSha256() is sha256 of exactly those bytes.
//   SECTION 4 — the emitter (lib/vocabulary/tools/emitGraphContractJson.js): it writes canonicalJsonText() byte for
//     byte, so the file the DME hashes is the text the forge hashed; it refuses without --outputFilePath and refuses
//     a directory nobody prepared.
//
// Run: node lib/vocabulary/test/test-graphContract.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gate for the graph contract declarations and graphContract.json

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Checks the shape of every declaration in lib/vocabulary/graph-contract.js, its re-export through vocabulary.js,
     the byte-stability of its canonical JSON and sha256, and that the emitter writes exactly those bytes. Pure: no
     graph, no network; the emitter writes into a temp directory.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const graphContract = require('../graph-contract');
const vocabulary = require('../vocabulary');

const FIELD_TYPE_LIST = ['string', 'integer', 'boolean', 'stringList', 'jsonString'];
const FIELD_LIST_NAME_LIST = ['PASSPORT_FIELD_LIST', 'ATTESTATION_FIELD_LIST', 'MANIFEST_RECIPE_FIELD_LIST', 'RECIPE_BLOCK_FIELD_LIST', 'STANDARD_DEFINITION_FIELD_LIST', 'USAGE_PATTERN_FIELD_LIST'];

// =====================================================================
harness.section('SECTION 1 — the declarations');
// =====================================================================
FIELD_LIST_NAME_LIST.forEach((oneListName) => {
	const fieldList = graphContract[oneListName];
	harness.ok(`${oneListName} is a non-empty list`, Array.isArray(fieldList) && fieldList.length > 0, typeof fieldList);
	const badRowList = (fieldList || []).filter((oneRow) => typeof oneRow.name !== 'string' || FIELD_TYPE_LIST.indexOf(oneRow.type) === -1 || (oneListName !== 'ATTESTATION_FIELD_LIST' && typeof oneRow.required !== 'boolean'));
	harness.equal(`  every row has a name, a declared type${oneListName === 'ATTESTATION_FIELD_LIST' ? '' : ' and a required flag'}`, JSON.stringify(badRowList), '[]');
	const nameList = (fieldList || []).map((oneRow) => oneRow.name);
	harness.equal('  and its names are unique', nameList.length, new Set(nameList).size);
});
harness.equal('PASSPORT_FIELD_LIST declares the 27 rows of W-A-3', (graphContract.PASSPORT_FIELD_LIST || []).length, 27);
const integerNameSet = new Set(graphContract.INTEGER_VALUED_PROPERTY_NAME_LIST || []);
harness.equal('the list-valued and integer-valued registries are disjoint', JSON.stringify((graphContract.LIST_VALUED_PROPERTY_NAME_LIST || []).filter((oneName) => integerNameSet.has(oneName))), '[]');
harness.equal('no name the list rule exempts is also registered list-valued', JSON.stringify(Object.keys(graphContract.LIST_NAME_RULE_EXEMPTION_BY_NAME || {}).filter((oneName) => (graphContract.LIST_VALUED_PROPERTY_NAME_LIST || []).indexOf(oneName) !== -1)), '[]');
const livePassportNameSet = new Set((graphContract.PASSPORT_FIELD_LIST || []).map((oneRow) => oneRow.name));
harness.equal('no retired passport name is still declared live', JSON.stringify((graphContract.PASSPORT_RETIRED_FIELD_NAME_LIST || []).filter((oneRow) => livePassportNameSet.has(oneRow.name)).map((oneRow) => oneRow.name)), '[]');
harness.equal('every passport stringList field is a declared list or the one exempt literal', JSON.stringify((graphContract.PASSPORT_FIELD_LIST || []).filter((oneRow) => oneRow.type === 'stringList' && (graphContract.LIST_VALUED_PROPERTY_NAME_LIST || []).indexOf(oneRow.name) === -1 && !(oneRow.name in (graphContract.LIST_NAME_RULE_EXEMPTION_BY_NAME || {})) && !/List$/.test(oneRow.name)).map((oneRow) => oneRow.name)), '[]');
const unfrozenNameList = Object.keys(graphContract).filter((oneName) => graphContract[oneName] && typeof graphContract[oneName] === 'object' && !Object.isFrozen(graphContract[oneName]));
harness.equal('every exported declaration is frozen', JSON.stringify(unfrozenNameList), '[]');
harness.ok('and so is the module object', Object.isFrozen(graphContract));

// =====================================================================
harness.section('SECTION 2 — vocabulary.js re-exports the contract (one import surface)');
// =====================================================================
const missingFromVocabularyList = Object.keys(graphContract).filter((oneName) => vocabulary[oneName] !== graphContract[oneName]);
harness.equal('every graph-contract export is the SAME object on vocabulary', JSON.stringify(missingFromVocabularyList), '[]');

// =====================================================================
harness.section('SECTION 3 — the canonical JSON and its sha256');
// =====================================================================
const firstText = graphContract.canonicalJsonText();
const secondText = graphContract.canonicalJsonText();
harness.equal('canonicalJsonText is byte-stable across calls', firstText, secondText);
harness.ok('  and ends in one newline', /[^\n]\n$/.test(firstText));
const unsortedPathList = [];
const findUnsorted = (candidate, pathText) => {
	if (Array.isArray(candidate)) {
		candidate.forEach((oneMember, oneIndex) => findUnsorted(oneMember, `${pathText}[${oneIndex}]`));
		return;
	}
	if (candidate && typeof candidate === 'object') {
		const memberNameList = Object.keys(candidate);
		if (JSON.stringify(memberNameList) !== JSON.stringify(memberNameList.slice().sort())) {
			unsortedPathList.push(pathText);
		}
		memberNameList.forEach((oneName) => findUnsorted(candidate[oneName], `${pathText}.${oneName}`));
	}
};
const parsedDocument = JSON.parse(firstText);
findUnsorted(parsedDocument, '$');
harness.equal('  keys are sorted at every depth', JSON.stringify(unsortedPathList.slice(0, 5)), '[]');
harness.equal('  the document carries its contract version', parsedDocument.graphContractVersion, graphContract.GRAPH_CONTRACT_VERSION);
harness.equal('  and the attestation verdict words, resolved from vocabulary (so the DME copy is self-contained)', JSON.stringify(parsedDocument.buildAttestationVerdictList), JSON.stringify(vocabulary.BUILD_ATTESTATION_VERDICT_LIST));
harness.equal('  and the passport rows, as declared', JSON.stringify(parsedDocument.passportFieldList.map((oneRow) => oneRow.name)), JSON.stringify(graphContract.PASSPORT_FIELD_LIST.map((oneRow) => oneRow.name)));
const expectedSha = crypto.createHash('sha256').update(firstText, 'utf8').digest('hex');
harness.equal('graphContractSha256() is sha256 of exactly those bytes', graphContract.graphContractSha256(), expectedSha);

// =====================================================================
harness.section('SECTION 4 — the emitter writes those bytes, and refuses by name');
// =====================================================================
const emitterPath = path.join(__dirname, '..', 'tools', 'emitGraphContractJson.js');
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfGraphContractGate-'));
const outputFilePath = path.join(scratchDir, 'contract', 'graphContract.json');
fs.mkdirSync(path.dirname(outputFilePath));
const emitRun = spawnSync(process.execPath, [emitterPath, `--outputFilePath=${outputFilePath}`], { encoding: 'utf8' });
harness.equal('the emitter exits 0', emitRun.status, 0);
const writtenText = fs.existsSync(outputFilePath) ? fs.readFileSync(outputFilePath, 'utf8') : '';
harness.equal('  and the file is canonicalJsonText() byte for byte', writtenText, firstText);
harness.match('  and it prints the sha256 the DME will compute from the file', emitRun.stdout || '', new RegExp(expectedSha));
const noFlagRun = spawnSync(process.execPath, [emitterPath], { encoding: 'utf8' });
harness.equal('without --outputFilePath it exits 1', noFlagRun.status, 1);
harness.match('  refusing by name', `${noFlagRun.stdout}${noFlagRun.stderr}`, /--outputFilePath is REQUIRED/);
const unpreparedRun = spawnSync(process.execPath, [emitterPath, `--outputFilePath=${path.join(scratchDir, 'nobodyMadeThis', 'graphContract.json')}`], { encoding: 'utf8' });
harness.equal('into a directory nobody prepared it exits 1', unpreparedRun.status, 1);
harness.match('  refusing by name and creating nothing', `${unpreparedRun.stdout}${unpreparedRun.stderr}`, /does not exist/);
harness.ok('  (the directory is still absent)', !fs.existsSync(path.join(scratchDir, 'nobodyMadeThis')));

fs.rmSync(scratchDir, { recursive: true, force: true });
// =====================================================================
harness.section('SECTION 5 — §10 vector index naming (campaign P2, W-A-9)');
// =====================================================================
{
	const { loadBuildJsDouble } = require('../../bridge-framework/test/testSupport/bridgeTwinFactories');
	const CONTRACT_PATH = path.join(__dirname, '..', 'graph-contract.js');
	const namingVerdictOf = (contractModule) => {
		const refusalOf = (spec) => {
			let thrownText = '';
			try {
				contractModule.vectorIndexNameFor(spec);
			} catch (namingError) {
				thrownText = namingError.message;
			}
			return thrownText;
		};
		const textSlotName = contractModule.vectorIndexNameRefusal({ graphName: 'G', slotPropertyName: 'textEmbedding' }) === '' ? contractModule.vectorIndexNameFor({ graphName: 'G', slotPropertyName: 'textEmbedding' }) : '(refused)';
		const pass =
			contractModule.vectorIndexNameFor({ graphName: 'G', slotPropertyName: 'embedding' }) === 'G_vector' &&
			textSlotName === 'G_embedText_vector' &&
			/graphName is REQUIRED/.test(refusalOf({ graphName: '', slotPropertyName: 'embedding' })) &&
			/'searchText' is not a declared vector slot/.test(refusalOf({ graphName: 'G', slotPropertyName: 'searchText' }));
		return { pass, detail: `text slot -> ${textSlotName}` };
	};
	const realVerdict = namingVerdictOf(graphContract);
	harness.ok('vectorIndexNameFor names both declared slots off the graph and refuses an absent graphName and an undeclared slot', realVerdict.pass, realVerdict.detail);
	const slotTable = graphContract.vectorIndexSlotTable();
	harness.ok('the text slot is EMBED_TEXT_VECTOR (label, suffix) — one home, read not retyped', slotTable.textEmbedding.label === vocabulary.EMBED_TEXT_VECTOR.label && slotTable.textEmbedding.indexNameSuffix === vocabulary.EMBED_TEXT_VECTOR.indexNameSuffix, JSON.stringify(slotTable));
	const twinVerdict = namingVerdictOf(loadBuildJsDouble({ buildJsPath: CONTRACT_PATH, mutationList: [{ find: '\t\t[EMBED_TEXT_VECTOR.propertyName]: Object.freeze(', replace: '\t\tremovedTextSlot: Object.freeze(' }] }));
	harness.ok("observed RED with the text slot removed from the table (twin 'textSlotUndeclared')", !twinVerdict.pass, twinVerdict.detail);
	harness.note(`RED-OBSERVED vectorIndexNaming twin='textSlotUndeclared' → ${twinVerdict.pass ? 'STILL PASSING' : 'FAIL'}: ${twinVerdict.detail}`);
}

harness.report();
