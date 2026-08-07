'use strict';

// roundTripValidator.js (forge-pesc260805) — THE PHASE 5 DELIVERABLE. Reads the materialized
// pesc260805 graph over bolt, re-emits the SOURCE-TIER PROJECTION as XSD, diffs it against the
// committed snapshot, and writes the verdict artifact.
//
// THE ROUND TRIP IN ONE LINE: canonical source -> forge -> schema block -> loader -> materialized
// graph -> RE-EMISSION (lib/roundTripSourceEmitter) -> diff against the ingested source. The
// re-emission reads the GRAPH, never the forge's own output; the source bytes enter EXACTLY ONCE,
// at the final comparison, as the answer key.
//
// UNIFORM INVOCATION SIGNATURE — builder-callable with zero per-standard knowledge:
//
//   roundTripValidator.validate(
//     { containerName, boltUrl, user, password, snapshotPath, outputPath },
//     (error, verdict) => …
//   )
//
//   * bolt resolution: when boltUrl+user+password are all supplied (the builder's job) they are
//     used as handed; otherwise containerName is REQUIRED and the endpoint+credential are read
//     from the RUNNING CONTAINER. Neither present -> refusal by name. A port is NEVER taken from a
//     document: they are minted per build, and this campaign has a live case where a document's
//     port now belongs to a different graph entirely.
//   * snapshotPath: the pinned snapshot VERSION DIRECTORY. Its SHA256SUMS is verified before
//     anything is diffed — corrupt, absent or unlisted source is a refusal by name, never a skip.
//   * outputPath: directory for the artifacts. Created if absent.
//
// WHAT PHASE 5 CHANGED, AND WHY EACH CHANGE EXISTS:
//
//   R-VAL-1 — the emission is scoped to `pescTier = 'source'`. The graph carries 632 synthetic and
//   63 derived nodes that are NOT source; emitting one would manufacture an INVENTED statement
//   against a file that never declared it. The scoping is ASSERTED in the reader, not assumed.
//
//   R-VAL-2 / O-2 — the whitespace collapse is GONE from the comparison, on evidence rather than on
//   principle. Measured before it was decided: it hid ZERO differences, 26,619 of 26,621
//   documentation literals already matching verbatim. Removal cost nothing and closed a dimension
//   that was otherwise permanently unfalsifiable. The dimension is still WATCHED — the diff
//   publishes `whitespaceOnlyDifference`, the count a collapse WOULD have absorbed, which is 0
//   today and becomes nonzero the moment whitespace fidelity moves.
//
//   R-VAL-6 — the five normative fields, plus the synthetic-reproducibility result as its own
//   field. `explicitlyOmitted` is claimed BY NAME through the canonicalizer's registry, never
//   assumed.
//
//   R-VAL-7 — stated in the verdict itself. "Semantically clean" is never reported as "identical".
//   PHASE 6 named FOUR constructs modelled on NEITHER side, whose absence therefore read as
//   fidelity: the COMPOSITOR, PREFIX BINDINGS, ELEMENT ORDER, and the NAMESPACE of a type
//   reference. PHASE 6.5 CLOSED THE FIRST THREE — the emitter writes the compositor and the xmlns
//   map from graph properties it had never read, and the canonicalizer models both on both sides,
//   which makes element order visible through the particle ordinal. ONE REMAINS: the namespace of a
//   type reference, since canonicalTypeRef strips the prefix, so a repoint to a same-named type in
//   a different namespace still canonicalizes identically. See semanticValidationLimit in the
//   verdict for the current statement; it is the authority and this comment is the summary.
//
// KNOWN RESIDUE THE VERDICT WILL SURFACE, enumerated so a successor can subtract it BY NAME rather
// than re-investigate it (test/test-artifacts/p5ParserDocumentationResidue.json): XSD permits an
// xs:annotation to carry several xs:documentation children and the forge parser keeps only the
// FIRST. 5 annotations lose 5 literals; 3 of those literals are EMPTY, so the real content loss is
// 2 — DocumentCategory and DocumentFormat in AcademicRecord_v1.14.0.xsd. That is a FORGE finding,
// not a validator finding, and repairing the parser is a later order's call.
//
// House style: qtools taskListPlus/pipeRunner, error-first callbacks, no async/await, no try/catch
// for control flow.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const canonicalLib = require('./lib/roundTripXsdCanonical')();
const emitterLib = require('./lib/roundTripSourceEmitter')();
const diffLib = require('./lib/roundTripDiff')();

