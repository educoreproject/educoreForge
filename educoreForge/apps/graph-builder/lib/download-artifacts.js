'use strict';

// download-artifacts.js — the standard downloads: what to offer, how each zip is filled, and the manifest that lists them
// (WORKORDER-standardDownloads-101526 §3a). tools/downloadArtifacts.js runs it against one golden.
//
// For every bundle offered in downloadArtifactsRules.json there are two entries:
//   source  the pinned snapshot exactly as the forge ingested it, every checksummed file verified first;
//   graph   the standard written back out of the graph by its own round-trip validator, with the validation files.
// A graph entry is available only when the golden holds the bundle; otherwise it is listed with its reason. A licence hold
// (rules licenceHoldList) lists an entry unavailable with the hold's reason. Nothing offered is ever left off the list.
//
// THE COMPARISON GATE: the validators are re-run against the golden; each fresh verdict's compared totals must equal the
// build's verdict for the same token, or the run refuses before a single zip is written (freshVerdictComparisonFor).
//
// This module is pure except for synchronous reads of snapshot and output files (snapshotZipEntryListFor,
// graphEmissionZipEntryListFor), which the tool calls in order. Every function answers { error } or its result; nothing
// here throws for a condition the data can cause. camelCase; no async/await; no try/catch except at JSON.parse of a
// file read from disk (an outside input), where the fault is turned into a named error.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { NOT_RECORDED_TEXT: SOURCE_URL_NOT_RECORDED_TEXT } = require(path.join(__dirname, '..', '..', '..', 'lib', 'snapshot-provenance', 'source-url-record'));

const FACET_SOURCE = 'source';
const FACET_GRAPH = 'graph';
const FACET_LIST = Object.freeze([FACET_SOURCE, FACET_GRAPH]);
const MANIFEST_FILE_NAME = 'downloads.json';
const DOWNLOAD_README_FILE_NAME = 'README_DOWNLOAD.md';
const VERDICT_FILE_NAME = 'roundTripVerdict.json';
const REPORT_FILE_NAME = 'roundTrip.report.txt';
const STATEMENT_LISTING_FILE_NAME = 'statementListing.jsonl';
// /2 (WORKORDER-sourceUrls-101526): every entry carries its source's address and how it relates to the bytes
const MANIFEST_FORMAT = 'educoreStandardDownloads/2';
// the source URL fields an entry carries, exactly as the snapshot's standardSourceLocation states them (null when not recorded)
const ENTRY_SOURCE_URL_FIELD_NAME_LIST = Object.freeze(['sourceUrl', 'sourceUrlRelation', 'sourceUrlRelationText', 'sourceUrlPage', 'sourceUrlNote']);
const NOT_IN_GRAPH_REASON = 'not in this graph';

const sha256Of = (contentBuffer) => crypto.createHash('sha256').update(contentBuffer).digest('hex');
const downloadIdOf = ({ standardKey, facet }) => `${standardKey}-${facet}`;
const zipFileNameOf = ({ standardKey, facet }) => `${downloadIdOf({ standardKey, facet })}.zip`;

