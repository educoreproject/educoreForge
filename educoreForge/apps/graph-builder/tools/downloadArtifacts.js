#!/usr/bin/env node
'use strict';

// downloadArtifacts.js — the standard downloads for one golden (WORKORDER-standardDownloads-101526 §3a). READ-ONLY toward
// the graph and the forge: every graph session opened in this process is forced to READ mode (download-artifacts-graph.js),
// and nothing in the forge tree is written. It writes only the downloads directory and its own run directory.
//
// Run: node apps/graph-builder/tools/downloadArtifacts.js --graphName=<golden> --buildRoundTripDirPath=<build>/roundTrip
//        --generationDate=YYYY-MM-DD [--outputRootDirPath=<dir>] [--runDirPath=<dir>]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const TREE_ROOT = require('path').join(__dirname, '..', '..', '..');
const DEFAULT_OUTPUT_ROOT_DIR_PATH = require('path').join(TREE_ROOT, '..', '..', 'dataStores', 'downloadArtifacts');
const helpText = `
NAME
     ${moduleName} -- package the standard downloads (source and graph zips, downloads.json) for one golden graph

SYNOPSIS
     ${moduleName} --graphName=<golden> --buildRoundTripDirPath=<the build's roundTrip dir> --generationDate=YYYY-MM-DD
                   [--outputRootDirPath=<dir>] [--runDirPath=<dir>] [-help]

DESCRIPTION
     For every bundle in apps/graph-builder/lib/downloadArtifactsRules.json it writes two entries into
     <outputRootDirPath>/<graphName>/downloads.json, and a zip for each entry that is available:
       source  the bundle's pinned snapshot, every file checked against the snapshot's SHA256SUMS first;
       graph   the standard written back out of the graph by its own round-trip validator, with this run's verdict,
               the bundle's round-trip contract READMEs and its earlier validation certificate.
     Every entry, and every zip's README_DOWNLOAD.md, says where the source came from: the address and its relation
     (downloadedFrom, publishedOn, republishedAs, derivedFrom) as the snapshot's standardSourceLocation states them on
     its sourceUrl lines (lib/snapshot-provenance/source-url-record.js). A snapshot that states none gets null fields
     and the README says the address is not recorded; a half-stated one refuses the run.
     A graph entry for a bundle the golden does not hold, and any entry under a licence hold, is listed as unavailable
     with its reason.

     Before packaging, every round-trip token the build declared is re-run against the golden (read-only) into
     <runDirPath>/roundTrip/, and each fresh verdict's inventedTotal, lostTotal, contentGapTotal and
     explicitlyOmittedTotal is compared with the build's. Any difference stops the run: no zip and no manifest are written.

     Reads: the golden (passport, StandardDefinition rows, every declared standard), the forge tree (descriptors,
     snapshots, READMEs), the build's roundTrip directory. Writes: <outputRootDirPath>/<graphName>/ and <runDirPath>/.
     Never writes to any graph or to the forge tree.

OPTIONS
     --graphName              REQUIRED. The golden container (and graph) name, e.g. GOLD_EVAL_261013_jevQuestionPerBridge.
     --buildRoundTripDirPath  REQUIRED. The build's roundTrip directory (it holds roundTripStageSummary.json). Its stage
                              summary's containerName must equal the golden passport's scratchGraphName.
     --generationDate         REQUIRED. The date stamped into the manifest and every README (YYYY-MM-DD). Declared, not
                              read from the clock, so the same golden, code and date give the same files.
     --outputRootDirPath      Optional. Default ${DEFAULT_OUTPUT_ROOT_DIR_PATH}
                              The downloads land in <outputRootDirPath>/<graphName>/, which must not exist yet.
     --runDirPath             Optional. Default <outputRootDirPath>/_runs/<graphName>-<generationDate>. Must not exist yet.
                              Holds the fresh round-trip output and downloadArtifactsRun.json (the comparison).

EXIT STATUS
     0 the downloads were written;  1 refused or failed (the reason is printed; nothing is left half-written in the
     downloads directory).

FILES
     apps/graph-builder/lib/downloadArtifactsRules.json   the offered bundles, licence holds, snapshot companion rules

EXAMPLES
     node apps/graph-builder/tools/downloadArtifacts.js --graphName=GOLD_EVAL_261013_jevQuestionPerBridge \\
       --buildRoundTripDirPath=../../dataStores/jevq_101326/jevqCt17PerBridge/buildLogs/goldJevCt17Concepts_20261013-215009/roundTrip \\
       --generationDate=2026-10-15
`;