// PHASE 6, R-VAL-4 — THE INDEPENDENT INSTRUMENT, invoked from HERE on TQ's ruling of 2026-08-06:
// it lives INSIDE the validator rather than beside it, because "the independence that matters is
// the ENGINE, not the caller. What must never happen is the third-party processor being replaced
// by more of our own code."
const independentCheckLib = require('./lib/xsd-independent-check/xsd-independent-check')();

// -1: the FIRST verdict of the rebuilt bundle. Deliberately NOT continuing the incumbent's
// numbering — the two measure different corpora and a shared version line would invite the
// comparison the work order forbids.
const VERDICT_VERSION = 'pesc260805RoundTripVerdict-1';

// THE NORMATIVE VERDICT CONTRACT (R-VAL-6). Declared as DATA so the shape can be checked rather
// than trusted, and so GATE 5's malformed-verdict refusal reads the same list the assembler wrote.
// A field added here is automatically required and automatically type-checked.
const REQUIRED_VERDICT_FIELD_LIST = [
	{ fieldName: 'roundTripClean', expectedType: 'boolean' },
	{ fieldName: 'inventedTotal', expectedType: 'number' },
	{ fieldName: 'lostTotal', expectedType: 'number' },
	{ fieldName: 'contentGapTotal', expectedType: 'number' },
	{ fieldName: 'explicitlyOmittedTotal', expectedType: 'number' },
	// R-VAL-5, carried as a DISTINCT field. Fidelity checking and reproducibility checking are
	// different instruments and the validator must never conflate them.
	{ fieldName: 'syntheticReproducible', expectedType: 'boolean' },
	{ fieldName: 'syntheticReproducibilityTotal', expectedType: 'number' },
	// THE COVERAGE IS REQUIRED, NOT MERELY CARRIED — corrected at the closing review, and the
	// correction is the whole point. The coverage block was ADDED to qualify
	// `syntheticReproducible`, and it was reported as travelling with the boolean so the two could
	// not be read apart. It travelled WHEN SUPPLIED, and nothing made it supplied: the input guard
	// asked only for {reproducible, comparedTotal}, this list named no coverage field, and this
	// bundle's OWN levers probe passed a coverage-less object and received a bare unqualified
	// `syntheticReproducible: true`. Two such verdicts were produced successfully.
	//
	// A qualification that an unqualified caller can omit is not a qualification. Naming the fields
	// here is what makes the claim unable to exist without its own scope attached.
	{ fieldName: 'syntheticReproducibility.coverage.checkedRuleList', expectedType: 'array' },
	{ fieldName: 'syntheticReproducibility.coverage.uncheckedRuleList', expectedType: 'array' },
	{ fieldName: 'syntheticReproducibility.coverage.checkedNodeCount', expectedType: 'number' },
	{ fieldName: 'syntheticReproducibility.coverage.comparisonBasis', expectedType: 'string' },
	{ fieldName: 'syntheticReproducibility.coverage.statement', expectedType: 'string' },
];

