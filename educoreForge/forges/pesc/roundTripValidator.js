'use strict';

// roundTripValidator.js (forge-pesc) — THE DOCTRINE-FIXED ENTRY POINT (RT-1, RT-13). Reads a
// MATERIALIZED PESC graph over bolt, re-emits XSD-shaped semantic content, diffs it against the
// committed snapshot, and writes the RT-6 verdict artifact.
//
// THE ROUND TRIP IN ONE LINE: canonical source -> forge -> schema block -> loader -> materialized
// graph -> RE-EMISSION (this module) -> diff against the ingested source. The re-emission reads the
// GRAPH (lib/roundTripCompiler.js explains why that is the only honest reading); the source bytes
// enter EXACTLY ONCE, at the final comparison, as the answer key (RT-5).
//
// UNIFORM INVOCATION SIGNATURE (doctrine §7.5) — builder-callable with zero per-standard knowledge:
//
//   roundTripValidator.validate(
//     { containerName, boltUrl, user, password, snapshotPath, outputPath },
//     (error, verdict) => …
//   )
//
//   * bolt resolution: when boltUrl+user+password are all supplied (the builder's job), they are
//     used as handed; otherwise containerName is REQUIRED and the endpoint+credential are read
//     from the running container via docker inspect (lib/roundTripCompiler.resolveContainerBolt).
//     Neither present -> refusal by name.
//   * snapshotPath: the pinned snapshot VERSION DIRECTORY (assets/standardSourceData/<version>).
//     Its SHA256SUMS is verified before anything is diffed — corrupt/absent/unlisted source is a
//     refusal by name pointing at README_PROVENANCE.md (RT-3), never a skip.
//   * outputPath: directory for the build artifacts — roundTripVerdict.json, roundTrip.report.txt,
//     and emitted/<label>.emitted.xsd. Created if absent.
//
// THE VERDICT (RT-6): REPRODUCED / LOST / INVENTED counts with located per-predicate detail, LOST
// split into explicitlyOmitted vs contentGap (supervisor refinement 2026-08-03; the category was
// named declaredContext until doctrine amendment A13, 2026-08-04), the snapshot
// identity (per-file SHA256 + combined digest), the graph identity (container, root provenance,
// node/edge counts), and the single top-line boolean roundTripClean = (LOST===0 && INVENTED===0).
// INVENTED must be 0 at all times; LOST is the work-remaining meter.
//
// House style: qtools taskListPlus/pipeRunner, error-first callbacks (R7), no async/await, no
// try/catch for control flow. camelCase only.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const canonicalLib = require('./lib/roundTripXsdCanonical')();
const compilerLib = require('./lib/roundTripCompiler')();
const diffLib = require('./lib/roundTripDiff')();

