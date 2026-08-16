'use strict';

// roundTripValidator.js (forge-ceds) — THE DOCTRINE-FIXED ENTRY POINT (RT-1, RT-13). Reads a
// MATERIALIZED CEDS graph over bolt, compiles it back into RDF/XML, diffs that emission against
// the pinned source ontology as canonical statement SETS, and writes the RT-6 verdict artifact.
//
// WHY THIS FILE EXISTS AT ALL, AND WHAT IT IS *NOT*. CEDS has carried a complete round-trip
// instrument since 2026-08-02 — lib/roundTripCanonical.js, lib/roundTripCompiler.js and
// lib/roundTripDiff.js are the REFERENCE IMPLEMENTATION the sif, pesc and edfi bundles were
// adapted FROM. What CEDS lacked was the uniform DECLARED entry point the RT-13 builder stage can
// invoke, so CEDS was declared-ABSENT to the stage and tolerated by the retrofit clause. This
// module adds plumbing, not measurement: it wires the existing instrument to the stage's seam and
// emits its numbers in the RT-6 verdict shape. It changes nothing about what CEDS forges and
// nothing about how the diff decides what counts as the same statement.
//
// ⚠️ TWO OTHER CALLERS DRIVE THE SAME LIBS, AND A READER SHOULD KNOW BEFORE BEING SURPRISED:
//   * `graphBuilder -cedsRoundTrip --containerName=<name>` (apps/graph-builder/lib/actions.js)
//     — the operator's ad-hoc measuring stick. Writes a report + JSON sidecar under
//     system/dataStores/cedsRoundTrip/. Produces no RT-6 verdict.
//   * the R-1 in-build fidelity gate (apps/graph-builder/lib/build.js runCedsFidelityGate) —
//     runs on EVERY build whose recipe contains ceds and FAILS THE BUILD on loss beyond the named
//     `--allowFidelityLoss` allowance, invention always. It compiles to a temp file, prints the
//     numbers, and unlinks. Produces no artifact either.
// So on a stage-ON CEDS build the graph is compiled and the ontology canonicalized TWICE: once by
// R-1 and once here. That duplication is real and is recorded as a decision item rather than
// resolved, because build.js is shared builder infrastructure and outside this bundle's scope.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CEDS BEARS THE HIGHEST BAR IN THE FLEET, BY RULING — read this before "fixing" the empty registry
// ─────────────────────────────────────────────────────────────────────────────────────────────
// The other three bundles may claim an EXPLICITLY-OMITTED class: content the graph deliberately
// does not carry, reported by name and excluded from loss (doctrine amendment A13). CEDS is
// FORBIDDEN one.
//
//   ⟪TQ, 2026-08-02⟫ "If it is in the OWL, it has to come out of the graph."
//   ⟪README_roundTripContract.md⟫ "The manifest of exclusions is empty. Zero loss means zero,
//    with nothing argued at the margin."
//
// EXPLICITLY_OMITTED_PREDICATES below is therefore empty ON PURPOSE and by authority, not by
// oversight and not because nobody got round to filling it. Its consequence is exact: CEDS's
// roundTripClean requires LITERAL zero content gap with no margin available anywhere. Adding an
// entry to that list is not a maintenance edit — it is a reversal of a TQ ruling and needs one.
//
// The list is nonetheless a real, load-bearing parameter and not decoration: assembleVerdictNumbers
// PARTITIONS the diff's per-predicate loss rows against it, so a populated list would genuinely
// move contentGapTotal and explicitlyOmittedTotal apart. That is what makes the zero an OBSERVED
// arithmetic result rather than a literal nobody can falsify (the Phase 2 lesson: an assertion
// that cannot go red is not enforcement).
//
// UNIFORM INVOCATION SIGNATURE (doctrine §7.5) — builder-callable with zero per-standard
// knowledge:
//
//   roundTripValidator.validate(
//     { containerName, boltUrl, user, password, snapshotPath, outputPath },
//     (error, verdict) => …
//   )
//
//   * bolt resolution: when boltUrl+user+password are all supplied (the builder's job) they are
//     used as handed; otherwise containerName is REQUIRED and the endpoint+credential are read
//     from the running container (lib/roundTripCompiler.resolveContainerBolt). Neither present is
//     a refusal by name — there is no default graph and one is not guessed at.
//   * snapshotPath: the pinned snapshot VERSION DIRECTORY (assets/standardSourceData/<version>).
//     Its SHA256SUMS is verified before anything is diffed — corrupt, absent, unlisted or
//     unaccounted-for source is a refusal by name (RT-3) pointing at README_PROVENANCE.md, never
//     a skip. The directory must hold EXACTLY ONE .rdf; zero or several is a refusal, mirroring
//     sif's one-TSV rule, because a stray second ontology would silently measure something else.
//   * outputPath: directory for the artifacts — roundTripVerdict.json, roundTrip.report.txt and
//     emitted/cedsOntology.emitted.rdf. Created if absent.
//
// THE VERDICT (RT-6 at verdictVersion -2) carries the five NORMATIVE fields the RT-13 stage
// adjudicates on with zero per-standard knowledge — roundTripClean, inventedTotal, lostTotal,
// contentGapTotal, explicitlyOmittedTotal — plus notReproducedTotal, which preserves the
// pre-A13 everything-not-reproduced arithmetic under a name that says what it counts, so no
// number is destroyed. roundTripClean is (contentGapTotal === 0 && inventedTotal === 0).
// INVENTED must be 0 at all times; contentGap is the work-remaining meter.
//
// House style: qtools taskListPlus/pipeRunner, error-first callbacks (R7), no async/await, no
// try/catch for control flow. camelCase only.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const compilerLib = require('./lib/roundTripCompiler')();
const diffLib = require('./lib/roundTripDiff')();

