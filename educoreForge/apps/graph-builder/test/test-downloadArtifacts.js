#!/usr/bin/env node
'use strict';

// test-downloadArtifacts.js — gate for the standard downloads generator (WORKORDER-standardDownloads-101526 §4, educoreForge).
// Docker-free: the library and the zip writer over scripted rows, scratch COPIES of real snapshots and of the real build's
// stage summary. The real build directory and the real snapshots are only ever read.
//
// PROVES:
//   (a) the zip is deterministic: the same entries in any order give the same bytes; unzip -t accepts it; content round-trips
//   (b) the zip refuses by name: a '..' path, an absolute path, a duplicate path, an empty list
//   (c) the offer reads family and version from the graph's rows (EdFi spelled as the graph spells it), a bundle the graph
//       lacks takes its family from its forge declaration, and a golden standard or token nobody offers is REFUSED by name
//   (d) the manifest: two entries per standard sorted by downloadId; the aggregate's graph entry unavailable "not in this graph";
//       a licence hold makes both facets unavailable with its reason; the graph facet carries the round-trip totals, the
//       source facet none; an unavailable entry has no fileName, size or sha256
//   (e) a snapshot that fails its own checksums is REFUSED by name (a scratch copy with one byte changed)
//   (f) a file in a snapshot that is neither summed nor a declared companion or exclusion is REFUSED by name
//   (g) a fresh verdict that disagrees with the build's is REFUSED by name: a tampered COPY of the real build summary
//   (h) every README says "semantically equal", quotes the verdict's semanticValidationLimit, and never says "identical";
//       a statement listing's README says it is not the native format
//   (i) the statement listing is one JSON line per statement, sorted by statementKey
//   (j) the read-only guard forces every session to READ mode and refuses a second install
//   (k) every entry carries where its source came from (WORKORDER-sourceUrls-101526): the address, the relation and its
//       wording, the page and the note, null on every field when none is recorded; each README says it, worded by
//       relation, and an unrecorded address is said to be unrecorded, never replaced by a publisher's address; an offered
//       bundle whose record was not read is refused by name
//   (l) the graph facet, the download that is not the original, says "experimental" in its README heading and its manifest
//       description; the source facet says it in neither (TQ 2026-10-15, WORKORDER-experimentalLabel-101526)
// RED TWINS (in memory, module double): totalIgnored -> (g); strayAccepted -> (f); holdIgnored -> (d); familyRetyped -> (c);
// unofferedTokenIgnored -> (c); sortDropped -> (a); sourceUrlDropped -> (k); unrecordedGivenAHomePage -> (k);
// experimentalDropped -> (l); experimentalOnSource -> (l).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: the standard downloads generator (manifest, deterministic zip, refusals)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { loadBuildJsDouble } = require('../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');
const sourceVerificationLib = require('../../../lib/forge-framework/sourceVerification');

const LIB_PATH = path.join(__dirname, '..', 'lib', 'download-artifacts.js');
const ZIP_PATH = path.join(__dirname, '..', 'lib', 'deterministic-zip.js');
const libFor = (mutationList) => (mutationList.length === 0 ? require(LIB_PATH) : loadBuildJsDouble({ buildJsPath: LIB_PATH, mutationList }));
const zipFor = (mutationList) => (mutationList.length === 0 ? require(ZIP_PATH) : loadBuildJsDouble({ buildJsPath: ZIP_PATH, mutationList }));
const { installReadOnlyDriverGuard } = require(path.join(__dirname, '..', 'lib', 'download-artifacts-graph.js'));
const RULES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'lib', 'downloadArtifactsRules.json'), 'utf8'));
const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SNAPSHOT_DIR_PATH = path.join(TREE_ROOT, 'forges', 'pesccollegetranscript1v8v0', 'assets', 'standardSourceData', '01');
const REAL_BUILD_SUMMARY_PATH = path.join(TREE_ROOT, '..', '..', 'dataStores', 'jevq_101326', 'jevqCt17PerBridge', 'buildLogs', 'goldJevCt17Concepts_20261013-215009', 'roundTrip', 'roundTripStageSummary.json');
const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'downloadArtifacts-'));