const fs = require('fs');
const path = require('path');

require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const { xLog, commandLineParameters } = process.global;
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();
const neo4jDriverModule = require('neo4j-driver');
const downloadArtifacts = require(path.join(__dirname, '..', 'lib', 'download-artifacts'));
const { installReadOnlyDriverGuard, statementListingEmitterByBundleToken } = require(path.join(__dirname, '..', 'lib', 'download-artifacts-graph'));
const { buildZipBuffer } = require(path.join(__dirname, '..', 'lib', 'deterministic-zip'));
const roundTripStageModule = require(path.join(__dirname, '..', 'lib', 'round-trip-stage')); // the factory, and the statics that name its files
const roundTripStageLib = roundTripStageModule();
const { resolveBundle } = require(path.join(__dirname, '..', 'apps', 'forger'));
const layerFramework = require(path.join(TREE_ROOT, 'lib', 'layer-framework', 'layer-framework'))();
const sourceVerificationLib = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'sourceVerification'));
const { readSourceUrlRecord } = require(path.join(TREE_ROOT, 'lib', 'snapshot-provenance', 'source-url-record'));
const { resolveContainerBolt } = require(path.join(TREE_ROOT, 'lib', 'graph-connection', 'containerBolt')); // R5 S6: names no standard

const RULES_FILE_PATH = path.join(__dirname, '..', 'lib', 'downloadArtifactsRules.json');
const RUN_REPORT_FILE_NAME = 'downloadArtifactsRun.json';
const GENERATION_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PASSPORT_CYPHER = 'MATCH (p:GraphProvenance) RETURN p.graphName AS graphName, p.graphContractSha256 AS graphContractSha256, p.scratchGraphName AS scratchGraphName';
const STANDARD_DEFINITION_CYPHER = 'MATCH (d:StandardDefinition) RETURN d.sourceKey AS sourceKey, d.standardKey AS standardKey, d.standardFamily AS standardFamily, d.version AS version ORDER BY sourceKey';
const GRAPH_SIZE_CYPHER = 'MATCH (n) WITH count(n) AS nodeCount MATCH ()-[r]->() RETURN nodeCount, count(r) AS edgeCount';

const flagValueOf = (flagName) => {
	const flagValue = commandLineParameters.values[flagName];
	return Array.isArray(flagValue) ? flagValue[0] : flagValue;
};
const refuse = (refusalText) => {
	xLog.error(`${moduleName}: REFUSED: ${refusalText}\n(${moduleName} -help for the full page)`);
	process.exit(1);
};

const graphName = flagValueOf('graphName');
const buildRoundTripDirPath = flagValueOf('buildRoundTripDirPath');
const generationDate = flagValueOf('generationDate');
const missingFlagList = [['graphName', graphName], ['buildRoundTripDirPath', buildRoundTripDirPath], ['generationDate', generationDate]].filter(([, flagValue]) => typeof flagValue !== 'string' || flagValue === '').map(([flagName]) => `--${flagName}`);
if (missingFlagList.length) {
	refuse(`${missingFlagList.join(', ')} REQUIRED, with no default`);
}
if (!GENERATION_DATE_PATTERN.test(generationDate)) {
	refuse(`--generationDate='${generationDate}' is not YYYY-MM-DD`);
}
const outputRootDirPath = path.resolve(flagValueOf('outputRootDirPath') || DEFAULT_OUTPUT_ROOT_DIR_PATH);
const downloadsDirPath = path.join(outputRootDirPath, graphName);
const runDirPath = path.resolve(flagValueOf('runDirPath') || path.join(outputRootDirPath, '_runs', `${graphName}-${generationDate}`));
const stagingDirPath = `${downloadsDirPath}.staging-${process.pid}`;
[downloadsDirPath, runDirPath].filter((dirPath) => fs.existsSync(dirPath)).forEach((dirPath) => refuse(`${dirPath} already exists; this tool writes only into a directory it creates (remove it, or name another)`));

