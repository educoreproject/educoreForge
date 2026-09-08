#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// judgeEnumerationWitness.js — G6-m (JOB 6b, VELVET_PRISM 2026-09-08, ruled by DAWN_TOWER).
//
// ============================================================================================
// WHAT THIS IS, AND WHY IT IS AN INSTRUMENT RATHER THAN A SUITE
// ============================================================================================
// It runs JOB 6's JUDGE ENUMERATION against a REAL manifest in a REAL store and PRINTS what it finds —
// per relationship block and in aggregate, after the dated alias table has resolved retired identities.
// It asserts nothing and it is not discovered by runAllTests (the runner takes `test-*.js`).
//
// It exists because EVERY JOB 6 GATE IS FIXTURE-BORNE, and that was forced rather than chosen. [code fact,
// measured 2026-09-08] every relationship block in this project carries provenanceTier 'invalid-debug', so
// `-goldEvalCheck` REFUSES every real artifact at a gate that fires BEFORE the enumeration runs — 13 of 13
// blocks across 3 of 3 stores that hold any. So on the day this was written there was no real artifact on
// which G6-a..G6-f could be observed, and this witness is the only thing that exercises the enumeration
// against real bytes at real scale.
//
// ⚠ IT REPORTS AN ENUMERATION, NOT A VERDICT. `-goldEvalCheck` may still REFUSE the manifest you point it
// at — for invalid-debug, for conservation, for anything else. Read this as "these are the judges the blocks
// record", never as "this graph may be promoted".
//
// ============================================================================================
// WHY IT LIVES IN THE TREE (and why the JOB 4 precedent does NOT apply)
// ============================================================================================
// RUBY_ANCHOR deliberately kept its G4-c capture instrument OUTSIDE the repo so it could not drift into the
// diff it was measuring. That reasoning is right and does not transfer: this instrument measures REAL DATA
// in a store, not the diff, so there is nothing for it to contaminate — and keeping it outside meant the
// next builder could not re-run the witness without rewriting it. JOB 7 produces the first REAL-judged
// manifest this project will have; pointing this at that manifest is how six invented-data gates become
// measured ones (JOB 6 docket 9).
//
// ============================================================================================
// USAGE — both parameters REQUIRED, refused by name; no defaults
// ============================================================================================
//   node apps/graph-builder/test/bridgeAcceptance/judgeEnumerationWitness.js \
//        --standardsDatabaseFilePath=<path to the .standardsDatabase.sqlite3> \
//        --manifestRefId=<the manifest -build printed>
//
// There are NO defaults, deliberately: a witness that quietly measured yesterday's store and printed a
// confident table would be worse than one that refuses. The JOB 6 baseline, for comparison, was
//   store    hubKitRole_phase7FiveBridge.standardsDatabase.sqlite3
//   manifest 2c0d1403905abaced4356567a8e40e3edcb67658ac34dfd8204d6f156a5f95dd
//   result   2,961 judged records over 5 blocks, 52 MB, 757 ms, ALL resolving to ONE judge 'debug:first'
//            (the blocks literally carry 'debugJudge-first-v1-INVALID_DEBUG'; the alias table resolves it)
//   verdict  -goldEvalCheck REFUSED that manifest at the invalid-debug gate, as it should.
//
// READ-ONLY: opens the store, reads text, computes. No graph, no docker, no LLM, no writes.
// callback(errString, result); no async/await; no try/catch for control flow.

const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..', '..');
const APP_LIB = path.join(__dirname, '..', '..', 'lib');

// process.global is read at REQUIRE time by the store module, so it is bootstrapped BEFORE the requires
// below. xLog is quiet on purpose: this instrument's stdout IS its report, and the store's progress
// chatter would bury the table it exists to print.
const quietLog = () => {};
process.global = process.global || {
	xLog: { status: quietLog, error: quietLog, result: quietLog, verbose: quietLog, saveProcessFile: quietLog, setProcessFilePath: quietLog },
	getConfig: () => ({}),
	rawConfig: {},
	commandLineParameters: { switches: {}, values: {}, fileList: [] },
};

const siblingLib = require(path.join(APP_LIB, 'gold-eval-bridge-sibling'));
const judgeIdentityAliasTableLib = require(path.join(APP_LIB, 'judgeIdentityAliasTable'));
const standardsDatabaseModule = require(path.join(TREE_ROOT, 'lib', 'standards-database', 'standards-database'));

const firstValueOf = (name) => {
	const matchedArgument = process.argv.filter((oneArgument) => oneArgument.indexOf(`--${name}=`) === 0)[0];
	return matchedArgument === undefined ? undefined : matchedArgument.substring(`--${name}=`.length);
};

