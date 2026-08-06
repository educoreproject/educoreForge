'use strict';

// roundTripDiff.js (forge-pesc) — THE DIFF AND THE REPORT. Two canonical statement sets in, one
// honest account of the distance between them out. Adapted from the CEDS reference
// (forges/ceds/lib/roundTripDiff.js); the statement domain is PESC's own (roundTripXsdCanonical).
//
// INVENTION IS REPORTED SEPARATELY AND FIRST-CLASS, and it is worse than loss: a statement we emit
// that the source never made is the instrument (or the graph) asserting something about PESC that
// PESC does not say. INVENTED must be 0 at all times (RT-6); LOST is the work-remaining meter.
//
// EVERY LOST ROW CARRIES A CATEGORY (supervisor refinement, 2026-08-03):
//   * explicitlyOmitted — declarations the graph DELIBERATELY does not carry (imports,
//     targetNamespace, schema attributes). Permanently nonzero, and honest: this is
//     we-chose-not-to-carry, the import-drift census made visible (R-PW-4). NOT LOSS: doctrine
//     amendment A13 (2026-08-04) lifted it out of every loss total. It was called
//     declaredContext until A13; that name did not say WE CHOSE THIS, so it was summed into
//     LOST and overstated PESC's real gap as 805 when the gap is 732.
//   * contentGap — everything else: statements the source makes that the chain genuinely loses
//     (facets, inline enumerations, the empty enumeration values, schema-level prose). This is
//     the enrichment work order.
// The category is decided by predicate membership in the canonicalizer's
// EXPLICITLY_OMITTED_PREDICATES registry; contentGap is the DEFAULT — explicitlyOmitted must
// be claimed by name, never assumed.
//
// The report text and the JSON verdict are RENDERED FROM THE SAME OBJECT and never recompute
// anything, so the two can never disagree about a number.
//
// Pure, callback-shaped (R7), no I/O — the caller owns the files. No async/await, no try/catch.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const canonicalLib = require('./roundTripXsdCanonical')();

const REPORT_VERSION = 'pescRoundTrip-1';
const MAX_SAMPLES_PER_PREDICATE = 10;