// valueAtFieldPath — dotted-path read for the nested coverage rules above. Returns undefined for
// any missing link, which the shape check reports as ABSENT by the field's full path.
const valueAtFieldPath = (rootObject, fieldPath) =>
	String(fieldPath)
		.split('.')
		.reduce(
			(oneValue, oneSegment) =>
				oneValue === null || oneValue === undefined ? undefined : oneValue[oneSegment],
			rootObject,
		);

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// =====================================================================
		// verifyVerdictShape — GATE 5. A verdict missing a normative field, or carrying one of the
		// wrong type, is REFUSED BY NAME rather than published.
		//
		// WHY THIS IS A REFUSAL AND NOT A TEST. The build stage adjudicates on these fields with
		// zero per-standard knowledge: inventedTotal > 0 FAILS a build. A verdict whose
		// inventedTotal is absent, or is the string '0', would be read by a consumer as falsy and
		// pass — a malformed verdict is MORE dangerous than a failing one, because it fails open.
		// NaN is refused explicitly: it is typeof 'number' and would satisfy a naive type check
		// while making every comparison against it false.
		// =====================================================================
		const verifyVerdictShape = ({ verdict } = {}, callback) => {
			if (!verdict || typeof verdict !== 'object' || Array.isArray(verdict)) {
				callback(
					`${moduleName}.verifyVerdictShape: a verdict OBJECT is REQUIRED; got ` +
						`${Array.isArray(verdict) ? 'an array' : typeof verdict}. Refused by name.`,
				);
				return;
			}
			const faultList = [];
			REQUIRED_VERDICT_FIELD_LIST.forEach((oneFieldRule) => {
				const actualValue = valueAtFieldPath(verdict, oneFieldRule.fieldName);
				if (actualValue === undefined) {
					faultList.push(
						`'${oneFieldRule.fieldName}' is ABSENT (required, ${oneFieldRule.expectedType})`,
					);
					return;
				}
				// 'array' is checked explicitly because typeof an array is 'object', so a naive
				// typeof test would accept {} where a list is required.
				if (oneFieldRule.expectedType === 'array') {
					if (!Array.isArray(actualValue)) {
						faultList.push(
							`'${oneFieldRule.fieldName}' is ${typeof actualValue}, required array`,
						);
					}
					return;
				}
				if (typeof actualValue !== oneFieldRule.expectedType) {
					faultList.push(
						`'${oneFieldRule.fieldName}' is ${typeof actualValue} '${actualValue}', ` +
							`required ${oneFieldRule.expectedType}`,
					);
					return;
				}
				if (oneFieldRule.expectedType === 'number' && !Number.isFinite(actualValue)) {
					faultList.push(
						`'${oneFieldRule.fieldName}' is a non-finite number (${actualValue}) — NaN and ` +
							`Infinity satisfy a typeof check and then make every comparison against them false`,
					);
				}
			});
			if (faultList.length) {
				callback(
					`${moduleName}.verifyVerdictShape: the verdict is MALFORMED and is refused by name ` +
						`rather than published — the build stage adjudicates on these fields with zero ` +
						`per-standard knowledge, so a malformed verdict FAILS OPEN:\n  ${faultList.join('\n  ')}`,
				);
				return;
			}
			callback('', { verdict });
		};

		// =====================================================================
		// verifySnapshotDir — the provenance gate at the instrument's own door.
		// =====================================================================
		const verifySnapshotDir = ({ snapshotPath } = {}, callback) => {
			if (typeof snapshotPath !== 'string' || snapshotPath.trim() === '') {
				callback(
					`${moduleName}.verifySnapshotDir: snapshotPath is REQUIRED and has no default.`,
				);
				return;
			}
			if (!fs.existsSync(snapshotPath) || !fs.statSync(snapshotPath).isDirectory()) {
				callback(
					`${moduleName}.verifySnapshotDir: snapshot directory '${snapshotPath}' does not ` +
						`exist or is not a directory. See README_PROVENANCE.md beside the snapshot.`,
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
						`not run against unverifiable source.`,
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
							`NOT listed in SHA256SUMS — an unverifiable file is refused by name, never ` +
							`silently diffed.`,
					);
					return;
				}
				const fileBytes = fs.readFileSync(path.join(snapshotPath, oneFilename));
				const actualDigest = crypto.createHash('sha256').update(fileBytes).digest('hex');
				if (actualDigest !== listedDigest) {
					callback(
						`${moduleName}.verifySnapshotDir: '${oneFilename}' fails its SHA256SUMS check ` +
							`(expected ${listedDigest}, got ${actualDigest}). Corrupt or substituted source ` +
							`is refused by name.`,
					);
					return;
				}
				// THE COMPARISON SUBJECT IS THE ARTIFACT IDENTITY THE GRAPH ALREADY CARRIES, and
				// this line is the whole of the fix for the campaign's largest instrument defect.
				//
				// It used to be `sourceLabelFor(oneFilename)`, a VERSION-STRIPPED label inherited
				// from the incumbent to stay consistent with the forge's `sourceFile` property.
				// That was coarse-keying to match a coarse property, and `sourceFile` is not
				// identity and was never meant to be. On the incumbent's corpus, which held ONE
				// CoreMain, it was harmless. On this corpus it FUSED 46 of 64 files into 18 subject
				// spaces: all 14 CoreMain versions became the subject 'CoreMain', so a statement
				// lost from v1.17.0 was masked by the identical statement in v1.10.0, and
				// documentation reported 6,256 of 6,256 matched — fusion wearing fidelity's
				// clothes. It was found by a lever that came back NOT RED.
				//
				// This campaign exists BECAUSE PESC publishes many versions that share names.
				// R-ID-1 and D-1 settled a fully-qualified identity and the graph implements it
				// correctly; the comparator was discarding it at the last step. Keying on
				// `pescArtifact:<sha256>` — content-addressed, the one identity that can never
				// collide (DESIGN §4) — stops discarding it. No new identity scheme is invented
				// here; the campaign's own is simply honoured.
				//
				// Verified before the change, not assumed: all 64 disk digests correspond 1:1 to
				// graph PescArtifact stableIds, and stableId == 'pescArtifact:' + sha256 on 64 of
				// 64 nodes. Had they disagreed, this change would have reported TOTAL loss.
				fileRecordList.push({
					filename: oneFilename,
					fileLabel: `pescArtifact:${actualDigest}`,
					displayFilename: oneFilename,
					sha256: actualDigest,
					xsdText: fileBytes.toString('utf8'),
				});
			}
			for (const oneListedFilename of Object.keys(digestByListedFilename)) {
				if (!xsdFilenameList.includes(oneListedFilename)) {
					callback(
						`${moduleName}.verifySnapshotDir: SHA256SUMS lists '${oneListedFilename}' but the ` +
							`file is ABSENT from the snapshot — refused by name.`,
					);
					return;
				}
			}
			const combinedDigest = crypto
				.createHash('sha256')
				.update(
					fileRecordList
						.map((oneRecord) => `${oneRecord.filename}:${oneRecord.sha256}`)
						.join('\n'),
				)
				.digest('hex');
			callback('', { fileRecordList, combinedDigest });
		};

		// =====================================================================
		// validateWithReader — the whole instrument against an already-constructed reader.
		// =====================================================================
		const validateWithReader = (
			{
				reader,
				snapshotPath,
				outputPath,
				graphIdentity,
				syntheticReproducibility,
				// R-VAL-4. Absent means RUN IT — the default is documented here and in the stage
				// below rather than being silent, and an undocumented default is indistinguishable
				// from a defect. Only the literal `false` switches it off, and the verdict records
				// that it was switched off so an absent check can never read as a passing one.
				independentCheck: independentCheckRequested,
			} = {},
			callback,
		) => {
			if (typeof outputPath !== 'string' || outputPath.trim() === '') {
				callback(`${moduleName}.validateWithReader: outputPath is REQUIRED and has no default.`);
				return;
			}
			if (
				independentCheckRequested !== undefined &&
				typeof independentCheckRequested !== 'boolean'
			) {
				callback(
					`${moduleName}.validateWithReader: independentCheck must be a boolean when supplied; ` +
						`got ${typeof independentCheckRequested} (${JSON.stringify(independentCheckRequested)}). ` +
						`A non-boolean is REFUSED rather than coerced, because a truthy string would switch ` +
						`the second opinion on or off by accident.`,
				);
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
				emitterLib.emitFromReader({ reader }, (emitError, emitResult) => {
					if (emitError) {
						next(emitError);
						return;
					}
					next('', { ...args, ...emitResult });
				});
			});

			// write the emitted documents — a human can open the emission beside the source even
			// though the INSTRUMENT compares statements, not bytes.
			taskList.push((args, next) => {
				const emittedDirPath = path.join(outputPath, 'emitted');
				fs.mkdirSync(emittedDirPath, { recursive: true });
				args.emittedFileList.forEach((oneFile) => {
					fs.writeFileSync(
						path.join(emittedDirPath, `${oneFile.filename}`),
						oneFile.xsdText,
					);
				});
				next('', { ...args, emittedDirPath });
			});

			// =====================================================================
			// R-VAL-4 — THE INDEPENDENT INSTRUMENT. A conforming third-party XSD processor reads
			// the emitted documents and the source corpus and answers a question this validator
			// cannot ask itself: IS THE EMITTED DOCUMENT A SCHEMA AT ALL?
			//
			// WHY IT IS NOT FATAL. RT-13.3 makes a declared-but-broken validator refuse EVERY
			// build, stage on or off. A second opinion that can take a python environment down
			// with it must never be able to fail a build on its own. It REPORTS.
			//
			// WHY ITS ABSENCE IS STILL RECORDED, LOUDLY. An unavailable check must never read as
			// a passing one — that is the exact failure the whole gate suite exists to prevent.
			// Every path below writes an `independentCheck` block carrying an explicit status and
			// a statement saying in words what that status does and does not license.
			//
			// DEFAULT ON; opt out with `independentCheck: false`. MEASURED cost: a validation that takes
			// 3.3 seconds with the check off takes 26.9 seconds with it on, against this corpus of 64
			// files compiled twice. Documented here rather than hidden.
			// =====================================================================
			taskList.push((args, next) => {
				if (independentCheckRequested === false) {
					next('', {
						...args,
						independentCheck: {
							status: 'notRequested',
							statement:
								'The independent XSD instrument was explicitly switched off for this run. ' +
								'This is NOT a passing result and licenses no claim about whether the emitted ' +
								'documents are valid schemas.',
						},
					});
					return;
				}
				independentCheckLib.compareXsdCorpora(
					{
						sourceCorpusDirectory: snapshotPath,
						emittedCorpusDirectory: args.emittedDirPath,
						outputJsonPath: path.join(outputPath, 'independentXsdCheck.json'),
					},
					(independentError, independentOutcome) => {
						if (independentError) {
							next('', {
								...args,
								independentCheck: {
									status: 'unavailable',
									reason: independentError,
									statement:
										'The independent XSD instrument could not run. UNAVAILABLE IS NOT A ' +
										'PASS: nothing here licenses any claim about whether the emitted ' +
										'documents are valid schemas.',
								},
							});
							return;
						}
						const oneComparison = independentOutcome.comparison;
						independentCheckLib.renderComparisonText(
							{ comparison: oneComparison },
							(renderError, rendered) => {
								if (renderError) {
									next('', {
										...args,
										independentCheck: {
											status: 'unavailable',
											reason: renderError,
											statement:
												'The independent XSD comparison ran but could not be rendered. ' +
												'UNAVAILABLE IS NOT A PASS.',
										},
									});
									return;
								}
								fs.writeFileSync(
									path.join(outputPath, 'independentXsdCheck.report.txt'),
									rendered.text,
								);
								next('', {
									...args,
									independentCheck: {
										status: 'ran',
										processorClass: oneComparison.processorClass,
										xmlschemaVersion: oneComparison.xmlschemaVersion,
										sourceCompile: oneComparison.source,
										emittedCompile: oneComparison.emitted,
										compileAgreement: oneComparison.compileAgreement,
										emittedRefusalCauseTally: oneComparison.emittedRefusalCauseTally,
										componentComparison: oneComparison.componentComparison,
										// THE QUALIFIER TRAVELS WITH THE NUMBERS AND IS NOT OPTIONAL. The
										// component-level totals are computed ONLY over filenames that compiled
										// clean on BOTH sides. When that set is small a zero means THERE WAS
										// ALMOST NOTHING TO COMPARE — it does not mean agreement, and a reader
										// who is not told so will read it as fidelity.
										comparisonScopeStatement:
											`component-level differences are computed over the ` +
											`${oneComparison.compileAgreement.bothClean} of ` +
											`${oneComparison.compileAgreement.sharedFilenames} filenames that ` +
											`compiled clean on BOTH sides, covering ` +
											`${oneComparison.componentComparison.comparedTypeTotal} content models ` +
											`reached RECURSIVELY (global types, global elements, and every nested ` +
											`anonymous type). A zero over a small set means there was little to ` +
											`compare; it is NOT a fidelity claim. ` +
											`${oneComparison.componentComparison.traversalUnavailableTotal} content ` +
											`model(s) could not be walked on one or both sides and are EXCLUDED from ` +
											`every difference count — that exclusion is a measured incompleteness, ` +
											`never an agreement.`,
									},
								});
							},
						);
					},
				);
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
						fileList: args.emittedFileList.map((oneFile) => ({
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
						sourceCollapsedStatementKeys: args.sourceCanonical.collapsedStatementKeys,
						emittedCollapsedStatementKeys: args.emittedCanonical.collapsedStatementKeys,
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

			// canonicalization faults are FATAL, never advisory: a half-measured document must not
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

			// assemble the verdict, CHECK ITS SHAPE, then write.
			taskList.push((args, next) => {
				const headline = args.report.headline;

				// R-VAL-5 must be CLAIMED, never assumed. An absent reproducibility result is a
				// refusal, not a cheerful `true`.
				// COVERAGE IS PART OF THE CLAIM, not an optional adornment on it. The guard used
				// to ask only for {reproducible, comparedTotal}, which let a caller hand in a bare
				// boolean and receive a verdict asserting synthetic reproducibility with no scope
				// attached. A claim that can be made without its own limits stated is the thing
				// this campaign keeps paying for.
				const coverage = (syntheticReproducibility || {}).coverage;
				if (
					!syntheticReproducibility ||
					typeof syntheticReproducibility.reproducible !== 'boolean' ||
					typeof syntheticReproducibility.comparedTotal !== 'number' ||
					!coverage ||
					!Array.isArray(coverage.checkedRuleList) ||
					!Array.isArray(coverage.uncheckedRuleList) ||
					typeof coverage.checkedNodeCount !== 'number' ||
					typeof coverage.comparisonBasis !== 'string' ||
					typeof coverage.statement !== 'string'
				) {
					next(
						`${moduleName}.validateWithReader: a syntheticReproducibility result carrying ` +
							`{reproducible: boolean, comparedTotal: number} is REQUIRED. R-VAL-5 is a ` +
							`DISTINCT instrument from fidelity and its absence is refused by name — it is ` +
							`never defaulted to true, and a verdict that silently claimed reproducibility ` +
							`nobody measured would be worse than no verdict at all.`,
					);
					return;
				}

				const verdict = {
					verdictVersion: VERDICT_VERSION,
					standard: emitterLib.STANDARD_SOURCE,
					// roundTripClean: contentGap is what 'clean' means when it reaches zero, and
					// invention must be 0 at all times. explicitlyOmitted is excluded — it is
					// we-chose-not-to-carry, claimed by name, and is not loss.
					roundTripClean: headline.contentGap === 0 && headline.invented === 0,
					reproduced: headline.matched,
					// THE FIVE NORMATIVE FIELDS (R-VAL-6).
					inventedTotal: headline.invented,
					lostTotal: headline.contentGap,
					contentGapTotal: headline.contentGap,
					explicitlyOmittedTotal: headline.explicitlyOmitted,
					// R-VAL-5, its own field, never folded into the fidelity numbers.
					syntheticReproducible: syntheticReproducibility.reproducible,
					syntheticReproducibilityTotal: syntheticReproducibility.comparedTotal,
					syntheticReproducibility,
					// the raw set difference, under a name that says what it counts.
					notReproducedTotal: headline.notReproduced,
					// THE O-2 SENTINEL. 0 at adoption; nonzero means whitespace fidelity moved and
					// the incumbent's collapse would have reported clean regardless.
					whitespaceOnlyDifferenceTotal: headline.whitespaceOnlyDifference,
					// R-VAL-7, stated in the artifact rather than in a document nobody opens.
					// R-VAL-7. REWRITTEN AGAIN IN PHASE 6.5, BECAUSE THREE OF ITS FOUR CLAUSES BECAME
					// FALSE. Phase 6 correctly named compositor ABSENCE, prefix bindings and element
					// order as unmodelled; Phase 6.5 made the emitter write all three and the
					// canonicalizer model them on BOTH sides, so a declaration that still listed them
					// would be the same defect Phase 6 was penalised for, running in the opposite
					// direction. A LIMITATION THAT QUIETLY BECOMES FALSE IS ITS OWN DEFECT, and it is
					// the one nobody goes back to check. Rewritten rather than footnoted.
					semanticValidationLimit:
						'SEMANTIC round-trip: statement-set equality, not byte equality, and the ' +
						'statement set is the one THIS INSTRUMENT CHOOSES TO MODEL. WHAT IS MODELLED ' +
						'AS OF PHASE 6.5, each on BOTH sides: (1) THE COMPOSITOR — kind, effective ' +
						'occurrence, nesting, and the ORDERED particle list, as declaresContentModel / ' +
						'compositorKind / compositorMinOccurs / compositorMaxOccurs / particleAt:N ' +
						'statements; (2) PREFIX BINDINGS — declaresNamespacePrefix and boundNamespace ' +
						'per xmlns declaration; (3) ELEMENT ORDER within a content model, which the ' +
						'ordinal in particleAt:N makes visible. THE PHASE 6 DECLARATION THAT ELEMENT ' +
						'ORDER IS UNDETECTABLE IS RETRACTED ON EVIDENCE: a driven sibling swap in a ' +
						'graph row moves 2 statements and moved 0 under the previous form ' +
						'(test/probes/p65_contentModelLevers.js). WHAT REMAINS UNMODELLED, and is ' +
						'therefore invisible as loss rather than merely hard to see: (a) THE NAMESPACE ' +
						'OF A TYPE REFERENCE — canonicalTypeRef strips the prefix, so a reference ' +
						'repointed to a same-named type in a DIFFERENT namespace canonicalizes ' +
						'identically; this is R-ID-1 fusion surviving in the object space and it is the ' +
						'more serious of the residue; (b) ATTRIBUTE ORDER; (c) SEVERAL xs:documentation ' +
						'children of one xs:annotation, of which the forge keeps the first (see ' +
						'knownResidue). ALSO DECLARED, a measured boundary of the emitter rather than ' +
						'of this comparison: a container whose content model holds ONLY group ' +
						'references or wildcards declares no element children, so a missing ' +
						'contentModelShape there cannot be refused by name and shows up as ordinary ' +
						'loss in this diff instead. "Semantically clean" MUST NEVER be reported as ' +
						'"identical".',
					// =====================================================================
					// NAMED DEFECTS OF THIS INSTRUMENT, published in the verdict rather than in a
					// document nobody opens. These are defects in the VALIDATOR, not in the forge.
					// Elevated here on the supervisor's direction (JADE_PORTAL, 2026-08-06): "a
					// normative field that can silently under-report is worth more attention than a
					// missing feature."
					// =====================================================================
					namedDefectList: [
						{
							defectId: 'P6-D1',
							title:
								'explicitlyOmitted is assigned BY PREDICATE, so a genuine defect can be ' +
								'laundered into the "not loss" bucket and lostTotal under-reports it',
							severity: 'affects a NORMATIVE R-VAL-6 field',
							mechanism:
								'A statement is filed as explicitlyOmitted when its PREDICATE appears in ' +
								'the canonicalizer EXPLICITLY_OMITTED_PREDICATES registry — targetNamespace, ' +
								'importsNamespace, importsSchemaLocation, elementFormDefault, ' +
								'attributeFormDefault. Nothing tests whether the omission was actually ' +
								'DELIBERATE. The report calls that bucket "declarations the graph ' +
								'deliberately does not carry - CHOSEN, never lost". Since lostTotal carries ' +
								'contentGap ONLY, every statement laundered this way is subtracted from the ' +
								'headline loss figure.',
							demonstration:
								'OBSERVED 2026-08-06. One character altered inside one xs:documentation ' +
								'string in TestScoreReport_v1.1.0.xsd of a scratch corpus copy (exactly one ' +
								'differing byte by cmp; SHA256SUMS regenerated so the checksum gate was ' +
								'deliberately satisfied and the comparator actually reached). Because ' +
								'fileLabel is content-addressed the whole file decoupled: all EIGHT of its ' +
								'statements went unmatched. THREE were filed contentGap and FIVE were filed ' +
								'explicitlyOmitted. notReproduced rose 293 -> 301 while the normative ' +
								'lostTotal rose only 293 -> 296. Reproduce with ' +
								'test/probes/p6_explicitlyOmittedLaundering.js.',
							standingToday:
								'explicitlyOmittedTotal is 0 in the current build, so nothing is masked ' +
								'today. That is luck rather than safety: the path is live and was ' +
								'demonstrated, not inferred.',
							// SEVERITY BOUNDED HONESTLY, at the independent review's direction. The first
							// framing let this read as an escape route and in the demonstrated case it
							// is not one.
							severityCaveat:
								'IN THE DEMONSTRATION ABOVE inventedTotal ALSO moved 0 -> 8, and ' +
								'inventedTotal > 0 FAILS A BUILD, so that particular defect does not escape ' +
								'— it is caught loudly by a different gate. What is proven is that the ' +
								'LAUNDERING PATH IS LIVE. The dangerous case is a defect that launders ' +
								'WITHOUT moving inventedTotal; that case is NOT demonstrated and is NOT ' +
								'claimed.',
							ownedBy: 'NOT repaired in Phase 6. Phase 6 is anti-cheat; it finds and reports.',
						},
					],
					// R-VAL-4. ALWAYS PRESENT, in every one of its states — ran, unavailable or
					// notRequested — so that a reader can never mistake a missing block for a clean
					// one. `|| 0` and friends are deliberately absent here: the stage above sets this
					// on every path, so an undefined value means the stage did not run and that is a
					// defect to surface rather than a zero to invent.
					independentCheck: args.independentCheck,
					knownResidue: {
						multiDocumentationAnnotations: 5,
						multiDocumentationLiteralsDiscarded: 5,
						multiDocumentationNonEmptyLiteralsLost: 2,
						note:
							'XSD permits several xs:documentation children in one xs:annotation; the forge ' +
							'parser keeps only the FIRST. 3 of the 5 discarded literals are empty, so the ' +
							'real content loss is 2 (DocumentCategory and DocumentFormat, ' +
							'AcademicRecord_v1.14.0.xsd). FORGE finding, not a validator finding; enumerated ' +
							'in test/test-artifacts/p5ParserDocumentationResidue.json. Subtract it by name ' +
							'before reading a nonzero lostTotal as a regression.',
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
						...args.graphSummary,
					},
					report: args.report,
				};

				verifyVerdictShape({ verdict }, (shapeError) => {
					if (shapeError) {
						next(shapeError);
						return;
					}
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
						fs.writeFileSync(
							path.join(outputPath, 'roundTrip.report.txt'),
							renderResult.reportText,
						);
						next('', { ...args, verdict });
					});
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
		// validate — THE UNIFORM ENTRY POINT.
		// =====================================================================
		const validate = (
			{
				containerName,
				boltUrl,
				user,
				password,
				snapshotPath,
				outputPath,
				// R-VAL-4 (Phase 6). Omit to RUN the independent instrument; pass the literal
				// `false` to switch it off. Either way the verdict carries an `independentCheck`
				// block saying which happened, because an absent second opinion must never be
				// readable as a passing one.
				independentCheck,
			} = {},
			callback,
		) => {
			const haveHandedBolt = Boolean(
				boltUrl && user && password !== undefined && password !== null,
			);
			if (!haveHandedBolt && (typeof containerName !== 'string' || containerName.trim() === '')) {
				callback(
					`${moduleName}.validate: either containerName OR the full bolt triple ` +
						`(boltUrl, user, password) is REQUIRED — there is no default graph to read and ` +
						`one is not guessed at.`,
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
				emitterLib.resolveContainerBolt({ containerName }, (resolveError, resolved) => {
					if (resolveError) {
						next(resolveError);
						return;
					}
					next('', { ...args, resolvedBolt: resolved });
				});
			});

			// R-VAL-5 runs against the PRESERVED INPUTS and the graph, before the verdict is
			// assembled, because the verdict refuses to exist without its result.
			taskList.push((args, next) => {
				const reproducibilityLib = require('./lib/roundTripSyntheticReproducibility')();
				reproducibilityLib.checkReproducibility(
					{
						snapshotPath,
						boltUrl: args.resolvedBolt.boltUrl,
						user: args.resolvedBolt.user,
						password: args.resolvedBolt.password,
					},
					(checkError, checkResult) => {
						if (checkError) {
							next(checkError);
							return;
						}
						next('', { ...args, syntheticReproducibility: checkResult });
					},
				);
			});

			taskList.push((args, next) => {
				const reader = emitterLib.makeNeo4jSourceTierReader({
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
						syntheticReproducibility: args.syntheticReproducibility,
						// R-VAL-4, carried through from the caller. Passing `undefined` when the
						// caller said nothing is deliberate: validateWithReader reads absence as
						// RUN IT, and coercing it to a boolean here would bury that decision in
						// two places instead of one.
						independentCheck,
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
			verifyVerdictShape,
			REQUIRED_VERDICT_FIELD_LIST,
			VERDICT_VERSION,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
