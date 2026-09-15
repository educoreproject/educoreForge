'use strict';

// test-sifRoundTrip.js — the SIF round-trip instrument proven end to end (doctrine §5.4, §6).
//
//   SECTION 1  RT-5 grammar verification: the TWO grammar constants the canonicalizer embeds —
//              the `<TableName>: Table N` section delimiter and the literal 8-column header —
//              are UNIFORM across the real snapshot (159 sections, 159 header rows), so the
//              shape the instrument knows is verified, not assumed.
//   SECTION 2  canonicalization invariance AND order sensitivity: line endings and trailing
//              whitespace are NOT statements; a changed WORD is; and — R-SF-1, the deliberate
//              divergence from pesc — a changed ROW ORDER is: swapping two rows changes the
//              precedence statement set.
//   SECTION 3  THE ZERO-LOSS GATE (RT-7): the hermetic fixture — real forgeSif (skipEmbedding),
//              graph double, real canonicalizer/diff — round-trips at ZERO loss and ZERO
//              invention, with predicate coverage pinned so a future fixture edit cannot
//              quietly shrink what the exercised vocabulary means. (fieldCharacteristics is
//              PINNED ABSENT: the fixture's Characteristics cells are deliberately empty
//              because the forge translation drops that column — a measured contentGap backlog
//              item on the real corpus, not a fixture-hideable one. A fixture that stated
//              characteristics could never be clean through the real chain; hiding that would
//              fake RT-7.)
//   SECTION 4  THE CHEATING DETECTOR (RT-10 twin 1): delete a REAL field from the graph double
//              and the REAL diff must name its statements LOST — and INVENTED must stay 0 (the
//              R-SF-7 honest-loss property: a missing member never books as invention).
//   SECTION 5  the invention alarm: inject a field the source never stated; INVENTED must fire
//              and name it, including its fabricated precedence pairs.
//   SECTION 5b THE ORDER-SWAP TWIN (R-SF-1's required proof, supervisor-named obligation 1):
//              swap two members' sequenceOrdinals in the graph double and the REAL diff goes
//              RED with PAIRED lost/invented precedence statements naming the group and both
//              members, and the orderMismatchList pairs them explicitly. Red report preserved
//              in test-artifacts/.
//   SECTION 6  refusals BY NAME (RT-3): container absent, bolt unpublished, credential missing,
//              snapshot absent/corrupt/unlisted/short, zero and multiple main-TSV candidates —
//              each refusal names its cause; the intact control proves no over-refusal.
//   SECTION 7  the gate suite: gates/sifRoundTripGates.jsonc evaluated over REAL measurements,
//              then EVERY gate's twin observed turning it RED; registry audited both ways.
//
// What the graph double does NOT prove (stated per the reference's honesty rule): the loader.
// That proof belongs to the validator's real-container run (runSifRoundTripRealGraph.js against
// DEV_sifRoundTrip_080326), which uses this same machinery over bolt.
//
// House style: no async/await, no try/catch for control flow; sequencing via taskListPlus.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: (m) => console.log(m),
	error: (m) => console.error(m),
	result: (m) => console.log(m),
	verbose: () => {},
};

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const harness = require('../../../test/testLib/harness')(moduleName);

const bundle = require('../forgeSif')({ embedder: null });
const canonicalLib = require('../lib/roundTripSifCanonical')();
const compilerLib = require('../lib/roundTripSifCompiler')();
const doubleLib = require('../lib/roundTripGraphDouble')();
const validatorLib = require('../roundTripValidator')();
const gatesLib = require('../lib/roundTripGates')();
const twinsLib = require('../lib/roundTripGateTwins')();

const FIXTURE_SOURCE_DIR = path.join(__dirname, 'fixtures', 'sifRoundTripFixture');
const GATES_FILE_PATH = path.join(__dirname, '..', 'gates', 'sifRoundTripGates.jsonc');
const ARTIFACT_DIR = path.join(__dirname, 'test-artifacts');
const REAL_SNAPSHOT_DIR = path.join(__dirname, '..', 'assets', 'standardSourceData', '01');
const REAL_TABLE_SECTION_COUNT = 159;

const FIXTURE_STUDENT_ROOT_GROUP = 'sif:group/FixtureStudent/(root)';
const REFID_XPATH = '/FixtureStudents/FixtureStudent/@RefId';
const LOCAL_ID_XPATH = '/FixtureStudents/FixtureStudent/LocalId';
const STATUS_CODE_XPATH = '/FixtureStudents/FixtureStudent/StatusCode';

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

const makeTempDir = (labelText) => fs.mkdtempSync(path.join(os.tmpdir(), `sifRoundTrip-${labelText}-`));

// stage the fixture as a verifiable snapshot: copy the committed .tsv files and write SHA256SUMS.
/**
 * @typedef {function(string): string} MainTsvTextTransform
 *   Receives the main spec TSV's full text and returns the text to stage. Declared because it is an
 *   injected-behavior seam, however small: a caller supplies code that the stager runs. Must be
 *   pure and must return a string; returning undefined would stage the literal text 'undefined'.
 *
 * @param {{ transformMainTsvText?: MainTsvTextTransform }} [options]
 * @returns {string} the staged snapshot directory path (with a SHA256SUMS over the staged bytes)
 */
const stageFixtureSnapshot = ({ transformMainTsvText } = {}) => {
	const snapshotDirPath = makeTempDir('fixtureSnapshot');
	const sumLines = [];
	fs.readdirSync(FIXTURE_SOURCE_DIR)
		.filter((oneName) => oneName.endsWith('.tsv'))
		.sort()
		.forEach((oneName) => {
			let fileBytes = fs.readFileSync(path.join(FIXTURE_SOURCE_DIR, oneName));
			// PHASE 4, OPTIONAL: mutate the main spec TSV before staging. Used by the G-15 refusal
			// probe to poison one Characteristics cell. With the option absent this function behaves
			// byte-for-byte as it always did, so every existing caller is unaffected.
			//
			// The checksum below is deliberately computed over the WRITTEN (mutated) bytes, so a
			// mutation does NOT trip the snapshot-integrity refusal. That matters: if SHA256SUMS
			// disagreed, the forge would refuse for a CHECKSUM reason and a careless probe would
			// count that as proof of the vocabulary refusal. G-15's regex requires the vocabulary
			// text precisely so it cannot be satisfied by the wrong refusal.
			if (transformMainTsvText && oneName.startsWith('ImplementationSpecification')) {
				fileBytes = Buffer.from(transformMainTsvText(fileBytes.toString('utf-8')), 'utf-8');
			}
			fs.writeFileSync(path.join(snapshotDirPath, oneName), fileBytes);
			sumLines.push(`${crypto.createHash('sha256').update(fileBytes).digest('hex')}  ${oneName}`);
		});
	fs.writeFileSync(path.join(snapshotDirPath, 'SHA256SUMS'), `${sumLines.join('\n')}\n`);
	return snapshotDirPath;
};

// run the whole instrument over a (possibly corrupted) graph double.
const runInstrument = ({ sifGraph, adjustSifGraph, snapshotDirPath, runLabel }, callback) => {
	const reader = doubleLib.makeGraphDoubleReader({ sifGraph, adjustSifGraph });
	validatorLib.validateWithReader(
		{
			reader,
			snapshotPath: snapshotDirPath,
			outputPath: makeTempDir(`out-${runLabel}`),
			graphIdentity: { containerName: `graphDouble:${runLabel}`, boltUrl: 'none (reader double)' },
		},
		callback,
	);
};

const lostSampleObjects = (report, predicate) => {
	const row = report.perPredicate.find((oneRow) => oneRow.predicate === predicate);
	return row ? row.lostSamples.map((oneSample) => oneSample.object) : [];
};
const inventedSampleObjects = (report, predicate) => {
	const row = report.perPredicate.find((oneRow) => oneRow.predicate === predicate);
	return row ? row.inventedSamples.map((oneSample) => oneSample.object) : [];
};

// ---------------------------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------------------------

const taskList = new taskListPlus();
const probeFacts = {}; // assembled across sections; consumed by the gate suite in section 7

