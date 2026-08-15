#!/usr/bin/env node
'use strict';

// test-round-trip-stage.js — gates for the RT-13 round-trip stage (doctrine §7; forge-edfi
// Phase 4; rulings R-WO-16..21): roster composition from REAL parserDescriptor declarations,
// every declared-but-missing refusal observed RED, the uniform invocation signature captured
// verbatim, verdict adjudication (INVENTED fails / LOST tolerated / missing normative fields
// refused), the never-silent dispositions (stage OFF, declared-ABSENT by name, -replay's
// visible non-run), and the -goldEvalCheck certification verb driven through the REAL CLI.
//
// Hermetic: no Docker, no bolt, no Voyage. Everything runs against tmp directories and
// injected doubles; the ONE real-filesystem stage (the census) READS the real forges/ tree
// and asserts from what it finds — never from an inherited constant (the two-readers lesson:
// an inherited census is a hypothesis until a second independent reader confirms it).
//
// Run: node apps/graph-builder/test/test-round-trip-stage.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const helpText = () => `
NAME
     ${moduleName} -- gates for the RT-13 round-trip builder stage

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves composeValidatorRoster against the REAL forges/ descriptors (census asserted from
     the filesystem), every declared-but-missing refusal RED, the uniform validate() signature,
     verdict adjudication per R-WO-18/21, the never-silent dispositions, and -goldEvalCheck
     through the real CLI. Hermetic: tmp dirs and doubles only.

OPTIONS
     -verbose    Show every individual assertion, not just failures and the tally.
     -quiet      Failures and the tally only.
     -help       This message.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);
const roundTripStageLib = require('../lib/round-trip-stage')();
const roundTripStageStatics = require('../lib/round-trip-stage');
const { resolveBundle: realResolveBundle } = require('../apps/forger');

const treeRoot = path.join(__dirname, '..', '..', '..');
const forgesDirPath = path.join(treeRoot, 'forges');
const graphBuilderExecutable = path.join(__dirname, '..', 'graphBuilder.js');

const capturingXLog = () => {
	const lines = [];
	return {
		lines,
		text: () => lines.join('\n'),
		status: (...args) => lines.push(args.join(' ')),
		error: (...args) => lines.push(args.join(' ')),
		result: (...args) => lines.push(args.join(' ')),
		verbose: () => {},
	};
};

const freshTmpDir = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `rtStage-${label}-`));

