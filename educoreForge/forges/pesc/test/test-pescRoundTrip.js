'use strict';

// test-pescRoundTrip.js — the PESC round-trip instrument proven end to end (doctrine §5.4, §6).
//
//   SECTION 1  RT-5 constant verification: the 'xs:' prefix the serializer embeds as grammar is
//              UNIFORM across the real snapshot — checked against all eleven files, so the one
//              shape constant the emitter knows is verified, not assumed.
//   SECTION 2  canonicalization invariance: whitespace, element order and attribute order are
//              NOT statements; a changed WORD is. The adversarial pair proves the instrument
//              can see a real difference through a cosmetic rewrite.
//   SECTION 3  THE ZERO-LOSS GATE (RT-7): the hermetic fixture — real forgePesc (skipEmbedding),
//              graph double, real serializer/canonicalizer/diff — round-trips at ZERO loss and
//              ZERO invention, with predicate coverage pinned so a future fixture edit cannot
//              quietly shrink what "full vocabulary" means.
//   SECTION 4  THE CHEATING DETECTOR (RT-10 twin 1): delete a REAL fact from the graph double —
//              an option value, a description, a derivation — and the REAL diff must name that
//              exact fact LOST. If it does not, the validator knew data it should not (RT-5).
//   SECTION 5  the invention alarm: inject a fact the source never made; INVENTED must fire and
//              name it.
//   SECTION 6  refusals BY NAME (RT-3): container absent, bolt unpublished, credential missing,
//              snapshot absent/corrupt/unlisted/short — each refusal names its cause; the intact
//              control proves no over-refusal.
//   SECTION 7  the gate suite: gates/pescRoundTripGates.jsonc evaluated over REAL measurements,
//              then EVERY gate's twin observed turning it RED; registry audited both directions.
//
// What the graph double does NOT prove (stated per the reference's honesty rule): the loader.
// That proof belongs to the validator's real-container run (roundTripValidator.validate against
// DEV_*), which uses this same machinery over bolt.
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

const bundle = require('../forgePesc')({ embedder: null });
const canonicalLib = require('../lib/roundTripXsdCanonical')();
const compilerLib = require('../lib/roundTripCompiler')();
const doubleLib = require('../lib/roundTripGraphDouble')();
const diffLib = require('../lib/roundTripDiff')();
const validatorLib = require('../roundTripValidator')();
const gatesLib = require('../lib/roundTripGates')();
const twinsLib = require('../lib/roundTripGateTwins')();

const FIXTURE_SOURCE_DIR = path.join(__dirname, 'fixtures', 'pescRoundTripFixture');
const GATES_FILE_PATH = path.join(__dirname, '..', 'gates', 'pescRoundTripGates.jsonc');
const ARTIFACT_DIR = path.join(__dirname, 'test-artifacts');
const REAL_SNAPSHOT_DIR = path.join(__dirname, '..', 'assets', 'standardSourceData', '01');

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

const makeTempDir = (labelText) => fs.mkdtempSync(path.join(os.tmpdir(), `pescRoundTrip-${labelText}-`));

// stage the fixture as a verifiable snapshot: copy the committed .xsd files and write SHA256SUMS.
const stageFixtureSnapshot = () => {
	const snapshotDirPath = makeTempDir('fixtureSnapshot');
	const sumLines = [];
	fs.readdirSync(FIXTURE_SOURCE_DIR)
		.filter((oneName) => oneName.endsWith('.xsd'))
		.sort()
		.forEach((oneName) => {
			const fileBytes = fs.readFileSync(path.join(FIXTURE_SOURCE_DIR, oneName));
			fs.writeFileSync(path.join(snapshotDirPath, oneName), fileBytes);
			sumLines.push(
				`${crypto.createHash('sha256').update(fileBytes).digest('hex')}  ${oneName}`,
			);
		});
	fs.writeFileSync(path.join(snapshotDirPath, 'SHA256SUMS'), `${sumLines.join('\n')}\n`);
	return snapshotDirPath;
};