// SECTION 1 — RT-5: the grammar constants are verified against the whole real source.
taskList.push((args, next) => {
	harness.section('SECTION 1 — RT-5: section-delimiter + column-header uniformity across the real snapshot');
	const mainTsvFilename = fs
		.readdirSync(REAL_SNAPSHOT_DIR)
		.filter((oneName) => oneName.endsWith('.tsv') && oneName !== 'refIdResolutionMap.tsv')
		.sort()[0];
	harness.ok('real snapshot holds a main TSV', Boolean(mainTsvFilename));
	const lineList = fs
		.readFileSync(path.join(REAL_SNAPSHOT_DIR, mainTsvFilename), 'utf8')
		.split('\n')
		.map((oneLine) => oneLine.trimEnd());
	let sectionCount = 0;
	let headersAfterSections = 0;
	lineList.forEach((oneLine, oneIndex) => {
		if (canonicalLib.TABLE_SECTION_PATTERN.test(oneLine)) {
			sectionCount++;
			if ((lineList[oneIndex + 1] || '').trimEnd() === canonicalLib.LITERAL_COLUMN_HEADER) {
				headersAfterSections++;
			}
		}
	});
	harness.equal(
		`the real snapshot states ${REAL_TABLE_SECTION_COUNT} table sections`,
		sectionCount,
		REAL_TABLE_SECTION_COUNT,
	);
	harness.equal(
		'EVERY section header is followed by the literal 8-column header (the grammar is uniform)',
		headersAfterSections,
		REAL_TABLE_SECTION_COUNT,
	);
	next('', args);
});

// SECTION 2 — cosmetic rewrites are invisible; a real difference is not; ORDER IS A STATEMENT.
taskList.push((args, next) => {
	harness.section('SECTION 2 — invariance (whitespace/line endings) vs sensitivity (words AND ORDER, R-SF-1)');
	const rowAlpha = 'Alpha\t*\t\ttoken\tFirst probe field.\t/Probes/Probe/Alpha\t\t';
	const rowBeta = 'Beta\t\t\ttoken\tSecond probe field.\t/Probes/Probe/Beta\t\t';
	const rowGamma = 'Gamma\t*\t\tdate\t\t/Probes/Probe/Gamma\t\t';
	const headerPair = ['Probes: Table 1', canonicalLib.LITERAL_COLUMN_HEADER];
	const textPlain = [...headerPair, rowAlpha, rowBeta, rowGamma].join('\n');
	const textCosmetic = `${[...headerPair, rowAlpha, rowBeta, rowGamma].join('\r\n')}\r\n`;
	const textChangedWord = textPlain.replace('First probe field.', 'A DIFFERENT probe field.');
	const textSwappedRows = [...headerPair, rowGamma, rowBeta, rowAlpha].join('\n');

	canonicalLib.statementsFromTsvText({ tsvText: textPlain }, (plainError, plainResult) => {
		harness.accepts('plain spelling canonicalizes', [plainError].filter(Boolean));
		canonicalLib.statementsFromTsvText({ tsvText: textCosmetic }, (cosmeticError, cosmeticResult) => {
			harness.accepts('CRLF/trailing-whitespace spelling canonicalizes', [cosmeticError].filter(Boolean));
			canonicalLib.statementsFromTsvText({ tsvText: textChangedWord }, (wordError, wordResult) => {
				harness.accepts('changed-word spelling canonicalizes', [wordError].filter(Boolean));
				canonicalLib.statementsFromTsvText({ tsvText: textSwappedRows }, (swapError, swapResult) => {
					harness.accepts('swapped-row spelling canonicalizes', [swapError].filter(Boolean));
					const keysOf = (oneResult) => Array.from(oneResult.statements.keys()).sort().join('\n');
					harness.ok(
						'line endings and trailing whitespace are NOT statements (plain == cosmetic)',
						keysOf(plainResult) === keysOf(cosmeticResult),
					);
					harness.ok('a changed WORD is a statement (plain != changed-word)', keysOf(plainResult) !== keysOf(wordResult));
					harness.ok(
						'a changed ROW ORDER is a statement (R-SF-1: plain != swapped-rows)',
						keysOf(plainResult) !== keysOf(swapResult),
					);
					const plainPrecedenceKeys = Array.from(plainResult.statements.keys()).filter((oneStatementKey) =>
						oneStatementKey.includes('\tprecedesInGroup\t'),
					);
					const swapKeySet = new Set(swapResult.statements.keys());
					harness.ok(
						'the difference lives in the precedence statements (some plain pair absent after the swap)',
						plainPrecedenceKeys.some((oneStatementKey) => !swapKeySet.has(oneStatementKey)),
					);
					harness.ok(
						'the NON-order statements are identical across the swap (the swap changed order and nothing else)',
						Array.from(plainResult.statements.keys())
							.filter((oneStatementKey) => !oneStatementKey.includes('\tprecedesInGroup\t'))
							.every((oneStatementKey) => swapKeySet.has(oneStatementKey)),
					);
					next('', args);
				});
			});
		});
	});
});

