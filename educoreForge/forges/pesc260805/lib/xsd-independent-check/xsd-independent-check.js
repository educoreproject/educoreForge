'use strict';

// =====================================================================================
// xsd-independent-check — THE SECOND OPINION, from outside our own toolchain (R-VAL-4)
// =====================================================================================
//
// The PESC counterpart of lib/rdf-independent-check, which is the named precedent and standard.
// Where that module hands RDF/XML to rdflib, this one hands XSD to `xmlschema`, a third-party
// implementation of the XSD component model — the specification's own semantic layer.
//
// TWO-STEP ENFORCEMENT, and neither step substitutes for the other:
//
//   1. lib/roundTripDiff — OUR comparator. Fast, per-predicate, attributed to subjects. It tells
//      you WHAT is missing and WHERE, which is the work order.
//   2. THIS MODULE — a conforming XSD processor. It cannot tell you which predicate to fix. It
//      tells you WHETHER THE EMITTED DOCUMENT IS A SCHEMA AT ALL.
//
// WHY BOTH, stated as this bundle MEASURED it rather than as principle. Our comparator
// canonicalizes both sides with the same code. Anything it does not model is absent from BOTH
// sides of its comparison and therefore reads as FIDELITY rather than as loss — the mutual blind
// spot Phase 5 declared. On its first run against this bundle's own emitted output this
// instrument found the source corpus carries 3,021 `xs:sequence` and 211 `xs:choice` and the
// emitted corpus carries ZERO of either, while the primary comparator scored that same output
// 99.79% faithful. The compositor was never a statement, so its absence could not be a loss.
//
// A tool cannot audit the assumption it is built on.
//
// WHERE IT LIVES — TQ's ruling, 2026-08-06: the independent instrument is INVOKED BY
// `roundTripValidator.js` rather than standing beside it as a separate tool. "The independence
// that matters is the ENGINE, not the caller. What must never happen is the third-party processor
// being replaced by more of our own code." This module therefore shells to Python and does no
// XSD parsing of its own; it orchestrates and renders and nothing else.
//
// WHAT THIS MODULE WILL NOT DO: guess. If python3 is missing, if `xmlschema` cannot be installed,
// if the comparison errors — it reports UNAVAILABLE with the reason and supplies NO verdict. An
// unavailable check must never read as a passing one; that is the exact failure the whole gate
// suite exists to prevent.
//
// Async style: error-first callbacks, no async/await, no try/catch for control flow. The single
// `try` below wraps `JSON.parse`, which has no callback form; it sets a fault string and the flow
// continues through an explicit branch. That is the same shape lib/rdf-independent-check uses and
// it is deliberate rather than incidental.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const moduleName = path.basename(__filename).replace(/\.js$/, '');

const COMPARE_SCRIPT_PATH = path.join(__dirname, 'lib', 'xsdComponentCompare.py');

// The virtual environment lives in dataStores, NOT in the code tree and NOT in the user's python.
// It is disposable: delete the directory and the next run rebuilds it. Same siting rule as
// lib/rdf-independent-check, for the same reason.
const VENV_DIR_PATH =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/xsdIndependentCheck/venv';
const VENV_PYTHON_PATH = path.join(VENV_DIR_PATH, 'bin', 'python');

// Measured: 64 independent compilations run about 24 seconds per corpus, and this compares two.
const COMPARE_TIMEOUT_MS = 600000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