// run the whole instrument over a (possibly corrupted) graph double.
const runInstrument = ({ pescGraph, adjustPescGraph, snapshotDirPath, runLabel }, callback) => {
	const reader = doubleLib.makeGraphDoubleReader({ pescGraph, adjustPescGraph });
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
	const row = report.invented.perPredicate.find((oneRow) => oneRow.predicate === predicate);
	return row ? row.inventedSamples.map((oneSample) => oneSample.object) : [];
};

// ---------------------------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------------------------

const taskList = new taskListPlus();
const probeFacts = {}; // assembled across sections; consumed by the gate suite in section 7

// SECTION 1 — RT-5: the one grammar constant is verified against the whole real source set.
taskList.push((args, next) => {
	harness.section('SECTION 1 — RT-5: xs: prefix uniformity across the real snapshot');
	const realFilenameList = fs
		.readdirSync(REAL_SNAPSHOT_DIR)
		.filter((oneName) => oneName.endsWith('.xsd'))
		.sort();
	harness.ok('real snapshot holds the 11 XSD files', realFilenameList.length === 11);
	realFilenameList.forEach((oneName) => {
		const text = fs.readFileSync(path.join(REAL_SNAPSHOT_DIR, oneName), 'utf8');
		harness.ok(
			`${oneName} declares xmlns:xs as the XML-Schema namespace and uses the xs: schema element`,
			text.includes('xmlns:xs="http://www.w3.org/2001/XMLSchema"') && text.includes('<xs:schema'),
		);
	});
	next('', args);
});

// SECTION 2 — canonicalization invariance + the adversarial pair.
taskList.push((args, next) => {
	harness.section('SECTION 2 — cosmetic rewrites are invisible; a real difference is not');
	const spellingA = [
		'<?xml version="1.0"?>',
		'<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">',
		'	<xs:complexType name="InvarianceType">',
		'		<xs:annotation><xs:documentation>An   invariance    probe.</xs:documentation></xs:annotation>',
		'		<xs:sequence>',
		'			<xs:element name="AlphaField" type="xs:string" minOccurs="0"/>',
		'			<xs:element name="BetaField" type="xs:string"/>',
		'		</xs:sequence>',
		'	</xs:complexType>',
		'</xs:schema>',
	].join('\n');
	const spellingB = [
		'<?xml version="1.0"?>',
		'<xs:schema     xmlns:xs="http://www.w3.org/2001/XMLSchema">',
		'  <xs:complexType     name="InvarianceType">',
		'      <xs:annotation><xs:documentation>',
		'         An invariance probe.',
		'      </xs:documentation></xs:annotation>',
		'      <xs:sequence>',
		'          <xs:element type="xs:string" name="BetaField" minOccurs="1" maxOccurs="1"></xs:element>',
		'          <xs:element minOccurs="0" name="AlphaField" type="xs:string"/>',
		'      </xs:sequence>',
		'  </xs:complexType>',
		'</xs:schema>',
	].join('\n');
	const spellingC = spellingA.replace('An   invariance    probe.', 'A DIFFERENT invariance probe.');

	canonicalLib.canonicalizeXsdText({ xsdText: spellingA, fileLabel: 'Invariance' }, (errA, resultA) => {
		harness.accepts('spelling A canonicalizes', [errA].filter(Boolean));
		canonicalLib.canonicalizeXsdText({ xsdText: spellingB, fileLabel: 'Invariance' }, (errB, resultB) => {
			harness.accepts('spelling B canonicalizes', [errB].filter(Boolean));
			canonicalLib.canonicalizeXsdText({ xsdText: spellingC, fileLabel: 'Invariance' }, (errC, resultC) => {
				harness.accepts('spelling C canonicalizes', [errC].filter(Boolean));
				const keysOf = (result) => Array.from(result.statements.keys()).sort().join('\n');
				harness.ok(
					'whitespace / element order / attribute order / explicit-default occurrence are NOT statements (A == B)',
					keysOf(resultA) === keysOf(resultB),
				);
				harness.ok(
					'a changed WORD is a statement (A != C)',
					keysOf(resultA) !== keysOf(resultC),
				);
				next('', args);
			});
		});
	});
});

