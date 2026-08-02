'use strict';

// roundTripDiff.js — THE DIFF AND THE REPORT. Two canonical statement sets in, one honest account
// of the distance between them out.
//
// WHAT IT IS FOR. The CEDS source carries roughly 240,000 statements. The graph today carries a
// fraction of them, and THAT NUMBER IS THE DELIVERABLE — it is the baseline every future
// enrichment gets scored against. This module exists to state it in a form somebody can act on:
// not "we lose a lot", but "skos:definition: 13,023 lost, here are ten of them with their subject
// ids." A per-predicate loss table sorted by loss count IS the enrichment work order.
//
// INVENTION IS REPORTED SEPARATELY AND FIRST-CLASS, and the report says out loud that it is worse
// than loss. A statement we emit that the source never made is not a gap in coverage; it is the
// instrument (or the graph) asserting something about CEDS that CEDS does not say. A round-trip
// with 200,000 losses and 0 inventions is a healthy instrument measuring an immature graph. A
// round-trip with 10 losses and 10 inventions is a broken one.
//
// The report text and the JSON sidecar are RENDERED FROM THE SAME REPORT OBJECT and never
// recompute anything, so the two can never disagree about a number (the discipline
// lib/retrieval-metrics established for exactly this reason).
//
// Pure, callback-shaped (R7), no I/O — the caller owns the files.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const canonicalLib = require('./roundTripCanonical')();

const REPORT_VERSION = 'cedsRoundTrip-1';
const CEDS_NAMESPACE = 'https://w3id.org/CEDStandards/terms/';
const RDF_NAMESPACE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS_NAMESPACE = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL_NAMESPACE = 'http://www.w3.org/2002/07/owl#';
const SKOS_NAMESPACE = 'http://www.w3.org/2004/02/skos/core#';

const MAX_SAMPLES_PER_PREDICATE = 10;

