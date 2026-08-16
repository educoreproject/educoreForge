#!/usr/bin/env node
'use strict';

// runEdfiPreMigrationProbes.js — the SPEC-forgeFramework-v1.md §8.4 pre-migration probes for the
// Ed-Fi forge (F3b's FIRST act, STANDDOWN-F2-panel ruling 4; BRIEF-F3b step 1). Runs the forge
// named by --forgeEntryPath (default: this bundle's forgeEdfi.js) over the pinned snapshot 04 with
// skipEmbedding, then measures over the PURE output:
//
//   #1  collision census (framework census.collisionCensus)          → expectedCensus.json
//   PROXY pure-layer fingerprint (framework fingerprint)              → expectedFingerprints.json
//   #4  _source literal vs the descriptor's standardName
//   #5  searchText element census per role (count + sha256 of the sorted texts + first examples)
//   #6  locale — this runner reports process.env.LC_ALL; the shell runs it twice (C / en_US.UTF-8)
//       and compares the fingerprints
//   #9  whitespace stableIds and stableIds failing the REAL predicate (^edfi:[A-Za-z]+(/.+)?$ + trim)
//   #10 typeof name AT MINT — observed through an in-memory double of forgeEdfiContractGraph.js that
//       records what makeNode was HANDED before its `${name}` templating (moduleDouble; nothing written)
//   ''  name / description at mint (FA4) and post-mint '' / 'undefined' / 'null' string names
//   mergeDirectives — the REAL key order of every directive object (G-JSONKEYS shape only in F3a)
//   describeSource values — metadata as the forge reports it (version, sourceFiles, sourceUrl…),
//       and each sourceFiles entry classified: verified file (in SHA256SUMS) / loader logical name
//   embed order — the first N stableIds in emission order (what embedNodeLimit slices)
//   FA5/E8 — sourceFiles vs the SHA256SUMS list
//   FROZEN COMPARISON — when lib/forge-framework/test/acceptance/expectedCensus.json /
//       expectedFingerprints.json carry a non-null edfi value, the run reports EQUAL or DIFFERS by
//       name and exits 1 on DIFFERS (the fleet-free G-CENSUS / G-ID-CHEAP PROXY check for Ed-Fi:
//       one-machine-only, licence-gated — SPEC §9.3, §10.2)
//
// Writes <outputDirPath>/probeResults.json and prints the summary. Touches Docker, the network and
// no embedding provider NOT AT ALL; reads the licence-gated MetaEd bytes (ONE-MACHINE-ONLY).
//
// Run: node forges/edfi/test/runEdfiPreMigrationProbes.js --outputDirPath=<abs dir> [--forgeEntryPath=<abs>] [--embedOrderSampleCount=5]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- SPEC §8.4 pre-migration probes over the Ed-Fi forge's pure output

SYNOPSIS
     ${moduleName} --outputDirPath=<abs dir> [--forgeEntryPath=<abs path>] [--embedOrderSampleCount=N] [-help]

DESCRIPTION
     Runs the forge (skipEmbedding) over snapshot 04 and measures collision census, PROXY
     fingerprint, searchText census, whitespace stableIds, typeof name at mint, mergeDirectives
     key order, describeSource values and the sourceFiles/SHA256SUMS classification. Writes
     probeResults.json under --outputDirPath (never into the tree).

EXIT
     0 probes ran and were written;  1 refused or the forge failed.