// a toy offer: two PESC standards (one in the graph), an EdFi under a hold, the graph's own rows
const TOY_RULES = {
	...RULES,
	offeredBundleList: [
		{ bundleToken: 'pesctoy1v0v0', forgeDeclarationRelativePath: 'lib/declaration.js', groupName: 'Toy Transcript', graphEmissionKind: 'regeneratedXsdDirectory', layerTokenList: [], descriptionText: 'a toy release' },
		{ bundleToken: 'pesctoyaggregate', forgeDeclarationRelativePath: 'lib/declaration.js', groupName: 'Toy aggregate', graphEmissionKind: 'regeneratedXsdDirectory', layerTokenList: [], versionText: 'aggregate 01', descriptionText: 'a toy aggregate' },
		{ bundleToken: 'edfitoy', forgeDeclarationRelativePath: 'lib/declaration.js', groupName: 'Toy Ed-Fi', graphEmissionKind: 'statementListing', layerTokenList: [], descriptionText: 'a toy model' },
	],
	licenceHoldList: [{ bundleToken: 'edfitoy', facetList: ['source', 'graph'], unavailableReason: 'held under the toy licence' }],
};
const resolvedBundleOf = ({ bundleToken, standardName, standardKey, standardFamily }) => ({ bundleDir: `/toy/forges/${bundleToken}`, standardName, snapshotDirPath: `/toy/forges/${bundleToken}/assets/standardSourceData/01`, forgeDeclaration: { standardKey, standardFamily, standardSource: standardName } });
const TOY_RESOLVED = {
	pesctoy1v0v0: resolvedBundleOf({ bundleToken: 'pesctoy1v0v0', standardName: 'PESC-Toy-1.0.0', standardKey: 'pesctoy1v0v0', standardFamily: 'PESC' }),
	pesctoyaggregate: resolvedBundleOf({ bundleToken: 'pesctoyaggregate', standardName: 'PESCTOYAGG', standardKey: 'pesctoyaggregate', standardFamily: 'PESC' }),
	edfitoy: resolvedBundleOf({ bundleToken: 'edfitoy', standardName: 'EdFi', standardKey: 'edfitoy', standardFamily: 'EdFi' }),
};
const TOY_DEFINITION_ROWS = [
	{ sourceKey: 'PESC-Toy-1.0.0', standardKey: 'pesctoy1v0v0', standardFamily: 'PESC', version: '1.0.0' },
	{ sourceKey: 'EdFi', standardKey: 'edfitoy', standardFamily: 'EdFi', version: '5.2.0' },
];
const TOY_TOKENS = ['pesctoy1v0v0', 'edfitoy'];
const sourceUrlRecordLib = require('../../../lib/snapshot-provenance/source-url-record');
const toySourceUrlRecordOf = (provenanceText) => sourceUrlRecordLib.sourceUrlRecordOfText({ provenanceText, describedAs: 'toy' }).sourceUrlRecord;
const TOY_SOURCE_URLS = {
	pesctoy1v0v0: toySourceUrlRecordOf('sourceUrl: https://toy.example/transcript/\nsourceUrlRelation: publishedOn\nsourceUrlVerification: toy\n'),
	pesctoyaggregate: toySourceUrlRecordOf('sourceUrl: https://toy.example/standards/\nsourceUrlRelation: derivedFrom\nsourceUrlNote: our own aggregate\nsourceUrlVerification: toy\n'),
	edfitoy: toySourceUrlRecordOf('standard: forge-edfitoy\n'),
};
const TOY_VERDICT = { inventedTotal: 0, lostTotal: 0, contentGapTotal: 0, explicitlyOmittedTotal: 7, roundTripClean: true, semanticValidationLimit: 'TOY LIMIT: statements of the toy grammar only' };