// The type resources that decide what KIND of thing a subject is, most specific first. Order is
// load-bearing: an option set is an owl:Class that ALSO declares skos:ConceptScheme, so the
// ConceptScheme test must run before the Class test or every option set would count as a class.
const KIND_BY_TYPE_URI = [
	{ typeUri: `${SKOS_NAMESPACE}ConceptScheme`, kind: 'optionSet' },
	{ typeUri: `${OWL_NAMESPACE}NamedIndividual`, kind: 'optionValue' },
	{ typeUri: `${SKOS_NAMESPACE}Concept`, kind: 'optionValue' },
	{ typeUri: `${RDF_NAMESPACE}Property`, kind: 'property' },
	{ typeUri: `${OWL_NAMESPACE}Ontology`, kind: 'ontology' },
	{ typeUri: `${OWL_NAMESPACE}AnnotationProperty`, kind: 'annotationProperty' },
	{ typeUri: `${RDFS_NAMESPACE}Class`, kind: 'class' },
	{ typeUri: `${OWL_NAMESPACE}Class`, kind: 'class' },
];

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// -----
		// kindMapFrom — subjectRoot -> entity kind, decided from the document's OWN type statements.
		// A subject outside the CEDS namespace is reported as 'externalDeclaration' whatever it is
		// typed as: the source declares a handful of foreign classes (rdf:Property, rdfs:Class, ...)
		// purely so its domain references resolve, and counting those among the CEDS classes would
		// quietly overstate the class population.
		const kindMapFrom = (statements) => {
			const typeUrisBySubject = new Map();
			statements.forEach((oneStatement) => {
				if (oneStatement.predicate !== `${RDF_NAMESPACE}type`) {
					return;
				}
				const subjectRoot = oneStatement.subjectRoot;
				if (!typeUrisBySubject.has(subjectRoot)) {
					typeUrisBySubject.set(subjectRoot, new Set());
				}
				typeUrisBySubject.get(subjectRoot).add(oneStatement.object);
			});

			const kindBySubject = new Map();
			statements.forEach((oneStatement) => {
				const subjectRoot = oneStatement.subjectRoot;
				if (kindBySubject.has(subjectRoot)) {
					return;
				}
				if (!String(subjectRoot).startsWith(CEDS_NAMESPACE)) {
					kindBySubject.set(subjectRoot, 'externalDeclaration');
					return;
				}
				const typeUris = typeUrisBySubject.get(subjectRoot);
				if (!typeUris) {
					kindBySubject.set(subjectRoot, 'untyped');
					return;
				}
				const matched = KIND_BY_TYPE_URI.find((oneRule) => typeUris.has(oneRule.typeUri));
				kindBySubject.set(subjectRoot, matched ? matched.kind : 'untyped');
			});
			return kindBySubject;
		};

		const sampleOf = (statement) => ({
			subject: statement.subject,
			predicate: statement.predicate,
			objectKind: statement.objectKind,
			object:
				String(statement.object).length > 160
					? `${String(statement.object).slice(0, 160)}…`
					: String(statement.object),
			datatype: statement.datatype || '',
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
						`roundTripCanonical produces.`,
				);
				return;
			}
			if (!(emittedStatements instanceof Map)) {
				callback(
					`${moduleName}.diffStatements: emittedStatements is REQUIRED and must be the Map ` +
						`roundTripCanonical produces.`,
				);
				return;
			}

			const kindBySubject = kindMapFrom(sourceStatements);
			const emittedKindBySubject = kindMapFrom(emittedStatements);
			emittedKindBySubject.forEach((oneKind, oneSubject) => {
				if (!kindBySubject.has(oneSubject)) {
					kindBySubject.set(oneSubject, oneKind);
				}
			});
			const kindOf = (statement) => kindBySubject.get(statement.subjectRoot) || 'untyped';

			// per-predicate and per-kind accumulators. One pass over each side; nothing is recomputed.
			const perPredicate = new Map();
			const predicateRow = (predicate) => {
				if (!perPredicate.has(predicate)) {
					perPredicate.set(predicate, {
						predicate,
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

			let matched = 0;
			let lost = 0;

			sourceStatements.forEach((oneStatement, oneKey) => {
				const predicateAccumulator = predicateRow(oneStatement.predicate);
				const kindAccumulator = kindRow(kindOf(oneStatement));
				predicateAccumulator.source += 1;
				kindAccumulator.source += 1;
				kindAccumulator.sourceSubjects.add(oneStatement.subjectRoot);
				if (emittedStatements.has(oneKey)) {
					matched += 1;
					predicateAccumulator.matched += 1;
					kindAccumulator.matched += 1;
					return;
				}
				lost += 1;
				predicateAccumulator.lost += 1;
				kindAccumulator.lost += 1;
				if (predicateAccumulator.lostSamples.length < MAX_SAMPLES_PER_PREDICATE) {
					predicateAccumulator.lostSamples.push(sampleOf(oneStatement));
				}
			});

			let invented = 0;
			emittedStatements.forEach((oneStatement, oneKey) => {
				const predicateAccumulator = predicateRow(oneStatement.predicate);
				const kindAccumulator = kindRow(kindOf(oneStatement));
				predicateAccumulator.emitted += 1;
				kindAccumulator.emitted += 1;
				kindAccumulator.emittedSubjects.add(oneStatement.subjectRoot);
				if (sourceStatements.has(oneKey)) {
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

			// -----------------------------------------------------------------
			// AUDIT A6 / GATE F-5 — structural fidelity, reported SEPARATELY
			// -----------------------------------------------------------------
			// Option values carry ~81.7% of every statement in the source, so the headline percentage
			// is dominated by them: one option-value annotation predicate moves it ~8.6 points, while
			// losing the ENTIRE class taxonomy moves it 0.4. A reader watching only the headline
			// cannot see structural loss at all. Both independent audits raised this separately, which
			// is a good reason to believe it is not a matter of taste.
			//
			// structuralFidelityPercent is the same arithmetic restricted to class + property
			// statements — the shape of the model, with the codeset tonnage removed.
			const STRUCTURAL_KINDS = ['class', 'property'];
			const structuralTotals = kindRows
				.filter((oneRow) => STRUCTURAL_KINDS.includes(oneRow.kind))
				.reduce(
					(accumulator, oneRow) => ({
						source: accumulator.source + oneRow.source,
						matched: accumulator.matched + oneRow.matched,
					}),
					{ source: 0, matched: 0 },
				);

			const report = {
				reportVersion: REPORT_VERSION,
				context: context || {},
				headline: {
					sourceStatements: sourceTotal,
					emittedStatements: emittedStatements.size,
					matched,
					lost,
					invented,
					fidelityPercent: sourceTotal ? Number(((matched / sourceTotal) * 100).toFixed(3)) : 0,

					// AUDIT A1 / GATE N-3 — a single number that CANNOT look clean while inventing.
					// fidelityPercent is matched/source and is structurally blind to invention: an
					// emission carrying four fabricated statements still reported 71.936%, proven
					// live during the audit. Dividing by (source + invented) makes fabrication cost
					// something. This is a DISPLAY value; acceptance is still `lost == 0 AND
					// invented == 0` and never a percentage (gate F-4).
					cleanFidelityPercent:
						sourceTotal + invented
							? Number(((matched / (sourceTotal + invented)) * 100).toFixed(3))
							: 0,

					structuralFidelityPercent: structuralTotals.source
						? Number(((structuralTotals.matched / structuralTotals.source) * 100).toFixed(3))
						: 0,
					structuralSourceStatements: structuralTotals.source,
					structuralMatched: structuralTotals.matched,

					sourceDuplicatesCollapsed: (sourceStats || {}).duplicateCount || 0,
					emittedDuplicatesCollapsed: (emittedStats || {}).duplicateCount || 0,
					sourceSubjects: (sourceStats || {}).subjectCount || 0,
					emittedSubjects: (emittedStats || {}).subjectCount || 0,

					// AUDIT A2 / GATE C-4 — the canonicalizer COUNTS top-level elements carrying no
					// rdf:about, and this function used to DROP that counter: it reached neither the
					// text report nor the JSON sidecar. It is 0 for today's source, but a future CEDS
					// release using rdf:ID or about-less rdf:Description would be silently invisible —
					// statements never seen on the source side cannot be reported lost. Surfaced here
					// and rendered loudly below, the same treatment canonicalizationFaults gets.
					sourceTopLevelWithoutSubject: (sourceStats || {}).topLevelWithoutSubject || 0,
					emittedTopLevelWithoutSubject: (emittedStats || {}).topLevelWithoutSubject || 0,
				},
				perPredicate: predicateRows,
				perEntityKind: kindRows,
				invented: {
					total: invented,
					perPredicate: inventedRows,
				},
				canonicalizationFaults: []
					.concat(((sourceStats || {}).faults || []).map((one) => `source: ${one}`))
					.concat(((emittedStats || {}).faults || []).map((one) => `emitted: ${one}`)),
			};

			callback('', { report });
		};

		// =====================================================================
		// renderReportText — the human-readable deliverable, from the SAME object as the sidecar
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
			lines.push('CEDS ROUND-TRIP FIDELITY REPORT');
			lines.push('='.repeat(96));
			lines.push('');
			lines.push(
				'The criterion is SEMANTIC round-trip — triple-set equality. Whitespace, element order,',
			);
			lines.push(
				'attribute order and prefix choice do NOT count as differences; a missing or extra',
			);
			lines.push('STATEMENT does. This measures what the GRAPH can support, not what the forge saw.');
			lines.push('');
			Object.keys(report.context || {}).forEach((oneKey) => {
				lines.push(`  ${padRight(`${oneKey}:`, 22)}${report.context[oneKey]}`);
			});
			lines.push('');
			lines.push('-'.repeat(96));
			lines.push('HEADLINE');
			lines.push('-'.repeat(96));
			lines.push(`  statements in source ....... ${padLeft(headline.sourceStatements, 9)}`);
			lines.push(`  statements emitted ......... ${padLeft(headline.emittedStatements, 9)}`);
			lines.push(`  MATCHED .................... ${padLeft(headline.matched, 9)}`);
			lines.push(
				`  LOST ....................... ${padLeft(headline.lost, 9)}   (in source, not emitted)`,
			);
			lines.push(
				`  INVENTED ................... ${padLeft(headline.invented, 9)}   (emitted, not in source)`,
			);
			lines.push(`  fidelity ................... ${padLeft(`${headline.fidelityPercent}%`, 9)}`);
			lines.push(
				`  clean fidelity ............. ${padLeft(`${headline.cleanFidelityPercent}%`, 9)}   ` +
					`(matched / (source + invented) -- falls when anything is fabricated)`,
			);
			lines.push(
				`  STRUCTURAL fidelity ........ ${padLeft(`${headline.structuralFidelityPercent}%`, 9)}   ` +
					`(class + property only: ${headline.structuralMatched} of ` +
					`${headline.structuralSourceStatements})`,
			);
			lines.push('');
			lines.push(
				'  NOTE: no percentage above is an acceptance criterion. Acceptance is LOST == 0 AND',
			);
			lines.push(
				'  INVENTED == 0. A tampered emission carrying four fabricated statements still reported',
			);
			lines.push('  the same headline fidelity -- proven live. Read the two counts, not the percent.');
			lines.push('');
			lines.push(
				`  subjects: source ${headline.sourceSubjects}, emitted ${headline.emittedSubjects}` +
					`   |   duplicate statements collapsed: source ${headline.sourceDuplicatesCollapsed}, ` +
					`emitted ${headline.emittedDuplicatesCollapsed}`,
			);
			lines.push('');

			// AUDIT A2 / GATE C-4 — rendered LOUDLY when nonzero, silent-but-present when clean.
			// A top-level element with no rdf:about is a subject this instrument cannot see, which
			// means statements it cannot report lost. Zero for today's source; a future CEDS release
			// using rdf:ID or about-less rdf:Description would trip it.
			const topLevelWithoutSubjectTotal =
				(headline.sourceTopLevelWithoutSubject || 0) + (headline.emittedTopLevelWithoutSubject || 0);
			if (topLevelWithoutSubjectTotal) {
				lines.push('  ' + '!'.repeat(92));
				lines.push(
					`  !! SUBJECT-LESS TOP-LEVEL ELEMENTS: source ${headline.sourceTopLevelWithoutSubject}, ` +
						`emitted ${headline.emittedTopLevelWithoutSubject}`,
				);
				lines.push(
					'  !! These carry no rdf:about, so this instrument cannot address them. Statements it',
				);
				lines.push(
					'  !! cannot see, it cannot report lost. TREAT EVERY NUMBER IN THIS REPORT AS SUSPECT',
				);
				lines.push('  !! until the canonicalizer is taught to address them.');
				lines.push('  ' + '!'.repeat(92));
			} else {
				lines.push(
					'  subject-less top-level elements: 0 in source, 0 in emission (nothing unaddressable)',
				);
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
					'  A loss is a gap in what the graph carries. An invention is an assertion about CEDS',
				);
				lines.push('  that CEDS never made — it is a DEFECT in the graph or in this compiler.');
				lines.push('');
				report.invented.perPredicate.forEach((oneRow) => {
					lines.push(`  ${padLeft(oneRow.invented, 8)}  ${oneRow.predicate}`);
					oneRow.inventedSamples.forEach((oneSample) => {
						lines.push(
							`            ${oneSample.subject}\n              ${oneSample.objectKind} = ${oneSample.object}`,
						);
					});
				});
			}
			lines.push('');

			lines.push('-'.repeat(96));
			lines.push('PER-PREDICATE LOSS — sorted by loss. THIS IS THE ENRICHMENT WORK ORDER.');
			lines.push('-'.repeat(96));
			lines.push(
				`  ${padLeft('LOST', 8)}  ${padLeft('source', 8)}  ${padLeft('emitted', 8)}  ${padLeft('matched', 8)}  ${padLeft('invented', 8)}  predicate`,
			);
			report.perPredicate.forEach((oneRow) => {
				lines.push(
					`  ${padLeft(oneRow.lost, 8)}  ${padLeft(oneRow.source, 8)}  ${padLeft(oneRow.emitted, 8)}  ` +
						`${padLeft(oneRow.matched, 8)}  ${padLeft(oneRow.invented, 8)}  ${oneRow.predicate}`,
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
					lines.push(`  ${oneRow.predicate}  (${oneRow.lost} lost of ${oneRow.source})`);
					oneRow.lostSamples.forEach((oneSample) => {
						lines.push(`    ${oneSample.subject}`);
						lines.push(
							`      ${oneSample.objectKind}${oneSample.datatype ? `<${oneSample.datatype}>` : ''} = ${oneSample.object}`,
						);
					});
				});
			lines.push('');

			if (report.canonicalizationFaults.length) {
				lines.push('-'.repeat(96));
				lines.push('CANONICALIZATION FAULTS');
				lines.push('-'.repeat(96));
				report.canonicalizationFaults.forEach((oneFault) => lines.push(`  ${oneFault}`));
				lines.push('');
			}

			callback('', { reportText: `${lines.join('\n')}\n` });
		};

		// =====================================================================
		// compareRdfFiles — the convenience seam: two file paths -> a report.
		// =====================================================================

		const compareRdfFiles = ({ sourcePath, emittedPath, context } = {}, callback) => {
			canonicalLib.canonicalizeRdfFile({ filePath: sourcePath }, (sourceError, sourceResult) => {
				if (sourceError) {
					callback(sourceError);
					return;
				}
				canonicalLib.canonicalizeRdfFile(
					{ filePath: emittedPath },
					(emittedError, emittedResult) => {
						if (emittedError) {
							callback(emittedError);
							return;
						}
						diffStatements(
							{
								sourceStatements: sourceResult.statements,
								emittedStatements: emittedResult.statements,
								sourceStats: sourceResult.stats,
								emittedStats: emittedResult.stats,
								context,
							},
							callback,
						);
					},
				);
			});
		};

		return {
			diffStatements,
			renderReportText,
			compareRdfFiles,
			kindMapFrom,
			REPORT_VERSION,
			MAX_SAMPLES_PER_PREDICATE,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
