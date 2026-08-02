#!/usr/bin/env node
'use strict';

// test-cedsRoundTrip.js — the STANDING gate for the CEDS round-trip instrument (the compiler, the
// canonicalizer and the diff).
//
// NOTHING HERE TOUCHES DOCKER, THE NETWORK, A GRAPH, VOYAGE OR AN LLM. The graph is a hand-built
// in-memory DOUBLE satisfying the same one-method reader contract the real Neo4j reader satisfies
// (readAll(callback)), and `docker inspect` is a stubbed command that returns a canned record. The
// 19MB real ontology is never opened.
//
// THE CENTRAL ASSERTION IS THE ZERO-LOSS GATE. A complete fixture — one whose every statement the
// compiler can re-emit from a graph carrying the corresponding property — must round-trip with
// ZERO lost statements and ZERO invented statements. That is what proves the instrument is capable
// of reporting SUCCESS. A diff that can never come back clean is not enforcement, it is decoration,
// and the enormous honest loss figure the real run produces would be indistinguishable from a
// broken measuring stick.
//
// The three other gates are the ones that prove it can report FAILURE, and prove WHAT it will not
// call a failure:
//   - drop one statement from the graph double -> EXACTLY that statement is reported lost.
//   - add one statement the source never made  -> EXACTLY that statement is reported INVENTED.
//   - respell a document (prefixes, order, indentation, wrapped literals) -> NO difference at all.
//
// Run: node forges/ceds/test/test-cedsRoundTrip.js [-verbose]

const fs = require('fs');
const os = require('os');
const path = require('path');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- standing gate for the CEDS round-trip fidelity instrument

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Drives the round-trip compiler over a hand-built in-memory graph double and diffs the emission
     against a hand-built fixture RDF. Proves the zero-loss / zero-invention gate on a COMPLETE
     fixture, exact attribution of a deliberately dropped statement, exact attribution of a
     deliberately invented one, and that canonicalization ignores whitespace, element order,
     attribute order and namespace-prefix choice. Hermetic: no docker, no network, no graph.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const canonicalLib = require('../lib/roundTripCanonical')();
const compilerLib = require('../lib/roundTripCompiler')();
const diffLib = require('../lib/roundTripDiff')();

const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const CEDS = 'https://w3id.org/CEDStandards/terms/';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';

// =====================================================================
// THE GRAPH DOUBLE — hand-built rows in exactly the shape the Neo4j reader returns
// =====================================================================
// Every row carries the property NAMES the real reader projects (READ_PROPERTY_NAMES in
// roundTripCompiler.js), so the double and the production reader hand assembleCedsGraph the same
// thing. crossRefs is the JSON string the CEDS forge stamps — and it is the ONLY place the RAW
// source dc:identifier survives (the forge normalizes an option set's 'C900003' into 'OS900003'),
// which is why the compiler reads the anchor from there and not from cedsId.

const crossRefsFor = ({ canonicalId, rawAnchor }) =>
	JSON.stringify([
		{ system: 'ceds', id: canonicalId, raw: rawAnchor, locator: 'dc:identifier' },
	]);

const nodeRow = ({ uri, role, canonicalId, rawAnchor, ...rest }) => ({
	stableId: uri,
	uri,
	role,
	cedsId: canonicalId,
	crossRefs: crossRefsFor({ canonicalId, rawAnchor }),
	...rest,
});

