'use strict';

// =====================================================================================
// rdf-independent-check — the SECOND opinion, from outside our own toolchain
// =====================================================================================
//
// ⟪TQ, 2026-08-02⟫ "We absolutely want this fully baked into the CEDS forge with the
// reusable bits in a lib."
//
// TWO-STEP ENFORCEMENT, and neither step substitutes for the other:
//
//   1. forges/ceds/lib/roundTripDiff — OUR comparator. Fast, per-predicate, attributed to
//      subjects. It tells you WHAT is missing and WHERE, which is the work order.
//   2. THIS MODULE — rdflib, applying the RDF/XML spec's own parsing rules. It cannot tell
//      you which predicate to fix. It tells you WHETHER THE ANSWER IS TRUE.
//
// WHY BOTH. Our comparator canonicalizes both sides with the same code, which makes it
// precise and structurally unable to audit its own assumptions. It collapses internal
// whitespace on both sides -- deliberately, so indentation can never register as loss -- and
// that made a real difference invisible: CEDS writes 62 `&#13;` character references, our
// emitter wrote raw carriage returns, XML 1.0 §2.11 normalizes those away on the next parse,
// and 20 triples differed. Our instrument reported zero, honestly, under its own definition.
// Only a parser sharing no code with ours could see it.
//
// A tool cannot audit the assumption it is built on.
//
// WHAT THIS MODULE WILL NOT DO: guess. If python3 is missing, if rdflib cannot be installed,
// if the comparison errors -- it reports UNAVAILABLE with the reason and supplies NO verdict.
// An unavailable check must never read as a passing one; that is the exact failure the whole
// gate suite exists to prevent.
//
// Async style: error-first callbacks (R7), no async/await, no try/catch for control flow.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const moduleName = path.basename(__filename).replace(/\.js$/, '');

const COMPARE_SCRIPT_PATH = path.join(__dirname, 'lib', 'rdfTripleCompare.py');

// The virtual environment lives in dataStores, NOT in the code tree and NOT in the user's
// python. It is disposable: delete the directory and the next run rebuilds it.
const VENV_DIR_PATH =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/rdfIndependentCheck/venv';
const VENV_PYTHON_PATH = path.join(VENV_DIR_PATH, 'bin', 'python');

// Parsing a 19MB RDF/XML document twice is not fast. Measured ~90s for the CEDS pair.
const COMPARE_TIMEOUT_MS = 600000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

