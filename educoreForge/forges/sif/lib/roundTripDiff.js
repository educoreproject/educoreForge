'use strict';

// roundTripDiff.js (forge-sif) — THE DIFF AND THE REPORT. Two canonical statement sets in, one
// honest account of the distance between them out. Adapted from the pesc diff (itself from the
// CEDS reference); the statement domain is SIF's own (roundTripSifCanonical).
//
// INVENTION IS REPORTED SEPARATELY AND FIRST-CLASS, and it is worse than loss: a statement we
// emit that the source never made is the instrument (or the graph) asserting something about SIF
// that SIF does not say. INVENTED must be 0 at all times (RT-6); LOST is the work-remaining
// meter.
//
// EVERY LOST ROW CARRIES A CATEGORY (the pesc supervisor refinement, 2026-08-03): declaredContext
// must be claimed by name in the canonicalizer's registry; contentGap is the DEFAULT. SIF's
// declaredContext registry is EMPTY — every loss in this domain is enrichment work — and every
// LOST detail row additionally carries a BACKLOG LABEL (the edfi R-WO-15d convention): the known
// loss classes are named in BACKLOG_LABEL_BY_PREDICATE; an unlabeled predicate gets the
// investigate-first label, and the real-graph runner treats any label outside the ruled set as a
// failure — no anonymous loss.
//
// ORDER MISMATCHES ARE PAIRED AND NAMED (R-SF-1/R-SF-7): a lost `precedesInGroup` statement
// whose REVERSED twin appears in the invented set is a sequence change — reported in
// orderMismatchList naming the group and both members, and counted in headline.orderMismatches.
// This is the report shape the ORDER-SWAP twin asserts against.
//
// The report text and the JSON verdict are RENDERED FROM THE SAME OBJECT and never recompute
// anything, so the two can never disagree about a number.
//
// Pure, callback-shaped (R7), no I/O — the caller owns the files. No async/await, no try/catch.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const canonicalLib = require('./roundTripSifCanonical')();

const REPORT_VERSION = 'sifRoundTrip-1';
const MAX_SAMPLES_PER_PREDICATE = 10;
const MAX_OBJECT_RENDER_LENGTH = 160;

// subject-pattern -> entity kind (the subject scheme itself carries the kind, minted identically
// on both sides by the canonicalizer).
const KIND_BY_SUBJECT_MARKER = [
	{ marker: 'sif:object/', kind: 'object' },
	{ marker: 'sif:field/', kind: 'field' },
	{ marker: 'sif:group/', kind: 'group' },
];