const conjunctJudgeByRefId = {
	a_zipIsDeterministic: (mutationList, done) => {
		const zipLib = zipFor(mutationList);
		const entryList = [{ entryPath: 'b/two.txt', contentBuffer: Buffer.from('two '.repeat(500)) }, { entryPath: 'README.md', contentBuffer: Buffer.from('é readme') }, { entryPath: 'a.bin', contentBuffer: Buffer.from([0, 1, 2]) }];
		const forwardBuild = zipLib.buildZipBuffer({ zipEntryList: entryList });
		const reversedBuild = zipLib.buildZipBuffer({ zipEntryList: entryList.slice().reverse() });
		const zipFilePath = path.join(scratchRootPath, 'probe.zip');
		fs.writeFileSync(zipFilePath, forwardBuild.zipBuffer);
		const unzipText = execFileSync('unzip', ['-t', zipFilePath], { encoding: 'utf8' });
		const readmeBack = execFileSync('unzip', ['-p', zipFilePath, 'README.md']);
		const listText = execFileSync('unzip', ['-Z1', zipFilePath], { encoding: 'utf8' });
		done({
			pass: Buffer.compare(forwardBuild.zipBuffer, reversedBuild.zipBuffer) === 0 && /No errors detected/.test(unzipText) && readmeBack.toString('utf8') === 'é readme' && listText.trim().split('\n').join(',') === 'README.md,a.bin,b/two.txt',
			detail: `same=${Buffer.compare(forwardBuild.zipBuffer, reversedBuild.zipBuffer) === 0} list=${listText.trim().split('\n').join(',')} ${unzipText.slice(-60)}`,
		});
	},
	b_zipRefusesByName: (mutationList, done) => {
		const zipLib = zipFor(mutationList);
		const dotDot = zipLib.buildZipBuffer({ zipEntryList: [{ entryPath: '../escape.txt', contentBuffer: Buffer.from('x') }] });
		const absolute = zipLib.buildZipBuffer({ zipEntryList: [{ entryPath: '/etc/x', contentBuffer: Buffer.from('x') }] });
		const duplicate = zipLib.buildZipBuffer({ zipEntryList: [{ entryPath: 'a', contentBuffer: Buffer.from('x') }, { entryPath: 'a', contentBuffer: Buffer.from('y') }] });
		const empty = zipLib.buildZipBuffer({ zipEntryList: [] });
		done({ pass: /'\.\.\/escape\.txt' holds an empty, '\.' or '\.\.' segment/.test(dotDot.error) && /is absolute/.test(absolute.error) && /'a' appears twice/.test(duplicate.error) && /an empty archive is refused/.test(empty.error), detail: [dotDot.error, absolute.error, duplicate.error, empty.error].join(' | ') });
	},
	c_offerReadsFamilyFromTheGraph: (mutationList, done) => {
		const lib = libFor(mutationList);
		const offer = lib.offeredStandardListFor({ rules: TOY_RULES, resolvedBundleByToken: TOY_RESOLVED, standardDefinitionRowList: TOY_DEFINITION_ROWS, declaredTokenList: TOY_TOKENS, sourceUrlRecordByToken: TOY_SOURCE_URLS });
		const byToken = {};
		(offer.offeredStandardList || []).forEach((oneStandard) => { byToken[oneStandard.bundleToken] = oneStandard; });
		const unoffered = lib.offeredStandardListFor({ rules: TOY_RULES, resolvedBundleByToken: TOY_RESOLVED, standardDefinitionRowList: TOY_DEFINITION_ROWS, declaredTokenList: [...TOY_TOKENS, 'siftoy'], sourceUrlRecordByToken: TOY_SOURCE_URLS });
		const unclaimed = lib.offeredStandardListFor({ rules: TOY_RULES, resolvedBundleByToken: TOY_RESOLVED, standardDefinitionRowList: [...TOY_DEFINITION_ROWS, { sourceKey: 'SIFTOY', standardKey: 'siftoy', standardFamily: 'SIF', version: '4.3' }], declaredTokenList: TOY_TOKENS, sourceUrlRecordByToken: TOY_SOURCE_URLS });
		const disagreeing = lib.offeredStandardListFor({ rules: TOY_RULES, resolvedBundleByToken: TOY_RESOLVED, standardDefinitionRowList: [TOY_DEFINITION_ROWS[0], { ...TOY_DEFINITION_ROWS[1], standardFamily: 'Ed-Fi' }], declaredTokenList: TOY_TOKENS, sourceUrlRecordByToken: TOY_SOURCE_URLS });
		done({
			pass: !offer.error && byToken.edfitoy.family === 'EdFi' && byToken.edfitoy.version === '5.2.0' && byToken.pesctoy1v0v0.inGraph === true
				&& byToken.pesctoyaggregate.inGraph === false && byToken.pesctoyaggregate.family === 'PESC' && byToken.pesctoyaggregate.version === 'aggregate 01'
				&& /the golden declares round-trip token 'siftoy', which no offered bundle names/.test(unoffered.error)
				&& /the golden holds standard 'SIFTOY' \(family SIF\), which no offered bundle resolves to/.test(unclaimed.error)
				&& /the graph says family 'Ed-Fi' standardKey 'edfitoy', its forge declaration says 'EdFi' 'edfitoy'/.test(disagreeing.error),
			detail: `${offer.error || JSON.stringify(byToken.edfitoy)} | ${unoffered.error} | ${unclaimed.error} | ${disagreeing.error}`,
		});
	},
	d_manifestEntries: (mutationList, done) => {
		const lib = libFor(mutationList);
		const offer = lib.offeredStandardListFor({ rules: TOY_RULES, resolvedBundleByToken: TOY_RESOLVED, standardDefinitionRowList: TOY_DEFINITION_ROWS, declaredTokenList: TOY_TOKENS, sourceUrlRecordByToken: TOY_SOURCE_URLS });
		const planList = lib.entryPlanListFor({ rules: TOY_RULES, offeredStandardList: offer.offeredStandardList || [] });
		const zipBuffer = Buffer.from('a toy zip');
		const entryList = planList.map((entryPlan) => lib.manifestEntryFor({ entryPlan, zipBuffer: entryPlan.available ? zipBuffer : null, verdict: entryPlan.standard.inGraph ? TOY_VERDICT : null }));
		const manifest = lib.manifestFor({ graphName: 'GOLD_EVAL_toy', graphContractSha256: 'c'.repeat(64), generatedAt: '2026-10-15', entryList });
		const byId = {};
		manifest.entryList.forEach((oneEntry) => { byId[oneEntry.downloadId] = oneEntry; });
		const idList = manifest.entryList.map((oneEntry) => oneEntry.downloadId);
		done({
			pass: idList.join() === 'edfitoy-graph,edfitoy-source,pesctoy1v0v0-graph,pesctoy1v0v0-source,pesctoyaggregate-graph,pesctoyaggregate-source'
				&& byId['pesctoyaggregate-graph'].available === false && byId['pesctoyaggregate-graph'].unavailableReason === 'not in this graph' && byId['pesctoyaggregate-graph'].fileName === null && byId['pesctoyaggregate-graph'].sha256 === null
				&& byId['pesctoyaggregate-source'].available === true && byId['pesctoyaggregate-source'].fileName === 'pesctoyaggregate-source.zip'
				&& byId['edfitoy-source'].available === false && byId['edfitoy-graph'].available === false && byId['edfitoy-graph'].unavailableReason === 'held under the toy licence' && byId['edfitoy-graph'].roundTrip.explicitlyOmittedTotal === 7
				&& byId['pesctoy1v0v0-graph'].roundTrip.lostTotal === 0 && byId['pesctoy1v0v0-source'].roundTrip === null
				&& byId['pesctoy1v0v0-graph'].sha256 === lib.sha256Of(zipBuffer) && byId['pesctoy1v0v0-graph'].byteSize === zipBuffer.length && byId['pesctoy1v0v0-graph'].family === 'PESC' && byId['pesctoy1v0v0-graph'].group === 'Toy Transcript',
			detail: JSON.stringify(manifest.entryList.map((oneEntry) => [oneEntry.downloadId, oneEntry.available, oneEntry.unavailableReason])),
		});
	},
	e_checksumFailureRefusedByName: (mutationList, done) => {
		const lib = libFor(mutationList);
		const scratchSnapshotPath = path.join(scratchRootPath, `tampered-${Date.now()}`);
		fs.cpSync(REAL_SNAPSHOT_DIR_PATH, scratchSnapshotPath, { recursive: true });
		lib.verifiedSnapshotContentFor({ rules: RULES, bundleToken: 'pesccollegetranscript1v8v0', snapshotDirPath: scratchSnapshotPath, zipPathPrefix: 'source', verifySnapshotChecksums: sourceVerificationLib.verifySnapshotChecksums }, (cleanError, cleanContent) => {
			const tamperedFilePath = path.join(scratchSnapshotPath, 'CollegeTranscript_v1.8.0.xsd');
			const tamperedBuffer = fs.readFileSync(tamperedFilePath);
			tamperedBuffer[100] = tamperedBuffer[100] === 0x41 ? 0x42 : 0x41;
			fs.writeFileSync(tamperedFilePath, tamperedBuffer);
			lib.verifiedSnapshotContentFor({ rules: RULES, bundleToken: 'pesccollegetranscript1v8v0', snapshotDirPath: scratchSnapshotPath, zipPathPrefix: 'source', verifySnapshotChecksums: sourceVerificationLib.verifySnapshotChecksums }, (tamperedError) => {
				done({
					pass: cleanError === '' && cleanContent.verifiedPathList.length === 5 && cleanContent.companionPathList.join() === 'README_PROVENANCE.md,SHA256SUMS,standardSourceLocation'
						&& /snapshot checksum failure for 'pesccollegetranscript1v8v0' .*'CollegeTranscript_v1\.8\.0\.xsd' sha256 MISMATCH/.test(tamperedError),
					detail: `${cleanError || `clean: ${cleanContent.verifiedPathList.length} verified`} | ${tamperedError || 'tampered copy NOT refused'}`,
				});
			});
		});
	},
	f_strayFileRefusedByName: (mutationList, done) => {
		const lib = libFor(mutationList);
		const scratchSnapshotPath = path.join(scratchRootPath, `stray-${Date.now()}`);
		fs.cpSync(REAL_SNAPSHOT_DIR_PATH, scratchSnapshotPath, { recursive: true });
		fs.writeFileSync(path.join(scratchSnapshotPath, 'unprovenanced.xsd'), '<x/>');
		lib.verifiedSnapshotContentFor({ rules: RULES, bundleToken: 'pesccollegetranscript1v8v0', snapshotDirPath: scratchSnapshotPath, zipPathPrefix: 'source', verifySnapshotChecksums: sourceVerificationLib.verifySnapshotChecksums }, (strayError) => {
			done({ pass: /file\(s\) neither in SHA256SUMS nor a declared companion or exclusion: unprovenanced\.xsd/.test(strayError), detail: strayError || 'stray file NOT refused' });
		});
	},
	g_freshBuildDisagreementRefused: (mutationList, done) => {
		const lib = libFor(mutationList);
		const tamperedDirPath = path.join(scratchRootPath, 'tamperedBuild');
		fs.mkdirSync(tamperedDirPath, { recursive: true });
		const tamperedSummaryPath = path.join(tamperedDirPath, 'roundTripStageSummary.json');
		fs.copyFileSync(REAL_BUILD_SUMMARY_PATH, tamperedSummaryPath);
		const realSummary = JSON.parse(fs.readFileSync(REAL_BUILD_SUMMARY_PATH, 'utf8'));
		const tamperedSummary = JSON.parse(fs.readFileSync(tamperedSummaryPath, 'utf8'));
		tamperedSummary.standards.find((oneRow) => oneRow.token === 'sif260928').explicitlyOmittedTotal += 1;
		fs.writeFileSync(tamperedSummaryPath, JSON.stringify(tamperedSummary));
		const agreeing = lib.freshVerdictComparisonFor({ freshSummary: realSummary, buildSummary: realSummary, comparedTotalNameList: RULES.comparedVerdictTotalNameList });
		const disagreeing = lib.freshVerdictComparisonFor({ freshSummary: realSummary, buildSummary: JSON.parse(fs.readFileSync(tamperedSummaryPath, 'utf8')), comparedTotalNameList: RULES.comparedVerdictTotalNameList });
		const missingToken = lib.freshVerdictComparisonFor({ freshSummary: { standards: realSummary.standards.filter((oneRow) => oneRow.token !== 'ceds:guide') }, buildSummary: realSummary, comparedTotalNameList: RULES.comparedVerdictTotalNameList });
		done({
			pass: agreeing.disagreementList.length === 0 && agreeing.comparisonRowList.length === 13
				&& disagreeing.disagreementList.length === 1 && /^sif260928: explicitlyOmittedTotal fresh 6586 build 6587$/.test(disagreeing.disagreementList[0])
				&& missingToken.disagreementList.join() === 'ceds:guide: the fresh run did not run it',
			detail: `${agreeing.disagreementList.length} | ${disagreeing.disagreementList.join('; ')} | ${missingToken.disagreementList.join('; ')}`,
		});
	},
	h_readmeWording: (mutationList, done) => {
		const lib = libFor(mutationList);
		const offer = lib.offeredStandardListFor({ rules: TOY_RULES, resolvedBundleByToken: TOY_RESOLVED, standardDefinitionRowList: TOY_DEFINITION_ROWS, declaredTokenList: TOY_TOKENS, sourceUrlRecordByToken: TOY_SOURCE_URLS });
		const planById = {};
		lib.entryPlanListFor({ rules: TOY_RULES, offeredStandardList: offer.offeredStandardList }).forEach((onePlan) => { planById[onePlan.downloadId] = onePlan; });
		const stamp = { graphName: 'GOLD_EVAL_toy', graphContractSha256: 'c'.repeat(64), generatedAt: '2026-10-15', snapshotIdentityLine: 'forges/pesctoy1v0v0/assets/standardSourceData/01' };
		const sourceText = lib.sourceReadmeTextFor({ entryPlan: planById['pesctoy1v0v0-source'], ...stamp, snapshotReportList: [{ zipPathPrefix: 'source', titleText: 'the snapshot', verifiedPathList: ['a.xsd'], companionPathList: ['SHA256SUMS'], excludedPathList: [] }], semanticValidationLimit: TOY_VERDICT.semanticValidationLimit });
		const graphText = lib.graphReadmeTextFor({ entryPlan: planById['pesctoy1v0v0-graph'], ...stamp, verdict: TOY_VERDICT, layerVerdictList: [], emissionNoteText: 'graph/ holds 1 XSD.', documentationFileNameList: [], rules: RULES });
		const listingNote = lib.graphEmissionReaderByKind.statementListing({ statementListingText: '{}\n', statementCount: 1, verdict: { census: { statementCensus: { graphStatementCount: 1 } } } });
		const listingCountMismatch = lib.graphEmissionReaderByKind.statementListing({ statementListingText: '{}\n', statementCount: 1, verdict: { census: { statementCensus: { graphStatementCount: 2 } } } });
		const aggregateText = lib.sourceReadmeTextFor({ entryPlan: planById['pesctoyaggregate-source'], ...stamp, snapshotReportList: [], semanticValidationLimit: '' });
		const everyText = [sourceText, graphText, aggregateText].join('\n');
		done({
			pass: /semantically equal/.test(sourceText) && /semantically equal/.test(graphText) && sourceText.includes(`> ${TOY_VERDICT.semanticValidationLimit}`) && graphText.includes(`> ${TOY_VERDICT.semanticValidationLimit}`)
				&& !/identical/i.test(everyText) && /GOLD_EVAL_toy/.test(graphText) && /2026-10-15/.test(graphText) && /c{64}/.test(graphText) && /forgeEarlierCertificationRun_notThisGraph/.test(graphText)
				&& /NOT the standard's native format/.test(listingNote.emissionNoteText) && /the statement listing holds 1 statement\(s\); the verdict's census says the graph side emitted 2/.test(listingCountMismatch.error)
				&& /does not hold this standard, so there is no graph download/.test(aggregateText),
			detail: everyText.slice(0, 400),
		});
	},
	i_statementListingSorted: (mutationList, done) => {
		const listing = libFor(mutationList).statementListingTextFor({ statementMap: new Map([['row|/b', { cell: 2 }], ['file|x.tsv', { sha256: 'f' }], ['row|/a', { cell: 1 }]]) });
		const lineList = listing.statementListingText.trimEnd().split('\n');
		done({ pass: listing.statementCount === 3 && lineList.map((oneLine) => JSON.parse(oneLine).statementKey).join() === 'file|x.tsv,row|/a,row|/b' && JSON.parse(lineList[1]).statement.cell === 1, detail: listing.statementListingText });
	},
	k_sourceUrlCarried: (mutationList, done) => {
		const lib = libFor(mutationList);
		const offer = lib.offeredStandardListFor({ rules: TOY_RULES, resolvedBundleByToken: TOY_RESOLVED, standardDefinitionRowList: TOY_DEFINITION_ROWS, declaredTokenList: TOY_TOKENS, sourceUrlRecordByToken: TOY_SOURCE_URLS });
		const unread = lib.offeredStandardListFor({ rules: TOY_RULES, resolvedBundleByToken: TOY_RESOLVED, standardDefinitionRowList: TOY_DEFINITION_ROWS, declaredTokenList: TOY_TOKENS, sourceUrlRecordByToken: { pesctoy1v0v0: TOY_SOURCE_URLS.pesctoy1v0v0, edfitoy: TOY_SOURCE_URLS.edfitoy } });
		const planById = {};
		lib.entryPlanListFor({ rules: TOY_RULES, offeredStandardList: offer.offeredStandardList || [] }).forEach((onePlan) => { planById[onePlan.downloadId] = onePlan; });
		const entryOf = (downloadId) => lib.manifestEntryFor({ entryPlan: planById[downloadId], zipBuffer: planById[downloadId].available ? Buffer.from('z') : null, verdict: planById[downloadId].standard.inGraph ? TOY_VERDICT : null });
		const publishedEntry = entryOf('pesctoy1v0v0-graph');
		const derivedEntry = entryOf('pesctoyaggregate-source');
		const heldEntry = entryOf('edfitoy-source');
		const fieldList = ['sourceUrl', 'sourceUrlRelation', 'sourceUrlRelationText', 'sourceUrlPage', 'sourceUrlNote'];
		const stamp = { graphName: 'GOLD_EVAL_toy', graphContractSha256: 'c'.repeat(64), generatedAt: '2026-10-15', snapshotIdentityLine: 'forges/x/01' };
		const sourceText = lib.sourceReadmeTextFor({ entryPlan: planById['pesctoy1v0v0-source'], ...stamp, snapshotReportList: [], semanticValidationLimit: 'L' });
		const aggregateText = lib.sourceReadmeTextFor({ entryPlan: planById['pesctoyaggregate-source'], ...stamp, snapshotReportList: [], semanticValidationLimit: '' });
		const unrecordedLine = lib.sourceUrlLineOf({ entryPlan: planById['edfitoy-source'] });
		done({
			pass: !offer.error && fieldList.every((fieldName) => fieldName in publishedEntry && fieldName in derivedEntry && fieldName in heldEntry)
				&& publishedEntry.sourceUrl === 'https://toy.example/transcript/' && publishedEntry.sourceUrlRelation === 'publishedOn' && publishedEntry.sourceUrlRelationText === 'Published on' && publishedEntry.sourceUrlNote === null
				&& derivedEntry.sourceUrlRelationText === 'Derived from' && derivedEntry.sourceUrlNote === 'our own aggregate'
				&& fieldList.every((fieldName) => heldEntry[fieldName] === null)
				&& sourceText.includes('- Where this came from: Published on <https://toy.example/transcript/>.')
				&& aggregateText.includes('- Where this came from: Derived from <https://toy.example/standards/>. Note: our own aggregate')
				&& unrecordedLine === `- Where this came from: ${sourceUrlRecordLib.NOT_RECORDED_TEXT}` && !/https?:/.test(unrecordedLine)
				&& /offered bundle 'pesctoyaggregate' has no source URL record/.test(unread.error),
			detail: `${offer.error || ''} | ${JSON.stringify(publishedEntry)} | ${JSON.stringify(heldEntry)} | ${unrecordedLine} | ${unread.error}`,
		});
	},
	l_graphFacetTitledExperimental: (mutationList, done) => {
		const lib = libFor(mutationList);
		const offer = lib.offeredStandardListFor({ rules: TOY_RULES, resolvedBundleByToken: TOY_RESOLVED, standardDefinitionRowList: TOY_DEFINITION_ROWS, declaredTokenList: TOY_TOKENS, sourceUrlRecordByToken: TOY_SOURCE_URLS });
		const planById = {};
		lib.entryPlanListFor({ rules: TOY_RULES, offeredStandardList: offer.offeredStandardList || [] }).forEach((onePlan) => { planById[onePlan.downloadId] = onePlan; });
		const stamp = { graphName: 'GOLD_EVAL_toy', graphContractSha256: 'c'.repeat(64), generatedAt: '2026-10-15', snapshotIdentityLine: 'forges/x/01' };
		const sourceHeading = lib.sourceReadmeTextFor({ entryPlan: planById['pesctoy1v0v0-source'], ...stamp, snapshotReportList: [], semanticValidationLimit: 'L' }).split('\n')[0];
		const graphHeading = lib.graphReadmeTextFor({ entryPlan: planById['pesctoy1v0v0-graph'], ...stamp, verdict: TOY_VERDICT, layerVerdictList: [], emissionNoteText: 'graph/ holds 1 XSD.', documentationFileNameList: [], rules: RULES }).split('\n')[0];
		const sourceDescription = lib.manifestEntryFor({ entryPlan: planById['pesctoy1v0v0-source'], zipBuffer: Buffer.from('z'), verdict: null }).description;
		const graphDescription = lib.manifestEntryFor({ entryPlan: planById['pesctoy1v0v0-graph'], zipBuffer: Buffer.from('z'), verdict: TOY_VERDICT }).description;
		done({
			pass: /\bexperimental\b/i.test(graphHeading) && /\bexperimental\b/i.test(graphDescription)
				&& !/experimental/i.test(sourceHeading) && !/experimental/i.test(sourceDescription)
				&& graphHeading === '# PESC-Toy-1.0.0 — written back out of the graph (experimental)'
				&& graphDescription === 'Written back out of the graph (experimental), with validation files: a toy release',
			detail: `${graphHeading} | ${graphDescription} | ${sourceHeading} | ${sourceDescription}`,
		});
	},
	j_readOnlyGuard: (mutationList, done) => {
		const sessionConfigList = [];
		const fakeDriverModule = { session: { READ: 'READ', WRITE: 'WRITE' }, driver: () => ({ session: (sessionConfig) => { sessionConfigList.push(sessionConfig); return {}; } }) };
		const installed = installReadOnlyDriverGuard({ neo4jDriverModule: fakeDriverModule });
		const guardedDriver = fakeDriverModule.driver('bolt://toy');
		guardedDriver.session();
		guardedDriver.session({ defaultAccessMode: 'WRITE', database: 'neo4j' });
		const secondInstall = installReadOnlyDriverGuard({ neo4jDriverModule: fakeDriverModule });
		done({ pass: sessionConfigList.length === 2 && sessionConfigList.every((oneConfig) => oneConfig.defaultAccessMode === 'READ') && sessionConfigList[1].database === 'neo4j' && installed.readGuard.sessionCount === 2 && /already installed/.test(secondInstall.error), detail: JSON.stringify(sessionConfigList) });
	},
};