const xsdIndependentCheck = () => {
	// -----------------------------------------------------------------
	// ensureEnvironment — python3 + an xmlschema venv, or a NAMED refusal
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
						`independent XSD check cannot run, and its gate must therefore read UNAVAILABLE ` +
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
					['install', '--quiet', '--no-cache-dir', 'xmlschema'],
					{ timeout: COMPARE_TIMEOUT_MS },
					(installError) => {
						if (installError) {
							callback(
								`${moduleName}: could not install xmlschema into ${VENV_DIR_PATH}: ` +
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
	// refuseUnlessProcessorIsXsd11 — R-P5-1 ON THIS SIDE OF THE WIRE.
	//
	// EXTRACTED AND EXPORTED DELIBERATELY. It was previously inline inside compareXsdCorpora, and
	// the red-evidence probe CLAIMED to drive it while actually driving three argument guards — a
	// comment asserting evidence that did not exist, found by the independent review. Reaching the
	// real guard requires it to be callable, and a probe-local copy would certify only itself,
	// which is the lever Phase 5 had to withdraw.
	//
	// WHAT IT DEFENDS. Under XSD 1.0 a corpus file carrying vc:minVersion compiles to zero
	// components, emits zero warnings and reports SUCCESS. A measurement taken under the wrong
	// processor is not a weaker measurement, it is a confident falsehood, so it is refused rather
	// than annotated.
	// -----------------------------------------------------------------
	const refuseUnlessProcessorIsXsd11 = ({ summary } = {}, callback) => {
		if (!summary || typeof summary !== 'object') {
			callback(
				`${moduleName}.refuseUnlessProcessorIsXsd11: a summary OBJECT is REQUIRED and has no ` +
					`default; got ${typeof summary}.`,
			);
			return;
		}
		if (summary.processorClass !== 'XMLSchema11') {
			callback(
				`${moduleName}.refuseUnlessProcessorIsXsd11: the comparison reported processorClass ` +
					`${JSON.stringify(summary.processorClass)} rather than 'XMLSchema11'. R-P5-1 pins XSD ` +
					`1.1: under 1.0 a corpus file carrying vc:minVersion silently compiles to zero ` +
					`components with zero warnings and reports SUCCESS. Refusing rather than publishing a ` +
					`measurement taken under the wrong processor.`,
			);
			return;
		}
		callback('');
	};

	// -----------------------------------------------------------------
	// compareXsdCorpora — the verdict
	// -----------------------------------------------------------------
	// callback('', { comparison }) where comparison carries the compile tallies for both corpora,
	// the refusal causes in the processor's own words, and the component-level differences for
	// every filename that compiled clean on BOTH sides.
	const compareXsdCorpora = (
		{ sourceCorpusDirectory, emittedCorpusDirectory, outputJsonPath } = {},
		callback,
	) => {
		const missingArgumentList = [
			['sourceCorpusDirectory', sourceCorpusDirectory],
			['emittedCorpusDirectory', emittedCorpusDirectory],
			['outputJsonPath', outputJsonPath],
		]
			.filter(([, oneValue]) => typeof oneValue !== 'string' || oneValue.trim() === '')
			.map(([oneName]) => oneName);
		if (missingArgumentList.length) {
			callback(
				`${moduleName}.compareXsdCorpora: ${missingArgumentList.join(', ')} ` +
					`${missingArgumentList.length === 1 ? 'is' : 'are'} REQUIRED and ` +
					`${missingArgumentList.length === 1 ? 'has' : 'have'} no default. A comparison is ` +
					`always OF two named corpora.`,
			);
			return;
		}
		const absentDirectoryList = [sourceCorpusDirectory, emittedCorpusDirectory].filter(
			(onePath) => !fs.existsSync(onePath),
		);
		if (absentDirectoryList.length) {
			callback(
				`${moduleName}.compareXsdCorpora: does not exist: ${absentDirectoryList.join(', ')}`,
			);
			return;
		}
		ensureEnvironment((environmentError, environment) => {
			if (environmentError) {
				callback(environmentError);
				return;
			}
			execFile(
				environment.pythonPath,
				[COMPARE_SCRIPT_PATH, sourceCorpusDirectory, emittedCorpusDirectory, outputJsonPath],
				{ timeout: COMPARE_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
				(runError, stdout, stderr) => {
					if (runError) {
						callback(
							`${moduleName}.compareXsdCorpora: the comparison failed: ${runError.message}` +
								`${stderr ? ` -- ${String(stderr).slice(0, 400)}` : ''}`,
						);
						return;
					}
					let parsedSummary;
					let faultMessage = '';
					try {
						parsedSummary = JSON.parse(stdout);
					} catch (parseError) {
						faultMessage = parseError.message;
					}
					if (faultMessage) {
						callback(
							`${moduleName}.compareXsdCorpora: the comparison returned unparseable output ` +
								`(${faultMessage}): ${String(stdout).slice(0, 300)}`,
						);
						return;
					}
					if (parsedSummary.error) {
						callback(`${moduleName}.compareXsdCorpora: ${parsedSummary.error}`);
						return;
					}
					// R-P5-1 ASSERTED ON THIS SIDE TOO. The python module pins and asserts XSD 1.1;
					// this reads the pin back out of the RESULT rather than assuming the assertion
					// ran. Same function the red-evidence lever drives.
					refuseUnlessProcessorIsXsd11({ summary: parsedSummary }, (pinError) => {
						if (pinError) {
							callback(pinError);
							return;
						}
						callback('', {
							comparison: parsedSummary,
							detailJsonPath: outputJsonPath,
							venvCreated: environment.created,
						});
					});
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
		const lineList = [];
		const rule = '-'.repeat(96);
		lineList.push(rule);
		lineList.push(
			`INDEPENDENT XSD COMPONENT COMPARISON — xmlschema ${comparison.xmlschemaVersion}, ` +
				`processor ${comparison.processorClass}`,
		);
		lineList.push(rule);
		lineList.push('  This shares NO CODE with the emitter or the canonicalizer. It exists because a');
		lineList.push('  tool cannot audit the assumption it is built on.');
		lineList.push('');
		lineList.push(
			`  SOURCE corpus:   attempted ${comparison.source.attempted}   clean ${comparison.source.clean}` +
				`   refused ${comparison.source.refused}   emptyCompile ${comparison.source.emptyCompile}`,
		);
		lineList.push(
			`  EMITTED corpus:  attempted ${comparison.emitted.attempted}   clean ${comparison.emitted.clean}` +
				`   refused ${comparison.emitted.refused}   emptyCompile ${comparison.emitted.emptyCompile}`,
		);
		lineList.push('');
		lineList.push(
			`  compiled clean on BOTH sides: ${comparison.compileAgreement.bothClean} of ` +
				`${comparison.compileAgreement.sharedFilenames}`,
		);
		lineList.push(
			`  source clean but emitted NOT: ${comparison.compileAgreement.sourceCleanEmittedNotClean}` +
				'   <-- emitted output a conforming processor refuses',
		);
		const causeTally = comparison.emittedRefusalCauseTally || {};
		if (Object.keys(causeTally).length) {
			lineList.push('');
			lineList.push('  EMITTED REFUSALS, in the processor\'s own words:');
			Object.keys(causeTally)
				.sort((leftLabel, rightLabel) => causeTally[rightLabel] - causeTally[leftLabel])
				.forEach((oneLabel) => {
					lineList.push(`    ${String(causeTally[oneLabel]).padStart(4)}  ${oneLabel}`);
				});
		}
		const componentComparison = comparison.componentComparison || {};
		lineList.push('');
		lineList.push('  COMPONENT-LEVEL DIFFERENCES, over files clean on both sides:');
		lineList.push(
			`    content models compared .... ${componentComparison.comparedTypeTotal}` +
				'   (RECURSIVE: global types, global elements, and every nested anonymous type)',
		);
		lineList.push(`    type only in source ........ ${componentComparison.typeOnlyInSourceTotal}`);
		lineList.push(`    type only in emitted ....... ${componentComparison.typeOnlyInEmittedTotal}`);
		lineList.push(
			`    particle ORDER differences . ${componentComparison.particleOrderDifferenceTotal}` +
				'   (the primary comparator carries no ordinal and cannot see these)',
		);
		lineList.push(
			`    RESOLVED type differences .. ${componentComparison.resolvedTypeDifferenceTotal}` +
				'   (the primary comparator strips the prefix and cannot see these)',
		);
		lineList.push(`    enumeration differences .... ${componentComparison.enumerationDifferenceTotal}`);
		lineList.push(`    element type-pointer diffs . ${componentComparison.pointerDifferenceTotal}`);
		// THE UNAVAILABLE COUNT IS PRINTED BESIDE THE DIFFERENCES, NOT BURIED. A marker nothing
		// reads is worse than no marker: two sides that both failed to look produce equal lists and
		// score as AGREEMENT, which is the mutual blind spot reproduced inside the instrument built
		// to detect it. These content models are EXCLUDED from every count above.
		lineList.push(
			`    traversal UNAVAILABLE ...... ${componentComparison.traversalUnavailableTotal}` +
				'   <-- EXCLUDED from the counts above; NONZERO MEANS INCOMPLETE, NOT AGREEMENT',
		);
		lineList.push('');
		lineList.push(
			'  NOTE: agreement here is NOT a fidelity claim. This instrument answers "is the emitted',
		);
		lineList.push(
			'  document a valid schema saying the same thing", not "is every statement reproduced".',
		);
		callback('', { text: lineList.join('\n') });
	};

	return {
		compareXsdCorpora,
		renderComparisonText,
		ensureEnvironment,
		// EXPORTED SO THE RED-EVIDENCE LEVER CAN DRIVE THE REAL GUARD rather than a copy of it.
		refuseUnlessProcessorIsXsd11,
		COMPARE_SCRIPT_PATH,
		VENV_DIR_PATH,
	};
};

module.exports = xsdIndependentCheck;
