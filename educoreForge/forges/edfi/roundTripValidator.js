'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// roundTripValidator.js — forge-edfi Phase 3: THE round-trip validator (doctrine §5 in full;
// the RT-1 uniform entry-point name). Reads the MATERIALIZED EdFi graph over bolt, re-emits
// MetaEd-shaped semantic statements, reduces the pinned snapshot with the INDEPENDENT reducer,
// diffs, enforces the crosswalk EXCLUSION, and lands the RT-6 verdict artifact.
//
// UNIFORM INVOCATION SIGNATURE (RT-13 — builder-callable with zero per-standard knowledge):
//   roundTripValidator.validate(
//     { containerName, boltUrl, user, password, snapshotPath, outputPath },
//     (error, verdict) => …
//   )
// Either boltUrl+user+password are handed in, or containerName alone is handed and the bolt
// triple is resolved from the RUNNING container (docker inspect). Neither present -> refusal by
// name.
//
// WHY IT READS THE GRAPH AND NOT THE FORGE'S OUTPUT (RT-4, TQ's founding ruling): compiling
// from the forge's own result "would prove only that the forge remembers what it just read.
// Compiling from the GRAPH proves what the GRAPH ITSELF can support" — and is the only reading
// that also audits the loader.
//
// THE VERDICT (RT-6): REPRODUCED / LOST / INVENTED with located detail; LOST split
// explicitlyOmitted vs contentGap (named declaredContext until A13); INVENTED must be 0 always;
// roundTripClean = (lost === 0 && inventedTotal === 0). THE CROSSWALK IS EXCLUDED (2026-10-02, BRIEF-F;
// TQ 2026-09-10 and 2026-10-01: "known to be garbage"): it is no longer an input, so NO CEDS raw value may
// be stashed on any graph node. The guard that once licensed stashed values by membership in the crosswalk
// CSVs (R-WO-12) now licenses none: every stashed CEDS value is a violation and counts INVENTED.
//
// validateWithReader({ reader, snapshotPath, outputPath, graphIdentity }, callback) is the
// reader-agnostic core — the same machinery whether the reader is real bolt
// (roundTripEdfiCompiler.makeNeo4jEdfiReader) or the hermetic graph double (RT-7).
//
// CANONICALIZATION FAULTS ARE FATAL, NEVER ADVISORY — a half-measured document must not
// produce a verdict someone might believe.
//
// Async style: qtools taskListPlus/pipeRunner; error-first callbacks (RT-8/R7); no
// async/await; no try/catch as control flow. camelCase only.

const fs = require('fs');
const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const roundTripMetaEdCanonical = require('./lib/roundTripMetaEdCanonical')();
const roundTripEdfiCompiler = require('./lib/roundTripEdfiCompiler')();
const roundTripSnapshotIntake = require('./lib/roundTripSnapshotIntake')();
const roundTripDiff = require('./lib/roundTripDiff')();

// -2 (doctrine amendment A13, 2026-08-04): lostTotal counts contentGap ALONE now, with
// explicitly-omitted declarations reported separately and excluded from loss. Ed-Fi's in-domain
// explicitlyOmitted bucket is empty by design, so no Ed-Fi number moves — but the verdict must
// still declare which arithmetic produced it, and the RT-13 stage refuses a verdict lacking the
// two A13 fields so a stale -1 artifact cannot be read under the new meaning.
const VERDICT_VERSION = 'edfiRoundTripVerdict-2';
const STANDARD_SOURCE = 'EdFi';


