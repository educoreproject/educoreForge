'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// cedsRoundTripVerbs.js — the CEDS bundle's two operator verbs over a materialized graph (R5 S9, 2026-10-21: moved here verbatim
// from apps/graph-builder/lib/actions.js, where they were -cedsRoundTrip and -cedsGates). graphBuilder now names no standard:
// `-roundTripCompile --standard=<token>` and `-roundTripGates --standard=<token>` run whichever verbs that standard's bundle
// declares (parserDescriptor.ini roundTripVerbModule=). Each body is unchanged but for its own name in its messages and its
// requires, which are now bundle-relative.
//
//   runRoundTripCompile({ xLog, commandLineParameters }, callback(errString, { exitCode, resultText }))
//   runRoundTripGates({ xLog, commandLineParameters }, callback(errString, { exitCode, resultText }))

const fs = require('fs');
const path = require('path');

const firstValue = (commandLineParameters, name) => (commandLineParameters.values[name] || [])[0];

// ---------------------------------------------------------------------
// -roundTripCompile --standard=ceds (was -cedsRoundTrip until R5 S9)
// ---------------------------------------------------------------------
// ⟪TQ RULING, 2026-08-02⟫ "the CEDS OWL source describes a graph. We want to represent it as a
// graph. We should be able to write a graph that we could extract and compile back into the OWL."
// ROUND-TRIP FIDELITY is the acceptance criterion for hub completeness, and this verb is the
// MEASURING STICK: it compiles the materialized CEDS graph back into RDF/XML, diffs that emission
// against the source ontology as canonical statement SETS, and reports the loss.
//
// READ-ONLY EVERYWHERE. It opens the named container over bolt and issues MATCH/RETURN only; it
// never writes to a graph, never forges, never spends a cent of LLM or Voyage credit. The only
// things it writes are its own three artifacts (the emitted RDF, the readable report, the JSON
// sidecar).
//
// IT DOES NOT FIX ANYTHING. The loss it reports is expected to be enormous — the source carries
// roughly 240,000 statements and the graph today carries a fraction. A large HONEST diff IS the
// deliverable: it is the baseline every future enrichment gets scored against, and the
// per-predicate loss table is the enrichment work order.
//
// --containerName is REQUIRED and has no default: a fidelity measurement is always OF one
// materialized graph, and there is no meaningful "whichever graph happens to be running".

const CEDS_ROUND_TRIP_DEFAULT_DIR_PATH =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/cedsRoundTrip';

const requireCedsRoundTripCompiler = () => require(path.join(__dirname, 'roundTripCompiler'));
const requireCedsRoundTripDiff = () => require(path.join(__dirname, 'roundTripDiff'));

// The CEDS source ontology's documented home in this tree: the snapshot the CEDS forge bundle
// itself reads (forges/ceds/parserDescriptor.ini names snapshot 01 and CEDS-Ontology.rdf). The
// default is DOCUMENTED rather than discovered so a measurement always names the file it measured.
const CEDS_SOURCE_DEFAULT_PATH = path.join(__dirname, '..', 'assets', 'standardSourceData', '01', 'CEDS-Ontology.rdf');

const runRoundTripCompile = ({ xLog, commandLineParameters }, callback) => {

	const containerName = firstValue(commandLineParameters, 'containerName');
	if (!containerName) {
		callback(
			`graphBuilder -roundTripCompile --standard=ceds: --containerName=<name> is REQUIRED and has no default. A ` +
				`fidelity measurement is always OF one materialized graph; there is no meaningful ` +
				`"whichever graph happens to be running". The bolt port and credential are read from ` +
				`that container with 'docker inspect', never restated here where they could drift.`,
		);
		return;
	}

	// Each optional path follows the same discipline the P9 stores established: a blank value is
	// REFUSED BY NAME rather than silently taken as "use the default".
	const optionalPath = ({ parameterName, defaultPath }) => {
		const explicitValue = firstValue(commandLineParameters, parameterName);
		if (typeof explicitValue === 'string' && explicitValue.trim() === '') {
			return {
				error:
					`graphBuilder -roundTripCompile --standard=ceds: --${parameterName} was given but blank. Pass a path, or ` +
					`omit it to take the documented default (${defaultPath}). A blank is refused rather ` +
					`than guessed at.`,
			};
		}
		return { filePath: explicitValue || defaultPath };
	};

	const sourceResolution = optionalPath({
		parameterName: 'sourcePath',
		defaultPath: CEDS_SOURCE_DEFAULT_PATH,
	});
	if (sourceResolution.error) {
		callback(sourceResolution.error);
		return;
	}
	if (!fs.existsSync(sourceResolution.filePath)) {
		callback(
			`graphBuilder -roundTripCompile --standard=ceds: the CEDS source ontology '${sourceResolution.filePath}' does ` +
				`not exist. There is nothing to measure the graph AGAINST, and a measurement without a ` +
				`source is not a smaller measurement — it is no measurement at all.`,
		);
		return;
	}

	const outResolution = optionalPath({
		parameterName: 'outPath',
		defaultPath: path.join(CEDS_ROUND_TRIP_DEFAULT_DIR_PATH, `${containerName}.emitted.rdf`),
	});
	if (outResolution.error) {
		callback(outResolution.error);
		return;
	}
	const reportResolution = optionalPath({
		parameterName: 'reportPath',
		defaultPath: path.join(CEDS_ROUND_TRIP_DEFAULT_DIR_PATH, `${containerName}.roundTrip.txt`),
	});
	if (reportResolution.error) {
		callback(reportResolution.error);
		return;
	}
	const emittedFilePath = outResolution.filePath;
	const reportFilePath = reportResolution.filePath;
	const sidecarFilePath = `${reportFilePath.replace(/\.txt$/, '')}.json`;

	const compilerLib = requireCedsRoundTripCompiler()();
	const diffRoundTripLib = requireCedsRoundTripDiff()();

	compilerLib.resolveContainerBolt({ containerName }, (resolveError, resolved) => {
		if (resolveError) {
			callback(`graphBuilder -roundTripCompile --standard=ceds: ${resolveError}`);
			return;
		}
		xLog.status(
			`graphBuilder: -roundTripCompile --standard=ceds reading '${containerName}' at ${resolved.boltUrl} ` +
				`(MATCH/RETURN only — this verb never writes to a graph)`,
		);

		const reader = compilerLib.makeNeo4jCedsReader({
			boltUrl: resolved.boltUrl,
			user: resolved.user,
			password: resolved.password,
		});

		compilerLib.compileToFile({ reader, outPath: emittedFilePath }, (compileError, compiled) => {
			reader.close((closeError) => {
				if (closeError) {
					xLog.error(`graphBuilder -roundTripCompile --standard=ceds: ${closeError}`);
				}
				if (compileError) {
					callback(`graphBuilder -roundTripCompile --standard=ceds: ${compileError}`);
					return;
				}
				xLog.status(
					`graphBuilder: -roundTripCompile --standard=ceds emitted ${compiled.counts.class} class(es), ` +
						`${compiled.counts.property} propert(ies), ${compiled.counts.optionSet} option set(s), ` +
						`${compiled.counts.optionValue} option value(s) to ${emittedFilePath}`,
				);
				(compiled.readerNotes.unresolvedDomainIds || []).forEach((oneNote) =>
					xLog.error(`graphBuilder -roundTripCompile --standard=ceds: UNRESOLVABLE REFERENCE — ${oneNote}`),
				);

				diffRoundTripLib.compareRdfFiles(
					{
						sourcePath: sourceResolution.filePath,
						emittedPath: emittedFilePath,
						context: {
							containerName,
							boltUrl: resolved.boltUrl,
							sourcePath: sourceResolution.filePath,
							emittedPath: emittedFilePath,
							emittedCounts: JSON.stringify(compiled.counts),
						},
					},
					(compareError, compared) => {
						if (compareError) {
							callback(`graphBuilder -roundTripCompile --standard=ceds: ${compareError}`);
							return;
						}
						diffRoundTripLib.renderReportText(
							{ report: compared.report },
							(renderError, rendered) => {
								if (renderError) {
									callback(`graphBuilder -roundTripCompile --standard=ceds: ${renderError}`);
									return;
								}
								// BOTH artifacts are written BEFORE the report is returned, and a write
								// failure is a FAULT named through the callback. A run that printed numbers
								// and silently failed to persist them is a measurement nobody can go back
								// and check — the same discipline -retrievalMetrics applies to its sidecar.
								let writeFault = '';
								try {
									fs.mkdirSync(path.dirname(reportFilePath), { recursive: true });
									fs.writeFileSync(reportFilePath, rendered.reportText, 'utf8');
									fs.mkdirSync(path.dirname(sidecarFilePath), { recursive: true });
									fs.writeFileSync(
										sidecarFilePath,
										`${JSON.stringify(compared.report, null, 2)}\n`,
										'utf8',
									);
								} catch (writeError) {
									writeFault = writeError.message;
								}
								if (writeFault) {
									callback(
										`graphBuilder -roundTripCompile --standard=ceds: writing the report artifacts failed: ${writeFault}`,
									);
									return;
								}
								xLog.status(`graphBuilder: -roundTripCompile --standard=ceds report written to ${reportFilePath}`);
								xLog.status(`graphBuilder: -roundTripCompile --standard=ceds JSON sidecar written to ${sidecarFilePath}`);
								callback('', { exitCode: 0, resultText: rendered.reportText });
							},
						);
					},
				);
			});
		});
	});
};

// ---------------------------------------------------------------------
// -roundTripGates --standard=ceds (was -cedsGates until R5 S9)
// ---------------------------------------------------------------------
// ⟪TQ, 2026-08-02⟫ "Please enhance the spec with very thorough gates."
//
// Runs the CEDS fidelity gate suite: 46 gates declared as DATA in
// forges/ceds/gates/cedsFidelityGates.jsonc, evaluated by roundTripGates, measured by
// roundTripGateMeasures, and proven by roundTripGateTwins.
//
// THE VERDICT IS A WORD, NEVER A PERCENTAGE. Acceptance is zero FAIL, zero UNMEASURED and
// zero UNPROVEN. A tampered emission carrying four fabricated statements still reported
// 71.936% -- proven live during the audit -- so a percentage cannot be trusted to decide
// anything, and none participates here.
//
// A RED SUITE DURING ENRICHMENT IS CORRECT. Its redness is the work order. There is
// deliberately no expected-to-fail state; that is masking with a lanyard (gate M-2).
//
// READ-ONLY. Every measure is MATCH/RETURN and refuseIfWriteClause enforces it mechanically
// before any statement is issued.

const requireGatesLib = () => require(path.join(__dirname, 'roundTripGates'));
const requireGateMeasuresLib = () => require(path.join(__dirname, 'roundTripGateMeasures'));
const requireGateTwinsLib = () => require(path.join(__dirname, 'roundTripGateTwins'));

const runRoundTripGates = ({ xLog, commandLineParameters }, callback) => {

	const containerName = firstValue(commandLineParameters, 'containerName');
	if (!containerName) {
		callback(
			`graphBuilder -roundTripGates --standard=ceds: --containerName=<name> is REQUIRED and has no default. Gates ` +
				`are always measured AGAINST one materialized graph; there is no "whichever graph ` +
				`happens to be running".`,
		);
		return;
	}
	const reportJsonPath = firstValue(commandLineParameters, 'reportJsonPath');

	const gatesLib = requireGatesLib()();
	const measuresLib = requireGateMeasuresLib()();
	const twinsLib = requireGateTwinsLib()();

	gatesLib.loadGateDeclarations({}, (loadError, loadResult) => {
		if (loadError) {
			callback(`graphBuilder -roundTripGates --standard=ceds: ${loadError}`);
			return;
		}
		const { declarations } = loadResult;

		measuresLib.loadSuiteFacts({}, (factsError, factsResult) => {
			if (factsError) {
				callback(`graphBuilder -roundTripGates --standard=ceds: ${factsError}`);
				return;
			}

			// The round-trip report is OPTIONAL input. Without it every report-derived gate goes
			// UNMEASURED, which is a failure and says so -- rather than a silent pass.
			let report = null;
			if (reportJsonPath) {
				if (!fs.existsSync(reportJsonPath)) {
					callback(
						`graphBuilder -roundTripGates --standard=ceds: --reportJsonPath '${reportJsonPath}' does not exist. ` +
							`Run -roundTripCompile --standard=ceds first, or omit the flag and accept UNMEASURED report gates.`,
					);
					return;
				}
				report = JSON.parse(fs.readFileSync(reportJsonPath, 'utf8'));
			} else {
				measuresLib.record(
					'report:*',
					'no --reportJsonPath was given, so no round-trip report was supplied',
				);
			}

			xLog.status(`graphBuilder: -roundTripGates --standard=ceds measuring '${containerName}' (read-only)`);

			measuresLib.measureGraph({ containerName }, (graphError, graphResult) => {
				if (graphError) {
					callback(`graphBuilder -roundTripGates --standard=ceds: ${graphError}`);
					return;
				}
				measuresLib.deriveCanonicalProbes((canonicalError, canonicalProbes) => {
					if (canonicalError) {
						callback(`graphBuilder -roundTripGates --standard=ceds: ${canonicalError}`);
						return;
					}
					measuresLib.deriveDiffProbes((diffProbeError, diffProbes) => {
						if (diffProbeError) {
							callback(`graphBuilder -roundTripGates --standard=ceds: ${diffProbeError}`);
							return;
						}
						// C-3: the OUTSIDE opinion. Runs only when both documents are named --
						// --sourcePath and --emittedPath -- because a comparison is always OF two
						// specific files. Omitted, the gate reads UNMEASURED with that reason,
						// which is the honest state and never a pass.
						const independentSourcePath = firstValue(commandLineParameters, 'sourcePath');
						const independentEmittedPath = firstValue(commandLineParameters, 'emittedPath');
						if (independentSourcePath && independentEmittedPath) {
							xLog.status(
								`graphBuilder: -roundTripGates --standard=ceds running the INDEPENDENT rdflib comparison ` +
									`(parses 19MB twice; ~90s)`,
							);
						}
						measuresLib.deriveIndependentRdfProbe(
							{ sourcePath: independentSourcePath, emittedPath: independentEmittedPath },
							(independentError, independentProbes) => {
						if (independentError) {
							callback(`graphBuilder -roundTripGates --standard=ceds: ${independentError}`);
							return;
						}
						measuresLib.recordDeferredMeasures();

						const measurements = {
							report: { ...(report || {}), ...measuresLib.deriveReportMeasures({ report }) },
							graph: graphResult.graphMeasures,
							probe: {
								...measuresLib.deriveStaticProbes(),
								...canonicalProbes,
								...diffProbes,
								...independentProbes,
							},
							suite: {},
						};

						// Twins run FIRST: a gate can only be PASS once its twin has been watched
						// turning it RED, so the observation set is an input to the evaluation.
						gatesLib.runTwins(
							{ declarations, measurements, twinRegistry: twinsLib.twinRegistry },
							(twinError, twinResult) => {
								if (twinError) {
									callback(`graphBuilder -roundTripGates --standard=ceds: ${twinError}`);
									return;
								}
								measurements.suite = measuresLib.deriveSuiteMeasures({
									declarations,
									suiteFacts: factsResult.suiteFacts,
									observedTwins: twinResult.observedTwins,
								});

								gatesLib.evaluateSuite(
									{ declarations, measurements, observedTwins: twinResult.observedTwins },
									(evaluateError, evaluateResult) => {
										if (evaluateError) {
											callback(`graphBuilder -roundTripGates --standard=ceds: ${evaluateError}`);
											return;
										}
										gatesLib.renderSuiteText(
											{
												suiteResult: evaluateResult.suiteResult,
												twinReports: twinResult.twinReports,
											},
											(renderError, rendered) => {
												if (renderError) {
													callback(`graphBuilder -roundTripGates --standard=ceds: ${renderError}`);
													return;
												}
												const unsuppliedLines = measuresLib.unsupplied.length
													? [
															'',
															'-'.repeat(96),
															'UNSUPPLIED MEASURES — why these gates read UNMEASURED',
															'-'.repeat(96),
														].concat(
															measuresLib.unsupplied.map(
																(one) => `  ${one.name}\n      ${one.reason}`,
															),
														)
													: [];
												callback('', {
													exitCode: evaluateResult.suiteResult.accepted ? 0 : 1,
													resultText: [rendered.text]
														.concat(unsuppliedLines)
														.join('\n'),
												});
											},
										);
									},
								);
							},
						);
							},
						);
					});
				});
			});
		});
	});
};

module.exports = { runRoundTripCompile, runRoundTripGates, moduleName };