// -2 (doctrine amendment A13, 2026-08-04): lostTotal counts contentGap ALONE, with
// explicitly-omitted declarations reported separately and excluded from loss. CEDS's registry is
// empty by ruling (see the header), so no CEDS number moves — but the verdict must still declare
// WHICH ARITHMETIC produced it, and the RT-13 stage refuses a verdict lacking the two A13 fields
// so a stale -1 artifact cannot be read under the new meaning. This bundle has never issued a -1.
const VERDICT_VERSION = 'cedsRoundTripVerdict-2';

const STANDARD_SOURCE = 'CEDS';
const SOURCE_FILE_EXTENSION = '.rdf';
const CHECKSUM_FILE_NAME = 'SHA256SUMS';
const PROVENANCE_FILE_NAME = 'README_PROVENANCE.md';
const EMITTED_FILE_NAME = 'cedsOntology.emitted.rdf';
const VERDICT_FILE_NAME = 'roundTripVerdict.json';
const REPORT_FILE_NAME = 'roundTrip.report.txt';

// THE EXPLICITLY-OMITTED REGISTRY — EMPTY BY RULING, NOT BY OVERSIGHT. See the header block.
// It is the visible place a future ruling would claim a predicate, and it is a real parameter to
// assembleVerdictNumbers rather than an unused constant.
const EXPLICITLY_OMITTED_PREDICATES = [];

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// -----
		// verifySnapshotDir — RT-3 at the instrument's own door. Identify the ONE source ontology,
		// verify every listed byte against SHA256SUMS, and refuse BY NAME on any mismatch, absence,
		// unlisted source file, or candidate-count violation. Never a skip: a diff run against
		// source nobody verified is a measurement of an unknown thing.
		const verifySnapshotDir = ({ snapshotPath } = {}, callback) => {
			if (typeof snapshotPath !== 'string' || snapshotPath.trim() === '') {
				callback(`${moduleName}.verifySnapshotDir: snapshotPath is REQUIRED and has no default.`);
				return;
			}
			if (!fs.existsSync(snapshotPath) || !fs.statSync(snapshotPath).isDirectory()) {
				callback(
					`${moduleName}.verifySnapshotDir: snapshot directory '${snapshotPath}' does not exist ` +
						`or is not a directory. The acquisition recipe lives in ${PROVENANCE_FILE_NAME} beside ` +
						`the snapshot.`,
				);
				return;
			}
			const ontologyFilenameList = fs
				.readdirSync(snapshotPath)
				.filter((oneName) => oneName.toLowerCase().endsWith(SOURCE_FILE_EXTENSION))
				.sort();
			if (!ontologyFilenameList.length) {
				callback(
					`${moduleName}.verifySnapshotDir: '${snapshotPath}' holds no ${SOURCE_FILE_EXTENSION} ` +
						`ontology. A snapshot with no source is a missing input, not an empty diff. See ` +
						`${PROVENANCE_FILE_NAME} in the snapshot directory.`,
				);
				return;
			}
			if (ontologyFilenameList.length > 1) {
				callback(
					`${moduleName}.verifySnapshotDir: '${snapshotPath}' holds ${ontologyFilenameList.length} ` +
						`candidate ${SOURCE_FILE_EXTENSION} files (${ontologyFilenameList.join(', ')}) — ` +
						`expected exactly one; a stray second ontology would silently measure a different ` +
						`standard. Refused by name.`,
				);
				return;
			}
			const sumsFilePath = path.join(snapshotPath, CHECKSUM_FILE_NAME);
			if (!fs.existsSync(sumsFilePath)) {
				callback(
					`${moduleName}.verifySnapshotDir: '${snapshotPath}' has no ${CHECKSUM_FILE_NAME}. The ` +
						`diff will not run against unverifiable source (RT-3); see ${PROVENANCE_FILE_NAME} in ` +
						`the snapshot directory for the provenance contract.`,
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
			for (const oneFilename of ontologyFilenameList) {
				const listedDigest = digestByListedFilename[oneFilename];
				if (!listedDigest) {
					callback(
						`${moduleName}.verifySnapshotDir: '${oneFilename}' is present in the snapshot but ` +
							`NOT listed in ${CHECKSUM_FILE_NAME} — an unverifiable file is refused by name ` +
							`(RT-3), never silently diffed. See ${PROVENANCE_FILE_NAME}.`,
					);
					return;
				}
				const fileBytes = fs.readFileSync(path.join(snapshotPath, oneFilename));
				const actualDigest = crypto.createHash('sha256').update(fileBytes).digest('hex');
				if (actualDigest !== listedDigest) {
					callback(
						`${moduleName}.verifySnapshotDir: '${oneFilename}' fails its ${CHECKSUM_FILE_NAME} ` +
							`check (expected ${listedDigest}, got ${actualDigest}). Corrupt or substituted ` +
							`source is refused by name (RT-3); reacquire per ${PROVENANCE_FILE_NAME}.`,
					);
					return;
				}
				fileRecordList.push({ filename: oneFilename, sha256: actualDigest });
			}
			for (const oneListedFilename of Object.keys(digestByListedFilename)) {
				if (!ontologyFilenameList.includes(oneListedFilename)) {
					callback(
						`${moduleName}.verifySnapshotDir: ${CHECKSUM_FILE_NAME} lists ` +
							`'${oneListedFilename}' but the file is ABSENT from the snapshot — refused by name ` +
							`(RT-3); reacquire per ${PROVENANCE_FILE_NAME}.`,
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
				ontologyFilename: ontologyFilenameList[0],
				ontologyFilePath: path.join(snapshotPath, ontologyFilenameList[0]),
			});
		};

		// -----
		// assembleVerdictNumbers — THE A13 PARTITION, as a pure synchronous seam.
		//
		// Returns { error } or { numbers }. Synchronous and pure on purpose: it is arithmetic over
		// a report object, it needs no graph, no bolt and no Docker, and that is what lets the
		// discriminating fixture exist at all.
		//
		// THE PARTITION IS PERFORMED, NOT ASSUMED. The CEDS diff (lib/roundTripDiff.js) reports
		// matched / lost / invented and does NOT categorize loss — unlike the sif and pesc diffs,
		// which carry the category natively. Rather than teach the diff a category CEDS is ruled
		// not to have (an instrument builder does not reach into the thing being measured), the
		// split is computed HERE by walking the per-predicate loss rows against the registry.
		// With the registry empty this yields explicitlyOmittedTotal 0 and
		// contentGapTotal === notReproducedTotal — an OBSERVED result of real arithmetic, which a
		// hardcoded zero would not be.
		//
		// THE INVARIANT IS CHECKED AT THIS DOOR AND REFUSED BY NAME. If the per-predicate rows do
		// not account for exactly the headline loss, the partition is measuring something other
		// than the loss it claims to partition, and a verdict built on it would be confidently
		// wrong. That is precisely the class of defect this campaign keeps meeting: a tool that
		// answers when it should refuse.
		const assembleVerdictNumbers = ({
			report,
			explicitlyOmittedPredicateList = EXPLICITLY_OMITTED_PREDICATES,
		} = {}) => {
			if (!report || !report.headline) {
				return {
					error:
						`${moduleName}.assembleVerdictNumbers: a diff report with a headline is REQUIRED. ` +
						`Nothing is substituted for it.`,
				};
			}
			if (!Array.isArray(report.perPredicate)) {
				return {
					error:
						`${moduleName}.assembleVerdictNumbers: the report carries no perPredicate array, so ` +
						`the loss cannot be partitioned into contentGap and explicitlyOmitted. A verdict ` +
						`whose A13 split was guessed rather than computed is refused by name.`,
				};
			}
			if (!Array.isArray(explicitlyOmittedPredicateList)) {
				return {
					error:
						`${moduleName}.assembleVerdictNumbers: explicitlyOmittedPredicateList must be an ` +
						`array of predicate URIs. OMIT it to take this bundle's declared registry, which ` +
						`is EMPTY BY RULING (TQ 2026-08-02: if it is in the OWL, it has to come out of the ` +
						`graph); pass an array to override it for a test. A non-array is neither of those ` +
						`and is refused rather than coerced into one of them.`,
				};
			}

			const omittedPredicateSet = new Set(explicitlyOmittedPredicateList);
			let explicitlyOmittedTotal = 0;
			let contentGapTotal = 0;
			const explicitlyOmittedRowList = [];
			report.perPredicate.forEach((onePredicateRow) => {
				const lostOnThisPredicate = onePredicateRow.lost || 0;
				if (omittedPredicateSet.has(onePredicateRow.predicate)) {
					explicitlyOmittedTotal += lostOnThisPredicate;
					if (lostOnThisPredicate > 0) {
						explicitlyOmittedRowList.push({
							predicate: onePredicateRow.predicate,
							explicitlyOmitted: lostOnThisPredicate,
						});
					}
					return;
				}
				contentGapTotal += lostOnThisPredicate;
			});

			const notReproducedTotal = report.headline.lost;
			if (contentGapTotal + explicitlyOmittedTotal !== notReproducedTotal) {
				return {
					error:
						`${moduleName}.assembleVerdictNumbers: the per-predicate rows account for ` +
						`${contentGapTotal + explicitlyOmittedTotal} not-reproduced statement(s) ` +
						`(contentGap ${contentGapTotal} + explicitlyOmitted ${explicitlyOmittedTotal}) but ` +
						`the headline reports ${notReproducedTotal}. The partition is measuring something ` +
						`other than the loss it claims to partition — refused by name rather than issuing a ` +
						`verdict whose arithmetic does not close.`,
				};
			}

			const inventedTotal = report.headline.invented;
			return {
				numbers: {
					roundTripClean: contentGapTotal === 0 && inventedTotal === 0,
					reproduced: report.headline.matched,
					lostTotal: contentGapTotal,
					contentGapTotal,
					explicitlyOmittedTotal,
					notReproducedTotal,
					inventedTotal,
					explicitlyOmittedRowList,
				},
			};
		};

		// =====================================================================
		// validateWithReader — the whole instrument against an ALREADY-CONSTRUCTED reader.
		// The fixture drives this seam with a graph double; validate() drives it with the bolt
		// reader. Identical machinery either way — the double cannot be special-cased because
		// nothing downstream knows which it got.
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

			// COMPILE THE GRAPH BACK OUT. The emission is written where a human can open it beside
			// the source; the diff reads it from there, exactly as the -cedsRoundTrip verb does.
			taskList.push((args, next) => {
				const emittedDirPath = path.join(outputPath, 'emitted');
				const emittedFilePath = path.join(emittedDirPath, EMITTED_FILE_NAME);
				compilerLib.compileToFile({ reader, outPath: emittedFilePath }, (compileError, compiled) => {
					if (compileError) {
						next(compileError);
						return;
					}
					next('', { ...args, emittedFilePath, compiled });
				});
			});

			// UNRESOLVABLE REFERENCES ARE FATAL HERE, not advisory. The -cedsRoundTrip verb logs them
			// and carries on because an operator is watching; a VERDICT nobody is watching must not
			// be issued over a half-read graph. Same posture as sif's emission-fault refusal.
			taskList.push((args, next) => {
				const unresolvedList = (args.compiled.readerNotes || {}).unresolvedDomainIds || [];
				if (unresolvedList.length) {
					next(
						`${moduleName}.validateWithReader: ${unresolvedList.length} UNRESOLVABLE ` +
							`REFERENCE(S) while compiling the graph — refusing to issue a verdict over a ` +
							`half-read graph:\n  ${unresolvedList.join('\n  ')}`,
					);
					return;
				}
				next('', args);
			});

			taskList.push((args, next) => {
				diffLib.compareRdfFiles(
					{
						sourcePath: args.snapshot.ontologyFilePath,
						emittedPath: args.emittedFilePath,
						context: {
							snapshotPath,
							snapshotDigest: args.snapshot.combinedDigest,
							sourcePath: args.snapshot.ontologyFilePath,
							emittedPath: args.emittedFilePath,
							emittedCounts: JSON.stringify(args.compiled.counts),
							...(graphIdentity || {}),
						},
					},
					(compareError, compared) => {
						if (compareError) {
							next(compareError);
							return;
						}
						next('', { ...args, report: compared.report });
					},
				);
			});

			taskList.push((args, next) => {
				const assembled = assembleVerdictNumbers({ report: args.report });
				if (assembled.error) {
					next(assembled.error);
					return;
				}
				next('', { ...args, numbers: assembled.numbers });
			});

			// assemble + write the RT-6 verdict artifact and the human report, from the SAME objects.
			taskList.push((args, next) => {
				const { headline } = args.report;
				const { numbers } = args;
				const memoryUsage = process.memoryUsage();
				const verdict = {
					verdictVersion: VERDICT_VERSION,
					standard: STANDARD_SOURCE,
					// A13: clean means contentGap 0 AND invented 0. For CEDS the two definitions
					// coincide, because its explicitly-omitted registry is empty by ruling and
					// contentGap therefore equals every not-reproduced statement. See the header for
					// why that is the highest bar in the fleet rather than a formality.
					roundTripClean: numbers.roundTripClean,
					reproduced: numbers.reproduced,
					lost: numbers.contentGapTotal,
					// the NORMATIVE RT-6 builder-facing names (A6 + A13): the RT-13 stage adjudicates
					// on {roundTripClean, inventedTotal, lostTotal, contentGapTotal,
					// explicitlyOmittedTotal} with zero per-standard knowledge and REFUSES BY NAME a
					// verdict lacking them. lostTotal IS contentGap alone; notReproducedTotal preserves
					// the pre-A13 arithmetic under an honest name so no number is destroyed.
					lostTotal: numbers.lostTotal,
					contentGapTotal: numbers.contentGapTotal,
					explicitlyOmittedTotal: numbers.explicitlyOmittedTotal,
					notReproducedTotal: numbers.notReproducedTotal,
					invented: numbers.inventedTotal,
					inventedTotal: numbers.inventedTotal,
					// the registry itself travels in the verdict so a reader can tell an empty
					// category from an unasked question without opening this file.
					explicitlyOmittedRegistry: {
						predicateList: EXPLICITLY_OMITTED_PREDICATES.slice(),
						authority:
							'EMPTY BY RULING (TQ 2026-08-02, forges/ceds/README_roundTripContract.md): if it ' +
							'is in the OWL, it has to come out of the graph; the manifest of exclusions is ' +
							'empty, zero loss means zero, with nothing argued at the margin.',
						matchedRows: numbers.explicitlyOmittedRowList,
					},
					// THE DECLARED LIMIT (root-and-branch Phase 4, K3; RULINGS-supervisor-phase2.md §5
					// item 11). Until 2026-08-15 this bundle declared NO semanticValidationLimit — the only one
					// of the four survivors without one — so the RT-13 stage substituted "NONE DECLARED BY
					// THIS BUNDLE" and a reader of the certificate had to open this module to learn what
					// lostTotal=0 covers. Stated here FROM THE CODE (lib/roundTripCanonical.js — the
					// statement key at :197-205, the walk at :211-251, the nested-structure rule in its
					// header; lib/roundTripDiff.js compareRdfFiles :499-; lib/roundTripCompiler.js header
					// LAYER RULING + its require list; EXPLICITLY_OMITTED_PREDICATES above), and every
					// clause names its line so it can be re-checked. Same discipline as edfi/sif/pesc:
					// IF YOU CHANGE WHAT IS MODELLED, REWRITE THIS STRING IN THE SAME COMMIT.
					semanticValidationLimit:
						'SEMANTIC round-trip: canonical STATEMENT-SET equality between the pinned ' +
						'CEDS-Ontology.rdf and an RDF/XML emission compiled FROM THE GRAPH — not byte ' +
						'equality, and not completeness of CEDS beyond that snapshot. HOW THE TWO SIDES ' +
						'ARE MADE: the source side is the snapshot file; the emitted side is written by ' +
						'lib/roundTripCompiler.js, which reads the graph over bolt and never opens a ' +
						'source file (its requires are neo4j-driver and node built-ins; it does not ' +
						'touch the forge parser). BOTH files are then reduced by ONE canonicalizer ' +
						'(lib/roundTripCanonical.js), which never touches the graph — so the instrument ' +
						'cannot merely prove the forge agrees with itself, but the two sides do share ' +
						'the reducer. WHAT A STATEMENT IS (roundTripCanonical.js:197-205): the key ' +
						'(subject, predicate, objectKind, object, datatype, lang) with element names ' +
						'expanded through the document\'s own xmlns declarations, literal whitespace ' +
						'trimmed and collapsed, ORDER DISCARDED, and duplicates on each side COLLAPSED ' +
						'and counted; a node element\'s own name is a (subject, rdf:type, X) statement ' +
						'(rdf:Description asserts nothing). NESTED elements with no rdf:about of their ' +
						'own (the editHistory Collection) are addressed by a CONTENT-HASHED structural ' +
						'subject, NOT by position and NOT as rdf:first/rdf:rest lists. LAYER SCOPE: the ' +
						'compiler emits LAYER 1 ONLY (DmeStandardRoot/DmeClass/DmeProperty/DmeOptionSet/' +
						'DmeOptionValue and SUBCLASS_OF/HAS_OPTION_SET/REFERENCES/HAS_VALUE); Layer 2 — ' +
						'HubReference/HubDefinition, addressSignature, embeddings, HAS_CEDS_*/IN_HUB — is ' +
						'never emitted, so lostTotal says NOTHING about the matching index. THE ' +
						'ARITHMETIC (A13): lostTotal IS contentGapTotal; the explicitly-omitted registry ' +
						'is EMPTY BY RULING, so lostTotal=0 means LITERALLY every source statement, as ' +
						'reduced above, was re-emitted from Layer 1, with no margin claimed anywhere; ' +
						'inventedTotal=0 means no emitted statement is absent from the source. WHAT IS ' +
						'NOT MODELLED, and is therefore INVISIBLE as loss rather than merely hard to see: ' +
						'(a) ORDER of anything — element order, editHistory entry order, and RDF list ' +
						'semantics; (b) a statement repeated in the source but present once in the graph ' +
						'(duplicates collapse to one on each side); (c) any RDF/XML written with ' +
						'attributes other than rdf:about / rdf:resource / rdf:datatype / xml:lang — ' +
						'property-attribute shorthand, rdf:ID, rdf:nodeID, xml:base-relative resolution — ' +
						'is not read by the walk (roundTripCanonical.js:211-251) and so mints no ' +
						'statement on EITHER side; (d) a top-level element with NO rdf:about mints no ' +
						'statement — it is COUNTED and rendered loudly (sourceTopLevelWithoutSubject, ' +
						'0 in today\'s snapshot) but its content cannot be reported lost; (e) ' +
						'serialization: prefix choice, attribute order, indentation, the namespace ' +
						'block. A clean verdict is therefore a claim about the CANONICAL STATEMENT ' +
						'DOMAIN this reducer sees in the pinned snapshot, and about nothing else.',
					diffScope: {
						statementSource: args.snapshot.ontologyFilename,
						layerScope:
							'LAYER 1 ONLY (roundTripCompiler.js): CEDS as CEDS states it. Layer 2 — the ' +
							'HubReference matching index, address signatures and embeddings — is ours, not ' +
							"CEDS's, and emitting it would INVENT statements CEDS never made.",
						outOfScopeInputs: [],
					},
					scaleReport: {
						runtimeMs: Date.now() - startedAtMs,
						rssBytes: memoryUsage.rss,
						heapUsedBytes: memoryUsage.heapUsed,
						sourceStatements: headline.sourceStatements,
						emittedStatements: headline.emittedStatements,
						sourceSubjects: headline.sourceSubjects,
						emittedSubjects: headline.emittedSubjects,
						sourceDuplicatesCollapsed: headline.sourceDuplicatesCollapsed,
						emittedDuplicatesCollapsed: headline.emittedDuplicatesCollapsed,
					},
					snapshot: {
						snapshotPath,
						combinedDigest: args.snapshot.combinedDigest,
						files: args.snapshot.fileRecordList,
					},
					graph: {
						...(graphIdentity || {}),
						emittedCounts: args.compiled.counts,
					},
					report: args.report,
				};
				diffLib.renderReportText({ report: args.report }, (renderError, rendered) => {
					if (renderError) {
						next(renderError);
						return;
					}
					fs.mkdirSync(outputPath, { recursive: true });
					fs.writeFileSync(
						path.join(outputPath, VERDICT_FILE_NAME),
						`${JSON.stringify(verdict, null, 1)}\n`,
					);
					fs.writeFileSync(path.join(outputPath, REPORT_FILE_NAME), rendered.reportText);
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
				const reader = compilerLib.makeNeo4jCedsReader({
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
			assembleVerdictNumbers,
			VERDICT_VERSION,
			EXPLICITLY_OMITTED_PREDICATES,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
