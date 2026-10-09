#!/usr/bin/env node
'use strict';

// graphStructureCheck.js — PLAN G5 and G6 against a NAMED, already-built graph (campaign P4a). READ-ONLY: one READ session,
// every query under a server-side transaction timeout. Runs lib/graph-structure-check.js's four checks:
//   instanceStructure (verdict)  every SIF Field and PESC occurrence has one declaration and one owner
//   codeListStructure (verdict)  every option value has one owning set; counts per standard; frozen source censuses equal
//   rootOwnership     (verdict)  every content node of every standard reached from its root (forgeClean R2; a
//                                measurement until 2026-10-08), the orphans named
//   dmeTextField      (verdict)  every standard's text is in description, the field the DME reads (lane FIX, Fix 3)
// All four also run inside the forgeCensus attestation at every -build (forge-census-gate.js); this tool
// is how a graph built BEFORE that (the gold GOLD_EVAL_261006_jevContract, P3) is checked without a rebuild.
//
// Run: node apps/graph-builder/tools/graphStructureCheck.js --containerName=<container> [--outputFilePath=<json>]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the instance-structure, code-list, root-ownership and DME-text checks (PLAN G5, G6, G19; Fix 3), read-only

SYNOPSIS
     ${moduleName} --containerName=<a running graph container> [--outputFilePath=<json>] [-help]

DESCRIPTION
     Reads the bolt port and credential from the container (docker inspect, as -stampPromotion does), opens ONE READ
     session, and runs the four checks of apps/graph-builder/lib/graph-structure-check.js. The source code-list censuses
     are read from the forge tree for every standard whose family graphStructureRules.json names.

EXIT STATUS
     0 all four checks pass;  1 a check failed (rootOwnership since forgeClean R2, dmeTextField since lane FIX), or refused.

FILES
     apps/graph-builder/lib/graphStructureRules.json   the owner edge per instance label suffix; the source census rules

EXAMPLES
     node apps/graph-builder/tools/graphStructureCheck.js --containerName=GOLD_EVAL_261006_jevContract --outputFilePath=/tmp/structure.json
`;

const fs = require('fs');
const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const { xLog, commandLineParameters } = process.global;
const neo4j = require('neo4j-driver');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();
const structureCheck = require(path.join(__dirname, '..', 'lib', 'graph-structure-check'));
// the CEDS round-trip compiler's resolver, as -stampPromotion uses it (its module export is a factory)
const { resolveContainerBolt } = require(path.join(TREE_ROOT, 'forges', 'ceds', 'lib', 'roundTripCompiler'))();

const CHECK_NAME_LIST = Object.freeze(['instanceStructure', 'codeListStructure', 'rootOwnership', 'dmeTextField']);
const TRANSACTION_TIMEOUT_MS = 120000;
const STANDARD_DEFINITION_CYPHER = 'MATCH (d:StandardDefinition) RETURN d.sourceKey AS sourceKey, d.standardKey AS standardKey, d.standardFamily AS standardFamily ORDER BY sourceKey';

const flagValueOf = (flagName) => {
	const flagValue = commandLineParameters.values[flagName];
	return Array.isArray(flagValue) ? flagValue[0] : flagValue;
};
const containerName = flagValueOf('containerName');
const outputFilePath = flagValueOf('outputFilePath');
if (typeof containerName !== 'string' || containerName === '') {
	xLog.error(`${moduleName}: REFUSED: --containerName=<a running graph container> is REQUIRED and has no default\n${helpText}`);
	process.exit(1);
}

const taskList = new taskListPlus();
taskList.push((args, next) => resolveContainerBolt({ containerName }, (resolveError, resolved) => next(resolveError ? `${moduleName}: ${resolveError}` : '', { ...args, resolved })));
taskList.push((args, next) => {
	const driver = neo4j.driver(args.resolved.boltUrl, neo4j.auth.basic('neo4j', args.resolved.password), { encrypted: false });
	const session = driver.session({ defaultAccessMode: neo4j.session.READ });
	// every query of this tool runs under the server-side timeout: the session is wrapped, not trusted to be quick
	const timedSession = { run: (cypherText, cypherParameters) => session.run(cypherText, cypherParameters, { timeout: TRANSACTION_TIMEOUT_MS }) };
	next('', { ...args, driver, session, timedSession });
});
taskList.push((args, next) => args.timedSession.run(STANDARD_DEFINITION_CYPHER, {}).then(
	(definitionResult) => next('', { ...args, standardDefinitionRowList: definitionResult.records.map((oneRecord) => ({ sourceKey: oneRecord.get('sourceKey'), standardKey: oneRecord.get('standardKey'), standardFamily: oneRecord.get('standardFamily') })) }),
	(definitionError) => next(`${moduleName}: reading StandardDefinition failed: ${definitionError.message}`, args),
));
taskList.push((args, next) => {
	const { sourceCodeListCensusByStandard, refusal } = structureCheck.sourceCodeListCensusFor({ treeRootPath: TREE_ROOT, standardDefinitionRowList: args.standardDefinitionRowList });
	next(refusal, { ...args, sourceCodeListCensusByStandard });
});
taskList.push((args, next) => structureCheck.runGraphStructureCheck({ session: args.timedSession, checkNameList: CHECK_NAME_LIST, sourceCodeListCensusByStandard: args.sourceCodeListCensusByStandard }, (checkError, checkRowList) => next(checkError, { ...args, checkRowList })));

pipeRunner(taskList.getList(), {}, (pipeError, args) => {
	const closeThen = (afterClose) => (args && args.session ? args.session.close().then(() => args.driver.close()).then(afterClose, afterClose) : afterClose());
	closeThen(() => {
		if (pipeError) {
			xLog.error(`${moduleName}: REFUSED: ${pipeError}`);
			process.exit(1);
		}
		args.checkRowList.forEach((oneRow) => xLog.result(`[${oneRow.checkName}] ${oneRow.verdict.toUpperCase()} — ${oneRow.detail}\n`));
		if (outputFilePath) {
			fs.writeFileSync(outputFilePath, JSON.stringify({ containerName, checkedAt: new Date().toISOString(), checkRowList: args.checkRowList }, null, 2));
			xLog.result(`${moduleName}: wrote ${outputFilePath}\n`);
		}
		const failedRowList = args.checkRowList.filter((oneRow) => oneRow.verdict !== structureCheck.PASS_VERDICT);
		process.exit(failedRowList.length === 0 ? 0 : 1);
	});
});