// =====================================================================
// STAGE 1 — ROSTER CENSUS against the REAL forges tree
// =====================================================================
const stageRealCensus = (done) => {
	harness.section(
		'ROSTER CENSUS — composed from the REAL parserDescriptor.ini declarations, asserted from the filesystem',
	);
	// the independent reader: every directory carrying a parserDescriptor.ini IS a bundle;
	// the census is derived here, in this suite, from the tree — never inherited.
	const allBundleTokens = fs
		.readdirSync(forgesDirPath, { withFileTypes: true })
		.filter((oneEntry) => oneEntry.isDirectory())
		.map((oneEntry) => oneEntry.name)
		.filter((oneName) => fs.existsSync(path.join(forgesDirPath, oneName, 'parserDescriptor.ini')))
		.sort();

	// ---------------------------------------------------------------------------------------
	// WHY THE EXPECTATIONS BELOW ARE DERIVED AND NOT WRITTEN DOWN (forge-sif Phase 3, 2026-08-04,
	// AMBER_TOWER-authorized as a NAMED EXCEPTION to that campaign's bundle-local scope guard).
	//
	// This stage used to assert a FROZEN CENSUS — "exactly TWO bundles declare: edfi + pesc",
	// "SIXTEEN are absent" — which was true on the day forge-edfi Phase 4 wrote it and false the
	// moment any other bundle declared. forge-sif's declaration turned it red in three places,
	// and the campaign that caused the red was forbidden by its own scope guard from fixing it:
	// a gate whose correct response is "edit me" without saying so. Bumping the three literals
	// would only re-arm the trap for the next bundle, so the assertion is rewritten to state the
	// INVARIANT instead of the snapshot.
	//
	// The invariant: composeValidatorRoster's classification MATCHES a second, independent read
	// of the same descriptors, name for name, in both directions. Independence is the whole
	// point and it is real — this reader scans the descriptor's OWN BYTES for a
	// `roundTripValidator=` line, while the roster reaches its answer through resolveBundle and
	// qtools-config-file-processor. Deriving the expectation from composeValidatorRoster itself
	// would be a tautology that passes forever and proves nothing.
	//
	// This is the two-readers lesson stated in this file's header, finally applied to the census
	// the header was talking about: an inherited census is a hypothesis until a second
	// independent reader confirms it — and a census written down in a literal is inherited from
	// the day it was typed.
	// ---------------------------------------------------------------------------------------
	const readDescriptorFieldFromBytes = ({ standardToken, fieldName }) => {
		const descriptorLines = fs
			.readFileSync(path.join(forgesDirPath, standardToken, 'parserDescriptor.ini'), 'utf8')
			.split('\n');
		const declaringLine = descriptorLines.find(
			(oneLine) => oneLine.trim().indexOf(`${fieldName}=`) === 0,
		);
		return declaringLine === undefined
			? undefined
			: declaringLine.trim().slice(`${fieldName}=`.length).trim();
	};

	const independentlyDeclaredTokens = allBundleTokens
		.filter(
			(oneToken) =>
				readDescriptorFieldFromBytes({
					standardToken: oneToken,
					fieldName: 'roundTripValidator',
				}) !== undefined,
		)
		.sort();
	const independentlyAbsentTokens = allBundleTokens
		.filter((oneToken) => !independentlyDeclaredTokens.includes(oneToken))
		.sort();

	// The FILTER RULE is what deserves a stated expectation, not the population it currently
	// selects: a directory without a descriptor is not a bundle, and the reference implementation
	// is. Both stay true as the fleet declares.
	harness.ok(
		'forges/bridges carries no parserDescriptor.ini and is therefore NOT a bundle',
		!allBundleTokens.includes('bridges'),
		allBundleTokens.join(','),
	);
	harness.ok(
		'the reference implementation (ceds) IS among the descriptor-carrying bundles',
		allBundleTokens.includes('ceds'),
		allBundleTokens.join(','),
	);
	harness.ok(
		`the tree holds ${allBundleTokens.length} descriptor-carrying forge bundles (reported, not frozen)`,
		allBundleTokens.length > 0,
		`${allBundleTokens.length}`,
	);

	roundTripStageLib.composeValidatorRoster(
		{ standardTokens: allBundleTokens, bundleResolver: realResolveBundle },
		(rosterError, roster) => {
			harness.equal('the full-corpus roster composes without refusal', rosterError, '');
			harness.equal(
				`the DECLARED set matches the independent descriptor read, name for name ` +
					`(${independentlyDeclaredTokens.length} today: ${independentlyDeclaredTokens.join(', ')})`,
				roster.declaredTokens.sort().join(','),
				independentlyDeclaredTokens.join(','),
			);
			harness.equal(
				`the declared-ABSENT set is the bundle set minus the declared set, name for name ` +
					`(${independentlyAbsentTokens.length} today — the big-bang backlog)`,
				roster.absentTokens.sort().join(','),
				independentlyAbsentTokens.join(','),
			);
			// The reconciliation A8 asks of every count check: state the two sides and prove the
			// rows account for the tokens. Without this, a classifier that silently dropped a
			// bundle would still satisfy both set comparisons above.
			harness.equal(
				`declared + absent + unresolvable reconciles against the tokens examined ` +
					`(${roster.declaredTokens.length} + ${roster.absentTokens.length} + ` +
					`${roster.unresolvableTokens.length} vs ${allBundleTokens.length})`,
				roster.declaredTokens.length +
					roster.absentTokens.length +
					roster.unresolvableTokens.length,
				allBundleTokens.length,
			);
			harness.equal(
				'every descriptor-carrying bundle resolves (unresolvableTokens is empty)',
				roster.unresolvableTokens.join(','),
				'',
			);

			// EVERY declared bundle is held to the contract, not a named pair. As bundles declare,
			// this stage gets stronger without anyone editing it — which is the property the frozen
			// census did not have. The snapshotDirPath check reads each descriptor's OWN pin from
			// the bytes, so it also survives a pin flip (forge-edfi's 01 -> 04 at its Phase 5
			// closeout would have needed no edit here).
			roster.rosterRows
				.filter((oneRow) => oneRow.disposition === 'declared')
				.forEach((oneRow) => {
					harness.ok(
						`  ${oneRow.token}: validatorApi.validate is a function (the declaration loads)`,
						typeof oneRow.validatorApi.validate === 'function',
					);
					const pinnedSnapshot = readDescriptorFieldFromBytes({
						standardToken: oneRow.token,
						fieldName: 'defaultSnapshot',
					});
					harness.ok(
						`  ${oneRow.token}: snapshotPath is the version directory its OWN descriptor pins ` +
							`(${pinnedSnapshot})`,
						oneRow.snapshotDirPath ===
							path.join(forgesDirPath, oneRow.token, 'assets/standardSourceData', pinnedSnapshot),
						oneRow.snapshotDirPath,
					);
				});
			done();
		},
	);
};