`;

const commandLineParameters = require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const { xLog } = process.global;

const moduleDouble = require('../../../lib/forge-framework/test/testSupport/moduleDouble');
const forgeFramework = require('../../../lib/forge-framework/forge-framework')({ embedder: null });
const expectedCensus = require('../../../lib/forge-framework/test/acceptance/expectedCensus.json');
const expectedFingerprints = require('../../../lib/forge-framework/test/acceptance/expectedFingerprints.json');
const expectedAllowanceCounts = require('../../../lib/forge-framework/test/acceptance/expectedAllowanceCounts.json');

const BUNDLE_DIR_PATH = path.join(__dirname, '..');
const SNAPSHOT_PATH = path.join(BUNDLE_DIR_PATH, 'assets', 'standardSourceData', '04');
const DESCRIPTOR_PATH = path.join(BUNDLE_DIR_PATH, 'parserDescriptor.ini');
const CONTRACT_GRAPH_PATH = path.join(BUNDLE_DIR_PATH, 'lib', 'forgeEdfiContractGraph.js');
const EDFI_STABLE_ID_RE = /^edfi:[A-Za-z]+(\/.+)?$/;
const MINT_RECORDER_NAME = '__edfiMintProbeRecorder';

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// -----------------------------------------------------------------
// arguments — refused by name
// -----------------------------------------------------------------
const outputDirPath = commandLineParameters.values.outputDirPath && commandLineParameters.values.outputDirPath[0];
if (typeof outputDirPath !== 'string' || !path.isAbsolute(outputDirPath)) {
	xLog.error(`${moduleName} REFUSED: --outputDirPath must be an ABSOLUTE directory path (got ${JSON.stringify(outputDirPath)})`);
	process.exit(1);
}
const forgeEntryPath =
	(commandLineParameters.values.forgeEntryPath && commandLineParameters.values.forgeEntryPath[0]) ||
	path.join(BUNDLE_DIR_PATH, 'forgeEdfi.js');
if (!fs.existsSync(forgeEntryPath)) {
	xLog.error(`${moduleName} REFUSED: --forgeEntryPath '${forgeEntryPath}' is not on disk`);
	process.exit(1);
}
const embedOrderSampleCountText =
	(commandLineParameters.values.embedOrderSampleCount && commandLineParameters.values.embedOrderSampleCount[0]) || '5';
const embedOrderSampleCount = Number(embedOrderSampleCountText);
if (!Number.isInteger(embedOrderSampleCount) || embedOrderSampleCount < 1) {
	xLog.error(`${moduleName} REFUSED: --embedOrderSampleCount must be a positive integer (got ${JSON.stringify(embedOrderSampleCountText)})`);
	process.exit(1);
}
if (!fs.existsSync(SNAPSHOT_PATH)) {
	xLog.error(`${moduleName} REFUSED: snapshot 04 is not on disk at ${SNAPSHOT_PATH} (licence-gated bytes; see its README_PROVENANCE.md)`);
	process.exit(1);
}

// -----------------------------------------------------------------
// the mint recorder (probe #10 + FA4): what makeNode is HANDED, before templating
// -----------------------------------------------------------------
const mintRecord = {
	mintCount: 0,
	nonStringNameCount: 0,
	nonStringNameExampleList: [],
	undefinedNameCount: 0,
	nullNameCount: 0,
	emptyStringNameCount: 0,
	emptyStringNameExampleList: [],
	emptyStringDescriptionCount: 0,
	emptyStringDescriptionExampleList: [],
};
globalThis[MINT_RECORDER_NAME] = ({ name, description, stableId }) => {
	mintRecord.mintCount += 1;
	if (name === undefined) {
		mintRecord.undefinedNameCount += 1;
	} else if (name === null) {
		mintRecord.nullNameCount += 1;
	} else if (typeof name !== 'string') {
		mintRecord.nonStringNameCount += 1;
		if (mintRecord.nonStringNameExampleList.length < 5) {
			mintRecord.nonStringNameExampleList.push({ stableId, nameType: typeof name, nameValue: name });
		}
	} else if (name === '') {
		mintRecord.emptyStringNameCount += 1;
		if (mintRecord.emptyStringNameExampleList.length < 5) {
			mintRecord.emptyStringNameExampleList.push(stableId);
		}
	}
	if (description === '') {
		mintRecord.emptyStringDescriptionCount += 1;
		if (mintRecord.emptyStringDescriptionExampleList.length < 5) {
			mintRecord.emptyStringDescriptionExampleList.push(stableId);
		}
	}
};

// the double: the CONTRACT GRAPH compiled in memory with ONE textual mutation — makeNode's
// `name: \`${name}\`` line gains a recorder call. Tree libs load for real; nothing is written. The
// entry module itself is loaded REAL (its `new require(...)()` idiom cannot compile through the
// double's require shim), so the mint record comes from a SECOND pure-layer pass over the same
// loaded inputs, and its fingerprint is asserted equal to the real run's (the double is byte-neutral).
const MINT_LINE_FIND = 'name: `${name}`,';
const MINT_LINE_REPLACE = `name: (globalThis.${MINT_RECORDER_NAME}({ name, description, stableId }), \`\${name}\`),`;
// PRE-migration the contract graph templates `name` at its own mint line and the double records what
// it was handed; POST-migration that line no longer exists (kit.makeNode mints and REFUSES a
// non-string name), so the mint pass is declared NOT APPLICABLE by name in the results — never
// silently skipped, never faked
const mintLineMatchCount = fs.readFileSync(CONTRACT_GRAPH_PATH, 'utf8').split(MINT_LINE_FIND).length - 1;
const mintProbeApplies = mintLineMatchCount === 1;
const doubledContractGraph = mintProbeApplies
	? moduleDouble.loadWithMutations({
			modulePath: CONTRACT_GRAPH_PATH,
			mutationList: [{ modulePath: CONTRACT_GRAPH_PATH, find: MINT_LINE_FIND, replace: MINT_LINE_REPLACE }],
	  })()
	: null;