const TWIN_LIST = [
	{ conjunctRefId: 'g_freshBuildDisagreementRefused', twinName: 'totalIgnored', libraryName: 'lib', find: "		const differenceList = comparedTotalNameList\n", replace: "		const differenceList = comparedTotalNameList.slice(0, 1)\n" },
	{ conjunctRefId: 'f_strayFileRefusedByName', twinName: 'strayAccepted', libraryName: 'lib', find: '		strayPathList.push(relativePath);', replace: '		companionPathList.push(relativePath);' },
	{ conjunctRefId: 'd_manifestEntries', twinName: 'holdIgnored', libraryName: 'lib', find: "			const licenceHold = holdOf(oneStandard.bundleToken, facet);", replace: '			const licenceHold = undefined;' },
	{ conjunctRefId: 'c_offerReadsFamilyFromTheGraph', twinName: 'familyRetyped', libraryName: 'lib', find: "			family: graphDefinition ? graphDefinition.standardFamily : declaration.standardFamily,", replace: "			family: declaration.standardFamily === 'EdFi' ? 'Ed-Fi' : declaration.standardFamily," },
	{ conjunctRefId: 'c_offerReadsFamilyFromTheGraph', twinName: 'unofferedTokenIgnored', libraryName: 'lib', find: "		.forEach((oneToken) => faultList.push(`the golden declares round-trip token '${oneToken}', which no offered bundle names (as a bundle or a layer) in downloadArtifactsRules.json`));", replace: '		.forEach(() => {});' },
	{ conjunctRefId: 'k_sourceUrlCarried', twinName: 'sourceUrlDropped', libraryName: 'lib', find: '		...ENTRY_SOURCE_URL_FIELD_NAME_LIST.reduce(', replace: '		...[].reduce(' },
	{ conjunctRefId: 'k_sourceUrlCarried', twinName: 'unrecordedGivenAHomePage', libraryName: 'lib', find: '		return `- ${labelText}: ${SOURCE_URL_NOT_RECORDED_TEXT}`;', replace: '		return `- ${labelText}: Published on <https://www.ed-fi.org>`;' },
	{ conjunctRefId: 'l_graphFacetTitledExperimental', twinName: 'experimentalDropped', libraryName: 'lib', find: "readmeHeadingText: 'written back out of the graph (experimental)', manifestDescriptionText: 'Written back out of the graph (experimental), with validation files' }", replace: "readmeHeadingText: 'written back out of the graph', manifestDescriptionText: 'Written back out of the graph, with validation files' }" },
	{ conjunctRefId: 'l_graphFacetTitledExperimental', twinName: 'experimentalOnSource', libraryName: 'lib', find: "manifestDescriptionText: 'Source as ingested' }", replace: "manifestDescriptionText: 'Source as ingested (experimental)' }" },
	{ conjunctRefId: 'a_zipIsDeterministic', twinName: 'sortDropped', libraryName: 'zip', find: "	const sortedEntryList = zipEntryList.slice().sort((leftEntry, rightEntry) => Buffer.compare(Buffer.from(leftEntry.entryPath, 'utf8'), Buffer.from(rightEntry.entryPath, 'utf8')));", replace: '	const sortedEntryList = zipEntryList.slice();' },
];