// SECTION 3 — stage fixture, forge it with the REAL forge, round-trip to ZERO/ZERO.
taskList.push((args, next) => {
	harness.section('SECTION 3 — THE ZERO-LOSS GATE (hermetic fixture, real forgeSif, graph double)');
	const snapshotDirPath = stageFixtureSnapshot();
	bundle.forge({ sourcePath: snapshotDirPath, skipEmbedding: true }, (forgeError, forgeResult) => {
		harness.accepts('fixture forges through the real forgeSif', [forgeError].filter(Boolean));
		if (forgeError) {
			next('', { ...args, fixtureBroken: true });
			return;
		}
		const sifGraph = doubleLib.buildSifGraphFromForgeOutput({
			nodes: forgeResult.nodes,
			edges: forgeResult.edges,
		});
		runInstrument({ sifGraph, snapshotDirPath, runLabel: 'clean' }, (validateError, verdict) => {
			harness.accepts('validateWithReader completes', [validateError].filter(Boolean));
			if (validateError) {
				next('', { ...args, fixtureBroken: true });
				return;
			}
			harness.equal('ZERO LOSS', verdict.lost, 0);
			harness.equal('ZERO INVENTION', verdict.invented, 0);
			harness.equal('ZERO order mismatches', verdict.orderMismatches, 0);
			harness.ok('roundTripClean is TRUE', verdict.roundTripClean === true);
			harness.ok(
				`the fixture is substantial enough to mean something (${verdict.report.headline.sourceStatements} source statements >= 60)`,
				verdict.report.headline.sourceStatements >= 60,
			);
			// predicate coverage pinned: a future fixture edit cannot quietly shrink coverage.
			const sourcePredicateSet = new Set(
				verdict.report.perPredicate
					.filter((oneRow) => oneRow.source > 0)
					.map((oneRow) => oneRow.predicate),
			);
			[
				'objectTableName',
				'objectElementName',
				'fieldName',
				'fieldMandatory',
				'fieldType',
				'fieldDescription',
				'fieldCedsId',
				'fieldFormat',
				'fieldCharacteristics',
				'precedesInGroup',
			].forEach((onePredicate) => {
				harness.ok(`fixture exercises ${onePredicate}`, sourcePredicateSet.has(onePredicate));
			});
			// ---- fieldCharacteristics: UNPINNED IN PHASE 4 (it was PINNED ABSENT through Phase 3).
			//
			// Phase 2 pinned this predicate ABSENT and said exactly why: the forge dropped the
			// Characteristics column, so a fixture that STATED characteristics could never round-trip
			// clean, and hiding that would have faked RT-7. That reasoning was right and is now spent —
			// Phase 4 carries the column, so the fixture states it and the RT-7 zero-loss claim covers
			// it. The assertion is INVERTED rather than deleted: this predicate's coverage was
			// deliberate when absent and is deliberate now that it is present.
			//
			// COUNTS, NOT PRESENCE, WITH BOTH SIDES NAMED (doctrine A8). The fixture has 12 field rows;
			// 11 state a Characteristics value and ONE (LastName) deliberately leaves the cell empty.
			// So fieldCharacteristics must mint exactly 11 source statements against fieldName's 12,
			// and THE DIFFERENCE OF EXACTLY 1 IS THE ABSENT-IS-ABSENT PROOF: the empty cell minted no
			// statement on either side. A forge that defaulted an empty cell would make these two
			// counts equal and fail here — which is the only reason to assert the difference rather
			// than just the count.
			const perPredicateRowFor = (onePredicateName) =>
				verdict.report.perPredicate.find((oneRow) => oneRow.predicate === onePredicateName) || {};
			const fieldCharacteristicsRow = perPredicateRowFor('fieldCharacteristics');
			const fieldNameRow = perPredicateRowFor('fieldName');
			harness.equal(
				'fixture mints exactly 11 fieldCharacteristics source statements (11 of 12 field rows state a value)',
				fieldCharacteristicsRow.source,
				11,
			);
			harness.equal(
				'fixture loses ZERO fieldCharacteristics statements',
				fieldCharacteristicsRow.lost,
				0,
			);
			harness.equal('fixture has 12 field rows (the fieldName source count)', fieldNameRow.source, 12);
			harness.equal(
				'ABSENT IS ABSENT: fieldName source minus fieldCharacteristics source is exactly 1 (the one empty cell carried nothing)',
				fieldNameRow.source - fieldCharacteristicsRow.source,
				1,
			);
			// the whole CLOSED VOCABULARY is exercised, including BOTH 'C' shapes the real corpus
			// carries: C with a mandatory '*' (the nine choice-group rows of README_ERRATA.md S-2) and
			// C with a blank flag. A fixture exercising only one shape would leave the derivation's
			// most delicate case unproven.
			const fixtureCharacteristicsValueSet = new Set(
				forgeResult.nodes
					.filter((oneNode) => (oneNode.labels || []).includes('SifField'))
					.map((oneNode) => (oneNode.properties || {}).characteristics)
					.filter((oneValue) => oneValue !== undefined),
			);
			['O', 'M', 'MR', 'OR', 'C'].forEach((oneValue) => {
				harness.ok(
					`fixture exercises Characteristics value '${oneValue}'`,
					fixtureCharacteristicsValueSet.has(oneValue),
				);
			});
			probeFacts.unmodeledConstructTotal =
				verdict.report.sourceStats.unrecognizedLineCount +
				verdict.report.sourceStats.emptyNameRowsSkipped;
			harness.equal('no unmodeled source content on the fixture', probeFacts.unmodeledConstructTotal, 0);
			probeFacts.snapshotIdentityWellFormed =
				/^[0-9a-f]{64}$/.test(verdict.snapshot.combinedDigest) &&
				verdict.snapshot.files.length === 2 &&
				verdict.snapshot.files.every((oneFile) => /^[0-9a-f]{64}$/.test(oneFile.sha256));
			harness.ok('verdict names its snapshot (digests well-formed, both files)', probeFacts.snapshotIdentityWellFormed);
			probeFacts.graphIdentityPresent =
				!!verdict.graph &&
				!!verdict.graph.nodeCounts &&
				verdict.graph.nodeCounts.SifObject >= 1 &&
				verdict.graph.nodeCounts.SifField >= 1 &&
				!!verdict.graph.rootProperties;
			harness.ok('verdict names its graph (root provenance + counts)', probeFacts.graphIdentityPresent);
			// A6 / R-WO-21 normative RT-6 fields: the LIVE RT-13 stage adjudicates on exactly
			// {roundTripClean, inventedTotal, lostTotal, contentGapTotal, explicitlyOmittedTotal}
			// with zero per-standard knowledge and
			// REFUSES BY NAME a verdict lacking them. Asserted as names AND as equalities, so a
			// future edit cannot let the normative name drift away from the count it reports.
			probeFacts.normativeVerdictFieldsPresent =
				typeof verdict.roundTripClean === 'boolean' &&
				typeof verdict.inventedTotal === 'number' &&
				typeof verdict.lostTotal === 'number' &&
				typeof verdict.contentGapTotal === 'number' &&
				typeof verdict.explicitlyOmittedTotal === 'number' &&
				typeof verdict.notReproducedTotal === 'number' &&
				// A13: lostTotal is contentGap ALONE, never the sum.
				verdict.lostTotal === verdict.contentGapTotal &&
				verdict.contentGapTotal + verdict.explicitlyOmittedTotal ===
					verdict.notReproducedTotal &&
				verdict.inventedTotal === verdict.invented &&
				verdict.lostTotal === verdict.lost;
			harness.ok(
				'verdict carries the normative RT-6 fields (roundTripClean/inventedTotal/lostTotal/contentGapTotal/explicitlyOmittedTotal) agreeing with the diff counts',
				probeFacts.normativeVerdictFieldsPresent,
				`inventedTotal=${verdict.inventedTotal} lostTotal=${verdict.lostTotal}`,
			);
			probeFacts.scaleReportWellFormed =
				!!verdict.scaleReport &&
				typeof verdict.scaleReport.runtimeMs === 'number' &&
				verdict.scaleReport.runtimeMs >= 0 &&
				verdict.scaleReport.rssBytes > 0 &&
				verdict.scaleReport.heapUsedBytes > 0 &&
				verdict.scaleReport.sourceStatements > 0 &&
				!!verdict.scaleReport.largestSourceGroup &&
				verdict.scaleReport.largestSourceGroup.memberCount >= 2 &&
				verdict.scaleReport.largestSourceGroup.pairCount >= 1 &&
				verdict.scaleReport.largestSourceGroup.groupSubject !== '';
			harness.ok(
				'SCALE report well-formed (runtime, memory, censuses, largest group n + pairs)',
				probeFacts.scaleReportWellFormed,
			);
			fs.writeFileSync(
				path.join(ARTIFACT_DIR, 'sifRoundTripFixtureClean.verdict.json'),
				`${JSON.stringify(verdict, null, 1)}\n`,
			);
			next('', { ...args, snapshotDirPath, sifGraph, cleanVerdict: verdict, forgeResult });
		});
	});
});

// SECTION 4 — THE CHEATING DETECTOR: delete REAL facts; the diff must name each LOST, and the
// deletion must book as PURE LOSS (INVENTED stays 0 — the R-SF-7 honest-loss property).
taskList.push((args, next) => {
	if (args.fixtureBroken) {
		next('', args);
		return;
	}
	harness.section('SECTION 4 — CHEATING DETECTOR: a deleted graph fact must surface as LOST, by name');
	const { sifGraph, snapshotDirPath } = args;

	const deleteLocalIdField = (servedGraph) => {
		servedGraph.fieldNodeList = servedGraph.fieldNodeList.filter(
			(oneNode) => oneNode.xpath !== LOCAL_ID_XPATH,
		);
		servedGraph.hasPropertyPairList = servedGraph.hasPropertyPairList.filter(
			(onePair) => onePair.memberId !== `sif:field/${LOCAL_ID_XPATH}`,
		);
		return servedGraph;
	};
	runInstrument(
		{ sifGraph, adjustSifGraph: deleteLocalIdField, snapshotDirPath, runLabel: 'deletedField' },
		(runError, verdict) => {
			harness.accepts('deleted-field run completes', [runError].filter(Boolean));
			if (runError) {
				next('', args);
				return;
			}
			const namedLostNames = lostSampleObjects(verdict.report, 'fieldName');
			harness.ok('deleting the LocalId field turns the diff RED', verdict.lost > 0);
			harness.ok('roundTripClean falls to FALSE', verdict.roundTripClean === false);
			harness.ok(
				`the deleted field is NAMED in the lost census (${JSON.stringify(namedLostNames)})`,
				namedLostNames.includes('LocalId'),
			);
			harness.ok(
				'its CEDS annotation goes with it, also named',
				lostSampleObjects(verdict.report, 'fieldCedsId').includes('P000100'),
			);
			harness.ok(
				'its precedence pairs go with it — sequence loss is located, not silent',
				lostSampleObjects(verdict.report, 'precedesInGroup').some((oneObject) =>
					oneObject.includes(LOCAL_ID_XPATH),
				),
			);
			harness.equal(
				'INVENTED stays 0 under pure deletion (honest loss never books as invention, R-SF-7)',
				verdict.invented,
				0,
			);
			probeFacts.deletedFactShowsLost = verdict.lost > 0 && namedLostNames.includes('LocalId');
			probeFacts.lostRowsWithoutSamples = verdict.report.perPredicate.filter(
				(oneRow) => oneRow.lost > 0 && oneRow.lostSamples.length === 0,
			).length;
			harness.equal('every lost row carries located samples', probeFacts.lostRowsWithoutSamples, 0);
			probeFacts.lostCategorySumMatches =
				verdict.report.headline.contentGap + verdict.report.headline.explicitlyOmitted ===
				verdict.report.headline.notReproduced;
			harness.ok(
				'contentGap + explicitlyOmitted sum exactly to NOT REPRODUCED',
				probeFacts.lostCategorySumMatches,
			);
			harness.ok(
				'every lost detail row is LOCATED and carries a backlog label',
				verdict.report.lostDetailList.length === verdict.lost &&
					verdict.report.lostDetailList.every((oneLost) => oneLost.located && oneLost.backlogLabel),
			);
			fs.writeFileSync(
				path.join(ARTIFACT_DIR, 'sifRoundTripTwin-deletedField.report.json'),
				`${JSON.stringify(verdict.report, null, 1)}\n`,
			);

			const deleteSchoolNameDescription = (servedGraph) => {
				servedGraph.fieldNodeList.forEach((oneNode) => {
					if (oneNode.name === 'SchoolName') {
						delete oneNode.description;
					}
				});
				return servedGraph;
			};
			runInstrument(
				{ sifGraph, adjustSifGraph: deleteSchoolNameDescription, snapshotDirPath, runLabel: 'deletedDescription' },
				(descriptionRunError, descriptionVerdict) => {
					harness.accepts('deleted-description run completes', [descriptionRunError].filter(Boolean));
					harness.ok(
						'deleting a field description surfaces fieldDescription LOST, by name',
						!descriptionRunError &&
							descriptionVerdict.lost > 0 &&
							lostSampleObjects(descriptionVerdict.report, 'fieldDescription').some((oneObject) =>
								oneObject.includes('Name of the fixture school'),
							),
					);
					next('', args);
				},
			);
		},
	);
});

