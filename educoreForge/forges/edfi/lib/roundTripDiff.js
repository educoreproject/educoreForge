'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// roundTripDiff.js — forge-edfi Phase 3 (RT-6): the statement diff and the report object. Both
// the JSON verdict and the human report render from the SAME report object so they can never
// disagree (pesc precedent).
//
// VERDICT DOCTRINE:
//   - REPRODUCED / LOST / INVENTED by statement-identity set membership (statementKey).
//   - INVENTED must be 0 at all times, from the first run (doctrine §5.3). LOST is the
//     work-remaining meter, split explicitlyOmitted vs contentGap (supervisor's standing
//     interpretation; the category was named declaredContext until doctrine amendment A13,
//     interpretation from the pesc campaign, adopted for edfi by R-WO-12/R-WO-15).
//   - In THIS bundle the intra-diff LOST bucket registry routes the two ruled expected-loss
//     predicates (componentKind/*, itemNamespace/*) to contentGap BY NAME — they are real
//     content the graph does not yet carry (R-WO-15(d) + its ratified extension), enumerated as
//     the enrichment backlog. Everything else LOST defaults to contentGap too. The
//     explicitlyOmitted bucket inside the diff is EMPTY BY DESIGN: this bundle's out-of-domain
//     omissions (comment-line census, item-keyword drift census, the crosswalk input) never enter
//     the statement domain at all and are adjudicated as named VERDICT sections instead
//     (R-WO-12, R-WO-15(a)/(b)).
//   - No percentage participates in ANY acceptance decision — fidelityPercent is display-only
//     (a tampered emission once hid four fabricated statements behind a plausible percentage;
//     ceds G-8 class rule).
//
// Async style: error-first callbacks (RT-8/R7) though the diff is pure and synchronous.

const roundTripMetaEdCanonical = require('./roundTripMetaEdCanonical')();
const { statementKey } = roundTripMetaEdCanonical;

const SAMPLE_LIMIT = 10;

// predicate-pattern -> LOST bucket. Patterns are prefix matches on the predicate text.
// (registry over switch; the bucket vocabulary is exactly ['explicitlyOmitted', 'contentGap'])
const LOST_BUCKET_PREFIX_REGISTRY = [
	{ predicatePrefix: 'componentKind/', bucketName: 'contentGap', backlogLabel: 'interchangeComponentKind (R-WO-15d)' },
	{ predicatePrefix: 'itemNamespace/', bucketName: 'contentGap', backlogLabel: 'itemNamespaceQualifier (R-WO-15d extension)' },
	{ predicatePrefix: 'itemMetaEdId/', bucketName: 'contentGap', backlogLabel: 'itemMetaEdId (R-WO-15d extension)' },
];

const lostBucketFor = (predicateText) => {
	const registryHit = LOST_BUCKET_PREFIX_REGISTRY.find((oneEntry) =>
		predicateText.startsWith(oneEntry.predicatePrefix),
	);
	if (registryHit) {
		return { bucketName: registryHit.bucketName, backlogLabel: registryHit.backlogLabel };
	}
	return { bucketName: 'contentGap', backlogLabel: undefined };
};

const locatedTextFor = (oneStatement) =>
	oneStatement.sourceFileRelativePath
		? `${oneStatement.sourceFileRelativePath}:${oneStatement.sourceLineNumber !== undefined && oneStatement.sourceLineNumber !== null ? oneStatement.sourceLineNumber : '?'}`
		: undefined;