// subject-pattern -> entity kind (the PESC analogue of CEDS's rdf:type-driven kind map; here the
// subject scheme itself carries the kind, minted identically on both sides by the canonicalizer).
const KIND_BY_SUBJECT_MARKER = [
	{ marker: '#complexType/', kind: 'complexType' },
	{ marker: '#rootElement/', kind: 'rootElement' },
	{ marker: '#simpleType/', kind: 'simpleType' },
	{ marker: '#group/', kind: 'group' },
	{ marker: '#attributeGroup/', kind: 'attributeGroup' },
];

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		const kindOfSubjectRoot = (subjectRoot) => {
			const matched = KIND_BY_SUBJECT_MARKER.find((oneRule) =>
				String(subjectRoot).includes(oneRule.marker),
			);
			if (matched) {
				return matched.kind;
			}
			return String(subjectRoot).startsWith(canonicalLib.SUBJECT_SCHEME) ? 'schemaFile' : 'unrecognized';
		};

		const lostCategoryOfPredicate = (predicate) =>
			canonicalLib.EXPLICITLY_OMITTED_PREDICATES.includes(predicate)
				? 'explicitlyOmitted'
				: 'contentGap';

		const sampleOf = (statement) => ({
			subject: statement.subject,
			predicate: statement.predicate,
			object:
				String(statement.object).length > 160
					? `${String(statement.object).slice(0, 160)}…`
					: String(statement.object),
			fileLabel: statement.fileLabel || '',
		});

		// =====================================================================
		// diffStatements — the whole measurement. callback('', { report })
		// =====================================================================

		const diffStatements = (
			{
				sourceStatements,
				emittedStatements,
				sourceStats,
				emittedStats,
				sourceCollapsedStatementKeys,
				emittedCollapsedStatementKeys,
				context,
			} = {},
			callback,
		) => {
			if (!(sourceStatements instanceof Map)) {
				callback(
					`${moduleName}.diffStatements: sourceStatements is REQUIRED and must be the Map ` +
						`roundTripXsdCanonical produces.`,
				);
				return;
			}
			if (!(emittedStatements instanceof Map)) {
				callback(
					`${moduleName}.diffStatements: emittedStatements is REQUIRED and must be the Map ` +
						`roundTripXsdCanonical produces.`,
				);
				return;
			}

			// THE WHITESPACE SENTINEL IS REQUIRED, NOT OPTIONAL, and that is the whole point of
			// making it a refusal. O-2 removed the whitespace collapse from the comparison
			// (roundTripXsdCanonical normalizeDocumentation). Removing a normalization without
			// watching the dimension it used to hide just swaps one blind spot for another, so the
			// canonicalizer publishes a parallel collapsed key set and this diff REPORTS how many
			// unreproduced statements a collapse WOULD have absorbed. If that set went missing and
			// were read as absent-means-none, the number would print a reassuring 0 forever — the
			// silent-default failure this campaign has paid for repeatedly. It is refused by name.
			if (!(sourceCollapsedStatementKeys instanceof Set)) {
				callback(
					`${moduleName}.diffStatements: sourceCollapsedStatementKeys is REQUIRED and must ` +
						`be the Set roundTripXsdCanonical produces. There is no default and an absent ` +
						`set is NOT read as zero whitespace-only differences.`,
				);
				return;
			}
			if (!(emittedCollapsedStatementKeys instanceof Set)) {
				callback(
					`${moduleName}.diffStatements: emittedCollapsedStatementKeys is REQUIRED and must ` +
						`be the Set roundTripXsdCanonical produces. There is no default and an absent ` +
						`set is NOT read as zero whitespace-only differences.`,
				);
				return;
			}

			const perPredicate = new Map();
			const predicateRow = (predicate) => {
				if (!perPredicate.has(predicate)) {
					perPredicate.set(predicate, {
						predicate,
						lostCategory: lostCategoryOfPredicate(predicate),
						source: 0,
						emitted: 0,
						matched: 0,
						lost: 0,
						invented: 0,
						lostSamples: [],
						inventedSamples: [],
					});
				}
				return perPredicate.get(predicate);
			};

			const perKind = new Map();
			const kindRow = (kind) => {
				if (!perKind.has(kind)) {
					perKind.set(kind, {
						kind,
						sourceSubjects: new Set(),
						emittedSubjects: new Set(),
						source: 0,
						emitted: 0,
						matched: 0,
						lost: 0,
						invented: 0,
					});
				}
				return perKind.get(kind);
			};

			let whitespaceOnlyDifference = 0;
			const whitespaceOnlyDifferenceSamples = [];
			let matched = 0;
			// A13 vocabulary: notReproduced is the raw set difference; only contentGap is LOSS.
			let notReproduced = 0;
			let explicitlyOmitted = 0;
			let contentGap = 0;

			sourceStatements.forEach((oneStatement, oneIdentity) => {
				const predicateAccumulator = predicateRow(oneStatement.predicate);
				const kindAccumulator = kindRow(kindOfSubjectRoot(oneStatement.subjectRoot));
				predicateAccumulator.source += 1;
				kindAccumulator.source += 1;
				kindAccumulator.sourceSubjects.add(oneStatement.subjectRoot);
				if (emittedStatements.has(oneIdentity)) {
					matched += 1;
					predicateAccumulator.matched += 1;
					kindAccumulator.matched += 1;
					return;
				}
				notReproduced += 1;
				predicateAccumulator.lost += 1;
				kindAccumulator.lost += 1;
				// Would a whitespace collapse have absorbed this difference? Same subject, same
				// predicate, object equal once runs are collapsed. This CHANGES NOTHING about the
				// verdict — the statement is unreproduced either way — it only publishes the size
				// of the dimension the incumbent's collapse used to hide.
				const collapsedIdentity = JSON.stringify([
					oneStatement.subject,
					oneStatement.predicate,
					canonicalLib.collapseWhitespaceRuns(oneStatement.object),
				]);
				if (emittedCollapsedStatementKeys.has(collapsedIdentity)) {
					whitespaceOnlyDifference += 1;
					if (whitespaceOnlyDifferenceSamples.length < MAX_SAMPLES_PER_PREDICATE) {
						whitespaceOnlyDifferenceSamples.push(sampleOf(oneStatement));
					}
				}
				if (predicateAccumulator.lostCategory === 'explicitlyOmitted') {
					explicitlyOmitted += 1;
				} else {
					contentGap += 1;
				}
				if (predicateAccumulator.lostSamples.length < MAX_SAMPLES_PER_PREDICATE) {
					predicateAccumulator.lostSamples.push(sampleOf(oneStatement));
				}
			});

			let invented = 0;
			emittedStatements.forEach((oneStatement, oneIdentity) => {
				const predicateAccumulator = predicateRow(oneStatement.predicate);
				const kindAccumulator = kindRow(kindOfSubjectRoot(oneStatement.subjectRoot));
				predicateAccumulator.emitted += 1;
				kindAccumulator.emitted += 1;
				kindAccumulator.emittedSubjects.add(oneStatement.subjectRoot);
				if (sourceStatements.has(oneIdentity)) {
					return;
				}
				invented += 1;
				predicateAccumulator.invented += 1;
				kindAccumulator.invented += 1;
				if (predicateAccumulator.inventedSamples.length < MAX_SAMPLES_PER_PREDICATE) {
					predicateAccumulator.inventedSamples.push(sampleOf(oneStatement));
				}
			});

			const predicateRows = Array.from(perPredicate.values()).sort(
				(left, right) => right.lost - left.lost || left.predicate.localeCompare(right.predicate),
			);
			const inventedRows = predicateRows
				.filter((oneRow) => oneRow.invented > 0)
				.sort(
					(left, right) =>
						right.invented - left.invented || left.predicate.localeCompare(right.predicate),
				);
			const kindRows = Array.from(perKind.values())
				.map((oneRow) => ({
					kind: oneRow.kind,
					sourceSubjectCount: oneRow.sourceSubjects.size,
					emittedSubjectCount: oneRow.emittedSubjects.size,
					source: oneRow.source,
					emitted: oneRow.emitted,
					matched: oneRow.matched,
					lost: oneRow.lost,
					invented: oneRow.invented,
				}))
				.sort((left, right) => right.lost - left.lost || left.kind.localeCompare(right.kind));

			const sourceTotal = sourceStatements.size;

			// the canonicalizer's honesty meter, surfaced rather than dropped: a construct the
			// instrument does not model is input it cannot report lost.
			const unmodeledConstructCounts = {};
			[sourceStats, emittedStats].forEach((oneStats, statsIndex) => {
				const sideLabel = statsIndex === 0 ? 'source' : 'emitted';
				Object.keys((oneStats || {}).unmodeledConstructCounts || {}).forEach((oneName) => {
					unmodeledConstructCounts[`${sideLabel}: ${oneName}`] =
						(oneStats || {}).unmodeledConstructCounts[oneName];
				});
			});

			const report = {
				reportVersion: REPORT_VERSION,
				context: context || {},
				headline: {
					sourceStatements: sourceTotal,
					emittedStatements: emittedStatements.size,
					matched,
					// A13: notReproduced is everything in source and not emitted (the OLD meaning of
					// `lost`); contentGap is the part that is genuine LOSS; explicitlyOmitted is the
					// part we chose not to carry and is NOT loss. `lost` is deliberately ABSENT from
					// this headline so no reader can pick it up still meaning the old thing.
					notReproduced,
					contentGap,
					explicitlyOmitted,
					invented,
					fidelityPercent: sourceTotal ? Number(((matched / sourceTotal) * 100).toFixed(3)) : 0,
					// a single number that CANNOT look clean while inventing (CEDS audit A1): display
					// only — acceptance is the two COUNTS, never a percentage.
					cleanFidelityPercent:
						sourceTotal + invented
							? Number(((matched / (sourceTotal + invented)) * 100).toFixed(3))
							: 0,
					sourceDuplicatesCollapsed: (sourceStats || {}).duplicateCount || 0,
					emittedDuplicatesCollapsed: (emittedStats || {}).duplicateCount || 0,
					sourceSubjects: (sourceStats || {}).subjectCount || 0,
					emittedSubjects: (emittedStats || {}).subjectCount || 0,
					// THE O-2 SENTINEL (Phase 5). Unreproduced statements that a whitespace
					// collapse WOULD have absorbed. The collapse is GONE from the comparison, so
					// this is not a correction to the verdict — it is the size of the blind spot
					// the incumbent shipped, published as a live number. Measured 0 at adoption;
					// any nonzero value means whitespace fidelity has moved and the old instrument
					// would have reported clean regardless.
					whitespaceOnlyDifference,
				},
				whitespaceOnlyDifferenceSamples,
				perPredicate: predicateRows,
				perEntityKind: kindRows,
				invented: {
					total: invented,
					perPredicate: inventedRows,
				},
				unmodeledConstructCounts,
				canonicalizationFaults: []
					.concat(((sourceStats || {}).faults || []).map((oneFault) => `source: ${oneFault}`))
					.concat(((emittedStats || {}).faults || []).map((oneFault) => `emitted: ${oneFault}`)),
			};

			callback('', { report });
		};

		// =====================================================================
		// renderReportText — the human-readable deliverable, from the SAME object as the verdict
		// =====================================================================

		const padRight = (text, width) => `${text}${' '.repeat(Math.max(0, width - String(text).length))}`;
		const padLeft = (text, width) => `${' '.repeat(Math.max(0, width - String(text).length))}${text}`;

		const renderReportText = ({ report } = {}, callback) => {
			if (!report || !report.headline) {
				callback(`${moduleName}.renderReportText: report is REQUIRED and has no default.`);
				return;
			}
			const { headline } = report;
			const lines = [];

			lines.push('='.repeat(96));
			lines.push('PESC ROUND-TRIP FIDELITY REPORT');
			lines.push('='.repeat(96));
			lines.push('');
			lines.push(
				'The criterion is SEMANTIC round-trip — statement-set equality over the XSD semantic',
			);
			lines.push(
				'domain (roundTripXsdCanonical.js defines it). Whitespace, element order, attribute order,',
			);
			lines.push(
				'prefix choice, compositor kind and member order do NOT count; a missing or extra',
			);
			lines.push('STATEMENT does. This measures what the GRAPH can support, not what the forge saw.');
			lines.push('');
			Object.keys(report.context || {}).forEach((oneContextName) => {
				lines.push(`  ${padRight(`${oneContextName}:`, 22)}${report.context[oneContextName]}`);
			});
			lines.push('');
			lines.push('-'.repeat(96));
			lines.push('HEADLINE');
			lines.push('-'.repeat(96));
			lines.push(`  statements in source ....... ${padLeft(headline.sourceStatements, 9)}`);
			lines.push(`  statements emitted ......... ${padLeft(headline.emittedStatements, 9)}`);
			lines.push(`  MATCHED .................... ${padLeft(headline.matched, 9)}`);
			lines.push(
				`  NOT REPRODUCED ............. ${padLeft(headline.notReproduced, 9)}   (in source, not emitted)`,
			);
			lines.push(
				`    explicitlyOmitted ........ ${padLeft(headline.explicitlyOmitted, 9)}   (declarations the graph deliberately does not carry — CHOSEN, never lost)`,
			);
			lines.push(
				`  LOST ....................... ${padLeft(headline.contentGap, 9)}   (contentGap alone — genuine loss, the enrichment work order)`,
			);
			lines.push(
				`  INVENTED ................... ${padLeft(headline.invented, 9)}   (emitted, not in source — must be 0)`,
			);
			lines.push(`  fidelity ................... ${padLeft(`${headline.fidelityPercent}%`, 9)}`);
			lines.push(
				`  clean fidelity ............. ${padLeft(`${headline.cleanFidelityPercent}%`, 9)}   ` +
					`(matched / (source + invented) — falls when anything is fabricated)`,
			);
			lines.push('');
			lines.push(
				'  NOTE: no percentage above is an acceptance criterion. Acceptance is INVENTED == 0',
			);
			lines.push('  (always) and LOST == 0 (round-trip clean). Read the counts, not the percent.');
			lines.push('');
			lines.push(
				`  subjects: source ${headline.sourceSubjects}, emitted ${headline.emittedSubjects}` +
					`   |   duplicate statements collapsed: source ${headline.sourceDuplicatesCollapsed}, ` +
					`emitted ${headline.emittedDuplicatesCollapsed}`,
			);
			lines.push('');

			const unmodeledNames = Object.keys(report.unmodeledConstructCounts || {});
			if (unmodeledNames.length) {
				lines.push('  ' + '!'.repeat(92));
				lines.push('  !! UNMODELED CONSTRUCTS — input this instrument could not measure:');
				unmodeledNames.forEach((oneName) => {
					lines.push(`  !!   ${oneName}: ${report.unmodeledConstructCounts[oneName]}`);
				});
				lines.push('  !! Statements it cannot see, it cannot report lost. TREAT THE NUMBERS AS');
				lines.push('  !! INCOMPLETE until the canonicalizer is taught these constructs.');
				lines.push('  ' + '!'.repeat(92));
			} else {
				// CORRECTED AT REMEDIATION (review item 7). This line used to read "none — every
				// xs:* element on both sides was measured". That was an assertion of COMPLETENESS
				// the instrument had not earned: countUnmodeled is unreachable from inside a
				// complexType, so 722 orphaned xs:extension elements on the emitted side passed
				// through unseen WHILE the report announced that nothing had. A report that claims
				// coverage it did not measure is worse than one that says nothing, because it
				// converts an unknown into a reassurance. An empty tally now says only what an
				// empty tally can say: nothing was RECORDED, by a counter with a known blind spot.
				lines.push(
					'  unmodeled constructs: none RECORDED — and this is NOT a completeness claim.',
				);
				lines.push(
					'    countUnmodeled is not reached inside a complexType, so constructs nested there',
				);
				lines.push(
					'    are NOT counted on either side. An empty tally means "nothing was recorded",',
				);
				lines.push('    never "everything was measured".');
			}
			lines.push('');

			lines.push('-'.repeat(96));
			lines.push('INVENTED STATEMENTS — read this first. Invention is worse than loss.');
			lines.push('-'.repeat(96));
			if (!report.invented.total) {
				lines.push('  NONE. Every statement emitted is a statement the source makes.');
			} else {
				lines.push(
					`  ${report.invented.total} statement(s) were emitted that the source does NOT make.`,
				);
				lines.push(
					'  A loss is a gap in what the graph carries. An invention is an assertion about PESC',
				);
				lines.push('  that PESC never made — it is a DEFECT in the graph or in this validator.');
				lines.push('');
				report.invented.perPredicate.forEach((oneRow) => {
					lines.push(`  ${padLeft(oneRow.invented, 8)}  ${oneRow.predicate}`);
					oneRow.inventedSamples.forEach((oneSample) => {
						lines.push(`            ${oneSample.subject}`);
						lines.push(`              = ${oneSample.object}`);
					});
				});
			}
			lines.push('');

			lines.push('-'.repeat(96));
			lines.push('PER-PREDICATE LOSS — sorted by loss. contentGap rows ARE the enrichment work order.');
			lines.push('-'.repeat(96));
			lines.push(
				`  ${padLeft('LOST', 8)}  ${padLeft('source', 8)}  ${padLeft('emitted', 8)}  ${padLeft('matched', 8)}  ${padLeft('invented', 8)}  ${padRight('category', 16)}predicate`,
			);
			report.perPredicate.forEach((oneRow) => {
				lines.push(
					`  ${padLeft(oneRow.lost, 8)}  ${padLeft(oneRow.source, 8)}  ${padLeft(oneRow.emitted, 8)}  ` +
						`${padLeft(oneRow.matched, 8)}  ${padLeft(oneRow.invented, 8)}  ` +
						`${padRight(oneRow.lost ? oneRow.lostCategory : '—', 16)}${oneRow.predicate}`,
				);
			});
			lines.push('');

			lines.push('-'.repeat(96));
			lines.push('PER-ENTITY-KIND');
			lines.push('-'.repeat(96));
			lines.push(
				`  ${padRight('kind', 20)}${padLeft('subjects', 10)}${padLeft('source', 10)}${padLeft('matched', 10)}${padLeft('lost', 10)}${padLeft('invented', 10)}`,
			);
			report.perEntityKind.forEach((oneRow) => {
				lines.push(
					`  ${padRight(oneRow.kind, 20)}${padLeft(oneRow.sourceSubjectCount, 10)}` +
						`${padLeft(oneRow.source, 10)}${padLeft(oneRow.matched, 10)}` +
						`${padLeft(oneRow.lost, 10)}${padLeft(oneRow.invented, 10)}`,
				);
			});
			lines.push('');

			lines.push('-'.repeat(96));
			lines.push(`LOST STATEMENT SAMPLES — up to ${MAX_SAMPLES_PER_PREDICATE} per predicate`);
			lines.push('-'.repeat(96));
			report.perPredicate
				.filter((oneRow) => oneRow.lost > 0)
				.forEach((oneRow) => {
					lines.push('');
					lines.push(
						`  ${oneRow.predicate}  (${oneRow.lost} lost of ${oneRow.source}; category ${oneRow.lostCategory})`,
					);
					oneRow.lostSamples.forEach((oneSample) => {
						lines.push(`    ${oneSample.subject}`);
						lines.push(`      = ${oneSample.object}`);
					});
				});
			lines.push('');

			if (report.canonicalizationFaults.length) {
				lines.push('-'.repeat(96));
				lines.push('CANONICALIZATION FAULTS — fatal, never advisory');
				lines.push('-'.repeat(96));
				report.canonicalizationFaults.forEach((oneFault) => lines.push(`  ${oneFault}`));
				lines.push('');
			}

			callback('', { reportText: `${lines.join('\n')}\n` });
		};

		return {
			diffStatements,
			renderReportText,
			kindOfSubjectRoot,
			lostCategoryOfPredicate,
			REPORT_VERSION,
			MAX_SAMPLES_PER_PREDICATE,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