const rdfIndependentCheck = () => {
	// -----------------------------------------------------------------
	// ensureEnvironment — python3 + an rdflib venv, or a NAMED refusal
	// -----------------------------------------------------------------
	const ensureEnvironment = (callback) => {
		if (fs.existsSync(VENV_PYTHON_PATH)) {
			callback('', { pythonPath: VENV_PYTHON_PATH, created: false });
			return;
		}
		execFile('python3', ['--version'], (versionError) => {
			if (versionError) {
				callback(
					`${moduleName}: python3 is not available (${versionError.message}). The ` +
						`independent RDF check cannot run, and its gate must therefore read UNMEASURED ` +
						`rather than pass.`,
				);
				return;
			}
			fs.mkdirSync(path.dirname(VENV_DIR_PATH), { recursive: true });
			execFile('python3', ['-m', 'venv', VENV_DIR_PATH], (venvError) => {
				if (venvError) {
					callback(`${moduleName}: could not create venv at ${VENV_DIR_PATH}: ${venvError.message}`);
					return;
				}
				execFile(
					path.join(VENV_DIR_PATH, 'bin', 'pip'),
					['install', '--quiet', 'rdflib'],
					{ timeout: COMPARE_TIMEOUT_MS },
					(installError) => {
						if (installError) {
							callback(
								`${moduleName}: could not install rdflib into ${VENV_DIR_PATH}: ` +
									`${installError.message}`,
							);
							return;
						}
						callback('', { pythonPath: VENV_PYTHON_PATH, created: true });
					},
				);
			});
		});
	};

	// -----------------------------------------------------------------
	// compareRdfDocuments — the verdict
	// -----------------------------------------------------------------
	// callback('', { comparison }) where comparison.identical is the whole answer.
	const compareRdfDocuments = ({ sourcePath, emittedPath } = {}, callback) => {
		if (!sourcePath || !emittedPath) {
			callback(
				`${moduleName}.compareRdfDocuments: sourcePath and emittedPath are BOTH REQUIRED and ` +
					`have no defaults. A comparison is always OF two named documents.`,
			);
			return;
		}
		const missing = [sourcePath, emittedPath].filter((onePath) => !fs.existsSync(onePath));
		if (missing.length) {
			callback(`${moduleName}.compareRdfDocuments: does not exist: ${missing.join(', ')}`);
			return;
		}
		ensureEnvironment((environmentError, environment) => {
			if (environmentError) {
				callback(environmentError);
				return;
			}
			execFile(
				environment.pythonPath,
				[COMPARE_SCRIPT_PATH, sourcePath, emittedPath],
				{ timeout: COMPARE_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
				(runError, stdout, stderr) => {
					if (runError) {
						callback(
							`${moduleName}.compareRdfDocuments: the comparison failed: ${runError.message}` +
								`${stderr ? ` -- ${String(stderr).slice(0, 400)}` : ''}`,
						);
						return;
					}
					let parsed;
					let faultMessage = '';
					try {
						parsed = JSON.parse(stdout);
					} catch (parseError) {
						faultMessage = parseError.message;
					}
					if (faultMessage) {
						callback(
							`${moduleName}.compareRdfDocuments: the comparison returned unparseable ` +
								`output (${faultMessage}): ${String(stdout).slice(0, 300)}`,
						);
						return;
					}
					if (parsed.error) {
						callback(`${moduleName}.compareRdfDocuments: ${parsed.error}`);
						return;
					}
					callback('', { comparison: parsed, venvCreated: environment.created });
				},
			);
		});
	};

	// -----------------------------------------------------------------
	// renderComparisonText — the readable deliverable
	// -----------------------------------------------------------------
	const renderComparisonText = ({ comparison } = {}, callback) => {
		if (!comparison) {
			callback(`${moduleName}.renderComparisonText: comparison is REQUIRED and has no default.`);
			return;
		}
		const lines = [];
		lines.push('-'.repeat(96));
		lines.push(`INDEPENDENT RDF TRIPLE COMPARISON — rdflib ${comparison.rdflibVersion}`);
		lines.push('-'.repeat(96));
		lines.push('  This shares NO CODE with the round-trip comparator. It exists because a tool');
		lines.push('  cannot audit the assumption it is built on.');
		lines.push('');
		lines.push(
			`  triples:  source ${comparison.sourceTripleCount}   emitted ${comparison.emittedTripleCount}`,
		);
		lines.push(
			`  STRICT:   in source not emitted ${comparison.strict.inSourceNotEmitted}, ` +
				`in emitted not source ${comparison.strict.inEmittedNotSource}`,
		);
		lines.push(
			`  (diagnostic) whitespace-normalized: ${comparison.whitespaceNormalized.inSourceNotEmitted} / ` +
				`${comparison.whitespaceNormalized.inEmittedNotSource}`,
		);
		lines.push('');
		lines.push(`  VERDICT: ${comparison.identical ? 'IDENTICAL RDF GRAPHS' : 'NOT IDENTICAL'}`);
		if (!comparison.identical) {
			// The two numbers together say WHICH KIND of repair is needed, which is why the
			// diagnostic pass is reported at all.
			if (
				comparison.whitespaceNormalized.inSourceNotEmitted === 0 &&
				comparison.whitespaceNormalized.inEmittedNotSource === 0
			) {
				lines.push('');
				lines.push('  Every difference is INSIDE LITERAL TEXT — same subjects, same predicates.');
				lines.push('  Look for character-level encoding (carriage returns, entities), not for a');
				lines.push('  missing statement.');
			}
			['source', 'emitted'].forEach((oneSide) => {
				const samples = comparison.strict[`${oneSide}Samples`] || [];
				if (!samples.length) {
					return;
				}
				lines.push('');
				lines.push(`  --- ${oneSide.toUpperCase()} ONLY (first ${samples.length}) ---`);
				samples.forEach((oneSample) => {
					lines.push(`    x${oneSample.count}  ${oneSample.subject}`);
					lines.push(`          ${oneSample.predicate}`);
					lines.push(`          ${oneSample.object}`);
				});
			});
		}
		callback('', { text: lines.join('\n') });
	};

	return {
		compareRdfDocuments,
		renderComparisonText,
		ensureEnvironment,
		COMPARE_SCRIPT_PATH,
		VENV_DIR_PATH,
	};
};

module.exports = rdfIndependentCheck;