const buildGraphRows = () => ({
	rootNodes: [
		{
			stableId: CEDS,
			uri: CEDS,
			role: 'DmeStandardRoot',
			version: '99.0.0.0',
			name: 'CEDS',
			description: 'the fixture ontology',
		},
	],
	classNodes: [
		nodeRow({
			uri: `${CEDS}C900000`,
			role: 'DmeClass',
			canonicalId: 'C900000',
			rawAnchor: 'C900000',
			name: 'Fixture Base Resource',
			creator: 'Common Education Data Standards',
			comment: 'The root of the fixture class tree.',
			description: 'The base resource of the round-trip fixture.',
			definition: 'The base resource of the round-trip fixture.',
			notation: 'FixtureBaseResource',
			prefLabel: 'Fixture Base Resource',
		}),
		nodeRow({
			uri: `${CEDS}C900001`,
			role: 'DmeClass',
			canonicalId: 'C900001',
			rawAnchor: 'C900001',
			name: 'Fixture Learner',
			creator: 'Common Education Data Standards',
			description: 'A person enrolled in the fixture.',
			definition: 'A person enrolled in the fixture.',
			notation: 'FixtureLearner',
			prefLabel: 'Fixture Learner',
			editHistory: JSON.stringify([
				{
					changeDescription: 'Class introduced for the round-trip fixture.',
					changeVersion: '1',
					changeNew: 'true',
				},
			]),
		}),
		nodeRow({
			uri: `${CEDS}C900002`,
			role: 'DmeClass',
			canonicalId: 'C900002',
			rawAnchor: 'C900002',
			name: 'Fixture Enrollment',
			creator: 'Common Education Data Standards',
			description: 'An enrollment of a fixture learner.',
			definition: 'An enrollment of a fixture learner.',
			notation: 'FixtureEnrollment',
			prefLabel: 'Fixture Enrollment',
		}),
	],
	propertyNodes: [
		nodeRow({
			uri: `${CEDS}P900001`,
			role: 'DmeProperty',
			canonicalId: 'P900001',
			rawAnchor: 'P900001',
			name: 'Fixture Learner Name',
			creator: 'Common Education Data Standards',
			description: 'The name by which the fixture learner is known.',
			definition: 'The name by which the fixture learner is known.',
			notation: 'FixtureLearnerName',
			prefLabel: 'Fixture Learner Name',
			allDomainIds: ['C900001', 'C900002'],
			domainId: 'C900001',
			dataType: 'string',
			textFormat: 'Alphanumeric',
			maxLength: '75',
			minLength: '1',
			issueLink: 'https://example.invalid/issues/900001',
			editHistory: JSON.stringify([
				{
					changeDescription: 'Maximum length raised from 60 to 75.',
					changeVersion: '2',
					changeUpdated: 'true',
				},
				{
					changeDescription: 'Property added to Fixture Enrollment.',
					changeVersion: '3',
					changePropertyAddedToClass: 'true',
				},
			]),
		}),
		nodeRow({
			uri: `${CEDS}P900002`,
			role: 'DmeProperty',
			canonicalId: 'P900002',
			rawAnchor: 'P900002',
			name: 'Fixture Enrollment Status',
			creator: 'Common Education Data Standards',
			description: 'The status of the fixture enrollment.',
			definition: 'The status of the fixture enrollment.',
			notation: 'FixtureEnrollmentStatus',
			prefLabel: 'Fixture Enrollment Status',
			allDomainIds: ['C900002'],
			domainId: 'C900002',
			deprecated: 'true',
		}),
		nodeRow({
			uri: `${CEDS}P900003`,
			role: 'DmeProperty',
			canonicalId: 'P900003',
			rawAnchor: 'P900003',
			name: 'Fixture Enrollment Count',
			creator: 'Common Education Data Standards',
			description: 'How many enrollments the fixture learner holds.',
			definition: 'How many enrollments the fixture learner holds.',
			notation: 'FixtureEnrollmentCount',
			prefLabel: 'Fixture Enrollment Count',
			allDomainIds: ['C900001'],
			domainId: 'C900001',
			dataType: 'integer',
			minInclusive: '0',
			maxInclusive: '99',
			decimalPlaces: '0',
			minCount: '0',
			maxCount: '1',
		}),
	],
	optionSetNodes: [
		nodeRow({
			uri: `${CEDS}C900003`,
			role: 'DmeOptionSet',
			canonicalId: 'OS900003',
			rawAnchor: 'C900003',
			name: 'Fixture Enrollment Status',
			creator: 'Common Education Data Standards',
			description: 'An indicator of the status of a fixture enrollment.',
			definition: 'An indicator of the status of a fixture enrollment.',
			notation: 'FixtureEnrollmentStatus',
			prefLabel: 'Fixture Enrollment Status',
		}),
	],
	optionValueNodes: [
		nodeRow({
			uri: `${CEDS}NI900003000001`,
			role: 'DmeOptionValue',
			canonicalId: 'OV900003000001',
			rawAnchor: 'NI900003000001',
			name: 'Active',
			creator: 'Common Education Data Standards',
			description: 'The fixture learner is actively enrolled.',
			definition: 'The fixture learner is actively enrolled.',
			notation: '01',
			prefLabel: 'Active',
		}),
		nodeRow({
			uri: `${CEDS}NI900003000002`,
			role: 'DmeOptionValue',
			canonicalId: 'OV900003000002',
			rawAnchor: 'NI900003000002',
			name: 'Withdrawn',
			creator: 'Common Education Data Standards',
			description: 'The fixture learner has withdrawn.',
			definition: 'The fixture learner has withdrawn.',
			notation: '02',
			prefLabel: 'Withdrawn',
			deprecated: 'false',
		}),
	],
	subClassOfPairs: [
		{ from: `${CEDS}C900001`, to: `${CEDS}C900000` },
		{ from: `${CEDS}C900002`, to: `${CEDS}C900000` },
		{ from: `${CEDS}C900003`, to: `${CEDS}C900000` },
	],
	rangePairs: [{ from: `${CEDS}P900002`, to: `${CEDS}C900003` }],
	inSchemePairs: [
		{ from: `${CEDS}NI900003000001`, to: `${CEDS}C900003` },
		{ from: `${CEDS}NI900003000002`, to: `${CEDS}C900003` },
	],
});