const moduleFunction = () => {
	// --------------------------------------------------------
	// diffStatements — the one comparison.
	//   inputs: {
	//     sourceStatementMap,   Map (answer key — the independent reducer's statements)
	//     emittedStatementMap,  Map (the graph side's statements)
	//     context,              free identity block copied onto the report
	//   }
	//   callback(errString, { report })
	// --------------------------------------------------------
	const diffStatements = ({ sourceStatementMap, emittedStatementMap, context }, callback) => {
		if (!(sourceStatementMap instanceof Map) || !(emittedStatementMap instanceof Map)) {
			callback(
				`${moduleName}.diffStatements: sourceStatementMap and emittedStatementMap (Map) are REQUIRED and have no default.`,
			);
			return;
		}

		const perPredicateRegistry = {};
		const perPredicateRowFor = (predicateText) => {
			if (!perPredicateRegistry[predicateText]) {
				perPredicateRegistry[predicateText] = {
					predicate: predicateText,
					source: 0,
					emitted: 0,
					reproduced: 0,
					lost: 0,
					invented: 0,
					lostSampleList: [],
					inventedSampleList: [],
				};
			}
			return perPredicateRegistry[predicateText];
		};

		let reproducedCount = 0;
		// A13: notReproducedCount is the raw set difference; only contentGap is LOSS.
		let notReproducedCount = 0;
		let contentGapCount = 0;
		let explicitlyOmittedCount = 0;
		let inventedCount = 0;
		const lostByBacklogLabel = {};
		const lostDetailList = [];
		const inventedDetailList = [];

		sourceStatementMap.forEach((oneStatement, mapRefId) => {
			const predicateRow = perPredicateRowFor(oneStatement.predicate);
			predicateRow.source += 1;
			if (emittedStatementMap.has(mapRefId)) {
				reproducedCount += 1;
				predicateRow.reproduced += 1;
				return;
			}
			notReproducedCount += 1;
			predicateRow.lost += 1;
			const { bucketName, backlogLabel } = lostBucketFor(oneStatement.predicate);
			if (bucketName === 'explicitlyOmitted') {
				explicitlyOmittedCount += 1;
			} else {
				contentGapCount += 1;
			}
			if (backlogLabel) {
				lostByBacklogLabel[backlogLabel] = (lostByBacklogLabel[backlogLabel] || 0) + 1;
			}
			const lostRecord = {
				subject: oneStatement.subject,
				predicate: oneStatement.predicate,
				object: oneStatement.object,
				bucketName,
				...(backlogLabel ? { backlogLabel } : {}),
				...(locatedTextFor(oneStatement) ? { located: locatedTextFor(oneStatement) } : {}),
			};
			lostDetailList.push(lostRecord);
			if (predicateRow.lostSampleList.length < SAMPLE_LIMIT) {
				predicateRow.lostSampleList.push(lostRecord);
			}
		});

		emittedStatementMap.forEach((oneStatement, mapRefId) => {
			const predicateRow = perPredicateRowFor(oneStatement.predicate);
			predicateRow.emitted += 1;
			if (sourceStatementMap.has(mapRefId)) {
				return;
			}
			inventedCount += 1;
			predicateRow.invented += 1;
			const inventedRecord = {
				subject: oneStatement.subject,
				predicate: oneStatement.predicate,
				object: oneStatement.object,
				...(locatedTextFor(oneStatement) ? { located: locatedTextFor(oneStatement) } : {}),
			};
			inventedDetailList.push(inventedRecord);
			if (predicateRow.inventedSampleList.length < SAMPLE_LIMIT) {
				predicateRow.inventedSampleList.push(inventedRecord);
			}
		});

		const sourceStatementCount = sourceStatementMap.size;
		const emittedStatementCount = emittedStatementMap.size;
		const report = {
			reportVersion: 'edfiRoundTrip-1',
			context: context || {},
			headline: {
				sourceStatements: sourceStatementCount,
				emittedStatements: emittedStatementCount,
				reproduced: reproducedCount,
				// A13: `lost` is deliberately ABSENT so no reader keeps the old meaning.
				notReproduced: notReproducedCount,
				contentGap: contentGapCount,
				explicitlyOmitted: explicitlyOmittedCount,
				invented: inventedCount,
				// display-only; structurally excluded from every acceptance decision (G-8 class)
				fidelityPercentDisplayOnly:
					sourceStatementCount === 0
						? null
						: Math.round((reproducedCount / sourceStatementCount) * 100000) / 1000,
			},
			lostByBacklogLabel,
			perPredicate: Object.values(perPredicateRegistry).sort((leftRow, rightRow) =>
				leftRow.predicate.localeCompare(rightRow.predicate),
			),
			lostDetailList,
			inventedDetailList,
		};

		callback('', { report });
	};

	// --------------------------------------------------------
	// renderReportText — the human rendering of the SAME report object (never a second
	// computation).
	// --------------------------------------------------------
	const renderReportText = ({ report }) => {
		const headline = report.headline;
		const lineList = [];
		lineList.push(`edfi round-trip diff — reportVersion ${report.reportVersion}`);
		lineList.push(
			`source ${headline.sourceStatements} | emitted ${headline.emittedStatements} | ` +
				`REPRODUCED ${headline.reproduced} | NOT REPRODUCED ${headline.notReproduced} ` +
				`(LOST/contentGap ${headline.contentGap} / explicitlyOmitted ${headline.explicitlyOmitted}) | ` +
				`INVENTED ${headline.invented}`,
		);
		if (headline.fidelityPercentDisplayOnly !== null) {
			lineList.push(
				`fidelity ${headline.fidelityPercentDisplayOnly}% (display only — never part of acceptance)`,
			);
		}
		Object.entries(report.lostByBacklogLabel).forEach(([backlogLabel, backlogCount]) => {
			lineList.push(`  backlog ${backlogLabel}: ${backlogCount} lost`);
		});
		report.perPredicate.forEach((oneRow) => {
			if (oneRow.lost || oneRow.invented) {
				lineList.push(
					`  ${oneRow.predicate}: source ${oneRow.source}, reproduced ${oneRow.reproduced}, ` +
						`lost ${oneRow.lost}, invented ${oneRow.invented}`,
				);
			}
		});
		if (report.inventedDetailList.length) {
			lineList.push(`INVENTED detail (every item — INVENTED must be 0):`);
			report.inventedDetailList.slice(0, 50).forEach((oneRecord) => {
				lineList.push(`  ${oneRecord.subject} | ${oneRecord.predicate} | ${oneRecord.object}`);
			});
		}
		return lineList.join('\n');
	};

	// assembleStatementMapFromList — convenience over the canonical assembler, kept here so both
	// sides of the diff assemble identically
	const assembleStatementMapFromList = ({ statementList }) =>
		roundTripMetaEdCanonical.assembleStatementMap({ statementList });

	return { diffStatements, renderReportText, assembleStatementMapFromList, statementKey };
};

module.exports = moduleFunction;