const parsedJsonFileOf = (filePath) => {
	if (!fs.existsSync(filePath)) {
		return { error: `${filePath} does not exist` };
	}
	try {
		return { parsed: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
	} catch (parseError) {
		return { error: `${filePath} is not JSON: ${parseError.message}` };
	}
};

// ---------------------------------------------------------------------------------------------------------------------
// RULES — the registry, checked once
// ---------------------------------------------------------------------------------------------------------------------

const REQUIRED_RULE_FIELD_LIST = Object.freeze(['offeredBundleList', 'licenceHoldList', 'snapshotCompanionFileNameList', 'snapshotExcludedPathList', 'documentationFileNameList', 'earlierCertificationFileName', 'comparedVerdictTotalNameList', 'verdictRunMeasurementList', 'verdictLocalPathNoteText']);
const REQUIRED_OFFERED_FIELD_LIST = Object.freeze(['bundleToken', 'forgeDeclarationRelativePath', 'groupName', 'graphEmissionKind', 'layerTokenList', 'descriptionText']);

const rulesFaultOf = ({ rules, graphEmissionKindList }) => {
	if (!rules || typeof rules !== 'object') {
		return 'download rules are absent';
	}
	const absentFieldList = REQUIRED_RULE_FIELD_LIST.filter((fieldName) => rules[fieldName] === undefined);
	if (absentFieldList.length) {
		return `download rules lack ${absentFieldList.join(', ')}`;
	}
	const faultList = [];
	const seenTokenSet = new Set();
	rules.offeredBundleList.forEach((oneRow, rowIndex) => {
		const absentList = REQUIRED_OFFERED_FIELD_LIST.filter((fieldName) => oneRow[fieldName] === undefined || oneRow[fieldName] === '');
		if (absentList.length) {
			faultList.push(`offeredBundleList[${rowIndex}] lacks ${absentList.join(', ')}`);
			return;
		}
		if (seenTokenSet.has(oneRow.bundleToken)) {
			faultList.push(`bundle '${oneRow.bundleToken}' is offered twice`);
		}
		seenTokenSet.add(oneRow.bundleToken);
		if (!graphEmissionKindList.includes(oneRow.graphEmissionKind)) {
			faultList.push(`bundle '${oneRow.bundleToken}' names graphEmissionKind '${oneRow.graphEmissionKind}'; the kinds are ${graphEmissionKindList.join(', ')}`);
		}
	});
	rules.licenceHoldList.forEach((oneHold) => {
		if (!seenTokenSet.has(oneHold.bundleToken)) {
			faultList.push(`licence hold names bundle '${oneHold.bundleToken}', which is not offered`);
		}
		const badFacetList = (oneHold.facetList || []).filter((oneFacet) => !FACET_LIST.includes(oneFacet));
		if (!Array.isArray(oneHold.facetList) || oneHold.facetList.length === 0 || badFacetList.length) {
			faultList.push(`licence hold on '${oneHold.bundleToken}' must name facets among ${FACET_LIST.join(', ')}`);
		}
		if (typeof oneHold.unavailableReason !== 'string' || oneHold.unavailableReason.trim() === '') {
			faultList.push(`licence hold on '${oneHold.bundleToken}' gives no unavailableReason`);
		}
	});
	return faultList.length ? `download rules: ${faultList.join('; ')}` : '';
};

// ---------------------------------------------------------------------------------------------------------------------
// THE OFFER — each offered bundle resolved to its identity (family, version, standardKey) and whether the golden holds it
// ---------------------------------------------------------------------------------------------------------------------

// offeredStandardListFor — PURE over what the tool read:
//   resolvedBundleByToken  { <token>: { bundleDir, standardName, snapshotDirPath, forgeDeclaration } }
//   standardDefinitionRowList  the golden's StandardDefinition rows { sourceKey, standardKey, standardFamily, version }
//   declaredTokenList  the golden's declared round-trip tokens (the build's stage summary)
//   sourceUrlRecordByToken  { <token>: the snapshot's source URL record (lib/snapshot-provenance/source-url-record.js) }
// -> { offeredStandardList } | { error }
const offeredStandardListFor = ({ rules, resolvedBundleByToken, standardDefinitionRowList, declaredTokenList, sourceUrlRecordByToken }) => {
	const faultList = [];
	const definitionBySourceKey = {};
	standardDefinitionRowList.forEach((oneRow) => {
		definitionBySourceKey[oneRow.sourceKey] = oneRow;
	});
	const offeredTokenSet = new Set(rules.offeredBundleList.map((oneRow) => oneRow.bundleToken));
	const layerTokenSet = new Set([].concat(...rules.offeredBundleList.map((oneRow) => oneRow.layerTokenList)));
	// every token the golden round-tripped must be offered (a standard) or carried by one (a layer): never quietly omitted
	declaredTokenList
		.filter((oneToken) => !offeredTokenSet.has(oneToken) && !layerTokenSet.has(oneToken))
		.forEach((oneToken) => faultList.push(`the golden declares round-trip token '${oneToken}', which no offered bundle names (as a bundle or a layer) in downloadArtifactsRules.json`));
	const claimedSourceKeySet = new Set();
	const offeredStandardList = rules.offeredBundleList.map((oneRow) => {
		const resolvedBundle = resolvedBundleByToken[oneRow.bundleToken];
		if (!resolvedBundle) {
			faultList.push(`offered bundle '${oneRow.bundleToken}' was not resolved`);
			return null;
		}
		const declaration = resolvedBundle.forgeDeclaration;
		const sourceUrlRecord = sourceUrlRecordByToken[oneRow.bundleToken];
		if (!sourceUrlRecord) {
			faultList.push(`offered bundle '${oneRow.bundleToken}' has no source URL record (its standardSourceLocation was not read)`);
			return null;
		}
		const graphDefinition = definitionBySourceKey[resolvedBundle.standardName];
		const inGraph = declaredTokenList.includes(oneRow.bundleToken);
		if (inGraph && !graphDefinition) {
			faultList.push(`bundle '${oneRow.bundleToken}' is round-tripped in the golden but the golden holds no StandardDefinition with sourceKey '${resolvedBundle.standardName}'`);
			return null;
		}
		if (graphDefinition) {
			claimedSourceKeySet.add(graphDefinition.sourceKey);
			if (graphDefinition.standardFamily !== declaration.standardFamily || graphDefinition.standardKey !== declaration.standardKey) {
				faultList.push(`bundle '${oneRow.bundleToken}': the graph says family '${graphDefinition.standardFamily}' standardKey '${graphDefinition.standardKey}', its forge declaration says '${declaration.standardFamily}' '${declaration.standardKey}'`);
			}
		}
		const versionText = graphDefinition ? graphDefinition.version : oneRow.versionText;
		if (typeof versionText !== 'string' || versionText === '') {
			faultList.push(`bundle '${oneRow.bundleToken}' is not in the golden and its rule gives no versionText`);
		}
		const layerTokenList = oneRow.layerTokenList.filter((oneLayerToken) => declaredTokenList.includes(oneLayerToken));
		return {
			bundleToken: oneRow.bundleToken,
			standardKey: declaration.standardKey,
			standardName: resolvedBundle.standardName,
			family: graphDefinition ? graphDefinition.standardFamily : declaration.standardFamily,
			version: versionText,
			groupName: oneRow.groupName,
			descriptionText: oneRow.descriptionText,
			graphEmissionKind: oneRow.graphEmissionKind,
			inGraph,
			layerTokenList,
			bundleDir: resolvedBundle.bundleDir,
			snapshotDirPath: resolvedBundle.snapshotDirPath,
			sourceUrlRecord,
		};
	});
	standardDefinitionRowList
		.filter((oneRow) => !claimedSourceKeySet.has(oneRow.sourceKey))
		.forEach((oneRow) => faultList.push(`the golden holds standard '${oneRow.sourceKey}' (family ${oneRow.standardFamily}), which no offered bundle resolves to`));
	if (faultList.length) {
		return { error: `download offer: ${faultList.join('; ')}` };
	}
	return { offeredStandardList };
};

// ---------------------------------------------------------------------------------------------------------------------
// THE COMPARISON GATE — fresh verdicts against the build's
// ---------------------------------------------------------------------------------------------------------------------

// freshVerdictComparisonFor — PURE: the two stage summaries -> { comparisonRowList, disagreementList }
// A token run on one side and not the other is a disagreement; so is any compared total that differs, or a missing one.
const freshVerdictComparisonFor = ({ freshSummary, buildSummary, comparedTotalNameList }) => {
	const rowOf = (summary) => {
		const rowByToken = {};
		(summary && Array.isArray(summary.standards) ? summary.standards : []).forEach((oneRow) => {
			rowByToken[oneRow.token] = oneRow;
		});
		return rowByToken;
	};
	const freshRowByToken = rowOf(freshSummary);
	const buildRowByToken = rowOf(buildSummary);
	const tokenList = Array.from(new Set([...Object.keys(buildRowByToken), ...Object.keys(freshRowByToken)])).sort();
	const disagreementList = [];
	const comparisonRowList = tokenList.map((oneToken) => {
		const freshRow = freshRowByToken[oneToken];
		const buildRow = buildRowByToken[oneToken];
		if (!freshRow || !buildRow || freshRow.ran !== true || buildRow.ran !== true) {
			const sideText = !buildRow || buildRow.ran !== true ? 'the build did not run it' : 'the fresh run did not run it';
			disagreementList.push(`${oneToken}: ${sideText}`);
			return { token: oneToken, agrees: false, differenceList: [sideText] };
		}
		const differenceList = comparedTotalNameList
			.filter((totalName) => !Number.isFinite(freshRow[totalName]) || !Number.isFinite(buildRow[totalName]) || freshRow[totalName] !== buildRow[totalName])
			.map((totalName) => `${totalName} fresh ${freshRow[totalName]} build ${buildRow[totalName]}`);
		differenceList.forEach((oneDifference) => disagreementList.push(`${oneToken}: ${oneDifference}`));
		const totalsOf = (oneRow) => comparedTotalNameList.reduce((soFar, totalName) => ({ ...soFar, [totalName]: oneRow[totalName] }), {});
		return { token: oneToken, agrees: differenceList.length === 0, freshTotals: totalsOf(freshRow), buildTotals: totalsOf(buildRow), differenceList };
	});
	return { comparisonRowList, disagreementList };
};

// ---------------------------------------------------------------------------------------------------------------------
// THE ENTRY PLAN — two entries per offered standard, each available or not with its reason
// ---------------------------------------------------------------------------------------------------------------------

const entryPlanListFor = ({ rules, offeredStandardList }) => {
	const holdOf = (bundleToken, facet) => rules.licenceHoldList.find((oneHold) => oneHold.bundleToken === bundleToken && oneHold.facetList.includes(facet));
	const entryPlanList = [];
	offeredStandardList.forEach((oneStandard) => {
		FACET_LIST.forEach((facet) => {
			const licenceHold = holdOf(oneStandard.bundleToken, facet);
			const notInGraph = facet === FACET_GRAPH && !oneStandard.inGraph;
			const unavailableReason = notInGraph ? NOT_IN_GRAPH_REASON : licenceHold ? licenceHold.unavailableReason : '';
			entryPlanList.push({
				downloadId: downloadIdOf({ standardKey: oneStandard.standardKey, facet }),
				facet,
				available: unavailableReason === '',
				unavailableReason,
				standard: oneStandard,
			});
		});
	});
	return entryPlanList;
};

// ---------------------------------------------------------------------------------------------------------------------
// SOURCE ZIP CONTENT — the snapshot, verified
// ---------------------------------------------------------------------------------------------------------------------

const relativeFileListOf = (rootDirPath) => {
	const fileList = [];
	const walk = (dirPath) => {
		fs.readdirSync(dirPath, { withFileTypes: true })
			.sort((leftEntry, rightEntry) => (leftEntry.name < rightEntry.name ? -1 : leftEntry.name > rightEntry.name ? 1 : 0))
			.forEach((oneEntry) => {
				const entryPath = path.join(dirPath, oneEntry.name);
				if (oneEntry.isDirectory()) {
					walk(entryPath);
					return;
				}
				fileList.push(path.relative(rootDirPath, entryPath).split(path.sep).join('/'));
			});
	};
	walk(rootDirPath);
	return fileList;
};

// snapshotZipEntryListFor — every file of one snapshot directory, sorted into three kinds by rule:
//   verified   listed in SHA256SUMS (the caller has already verified each against its sum)
//   companion  named in snapshotCompanionFileNameList (provenance, the sums file itself, licences): shipped, not summed
//   excluded   named in snapshotExcludedPathList (a file or a directory prefix): left out, with its reason
// Any other file refuses the whole snapshot by name: nothing is shipped unverified by accident, nothing dropped quietly.
// -> { zipEntryList, verifiedPathList, companionPathList, excludedPathList } | { error }
const snapshotZipEntryListFor = ({ rules, snapshotDirPath, verifiedRelativePathList, zipPathPrefix }) => {
	const verifiedPathSet = new Set(verifiedRelativePathList);
	const verifiedPathList = [];
	const companionPathList = [];
	const excludedPathList = [];
	const strayPathList = [];
	relativeFileListOf(snapshotDirPath).forEach((relativePath) => {
		if (verifiedPathSet.has(relativePath)) {
			verifiedPathList.push(relativePath);
			return;
		}
		const exclusion = rules.snapshotExcludedPathList.find((oneRule) => relativePath === oneRule.relativePath || relativePath.startsWith(`${oneRule.relativePath}/`));
		if (exclusion) {
			excludedPathList.push({ relativePath, reasonText: exclusion.reasonText });
			return;
		}
		if (rules.snapshotCompanionFileNameList.includes(path.posix.basename(relativePath))) {
			companionPathList.push(relativePath);
			return;
		}
		strayPathList.push(relativePath);
	});
	const unshippedVerifiedList = verifiedRelativePathList.filter((relativePath) => !verifiedPathList.includes(relativePath));
	if (strayPathList.length || unshippedVerifiedList.length) {
		return {
			error: `snapshot ${snapshotDirPath}: ${strayPathList.length ? `file(s) neither in SHA256SUMS nor a declared companion or exclusion: ${strayPathList.join(', ')}` : ''}${strayPathList.length && unshippedVerifiedList.length ? '; ' : ''}${unshippedVerifiedList.length ? `verified file(s) not found on the walk: ${unshippedVerifiedList.join(', ')}` : ''}`,
		};
	}
	const zipEntryList = [...verifiedPathList, ...companionPathList].map((relativePath) => ({
		entryPath: `${zipPathPrefix}/${relativePath}`,
		contentBuffer: fs.readFileSync(path.join(snapshotDirPath, ...relativePath.split('/'))),
	}));
	return { zipEntryList, verifiedPathList, companionPathList, excludedPathList };
};

// verifiedSnapshotContentFor — one snapshot verified against its own SHA256SUMS by the forge framework's verifier (injected:
// sourceVerification.verifySnapshotChecksums), then sorted into zip entries by snapshotZipEntryListFor. A checksum failure
// refuses by name, naming the bundle and the snapshot. callback(err, { ...snapshotZipEntryListFor's result, sumsFileSha256 })
const verifiedSnapshotContentFor = ({ rules, bundleToken, snapshotDirPath, zipPathPrefix, verifySnapshotChecksums }, callback) => {
	verifySnapshotChecksums({ snapshotDirPath }, (verifyError, verified) => {
		if (verifyError) {
			callback(`snapshot checksum failure for '${bundleToken}' (${snapshotDirPath}): ${verifyError}`);
			return;
		}
		const zipContent = snapshotZipEntryListFor({ rules, snapshotDirPath, verifiedRelativePathList: verified.verifiedFileList, zipPathPrefix });
		if (zipContent.error) {
			callback(`snapshot of '${bundleToken}': ${zipContent.error}`);
			return;
		}
		callback('', { ...zipContent, sumsFileSha256: sha256Of(fs.readFileSync(path.join(snapshotDirPath, 'SHA256SUMS'))) });
	});
};

// ---------------------------------------------------------------------------------------------------------------------
// GRAPH ZIP CONTENT — the emission, by kind (a registry; the rules name the kind per bundle)
// ---------------------------------------------------------------------------------------------------------------------

// each reader: ({ freshTokenDirPath, verdict, statementListingText }) -> { zipEntryList, emissionNoteText } | { error }
const filesUnderAsEntryList = ({ dirPath, zipPathPrefix }) =>
	relativeFileListOf(dirPath).map((relativePath) => ({ entryPath: `${zipPathPrefix}/${relativePath}`, contentBuffer: fs.readFileSync(path.join(dirPath, ...relativePath.split('/'))) }));

const graphEmissionReaderByKind = Object.freeze({
	regeneratedXsdDirectory: ({ freshTokenDirPath, verdict }) => {
		const emissionDirPath = path.join(freshTokenDirPath, 'regeneratedXsd');
		if (!fs.existsSync(emissionDirPath)) {
			return { error: `${emissionDirPath} does not exist: the validator wrote no regenerated XSD` };
		}
		const zipEntryList = filesUnderAsEntryList({ dirPath: emissionDirPath, zipPathPrefix: 'graph' });
		const declaredFileCount = verdict.census && verdict.census.graphStats ? verdict.census.graphStats.regeneratedFileCount : undefined;
		if (zipEntryList.length !== declaredFileCount) {
			return { error: `${emissionDirPath} holds ${zipEntryList.length} file(s); the verdict's census says ${declaredFileCount} were regenerated` };
		}
		return { zipEntryList, emissionNoteText: `graph/ holds the ${zipEntryList.length} XSD file(s) the round-trip validator regenerated from the graph alone.` };
	},
	cedsRdfDirectory: ({ freshTokenDirPath }) => {
		const emissionDirPath = path.join(freshTokenDirPath, 'emitted');
		if (!fs.existsSync(emissionDirPath)) {
			return { error: `${emissionDirPath} does not exist: the validator wrote no RDF/XML` };
		}
		const zipEntryList = filesUnderAsEntryList({ dirPath: emissionDirPath, zipPathPrefix: 'graph' });
		if (zipEntryList.length === 0) {
			return { error: `${emissionDirPath} is empty: the validator wrote no RDF/XML` };
		}
		return { zipEntryList, emissionNoteText: 'graph/ holds the RDF/XML the round-trip validator compiled from the graph alone.' };
	},
	statementListing: ({ statementListingText, statementCount, verdict }) => {
		if (typeof statementListingText !== 'string') {
			return { error: 'no statement listing was emitted for this bundle' };
		}
		const graphStatementCount = verdict.census && verdict.census.statementCensus ? verdict.census.statementCensus.graphStatementCount : undefined;
		if (statementCount !== graphStatementCount) {
			return { error: `the statement listing holds ${statementCount} statement(s); the verdict's census says the graph side emitted ${graphStatementCount}` };
		}
		return {
			zipEntryList: [{ entryPath: `graph/${STATEMENT_LISTING_FILE_NAME}`, contentBuffer: Buffer.from(statementListingText, 'utf8') }],
			emissionNoteText: `graph/${STATEMENT_LISTING_FILE_NAME} is a statement listing, NOT the standard's native format: the ${statementCount} statements the round-trip validator's graph side emits from the graph, the same statements its verdict compares with the source.`,
		};
	},
});

// statementListingTextFor — PURE: a Map<statementKey, statement> -> JSON Lines, one statement per line, sorted by
// statementKey in code-unit order. Each line is {"statementKey": <the validator's own statement identifier>, "statement": <its value>}.
const statementListingTextFor = ({ statementMap }) => {
	const statementKeyList = Array.from(statementMap.keys()).sort((leftKey, rightKey) => (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0));
	return {
		statementListingText: statementKeyList.map((statementKey) => JSON.stringify({ statementKey, statement: statementMap.get(statementKey) })).join('\n') + (statementKeyList.length ? '\n' : ''),
		statementCount: statementKeyList.length,
	};
};

// the validation files of one graph zip: this run's verdict (and report), each layer's verdict, the documentation, and the
// forge's earlier certificate under a folder whose name says it is not this graph's
const validationZipEntryListFor = ({ rules, oneStandard, freshRoundTripDirPath }) => {
	const zipEntryList = [];
	const faultList = [];
	const addFile = (filePath, entryPath) => {
		if (!fs.existsSync(filePath)) {
			faultList.push(`${filePath} does not exist`);
			return;
		}
		zipEntryList.push({ entryPath, contentBuffer: fs.readFileSync(filePath) });
	};
	const freshTokenDirPath = path.join(freshRoundTripDirPath, oneStandard.bundleToken);
	addFile(path.join(freshTokenDirPath, VERDICT_FILE_NAME), `validation/thisGraph/${VERDICT_FILE_NAME}`);
	if (fs.existsSync(path.join(freshTokenDirPath, REPORT_FILE_NAME))) {
		addFile(path.join(freshTokenDirPath, REPORT_FILE_NAME), `validation/thisGraph/${REPORT_FILE_NAME}`);
	}
	oneStandard.layerTokenList.forEach((layerToken) => {
		const layerKey = layerToken.split(':')[1];
		addFile(path.join(freshRoundTripDirPath, layerToken, VERDICT_FILE_NAME), `validation/thisGraph/layers/${layerKey}/${VERDICT_FILE_NAME}`);
	});
	// the contract READMEs are optional per bundle (the release bundles carry none); which were found is reported, never implied
	const documentationFileNameList = rules.documentationFileNameList.filter((fileName) => fs.existsSync(path.join(oneStandard.bundleDir, fileName)));
	documentationFileNameList.forEach((fileName) => addFile(path.join(oneStandard.bundleDir, fileName), `validation/roundTripContract/${fileName}`));
	addFile(path.join(oneStandard.bundleDir, rules.earlierCertificationFileName), `validation/forgeEarlierCertificationRun_notThisGraph/${rules.earlierCertificationFileName}`);
	return faultList.length ? { error: `validation files for '${oneStandard.bundleToken}': ${faultList.join('; ')}` } : { zipEntryList, documentationFileNameList };
};

// ---------------------------------------------------------------------------------------------------------------------
// README_DOWNLOAD.md — generated into every zip
// ---------------------------------------------------------------------------------------------------------------------

const COMPARISON_RULE_TEXT =
	'The round trip compares the two as statement sets, not as files. When it is clean (invented 0 and lost 0), the source and the graph download are **semantically equal**: within what the round trip models, they make the same statements. That is not a claim of byte-for-byte equality: a change that alters no modelled statement cannot be seen by this comparison.';

const snapshotIdentityLineOf = ({ oneStandard, sumsFileSha256 }) => {
	const relativeSnapshotPath = path.relative(path.dirname(oneStandard.bundleDir), oneStandard.snapshotDirPath).split(path.sep).join('/');
	return `forges/${relativeSnapshotPath} (its SHA256SUMS file has sha256 \`${sumsFileSha256}\`)`;
};

// sourceUrlLineOf — PURE: the README line saying where the source came from, worded by its relation; an unrecorded address
// is said to be unrecorded, never replaced by a publisher's home page
const sourceUrlLineOf = ({ entryPlan }) => {
	const sourceUrlRecord = entryPlan.standard.sourceUrlRecord;
	const labelText = entryPlan.facet === FACET_SOURCE ? 'Where this came from' : 'Where the source came from';
	if (sourceUrlRecord.sourceUrl === null) {
		return `- ${labelText}: ${SOURCE_URL_NOT_RECORDED_TEXT}`;
	}
	const pageText = sourceUrlRecord.sourceUrlPage ? ` (linked from <${sourceUrlRecord.sourceUrlPage}>)` : '';
	const noteText = sourceUrlRecord.sourceUrlNote ? ` Note: ${sourceUrlRecord.sourceUrlNote}` : '';
	return `- ${labelText}: ${sourceUrlRecord.sourceUrlRelationText} <${sourceUrlRecord.sourceUrl}>${pageText}.${noteText}`;
};

const headerLineListOf = ({ entryPlan, graphName, graphContractSha256, generatedAt, snapshotIdentityLine }) => {
	const oneStandard = entryPlan.standard;
	return [
		`# ${oneStandard.standardName} — ${entryPlan.facet === FACET_SOURCE ? 'source, as the forge ingested it' : 'written back out of the graph'}`,
		'',
		`${oneStandard.descriptionText}. Family ${oneStandard.family}, group ${oneStandard.groupName}, version ${oneStandard.version}, standardKey \`${oneStandard.standardKey}\`.`,
		'',
		`- Graph: \`${graphName}\``,
		`- Graph contract sha256: \`${graphContractSha256}\``,
		`- Generated: ${generatedAt}`,
		`- Source snapshot: ${snapshotIdentityLine}`,
		sourceUrlLineOf({ entryPlan }),
		'',
	];
};

const sourceReadmeTextFor = ({ entryPlan, graphName, graphContractSha256, generatedAt, snapshotIdentityLine, snapshotReportList, semanticValidationLimit }) => {
	const lineList = headerLineListOf({ entryPlan, graphName, graphContractSha256, generatedAt, snapshotIdentityLine });
	lineList.push('## What this zip is', '');
	lineList.push('The source of this standard exactly as educoreForge\'s forge ingested it: the bytes of the pinned snapshot, unaltered. Before packaging, every file listed in the snapshot\'s own `SHA256SUMS` was checked against its sum; a mismatch would have stopped the packaging.', '');
	snapshotReportList.forEach((oneReport) => {
		lineList.push(`### \`${oneReport.zipPathPrefix}/\` — ${oneReport.titleText}`, '');
		lineList.push(`- ${oneReport.verifiedPathList.length} file(s) checked against \`SHA256SUMS\`.`);
		lineList.push(`- Shipped beside them, not covered by the sums: ${oneReport.companionPathList.length ? oneReport.companionPathList.map((oneName) => `\`${oneName}\``).join(', ') : 'none'}.`);
		if (oneReport.excludedPathList.length) {
			const reasonByText = {};
			oneReport.excludedPathList.forEach((oneExcluded) => {
				reasonByText[oneExcluded.reasonText] = (reasonByText[oneExcluded.reasonText] || []).concat(oneExcluded.relativePath);
			});
			Object.keys(reasonByText).forEach((reasonText) => lineList.push(`- Left out: ${reasonByText[reasonText].map((oneName) => `\`${oneName}\``).join(', ')} (${reasonText}).`));
		}
		lineList.push('');
	});
	lineList.push('## Comparing it with the graph', '');
	if (entryPlan.standard.inGraph) {
		lineList.push(`The graph download for this standard holds the standard written back out of \`${graphName}\`, with the validation files. ${COMPARISON_RULE_TEXT}`, '');
		lineList.push('What the round trip models, in its own words (its `semanticValidationLimit`):', '', `> ${semanticValidationLimit}`, '');
	} else {
		lineList.push(`\`${graphName}\` does not hold this standard, so there is no graph download to compare it with.`, '');
	}
	return lineList.join('\n');
};