const refIdList = Object.keys(conjunctJudgeByRefId);
const runSequence = (stepList, whenDone) => {
	const nextStep = (stepIndex) => (stepIndex >= stepList.length ? whenDone() : stepList[stepIndex](() => nextStep(stepIndex + 1)));
	nextStep(0);
};
// a twin mutates one library; the conjunct reads that library through libFor / zipFor, so a twin of the other is a no-op
const mutationListsFor = (oneTwin) => (oneTwin.libraryName === 'zip' ? { zip: [{ find: oneTwin.find, replace: oneTwin.replace }], lib: [] } : { zip: [], lib: [{ find: oneTwin.find, replace: oneTwin.replace }] });
harness.section('BASELINE — the real generator passes every conjunct');
runSequence(
	refIdList.map((oneRefId) => (stepDone) => conjunctJudgeByRefId[oneRefId]([], (verdict) => { harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail); stepDone(); })),
	() => {
		harness.section('THE TWIN SWEEP — each twin OBSERVED RED under a module double (in memory)');
		runSequence(
			TWIN_LIST.map((oneTwin) => (stepDone) => {
				const mutationLists = mutationListsFor(oneTwin);
				const mutationList = oneTwin.libraryName === 'zip' ? mutationLists.zip : mutationLists.lib;
				conjunctJudgeByRefId[oneTwin.conjunctRefId](mutationList, (verdict) => {
					harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
					harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}`);
					stepDone();
				});
			}),
			() => {
				fs.rmSync(scratchRootPath, { recursive: true, force: true });
				harness.report();
			},
		);
	},
);