// makeGraphDouble — the READER DOUBLE. Same one-method contract as makeNeo4jCedsReader's product,
// so compileToFile and the serializer cannot tell it from the real thing. `adjustRows` is where a
// test deliberately damages the graph.
const makeGraphDouble = (adjustRows) => ({
	readAll: (callback) => {
		const rows = buildGraphRows();
		if (adjustRows) {
			adjustRows(rows);
		}
		compilerLib.assembleCedsGraph(rows, callback);
	},
	close: (callback) => callback(''),
});

// emitToString — run the compiler's serializer over a double and hand back the RDF/XML text.
const emitToString = (adjustRows, callback) => {
	makeGraphDouble(adjustRows).readAll((readError, read) => {
		if (readError) {
			callback(readError);
			return;
		}
		const chunks = [];
		compilerLib.serializeCedsRdf(
			{ cedsGraph: read.cedsGraph, writeChunk: (text) => chunks.push(text) },
			(serializeError, serialized) => {
				if (serializeError) {
					callback(serializeError);
					return;
				}
				callback('', { rdfText: chunks.join(''), counts: serialized.counts });
			},
		);
	});
};

// roundTripReport — the whole instrument end to end against the complete fixture.
const roundTripReport = (adjustRows, callback) => {
	emitToString(adjustRows, (emitError, emitted) => {
		if (emitError) {
			callback(emitError);
			return;
		}
		canonicalLib.canonicalizeRdfFile(
			{ filePath: path.join(FIXTURE_DIR, 'roundTripFixture.rdf') },
			(sourceError, sourceResult) => {
				if (sourceError) {
					callback(sourceError);
					return;
				}
				canonicalLib.canonicalizeRdfText(
					{ rdfText: emitted.rdfText, sourceLabel: 'emitted' },
					(emittedError, emittedResult) => {
						if (emittedError) {
							callback(emittedError);
							return;
						}
						diffLib.diffStatements(
							{
								sourceStatements: sourceResult.statements,
								emittedStatements: emittedResult.statements,
								sourceStats: sourceResult.stats,
								emittedStats: emittedResult.stats,
								context: { fixture: 'roundTripFixture.rdf' },
							},
							(diffError, diffed) => {
								if (diffError) {
									callback(diffError);
									return;
								}
								callback('', {
									report: diffed.report,
									rdfText: emitted.rdfText,
									sourceStatements: sourceResult.statements,
									emittedStatements: emittedResult.statements,
								});
							},
						);
					},
				);
			},
		);
	});
};