const graphReadmeTextFor = ({ entryPlan, graphName, graphContractSha256, generatedAt, snapshotIdentityLine, verdict, layerVerdictList, emissionNoteText, documentationFileNameList, rules }) => {
	const lineList = headerLineListOf({ entryPlan, graphName, graphContractSha256, generatedAt, snapshotIdentityLine });
	lineList.push('## What this zip is', '');
	lineList.push(`This standard written back out of the graph \`${graphName}\` by its own round-trip validator, which reads only the graph, together with the files that judge the result.`, '');
	lineList.push(`- ${emissionNoteText}`);
	lineList.push(`- \`validation/thisGraph/${VERDICT_FILE_NAME}\` is the verdict of the round trip run against this graph when this zip was generated. Its totals: invented ${verdict.inventedTotal}, lost ${verdict.lostTotal}, content gaps ${verdict.contentGapTotal}, explicitly omitted ${verdict.explicitlyOmittedTotal}, roundTripClean ${verdict.roundTripClean}.`);
	if (layerVerdictList.length) {
		lineList.push(`- \`validation/thisGraph/layers/\` holds the verdicts of the layers built on this standard in the same graph: ${layerVerdictList.map((oneLayer) => `${oneLayer.layerKey} (invented ${oneLayer.verdict.inventedTotal}, lost ${oneLayer.verdict.lostTotal})`).join(', ')}. A layer has no download of its own.`);
	}
	lineList.push(`- \`validation/forgeEarlierCertificationRun_notThisGraph/${rules.earlierCertificationFileName}\` is the forge's certificate from an EARLIER certification run, against the graph that certificate names. It is not about \`${graphName}\`; it is included so the two can be read side by side.`);
	lineList.push(documentationFileNameList.length
		? `- \`validation/roundTripContract/\` holds ${documentationFileNameList.map((fileName) => `\`${fileName}\``).join(' and ')}: what this bundle's round trip may and may not be taken to mean.`
		: `- This bundle carries no round-trip contract or known-issues README of its own (none of ${rules.documentationFileNameList.map((fileName) => `\`${fileName}\``).join(', ')}); the verdict's \`semanticValidationLimit\`, quoted below, is its statement of what the round trip models.`);
	lineList.push(`- Fields of the verdict that describe the run itself, not the graph, and so differ between runs: ${rules.verdictRunMeasurementList.map((oneField) => `\`${oneField.fieldPath}\` (${oneField.reasonText})`).join('; ')}. ${rules.verdictLocalPathNoteText}`);
	lineList.push('');
	lineList.push('## Comparing it with the source', '');
	lineList.push(`${COMPARISON_RULE_TEXT}`, '');
	lineList.push('What the round trip models, in its own words (its `semanticValidationLimit`):', '', `> ${verdict.semanticValidationLimit}`, '');
	return lineList.join('\n');
};

// ---------------------------------------------------------------------------------------------------------------------
// THE MANIFEST
// ---------------------------------------------------------------------------------------------------------------------

// manifestFor — PURE: the stamp and the finished entries -> the downloads.json object, entries sorted by downloadId
const manifestFor = ({ graphName, graphContractSha256, generatedAt, entryList }) => ({
	manifestFormat: MANIFEST_FORMAT,
	graphName,
	graphContractSha256,
	generatedAt,
	entryList: entryList.slice().sort((leftEntry, rightEntry) => (leftEntry.downloadId < rightEntry.downloadId ? -1 : leftEntry.downloadId > rightEntry.downloadId ? 1 : 0)),
});

// manifestEntryFor — PURE: one planned entry plus what packaging produced (zipBuffer absent when unavailable)
const manifestEntryFor = ({ entryPlan, zipBuffer, verdict }) => {
	const oneStandard = entryPlan.standard;
	const roundTripTotals = entryPlan.facet === FACET_GRAPH && verdict
		? { inventedTotal: verdict.inventedTotal, lostTotal: verdict.lostTotal, contentGapTotal: verdict.contentGapTotal, explicitlyOmittedTotal: verdict.explicitlyOmittedTotal, roundTripClean: verdict.roundTripClean }
		: null;
	return {
		downloadId: entryPlan.downloadId,
		family: oneStandard.family,
		group: oneStandard.groupName,
		standardKey: oneStandard.standardKey,
		standardName: oneStandard.standardName,
		version: oneStandard.version,
		facet: entryPlan.facet,
		fileName: entryPlan.available ? zipFileNameOf({ standardKey: oneStandard.standardKey, facet: entryPlan.facet }) : null,
		byteSize: entryPlan.available ? zipBuffer.length : null,
		sha256: entryPlan.available ? sha256Of(zipBuffer) : null,
		roundTrip: roundTripTotals,
		description: `${entryPlan.facet === FACET_SOURCE ? 'Source as ingested' : 'Written back out of the graph, with validation files'}: ${oneStandard.descriptionText}`,
		available: entryPlan.available,
		unavailableReason: entryPlan.available ? null : entryPlan.unavailableReason,
		...ENTRY_SOURCE_URL_FIELD_NAME_LIST.reduce((soFar, fieldName) => ({ ...soFar, [fieldName]: oneStandard.sourceUrlRecord[fieldName] }), {}),
	};
};

module.exports = {
	rulesFaultOf,
	offeredStandardListFor,
	freshVerdictComparisonFor,
	entryPlanListFor,
	snapshotZipEntryListFor,
	verifiedSnapshotContentFor,
	graphEmissionReaderByKind,
	statementListingTextFor,
	validationZipEntryListFor,
	sourceReadmeTextFor,
	graphReadmeTextFor,
	snapshotIdentityLineOf,
	sourceUrlLineOf,
	manifestFor,
	manifestEntryFor,
	parsedJsonFileOf,
	sha256Of,
	zipFileNameOf,
	FACET_SOURCE,
	FACET_GRAPH,
	MANIFEST_FILE_NAME,
	DOWNLOAD_README_FILE_NAME,
	VERDICT_FILE_NAME,
	NOT_IN_GRAPH_REASON,
	MANIFEST_FORMAT,
	ENTRY_SOURCE_URL_FIELD_NAME_LIST,
};