const rulesRead = downloadArtifacts.parsedJsonFileOf(RULES_FILE_PATH);
if (rulesRead.error) {
	refuse(rulesRead.error);
}
const rules = rulesRead.parsed;
const rulesFault = downloadArtifacts.rulesFaultOf({ rules, graphEmissionKindList: Object.keys(downloadArtifacts.graphEmissionReaderByKind) });
if (rulesFault) {
	refuse(rulesFault);
}
const buildSummaryRead = downloadArtifacts.parsedJsonFileOf(path.join(buildRoundTripDirPath, roundTripStageModule.STAGE_SUMMARY_FILE_NAME));
if (buildSummaryRead.error) {
	refuse(`the build's stage summary: ${buildSummaryRead.error}`);
}
const buildSummary = buildSummaryRead.parsed;
if (buildSummary.stageRan !== true || buildSummary.disposition !== 'ran' || !Array.isArray(buildSummary.declaredTokens)) {
	refuse(`the build's stage summary says stageRan ${buildSummary.stageRan}, disposition '${buildSummary.disposition}': only a stage that ran clean can be compared with`);
}
const declaredTokenList = buildSummary.declaredTokens.slice();

const guardInstall = installReadOnlyDriverGuard({ neo4jDriverModule });
if (guardInstall.error) {
	refuse(guardInstall.error);
}
const { readGuard } = guardInstall;

const taskList = new taskListPlus();

// the golden's bolt triple, from the container (docker inspect), as -stampPromotion and graphStructureCheck read it
taskList.push((args, next) => resolveContainerBolt({ containerName: graphName }, (resolveError, boltTriple) => next(resolveError ? `${moduleName}: ${resolveError}` : '', { ...args, boltTriple })));

// the golden's own statements about itself: passport, standards, size before
taskList.push((args, next) => {
	const driver = neo4jDriverModule.driver(args.boltTriple.boltUrl, neo4jDriverModule.auth.basic(args.boltTriple.user, args.boltTriple.password), { encrypted: false });
	const session = driver.session({ defaultAccessMode: neo4jDriverModule.session.READ });
	const plainOf = (oneValue) => (oneValue && typeof oneValue.toNumber === 'function' ? oneValue.toNumber() : oneValue);
	const rowsOf = (cypherText) => session.run(cypherText).then((result) => result.records.map((oneRecord) => oneRecord.keys.reduce((soFar, fieldName) => ({ ...soFar, [fieldName]: plainOf(oneRecord.get(fieldName)) }), {})));
	rowsOf(PASSPORT_CYPHER)
		.then((passportRowList) => rowsOf(STANDARD_DEFINITION_CYPHER).then((standardDefinitionRowList) => rowsOf(GRAPH_SIZE_CYPHER).then((sizeRowList) => ({ passportRowList, standardDefinitionRowList, graphSizeBefore: sizeRowList[0] }))))
		.then(
			(readResult) => session.close().then(() => driver.close()).then(() => next('', { ...args, ...readResult })),
			(readError) => session.close().then(() => driver.close()).then(() => next(`${moduleName}: reading the golden failed: ${readError.message}`)),
		);
});

taskList.push((args, next) => {
	if (args.passportRowList.length !== 1) {
		next(`${moduleName}: '${graphName}' holds ${args.passportRowList.length} :GraphProvenance passport(s); exactly one is required`);
		return;
	}
	const passport = args.passportRowList[0];
	if (passport.graphName !== graphName) {
		next(`${moduleName}: the container '${graphName}' holds a passport for graph '${passport.graphName}'`);
		return;
	}
	if (typeof passport.graphContractSha256 !== 'string' || passport.graphContractSha256.length !== 64) {
		next(`${moduleName}: the passport of '${graphName}' carries no graphContractSha256`);
		return;
	}
	if (passport.scratchGraphName !== buildSummary.containerName) {
		next(`${moduleName}: the build stage summary ran against '${buildSummary.containerName}', but '${graphName}' was promoted from '${passport.scratchGraphName}': that build directory is not this golden's build`);
		return;
	}
	next('', { ...args, passport });
});