// SECTION 5 — the invention alarm.
taskList.push((args, next) => {
	if (args.fixtureBroken) {
		next('', args);
		return;
	}
	harness.section('SECTION 5 — INVENTION: an injected graph fact must fire INVENTED, by name');
	const { sifGraph, snapshotDirPath } = args;
	const injectBogusField = (servedGraph) => {
		servedGraph.fieldNodeList.push({
			_id: 'sif:field//FixtureSchools/FixtureSchool/BogusInjected',
			name: 'BogusInjected',
			xpath: '/FixtureSchools/FixtureSchool/BogusInjected',
			sequenceOrdinal: 99,
		});
		servedGraph.hasPropertyPairList.push({
			ownerId: 'sif:object/FixtureSchools',
			memberId: 'sif:field//FixtureSchools/FixtureSchool/BogusInjected',
		});
		return servedGraph;
	};
	runInstrument(
		{ sifGraph, adjustSifGraph: injectBogusField, snapshotDirPath, runLabel: 'injectedField' },
		(runError, verdict) => {
			harness.accepts('injected-field run completes', [runError].filter(Boolean));
			if (runError) {
				next('', args);
				return;
			}
			const namedInvented = inventedSampleObjects(verdict.report, 'fieldName');
			harness.ok('INVENTED fires', verdict.invented > 0);
			harness.ok(
				`the fabricated field is NAMED (${JSON.stringify(namedInvented)})`,
				namedInvented.includes('BogusInjected'),
			);
			harness.ok(
				'its fabricated precedence pairs fire INVENTED too',
				inventedSampleObjects(verdict.report, 'precedesInGroup').some((oneObject) =>
					oneObject.includes('BogusInjected'),
				),
			);
			harness.ok('roundTripClean falls to FALSE on invention alone', verdict.roundTripClean === false);
			harness.equal('LOST stays 0 under pure injection', verdict.lost, 0);
			probeFacts.injectedFactShowsInvented =
				verdict.invented > 0 && namedInvented.includes('BogusInjected');
			fs.writeFileSync(
				path.join(ARTIFACT_DIR, 'sifRoundTripTwin-injectedField.report.json'),
				`${JSON.stringify(verdict.report, null, 1)}\n`,
			);
			next('', args);
		},
	);
});

// SECTION 5b — THE ORDER-SWAP TWIN (R-SF-1's required proof; supervisor-named obligation 1).
taskList.push((args, next) => {
	if (args.fixtureBroken) {
		next('', args);
		return;
	}
	harness.section('SECTION 5b — ORDER-SWAP TWIN: a sequence change goes RED naming the group and both members');
	const { sifGraph, snapshotDirPath } = args;
	const swapRefIdAndStatusCodeOrdinals = (servedGraph) => {
		const refIdNode = servedGraph.fieldNodeList.find((oneNode) => oneNode.xpath === REFID_XPATH);
		const statusCodeNode = servedGraph.fieldNodeList.find(
			(oneNode) => oneNode.xpath === STATUS_CODE_XPATH,
		);
		const heldOrdinal = refIdNode.sequenceOrdinal;
		refIdNode.sequenceOrdinal = statusCodeNode.sequenceOrdinal;
		statusCodeNode.sequenceOrdinal = heldOrdinal;
		return servedGraph;
	};
	runInstrument(
		{ sifGraph, adjustSifGraph: swapRefIdAndStatusCodeOrdinals, snapshotDirPath, runLabel: 'orderSwap' },
		(runError, verdict) => {
			harness.accepts('order-swap run completes', [runError].filter(Boolean));
			if (runError) {
				next('', args);
				return;
			}
			harness.ok('the swap turns the diff RED', verdict.lost > 0 && verdict.invented > 0);
			harness.ok('roundTripClean falls to FALSE', verdict.roundTripClean === false);
			const lostPairObjects = lostSampleObjects(verdict.report, 'precedesInGroup');
			const inventedPairObjects = inventedSampleObjects(verdict.report, 'precedesInGroup');
			harness.ok(
				`the LOST side names the source order (${JSON.stringify(lostPairObjects.slice(0, 3))})`,
				lostPairObjects.some(
					(oneObject) => oneObject.includes(REFID_XPATH) && oneObject.includes(STATUS_CODE_XPATH),
				),
			);
			harness.ok(
				'the INVENTED side names the reversed order — the paired RED of R-SF-7',
				inventedPairObjects.some(
					(oneObject) => oneObject.includes(STATUS_CODE_XPATH) && oneObject.includes(REFID_XPATH),
				),
			);
			harness.ok(
				'orderMismatchList PAIRS them, naming the group subject',
				verdict.report.orderMismatchList.length > 0 &&
					verdict.report.orderMismatchList.every(
						(oneMismatch) => oneMismatch.groupSubject === FIXTURE_STUDENT_ROOT_GROUP,
					),
			);
			// the exact calculus: swapping ordinals 0 and 2 in a 5-member root group flips exactly
			// the 3 pairs among {@RefId, LocalId, StatusCode} — no more, no fewer.
			harness.equal('exactly 3 pairs flipped LOST', verdict.lost, 3);
			harness.equal('exactly 3 reversed pairs INVENTED', verdict.invented, 3);
			harness.equal('exactly 3 order mismatches paired', verdict.orderMismatches, 3);
			harness.ok(
				'the middle member is named too (LocalId sits between the swapped pair)',
				verdict.report.orderMismatchList.some((oneMismatch) =>
					oneMismatch.sourceOrder.includes(LOCAL_ID_XPATH),
				),
			);
			probeFacts.orderSwapShowsPairedRedNamingMembers =
				verdict.lost === 3 &&
				verdict.invented === 3 &&
				verdict.orderMismatches === 3 &&
				verdict.report.orderMismatchList.every(
					(oneMismatch) => oneMismatch.groupSubject === FIXTURE_STUDENT_ROOT_GROUP,
				);
			fs.writeFileSync(
				path.join(ARTIFACT_DIR, 'sifRoundTripTwin-orderSwap.report.json'),
				`${JSON.stringify(verdict.report, null, 1)}\n`,
			);
			next('', args);
		},
	);
});