// SECTION 3 — stage fixture, forge it with the REAL forge, round-trip to ZERO/ZERO.
taskList.push((args, next) => {
	harness.section('SECTION 3 — THE ZERO-LOSS GATE (hermetic fixture, real forge, graph double)');
	const snapshotDirPath = stageFixtureSnapshot();
	bundle.forge({ sourcePath: snapshotDirPath, skipEmbedding: true }, (forgeError, forgeResult) => {
		harness.accepts('fixture forges through the real forgePesc', [forgeError].filter(Boolean));
		if (forgeError) {
			next('', { ...args, fixtureBroken: true });
			return;
		}
		const pescGraph = doubleLib.buildPescGraphFromForgeOutput({
			nodes: forgeResult.nodes,
			edges: forgeResult.edges,
		});
		runInstrument(
			{ pescGraph, snapshotDirPath, runLabel: 'clean' },
			(validateError, verdict) => {
				harness.accepts('validateWithReader completes', [validateError].filter(Boolean));
				if (validateError) {
					next('', { ...args, fixtureBroken: true });
					return;
				}
				harness.equal('ZERO LOSS', verdict.lost, 0);
				harness.equal('ZERO INVENTION', verdict.invented, 0);
				harness.ok('roundTripClean is TRUE', verdict.roundTripClean === true);
				harness.ok(
					`the fixture is substantial enough to mean something (${verdict.report.headline.sourceStatements} source statements >= 80)`,
					verdict.report.headline.sourceStatements >= 80,
				);
				// predicate coverage pinned: a future fixture edit cannot quietly shrink coverage.
				const sourcePredicates = new Set(verdict.report.perPredicate.map((oneRow) => oneRow.predicate));
				[
					'declaresComplexType',
					'declaresSimpleType',
					'declaresGroup',
					'declaresRootElement',
					'documentation',
					'enumerationValue',
					'fieldType',
					'minOccurs',
					'maxOccurs',
					'derivesFrom',
					'derivationMethod',
					'restrictionBase',
					'usesGroup',
					'contentTypeRef',
				].forEach((onePredicate) => {
					harness.ok(`fixture exercises ${onePredicate}`, sourcePredicates.has(onePredicate));
				});
				probeFacts.unmodeledConstructTotal = Object.values(
					verdict.report.unmodeledConstructCounts || {},
				).reduce((soFar, oneCount) => soFar + oneCount, 0);
				harness.equal('no unmodeled constructs on the fixture', probeFacts.unmodeledConstructTotal, 0);
				probeFacts.snapshotIdentityWellFormed =
					/^[0-9a-f]{64}$/.test(verdict.snapshot.combinedDigest) &&
					verdict.snapshot.files.length === 2 &&
					verdict.snapshot.files.every((oneFile) => /^[0-9a-f]{64}$/.test(oneFile.sha256));
				harness.ok('verdict names its snapshot (digests well-formed)', probeFacts.snapshotIdentityWellFormed);
				probeFacts.graphIdentityPresent =
					!!verdict.graph &&
					!!verdict.graph.nodeCounts &&
					verdict.graph.nodeCounts.DmeClass >= 1 &&
					!!verdict.graph.rootProperties;
				harness.ok('verdict names its graph (root provenance + counts)', probeFacts.graphIdentityPresent);
				next('', { ...args, snapshotDirPath, pescGraph, cleanVerdict: verdict });
			},
		);
	});
});