// every offered bundle resolved from its own descriptor, with its forge declaration
taskList.push((args, next) => {
	const resolvedBundleByToken = {};
	const sourceUrlRecordByToken = {};
	const faultList = [];
	rules.offeredBundleList.forEach((oneRow) => {
		const resolved = resolveBundle({ standard: oneRow.bundleToken });
		if (resolved.error) {
			faultList.push(`${oneRow.bundleToken}: ${resolved.error}`);
			return;
		}
		if (!resolved.snapshotDirPath) {
			faultList.push(`${oneRow.bundleToken}: its descriptor pins no defaultSnapshot`);
			return;
		}
		resolvedBundleByToken[oneRow.bundleToken] = { ...resolved, forgeDeclaration: require(path.join(resolved.bundleDir, oneRow.forgeDeclarationRelativePath)) };
		// where the source came from: the snapshot's own standardSourceLocation is the one place it is recorded
		const sourceUrlRead = readSourceUrlRecord({ snapshotDirPath: resolved.snapshotDirPath });
		if (sourceUrlRead.refusalMessage) {
			faultList.push(`${oneRow.bundleToken}: ${sourceUrlRead.refusalMessage}`);
			return;
		}
		sourceUrlRecordByToken[oneRow.bundleToken] = sourceUrlRead.sourceUrlRecord;
	});
	if (faultList.length) {
		next(`${moduleName}: ${faultList.join('; ')}`);
		return;
	}
	const offer = downloadArtifacts.offeredStandardListFor({ rules, resolvedBundleByToken, standardDefinitionRowList: args.standardDefinitionRowList, declaredTokenList, sourceUrlRecordByToken });
	if (offer.error) {
		next(`${moduleName}: ${offer.error}`);
		return;
	}
	const unemittableList = offer.offeredStandardList.filter((oneStandard) => oneStandard.inGraph && oneStandard.graphEmissionKind === 'statementListing' && !statementListingEmitterByBundleToken[oneStandard.bundleToken]);
	if (unemittableList.length) {
		next(`${moduleName}: no statement-listing emitter for ${unemittableList.map((oneStandard) => oneStandard.bundleToken).join(', ')} (download-artifacts-graph.js statementListingEmitterByBundleToken)`);
		return;
	}
	next('', { ...args, offeredStandardList: offer.offeredStandardList });
});

// every snapshot an offered standard ships (its own, and its layers'), verified against its own SHA256SUMS
taskList.push((args, next) => {
	const snapshotCheckList = [];
	args.offeredStandardList.forEach((oneStandard) => {
		snapshotCheckList.push({ bundleToken: oneStandard.bundleToken, snapshotDirPath: oneStandard.snapshotDirPath, zipPathPrefix: 'source', titleText: 'the standard\'s snapshot' });
		oneStandard.layerTokenList.forEach((layerToken) => {
			const layerKey = layerToken.split(':')[1];
			const resolvedLayer = layerFramework.resolveLayer({ bundleDir: oneStandard.bundleDir, layerKey });
			snapshotCheckList.push(resolvedLayer.error
				? { bundleToken: oneStandard.bundleToken, resolveError: `layer ${layerToken}: ${resolvedLayer.error}` }
				: { bundleToken: oneStandard.bundleToken, snapshotDirPath: resolvedLayer.snapshotDirPath, zipPathPrefix: `source/layers/${layerKey}`, titleText: `the snapshot of the ${layerKey} layer` });
		});
	});
	const snapshotReportListByToken = {};
	const verifyNext = (checkIndex) => {
		if (checkIndex >= snapshotCheckList.length) {
			next('', { ...args, snapshotReportListByToken });
			return;
		}
		const oneCheck = snapshotCheckList[checkIndex];
		if (oneCheck.resolveError) {
			next(`${moduleName}: ${oneCheck.resolveError}`);
			return;
		}
		downloadArtifacts.verifiedSnapshotContentFor({ rules, bundleToken: oneCheck.bundleToken, snapshotDirPath: oneCheck.snapshotDirPath, zipPathPrefix: oneCheck.zipPathPrefix, verifySnapshotChecksums: sourceVerificationLib.verifySnapshotChecksums }, (snapshotError, snapshotContent) => {
			if (snapshotError) {
				next(`${moduleName}: ${snapshotError}`);
				return;
			}
			snapshotReportListByToken[oneCheck.bundleToken] = (snapshotReportListByToken[oneCheck.bundleToken] || []).concat({ ...oneCheck, ...snapshotContent });
			verifyNext(checkIndex + 1);
		});
	};
	verifyNext(0);
});

