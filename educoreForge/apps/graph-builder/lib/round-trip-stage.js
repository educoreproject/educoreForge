'use strict';

// round-trip-stage.js — the RT-13 builder stage (doctrine §7; forge-edfi Phase 4 work order;
// rulings R-WO-16..20). Two verbs, both error-first callback-shaped (R7):
//
//   composeValidatorRoster({ standardTokens, bundleResolver, requireValidator? }, callback)
//       -> callback('', { rosterRows, declaredTokens, absentTokens, unresolvableTokens })
//   runRoundTripStage({ stageSpec, containerHandle, xLog }, callback)
//       -> callback('', stageSummary)
//
// THE BUILDER COMPOSES ITS VALIDATOR KNOWLEDGE FROM parserDescriptor.ini DECLARATIONS
// (RT-13.1: declared, not sniffed) — the bundle IS its own registration, exactly as it is for
// the forge roster. Composition classifies every recipe standard:
//
//   DECLARED      the descriptor names a roundTripValidator AND the file exists, loads, and
//                 exports validate. Integrity is verified AT COMPOSITION, ON EVERY BUILD,
//                 stage on or off (R-WO-16): a descriptor naming a file that does not load is
//                 a broken bundle self-description, and declared-but-missing is a REFUSAL BY
//                 NAME from day one (RT-13.3) — never a downgrade to absent.
//   ABSENT        no declaration. Tolerated during the big-bang retrofit, but LOGGED BY NAME
//                 in the build output (RT-13.3: a build that quietly didn't check is
//                 indistinguishable from one that checked and passed). Never silent.
//   UNRESOLVABLE  the bundle itself does not resolve (un-ported forge, no descriptor). The
//                 roster records it and DOES NOT refuse: the forger's own phase-A refusal is
//                 the incumbent behavior for exactly this case, and this module firing first
//                 would change the error a broken recipe has always produced.
//
// THE STAGE RUNS POST-MATERIALIZATION (RT-13.2), invoked from materializeSchemaBlocks after
// the R-1 fidelity gate — the only point in the pipeline where the product graph exists AND
// its credentials are in scope (the container handle is deliberately never widened out of
// that function: the build result is JSON.stringify'd into resultText by actions.js, and a
// credential in a build log is disqualifying).
//
// VERDICT ADJUDICATION (R-WO-18): a validator ERROR fails the build; INVENTED > 0 fails the
// build (doctrine §5.3 — no acceptable nonzero value); LOST > 0 is tolerated and logged (the
// enrichment meter — a bundle's known backlog must not brick its own builds). The stage reads
// the NORMATIVE RT-6 fields { roundTripClean, inventedTotal, lostTotal } and REFUSES BY NAME
// a verdict lacking them — never an alternative-name chain, which would quietly undercount
// the class of invention a bundle folds into its total (the edfi crosswalk-guard precedent).
//
// THE STAGE SUMMARY (roundTrip/roundTripStageSummary.json) is written on EVERY -build, stage
// on or off — it is the GOLD_EVAL certification evidence (-goldEvalCheck reads it; R-WO-20),
// and its absence then genuinely means "build predates RT-13 or died before materialize".
//
// Async style: qtools taskListPlus/pipeRunner idioms; error-first callbacks; no async/await;
// no try/catch as control flow (the one try around require() below is the sanctioned boundary
// translation of a CONSTRUCTION fault into the callback channel — the same pattern build.js
// uses for llmClientFactory). camelCase only.

const fs = require('fs');
const path = require('path');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// minimal sequential async iterator (err-string convention) — the same local idiom build.js
// carries for unknown-length lists.
const eachSeries = (items, iterator, done) => {
	let index = 0;
	const step = () => {
		if (index >= items.length) {
			done('');
			return;
		}
		const item = items[index];
		index += 1;
		iterator(item, (err) => {
			if (err) {
				done(err);
				return;
			}
			step();
		});
	};
	step();
};