// =====================================================================
// STAGE 2 — DECLARED-BUT-MISSING refusals, every twin RED (RT-13.3 / R-WO-16)
// =====================================================================
const stageMissingRefusals = (done) => {
	harness.section('DECLARED-BUT-MISSING — every broken-declaration shape REFUSES by name, observed RED');

	const scratchBundleDir = freshTmpDir('fakeBundle');
	const scratchSnapshotDir = freshTmpDir('fakeSnapshot');
	const resolverWith = (overrides) => ({ standard }) => ({
		bundleDir: scratchBundleDir,
		standardName: 'FAKE',
		entryPath: path.join(scratchBundleDir, 'forgeFake.js'),
		defaultSource: scratchSnapshotDir,
		snapshotDirPath: scratchSnapshotDir,
		...overrides,
	});

	roundTripStageLib.composeValidatorRoster(
		{ standardTokens: ['fake'], bundleResolver: resolverWith({ roundTripValidatorFileName: 'doesNotExist.js' }) },
		(missingError) => {
			harness.match(
				'a declared file that does not EXIST refuses naming file + RT-13.3',
				missingError,
				/doesNotExist\.js.*does not\s+EXIST.*RT-13\.3/s,
			);

			const noLoadFilePath = path.join(scratchBundleDir, 'brokenSyntax.js');
			fs.writeFileSync(noLoadFilePath, 'this is not javascript {{{');
			roundTripStageLib.composeValidatorRoster(
				{ standardTokens: ['fake'], bundleResolver: resolverWith({ roundTripValidatorFileName: 'brokenSyntax.js' }) },
				(loadError) => {
					harness.match(
						'a declared file that does not LOAD refuses naming the load fault',
						loadError,
						/brokenSyntax\.js.*does not LOAD/s,
					);

					const noValidateFilePath = path.join(scratchBundleDir, 'noValidate.js');
					fs.writeFileSync(noValidateFilePath, "module.exports = () => ({ notValidate: true });\n");
					roundTripStageLib.composeValidatorRoster(
						{ standardTokens: ['fake'], bundleResolver: resolverWith({ roundTripValidatorFileName: 'noValidate.js' }) },
						(shapeError) => {
							harness.match(
								'a module exporting no validate() refuses naming the uniform entry point',
								shapeError,
								/exports no validate\(\)/,
							);

							roundTripStageLib.composeValidatorRoster(
								{ standardTokens: ['fake'], bundleResolver: resolverWith({ roundTripValidatorFileName: '   ' }) },
								(blankError) => {
									harness.match(
										'a BLANK declaration refuses — neither a declaration nor an absence',
										blankError,
										/BLANK roundTripValidator/,
									);

									const goodValidatorFilePath = path.join(scratchBundleDir, 'goodValidator.js');
									fs.writeFileSync(
										goodValidatorFilePath,
										"module.exports = () => ({ validate: (spec, cb) => cb('', {}) });\n",
									);
									roundTripStageLib.composeValidatorRoster(
										{
											standardTokens: ['fake'],
											bundleResolver: resolverWith({
												roundTripValidatorFileName: 'goodValidator.js',
												snapshotDirPath: null,
											}),
										},
										(noPinError) => {
											harness.match(
												'a declared validator with NO pinned snapshot refuses — no answer key, nothing to diff',
												noPinError,
												/pins no defaultSnapshot/,
											);

											// the green direction: the same scratch bundle with everything present composes
											roundTripStageLib.composeValidatorRoster(
												{
													standardTokens: ['fake'],
													bundleResolver: resolverWith({ roundTripValidatorFileName: 'goodValidator.js' }),
												},
												(cleanError, cleanRoster) => {
													harness.equal('the intact twin of the same declaration composes clean', cleanError, '');
													harness.equal(
														'  and classifies DECLARED',
														cleanRoster.declaredTokens.join(','),
														'fake',
													);
													// an UNRESOLVABLE bundle is recorded, NOT refused (the forger's own
													// phase-A refusal is the incumbent error and must keep firing)
													roundTripStageLib.composeValidatorRoster(
														{
															standardTokens: ['ghost'],
															bundleResolver: () => ({ error: 'no forge bundle for ghost' }),
														},
														(ghostError, ghostRoster) => {
															harness.equal('an unresolvable bundle does NOT refuse composition', ghostError, '');
															harness.equal(
																'  it is classified unresolvable for the forger to refuse as always',
																ghostRoster.unresolvableTokens.join(','),
																'ghost',
															);
															done();
														},
													);
												},
											);
										},
									);
								},
							);
						},
					);
				},
			);
		},
	);
};