const forgeEdfi = require(forgeEntryPath)({ embedder: null });
const metaEdParser = require(path.join(BUNDLE_DIR_PATH, 'lib', 'metaEdParser'))();
const descriptorCodeValueLoader = require(path.join(BUNDLE_DIR_PATH, 'lib', 'descriptorCodeValueLoader'))();
const crosswalkCarrier = require(path.join(BUNDLE_DIR_PATH, 'lib', 'crosswalkCarrier'))();

// -----------------------------------------------------------------
// the descriptor's standardName (probe #4) — the ONE ini read, by the same parser the roster uses
// -----------------------------------------------------------------
const descriptorText = fs.readFileSync(DESCRIPTOR_PATH, 'utf8');
const standardNameMatch = descriptorText.match(/^standardName=(.*)$/m);
const descriptorStandardName = standardNameMatch ? standardNameMatch[1].trim() : null;

// the SHA256SUMS list (FA5/E8)
const sha256SumsText = fs.readFileSync(path.join(SNAPSHOT_PATH, 'SHA256SUMS'), 'utf8');
const listedRelativePathList = sha256SumsText
	.split('\n')
	.map((lineText) => lineText.match(/^([0-9a-f]{64})\s+\*?(.+)$/))
	.filter(Boolean)
	.map((lineMatch) => lineMatch[2].trim());

// -----------------------------------------------------------------
// run the forge, then measure
// -----------------------------------------------------------------
xLog.status(`${moduleName}: forging ${forgeEntryPath} over ${SNAPSHOT_PATH} (skipEmbedding) under LC_ALL=${JSON.stringify(process.env.LC_ALL)}`);
forgeEdfi.forge({ sourcePath: SNAPSHOT_PATH, owner: 'probe', embedNodeLimit: undefined, skipEmbedding: true }, (forgeError, forgeResult) => {
	if (forgeError) {
		xLog.error(`${moduleName}: the forge REFUSED: ${forgeError}`);
		process.exit(1);
	}
	const { nodes, edges, metadata } = forgeResult;
	if (!mintProbeApplies) {
		measureAndWrite({ nodes, edges, metadata, forgeResult, doubledFingerprint: null });
		return;
	}
	// the SECOND pure-layer pass through the doubled contract graph — mint record only
	metaEdParser.parseMetaEdSnapshot({ snapshotPath: SNAPSHOT_PATH, xLog }, (parseError, metaEdModel) => {
		if (parseError) {
			xLog.error(`${moduleName}: metaEdParser REFUSED on the second pass: ${parseError}`);
			process.exit(1);
		}
		descriptorCodeValueLoader.loadDescriptorCodeValues({ snapshotPath: SNAPSHOT_PATH }, (loadError, descriptorCodeValues) => {
			if (loadError) {
				xLog.error(`${moduleName}: descriptorCodeValueLoader REFUSED on the second pass: ${loadError}`);
				process.exit(1);
			}
			crosswalkCarrier.loadAuthoredCrosswalk({ snapshotPath: SNAPSHOT_PATH }, (crosswalkError, authoredCrosswalk) => {
				if (crosswalkError) {
					xLog.error(`${moduleName}: crosswalkCarrier REFUSED on the second pass: ${crosswalkError}`);
					process.exit(1);
				}
				let doubledGraph;
				let doubledError = '';
				try {
					doubledGraph = doubledContractGraph.buildContractGraph({ metaEdModel, descriptorCodeValues, authoredCrosswalk, metadata });
				} catch (thrownError) {
					doubledError = thrownError.message;
				}
				if (doubledError) {
					xLog.error(`${moduleName}: the doubled contract graph REFUSED: ${doubledError}`);
					process.exit(1);
				}
				const doubledFingerprint = forgeFramework.fingerprint.pureLayerFingerprint({ nodes: doubledGraph.nodes, edges: doubledGraph.edges });
				measureAndWrite({ nodes, edges, metadata, forgeResult, doubledFingerprint });
			});
		});
	});
});