// the artifact names BOTH live validators land under their outputPath (code fact, verified
// against forges/edfi and forges/pesc roundTripValidator.js) — recorded in the summary so
// -goldEvalCheck can locate every verdict without per-standard knowledge.
const VERDICT_FILE_NAME = 'roundTripVerdict.json';
const STAGE_SUMMARY_FILE_NAME = 'roundTripStageSummary.json';
const STAGE_SUBDIR_NAME = 'roundTrip';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// ---------------------------------------------------------------
		// resolveValidatorApi — one declared validator file -> its api, or a named refusal.
		// Accommodates both incumbent export styles honestly (edfi exports the factory bare;
		// pesc exports the applied second stage — both yield the api on ONE call) and refuses,
		// by name, an export that yields no validate function either way.
		// ---------------------------------------------------------------
		const resolveValidatorApi = ({ validatorPath, requireValidator }) => {
			let moduleExport;
			// boundary translation of a load fault into the callback channel — the require IS
			// the RT-13.3 "does not load" check, caught only to name it.
			try {
				moduleExport = requireValidator(validatorPath);
			} catch (loadError) {
				return {
					error:
						`declared roundTripValidator '${validatorPath}' does not LOAD: ` +
						`${loadError.message}. Declared-but-missing is a refusal by name (RT-13.3), ` +
						`never a downgrade to absent.`,
				};
			}
			let validatorApi = moduleExport;
			if (typeof moduleExport === 'function') {
				try {
					validatorApi = moduleExport();
				} catch (constructError) {
					return {
						error:
							`declared roundTripValidator '${validatorPath}' throws at construction: ` +
							`${constructError.message}. A validator the builder cannot construct is ` +
							`declared-but-missing (RT-13.3).`,
					};
				}
			}
			if (!validatorApi || typeof validatorApi.validate !== 'function') {
				return {
					error:
						`declared roundTripValidator '${validatorPath}' exports no validate() ` +
						`function. The uniform RT-13 entry point is validate({containerName, boltUrl, ` +
						`user, password, snapshotPath, outputPath}, callback); a module without it is ` +
						`declared-but-missing (RT-13.3).`,
				};
			}
			return { validatorApi };
		};

		// ---------------------------------------------------------------
		// composeValidatorRoster — the recipe's standards, classified from their own
		// descriptors. bundleResolver is REQUIRED and injected (build passes the forger
		// component's resolveBundle static — the ONE descriptor authority; tests inject
		// doubles and fault shapes). requireValidator is the load seam (default: require).
		// ---------------------------------------------------------------
		const composeValidatorRoster = (
			{ standardTokens, bundleResolver, requireValidator = require } = {},
			callback,
		) => {
			if (!Array.isArray(standardTokens)) {
				callback(
					`${moduleName}.composeValidatorRoster: standardTokens must be an array of recipe ` +
						`standard tokens — there is no default roster.`,
				);
				return;
			}
			if (typeof bundleResolver !== 'function') {
				callback(
					`${moduleName}.composeValidatorRoster: a bundleResolver is REQUIRED (the caller ` +
						`passes the forger component's resolveBundle — the one parserDescriptor.ini ` +
						`authority). Nothing is substituted for it.`,
				);
				return;
			}
			const rosterRows = [];
			for (const oneToken of standardTokens) {
				const resolved = bundleResolver({ standard: oneToken });
				if (resolved.error) {
					// NOT a refusal here: the forger's own phase-A refusal is the incumbent error
					// for an unresolvable bundle, and it must keep firing exactly as it always has.
					rosterRows.push({
						token: oneToken,
						disposition: 'unresolvable',
						resolutionError: resolved.error,
					});
					continue;
				}
				const declaredFileName = resolved.roundTripValidatorFileName;
				if (declaredFileName === undefined || declaredFileName === null) {
					rosterRows.push({
						token: oneToken,
						standardName: resolved.standardName,
						disposition: 'absent',
					});
					continue;
				}
				if (`${declaredFileName}`.trim() === '') {
					callback(
						`${moduleName}.composeValidatorRoster: forge bundle '${oneToken}' declares a ` +
							`BLANK roundTripValidator in its parserDescriptor.ini. A blank declaration is ` +
							`not a declaration and not an absence — it is refused by name (RT-13.3).`,
					);
					return;
				}
				const validatorPath = path.join(resolved.bundleDir, `${declaredFileName}`.trim());
				if (!fs.existsSync(validatorPath)) {
					callback(
						`${moduleName}.composeValidatorRoster: forge bundle '${oneToken}' declares ` +
							`roundTripValidator='${declaredFileName}' but '${validatorPath}' does not ` +
							`EXIST. Declared-but-missing is a refusal by name (RT-13.3, R-WO-16: on every ` +
							`build, stage on or off), never a downgrade to absent.`,
					);
					return;
				}
				const apiResolution = resolveValidatorApi({ validatorPath, requireValidator });
				if (apiResolution.error) {
					callback(
						`${moduleName}.composeValidatorRoster: forge bundle '${oneToken}': ${apiResolution.error}`,
					);
					return;
				}
				if (
					typeof resolved.snapshotDirPath !== 'string' ||
					resolved.snapshotDirPath.trim() === ''
				) {
					callback(
						`${moduleName}.composeValidatorRoster: forge bundle '${oneToken}' declares a ` +
							`roundTripValidator but pins no defaultSnapshot — a validator with no answer ` +
							`key has nothing to diff against. Pin defaultSnapshot in parserDescriptor.ini ` +
							`(RT-12) or remove the declaration.`,
					);
					return;
				}
				rosterRows.push({
					token: oneToken,
					standardName: resolved.standardName,
					disposition: 'declared',
					validatorPath,
					validatorApi: apiResolution.validatorApi,
					snapshotDirPath: resolved.snapshotDirPath,
				});
			}
			callback('', {
				rosterRows,
				declaredTokens: rosterRows
					.filter((oneRow) => oneRow.disposition === 'declared')
					.map((oneRow) => oneRow.token),
				absentTokens: rosterRows
					.filter((oneRow) => oneRow.disposition === 'absent')
					.map((oneRow) => oneRow.token),
				unresolvableTokens: rosterRows
					.filter((oneRow) => oneRow.disposition === 'unresolvable')
					.map((oneRow) => oneRow.token),
			});
		};

		// ---------------------------------------------------------------
		// adjudicateVerdict — the R-WO-18 disposition rule over the NORMATIVE RT-6 fields.
		// Returns { error } (a named refusal or a build-failing invention) or { rowSummary }.
		// ---------------------------------------------------------------
		const adjudicateVerdict = ({ oneRow, verdict, verdictDirPath }) => {
			const missingFields = ['roundTripClean', 'inventedTotal', 'lostTotal'].filter(
				(oneFieldName) => verdict === undefined || verdict === null || verdict[oneFieldName] === undefined,
			);
			if (missingFields.length) {
				return {
					error:
						`the '${oneRow.token}' verdict lacks the normative RT-6 field(s) ` +
						`${missingFields.join(', ')} — the builder adjudicates on these with zero ` +
						`per-standard knowledge, and a verdict it cannot adjudicate is a nonconforming ` +
						`instrument, refused by name (never read through an alternative-name chain).`,
				};
			}
			if (verdict.inventedTotal > 0) {
				return {
					error:
						`the '${oneRow.token}' round trip reports inventedTotal=${verdict.inventedTotal}. ` +
						`INVENTED must be 0 at all times, in every bundle, from the first run (doctrine ` +
						`§5.3, R-WO-18) — the graph or the instrument asserted something the source never ` +
						`said, and the build FAILS. Verdict detail: ${path.join(verdictDirPath, VERDICT_FILE_NAME)}`,
				};
			}
			return {
				rowSummary: {
					token: oneRow.token,
					standardName: oneRow.standardName,
					disposition: 'declared',
					ran: true,
					roundTripClean: verdict.roundTripClean,
					inventedTotal: verdict.inventedTotal,
					lostTotal: verdict.lostTotal,
					snapshotDirPath: oneRow.snapshotDirPath,
					verdictPath: path.join(verdictDirPath, VERDICT_FILE_NAME),
				},
			};
		};

		// ---------------------------------------------------------------
		// writeStageSummary — the certification evidence, written on every build (stage on or
		// off). A write failure fails the build by name: an unwritten summary would make the
		// stage's disposition unprovable at promotion time.
		// ---------------------------------------------------------------
		const writeStageSummary = ({ outputDirPath, summary }, callback) => {
			const stageDirPath = path.join(outputDirPath, STAGE_SUBDIR_NAME);
			fs.mkdir(stageDirPath, { recursive: true }, (mkdirError) => {
				if (mkdirError) {
					callback(
						`${moduleName}: cannot create the stage output directory '${stageDirPath}': ` +
							`${mkdirError.message}`,
					);
					return;
				}
				const summaryFilePath = path.join(stageDirPath, STAGE_SUMMARY_FILE_NAME);
				fs.writeFile(summaryFilePath, JSON.stringify(summary, null, '\t'), (writeError) => {
					if (writeError) {
						callback(
							`${moduleName}: cannot write the stage summary '${summaryFilePath}': ` +
								`${writeError.message}`,
						);
						return;
					}
					callback('', summaryFilePath);
				});
			});
		};

		// ---------------------------------------------------------------
		// runRoundTripStage — the post-materialization stage itself.
		//   stageSpec (REQUIRED, composed by build()):
		//     { mode: 'build', enabled, disabledReason?, roster, outputDirPath }
		//     { mode: 'replayNotApplicable' }
		//   containerHandle: the replayManager handle for the PRODUCT graph (build mode only)
		//   xLog: the process logger
		// ---------------------------------------------------------------
		const runRoundTripStage = ({ stageSpec, containerHandle, xLog } = {}, callback) => {
			if (!stageSpec || typeof stageSpec.mode !== 'string') {
				callback(
					`${moduleName}.runRoundTripStage: a stageSpec is REQUIRED (build() composes it; ` +
						`-replay passes mode 'replayNotApplicable') — an absent spec would make a ` +
						`skipped stage indistinguishable from a run one, the exact silence RT-13.3 forbids.`,
				);
				return;
			}
			if (!xLog || typeof xLog.status !== 'function') {
				callback(`${moduleName}.runRoundTripStage: xLog is REQUIRED and has no default.`);
				return;
			}
			if (stageSpec.mode === 'replayNotApplicable') {
				// R-WO-19: a VISIBLE non-run. -replay reproduces a stored manifest; the round trip
				// belongs to the build that composed it (RT-13.2), and this line says so by name.
				xLog.status(
					`  [roundTrip] stage not applicable to -replay (the round trip runs at build ` +
						`time, against the build that composed the manifest)`,
				);
				callback('', { stageRan: false, disposition: 'replayNotApplicable' });
				return;
			}
			if (stageSpec.mode !== 'build') {
				callback(
					`${moduleName}.runRoundTripStage: unknown stageSpec.mode '${stageSpec.mode}' — ` +
						`the declared modes are 'build' and 'replayNotApplicable'. Nothing was substituted.`,
				);
				return;
			}
			const { enabled, disabledReason, roster, outputDirPath } = stageSpec;
			if (typeof outputDirPath !== 'string' || outputDirPath.trim() === '') {
				callback(
					`${moduleName}.runRoundTripStage: stageSpec.outputDirPath is REQUIRED — the stage ` +
						`summary is the GOLD_EVAL certification evidence and must land with the build ` +
						`outputs (RT-6), so a build with nowhere to write it cannot run.`,
				);
				return;
			}
			if (!roster || !Array.isArray(roster.rosterRows)) {
				callback(
					`${moduleName}.runRoundTripStage: stageSpec.roster (from composeValidatorRoster) ` +
						`is REQUIRED and has no default.`,
				);
				return;
			}

			// ---- stage OFF: the never-silent disposition line + the summary, nothing else ----
			if (enabled !== true) {
				const reasonText = disabledReason || 'recipe default (roundTripStage absent)';
				xLog.status(
					`  [roundTrip] stage OFF (${reasonText}) — GOLD_EVAL certification requires every ` +
						`declared validator to have run and reported (doctrine §7.4)`,
				);
				writeStageSummary(
					{
						outputDirPath,
						summary: {
							stageRan: false,
							disposition: `off: ${reasonText}`,
							declaredTokens: roster.declaredTokens,
							absentTokens: roster.absentTokens,
							standards: roster.rosterRows.map((oneRow) => ({
								token: oneRow.token,
								standardName: oneRow.standardName,
								disposition: oneRow.disposition,
								ran: false,
							})),
						},
					},
					(writeError, summaryFilePath) => {
						if (writeError) {
							callback(writeError);
							return;
						}
						callback('', { stageRan: false, disposition: `off: ${reasonText}`, summaryFilePath });
					},
				);
				return;
			}

			// ---- stage ON ----
			if (
				!containerHandle ||
				typeof containerHandle.containerName !== 'string' ||
				typeof containerHandle.boltUrl !== 'string' ||
				typeof containerHandle.user !== 'string' ||
				typeof containerHandle.password !== 'string'
			) {
				callback(
					`${moduleName}.runRoundTripStage: a containerHandle carrying containerName, ` +
						`boltUrl, user and password is REQUIRED to run declared validators — the builder ` +
						`supplies the bolt triple (doctrine §7.5); nothing is guessed from the environment.`,
				);
				return;
			}

			// declared-ABSENT logging, BY NAME, one line per bundle — never a count, never silent
			// (RT-13.3: tolerated during the big-bang retrofit, but always printed).
			roster.rosterRows
				.filter((oneRow) => oneRow.disposition === 'absent')
				.forEach((oneRow) => {
					xLog.status(
						`  [roundTrip] declared-ABSENT: '${oneRow.token}' (${oneRow.standardName}) — no ` +
							`roundTripValidator in parserDescriptor.ini (tolerated during the big-bang ` +
							`retrofit; logged, never silent)`,
					);
				});

			const declaredRows = roster.rosterRows.filter(
				(oneRow) => oneRow.disposition === 'declared',
			);
			const rowSummaryList = [];

			eachSeries(
				declaredRows,
				(oneRow, rowDone) => {
					const verdictDirPath = path.join(outputDirPath, STAGE_SUBDIR_NAME, oneRow.token);
					xLog.status(
						`  [roundTrip] validating ${oneRow.standardName} against ` +
							`'${containerHandle.containerName}' (snapshot: ${oneRow.snapshotDirPath})`,
					);
					oneRow.validatorApi.validate(
						{
							containerName: containerHandle.containerName,
							boltUrl: containerHandle.boltUrl,
							user: containerHandle.user,
							password: containerHandle.password,
							snapshotPath: oneRow.snapshotDirPath,
							outputPath: verdictDirPath,
						},
						(validateError, verdict) => {
							if (validateError) {
								rowDone(
									`${moduleName}: the '${oneRow.token}' roundTripValidator FAILED: ` +
										`${validateError}`,
								);
								return;
							}
							const adjudicated = adjudicateVerdict({ oneRow, verdict, verdictDirPath });
							if (adjudicated.error) {
								rowDone(`${moduleName}: ${adjudicated.error}`);
								return;
							}
							xLog.status(
								`  [roundTrip] ${oneRow.standardName}: reproduced with ` +
									`inventedTotal=${verdict.inventedTotal}, lostTotal=${verdict.lostTotal}, ` +
									`roundTripClean=${verdict.roundTripClean} -> ${adjudicated.rowSummary.verdictPath}`,
							);
							rowSummaryList.push(adjudicated.rowSummary);
							rowDone('');
						},
					);
				},
				(stageError) => {
					// the summary is written EVEN ON FAILURE (what ran before the failure is
					// evidence an operator needs), then the stage's own error is reported.
					const summary = {
						stageRan: true,
						disposition: stageError ? `FAILED: ${stageError}` : 'ran',
						containerName: containerHandle.containerName,
						declaredTokens: roster.declaredTokens,
						absentTokens: roster.absentTokens,
						standards: roster.rosterRows.map((oneRow) => {
							const ranRow = rowSummaryList.find(
								(oneSummaryRow) => oneSummaryRow.token === oneRow.token,
							);
							return (
								ranRow || {
									token: oneRow.token,
									standardName: oneRow.standardName,
									disposition: oneRow.disposition,
									ran: false,
								}
							);
						}),
					};
					writeStageSummary({ outputDirPath, summary }, (writeError, summaryFilePath) => {
						if (stageError) {
							callback(
								writeError
									? `${stageError} (and the stage summary also failed to write: ${writeError})`
									: stageError,
							);
							return;
						}
						if (writeError) {
							callback(writeError);
							return;
						}
						callback('', {
							stageRan: true,
							disposition: 'ran',
							summaryFilePath,
							standards: summary.standards,
						});
					});
				},
			);
		};

		return { composeValidatorRoster, runRoundTripStage };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
// artifact-name constants exported as statics so -goldEvalCheck and the suites name the SAME
// files this module writes — one authority, no hopeful literals.
module.exports.VERDICT_FILE_NAME = VERDICT_FILE_NAME;
module.exports.STAGE_SUMMARY_FILE_NAME = STAGE_SUMMARY_FILE_NAME;
module.exports.STAGE_SUBDIR_NAME = STAGE_SUBDIR_NAME;