// SECTION 6 — refusals by name (RT-3), with the intact control against over-refusal.
taskList.push((args, next) => {
	harness.section('SECTION 6 — REFUSALS BY NAME, and the intact control');
	const refusalOutcomes = [];
	const recordRefusal = (label, errorText, namingRegex) => {
		const named = namingRegex.test(String(errorText || ''));
		harness.ok(label, Boolean(errorText) && named, errorText || '(no error at all)');
		refusalOutcomes.push(Boolean(errorText) && named);
	};

	validatorLib.validate({ snapshotPath: 'unused', outputPath: 'unused' }, (noGraphError) => {
		recordRefusal(
			'no container and no bolt triple -> refusal names both options',
			noGraphError,
			/containerName OR the full bolt triple/,
		);

		compilerLib.resolveContainerBolt(
			{
				containerName: 'DEV_absent_container',
				runDockerCommand: (dockerArgs, dockerCallback) =>
					dockerCallback(new Error('No such object: DEV_absent_container'), '', 'not found'),
			},
			(inspectError) => {
				recordRefusal(
					'absent container -> docker inspect refusal by name',
					inspectError,
					/docker inspect DEV_absent_container.*failed/,
				);

				compilerLib.resolveContainerBolt(
					{
						containerName: 'DEV_portless',
						runDockerCommand: (dockerArgs, dockerCallback) =>
							dockerCallback(null, JSON.stringify([{ NetworkSettings: { Ports: {} }, Config: { Env: [] } }]), ''),
					},
					(portError) => {
						recordRefusal(
							'container without a published bolt port -> refusal by name',
							portError,
							/publishes no host port for 7687/,
						);

						compilerLib.resolveContainerBolt(
							{
								containerName: 'DEV_authless',
								runDockerCommand: (dockerArgs, dockerCallback) =>
									dockerCallback(
										null,
										JSON.stringify([
											{
												NetworkSettings: { Ports: { '7687/tcp': [{ HostPort: '7999' }] } },
												Config: { Env: ['PATH=/bin'] },
											},
										]),
										'',
									),
							},
							(authError) => {
								recordRefusal(
									'container without NEO4J_AUTH -> refusal by name',
									authError,
									/declares no NEO4J_AUTH/,
								);

								// snapshot-side refusals.
								validatorLib.verifySnapshotDir({ snapshotPath: '/nonexistent/snapshotDir' }, (absentError) => {
									recordRefusal(
										'absent snapshot dir -> refusal names README_PROVENANCE.md',
										absentError,
										/does not exist.*README_PROVENANCE\.md/s,
									);

									const noSumsDir = makeTempDir('noSums');
									fs.copyFileSync(
										path.join(FIXTURE_SOURCE_DIR, 'ImplementationSpecification_fixture.tsv'),
										path.join(noSumsDir, 'ImplementationSpecification_fixture.tsv'),
									);
									validatorLib.verifySnapshotDir({ snapshotPath: noSumsDir }, (noSumsError) => {
										recordRefusal('missing SHA256SUMS -> refusal by name', noSumsError, /has no SHA256SUMS/);

										const corruptDir = stageFixtureSnapshot();
										fs.appendFileSync(
											path.join(corruptDir, 'ImplementationSpecification_fixture.tsv'),
											'\nTampered\t\t\ttoken\t\t/Tampered/Tamper/Tampered\t\t\n',
										);
										validatorLib.verifySnapshotDir({ snapshotPath: corruptDir }, (corruptError) => {
											recordRefusal(
												'corrupted source byte -> checksum refusal by name',
												corruptError,
												/ImplementationSpecification_fixture\.tsv.*fails its SHA256SUMS check/s,
											);

											// present-but-unlisted: the ONLY .tsv that can be unlisted without first
											// tripping the exactly-one-candidate refusal is the resolution map, so the
											// probe deliberately rewrites SHA256SUMS to omit it — proving the LISTING
											// refusal specifically (the Phase-1 fixture-ordering trick).
											const unlistedDir = stageFixtureSnapshot();
											const listedLines = fs
												.readFileSync(path.join(unlistedDir, 'SHA256SUMS'), 'utf8')
												.split('\n')
												.filter((oneLine) => oneLine.includes('ImplementationSpecification_fixture.tsv'));
											fs.writeFileSync(path.join(unlistedDir, 'SHA256SUMS'), `${listedLines.join('\n')}\n`);
											validatorLib.verifySnapshotDir({ snapshotPath: unlistedDir }, (unlistedError) => {
												recordRefusal(
													'present-but-unlisted .tsv -> refusal by name',
													unlistedError,
													/refIdResolutionMap\.tsv.*NOT listed in SHA256SUMS/s,
												);

												const shortDir = stageFixtureSnapshot();
												fs.unlinkSync(path.join(shortDir, 'refIdResolutionMap.tsv'));
												validatorLib.verifySnapshotDir({ snapshotPath: shortDir }, (shortError) => {
													recordRefusal(
														'listed-but-absent file -> refusal by name',
														shortError,
														/refIdResolutionMap\.tsv.*ABSENT from the snapshot/s,
													);

													// SIF-specific candidate-count refusals (the forge's own exactly-one
													// rule, mirrored at the instrument's door).
													const zeroCandidateDir = makeTempDir('zeroCandidates');
													const resolutionOnlyBytes = fs.readFileSync(
														path.join(FIXTURE_SOURCE_DIR, 'refIdResolutionMap.tsv'),
													);
													fs.writeFileSync(
														path.join(zeroCandidateDir, 'refIdResolutionMap.tsv'),
														resolutionOnlyBytes,
													);
													fs.writeFileSync(
														path.join(zeroCandidateDir, 'SHA256SUMS'),
														`${crypto.createHash('sha256').update(resolutionOnlyBytes).digest('hex')}  refIdResolutionMap.tsv\n`,
													);
													validatorLib.verifySnapshotDir({ snapshotPath: zeroCandidateDir }, (zeroError) => {
														recordRefusal(
															'ZERO main-TSV candidates -> refusal by name',
															zeroError,
															/holds no ImplementationSpecification/,
														);

														const twoCandidateDir = stageFixtureSnapshot();
														const mainBytes = fs.readFileSync(
															path.join(twoCandidateDir, 'ImplementationSpecification_fixture.tsv'),
														);
														fs.writeFileSync(
															path.join(twoCandidateDir, 'ImplementationSpecification_second.tsv'),
															mainBytes,
														);
														fs.appendFileSync(
															path.join(twoCandidateDir, 'SHA256SUMS'),
															`${crypto.createHash('sha256').update(mainBytes).digest('hex')}  ImplementationSpecification_second.tsv\n`,
														);
														validatorLib.verifySnapshotDir({ snapshotPath: twoCandidateDir }, (twoError) => {
															recordRefusal(
																'TWO main-TSV candidates -> refusal by name',
																twoError,
																/2 candidate source \.tsv files/,
															);

															// the CONTROL: an intact snapshot must pass (no over-refusal).
															const intactDir = stageFixtureSnapshot();
															validatorLib.verifySnapshotDir(
																{ snapshotPath: intactDir },
																(controlError, controlResult) => {
																	harness.accepts(
																		'CONTROL: intact snapshot verifies clean',
																		[controlError].filter(Boolean),
																	);
																	harness.ok(
																		'CONTROL: both fixture files verified and the main TSV identified',
																		!!controlResult &&
																			controlResult.fileRecordList.length === 2 &&
																			controlResult.mainTsvFilename ===
																				'ImplementationSpecification_fixture.tsv',
																	);
																	probeFacts.refusalsAllNamed =
																		refusalOutcomes.every(Boolean) && !controlError;
																	next('', args);
																},
															);
														});
													});
												});
											});
										});
									});
								});
							},
						);
					},
				);
			},
		);
	});
});