// =====================================================================
// STAGE 3 — runRoundTripStage: signature, adjudication, dispositions
// =====================================================================
const stageRunBehavior = (done) => {
	harness.section('RUN — uniform signature verbatim, INVENTED fails, LOST tolerated, dispositions never silent');

	const containerHandle = {
		containerName: 'DEV_rtStage_test',
		boltUrl: 'bolt://localhost:9999',
		user: 'neo4j',
		password: 'testSecret',
	};
	const makeRoster = (validatorApi) => ({
		rosterRows: [
			{
				token: 'alpha',
				standardName: 'ALPHA',
				disposition: 'declared',
				validatorPath: '/fake/alpha/roundTripValidator.js',
				validatorApi,
				snapshotDirPath: '/fake/alpha/assets/standardSourceData/01',
			},
			{ token: 'beta', standardName: 'BETA', disposition: 'absent' },
		],
		declaredTokens: ['alpha'],
		absentTokens: ['beta'],
		unresolvableTokens: [],
	});

	// ---- the green run: signature captured, LOST tolerated, summary lands ----
	const outputDirPath = freshTmpDir('runGreen');
	const capturedSpecList = [];
	const greenValidator = {
		validate: (spec, cb) => {
			capturedSpecList.push(spec);
			cb('', {
				roundTripClean: false,
				inventedTotal: 0,
				lostTotal: 5,
				contentGapTotal: 5,
				explicitlyOmittedTotal: 2,
				reproduced: 100,
			});
		},
	};
	const xLog = capturingXLog();
	roundTripStageLib.runRoundTripStage(
		{
			stageSpec: {
				mode: 'build',
				enabled: true,
				roster: makeRoster(greenValidator),
				outputDirPath,
			},
			containerHandle,
			xLog,
		},
		(greenError, greenReport) => {
			harness.equal('a lossy-but-invention-free stage run SUCCEEDS (LOST is the enrichment meter)', greenError, '');
			harness.equal('the validator was invoked exactly once', capturedSpecList.length, 1);
			const spec = capturedSpecList[0] || {};
			harness.equal(
				'the uniform signature carries EXACTLY the six declared keys',
				Object.keys(spec).sort().join(','),
				'boltUrl,containerName,outputPath,password,snapshotPath,user',
			);
			harness.equal('  containerName from the handle', spec.containerName, 'DEV_rtStage_test');
			harness.equal('  boltUrl from the handle', spec.boltUrl, 'bolt://localhost:9999');
			harness.equal('  user from the handle (one credential home)', spec.user, 'neo4j');
			harness.equal('  password from the handle', spec.password, 'testSecret');
			harness.equal(
				'  snapshotPath is the descriptor-pinned version directory',
				spec.snapshotPath,
				'/fake/alpha/assets/standardSourceData/01',
			);
			harness.equal(
				'  outputPath is the per-standard stage directory',
				spec.outputPath,
				path.join(outputDirPath, 'roundTrip', 'alpha'),
			);
			harness.match(
				'declared-ABSENT is logged BY NAME (beta), never a count, never silence',
				xLog.text(),
				/declared-ABSENT: 'beta' \(BETA\)/,
			);
			const summaryFilePath = path.join(
				outputDirPath,
				roundTripStageStatics.STAGE_SUBDIR_NAME,
				roundTripStageStatics.STAGE_SUMMARY_FILE_NAME,
			);
			harness.ok('the stage summary landed with the build outputs', fs.existsSync(summaryFilePath));
			const summary = JSON.parse(fs.readFileSync(summaryFilePath, 'utf-8'));
			harness.equal('  summary says the stage ran', summary.stageRan, true);
			harness.equal('  the alpha row carries lostTotal=5', summary.standards[0].lostTotal, 5);
			harness.equal('  the report hands back the summary path', greenReport.summaryFilePath, summaryFilePath);

			// ---- RED twin: INVENTED > 0 fails the run (R-WO-18) ----
			const inventedDirPath = freshTmpDir('runInvented');
			roundTripStageLib.runRoundTripStage(
				{
					stageSpec: {
						mode: 'build',
						enabled: true,
						roster: makeRoster({
							validate: (spec2, cb) =>
								cb('', {
									roundTripClean: false,
									inventedTotal: 3,
									lostTotal: 0,
									contentGapTotal: 0,
									explicitlyOmittedTotal: 0,
								}),
						}),
						outputDirPath: inventedDirPath,
					},
					containerHandle,
					xLog: capturingXLog(),
				},
				(inventedError) => {
					harness.match(
						'inventedTotal=3 FAILS the stage naming the number and the doctrine line',
						inventedError,
						/inventedTotal=3.*INVENTED must be 0/s,
					);
					const inventedSummary = JSON.parse(
						fs.readFileSync(
							path.join(inventedDirPath, 'roundTrip', roundTripStageStatics.STAGE_SUMMARY_FILE_NAME),
							'utf-8',
						),
					);
					harness.match(
						'  and the summary is STILL written, carrying the failure (evidence for the operator)',
						inventedSummary.disposition,
						/^FAILED:/,
					);

					// ---- RED twin: a verdict missing the normative fields is refused (R-WO-21) ----
					roundTripStageLib.runRoundTripStage(
						{
							stageSpec: {
								mode: 'build',
								enabled: true,
								roster: makeRoster({ validate: (spec3, cb) => cb('', { roundTripClean: true }) }),
								outputDirPath: freshTmpDir('runNoFields'),
							},
							containerHandle,
							xLog: capturingXLog(),
						},
						(fieldsError) => {
							harness.match(
								'a verdict lacking inventedTotal/lostTotal is REFUSED by name — never an alternative-name chain',
								fieldsError,
								/normative RT-6 field\(s\) inventedTotal, lostTotal/,
							);

							// ---- RED twin (A13): a REAL stale verdictVersion -1 artifact is REFUSED ----
							// Fixtured on a genuine -1 artifact PRESERVED under test/fixtures rather than a
							// synthetic object built to fail. This is the hazard A13 creates and must answer
							// for: lostTotal MEANT "everything not reproduced" in a -1 verdict and MEANS
							// "contentGap only" in a -2 one. This file carries roundTripClean,
							// inventedTotal AND lostTotal, so the pre-A13 refusal waves it through and the
							// builder would silently read its 349 under the new meaning. Requiring the two
							// A13 fields converts that silent misreading into a named refusal.
							//
							// WHY A PRESERVED COPY AND NOT THE LIVE ARTIFACT (2026-08-15): this twin
							// originally pointed at forges/edfi/test/test-artifacts/realGraphRun/
							// roundTripVerdict.json — a LIVE output path that runEdfiRoundTripRealGraph.js
							// rewrites on every real-graph run. Commit edd583f (2026-08-10) refreshed it to a
							// -2 verdict, and the twin silently lost its subject (the -2 file carries the A13
							// fields, so the stage correctly ACCEPTS it and the refusal never fires). A red
							// twin's fixture must be immutable; a live artifact is not. The preserved copy is
							// the -1 verdict as committed at 469cc3b.
							const staleVerdictFilePath = path.join(
								__dirname,
								'fixtures/staleEdfiRoundTripVerdict-1.json',
							);
							harness.ok(
								'the stale -1 verdict fixture exists on disk (a red twin fixtured on a real artifact)',
								fs.existsSync(staleVerdictFilePath),
							);
							const staleVerdict = JSON.parse(fs.readFileSync(staleVerdictFilePath, 'utf-8'));
							harness.equal(
								'  and it really is a verdictVersion -1 artifact',
								staleVerdict.verdictVersion,
								'edfiRoundTripVerdict-1',
							);
							harness.ok(
								'  and it WOULD pass the pre-A13 field check — which is exactly the hazard',
								staleVerdict.roundTripClean !== undefined &&
									staleVerdict.inventedTotal !== undefined &&
									staleVerdict.lostTotal !== undefined,
							);
							roundTripStageLib.runRoundTripStage(
								{
									stageSpec: {
										mode: 'build',
										enabled: true,
										roster: makeRoster({
											validate: (spec5, cb) => cb('', staleVerdict),
										}),
										outputDirPath: freshTmpDir('runStaleVerdictVersion'),
									},
									containerHandle,
									xLog: capturingXLog(),
								},
								(staleError) => {
									harness.match(
										'a stale -1 verdict is REFUSED BY NAME for the A13 fields, never misread under the new meaning',
										staleError,
										/normative RT-6 field\(s\) contentGapTotal, explicitlyOmittedTotal/,
									);

									// ---- RED twin: a validator ERROR fails the stage naming the standard ----
							roundTripStageLib.runRoundTripStage(
								{
									stageSpec: {
										mode: 'build',
										enabled: true,
										roster: makeRoster({ validate: (spec4, cb) => cb('bolt exploded') }),
										outputDirPath: freshTmpDir('runValErr'),
									},
									containerHandle,
									xLog: capturingXLog(),
								},
								(validatorError) => {
									harness.match(
										"a validator error fails the stage naming 'alpha' and the fault",
										validatorError,
										/'alpha' roundTripValidator FAILED: bolt exploded/,
									);
									done();
								},
							);
								},
							);
						},
					);
				},
			);
		},
	);
};