// lostList / inventedList — the concrete statements behind a count, for exact attribution.
const lostList = (report) =>
	report.perPredicate.reduce((soFar, oneRow) => soFar.concat(oneRow.lostSamples), []);
const inventedList = (report) =>
	report.perPredicate.reduce((soFar, oneRow) => soFar.concat(oneRow.inventedSamples), []);

// =====================================================================
// THE SUITE
// =====================================================================

const runCanonicalizationSection = (done) => {
	harness.section('CANONICALIZATION — whitespace, order, attribute order and prefix are NOT statements');

	canonicalLib.canonicalizeRdfFile(
		{ filePath: path.join(FIXTURE_DIR, 'roundTripSpellingA.rdf') },
		(errorA, resultA) => {
			harness.accepts('spelling A canonicalizes without error', errorA ? [errorA] : []);
			canonicalLib.canonicalizeRdfFile(
				{ filePath: path.join(FIXTURE_DIR, 'roundTripSpellingB.rdf') },
				(errorB, resultB) => {
					harness.accepts('spelling B canonicalizes without error', errorB ? [errorB] : []);

					const keysA = Array.from(resultA.statements.keys()).sort();
					const keysB = Array.from(resultB.statements.keys()).sort();
					harness.ok(
						'A and B carry the same NUMBER of statements',
						keysA.length === keysB.length,
						`A=${keysA.length} B=${keysB.length}`,
					);
					const onlyInA = keysA.filter((oneKey) => !resultB.statements.has(oneKey));
					const onlyInB = keysB.filter((oneKey) => !resultA.statements.has(oneKey));
					harness.ok(
						'every statement in A is in B — prefix rebinding, element reordering and reindenting change nothing',
						onlyInA.length === 0,
						`only in A:\n- ${onlyInA.join('\n- ')}`,
					);
					harness.ok(
						'every statement in B is in A',
						onlyInB.length === 0,
						`only in B:\n- ${onlyInB.join('\n- ')}`,
					);
					harness.ok(
						'a literal wrapped across lines normalizes to the same literal',
						Array.from(resultB.statements.values()).some(
							(one) => one.object === 'Class introduced for the round-trip fixture.',
						),
						'the wrapped changeDescription in B did not normalize',
					);
					harness.ok(
						'a padded literal normalizes to its trimmed form',
						Array.from(resultB.statements.values()).some((one) => one.object === 'Alphanumeric'),
						'"   Alphanumeric   " in B did not normalize',
					);
					harness.ok(
						'the nested editHistory block yields statements in BOTH spellings',
						keysA.some((oneKey) => oneKey.includes('editHistoryEntry')) &&
							keysB.some((oneKey) => oneKey.includes('editHistoryEntry')),
						'no editHistoryEntry statement was produced',
					);

					canonicalLib.canonicalizeRdfText({ rdfText: '' }, (blankError) => {
						harness.rejects(
							'a blank document is refused BY NAME, not measured as an empty one',
							[blankError],
							/rdfText is REQUIRED/,
						);
						canonicalLib.canonicalizeRdfText(
							{ rdfText: '<other><thing/></other>' },
							(shapeError) => {
								harness.rejects(
									'a document with no rdf:RDF root is refused BY NAME',
									[shapeError],
									/no rdf:RDF root element/,
								);
								done();
							},
						);
					});
				},
			);
		},
	);
};