// SECTION 6b — PHASE 4, the CHARACTERISTICS enrichment. Three claims, each measured for real:
// the closed vocabulary REFUSES rather than defaults; the derivation is exactly the ratified table
// and never touches an unstated cell; and the derived pair cannot reach the statement domain.
taskList.push((args, next) => {
	if (args.fixtureBroken) {
		harness.ok('characteristics probes reachable', false, 'fixture broke upstream — probes unmeasurable');
		next('', args);
		return;
	}
	harness.section('SECTION 6b — CHARACTERISTICS: refusal by name, exact derivation, statement-domain isolation');

	// The derivation table RE-STATED INDEPENDENTLY, typed from the ratified ruling rather than
	// imported from forgeSif.js. Importing the forge's own table would only confirm the forge
	// agrees with itself; this is an answer key, and it must be written by hand to be one.
	const RATIFIED_DERIVATION = {
		O: { characteristicsRepeatable: false, characteristicsObligation: 'optional' },
		M: { characteristicsRepeatable: false, characteristicsObligation: 'mandatory' },
		MR: { characteristicsRepeatable: true, characteristicsObligation: 'mandatory' },
		OR: { characteristicsRepeatable: true, characteristicsObligation: 'optional' },
		C: { characteristicsRepeatable: false, characteristicsObligation: 'conditional' },
	};
	const DERIVED_PROPERTY_NAMES = ['characteristicsRepeatable', 'characteristicsObligation'];

	// ---- G-17: STRUCTURAL, and the one that guards against curing LOST by manufacturing INVENTED.
	// The compiler's read projection is the statement domain's whole surface: it builds an explicit
	// RETURN <name> AS <name> list and iterates only that same list. A derived property inside it
	// would be re-emitted as though the source had stated it.
	const readProjection = compilerLib.FIELD_PROPERTY_NAMES;
	const leakedDerivedNames = DERIVED_PROPERTY_NAMES.filter((oneName) => readProjection.includes(oneName));
	harness.equal(
		`no DERIVED property leaked into the compiler read projection (leaked: ${JSON.stringify(leakedDerivedNames)})`,
		leakedDerivedNames.length,
		0,
	);
	harness.ok(
		'the VERBATIM characteristics IS in the read projection — it is a source statement and must re-emit',
		readProjection.includes('characteristics'),
	);
	probeFacts.derivedPropertiesOutsideStatementDomain =
		leakedDerivedNames.length === 0 && readProjection.includes('characteristics');

	// ---- G-16: forge the clean fixture and check EVERY field against the answer key.
	const cleanSnapshotDirPath = stageFixtureSnapshot();
	bundle.forge({ sourcePath: cleanSnapshotDirPath, skipEmbedding: true }, (cleanForgeError, cleanForgeResult) => {
		harness.accepts('clean fixture forges for the derivation probe', [cleanForgeError].filter(Boolean));
		if (cleanForgeError) {
			next('', { ...args, fixtureBroken: true });
			return;
		}

		const fieldNodeList = cleanForgeResult.nodes.filter((oneNode) => (oneNode.labels || []).includes('SifField'));
		const derivationFaultList = [];
		let fieldsCarryingCharacteristics = 0;
		let fieldsCarryingNothing = 0;

		fieldNodeList.forEach((oneFieldNode) => {
			const fieldProperties = oneFieldNode.properties || {};
			const statedValue = fieldProperties.characteristics;

			if (statedValue === undefined) {
				// ABSENT IS ABSENT for the DERIVED pair too: an unstated cell must produce NONE of the
				// three properties. A forge that defaulted repeatable:false here would assert
				// "does not repeat" where the source said nothing at all.
				fieldsCarryingNothing++;
				DERIVED_PROPERTY_NAMES.forEach((oneName) => {
					if (fieldProperties[oneName] !== undefined) {
						derivationFaultList.push(
							`${fieldProperties.xpath}: cell is EMPTY yet ${oneName} = ${fieldProperties[oneName]} (silent default)`,
						);
					}
				});
				return;
			}

			fieldsCarryingCharacteristics++;
			const expectedDerivation = RATIFIED_DERIVATION[statedValue];
			if (!expectedDerivation) {
				derivationFaultList.push(`${fieldProperties.xpath}: carried '${statedValue}', outside the ratified vocabulary`);
				return;
			}
			DERIVED_PROPERTY_NAMES.forEach((oneName) => {
				if (fieldProperties[oneName] !== expectedDerivation[oneName]) {
					derivationFaultList.push(
						`${fieldProperties.xpath}: '${statedValue}' -> ${oneName} was ${JSON.stringify(fieldProperties[oneName])}, ratified table says ${JSON.stringify(expectedDerivation[oneName])}`,
					);
				}
			});
		});

		harness.equal(
			`every fixture field derives per the ratified table (faults: ${JSON.stringify(derivationFaultList.slice(0, 3))})`,
			derivationFaultList.length,
			0,
		);
		// both sides of the census NAMED (doctrine A8), and they must sum to the field count.
		harness.equal('fixture fields CARRYING a characteristics value', fieldsCarryingCharacteristics, 11);
		harness.equal('fixture fields carrying NONE of the three (the empty cell)', fieldsCarryingNothing, 1);
		harness.equal(
			'carrying + not-carrying sums to the fixture field count',
			fieldsCarryingCharacteristics + fieldsCarryingNothing,
			fieldNodeList.length,
		);
		probeFacts.characteristicsDerivationExact =
			derivationFaultList.length === 0 &&
			fieldsCarryingCharacteristics === 11 &&
			fieldsCarryingNothing === 1;

		// ---- G-15: poison ONE Characteristics cell with a value outside the closed vocabulary and
		// observe the REAL forge refuse BY NAME. 'CR' is used deliberately: README_ERRATA.md S-1
		// records it as real in the published XSD and absent from this export, so it is exactly the
		// value a future snapshot might introduce — and the ruling (R6-a) is that it must refuse and
		// force a human rather than be silently pre-admitted.
		const poisonedSnapshotDirPath = stageFixtureSnapshot({
			transformMainTsvText: (tsvText) => {
				const lineList = tsvText.split('\n');
				const cellList = lineList[2].split('\t');
				cellList[2] = 'CR';
				lineList[2] = cellList.join('\t');
				return lineList.join('\n');
			},
		});
		bundle.forge({ sourcePath: poisonedSnapshotDirPath, skipEmbedding: true }, (poisonedForgeError) => {
			const refusalText = String((poisonedForgeError && (poisonedForgeError.message || poisonedForgeError)) || '');
			// the refusal must name the OFFENDING VALUE and the CLOSED VOCABULARY. Requiring both is
			// what stops a checksum or parse refusal from being mistaken for this one.
			const namesTheValue = /'CR'/.test(refusalText);
			const namesTheVocabulary = /O\/M\/MR\/OR\/C/.test(refusalText);
			harness.ok(
				'an out-of-vocabulary Characteristics value REFUSES the forge (no silent default)',
				Boolean(poisonedForgeError),
				refusalText || '(the forge accepted it — a value SIF never defined was silently carried)',
			);
			harness.ok('the refusal NAMES the offending value', namesTheValue, refusalText);
			harness.ok('the refusal NAMES the closed vocabulary', namesTheVocabulary, refusalText);
			probeFacts.characteristicsRefusalNamed =
				Boolean(poisonedForgeError) && namesTheValue && namesTheVocabulary;

			fs.writeFileSync(
				path.join(ARTIFACT_DIR, 'p4CharacteristicsProbes.json'),
				JSON.stringify(
					{
						readProjection,
						leakedDerivedNames,
						fieldsCarryingCharacteristics,
						fieldsCarryingNothing,
						fixtureFieldCount: fieldNodeList.length,
						derivationFaultList,
						refusalText,
					},
					null,
					1,
				),
			);
			next('', args);
		});
	});
});