const witnessTheEnumeration = ({ standardsDatabaseFilePath, manifestRefId }, callback) => {
	if (typeof standardsDatabaseFilePath !== 'string' || standardsDatabaseFilePath.trim() === '') {
		callback(`${moduleName}: --standardsDatabaseFilePath is REQUIRED and has no default — a witness that measured an unnamed store would print a confident table about the wrong thing`);
		return;
	}
	if (typeof manifestRefId !== 'string' || manifestRefId.trim() === '') {
		callback(`${moduleName}: --manifestRefId is REQUIRED and has no default — the enumeration is a claim about ONE manifest's relationship blocks`);
		return;
	}
	const startedAtMs = Date.now();
	standardsDatabaseModule().open({ databaseFilePath: standardsDatabaseFilePath }, (openError, standardsDatabase) => {
		if (openError) {
			callback(`${moduleName}: opening ${standardsDatabaseFilePath}: ${openError}`);
			return;
		}
		siblingLib.auditManifestMappingBlocks({ standardsDatabase, manifestRefId }, (auditError, audit) => {
			if (auditError) {
				callback(`${moduleName}: ${auditError}`);
				return;
			}
			callback('', { audit, elapsedMs: Date.now() - startedAtMs });
		});
	});
};

const reportOn = ({ audit, elapsedMs, standardsDatabaseFilePath, manifestRefId }) => {
	const line = (text) => process.stdout.write(`${text}\n`);
	line('=== JUDGE ENUMERATION WITNESS — an ENUMERATION, not a verdict ===');
	line(`store    : ${standardsDatabaseFilePath.split('/').pop()}`);
	line(`manifest : ${manifestRefId}`);
	line(`members  : ${audit.memberCount} | relationship blocks audited: ${audit.mappingBlockList.length}`);
	line('');
	line('PER BLOCK:');
	audit.mappingBlockList.forEach((oneBlockRow) => {
		line(`  ${oneBlockRow.subject}`);
		line(`      edges=${oneBlockRow.edgeCount}  judged=${oneBlockRow.judgedEdgeCount}  judgedMissingMappingTool=${oneBlockRow.judgedEdgeMissingMappingToolCount}  judgedMalformedMappingTool=${oneBlockRow.judgedEdgeMalformedMappingToolCount}  invalidDebug=${oneBlockRow.invalidDebugEdgeCount}`);
		oneBlockRow.judgeIdentityPairList.forEach((onePair) => {
			line(`      judge: '${onePair.mappingTool}' / '${onePair.mappingToolVersion}'  -> ${onePair.judgedEdgeCount} judged edge(s)`);
		});
	});
	line('');
	line('AGGREGATE:');
	line(`  judgedEdgeTotal : ${audit.judgedEdgeTotal}`);
	line(`  judgeToolIdList : ${JSON.stringify(audit.judgeToolIdList)}   <- this is what --judgedBy must name`);
	line(`  identity pairs  : ${JSON.stringify(audit.judgeIdentityPairList, null, 2)}`);
	line(`  judge-enumeration refusals : ${audit.judgeEnumerationRefusalMessageList.length}`);
	audit.judgeEnumerationRefusalMessageList.forEach((oneMessage) => line(`      - ${oneMessage}`));
	line(`  invalid-debug refusals     : ${audit.refusalMessageList.length}   <- the PRE-EXISTING gate; it fires FIRST and refuses the manifest`);
	line('');
	// THE ALIAS AT WORK — the written spelling beside the reported one, so a reader can see the table acting
	// rather than take it on faith. Enumerated FROM the table's own rows: adding a row shows up here with no
	// edit, which is the same discipline the table itself follows.
	line('THE ALIAS TABLE, row by row (written spelling -> reported spelling):');
	judgeIdentityAliasTableLib.JUDGE_IDENTITY_ALIAS_ROW_LIST.forEach((oneRow) => {
		line(`  '${oneRow.historicalModelIdentity}'  ->  '${judgeIdentityAliasTableLib.currentModelIdentityFor(oneRow.historicalModelIdentity)}'   (retired ${oneRow.retiredOn})`);
	});
	line('');
	line(`wall ms: ${elapsedMs}`);
	line('⚠ THIS IS NOT A VERDICT. -goldEvalCheck may still REFUSE this manifest — read the invalid-debug count above.');
};

const standardsDatabaseFilePath = firstValueOf('standardsDatabaseFilePath');
const manifestRefId = firstValueOf('manifestRefId');
witnessTheEnumeration({ standardsDatabaseFilePath, manifestRefId }, (witnessError, witnessResult) => {
	if (witnessError) {
		process.stderr.write(`${witnessError}\n`);
		process.exit(1);
		return;
	}
	reportOn({ ...witnessResult, standardsDatabaseFilePath, manifestRefId });
	process.exit(0);
});

module.exports = { witnessTheEnumeration, moduleName };