// SECTION 4 — THE CHEATING DETECTOR: delete REAL facts; the diff must name each one LOST.
taskList.push((args, next) => {
	if (args.fixtureBroken) {
		next('', args);
		return;
	}
	harness.section('SECTION 4 — CHEATING DETECTOR: a deleted graph fact must surface as LOST, by name');
	const { pescGraph, snapshotDirPath } = args;

	const deleteWithdrawnValue = (servedGraph) => {
		servedGraph.nodesByRole.DmeOptionValue = servedGraph.nodesByRole.DmeOptionValue.filter(
			(oneNode) => oneNode.name !== 'Withdrawn',
		);
		return servedGraph;
	};
	runInstrument(
		{ pescGraph, adjustPescGraph: deleteWithdrawnValue, snapshotDirPath, runLabel: 'deletedValue' },
		(runError, verdict) => {
			harness.accepts('deleted-value run completes', [runError].filter(Boolean));
			if (runError) {
				next('', args);
				return;
			}
			const namedLost = lostSampleObjects(verdict.report, 'enumerationValue');
			harness.ok('deleting the Withdrawn option value turns the diff RED', verdict.lost > 0);
			harness.ok('roundTripClean falls to FALSE', verdict.roundTripClean === false);
			harness.ok(
				`the deleted fact is NAMED in the lost census (${JSON.stringify(namedLost)})`,
				namedLost.includes('Withdrawn'),
			);
			harness.ok(
				'its documentation goes with it, also named',
				lostSampleObjects(verdict.report, 'documentation').some((oneObject) =>
					oneObject.includes('withdrawn'),
				),
			);
			probeFacts.deletedFactShowsLost = verdict.lost > 0 && namedLost.includes('Withdrawn');
			probeFacts.lostRowsWithoutSamples = verdict.report.perPredicate.filter(
				(oneRow) => oneRow.lost > 0 && oneRow.lostSamples.length === 0,
			).length;
			harness.equal('every lost row carries located samples', probeFacts.lostRowsWithoutSamples, 0);
			// A13: the two categories still sum to everything NOT REPRODUCED, but only contentGap
			// is loss. Both halves are asserted: the sum keeps its no-uncategorized-loss meaning,
			// and the verdict's lostTotal must equal contentGap ALONE, never the sum.
			probeFacts.lostCategorySumMatches =
				verdict.report.headline.explicitlyOmitted + verdict.report.headline.contentGap ===
				verdict.report.headline.notReproduced;
			harness.ok(
				'contentGap + explicitlyOmitted sum exactly to NOT REPRODUCED',
				probeFacts.lostCategorySumMatches,
			);
			probeFacts.lostTotalExcludesExplicitlyOmitted =
				verdict.lostTotal === verdict.contentGapTotal &&
				verdict.contentGapTotal + verdict.explicitlyOmittedTotal === verdict.notReproducedTotal;
			harness.ok(
				'lostTotal is contentGap ALONE — deliberate omissions are lifted out of loss (A13)',
				probeFacts.lostTotalExcludesExplicitlyOmitted,
			);
			fs.writeFileSync(
				path.join(ARTIFACT_DIR, 'roundTripTwin-deletedValue.report.json'),
				JSON.stringify(verdict.report, null, 1),
			);

			const deleteFieldDescription = (servedGraph) => {
				servedGraph.nodesByRole.DmeProperty.forEach((oneNode) => {
					if (oneNode.name === 'EnrollmentStatus') {
						delete oneNode.description;
					}
				});
				return servedGraph;
			};
			runInstrument(
				{ pescGraph, adjustPescGraph: deleteFieldDescription, snapshotDirPath, runLabel: 'deletedDoc' },
				(docRunError, docVerdict) => {
					harness.accepts('deleted-description run completes', [docRunError].filter(Boolean));
					harness.ok(
						'deleting a field description surfaces its documentation statement LOST, by name',
						!docRunError &&
							docVerdict.lost > 0 &&
							lostSampleObjects(docVerdict.report, 'documentation').some((oneObject) =>
								oneObject.includes('status of the fixture enrollment'),
							),
					);

					const deleteDerivation = (servedGraph) => {
						servedGraph.nodesByRole.DmeClass.forEach((oneNode) => {
							if (oneNode.name === 'FixtureStudentType') {
								delete oneNode.baseType;
								delete oneNode.derivation;
							}
						});
						return servedGraph;
					};
					runInstrument(
						{ pescGraph, adjustPescGraph: deleteDerivation, snapshotDirPath, runLabel: 'deletedBase' },
						(baseRunError, baseVerdict) => {
							harness.accepts('deleted-derivation run completes', [baseRunError].filter(Boolean));
							harness.ok(
								'deleting a derivation surfaces derivesFrom LOST, by name',
								!baseRunError &&
									lostSampleObjects(baseVerdict.report, 'derivesFrom').includes('FixturePersonType'),
							);
							next('', args);
						},
					);
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
	const { pescGraph, snapshotDirPath } = args;
	const injectBogusValue = (servedGraph) => {
		const statusOptionSet = servedGraph.nodesByRole.DmeOptionSet.find(
			(oneNode) => oneNode.name === 'FixtureStatusCodeType',
		);
		servedGraph.nodesByRole.DmeOptionValue.push({
			_id: 'pesc:optionValue/FixtureCore/FixtureStatusCodeType.BogusInjected',
			name: 'BogusInjected',
			sourceFile: 'FixtureCore',
		});
		servedGraph.edgePairsByName.optionSetHasValue.push({
			ownerId: statusOptionSet._id,
			memberId: 'pesc:optionValue/FixtureCore/FixtureStatusCodeType.BogusInjected',
		});
		return servedGraph;
	};
	runInstrument(
		{ pescGraph, adjustPescGraph: injectBogusValue, snapshotDirPath, runLabel: 'injected' },
		(runError, verdict) => {
			harness.accepts('injected-value run completes', [runError].filter(Boolean));
			if (runError) {
				next('', args);
				return;
			}
			const namedInvented = inventedSampleObjects(verdict.report, 'enumerationValue');
			harness.ok('INVENTED fires', verdict.invented > 0);
			harness.ok(
				`the fabricated fact is NAMED (${JSON.stringify(namedInvented)})`,
				namedInvented.includes('BogusInjected'),
			);
			harness.ok('roundTripClean falls to FALSE on invention alone', verdict.roundTripClean === false);
			probeFacts.injectedFactShowsInvented =
				verdict.invented > 0 && namedInvented.includes('BogusInjected');
			fs.writeFileSync(
				path.join(ARTIFACT_DIR, 'roundTripTwin-injectedValue.report.json'),
				JSON.stringify(verdict.report, null, 1),
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
										path.join(FIXTURE_SOURCE_DIR, 'FixtureCore_v1.0.0.xsd'),
										path.join(noSumsDir, 'FixtureCore_v1.0.0.xsd'),
									);
									validatorLib.verifySnapshotDir({ snapshotPath: noSumsDir }, (noSumsError) => {
										recordRefusal(
											'missing SHA256SUMS -> refusal by name',
											noSumsError,
											/has no SHA256SUMS/,
										);

										const corruptDir = stageFixtureSnapshot();
										fs.appendFileSync(path.join(corruptDir, 'FixtureCore_v1.0.0.xsd'), '\n<!-- tampered -->\n');
										validatorLib.verifySnapshotDir({ snapshotPath: corruptDir }, (corruptError) => {
											recordRefusal(
												'corrupted source byte -> checksum refusal by name',
												corruptError,
												/FixtureCore_v1\.0\.0\.xsd.*fails its SHA256SUMS check/s,
											);

											const unlistedDir = stageFixtureSnapshot();
											fs.writeFileSync(
												path.join(unlistedDir, 'Smuggled_v9.9.9.xsd'),
												'<?xml version="1.0"?>\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"/>\n',
											);
											validatorLib.verifySnapshotDir({ snapshotPath: unlistedDir }, (unlistedError) => {
												recordRefusal(
													'unlisted extra .xsd -> refusal by name',
													unlistedError,
													/Smuggled_v9\.9\.9\.xsd.*NOT listed in SHA256SUMS/s,
												);

												const shortDir = stageFixtureSnapshot();
												fs.unlinkSync(path.join(shortDir, 'FixtureRecord_v1.0.0.xsd'));
												validatorLib.verifySnapshotDir({ snapshotPath: shortDir }, (shortError) => {
													recordRefusal(
														'listed-but-absent file -> refusal by name',
														shortError,
														/FixtureRecord_v1\.0\.0\.xsd.*ABSENT from the snapshot/s,
													);

													// the CONTROL: an intact snapshot must pass (no over-refusal).
													const intactDir = stageFixtureSnapshot();
													validatorLib.verifySnapshotDir({ snapshotPath: intactDir }, (controlError, controlResult) => {
														harness.accepts('CONTROL: intact snapshot verifies clean', [controlError].filter(Boolean));
														harness.ok(
															'CONTROL: both fixture files verified',
															!!controlResult && controlResult.fileRecordList.length === 2,
														);
														probeFacts.refusalsAllNamed =
															refusalOutcomes.every(Boolean) && !controlError;
														next('', args);
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
						path.join(ARTIFACT_DIR, 'roundTripGateTwinObservations.log'),
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