// SECTION 6c — PHASE P5 (embedText-091426, R-ET-5 / R-ET-20): a TEXT NODE is excluded from the round
// trip. The text node and its EMBEDS_TEXT_OF edge are appended to the fixture's REAL forgeSif output,
// the same { nodes, edges } buildSifGraphFromForgeOutput selects from, so they enter the double
// exactly as the forge's own output does. That selection is BY LABEL (roundTripGraphDouble.js:60-86)
// and keeps only HAS_PROPERTY pairs between selected objects and fields (:88-98).
//
// RED TWIN admitEmbedTextLabel: the text node's label test — `labels.includes('SifField')` (:80) — is
// widened IN THIS PROCESS, on that one node's label list, to answer SifField too; the production
// double is not edited. MEASURED 2026-09-14: on SIF the admitted field is NOT counted as invention —
// the validator REFUSES the emission ('carries no xpath') and issues no verdict. The kit mints a text
// node without an xpath (R-ET-2), so inventedTotal > 0 is unobservable here without fabricating one.
// The RED is therefore the named refusal OR an invention, never a silent pass, recorded verbatim.
//
// WHAT THIS PROVES: THE DIFF. It does NOT prove the production Cypher allowlist
// (roundTripSifCompiler.js:81, :226); only P9's live run does.
const SIF_EMBED_TEXT_FIXTURE_PATH = path.join(__dirname, 'fixtures', 'embedTextNode.json');
const SIF_EMBED_TEXT_ROLE = 'DmeEmbedText';

const admitEmbedTextLabel = (textNode) => {
	const widenedLabelList = textNode.labels.slice();
	widenedLabelList.includes = (oneLabel) =>
		Array.prototype.includes.call(widenedLabelList, oneLabel) || oneLabel === 'SifField';
	return { ...textNode, labels: widenedLabelList };
};

// measureSifEmbedTextRun — one validation over the double; the emitted statement set is the file the
// validator itself writes (roundTripValidator.js:281-291), compared as bytes.
const measureSifEmbedTextRun = ({ nodes, edges, snapshotDirPath, runLabel }, callback) => {
	const sifGraph = doubleLib.buildSifGraphFromForgeOutput({ nodes, edges });
	const outputPath = makeTempDir(`embedText-${runLabel}`);
	validatorLib.validateWithReader(
		{
			reader: doubleLib.makeGraphDoubleReader({ sifGraph }),
			snapshotPath: snapshotDirPath,
			outputPath,
			graphIdentity: { containerName: `graphDouble:embedText-${runLabel}`, boltUrl: 'none (reader double)' },
		},
		(validateError, verdict) => {
			if (validateError) {
				callback(validateError, { sifGraph });
				return;
			}
			const emittedFilePath = path.join(outputPath, 'emitted', 'sifStatements.emitted.txt');
			if (!fs.existsSync(emittedFilePath)) {
				callback(`measureSifEmbedTextRun: the validator wrote no ${emittedFilePath}`, { sifGraph });
				return;
			}
			const emittedBytes = fs.readFileSync(emittedFilePath);
			callback('', {
				verdict,
				sifGraph,
				emittedBytes,
				statementCount: emittedBytes.toString('utf-8').split('\n').filter((oneLine) => oneLine !== '').length,
				statementSetSha256: crypto.createHash('sha256').update(emittedBytes).digest('hex'),
			});
		},
	);
};

// embedTextExcludedFromEmission — gate G-18's conjunct; a run that issued no verdict cannot satisfy it.
const sifEmbedTextExcludedFromEmission = ({ candidateRun, baselineRun }) =>
	Boolean(candidateRun && candidateRun.verdict) &&
	candidateRun.verdict.inventedTotal === 0 &&
	candidateRun.verdict.lostTotal === baselineRun.verdict.lostTotal &&
	candidateRun.emittedBytes.equals(baselineRun.emittedBytes);

// checkSifEmbedTextFixture — identity RE-DERIVED from the text and the REAL forge's root; refused by name.
const checkSifEmbedTextFixture = ({ embedTextFixture, forgeResult }) => {
	const { textNode, embedsTextOfEdge } = embedTextFixture || {};
	if (!textNode || !embedsTextOfEdge) {
		return [`${SIF_EMBED_TEXT_FIXTURE_PATH}: textNode and embedsTextOfEdge are REQUIRED`];
	}
	const rootNode = forgeResult.nodes.find((oneNode) => (oneNode.labels || []).includes('SifRoot'));
	const rootStableId = rootNode ? rootNode.stableId : '(no SifRoot in the forge result)';
	const textProperties = textNode.properties || {};
	const textSha256 = crypto.createHash('sha256').update(String(textProperties.text)).digest('hex');
	const expectedStableId = `${rootStableId}/embedText/${textSha256}`;
	const propertyNameList = (embedsTextOfEdge.properties || {}).propertyNameList || [];
	return [
		[textNode.role === SIF_EMBED_TEXT_ROLE, `role is '${textNode.role}'`],
		[
			['ForgedNode', 'SifEmbedText', SIF_EMBED_TEXT_ROLE].every((oneLabel) => (textNode.labels || []).includes(oneLabel)),
			`labels ${JSON.stringify(textNode.labels)} lack the [ForgedNode, SifEmbedText, DmeEmbedText] triple`,
		],
		[textNode.stableId === expectedStableId, `stableId '${textNode.stableId}' is not '${expectedStableId}'`],
		[textProperties._id === expectedStableId, '_id is not the stableId'],
		[textProperties.sifStableId === expectedStableId, 'sifStableId is not the stableId'],
		[textProperties.parentId === rootStableId, `parentId '${textProperties.parentId}' is not the forge root '${rootStableId}'`],
		[textProperties._source === rootNode.properties._source, `_source '${textProperties._source}' is not the forge's`],
		[textProperties.path === `embedText/${textSha256}`, 'path is not embedText/<sha256(text)>'],
		[textProperties.name === undefined, 'a text node carries no name'],
		[textProperties.searchText === undefined, 'a text node carries no searchText'],
		[embedsTextOfEdge.type === 'EMBEDS_TEXT_OF', `edge type is '${embedsTextOfEdge.type}'`],
		[embedsTextOfEdge.fromRef.id === expectedStableId, 'the edge does not leave the text node'],
		[
			forgeResult.nodes.some((oneNode) => oneNode.stableId === embedsTextOfEdge.toRef.id),
			`the edge's target '${embedsTextOfEdge.toRef.id}' is not in the forge result`,
		],
		[
			propertyNameList.length > 0 && JSON.stringify(propertyNameList) === JSON.stringify(propertyNameList.slice().sort()),
			`propertyNameList ${JSON.stringify(propertyNameList)} is not a non-empty sorted list`,
		],
	]
		.filter(([holds]) => !holds)
		.map(([, complaint]) => `${SIF_EMBED_TEXT_FIXTURE_PATH}: ${complaint}`);
};