// the round trip, re-run: the build's own stage, over the build's declared tokens, against the golden
taskList.push((args, next) => {
	const standardTokenList = declaredTokenList.filter((oneToken) => !oneToken.includes(':'));
	const layerList = declaredTokenList.filter((oneToken) => oneToken.includes(':')).map((oneToken) => ({ standardToken: oneToken.split(':')[0], layerKey: oneToken.split(':')[1] }));
	roundTripStageLib.composeValidatorRoster(
		{
			standardTokens: standardTokenList,
			bundleResolver: resolveBundle,
			layerList,
			layerResolver: ({ standardToken, layerKey }) => {
				const bundle = resolveBundle({ standard: standardToken });
				if (bundle.error) {
					return { error: bundle.error };
				}
				const resolvedLayer = layerFramework.resolveLayer({ bundleDir: bundle.bundleDir, layerKey });
				return resolvedLayer.error ? { error: resolvedLayer.error } : { standardName: `${bundle.standardName} layer ${layerKey}`, validatorPath: resolvedLayer.roundTripValidatorPath, snapshotDirPath: resolvedLayer.snapshotDirPath };
			},
		},
		(rosterError, roster) => {
			if (rosterError) {
				next(`${moduleName}: ${rosterError}`);
				return;
			}
			fs.mkdirSync(runDirPath, { recursive: true });
			roundTripStageLib.runRoundTripStage(
				{ stageSpec: { mode: 'build', enabled: true, roster, outputDirPath: runDirPath }, containerHandle: { containerName: graphName, boltUrl: args.boltTriple.boltUrl, user: args.boltTriple.user, password: args.boltTriple.password }, xLog },
				(stageError) => next(stageError ? `${moduleName}: the fresh round trip failed: ${stageError}` : '', args),
			);
		},
	);
});

// THE GATE: fresh against build, or nothing is packaged
taskList.push((args, next) => {
	const freshRoundTripDirPath = path.join(runDirPath, roundTripStageModule.STAGE_SUBDIR_NAME);
	const freshSummaryRead = downloadArtifacts.parsedJsonFileOf(path.join(freshRoundTripDirPath, roundTripStageModule.STAGE_SUMMARY_FILE_NAME));
	if (freshSummaryRead.error) {
		next(`${moduleName}: the fresh stage summary: ${freshSummaryRead.error}`);
		return;
	}
	const comparison = downloadArtifacts.freshVerdictComparisonFor({ freshSummary: freshSummaryRead.parsed, buildSummary, comparedTotalNameList: rules.comparedVerdictTotalNameList });
	const nextArgs = { ...args, freshRoundTripDirPath, comparison };
	if (comparison.disagreementList.length) {
		next(`${moduleName}: the fresh round trip DISAGREES with the build's: ${comparison.disagreementList.join('; ')}`, nextArgs);
		return;
	}
	next('', nextArgs);
});

// the statement listings, emitted from the golden by each bundle's own graph side (a held bundle's too: it is checked, not shipped)
taskList.push((args, next) => {
	const listingStandardList = args.offeredStandardList.filter((oneStandard) => oneStandard.inGraph && oneStandard.graphEmissionKind === 'statementListing');
	const statementListingByToken = {};
	const emitNext = (standardIndex) => {
		if (standardIndex >= listingStandardList.length) {
			next('', { ...args, statementListingByToken });
			return;
		}
		const oneStandard = listingStandardList[standardIndex];
		statementListingEmitterByBundleToken[oneStandard.bundleToken]({ treeRootPath: TREE_ROOT, boltTriple: args.boltTriple }, (emitError, emitted) => {
			if (emitError) {
				next(`${moduleName}: ${emitError}`);
				return;
			}
			statementListingByToken[oneStandard.bundleToken] = downloadArtifacts.statementListingTextFor({ statementMap: emitted.statementMap });
			emitNext(standardIndex + 1);
		});
	};
	emitNext(0);
});