const runZeroLossSection = (done) => {
	harness.section(
		'THE ZERO-LOSS GATE — a COMPLETE fixture round-trips with zero loss and zero invention',
	);

	roundTripReport(null, (error, result) => {
		harness.accepts('the complete round-trip runs without error', error ? [error] : []);
		if (error) {
			done();
			return;
		}
		const { report } = result;

		harness.ok(
			'the fixture is substantial enough to mean something',
			report.headline.sourceStatements >= 100,
			`only ${report.headline.sourceStatements} source statements`,
		);
		harness.equal('LOST is zero', report.headline.lost, 0);
		harness.equal('INVENTED is zero', report.headline.invented, 0);
		harness.equal(
			'MATCHED equals the whole source',
			report.headline.matched,
			report.headline.sourceStatements,
		);
		harness.equal('fidelity reads 100%', report.headline.fidelityPercent, 100);

		// the corners the fixture exists to cover — proven present, so a future fixture edit that
		// quietly drops one of them cannot leave the gate looking just as green.
		const sourcePredicates = new Set(
			Array.from(result.sourceStatements.values()).map((one) => one.predicate),
		);
		[
			`${RDFS}subClassOf`,
			'https://schema.org/domainIncludes',
			'https://schema.org/rangeIncludes',
			`${CEDS}editHistory`,
			`${CEDS}changeDescription`,
			`${CEDS}maxLength`,
			'http://www.w3.org/2002/07/owl#deprecated',
			`${SKOS}inScheme`,
			`${SKOS}prefLabel`,
			'http://purl.org/dc/elements/1.1/creator',
		].forEach((onePredicate) => {
			harness.ok(
				`the fixture actually exercises ${onePredicate}`,
				sourcePredicates.has(onePredicate),
				'predicate absent from the fixture',
			);
		});

		harness.ok(
			'a property with TWO schema:domainIncludes round-trips both',
			Array.from(result.emittedStatements.values()).filter(
				(one) =>
					one.subject === `${CEDS}P900001` && one.predicate === 'https://schema.org/domainIncludes',
			).length === 2,
			'the multi-domain property did not re-emit both domains',
		);
		harness.ok(
			'the RAW source dc:identifier is recovered for an option set whose canonical id was rewritten',
			Array.from(result.emittedStatements.values()).some(
				(one) =>
					one.subject === `${CEDS}C900003` &&
					one.predicate === 'http://purl.org/dc/elements/1.1/identifier' &&
					one.object === 'C900003',
			),
			"the option set's dc:identifier did not come back as its SOURCE anchor 'C900003'",
		);

		diffLib.renderReportText({ report }, (renderError, rendered) => {
			harness.accepts('the report renders', renderError ? [renderError] : []);
			harness.match(
				'a clean report says so about invention, in words',
				rendered.reportText,
				/INVENTED STATEMENTS[\s\S]*NONE\./,
			);
			harness.match(
				'the report carries the per-predicate loss table',
				rendered.reportText,
				/PER-PREDICATE LOSS/,
			);
			harness.match(
				'the report carries the per-entity-kind breakdown',
				rendered.reportText,
				/PER-ENTITY-KIND/,
			);
			done();
		});
	});
};

const runDroppedStatementSection = (done) => {
	harness.section('A DELIBERATELY DROPPED STATEMENT — reported as exactly that statement, lost');

	roundTripReport(
		(rows) => {
			// the graph forgets one thing and one thing only: the notation of Fixture Learner.
			delete rows.classNodes[1].notation;
		},
		(error, result) => {
			harness.accepts('the damaged round-trip still runs', error ? [error] : []);
			if (error) {
				done();
				return;
			}
			const { report } = result;
			harness.equal('exactly ONE statement is reported lost', report.headline.lost, 1);
			harness.equal('nothing is invented by the omission', report.headline.invented, 0);

			const lost = lostList(report);
			harness.equal('the lost statement is attributed to the right subject', lost.length && lost[0].subject, `${CEDS}C900001`);
			harness.equal(
				'the lost statement is attributed to the right predicate',
				lost.length && lost[0].predicate,
				`${SKOS}notation`,
			);
			harness.equal(
				'the lost statement carries its object, so a human can see what a loss looks like',
				lost.length && lost[0].object,
				'FixtureLearner',
			);

			const notationRow = report.perPredicate.find(
				(oneRow) => oneRow.predicate === `${SKOS}notation`,
			);
			harness.equal('the per-predicate table charges the loss to skos:notation', notationRow.lost, 1);
			harness.ok(
				'the per-entity-kind table charges the loss to class',
				report.perEntityKind.find((oneRow) => oneRow.kind === 'class').lost === 1,
				JSON.stringify(report.perEntityKind),
			);
			done();
		},
	);
};