// =====================================================================
// STAGE 4 — dispositions: stage OFF, -replay, and the input refusals
// =====================================================================
const stageDispositions = (done) => {
	harness.section('DISPOSITIONS — stage OFF logged + summarized; -replay a VISIBLE non-run; inputs refused by name');

	const offDirPath = freshTmpDir('off');
	const offXLog = capturingXLog();
	let offValidatorInvoked = false;
	roundTripStageLib.runRoundTripStage(
		{
			stageSpec: {
				mode: 'build',
				enabled: false,
				disabledReason: 'recipe default (roundTripStage absent)',
				roster: {
					rosterRows: [
						{
							token: 'alpha',
							standardName: 'ALPHA',
							disposition: 'declared',
							validatorApi: { validate: () => (offValidatorInvoked = true) },
							snapshotDirPath: '/x',
						},
					],
					declaredTokens: ['alpha'],
					absentTokens: [],
					unresolvableTokens: [],
				},
				outputDirPath: offDirPath,
			},
			containerHandle: undefined, // stage OFF must not need credentials
			xLog: offXLog,
		},
		(offError, offReport) => {
			harness.equal('stage OFF succeeds without a containerHandle', offError, '');
			harness.equal('  and invokes NO validator', offValidatorInvoked, false);
			harness.match(
				'  the disposition line names the default AND the GOLD_EVAL requirement',
				offXLog.text(),
				/stage OFF \(recipe default \(roundTripStage absent\)\).*GOLD_EVAL/,
			);
			const offSummary = JSON.parse(
				fs.readFileSync(
					path.join(offDirPath, 'roundTrip', roundTripStageStatics.STAGE_SUMMARY_FILE_NAME),
					'utf-8',
				),
			);
			harness.equal('  the summary records stageRan false (the certification evidence)', offSummary.stageRan, false);
			harness.equal('  and the report hands back its path', offReport.summaryFilePath !== undefined, true);

			const replayXLog = capturingXLog();
			roundTripStageLib.runRoundTripStage(
				{ stageSpec: { mode: 'replayNotApplicable' }, xLog: replayXLog },
				(replayError, replayReport) => {
					harness.equal("-replay's non-run succeeds", replayError, '');
					harness.match(
						'  and is VISIBLE (R-WO-19): the line says the round trip runs at build time',
						replayXLog.text(),
						/stage not applicable to -replay/,
					);
					harness.equal('  and writes NO summary', replayReport.summaryFilePath, undefined);

					roundTripStageLib.runRoundTripStage({ stageSpec: undefined, xLog: capturingXLog() }, (noSpecError) => {
						harness.match('an ABSENT stageSpec is refused by name', noSpecError, /stageSpec is REQUIRED/);
						roundTripStageLib.runRoundTripStage(
							{ stageSpec: { mode: 'weird' }, xLog: capturingXLog() },
							(modeError) => {
								harness.match('an unknown mode is refused naming the declared modes', modeError, /unknown stageSpec\.mode 'weird'/);
								roundTripStageLib.runRoundTripStage(
									{
										stageSpec: {
											mode: 'build',
											enabled: true,
											roster: { rosterRows: [], declaredTokens: [], absentTokens: [], unresolvableTokens: [] },
											outputDirPath: freshTmpDir('noHandle'),
										},
										containerHandle: { containerName: 'DEV_x', boltUrl: 'bolt://x', password: 'p' },
										xLog: capturingXLog(),
									},
									(handleError) => {
										harness.match(
											'a handle missing user is refused — the builder supplies the FULL triple',
											handleError,
											/containerName, boltUrl, user and password/,
										);
										done();
									},
								);
							},
						);
					});
				},
			);
		},
	);
};