// the golden is unchanged in size after everything above (the READ guard is the barrier; this is the receipt)
taskList.push((args, next) => {
	const driver = neo4jDriverModule.driver(args.boltTriple.boltUrl, neo4jDriverModule.auth.basic(args.boltTriple.user, args.boltTriple.password), { encrypted: false });
	const session = driver.session({ defaultAccessMode: neo4jDriverModule.session.READ });
	session.run(GRAPH_SIZE_CYPHER).then(
		(result) => {
			const graphSizeAfter = { nodeCount: result.records[0].get('nodeCount').toNumber(), edgeCount: result.records[0].get('edgeCount').toNumber() };
			session.close().then(() => driver.close()).then(() => {
				const unchanged = graphSizeAfter.nodeCount === args.graphSizeBefore.nodeCount && graphSizeAfter.edgeCount === args.graphSizeBefore.edgeCount;
				next(unchanged ? '' : `${moduleName}: the golden's size changed during the run (before ${JSON.stringify(args.graphSizeBefore)}, after ${JSON.stringify(graphSizeAfter)})`, { ...args, graphSizeAfter });
			});
		},
		(sizeError) => session.close().then(() => driver.close()).then(() => next(`${moduleName}: reading the golden's size failed: ${sizeError.message}`)),
	);
});

// packaging: every available entry's zip into a staging directory, then the manifest, then one rename into place
taskList.push((args, next) => {
	const entryPlanList = downloadArtifacts.entryPlanListFor({ rules, offeredStandardList: args.offeredStandardList });
	const verdictOf = (bundleToken) => downloadArtifacts.parsedJsonFileOf(path.join(args.freshRoundTripDirPath, bundleToken, downloadArtifacts.VERDICT_FILE_NAME));
	const commonStamp = { graphName, graphContractSha256: args.passport.graphContractSha256, generatedAt: generationDate };
	fs.mkdirSync(stagingDirPath, { recursive: true });
	const manifestEntryList = [];
	for (const entryPlan of entryPlanList) {
		const oneStandard = entryPlan.standard;
		const verdictRead = oneStandard.inGraph ? verdictOf(oneStandard.bundleToken) : { parsed: null };
		if (verdictRead.error) {
			next(`${moduleName}: ${verdictRead.error}`);
			return;
		}
		if (!entryPlan.available) {
			manifestEntryList.push(downloadArtifacts.manifestEntryFor({ entryPlan, zipBuffer: null, verdict: verdictRead.parsed }));
			continue;
		}
		const snapshotReportList = args.snapshotReportListByToken[oneStandard.bundleToken];
		const snapshotIdentityLine = downloadArtifacts.snapshotIdentityLineOf({ oneStandard, sumsFileSha256: snapshotReportList[0].sumsFileSha256 });
		let zipEntryList;
		let readmeText;
		if (entryPlan.facet === downloadArtifacts.FACET_SOURCE) {
			zipEntryList = [].concat(...snapshotReportList.map((oneReport) => oneReport.zipEntryList));
			readmeText = downloadArtifacts.sourceReadmeTextFor({ entryPlan, ...commonStamp, snapshotIdentityLine, snapshotReportList, semanticValidationLimit: verdictRead.parsed ? verdictRead.parsed.semanticValidationLimit : '' });
		} else {
			const listing = args.statementListingByToken[oneStandard.bundleToken] || {};
			const emission = downloadArtifacts.graphEmissionReaderByKind[oneStandard.graphEmissionKind]({ freshTokenDirPath: path.join(args.freshRoundTripDirPath, oneStandard.bundleToken), verdict: verdictRead.parsed, statementListingText: listing.statementListingText, statementCount: listing.statementCount });
			const validation = downloadArtifacts.validationZipEntryListFor({ rules, oneStandard, freshRoundTripDirPath: args.freshRoundTripDirPath });
			if (emission.error || validation.error) {
				next(`${moduleName}: graph zip for '${oneStandard.bundleToken}': ${emission.error || validation.error}`);
				return;
			}
			const layerVerdictList = oneStandard.layerTokenList.map((layerToken) => ({ layerKey: layerToken.split(':')[1], verdict: verdictOf(layerToken).parsed }));
			zipEntryList = [...emission.zipEntryList, ...validation.zipEntryList];
			readmeText = downloadArtifacts.graphReadmeTextFor({ entryPlan, ...commonStamp, snapshotIdentityLine, verdict: verdictRead.parsed, layerVerdictList, emissionNoteText: emission.emissionNoteText, documentationFileNameList: validation.documentationFileNameList, rules });
		}
		const zipBuild = buildZipBuffer({ zipEntryList: [{ entryPath: downloadArtifacts.DOWNLOAD_README_FILE_NAME, contentBuffer: Buffer.from(readmeText, 'utf8') }, ...zipEntryList] });
		if (zipBuild.error) {
			next(`${moduleName}: ${entryPlan.downloadId}: ${zipBuild.error}`);
			return;
		}
		fs.writeFileSync(path.join(stagingDirPath, downloadArtifacts.zipFileNameOf({ standardKey: oneStandard.standardKey, facet: entryPlan.facet })), zipBuild.zipBuffer);
		manifestEntryList.push(downloadArtifacts.manifestEntryFor({ entryPlan, zipBuffer: zipBuild.zipBuffer, verdict: verdictRead.parsed }));
	}
	const manifest = downloadArtifacts.manifestFor({ ...commonStamp, entryList: manifestEntryList });
	fs.writeFileSync(path.join(stagingDirPath, downloadArtifacts.MANIFEST_FILE_NAME), `${JSON.stringify(manifest, null, '\t')}\n`);
	fs.renameSync(stagingDirPath, downloadsDirPath);
	next('', { ...args, manifest });
});