const runInventedStatementSection = (done) => {
	harness.section('A DELIBERATELY INVENTED STATEMENT — reported separately, and as invention');

	roundTripReport(
		(rows) => {
			// the graph asserts something about CEDS that CEDS never said.
			rows.optionValueNodes[0].comment = 'A comment the source never made.';
		},
		(error, result) => {
			harness.accepts('the round-trip with an invention still runs', error ? [error] : []);
			if (error) {
				done();
				return;
			}
			const { report } = result;
			harness.equal('nothing is lost by the addition', report.headline.lost, 0);
			harness.equal('exactly ONE statement is reported invented', report.headline.invented, 1);
			harness.equal(
				'the invented total is reported in its own section too',
				report.invented.total,
				1,
			);

			const invented = inventedList(report);
			harness.equal(
				'the invented statement names its subject',
				invented.length && invented[0].subject,
				`${CEDS}NI900003000001`,
			);
			harness.equal(
				'the invented statement names its predicate',
				invented.length && invented[0].predicate,
				`${RDFS}comment`,
			);
			harness.equal(
				'the invented section lists the offending predicate',
				report.invented.perPredicate.length && report.invented.perPredicate[0].predicate,
				`${RDFS}comment`,
			);

			diffLib.renderReportText({ report }, (renderError, rendered) => {
				harness.accepts('the report renders with an invention present', renderError ? [renderError] : []);
				harness.match(
					'the rendered report says invention is worse than loss, prominently',
					rendered.reportText,
					/Invention is worse than loss/,
				);
				harness.match(
					'the rendered report names the invented statement',
					rendered.reportText,
					/NI900003000001/,
				);
				done();
			});
		},
	);
};

const runCompileToFileSection = (done) => {
	harness.section('compileToFile — the same emission, written through the real file path');

	const outPath = path.join(
		fs.mkdtempSync(path.join(os.tmpdir(), 'cedsRoundTrip-')),
		'emitted.rdf',
	);
	compilerLib.compileToFile({ reader: makeGraphDouble(), outPath }, (compileError, compiled) => {
		harness.accepts('compileToFile succeeds against the reader double', compileError ? [compileError] : []);
		if (compileError) {
			done();
			return;
		}
		harness.ok('the emitted file exists', fs.existsSync(outPath), outPath);
		harness.equal('every fixture class was written', compiled.counts.class, 3);
		harness.equal('every fixture property was written', compiled.counts.property, 3);
		harness.equal('the option set was written', compiled.counts.optionSet, 1);
		harness.equal('both option values were written', compiled.counts.optionValue, 2);

		diffLib.compareRdfFiles(
			{
				sourcePath: path.join(FIXTURE_DIR, 'roundTripFixture.rdf'),
				emittedPath: outPath,
				context: { via: 'compileToFile' },
			},
			(compareError, compared) => {
				harness.accepts('compareRdfFiles runs over the two files', compareError ? [compareError] : []);
				harness.equal('the on-disk emission is also zero-loss', compared.report.headline.lost, 0);
				harness.equal(
					'the on-disk emission is also zero-invention',
					compared.report.headline.invented,
					0,
				);
				fs.rmSync(path.dirname(outPath), { recursive: true, force: true });
				done();
			},
		);
	});
};