// =====================================================================
// STAGE 5 — -goldEvalCheck through the REAL CLI (R-WO-20)
// =====================================================================
const stageGoldEvalCheck = (done) => {
	harness.section('-goldEvalCheck — the certification gate, driven through the real control surface');

	const runCli = (args) =>
		spawnSync(process.execPath, [graphBuilderExecutable, ...args], { encoding: 'utf8', cwd: treeRoot });

	const makeRunDir = ({ stageRan, disposition, standards }) => {
		const runDirPath = freshTmpDir('goldEval');
		const stageDirPath = path.join(runDirPath, roundTripStageStatics.STAGE_SUBDIR_NAME);
		fs.mkdirSync(stageDirPath, { recursive: true });
		fs.writeFileSync(
			path.join(stageDirPath, roundTripStageStatics.STAGE_SUMMARY_FILE_NAME),
			JSON.stringify({ stageRan, disposition, containerName: 'DEV_x', absentTokens: [], standards }, null, '\t'),
		);
		return runDirPath;
	};
	const withVerdictFile = (runDirPath, token, row) => {
		const verdictDirPath = path.join(runDirPath, roundTripStageStatics.STAGE_SUBDIR_NAME, token);
		fs.mkdirSync(verdictDirPath, { recursive: true });
		const verdictPath = path.join(verdictDirPath, roundTripStageStatics.VERDICT_FILE_NAME);
		fs.writeFileSync(verdictPath, JSON.stringify({ roundTripClean: row.roundTripClean }));
		return { ...row, verdictPath };
	};

	const missingRun = runCli(['-goldEvalCheck', '--buildLogDirPath=/nowhere/at/all']);
	harness.equal('a directory with no summary exits nonzero', missingRun.status, 1);
	harness.match('  naming the missing evidence', missingRun.stderr, /no stage summary at/);

	const offDirPath = makeRunDir({ stageRan: false, disposition: 'off: recipe default', standards: [] });
	const offRun = runCli(['-goldEvalCheck', `--buildLogDirPath=${offDirPath}`]);
	harness.equal('a stage-OFF build is REFUSED certification', offRun.status, 1);
	harness.match('  naming the doctrine clause and the remedy', offRun.stderr, /stage did not run.*roundTripStage: true/s);

	// the invented-run fixture: the dir must exist before the verdict row can point into it,
	// so the summary is written empty first and rewritten with the row below.
	const inventedRunDirPath = makeRunDir({ stageRan: true, disposition: 'ran', standards: [] });
	const inventedRow = withVerdictFile(inventedRunDirPath, 'alpha', {
		token: 'alpha',
		standardName: 'ALPHA',
		disposition: 'declared',
		ran: true,
		roundTripClean: false,
		inventedTotal: 2,
		lostTotal: 0,
	});
	fs.writeFileSync(
		path.join(inventedRunDirPath, roundTripStageStatics.STAGE_SUBDIR_NAME, roundTripStageStatics.STAGE_SUMMARY_FILE_NAME),
		JSON.stringify({ stageRan: true, disposition: 'ran', containerName: 'DEV_x', absentTokens: [], standards: [inventedRow] }, null, '\t'),
	);
	const inventedRun = runCli(['-goldEvalCheck', `--buildLogDirPath=${inventedRunDirPath}`]);
	harness.equal('nonzero inventedTotal in the summary is REFUSED certification', inventedRun.status, 1);
	harness.match('  naming the standard and the hard line', inventedRun.stderr, /'alpha' reports inventedTotal=2/);

	const cleanRunDirPath = makeRunDir({ stageRan: true, disposition: 'ran', standards: [] });
	const cleanRow = withVerdictFile(cleanRunDirPath, 'alpha', {
		token: 'alpha',
		standardName: 'ALPHA',
		disposition: 'declared',
		ran: true,
		roundTripClean: true,
		inventedTotal: 0,
		lostTotal: 0,
	});
	const missingVerdictRow = {
		token: 'gamma',
		standardName: 'GAMMA',
		disposition: 'declared',
		ran: true,
		roundTripClean: true,
		inventedTotal: 0,
		lostTotal: 0,
		verdictPath: path.join(cleanRunDirPath, 'roundTrip', 'gamma', 'roundTripVerdict.json'),
	};
	fs.writeFileSync(
		path.join(cleanRunDirPath, roundTripStageStatics.STAGE_SUBDIR_NAME, roundTripStageStatics.STAGE_SUMMARY_FILE_NAME),
		JSON.stringify(
			{ stageRan: true, disposition: 'ran', containerName: 'DEV_x', absentTokens: [], standards: [cleanRow, missingVerdictRow] },
			null,
			'\t',
		),
	);
	const missingVerdictRun = runCli(['-goldEvalCheck', `--buildLogDirPath=${cleanRunDirPath}`]);
	harness.equal('a ran-row whose verdict artifact is MISSING on disk is REFUSED', missingVerdictRun.status, 1);
	harness.match('  naming the missing artifact', missingVerdictRun.stderr, /'gamma' ran but its verdict artifact is missing/);

	// the green direction: drop the gamma row, certification PASSES with the evidence listed
	fs.writeFileSync(
		path.join(cleanRunDirPath, roundTripStageStatics.STAGE_SUBDIR_NAME, roundTripStageStatics.STAGE_SUMMARY_FILE_NAME),
		JSON.stringify(
			{ stageRan: true, disposition: 'ran', containerName: 'DEV_x', absentTokens: ['beta'], standards: [cleanRow] },
			null,
			'\t',
		),
	);
	const passRun = runCli(['-goldEvalCheck', `--buildLogDirPath=${cleanRunDirPath}`]);
	harness.equal('the intact twin PASSES certification', passRun.status, 0);
	harness.match('  stdout carries the machine-readable PASS', passRun.stdout, /"certification": "PASS"/);
	harness.match('  tolerated declared-ABSENT bundles are LISTED, not hidden', passRun.stdout, /"beta"/);

	const noParamRun = runCli(['-goldEvalCheck']);
	harness.equal('a missing --buildLogDirPath is refused', noParamRun.status, 1);
	harness.match('  by name', noParamRun.stderr, /--buildLogDirPath.*REQUIRED/s);

	done();
};

// =====================================================================
stageRealCensus(() =>
	stageMissingRefusals(() =>
		stageRunBehavior(() => stageDispositions(() => stageGoldEvalCheck(() => harness.report()))),
	),
);
