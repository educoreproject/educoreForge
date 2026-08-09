'use strict';

// roundTripValidator.js (forge-sif) — THE DOCTRINE-FIXED ENTRY POINT (RT-1, RT-13). Reads a
// MATERIALIZED SIF graph over bolt, re-emits SIF statements ORDER-SENSITIVELY, diffs them against
// the committed snapshot's ImplementationSpecification TSV, and writes the RT-6 verdict artifact.
//
// THE ROUND TRIP IN ONE LINE: canonical source -> forge -> schema block -> loader -> materialized
// graph -> RE-EMISSION (this module) -> diff against the ingested source. The re-emission reads
// the GRAPH (lib/roundTripSifCompiler.js explains why that is the only honest reading); the
// source bytes enter EXACTLY ONCE, at the final comparison, as the answer key (RT-5).
//
// SIF'S EQUIVALENCE POLICY IS ORDER-SENSITIVE (R-SF-1, TQ: "Element sequence is important" —
// the deliberate divergence from pesc's order-excluded policy). Mechanism per ruling R-SF-7:
// all-pairs precedence statements per sibling group (see lib/roundTripSifCanonical.js). Order
// semantics are document-order-only per ruling R-SF-8: the instrument NEVER consults the
// scratch-held published-XSD corpus — normativity, if ever wanted, is forge-side enrichment via
// a ruled, checksummed snapshot input.
//
// UNIFORM INVOCATION SIGNATURE (doctrine §7.5) — builder-callable with zero per-standard
// knowledge:
//
//   roundTripValidator.validate(
//     { containerName, boltUrl, user, password, snapshotPath, outputPath },
//     (error, verdict) => …
//   )
//
//   * bolt resolution: when boltUrl+user+password are all supplied (the builder's job), they are
//     used as handed; otherwise containerName is REQUIRED and the endpoint+credential are read
//     from the running container via docker inspect (lib/roundTripSifCompiler.resolveContainerBolt).
//     Neither present -> refusal by name.
//   * snapshotPath: the pinned snapshot VERSION DIRECTORY (assets/standardSourceData/<version>).
//     Its SHA256SUMS is verified before anything is diffed — corrupt/absent/unlisted source is a
//     refusal by name pointing at README_PROVENANCE.md (RT-3), never a skip. The directory must
//     hold EXACTLY ONE ImplementationSpecification .tsv (refIdResolutionMap.tsv aside) — zero or
//     several is a refusal, mirroring the forge's own candidate rule.
//   * outputPath: directory for the build artifacts — roundTripVerdict.json, roundTrip.report.txt,
//     and emitted/sifStatements.emitted.txt. Created if absent.
//
// DIFF SCOPE, STATED HONESTLY: the statements diffed are the ImplementationSpecification TSV's —
// the canonical source per ruling R-SF-6. The snapshot's second input, refIdResolutionMap.tsv,
// is an IN-HOUSE curated crosswalk (acquisition class human-artifact-snapshot; its graph effect
// is the REFERENCES interpretation ruled D5): its bytes are checksum-verified at this door like
// every listed file, but it states no SIF facts and is not in the statement domain. The verdict
// records this scoping under diffScope.
//
// THE VERDICT (RT-6): REPRODUCED / LOST / INVENTED counts with a FULL located lostDetailList
// (every LOST row carries its TSV line, category, and backlog label — no anonymous loss), the
// orderMismatch pairing (R-SF-7's named sequence changes), the snapshot identity (per-file
// SHA256 + combined digest), the graph identity (container, root provenance, node/edge counts),
// the single top-line boolean roundTripClean = (LOST===0 && INVENTED===0), and the SCALE report
// (runtime, memory, statement censuses, and the largest group's member/pair counts — the
// supervisor's R-SF-7 addition: the next campaign inherits the worst case as a number, not a
// fear). INVENTED must be 0 at all times; LOST is the work-remaining meter.
//
// House style: qtools taskListPlus/pipeRunner, error-first callbacks (R7), no async/await, no
// try/catch for control flow. camelCase only.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const canonicalLib = require('./lib/roundTripSifCanonical')();
const compilerLib = require('./lib/roundTripSifCompiler')();
const diffLib = require('./lib/roundTripDiff')();