const measureAndWrite = ({ nodes, edges, metadata, forgeResult, doubledFingerprint }) => {

	// #1 collision census, PROXY fingerprint
	const collisionCensus = forgeFramework.census.collisionCensus({ nodes, edges });
	const pureLayerFingerprint = forgeFramework.fingerprint.pureLayerFingerprint({ nodes, edges });
	if (doubledFingerprint !== null && doubledFingerprint !== pureLayerFingerprint) {
		xLog.error(`${moduleName} REFUSED: the doubled contract graph's fingerprint ${doubledFingerprint} differs from the real run's ${pureLayerFingerprint} — the mint record cannot be trusted`);
		process.exit(1);
	}

	// #4 _source literal equality
	const sourceLiteralSet = new Set(nodes.map((oneNode) => oneNode.properties._source));
	const sourceLiteralProbe = {
		descriptorStandardName,
		bundleStandardSource: forgeEdfi.STANDARD_SOURCE,
		distinctNodeSourceLiteralList: Array.from(sourceLiteralSet),
		equal: sourceLiteralSet.size === 1 && sourceLiteralSet.has(descriptorStandardName) && forgeEdfi.STANDARD_SOURCE === descriptorStandardName,
	};

	// #5 searchText census per role
	const searchTextListByRole = {};
	nodes.forEach((oneNode) => {
		(searchTextListByRole[oneNode.role] = searchTextListByRole[oneNode.role] || []).push(oneNode.properties.searchText);
	});
	const searchTextCensusByRole = {};
	Object.keys(searchTextListByRole).sort().forEach((oneRole) => {
		const sortedList = searchTextListByRole[oneRole].slice().sort();
		searchTextCensusByRole[oneRole] = {
			nodeCount: sortedList.length,
			sortedSearchTextSha256: sha256Hex(sortedList.join('\n')),
			exampleList: sortedList.slice(0, 3),
			emptyOrMissingCount: sortedList.filter((oneText) => typeof oneText !== 'string' || oneText.length === 0).length,
		};
	});

	// #9 whitespace stableIds / real-predicate failures
	const whitespaceStableIdList = nodes.map((oneNode) => oneNode.stableId).filter((oneId) => /\s/.test(oneId));
	const predicateFailureList = nodes
		.map((oneNode) => oneNode.stableId)
		.filter((oneId) => typeof oneId !== 'string' || oneId.length === 0 || oneId !== oneId.trim() || !EDFI_STABLE_ID_RE.test(oneId));

	// post-mint name / description states
	const postMintNameProbe = {
		nodeCount: nodes.length,
		nonStringNameCount: nodes.filter((oneNode) => typeof oneNode.properties.name !== 'string').length,
		emptyStringNameCount: nodes.filter((oneNode) => oneNode.properties.name === '').length,
		literalUndefinedNameCount: nodes.filter((oneNode) => oneNode.properties.name === 'undefined').length,
		literalNullNameCount: nodes.filter((oneNode) => oneNode.properties.name === 'null').length,
		emptyStringDescriptionCount: nodes.filter((oneNode) => oneNode.properties.description === '').length,
		absentDescriptionCount: nodes.filter((oneNode) => oneNode.properties.description === undefined).length,
	};

	// mergeDirectives — REAL key order
	const mergeDirectiveKeyOrderCountByShape = {};
	let mergeDirectiveNodeCount = 0;
	let mergeDirectiveEntryCount = 0;
	nodes.forEach((oneNode) => {
		const mergeDirectivesText = oneNode.properties.mergeDirectives;
		if (mergeDirectivesText === undefined) {
			return;
		}
		mergeDirectiveNodeCount += 1;
		const directiveList = JSON.parse(mergeDirectivesText);
		directiveList.forEach((oneDirective) => {
			mergeDirectiveEntryCount += 1;
			const shapeText = Object.keys(oneDirective).join(',');
			mergeDirectiveKeyOrderCountByShape[shapeText] = (mergeDirectiveKeyOrderCountByShape[shapeText] || 0) + 1;
		});
	});

	// describeSource values + sourceFiles classification (FA5/E8)
	const sourceFilesClassificationList = metadata.sourceFiles.map((oneName) => ({
		name: oneName,
		verifiedFileInSha256Sums: listedRelativePathList.indexOf(oneName) !== -1,
	}));
	const describeSourceProbe = {
		version: metadata.version,
		versionSource: metadata.versionSource,
		sourceFormat: metadata.sourceFormat,
		sourceFiles: metadata.sourceFiles,
		sourceUrl: metadata.sourceUrl,
		snapshotKey: metadata.snapshotKey,
		publishedVersion: metadata.publishedVersion,
		versionIsRecipeToken: metadata.version === 'current',
		sourceFilesClassificationList,
		sha256SumsLineCount: listedRelativePathList.length,
	};

	// embed order (first N in emission order)
	const embedOrderProbe = {
		firstStableIdList: nodes.slice(0, embedOrderSampleCount).map((oneNode) => oneNode.stableId),
		nonEmbeddableRoleList: [],
	};

	// the root as emitted (the framework builds it from the declaration; every property is a byte)
	const rootNode = nodes.find((oneNode) => oneNode.stableId === 'edfi:root');
	const rootProbe = rootNode
		? { propertyNameList: Object.keys(rootNode.properties), description: rootNode.properties.description, labels: rootNode.labels }
		: null;

	const probeResults = {
		measuredAt: new Date().toISOString(),
		forgeEntryPath,
		snapshotPath: SNAPSHOT_PATH,
		lcAll: process.env.LC_ALL === undefined ? null : process.env.LC_ALL,
		nodeCount: nodes.length,
		edgeCount: edges.length,
		collisionCensus,
		pureLayerFingerprint,
		pureLayerFingerprintLabel: forgeFramework.fingerprint.PROXY_LABEL,
		doubledPassFingerprintEqual: doubledFingerprint === null ? 'not applicable (migrated: kit mints)' : doubledFingerprint === pureLayerFingerprint,
		sourceLiteralProbe,
		searchTextCensusByRole,
		whitespaceStableIdProbe: { whitespaceCount: whitespaceStableIdList.length, exampleList: whitespaceStableIdList.slice(0, 5), realPredicateFailureCount: predicateFailureList.length, realPredicateFailureExampleList: predicateFailureList.slice(0, 5) },
		mintRecord: mintProbeApplies ? mintRecord : { notApplicable: `${path.basename(CONTRACT_GRAPH_PATH)} carries no '${MINT_LINE_FIND}' mint line (matched ${mintLineMatchCount}); the kit mints and refuses a non-string / '' name (FA4)` },
		postMintNameProbe,
		mergeDirectivesProbe: { nodeCount: mergeDirectiveNodeCount, entryCount: mergeDirectiveEntryCount, keyOrderCountByShape: mergeDirectiveKeyOrderCountByShape },
		describeSourceProbe,
		embedOrderProbe,
		rootProbe,
		stats: forgeResult.stats,
	};

	// the frozen comparison (G-CENSUS / G-ID-CHEAP PROXY for edfi) — by name, never silent
	const frozenCensus = expectedCensus.byStandardKey.edfi;
	const frozenFingerprint = expectedFingerprints.byStandardKey.edfi;
	const frozenComparison = {
		census: frozenCensus === null
			? 'UNFROZEN (expectedCensus.json edfi is null)'
			: JSON.stringify([collisionCensus.duplicateStableIdCount, collisionCensus.duplicateEdgeTripleCount, collisionCensus.danglingEndpointCount]) === JSON.stringify([frozenCensus.duplicateStableIdCount, frozenCensus.duplicateEdgeTripleCount, frozenCensus.danglingEndpointCount])
				? 'EQUAL to expectedCensus.json edfi'
				: `DIFFERS from expectedCensus.json edfi ${JSON.stringify(frozenCensus)}`,
		fingerprint: frozenFingerprint === null
			? 'UNFROZEN (expectedFingerprints.json edfi is null)'
			: pureLayerFingerprint === frozenFingerprint
				? `PROXY EQUAL to expectedFingerprints.json edfi (${frozenFingerprint.slice(0, 12)}…)`
				: `PROXY DIFFERS from expectedFingerprints.json edfi ${frozenFingerprint}`,
	};
	// the LIVE compliance count from forge() itself vs the frozen count (G-CENSUS compliance half, FB3) —
	// pre-migration the seam carries no complianceReport (declared NOT APPLICABLE by name)
	const frozenAllowance = expectedAllowanceCounts.byStandardKey.edfi;
	frozenComparison.allowanceCount = forgeResult.complianceReport === undefined
		? 'not applicable (the seam result carries no complianceReport — unmigrated forge)'
		: forgeResult.complianceReport.activeAllowanceCount === frozenAllowance.frozenCount && forgeResult.complianceReport.activeAllowanceList.join(',') === frozenAllowance.frozenList.join(',')
			? `EQUAL to expectedAllowanceCounts.json edfi (${frozenAllowance.frozenCount}: ${frozenAllowance.frozenList.join(',')})`
			: `DIFFERS from expectedAllowanceCounts.json edfi: live ${forgeResult.complianceReport.activeAllowanceCount} [${forgeResult.complianceReport.activeAllowanceList.join(',')}] vs frozen ${frozenAllowance.frozenCount} [${frozenAllowance.frozenList.join(',')}]`;
	probeResults.frozenComparison = frozenComparison;
	const frozenDiffers = /DIFFERS/.test(frozenComparison.census) || /DIFFERS/.test(frozenComparison.fingerprint) || /DIFFERS/.test(frozenComparison.allowanceCount);

	fs.mkdirSync(outputDirPath, { recursive: true });
	const outputFilePath = path.join(outputDirPath, 'probeResults.json');
	fs.writeFileSync(outputFilePath, JSON.stringify(probeResults, null, 2));

	xLog.result(`nodes ${nodes.length} edges ${edges.length}`);
	xLog.result(`#1 census ${JSON.stringify(collisionCensus)}`);
	xLog.result(`PROXY fingerprint ${pureLayerFingerprint}`);
	xLog.result(`#4 _source ${JSON.stringify(sourceLiteralProbe)}`);
	xLog.result(`#9 whitespace ${JSON.stringify(probeResults.whitespaceStableIdProbe)}`);
	xLog.result(`#10 mint ${JSON.stringify(probeResults.mintRecord)}`);
	xLog.result(`post-mint names ${JSON.stringify(postMintNameProbe)}`);
	xLog.result(`mergeDirectives ${JSON.stringify(probeResults.mergeDirectivesProbe)}`);
	xLog.result(`describeSource ${JSON.stringify(describeSourceProbe)}`);
	xLog.result(`embed order ${JSON.stringify(embedOrderProbe)}`);
	xLog.result(`root ${JSON.stringify(rootProbe)}`);
	xLog.result(`frozen comparison ${JSON.stringify(frozenComparison)}`);
	xLog.result(`written ${outputFilePath}`);
	if (frozenDiffers) {
		xLog.error(`${moduleName}: the measured output DIFFERS from the frozen acceptance fixture — see frozenComparison above (G-CENSUS / G-ID-CHEAP PROXY)`);
		process.exit(1);
	}
	process.exit(0);
};