taskList.push((args, next) => {
	if (args.fixtureBroken) {
		harness.ok('embed-text proof reachable', false, 'fixture broke upstream — the text-node proof is unmeasurable');
		next('', args);
		return;
	}
	harness.section(
		"SECTION 6c — PHASE P5: a TEXT NODE and its EMBEDS_TEXT_OF edge are excluded from the round trip (proves the DIFF; the production allowlist is P9's)",
	);
	if (!fs.existsSync(SIF_EMBED_TEXT_FIXTURE_PATH)) {
		harness.ok('the embed-text fixture exists', false, `${SIF_EMBED_TEXT_FIXTURE_PATH} is REQUIRED`);
		next('', args);
		return;
	}
	const { forgeResult, snapshotDirPath } = args;
	const embedTextFixture = JSON.parse(fs.readFileSync(SIF_EMBED_TEXT_FIXTURE_PATH, 'utf-8'));
	const fixtureComplaintList = checkSifEmbedTextFixture({ embedTextFixture, forgeResult });
	harness.equal('the text node and edge have the R-ET-1/R-ET-4 shape (identity re-derived)', fixtureComplaintList.length, 0);
	if (fixtureComplaintList.length) {
		harness.note(fixtureComplaintList.join('\n'));
		next('', args);
		return;
	}
	const { textNode, embedsTextOfEdge } = embedTextFixture;
	const edgesWithText = forgeResult.edges.concat([embedsTextOfEdge]);

	measureSifEmbedTextRun(
		{ nodes: forgeResult.nodes, edges: forgeResult.edges, snapshotDirPath, runLabel: 'baseline' },
		(baselineError, baselineRun) => {
			harness.accepts('the run WITHOUT the text node measures', [baselineError].filter(Boolean));
			if (baselineError) {
				next('', args);
				return;
			}
			measureSifEmbedTextRun(
				{ nodes: forgeResult.nodes.concat([textNode]), edges: edgesWithText, snapshotDirPath, runLabel: 'withText' },
				(withTextError, withTextRun) => {
					harness.accepts('the run WITH the text node measures', [withTextError].filter(Boolean));
					if (withTextError) {
						next('', args);
						return;
					}
					harness.equal('WITH the text node: inventedTotal is 0', withTextRun.verdict.inventedTotal, 0);
					harness.equal(
						`WITH the text node: lostTotal EQUALS the run without it (${baselineRun.verdict.lostTotal})`,
						withTextRun.verdict.lostTotal,
						baselineRun.verdict.lostTotal,
					);
					harness.ok(
						`the emitted statement file is byte-identical (${baselineRun.statementCount} statements, sha256 ${baselineRun.statementSetSha256})`,
						withTextRun.emittedBytes.equals(baselineRun.emittedBytes),
						`with the text node: ${withTextRun.statementCount} statements, sha256 ${withTextRun.statementSetSha256}`,
					);
					harness.equal(
						'the served sifGraph is identical with and without the text node (the label selection dropped it)',
						JSON.stringify(withTextRun.sifGraph),
						JSON.stringify(baselineRun.sifGraph),
					);
					const exclusionHolds = sifEmbedTextExcludedFromEmission({ candidateRun: withTextRun, baselineRun });
					harness.ok('gate G-18 conjunct holds over the real runs', exclusionHolds);
					probeFacts.embedTextExcludedFromEmission = exclusionHolds;

					measureSifEmbedTextRun(
						{
							nodes: forgeResult.nodes.concat([admitEmbedTextLabel(textNode)]),
							edges: edgesWithText,
							snapshotDirPath,
							runLabel: 'admitted',
						},
						(admittedError, admittedRun) => {
							harness.equal(
								'the widening reached the selection: one more field was served',
								admittedRun.sifGraph.fieldNodeList.length,
								baselineRun.sifGraph.fieldNodeList.length + 1,
							);
							const admittedOutcomeText = admittedError
								? `REFUSED BY NAME at emission, no verdict issued: ${admittedError}`
								: `inventedTotal ${admittedRun.verdict.inventedTotal}, lostTotal ${admittedRun.verdict.lostTotal}`;
							harness.ok(
								`RED TWIN admitEmbedTextLabel (data level): the admitted text node does NOT pass silently (${admittedOutcomeText})`,
								admittedError
									? /emission fault/.test(String(admittedError)) && String(admittedError).includes(textNode.stableId)
									: admittedRun.verdict.inventedTotal > 0,
							);
							harness.equal(
								'gate G-18 conjunct goes FALSE over the admitting run',
								sifEmbedTextExcludedFromEmission({ candidateRun: admittedRun, baselineRun }),
								false,
							);
							harness.note(
								`P5 evidence (SIF): baseline inventedTotal ${baselineRun.verdict.inventedTotal}, lostTotal ${baselineRun.verdict.lostTotal}, ` +
									`${baselineRun.statementCount} statements sha256 ${baselineRun.statementSetSha256}; ` +
									`with text node inventedTotal ${withTextRun.verdict.inventedTotal}, lostTotal ${withTextRun.verdict.lostTotal}, ` +
									`sha256 ${withTextRun.statementSetSha256}; admitting twin: ${admittedOutcomeText}`,
							);
							next('', args);
						},
					);
				},
			);
		},
	);
});

// SECTION 7 — the gate suite over REAL measurements; every twin observed RED; registry audited.
taskList.push((args, next) => {
	if (args.fixtureBroken) {
		harness.ok('gate suite reachable', false, 'fixture broke upstream — gates unmeasurable');
		next('', args);
		return;
	}
	harness.section('SECTION 7 — GATES: declared as data, twins observed RED, registry closed');
	gatesLib.loadGateDeclarations({ gatesFilePath: GATES_FILE_PATH }, (loadError, loaded) => {
		harness.accepts('gate declarations load', [loadError].filter(Boolean));
		if (loadError) {
			next('', args);
			return;
		}
		const { declarations } = loaded;

		const measurements = {
			report: args.cleanVerdict.report,
			verdict: {
				roundTripClean: args.cleanVerdict.roundTripClean,
				lost: args.cleanVerdict.lost,
				invented: args.cleanVerdict.invented,
			},
			probe: { ...probeFacts },
			suite: {
				// mechanical fact about the suite itself: gates whose acceptance READS a percentage
				// measure (a measure path ending in 'Percent'); G-8's own counter measure is not one.
				gatesUsingPercentInAcceptance: declarations.gates.filter((oneGate) =>
					String(oneGate.measure).endsWith('Percent'),
				).length,
			},
		};

		gatesLib.evaluateGates({ declarations, measurements }, (evalError, evaluated) => {
			harness.accepts('gate evaluation runs', [evalError].filter(Boolean));
			if (evalError) {
				next('', args);
				return;
			}
			evaluated.gateResults.forEach((oneResult) => {
				harness.ok(
					`${oneResult.id} ${oneResult.state === 'PASS' ? 'PASSES' : 'must pass'}: ${oneResult.title}`,
					oneResult.state === 'PASS',
					oneResult.detail,
				);
			});

			// EVERY twin observed RED — a gate that stays green under its twin is decoration.
			twinsLib.auditRegistryAgainst({ declarations }, (auditError, audited) => {
				harness.accepts('twin registry audit runs', [auditError].filter(Boolean));
				harness.ok(
					'every gate has an implemented twin',
					!!audited && audited.missing.length === 0,
					audited && audited.missing.join(', '),
				);
				harness.ok(
					'no orphaned twins outlive their gates',
					!!audited && audited.orphaned.length === 0,
					audited && audited.orphaned.join(', '),
				);

				const twinRedByGateId = {};
				const twinLogLines = [];
				const twinTaskList = new taskListPlus();
				declarations.gates.forEach((oneGate) => {
					twinTaskList.push((twinArgs, twinNext) => {
						const corrupted = twinsLib.twinRegistry[oneGate.twin](
							twinsLib.cloneMeasurements(measurements),
						);
						gatesLib.evaluateGates(
							{ declarations, measurements: corrupted },
							(twinEvalError, twinEvaluated) => {
								if (twinEvalError) {
									twinNext(twinEvalError);
									return;
								}
								const twinResult = twinEvaluated.gateResults.find(
									(oneResult) => oneResult.id === oneGate.id,
								);
								const wentRed = twinResult && twinResult.state !== 'PASS';
								twinRedByGateId[oneGate.id] = Boolean(wentRed);
								twinLogLines.push(
									`${oneGate.id} twin '${oneGate.twin}' -> ${twinResult ? twinResult.state : 'MISSING'}`,
								);
								harness.ok(
									`${oneGate.id} twin '${oneGate.twin}' observed RED`,
									Boolean(wentRed),
									twinResult && twinResult.state,
								);
								twinNext('', twinArgs);
							},
						);
					});
				});
				pipeRunner(twinTaskList.getList(), {}, (twinPipeError) => {
					harness.accepts('twin pass completes', [twinPipeError].filter(Boolean));
					fs.writeFileSync(
						path.join(ARTIFACT_DIR, 'sifRoundTripGateTwinObservations.log'),
						`${twinLogLines.join('\n')}\n`,
					);
					gatesLib.judgeSuite({ gateResults: evaluated.gateResults, twinRedByGateId }, (judgeError, judged) => {
						harness.accepts('suite judgment runs', [judgeError].filter(Boolean));
						harness.ok(
							'SUITE ACCEPTED — zero FAIL, zero UNMEASURED, zero UNPROVEN',
							!!judged && judged.accepted === true,
							judged &&
								`failing: ${JSON.stringify(judged.failingGateIds)} unproven: ${JSON.stringify(judged.unprovenGateIds)}`,
						);
						next('', args);
					});
				});
			});
		});
	});
});

pipeRunner(taskList.getList(), {}, (pipeError) => {
	if (pipeError) {
		harness.ok('suite pipeline completes', false, pipeError);
	}
	harness.report();
});