const moduleFunction = () => {
	// --------------------------------------------------------
	// validateWithReader — the reader-agnostic core.
	//   inputs: { reader: {readAll, close}, snapshotPath, outputPath?, graphIdentity? }
	//   callback(errString, verdict)
	// --------------------------------------------------------
	const validateWithReader = ({ reader, snapshotPath, outputPath, graphIdentity }, callback) => {
		if (!reader || typeof reader.readAll !== 'function') {
			callback(`${moduleName}.validateWithReader: reader with readAll() is REQUIRED and has no default.`);
			return;
		}
		if (!snapshotPath) {
			callback(`${moduleName}.validateWithReader: snapshotPath is REQUIRED and has no default.`);
			return;
		}

		const taskList = new taskListPlus();

		// STAGE 1 — snapshot intake: checksum-verify and read every consumed file (RT-3)
		taskList.push((args, next) => {
			roundTripSnapshotIntake.intakeSnapshot({ snapshotPath }, (intakeError, intake) => {
				if (intakeError) {
					next(intakeError);
					return;
				}
				next('', { ...args, intake });
			});
		});

		// STAGE 2 — answer-key reduction (the INDEPENDENT reducer; R-WO-14)
		taskList.push((args, next) => {
			const answerKeyStatementList = [];
			const commentCensusList = [];
			const reducerCensusTotals = {
				constructCountByType: {},
				propertyCount: 0,
				enumerationItemCount: 0,
				domainItemCount: 0,
				interchangeComponentCount: 0,
			};

			const fileQueue = [...args.intake.fileEntryList];
			const reduceNextFile = (queueIndex) => {
				if (queueIndex >= fileQueue.length) {
					next('', {
						...args,
						answerKeyStatementList,
						commentCensusList,
						reducerCensusTotals,
					});
					return;
				}
				const oneEntry = fileQueue[queueIndex];
				const continueAfter = (reduceError, reduceResult, statementListFromFile) => {
					if (reduceError) {
						next(reduceError);
						return;
					}
					(statementListFromFile || []).forEach((oneStatement) =>
						answerKeyStatementList.push(oneStatement),
					);
					setImmediate(() => reduceNextFile(queueIndex + 1));
				};
				if (oneEntry.suffix === '.metaed') {
					roundTripMetaEdCanonical.reduceMetaEdSourceText(
						{ sourceText: oneEntry.fileText, sourceFileRelativePath: oneEntry.sourceFileRelativePath },
						(reduceError, reduceResult) => {
							if (reduceError) {
								continueAfter(reduceError);
								return;
							}
							reduceResult.commentCensusList.forEach((oneComment) =>
								commentCensusList.push(oneComment),
							);
							Object.entries(reduceResult.reducerCensus.constructCountByType).forEach(
								([constructType, typeCount]) => {
									reducerCensusTotals.constructCountByType[constructType] =
										(reducerCensusTotals.constructCountByType[constructType] || 0) + typeCount;
								},
							);
							reducerCensusTotals.propertyCount += reduceResult.reducerCensus.propertyCount;
							reducerCensusTotals.enumerationItemCount +=
								reduceResult.reducerCensus.enumerationItemCount;
							reducerCensusTotals.domainItemCount += reduceResult.reducerCensus.domainItemCount;
							reducerCensusTotals.interchangeComponentCount +=
								reduceResult.reducerCensus.interchangeComponentCount;
							continueAfter('', reduceResult, reduceResult.statementList);
						},
					);
					return;
				}
				if (oneEntry.suffix === '.xml') {
					roundTripMetaEdCanonical.reduceDescriptorXmlText(
						{ xmlText: oneEntry.fileText, sourceFileRelativePath: oneEntry.sourceFileRelativePath },
						(reduceError, reduceResult) => {
							if (reduceError) {
								continueAfter(reduceError);
								return;
							}
							continueAfter('', reduceResult, reduceResult.statementList);
						},
					);
					return;
				}
				// the intake consumes .metaed and .xml only (the crosswalk's .csv retired 2026-10-02); any
				// other suffix is a fault, never a silent skip
				continueAfter(
					`${moduleName}: intake handed '${oneEntry.sourceFileRelativePath}' with suffix '${oneEntry.suffix}', which no reducer reads`,
				);
			};
			reduceNextFile(0);
		});

		// STAGE 3 — read the graph
		taskList.push((args, next) => {
			reader.readAll((readError, graphRows) => {
				if (readError) {
					next(readError);
					return;
				}
				next('', { ...args, graphRows });
			});
		});

		// STAGE 4 — graph-side emission (pure; a fault is fatal)
		taskList.push((args, next) => {
			const emission = roundTripEdfiCompiler.emitGraphStatements({ graphRows: args.graphRows });
			if (emission.fault) {
				next(emission.fault);
				return;
			}
			next('', { ...args, emission });
		});

		// STAGE 5 — assemble both statement maps and diff
		taskList.push((args, next) => {
			const sourceAssembly = roundTripMetaEdCanonical.assembleStatementMap({
				statementList: args.answerKeyStatementList,
			});
			const emittedAssembly = roundTripMetaEdCanonical.assembleStatementMap({
				statementList: args.emission.statementList,
			});
			roundTripDiff.diffStatements(
				{
					sourceStatementMap: sourceAssembly.statementMap,
					emittedStatementMap: emittedAssembly.statementMap,
					context: {
						standard: STANDARD_SOURCE,
						snapshotPath,
						sourceDuplicatesCollapsed: sourceAssembly.duplicatesCollapsedCount,
						emittedDuplicatesCollapsed: emittedAssembly.duplicatesCollapsedCount,
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

		// STAGE 6 — the crosswalk EXCLUSION guard: the crosswalk is not an input, so nothing licenses a
		// stashed CEDS value; every one the graph carries is a violation, and an INVENTION
		taskList.push((args, next) => {
			const violationList = args.emission.cedsStashList.map((oneStashEntry) => ({
				...oneStashEntry,
				violationKind: 'crosswalkExcluded',
			}));
			next('', { ...args, crosswalkGuardViolationList: violationList });
		});

		// STAGE 7 — assemble the verdict, land the artifacts
		taskList.push((args, next) => {
			const headline = args.report.headline;
			const inventedTotal = headline.invented + args.crosswalkGuardViolationList.length;
			const verdict = {
				verdictVersion: VERDICT_VERSION,
				standard: STANDARD_SOURCE,
				// A13 RECONCILIATION (not a relaxation): doctrine §5.3's contentGap bullet has always
				// said contentGap "is what 'clean' means when it reaches zero"; the single line
				// defining roundTripClean as LOST === 0 contradicted it. Ed-Fi's verdict does not
				// move — its in-domain explicitlyOmitted bucket is empty by design.
				roundTripClean: headline.contentGap === 0 && inventedTotal === 0,
				reproduced: headline.reproduced,
				lost: headline.contentGap,
				// lostTotal — the normative RT-6 builder-facing name (R-WO-21, 2026-08-04): the
				// RT-13 stage adjudicates on {roundTripClean, inventedTotal, lostTotal,
				// contentGapTotal, explicitlyOmittedTotal} with zero per-standard knowledge.
				// lostTotal IS contentGap ALONE as of A13; notReproducedTotal preserves the old
				// arithmetic under a name that says what it counts, so no number is destroyed.
				lostTotal: headline.contentGap,
				contentGapTotal: headline.contentGap,
				explicitlyOmittedTotal: headline.explicitlyOmitted,
				notReproducedTotal: headline.notReproduced,
				invented: headline.invented,
				inventedTotal,
				lostByBacklogLabel: args.report.lostByBacklogLabel,
				// PHASE 6 — the DECLARED semantic limit. Until this commit Ed-Fi shipped none at
				// all, so what its round trip does and does not model was derived by reading code.
				// A declared limit travels with the number into every payload; a derived one drifts
				// the moment someone edits the module
				// (forges/README_ValidationCertificateStandard.md:157).
				//
				// THIS SHIPS IN THE SAME COMMIT AS THE CARRIAGE IT DESCRIBES, and the pesc bundle's
				// own comment records exactly why: three of its four Phase 6 clauses went silently
				// FALSE when a later phase made the emitter model what an earlier one had declared
				// unmodelled. A LIMITATION THAT QUIETLY BECOMES FALSE IS ITS OWN DEFECT, and it is
				// the one nobody goes back to check — nothing fails, no gate reddens, the sentence
				// simply stops being true while everyone keeps citing it.
				//
				// SO: IF YOU CHANGE WHAT IS MODELLED, REWRITE THIS STRING IN THE SAME COMMIT. Never
				// as a follow-up. A stale limit is worse than an absent one, because absence is at
				// least marked as absence.
				semanticValidationLimit:
					'SEMANTIC round-trip: statement-set equality over the statement domain THIS ' +
					'INSTRUMENT MODELS — not byte equality, and not completeness of the Ed-Fi model. ' +
					'WHAT IS MODELLED, each on BOTH sides and from INDEPENDENT MINTERS (the ' +
					'canonicalizer reduces the published .metaed text and never opens the graph; the ' +
					'compiler reads the graph and never opens a source file, so the instrument cannot ' +
					'merely prove the forge agrees with itself): (1) CONSTRUCT, PROPERTY and ' +
					'OPTION-VALUE declarations and their clauses, scalar by NAMED scalar — anything ' +
					'with no named scalar is not modelled at all; (2) DOCUMENTATION prose, ' +
					'whitespace-collapsed identically on both sides; (3) DOMAIN ITEMS and INTERCHANGE ' +
					'COMPONENTS at LOCAL-NAME precision; (4) AS OF 2026-08 the three formerly-ruled ' +
					'loss classes — interchange componentKind, per-item metaEdIds, and item namespace ' +
					'qualifiers — are CARRIED as REFERENCES edge properties and modelled on both ' +
					'sides, closing R-WO-15(d) and its ratified extension (f). THE EARLIER ' +
					'DECLARATION THAT THESE THREE ARE UNMODELLED IS RETRACTED ON EVIDENCE: the ' +
					'full-vocabulary hermetic fixture moved from lost 9 to lost 0 with inventedTotal ' +
					'unchanged at 0, and the real corpus carries 205 componentKind (199 element / 6 ' +
					'identityTemplate), 130 itemMetaEdId and 14 itemNamespaceQualifier edge ' +
					'properties at UNCHANGED 6,336-node / 8,171-edge cardinality. Their LOST buckets ' +
					'are RETAINED as regression detectors — a future change that drops one ' +
					'resurfaces it under its ruled backlog name instead of letting it vanish; ' +
					'(5) PROPERTY BASE NAMES, mechanically inverted from the roleName prefix, where ' +
					'an uninvertible name is a canonicalization FAULT and never a guess. ' +
					'WHAT IS NOT MODELLED, and is therefore invisible as loss rather than merely hard ' +
					'to see: (a) DECLARATION ORDER within a construct — statement-SET semantics, the ' +
					'stated instrument limit R-WO-15(e); (b) the `//` COMMENT LINES the publisher ' +
					'grammar itself lexer-skips, excluded from the domain by R-WO-15(a) and CENSUSED ' +
					'with file:line so they are visible rather than dropped; (c) the declared item ' +
					'keyword\'s REFERENCE-TYPE half — the `domain entity` / `association` / ' +
					'`descriptor` / `common` word — excluded from statement identity uniformly by ' +
					'R-WO-15(b), so an item whose declared keyword drifts from its referent\'s actual ' +
					'construct type still round-trips clean; the forge censuses that drift separately ' +
					'and this instrument does not re-measure it. ITS OTHER HALF IS MODELLED, AND THAT ' +
					'IS NOT A CONTRADICTION: on an interchange component the keyword also says ELEMENT ' +
					'versus IDENTITY, and that half IS carried and modelled on both sides per (4) ' +
					'above as componentKind. The keyword is excluded from statement IDENTITY, never ' +
					'from the statement DOMAIN — an exclusion from identity says two items with ' +
					'different keywords are the same SUBJECT, not that nothing about the keyword is ' +
					'measured; (d) WHITESPACE SURROUNDING AN OPTION VALUE, since ' +
					'R-WO-15(c) takes the TRIMMED text as subject identity while the object carries ' +
					'the source-verbatim string, so two values differing only in surrounding ' +
					'whitespace share one identity. ALSO DECLARED, a property of the COMPARISON ' +
					'rather than of either side: ABSENT IS ABSENT (RT-2 symmetry) — an undeclared ' +
					'attribute mints NO statement, so "this item declares no metaEdId" and "this ' +
					'item\'s metaEdId was lost" are indistinguishable by statement presence alone. ' +
					'That is precisely why the non-emission gate G-18 requires itemMetaEdId emission ' +
					'to be demonstrably HAPPENING before it concludes that the id-less items were ' +
					'correctly skipped, rather than reading their silence as proof. ' +
					'"Semantically clean" must never be reported as "identical".',
				crosswalkGuard: {
					adjudication:
						'the CEDS-authored crosswalk is EXCLUDED (TQ rulings 2026-09-10 and 2026-10-01; BRIEF-F 2026-10-02): it is not an input, its CSVs sit unread in cedsAuthoredCrosswalk_DO_NOT_USE/, and every CEDS value stashed on a graph node (a cedsOptionCode, or a crossRefs entry) is a violation counted INVENTED. Until 2026-10-02 this guard licensed stashed values by membership in the crosswalk CSVs (R-WO-12)',
					stashRawValueCount: args.emission.cedsStashList.length,
					violationCount: args.crosswalkGuardViolationList.length,
					violationList: args.crosswalkGuardViolationList,
				},
				explicitlyOmittedOutOfDomainCensus: {
					commentLineCount: args.commentCensusList.length,
					commentLineList: args.commentCensusList.map(
						(oneComment) => `${oneComment.sourceFileRelativePath}:${oneComment.lineNumber}`,
					),
					commentPolicy:
						'lexer-skipped by the publisher grammar (LINE_COMMENT -> skip); excluded from the statement domain by declared policy R-WO-15(a)',
					itemKeywordDriftPolicy:
						'item keywords are excluded from statement identity uniformly (R-WO-15(b)); the drift census (3 cases) is FORGE-REPORT PROVENANCE, measured by the forge as stats.itemKeywordMismatchList — not re-measured by this instrument',
				},
				reducerCensus: args.reducerCensusTotals,
				emissionCensus: args.emission.emissionCensus,
				snapshot: args.intake.snapshotIdentity,
				graph: {
					...(graphIdentity || {}),
					rootProperties: args.graphRows.rootRow || null,
					nodeCountByRole: args.graphRows.nodeCountByRole,
					edgeCountByType: args.graphRows.edgeCountByType,
				},
				report: args.report,
			};

			if (outputPath) {
				fs.mkdirSync(outputPath, { recursive: true });
				fs.writeFileSync(
					path.join(outputPath, 'roundTripVerdict.json'),
					JSON.stringify(verdict, null, 1),
				);
				fs.writeFileSync(
					path.join(outputPath, 'roundTrip.report.txt'),
					roundTripDiff.renderReportText({ report: args.report }) +
						`\nroundTripClean: ${verdict.roundTripClean}` +
						`\ninventedTotal (diff + crosswalk exclusion guard): ${inventedTotal}` +
						`\ncrosswalk exclusion guard violations: ${verdict.crosswalkGuard.violationCount}` +
						`\ncomment lines (explicitly omitted, out of statement domain): ${verdict.explicitlyOmittedOutOfDomainCensus.commentLineCount}\n`,
				);
			}
			next('', { ...args, verdict });
		});

		pipeRunner(taskList.getList(), {}, (pipelineError, args) => {
			if (pipelineError) {
				callback(pipelineError);
				return;
			}
			callback('', args.verdict);
		});
	};

	// --------------------------------------------------------
	// validate — the RT-13 uniform entry point.
	// --------------------------------------------------------
	const validate = ({ containerName, boltUrl, user, password, snapshotPath, outputPath }, callback) => {
		const runWithBolt = (boltTriple) => {
			const reader = roundTripEdfiCompiler.makeNeo4jEdfiReader({
				boltUrl: boltTriple.boltUrl,
				user: boltTriple.user,
				password: boltTriple.password,
			});
			validateWithReader(
				{
					reader,
					snapshotPath,
					outputPath,
					graphIdentity: { containerName: boltTriple.containerName, boltUrl: boltTriple.boltUrl },
				},
				(validateError, verdict) => {
					reader.close((closeError) => {
						if (validateError) {
							callback(validateError);
							return;
						}
						if (closeError) {
							callback(closeError);
							return;
						}
						callback('', verdict);
					});
				},
			);
		};

		if (boltUrl && user && password) {
			runWithBolt({ containerName, boltUrl, user, password });
			return;
		}
		if (!containerName) {
			callback(
				`${moduleName}.validate: either boltUrl+user+password or containerName is REQUIRED — ` +
					`there is no default endpoint and none is guessed.`,
			);
			return;
		}
		roundTripEdfiCompiler.resolveContainerBolt({ containerName }, (resolveError, boltTriple) => {
			if (resolveError) {
				callback(resolveError);
				return;
			}
			runWithBolt(boltTriple);
		});
	};

	return { validate, validateWithReader, VERDICT_VERSION, STANDARD_SOURCE };
};

module.exports = moduleFunction;