// -2 (doctrine amendment A13, 2026-08-04): lostTotal counts contentGap ALONE now, with
// explicitly-omitted declarations reported separately and excluded from loss. SIF's
// explicitlyOmitted registry is empty, so no SIF number moves — but the verdict must still
// declare which arithmetic produced it, and the RT-13 stage refuses a verdict lacking the two
// A13 fields so a stale -1 artifact cannot be read under the new meaning.
const VERDICT_VERSION = 'sifRoundTripVerdict-2';
const RESOLUTION_MAP_FILENAME = 'refIdResolutionMap.tsv';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// -----
		// verifySnapshotDir — RT-3 at the instrument's own door: identify the ONE main TSV, verify
		// every listed byte against SHA256SUMS, refuse by name on any mismatch, absence, unlisted
		// source file, or candidate-count violation.
		const verifySnapshotDir = ({ snapshotPath } = {}, callback) => {
			if (typeof snapshotPath !== 'string' || snapshotPath.trim() === '') {
				callback(`${moduleName}.verifySnapshotDir: snapshotPath is REQUIRED and has no default.`);
				return;
			}
			if (!fs.existsSync(snapshotPath) || !fs.statSync(snapshotPath).isDirectory()) {
				callback(
					`${moduleName}.verifySnapshotDir: snapshot directory '${snapshotPath}' does not exist ` +
						`or is not a directory. The acquisition recipe lives in README_PROVENANCE.md beside ` +
						`the snapshot.`,
				);
				return;
			}
			const tsvFilenameList = fs
				.readdirSync(snapshotPath)
				.filter((oneName) => oneName.endsWith('.tsv'))
				.sort();
			const mainTsvCandidateList = tsvFilenameList.filter(
				(oneName) => oneName !== RESOLUTION_MAP_FILENAME,
			);
			if (!mainTsvCandidateList.length) {
				callback(
					`${moduleName}.verifySnapshotDir: '${snapshotPath}' holds no ImplementationSpecification ` +
						`.tsv. A snapshot with no source is a missing input, not an empty diff. See ` +
						`README_PROVENANCE.md in the snapshot directory.`,
				);
				return;
			}
			if (mainTsvCandidateList.length > 1) {
				callback(
					`${moduleName}.verifySnapshotDir: '${snapshotPath}' holds ${mainTsvCandidateList.length} ` +
						`candidate source .tsv files (${mainTsvCandidateList.join(', ')}) — expected exactly ` +
						`one; a stray second source would silently measure a different standard. Refused by name.`,
				);
				return;
			}
			const sumsFilePath = path.join(snapshotPath, 'SHA256SUMS');
			if (!fs.existsSync(sumsFilePath)) {
				callback(
					`${moduleName}.verifySnapshotDir: '${snapshotPath}' has no SHA256SUMS. The diff will ` +
						`not run against unverifiable source (RT-3); see README_PROVENANCE.md in the ` +
						`snapshot directory for the provenance contract.`,
				);
				return;
			}
			const digestByListedFilename = {};
			fs.readFileSync(sumsFilePath, 'utf8')
				.split('\n')
				.map((oneLine) => oneLine.trim())
				.filter((oneLine) => oneLine !== '')
				.forEach((oneLine) => {
					const lineMatch = oneLine.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
					if (lineMatch) {
						digestByListedFilename[lineMatch[2].trim()] = lineMatch[1];
					}
				});

			const fileRecordList = [];
			for (const oneFilename of tsvFilenameList) {
				const listedDigest = digestByListedFilename[oneFilename];
				if (!listedDigest) {
					callback(
						`${moduleName}.verifySnapshotDir: '${oneFilename}' is present in the snapshot but ` +
							`NOT listed in SHA256SUMS — an unverifiable file is refused by name (RT-3), never ` +
							`silently diffed. See README_PROVENANCE.md.`,
					);
					return;
				}
				const fileBytes = fs.readFileSync(path.join(snapshotPath, oneFilename));
				const actualDigest = crypto.createHash('sha256').update(fileBytes).digest('hex');
				if (actualDigest !== listedDigest) {
					callback(
						`${moduleName}.verifySnapshotDir: '${oneFilename}' fails its SHA256SUMS check ` +
							`(expected ${listedDigest}, got ${actualDigest}). Corrupt or substituted source is ` +
							`refused by name (RT-3); reacquire per README_PROVENANCE.md.`,
					);
					return;
				}
				fileRecordList.push({
					filename: oneFilename,
					sha256: actualDigest,
					tsvText: fileBytes.toString('utf8'),
				});
			}
			for (const oneListedFilename of Object.keys(digestByListedFilename)) {
				if (!tsvFilenameList.includes(oneListedFilename)) {
					callback(
						`${moduleName}.verifySnapshotDir: SHA256SUMS lists '${oneListedFilename}' but the ` +
							`file is ABSENT from the snapshot — refused by name (RT-3); reacquire per ` +
							`README_PROVENANCE.md.`,
					);
					return;
				}
			}
			const combinedDigest = crypto
				.createHash('sha256')
				.update(
					fileRecordList.map((oneRecord) => `${oneRecord.filename}:${oneRecord.sha256}`).join('\n'),
				)
				.digest('hex');
			callback('', {
				fileRecordList,
				combinedDigest,
				mainTsvFilename: mainTsvCandidateList[0],
			});
		};

		// =====================================================================
		// validateWithReader — the whole instrument against an ALREADY-CONSTRUCTED reader.
		// The fixture and the twins drive this seam with a graph double; validate() drives it
		// with the bolt reader. Identical machinery either way — the double cannot be special-
		// cased because nothing downstream knows which it got.
		// =====================================================================

		const validateWithReader = (
			{ reader, snapshotPath, outputPath, graphIdentity } = {},
			callback,
		) => {
			if (typeof outputPath !== 'string' || outputPath.trim() === '') {
				callback(`${moduleName}.validateWithReader: outputPath is REQUIRED and has no default.`);
				return;
			}
			const startedAtMs = Date.now();

			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				verifySnapshotDir({ snapshotPath }, (verifyError, verifyResult) => {
					if (verifyError) {
						next(verifyError);
						return;
					}
					next('', { ...args, snapshot: verifyResult });
				});
			});

			taskList.push((args, next) => {
				compilerLib.compileFromReader({ reader }, (compileError, compileResult) => {
					if (compileError) {
						next(compileError);
						return;
					}
					next('', { ...args, ...compileResult });
				});
			});

			taskList.push((args, next) => {
				canonicalLib.statementsFromSifGraph({ sifGraph: args.sifGraph }, (mintError, mintResult) => {
					if (mintError) {
						next(mintError);
						return;
					}
					next('', {
						...args,
						emittedStatements: mintResult.statements,
						emittedStats: mintResult.stats,
						emissionFaultList: mintResult.faultList,
					});
				});
			});

			// emission faults are FATAL (never advisory): a half-measured graph must not produce a
			// verdict someone might believe.
			taskList.push((args, next) => {
				if (args.emissionFaultList.length) {
					next(
						`${moduleName}.validateWithReader: ${args.emissionFaultList.length} emission ` +
							`fault(s) — refusing to issue a verdict over a half-measured graph:\n  ` +
							args.emissionFaultList.join('\n  '),
					);
					return;
				}
				next('', args);
			});

			taskList.push((args, next) => {
				const mainTsvRecord = args.snapshot.fileRecordList.find(
					(oneRecord) => oneRecord.filename === args.snapshot.mainTsvFilename,
				);
				canonicalLib.statementsFromTsvText(
					{ tsvText: mainTsvRecord.tsvText },
					(mintError, mintResult) => {
						if (mintError) {
							next(mintError);
							return;
						}
						next('', {
							...args,
							sourceStatements: mintResult.statements,
							sourceStats: mintResult.stats,
						});
					},
				);
			});

			// write the emitted statement set — a human can open the emission beside the source even
			// though the INSTRUMENT compares statements, not bytes.
			taskList.push((args, next) => {
				const emittedDirPath = path.join(outputPath, 'emitted');
				fs.mkdirSync(emittedDirPath, { recursive: true });
				const emittedLines = Array.from(args.emittedStatements.keys()).sort();
				fs.writeFileSync(
					path.join(emittedDirPath, 'sifStatements.emitted.txt'),
					`${emittedLines.join('\n')}\n`,
				);
				next('', args);
			});

			taskList.push((args, next) => {
				diffLib.diffStatements(
					{
						sourceStatements: args.sourceStatements,
						emittedStatements: args.emittedStatements,
						sourceStats: args.sourceStats,
						emittedStats: args.emittedStats,
						context: {
							snapshotPath,
							snapshotDigest: args.snapshot.combinedDigest,
							...(graphIdentity || {}),
						},
					},
					(diffError, diffResult) => {
						if (diffError) {
							next(diffError);
							return;
						}
						next('', { ...args, report: diffResult.report });
					},
				);
			});

			// assemble + write the RT-6 verdict artifact and the human report, from the SAME object.
			taskList.push((args, next) => {
				const headline = args.report.headline;
				const memoryUsage = process.memoryUsage();
				const verdict = {
					verdictVersion: VERDICT_VERSION,
					standard: compilerLib.STANDARD_SOURCE,
					// A13 RECONCILIATION (not a relaxation): doctrine §5.3's contentGap bullet has
					// always said contentGap "is what 'clean' means when it reaches zero"; the single
					// line defining roundTripClean as LOST === 0 contradicted it. SIF's verdict does
					// not move — its explicitlyOmitted registry is empty by design.
					roundTripClean: headline.contentGap === 0 && headline.invented === 0,
					reproduced: headline.matched,
					lost: headline.contentGap,
					// lostTotal / inventedTotal — the normative RT-6 builder-facing names (R-WO-21,
					// 2026-08-04; A6 compliance addendum applied post-sign-off): the LIVE RT-13 stage
					// adjudicates on {roundTripClean, inventedTotal, lostTotal, contentGapTotal,
					// explicitlyOmittedTotal} with zero
					// per-standard knowledge and REFUSES BY NAME a verdict lacking them. SIF has no
					// guard-class invention channel (the edfi crosswalk guard has no SIF analogue —
					// refIdResolutionMap is out of the statement domain, not guarded within it), so
					// both totals equal the diff counts. These lines add NAMES, never move numbers.
					// lostTotal IS contentGap ALONE as of A13; notReproducedTotal preserves the old
					// arithmetic under a name that says what it counts, so no number is destroyed.
					lostTotal: headline.contentGap,
					contentGapTotal: headline.contentGap,
					explicitlyOmittedTotal: headline.explicitlyOmitted,
					notReproducedTotal: headline.notReproduced,
					invented: headline.invented,
					inventedTotal: headline.invented,
					orderMismatches: headline.orderMismatches,
					// ⟪R-VAL-7 for SIF⟫ THE MODELLING QUALIFICATION TRAVELS WITH THE ZERO.
					//
					// Declared here rather than derived by a reader of this file. Until 2026-08-09 this
					// bundle declared nothing, so the builder substituted "NONE DECLARED BY THIS BUNDLE"
					// and the SIF certificate had to qualify the numbers by READING THIS MODULE — accurate
					// the day it was written and silently wrong the moment anyone edits below. pesc260805
					// paid for that lesson: three of its four clauses became FALSE when Phase 6.5 made the
					// emitter model what they said was unmodelled. A LIMITATION THAT QUIETLY BECOMES FALSE
					// IS ITS OWN DEFECT, and it is the one nobody goes back to check.
					//
					// SO: IF YOU CHANGE WHAT IS MODELLED, REWRITE THIS STRING IN THE SAME COMMIT. Never as
					// a follow-up. A stale limit is worse than an absent one, because absence is marked.
					semanticValidationLimit:
						'SEMANTIC round-trip against the INGESTED SNAPSHOT: statement-set equality over ' +
						'the statement set THIS INSTRUMENT CHOOSES TO MODEL, not byte equality and not ' +
						'completeness of the SIF model. WHAT IS MODELLED, on BOTH sides and from ' +
						'independent minters (statementsFromTsvText never sees the graph; ' +
						'statementsFromSifGraph never opens a file; NEITHER touches the forge\'s own ' +
						'lib/parser.js, so the validator cannot merely prove the forge agrees with ' +
						'itself): (1) ONE PREDICATE PER SOURCE COLUMN — fieldName, fieldMandatory, ' +
						'fieldCharacteristics, fieldType, fieldDescription, fieldCedsId, fieldFormat — so ' +
						'ANYTHING THE SPREADSHEET HAS NO COLUMN FOR IS NOT MODELLED AT ALL; (2) ELEMENT ' +
						'ORDER as all-pairs precedesInGroup statements, DOCUMENT-ORDER-ONLY (R-SF-8): the ' +
						'instrument never consults the published XSD for compositor facts, so xs:sequence ' +
						'versus xs:choice is invisible to it and normativity is never claimed. WHAT IS ' +
						'NOT MODELLED, and is therefore invisible as loss rather than merely hard to ' +
						'see: (a) ABSENT IS ABSENT (RT-2 symmetry) — an empty cell mints NO statement, so ' +
						'"this field has no description" and "this field\'s description was lost" are ' +
						'indistinguishable by statement presence; (b) LEADING AND TRAILING WHITESPACE in a ' +
						'cell is trimmed and is not a statement; (c) CHOICE-GROUP MEMBERSHIP, which the ' +
						'export cannot express at all (errata S-2). ' +
						'AND THE ONE THAT SIZES EVERYTHING ABOVE — THE SOURCE ITSELF IS INCOMPLETE, ' +
						'MEASURED 2026-08-09 (errata S-1, S-3, Q-1; probes test/probes/): the flattened ' +
						'export gives a row to every leaf field and every attribute and NO ROW TO ANY ' +
						'ELEMENT THAT HAS ELEMENT CHILDREN — 6,586 container paths across 153 of the 159 ' +
						'objects, of which 1,887 are declared maxOccurs="unbounded" in the generated XSD, ' +
						'plus 12 further repeatability declarations absent on rows that DO exist. ' +
						'THEREFORE lostTotal 0 MEANS FIDELITY TO THE INGESTED SNAPSHOT AND NEVER ' +
						'COMPLETENESS OF THE SIF MODEL: this graph cannot distinguish a single-valued ' +
						'element from a repeating collection anywhere those 1,899 declarations apply, ' +
						'because the source never stated it. The two published artifacts do NOT ' +
						'contradict each other — across all 15,620 export rows the spreadsheet\'s ' +
						'Characteristics column and the XSD\'s sifChar annotation state different values ' +
						'ZERO times; the spreadsheet is simply less expressive. ' +
						'"Semantically clean" MUST NEVER be reported as "complete".',
					diffScope: {
						statementSource: args.snapshot.mainTsvFilename,
						outOfScopeInputs: [
							`${RESOLUTION_MAP_FILENAME} (in-house curated crosswalk — checksum-verified, ` +
								`states no SIF facts; its graph effect is the D5-ruled REFERENCES interpretation)`,
						],
					},
					// SCALE (the phase's research finding, reported not suffered — including the
					// largest group by name and pair count, the supervisor's R-SF-7 addition).
					scaleReport: {
						runtimeMs: Date.now() - startedAtMs,
						rssBytes: memoryUsage.rss,
						heapUsedBytes: memoryUsage.heapUsed,
						sourceStatements: headline.sourceStatements,
						emittedStatements: headline.emittedStatements,
						sourcePrecedencePairs: args.sourceStats.precedencePairCount,
						emittedPrecedencePairs: args.emittedStats.precedencePairCount,
						sourceGroupCount: args.sourceStats.groupCount,
						largestSourceGroup: args.sourceStats.largestGroup,
						largestEmittedGroup: args.emittedStats.largestGroup,
					},
					snapshot: {
						snapshotPath,
						combinedDigest: args.snapshot.combinedDigest,
						files: args.snapshot.fileRecordList.map((oneRecord) => ({
							filename: oneRecord.filename,
							sha256: oneRecord.sha256,
						})),
					},
					graph: {
						...(graphIdentity || {}),
						rootProperties: args.graphSummary.rootProperties,
						nodeCounts: args.graphSummary.nodeCounts,
						edgeCounts: args.graphSummary.edgeCounts,
					},
					report: args.report,
				};
				diffLib.renderReportText({ report: args.report }, (renderError, renderResult) => {
					if (renderError) {
						next(renderError);
						return;
					}
					fs.mkdirSync(outputPath, { recursive: true });
					fs.writeFileSync(
						path.join(outputPath, 'roundTripVerdict.json'),
						`${JSON.stringify(verdict, null, 1)}\n`,
					);
					fs.writeFileSync(path.join(outputPath, 'roundTrip.report.txt'), renderResult.reportText);
					next('', { ...args, verdict });
				});
			});

			pipeRunner(taskList.getList(), {}, (pipeError, args) => {
				if (pipeError) {
					callback(pipeError);
					return;
				}
				callback('', args.verdict);
			});
		};

		// =====================================================================
		// validate — THE RT-13 UNIFORM ENTRY POINT.
		// =====================================================================

		const validate = (
			{ containerName, boltUrl, user, password, snapshotPath, outputPath } = {},
			callback,
		) => {
			const haveHandedBolt = Boolean(boltUrl && user && password !== undefined && password !== null);
			if (!haveHandedBolt && (typeof containerName !== 'string' || containerName.trim() === '')) {
				callback(
					`${moduleName}.validate: either containerName OR the full bolt triple ` +
						`(boltUrl, user, password) is REQUIRED — there is no default graph to read and one ` +
						`is not guessed at.`,
				);
				return;
			}

			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				if (haveHandedBolt) {
					next('', {
						...args,
						resolvedBolt: { containerName: containerName || '', boltUrl, user, password },
					});
					return;
				}
				compilerLib.resolveContainerBolt({ containerName }, (resolveError, resolved) => {
					if (resolveError) {
						next(resolveError);
						return;
					}
					next('', { ...args, resolvedBolt: resolved });
				});
			});

			taskList.push((args, next) => {
				const reader = compilerLib.makeNeo4jSifReader({
					boltUrl: args.resolvedBolt.boltUrl,
					user: args.resolvedBolt.user,
					password: args.resolvedBolt.password,
				});
				validateWithReader(
					{
						reader,
						snapshotPath,
						outputPath,
						graphIdentity: {
							containerName: args.resolvedBolt.containerName,
							boltUrl: args.resolvedBolt.boltUrl,
						},
					},
					(validateError, verdict) => {
						reader.close((closeError) => {
							if (validateError) {
								next(validateError);
								return;
							}
							if (closeError) {
								next(closeError);
								return;
							}
							next('', { ...args, verdict });
						});
					},
				);
			});

			pipeRunner(taskList.getList(), {}, (pipeError, args) => {
				if (pipeError) {
					callback(pipeError);
					return;
				}
				callback('', args.verdict);
			});
		};

		return {
			validate,
			validateWithReader,
			verifySnapshotDir,
			VERDICT_VERSION,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