const runRefusalSection = (done) => {
	harness.section('REFUSALS — every required value is refused BY NAME, never guessed at');

	compilerLib.serializeCedsRdf({ cedsGraph: {} }, (noSinkError) => {
		harness.rejects(
			'a serializer with nowhere to write is refused',
			[noSinkError],
			/writeChunk is REQUIRED/,
		);

		const noUri = compilerLib.entityText({ kind: 'class', entity: { name: 'nameless' } });
		harness.match(
			'an entity with no uri is refused — the uri IS the subject',
			noUri.error,
			/carries no uri/,
		);

		const tooMany = compilerLib.entityText({
			kind: 'optionValue',
			entity: { uri: `${CEDS}NI1`, inScheme: [`${CEDS}C1`, `${CEDS}C2`] },
		});
		harness.match(
			'a single-valued field carrying two values is refused rather than silently truncated',
			tooMany.error,
			/declares it single-valued/,
		);

		compilerLib.compileToFile({ reader: {}, outPath: '/tmp/never.rdf' }, (readerError) => {
			harness.rejects(
				'a reader with no readAll is refused',
				[readerError],
				/must expose readAll/,
			);
			compilerLib.compileToFile({ reader: makeGraphDouble() }, (outPathError) => {
				harness.rejects(
					'a compile that does not say where it writes is refused',
					[outPathError],
					/outPath is REQUIRED/,
				);
				diffLib.diffStatements({ sourceStatements: {}, emittedStatements: new Map() }, (mapError) => {
					harness.rejects(
						'the diff refuses anything but the canonicalizer Maps',
						[mapError],
						/sourceStatements is REQUIRED/,
					);
					done();
				});
			});
		});
	});
};

const runContainerResolutionSection = (done) => {
	harness.section('resolveContainerBolt — the bolt endpoint and credential are READ, never assumed');

	const dockerDouble = (record) => (dockerArgs, callback) => {
		if (dockerArgs[0] !== 'inspect') {
			callback(new Error(`unexpected docker args ${dockerArgs.join(' ')}`));
			return;
		}
		callback(null, JSON.stringify([record]), '');
	};
	const goodRecord = {
		NetworkSettings: { Ports: { '7687/tcp': [{ HostIp: '0.0.0.0', HostPort: '7811' }] } },
		Config: { Env: ['NEO4J_AUTH=neo4j/secretPassword', 'OTHER=1'] },
	};

	compilerLib.resolveContainerBolt(
		{ containerName: 'DEV_fixture', runDockerCommand: dockerDouble(goodRecord) },
		(resolveError, resolved) => {
			harness.accepts('a healthy container resolves', resolveError ? [resolveError] : []);
			harness.equal('the bolt url comes from the published host port', resolved.boltUrl, 'bolt://localhost:7811');
			harness.equal('the user comes from NEO4J_AUTH', resolved.user, 'neo4j');
			harness.equal('the password comes from NEO4J_AUTH', resolved.password, 'secretPassword');

			compilerLib.resolveContainerBolt(
				{
					containerName: 'DEV_noPort',
					runDockerCommand: dockerDouble({ NetworkSettings: { Ports: {} }, Config: { Env: [] } }),
				},
				(noPortError) => {
					harness.rejects(
						'a container publishing no bolt port is refused BY NAME',
						[noPortError],
						/publishes no host port for 7687/,
					);
					compilerLib.resolveContainerBolt(
						{
							containerName: 'DEV_noAuth',
							runDockerCommand: dockerDouble({
								NetworkSettings: { Ports: { '7687/tcp': [{ HostPort: '7999' }] } },
								Config: { Env: ['SOMETHING=else'] },
							}),
						},
						(noAuthError) => {
							harness.rejects(
								'a container declaring no NEO4J_AUTH is refused BY NAME',
								[noAuthError],
								/declares no NEO4J_AUTH/,
							);
							compilerLib.resolveContainerBolt({}, (noNameError) => {
								harness.rejects(
									'a resolution with no container name is refused',
									[noNameError],
									/containerName is REQUIRED/,
								);
								done();
							});
						},
					);
				},
			);
		},
	);
};

// serial, because the harness tallies into one report
runCanonicalizationSection(() => {
	runZeroLossSection(() => {
		runDroppedStatementSection(() => {
			runInventedStatementSection(() => {
				runCompileToFileSection(() => {
					runRefusalSection(() => {
						runContainerResolutionSection(() => {
							harness.report();
						});
					});
				});
			});
		});
	});
});
