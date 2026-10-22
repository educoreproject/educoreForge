'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// cedsFidelityGate.js — R-1, the CEDS in-build fidelity gate: round-trip CEDS out of the materialized graph, diff it against the
// source ontology, and let fidelityJudgment decide (R5 S4, 2026-10-21: moved here from apps/graph-builder/lib/build.js, where it
// was runCedsFidelityGate and ran whenever a recipe named 'ceds'). This bundle DECLARES it (parserDescriptor.ini
// fidelityGateModule=); build.js runs whichever gate the recipe's standards declare and names no standard. The body is the old
// runner's, unchanged in every verdict and refusal: the escape hatch still requires naming the number (--allowFidelityLoss=<n>),
// invention still always fails, and on success the runner reports WHICH success (the BuildAttestation row).
//
//   runFidelityGate({ xLog, graphName, commandLineParameters, bundleDirPath }, callback(errString, fidelityAttestation))

const fs = require('fs');
const os = require('os');
const path = require('path');

// the round-trip temp file's per-process counter (was build.js's materialize counter; the file is deleted after the diff)
let fidelityRunCounter = 0;

const runFidelityGate = ({ xLog, graphName, commandLineParameters, bundleDirPath }, callback) => {
	// THE DECISION LIVES IN ITS OWN MODULE so its failure branch can be negated in milliseconds instead of a five-minute forge
	// (forges/ceds/test/test-cedsFidelityJudgment.js). This function keeps only the I/O.
	const judgmentLib = require(path.join(__dirname, 'fidelityJudgment'))();
	const allowance = judgmentLib.resolveAllowance({
		rawValue: ((commandLineParameters || {}).values || {}).allowFidelityLoss,
	});
	if (allowance.error) {
		callback(`graphBuilder build: ${allowance.error}`);
		return;
	}
	const allowedLoss = allowance.allowedLoss;

	const compilerLib = require(path.join(__dirname, 'roundTripCompiler'))();
	const diffLib = require(path.join(__dirname, 'roundTripDiff'))();

	const sourcePath = path.join(bundleDirPath, 'assets', 'standardSourceData', '01', 'CEDS-Ontology.rdf');
	if (!fs.existsSync(sourcePath)) {
		callback(
			`graphBuilder build: the CEDS fidelity gate cannot run -- the source ontology ` +
				`'${sourcePath}' does not exist. REFUSED rather than skipped: a gate that quietly ` +
				`does not run is indistinguishable from one that passed.`,
		);
		return;
	}

	xLog.status(`  [fidelity] round-tripping CEDS out of '${graphName}' (R-1)`);
	fidelityRunCounter += 1;
	const emittedPath = path.join(os.tmpdir(), `cedsFidelityGate-${process.pid}-${fidelityRunCounter}.rdf`);

	compilerLib.resolveContainerBolt({ containerName: graphName }, (resolveError, resolved) => {
		if (resolveError) {
			callback(`graphBuilder build: the CEDS fidelity gate could not reach the graph: ${resolveError}`);
			return;
		}
		const reader = compilerLib.makeNeo4jCedsReader(resolved);
		compilerLib.compileToFile({ reader, outPath: emittedPath }, (compileError) => {
			reader.close(() => {});
			if (compileError) {
				callback(`graphBuilder build: the CEDS fidelity gate failed to compile: ${compileError}`);
				return;
			}
			diffLib.compareRdfFiles({ sourcePath, emittedPath, context: { gate: 'R-1', graphName } }, (compareError, compared) => {
				fs.unlink(emittedPath, () => {});
				if (compareError) {
					callback(`graphBuilder build: the CEDS fidelity gate failed to diff: ${compareError}`);
					return;
				}
				const { headline } = compared.report;
				xLog.status(`  [fidelity] source ${headline.sourceStatements}, matched ${headline.matched}, LOST ${headline.lost}, INVENTED ${headline.invented}`);
				const verdict = judgmentLib.judgeFidelity({ headline, allowedLoss, graphName });
				if (!verdict.passed) {
					callback(`graphBuilder build: ${verdict.reason}`);
					return;
				}
				xLog.status(`  [fidelity] ${verdict.reason}`);
				const attestationRead = judgmentLib.attestationFor({ verdict, headline });
				if (attestationRead.error) {
					callback(`graphBuilder build: ${attestationRead.error}`);
					return;
				}
				callback('', attestationRead.attestation);
			});
		});
	});
};

module.exports = { runFidelityGate, moduleName };