pipeRunner(taskList.getList(), {}, (pipeError, args) => {
	const runReport = {
		graphName,
		generationDate,
		buildRoundTripDirPath: path.resolve(buildRoundTripDirPath),
		downloadsDirPath,
		verdictComparison: args && args.comparison ? args.comparison.comparisonRowList : 'not reached',
		readGuardSessionCount: readGuard.sessionCount,
		graphSizeBefore: args && args.graphSizeBefore,
		graphSizeAfter: args && args.graphSizeAfter,
		outcome: pipeError ? `REFUSED: ${pipeError}` : 'written',
	};
	if (fs.existsSync(runDirPath)) {
		fs.writeFileSync(path.join(runDirPath, RUN_REPORT_FILE_NAME), `${JSON.stringify(runReport, null, '\t')}\n`);
	}
	if (fs.existsSync(stagingDirPath)) {
		xLog.error(`${moduleName}: the unfinished staging directory is left for inspection: ${stagingDirPath}`);
	}
	if (pipeError) {
		xLog.error(`${moduleName}: REFUSED: ${pipeError}`);
		process.exit(1);
	}
	(args.comparison.comparisonRowList || []).forEach((oneRow) => xLog.result(`[compare] ${oneRow.token}: ${oneRow.agrees ? 'AGREES' : 'DIFFERS'} ${JSON.stringify(oneRow.freshTotals)}\n`));
	args.manifest.entryList.forEach((oneEntry) => xLog.result(`[entry] ${oneEntry.downloadId}: ${oneEntry.available ? `${oneEntry.fileName} ${oneEntry.byteSize} bytes sha256 ${oneEntry.sha256}` : `UNAVAILABLE — ${oneEntry.unavailableReason}`}\n`));
	xLog.result(`${moduleName}: wrote ${downloadsDirPath} (${args.manifest.entryList.length} entries); READ-guarded sessions ${readGuard.sessionCount}; golden size unchanged ${JSON.stringify(args.graphSizeAfter)}; run report ${path.join(runDirPath, RUN_REPORT_FILE_NAME)}\n`);
	process.exit(0);
});