// -2 (doctrine amendment A13, 2026-08-04): lostTotal changed MEANING — it counts contentGap
// alone now, with explicitly-omitted declarations reported separately and excluded from loss.
// The bump is load-bearing, not cosmetic: it is how a reader tells which arithmetic produced
// a number. The RT-13 stage additionally REFUSES any verdict lacking the two A13 fields, so a
// stale -1 artifact is refused by name rather than silently read under the new meaning.
const VERDICT_VERSION = 'pescRoundTripVerdict-2';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// -----
		// verifySnapshotDir — RT-3 at the instrument's own door: list the .xsd set, verify every
		// byte against SHA256SUMS, refuse by name on any mismatch, absence, or unlisted file.
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
			const xsdFilenameList = fs
				.readdirSync(snapshotPath)
				.filter((oneName) => oneName.endsWith('.xsd'))
				.sort();
			if (!xsdFilenameList.length) {
				callback(
					`${moduleName}.verifySnapshotDir: '${snapshotPath}' holds no .xsd files. A snapshot ` +
						`with no source is a missing input, not an empty diff.`,
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
						digestByListedFilename[lineMatch[2]] = lineMatch[1];
					}
				});

			const fileRecordList = [];
			for (const oneFilename of xsdFilenameList) {
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
					fileLabel: canonicalLib.sourceLabelFor(oneFilename),
					sha256: actualDigest,
					xsdText: fileBytes.toString('utf8'),
				});
			}
			for (const oneListedFilename of Object.keys(digestByListedFilename)) {
				if (!xsdFilenameList.includes(oneListedFilename)) {
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
				.update(fileRecordList.map((oneRecord) => `${oneRecord.filename}:${oneRecord.sha256}`).join('\n'))
				.digest('hex');
			callback('', { fileRecordList, combinedDigest });
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

			// write the emitted documents — a human can open the emission beside the source even
			// though the INSTRUMENT compares statements, not bytes.
			taskList.push((args, next) => {
				const emittedDirPath = path.join(outputPath, 'emitted');
				fs.mkdirSync(emittedDirPath, { recursive: true });
				args.emittedFiles.forEach((oneFile) => {
					fs.writeFileSync(
						path.join(emittedDirPath, `${oneFile.fileLabel}.emitted.xsd`),
						oneFile.xsdText,
					);
				});
				next('', args);
			});

			taskList.push((args, next) => {
				canonicalLib.canonicalizeXsdFileSet(
					{
						fileList: args.snapshot.fileRecordList.map((oneRecord) => ({
							xsdText: oneRecord.xsdText,
							fileLabel: oneRecord.fileLabel,
						})),
					},
					(canonError, canonResult) => {
						if (canonError) {
							next(canonError);
							return;
						}
						next('', { ...args, sourceCanonical: canonResult });
					},
				);
			});

			taskList.push((args, next) => {
				canonicalLib.canonicalizeXsdFileSet(
					{
						fileList: args.emittedFiles.map((oneFile) => ({
							xsdText: oneFile.xsdText,
							fileLabel: oneFile.fileLabel,
						})),
					},
					(canonError, canonResult) => {
						if (canonError) {
							next(canonError);
							return;
						}
						next('', { ...args, emittedCanonical: canonResult });
					},
				);
			});

			taskList.push((args, next) => {
				diffLib.diffStatements(
					{
						sourceStatements: args.sourceCanonical.statements,
						emittedStatements: args.emittedCanonical.statements,
						sourceStats: args.sourceCanonical.stats,
						emittedStats: args.emittedCanonical.stats,
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

			// canonicalization faults are FATAL (never advisory): a half-measured document must not
			// produce a verdict someone might believe.
			taskList.push((args, next) => {
				if (args.report.canonicalizationFaults.length) {
					next(
						`${moduleName}.validateWithReader: ${args.report.canonicalizationFaults.length} ` +
							`canonicalization fault(s) — refusing to issue a verdict over a half-measured ` +
							`document:\n  ${args.report.canonicalizationFaults.join('\n  ')}`,
					);
					return;
				}
				next('', args);
			});

			// assemble + write the RT-6 verdict artifact and the human report, from the SAME object.
			taskList.push((args, next) => {
				const headline = args.report.headline;
				const verdict = {
					verdictVersion: VERDICT_VERSION,
					standard: compilerLib.STANDARD_SOURCE,
					// A13 RECONCILIATION, not a relaxation. Doctrine §5.3 has always said in its
					// contentGap bullet that contentGap "is what 'clean' means when it reaches zero";
					// the single line defining roundTripClean as LOST === 0 contradicted that, and
					// LOST included the deliberate omissions. Under the old formula PESC was
					// STRUCTURALLY INCAPABLE of ever reporting clean — close all 732 content gaps and
					// the 73 chosen omissions still held it false forever. This line now agrees with
					// the definition the doctrine already gave.
					roundTripClean: headline.contentGap === 0 && headline.invented === 0,
					reproduced: headline.matched,
					lost: headline.contentGap,
					// lostTotal / inventedTotal — the normative RT-6 builder-facing names (R-WO-21,
					// 2026-08-04): the RT-13 stage adjudicates on {roundTripClean, inventedTotal,
					// lostTotal, contentGapTotal, explicitlyOmittedTotal} with zero per-standard
					// knowledge. PESC has no guard-class invention channel, so the invention totals
					// equal the diff counts.
					//
					// lostTotal IS contentGap ALONE as of A13. notReproducedTotal preserves the old
					// arithmetic under a name that says what it actually counts, so no number is
					// destroyed by the change — 805 stays readable, it is simply no longer called loss.
					lostTotal: headline.contentGap,
					contentGapTotal: headline.contentGap,
					explicitlyOmittedTotal: headline.explicitlyOmitted,
					notReproducedTotal: headline.notReproduced,
					invented: headline.invented,
					inventedTotal: headline.invented,
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
					next('', { ...args, resolvedBolt: { containerName: containerName || '', boltUrl, user, password } });
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
				const reader = compilerLib.makeNeo4jPescReader({
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