// LOST backlog labels (the edfi convention): known loss classes named here, by predicate. The
// one ruled class today: the Characteristics column reaches the parser but not the contract
// node — a forge translation gap, measured here as loss and named to the enrichment backlog
// (never fixed from inside the instrument; the forge is Phase 1-closed).
const BACKLOG_LABEL_BY_PREDICATE = {
	fieldCharacteristics:
		'fieldCharacteristics (forge translation gap: lib/parser.js carries the Characteristics ' +
		'cell; forgeSif.js scalar map omits it)',
};
const UNRULED_BACKLOG_LABEL_SUFFIX = ' (uncategorized loss — investigate before accepting)';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		const kindOfSubject = (subject) => {
			const matched = KIND_BY_SUBJECT_MARKER.find((oneRule) =>
				String(subject).startsWith(oneRule.marker),
			);
			if (matched) {
				return matched.kind;
			}
			return String(subject).startsWith(canonicalLib.SUBJECT_SCHEME)
				? 'unrecognizedSifSubject'
				: 'unrecognized';
		};

		const lostCategoryOfPredicate = (predicate) =>
			canonicalLib.DECLARED_CONTEXT_PREDICATES.includes(predicate)
				? 'declaredContext'
				: 'contentGap';

		const backlogLabelOfPredicate = (predicate) =>
			BACKLOG_LABEL_BY_PREDICATE[predicate] || `${predicate}${UNRULED_BACKLOG_LABEL_SUFFIX}`;

		const renderObject = (objectValue) =>
			String(objectValue).length > MAX_OBJECT_RENDER_LENGTH
				? `${String(objectValue).slice(0, MAX_OBJECT_RENDER_LENGTH)}…`
				: String(objectValue);

		const sampleOf = (statement) => ({
			subject: statement.subject,
			predicate: statement.predicate,
			object: renderObject(statement.object),
			location: statement.location || '',
		});

		// =====================================================================
		// diffStatements — the whole measurement. callback('', { report })
		// =====================================================================

		const diffStatements = (
			{ sourceStatements, emittedStatements, sourceStats, emittedStats, context } = {},
			callback,
		) => {
			if (!(sourceStatements instanceof Map)) {
				callback(
					`${moduleName}.diffStatements: sourceStatements is REQUIRED and must be the Map ` +
						`roundTripSifCanonical produces.`,
				);
				return;
			}
			if (!(emittedStatements instanceof Map)) {
				callback(
					`${moduleName}.diffStatements: emittedStatements is REQUIRED and must be the Map ` +
						`roundTripSifCanonical produces.`,
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
					});
				}
				return perKind.get(kind);
			};

			const lostDetailList = [];
			const inventedDetailList = [];
			let matchedTotal = 0;
			let lostTotal = 0;
			let inventedTotal = 0;
			let lostDeclaredContext = 0;
			let lostContentGap = 0;

			sourceStatements.forEach((oneStatement, oneStatementKey) => {
				const row = predicateRow(oneStatement.predicate);
				row.source++;
				kindRow(kindOfSubject(oneStatement.subject)).sourceSubjects.add(oneStatement.subject);
				if (emittedStatements.has(oneStatementKey)) {
					row.matched++;
					matchedTotal++;
					return;
				}
				row.lost++;
				lostTotal++;
				if (row.lostCategory === 'declaredContext') {
					lostDeclaredContext++;
				} else {
					lostContentGap++;
				}
				if (row.lostSamples.length < MAX_SAMPLES_PER_PREDICATE) {
					row.lostSamples.push(sampleOf(oneStatement));
				}
				lostDetailList.push({
					subject: oneStatement.subject,
					predicate: oneStatement.predicate,
					object: renderObject(oneStatement.object),
					location: oneStatement.location || '',
					located: Boolean(oneStatement.location),
					lostCategory: row.lostCategory,
					backlogLabel: backlogLabelOfPredicate(oneStatement.predicate),
				});
			});

			emittedStatements.forEach((oneStatement, oneStatementKey) => {
				const row = predicateRow(oneStatement.predicate);
				row.emitted++;
				kindRow(kindOfSubject(oneStatement.subject)).emittedSubjects.add(oneStatement.subject);
				if (sourceStatements.has(oneStatementKey)) {
					return;
				}
				row.invented++;
				inventedTotal++;
				if (row.inventedSamples.length < MAX_SAMPLES_PER_PREDICATE) {
					row.inventedSamples.push(sampleOf(oneStatement));
				}
				inventedDetailList.push({
					subject: oneStatement.subject,
					predicate: oneStatement.predicate,
					object: renderObject(oneStatement.object),
					location: oneStatement.location || '',
				});
			});

			// ORDER MISMATCH PAIRING (R-SF-7): a lost precedence statement whose reversed twin was
			// emitted is a sequence change, named by group and members.
			const invertedPrecedenceObject = (precedenceObject) => {
				const parts = String(precedenceObject).split(' precedes ');
				if (parts.length !== 2) {
					return null;
				}
				return `${parts[1]} precedes ${parts[0]}`;
			};
			const orderMismatchList = [];
			lostDetailList
				.filter((oneLost) => oneLost.predicate === 'precedesInGroup')
				.forEach((oneLost) => {
					const reversedObject = invertedPrecedenceObject(oneLost.object);
					if (reversedObject === null) {
						return;
					}
					const reversedStatementKey = canonicalLib.statementKeyFor({
						subject: oneLost.subject,
						predicate: 'precedesInGroup',
						object: reversedObject,
					});
					if (emittedStatements.has(reversedStatementKey) && !sourceStatements.has(reversedStatementKey)) {
						orderMismatchList.push({
							groupSubject: oneLost.subject,
							sourceOrder: oneLost.object,
							emittedOrder: reversedObject,
							sourceLocation: oneLost.location,
						});
					}
				});

			const report = {
				reportVersion: REPORT_VERSION,
				headline: {
					sourceStatements: sourceStatements.size,
					emittedStatements: emittedStatements.size,
					matched: matchedTotal,
					lost: lostTotal,
					lostDeclaredContext,
					lostContentGap,
					invented: inventedTotal,
					orderMismatches: orderMismatchList.length,
				},
				perPredicate: Array.from(perPredicate.values()).sort((left, right) =>
					left.predicate.localeCompare(right.predicate),
				),
				perKind: Array.from(perKind.values()).map((oneRow) => ({
					kind: oneRow.kind,
					sourceSubjects: oneRow.sourceSubjects.size,
					emittedSubjects: oneRow.emittedSubjects.size,
				})),
				orderMismatchList,
				lostDetailList,
				inventedDetailList,
				canonicalizationFaults: [],
				sourceStats: sourceStats || {},
				emittedStats: emittedStats || {},
				context: context || {},
			};

			callback('', { report });
		};

		// =====================================================================
		// renderReportText — the human report, rendered from the SAME object as the verdict.
		// =====================================================================

		const renderReportText = ({ report } = {}, callback) => {
			if (!report || !report.headline) {
				callback(`${moduleName}.renderReportText: report with headline is REQUIRED.`);
				return;
			}
			const lines = [];
			const headline = report.headline;
			lines.push(`SIF ROUND-TRIP REPORT (${report.reportVersion})`);
			lines.push('='.repeat(72));
			lines.push(
				`source ${headline.sourceStatements}  emitted ${headline.emittedStatements}  ` +
					`matched ${headline.matched}  LOST ${headline.lost} ` +
					`(declaredContext ${headline.lostDeclaredContext} / contentGap ${headline.lostContentGap})  ` +
					`INVENTED ${headline.invented}  orderMismatches ${headline.orderMismatches}`,
			);
			lines.push('');
			lines.push('per predicate:');
			lines.push(
				'  predicate                 source  emitted  matched     lost  invented  category',
			);
			report.perPredicate.forEach((oneRow) => {
				lines.push(
					`  ${oneRow.predicate.padEnd(24)}${String(oneRow.source).padStart(8)}` +
						`${String(oneRow.emitted).padStart(9)}${String(oneRow.matched).padStart(9)}` +
						`${String(oneRow.lost).padStart(9)}${String(oneRow.invented).padStart(10)}  ` +
						`${oneRow.lostCategory}`,
				);
			});
			lines.push('');
			lines.push('per kind (distinct subjects):');
			report.perKind.forEach((oneRow) => {
				lines.push(
					`  ${oneRow.kind.padEnd(24)}source ${oneRow.sourceSubjects}  emitted ${oneRow.emittedSubjects}`,
				);
			});
			if (report.orderMismatchList.length) {
				lines.push('');
				lines.push(`ORDER MISMATCHES (${report.orderMismatchList.length}) — sequence changes, named:`);
				report.orderMismatchList.slice(0, 50).forEach((oneMismatch) => {
					lines.push(`  ${oneMismatch.groupSubject}`);
					lines.push(`    source:  ${oneMismatch.sourceOrder}`);
					lines.push(`    emitted: ${oneMismatch.emittedOrder}`);
				});
			}
			if (report.lostDetailList.length) {
				const labelTally = {};
				report.lostDetailList.forEach((oneLost) => {
					labelTally[oneLost.backlogLabel] = (labelTally[oneLost.backlogLabel] || 0) + 1;
				});
				lines.push('');
				lines.push('LOST backlog labels:');
				Object.keys(labelTally)
					.sort()
					.forEach((oneLabel) => {
						lines.push(`  ${String(labelTally[oneLabel]).padStart(8)}  ${oneLabel}`);
					});
			}
			lines.push('');
			lines.push('samples (up to 10 per predicate):');
			report.perPredicate.forEach((oneRow) => {
				oneRow.lostSamples.forEach((oneSample) => {
					lines.push(
						`  LOST     ${oneSample.predicate}  ${oneSample.subject}  '${oneSample.object}'  [${oneSample.location}]`,
					);
				});
				oneRow.inventedSamples.forEach((oneSample) => {
					lines.push(
						`  INVENTED ${oneSample.predicate}  ${oneSample.subject}  '${oneSample.object}'  [${oneSample.location}]`,
					);
				});
			});
			lines.push('');
			callback('', { reportText: `${lines.join('\n')}\n` });
		};

		return {
			diffStatements,
			renderReportText,
			BACKLOG_LABEL_BY_PREDICATE,
			KIND_BY_SUBJECT_MARKER,
			REPORT_VERSION,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
