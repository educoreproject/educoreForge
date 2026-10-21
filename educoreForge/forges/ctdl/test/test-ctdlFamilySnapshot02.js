#!/usr/bin/env node
'use strict';

// test-ctdlFamilySnapshot02.js — ⟪ctdlHub-101926 P10⟫ the version-follow to snapshot 02 for all three CTDL-family bundles,
// Docker-free. Snapshot 01 keeps its own suites (test-ctdlForge, test-ctdlasnForge, test-ctdlqdataForge: the July oracle's
// counts); there is no oracle for 02, so its expectation table below is the MEASURED forge of each 02 snapshot, written down
// so that any later drift in source bytes, profile or forge is seen. The release each snapshot carries is the label
// Credential Engine STATES on credreg.net (CHANGES-ctdlFamily-01to02-102126.md; README_PROVENANCE.md in each 02/).
//
// What it pins, per bundle: defaultSnapshot is 02 (the deliberate move, R1 "nothing switches silently"); the source bytes;
// the forged counts; the round trip CLEAN with nothing explicitly omitted, and observed RED on two perturbations. For CTDL
// also: the two new native concept schemes keep their concepts (format: and pathwayType: are CTDL's own prefixes), the
// undefined ceterms:WorkbasedLearningCertificate is CARRIED as crossRefs (E11, a source defect reported by name, never
// dropped and never repaired), and each declared bridge names the snapshot it reads.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the CTDL family on snapshot 02: pin, counts, round trip and its twins (no Docker)

SYNOPSIS
     node forges/ctdl/test/${moduleName}.js [-verbose] [-help]

DESCRIPTION
     Forges forges/{ctdl,ctdlasn,ctdlqdata}/assets/standardSourceData/02 in process (no embedding), asserts the measured
     expectation table, runs each bundle's round-trip validator over the harness graph double, and observes it RED on two
     perturbations. Writes only under os.tmpdir().

EXIT STATUS
     0 every assertion passed;  1 otherwise.
`;

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const harness = require(path.join(TREE_ROOT, 'test', 'testLib', 'harness'))(moduleName);
const roundTripHarness = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'roundTripHarness', 'roundTripHarness'))();
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const SNAPSHOT_KEY = '02';
const UNDEFINED_NATIVE_CLASS_ID = 'ceterms:WorkbasedLearningCertificate';

// MEASURED 2026-10-21 (INDIGO_CASCADE) from the in-process forge of each 02 snapshot; see the file header
const EXPECTATION_LIST = Object.freeze([
	{
		bundleToken: 'ctdl',
		entryFileName: 'forgeCtdl',
		sourceFileName: 'ctdl-schema.json',
		sourceSha256: 'bf5dd4b5c975c898fc0d67f173a91c340b263fbd4f928c6eff17e0ea298158b9',
		rootVersionText: 'Release 20260927|Release 20260927|provenance-file',
		nodeCountByRole: { DmeStandardRoot: 1, DmeClass: 137, DmeProperty: 397, DmeOptionSet: 36, DmeOptionValue: 457 },
		edgeCountByType: { HAS_CLASS: 137, SUBCLASS_OF: 82, HAS_PROPERTY: 7470, HAS_OPTION_SET: 43, REFERENCES: 2528, SUBPROPERTY_OF: 40, INVERSE_OF: 14, HAS_VALUE: 457, BROADER_CONCEPT: 98, TOP_CONCEPT_OF: 359 },
		statByName: { crossRefTotal: 872, declaredCorrespondenceTotal: 53, duplicateEdgeSuppressedCount: 2242, unresolvedNativePrefixReferenceCount: 160 },
		foreignTermEntryCount: 41,
		twinEdgeType: 'HAS_PROPERTY',
		// the new native schemes and their concepts' prefixes (profile nativePrefixList, P10)
		hasValueCountByScheme: { 'ceterms:Format': 1, 'ceterms:PathwayType': 4 },
		// 140 source references: 139 from native terms (carried here), 1 from the foreign elm:additionalNote (carried on the root)
		undefinedNativeCrossRefCountByLocator: { 'schema:domainIncludes': 101, 'schema:rangeIncludes': 38 },
		declaredBridgeList: [{ bridgeModulePath: 'forges/ctdl/bridges/ctdlCedsDeclaredCorrespondence.js', releaseText: 'Release 20260927' }],
	},
	{
		bundleToken: 'ctdlasn',
		entryFileName: 'forgeCtdlasn',
		sourceFileName: 'ctdlasn.json',
		sourceSha256: '2cdfee336e4842be92f228b97759719142f597be28afcf71b9de8310f852f3c0',
		rootVersionText: '20260626|20260626|provenance-file',
		nodeCountByRole: { DmeStandardRoot: 1, DmeClass: 11, DmeProperty: 97, DmeOptionSet: 2, DmeOptionValue: 8 },
		edgeCountByType: { HAS_CLASS: 11, SUBCLASS_OF: 2, HAS_PROPERTY: 203, REFERENCES: 54, SUBPROPERTY_OF: 10, HAS_OPTION_SET: 2, INVERSE_OF: 2, HAS_VALUE: 8, TOP_CONCEPT_OF: 8 },
		statByName: { crossRefTotal: 446, declaredCorrespondenceTotal: 0, duplicateEdgeSuppressedCount: 0, unresolvedNativePrefixReferenceCount: 35 },
		foreignTermEntryCount: 40,
		twinEdgeType: 'HAS_PROPERTY',
		hasValueCountByScheme: {},
		undefinedNativeCrossRefCountByLocator: {},
		declaredBridgeList: [{ bridgeModulePath: 'forges/ctdlasn/bridges/ctdlasnCtdlDeclaredCorrespondence.js', releaseText: '20260626' }],
	},
	{
		bundleToken: 'ctdlqdata',
		entryFileName: 'forgeCtdlqdata',
		sourceFileName: 'qdata.json',
		sourceSha256: '185dd4341efd61e203167d8038230f312abd005d36609d14ed3d5903e03c1cd0',
		rootVersionText: '20260626|20260626|provenance-file',
		nodeCountByRole: { DmeStandardRoot: 1, DmeClass: 11, DmeProperty: 82, DmeOptionSet: 8, DmeOptionValue: 113 },
		edgeCountByType: { HAS_CLASS: 11, HAS_PROPERTY: 108, REFERENCES: 37, SUBPROPERTY_OF: 2, HAS_VALUE: 113, TOP_CONCEPT_OF: 61, RELATED_CONCEPT: 10, BROADER_CONCEPT: 52, HAS_OPTION_SET: 8 },
		statByName: { crossRefTotal: 191, declaredCorrespondenceTotal: 0, duplicateEdgeSuppressedCount: 0, unresolvedNativePrefixReferenceCount: 13 },
		foreignTermEntryCount: 50,
		twinEdgeType: 'HAS_PROPERTY',
		hasValueCountByScheme: {},
		undefinedNativeCrossRefCountByLocator: {},
		declaredBridgeList: [],
	},
]);

const countBy = (itemList, nameOf) => itemList.reduce((counts, oneItem) => ({ ...counts, [nameOf(oneItem)]: (counts[nameOf(oneItem)] || 0) + 1 }), {});
const sortedText = (counts) => JSON.stringify(counts, Object.keys(counts).sort());
const descriptorValueOf = (bundleDirPath, valueName) => {
	const valueMatch = fs.readFileSync(path.join(bundleDirPath, 'parserDescriptor.ini'), 'utf8').match(new RegExp(`^${valueName}=(.*)$`, 'm'));
	return valueMatch ? valueMatch[1].trim() : null;
};
const crossRefListOf = (forgeResult) => forgeResult.nodes.flatMap((oneNode) => JSON.parse(oneNode.properties.crossRefs));
const withoutOneEdge = (forgeResult, expected) => ({ ...forgeResult, edges: forgeResult.edges.filter((oneEdge) => oneEdge !== forgeResult.edges.find((candidate) => candidate.type === expected.twinEdgeType && candidate.role !== 'DmeStandardRoot' && !/:root$/.test(candidate.fromRef.id))) });
// the dropped crossRef is one no other property also carries (a datatype range is held twice: crossRefs and rangeDatatypeList)
const withoutOneCrossRef = (forgeResult) => {
	const nodeList = forgeResult.nodes.map((oneNode) => ({ ...oneNode, properties: { ...oneNode.properties } }));
	const isSoleCarrier = (oneNode, oneCrossRef) => [].concat(oneNode.properties.rangeDatatypeList || []).indexOf(oneCrossRef.raw) === -1;
	const targetNode = nodeList.find((oneNode) => JSON.parse(oneNode.properties.crossRefs).some((oneCrossRef) => isSoleCarrier(oneNode, oneCrossRef)));
	const crossRefList = JSON.parse(targetNode.properties.crossRefs);
	const droppedIndex = crossRefList.findIndex((oneCrossRef) => isSoleCarrier(targetNode, oneCrossRef));
	targetNode.properties.crossRefs = JSON.stringify(crossRefList.filter((oneCrossRef, crossRefIndex) => crossRefIndex !== droppedIndex));
	return { ...forgeResult, nodes: nodeList };
};

const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), `${moduleName}-`));
const taskList = new taskListPlus();

EXPECTATION_LIST.forEach((expected) => {
	const bundleDirPath = path.join(TREE_ROOT, 'forges', expected.bundleToken);
	const snapshotDirPath = path.join(bundleDirPath, 'assets', 'standardSourceData', SNAPSHOT_KEY);
	const validator = require(path.join(bundleDirPath, 'roundTripValidator'));
	const validateDouble = ({ forgeResult, caseName }, callback) => {
		const outputPath = path.join(scratchRootPath, expected.bundleToken, caseName);
		fs.mkdirSync(outputPath, { recursive: true });
		validator.validateWithReader({ reader: roundTripHarness.graphDoubleFrom({ forgeResult }), snapshotPath: snapshotDirPath, outputPath }, callback);
	};

	taskList.push((args, next) => {
		harness.section(`${expected.bundleToken} — snapshot ${SNAPSHOT_KEY}: the pin and the bytes`);
		harness.equal(`${expected.bundleToken}: parserDescriptor defaultSnapshot is ${SNAPSHOT_KEY} (the deliberate move)`, descriptorValueOf(bundleDirPath, 'defaultSnapshot'), SNAPSHOT_KEY);
		const sourceFilePath = path.join(snapshotDirPath, expected.sourceFileName);
		harness.equal(`${expected.bundleToken}: source bytes sha256`, crypto.createHash('sha256').update(fs.readFileSync(sourceFilePath)).digest('hex'), expected.sourceSha256);
		harness.ok(`${expected.bundleToken}: README_PROVENANCE.md is beside the bytes`, fs.existsSync(path.join(snapshotDirPath, 'README_PROVENANCE.md')));
		expected.declaredBridgeList.forEach((oneBridge) => {
			const assertedBy = require(path.join(TREE_ROOT, oneBridge.bridgeModulePath)).bridgeDeclaration.predicateSource.assertedBy;
			harness.ok(`${oneBridge.bridgeModulePath}: assertedBy names the snapshot it reads (${oneBridge.releaseText}, standardSourceData/${SNAPSHOT_KEY}/)`, assertedBy.documentName.indexOf(oneBridge.releaseText) !== -1 && assertedBy.documentName.indexOf(`standardSourceData/${SNAPSHOT_KEY}/`) !== -1, assertedBy.documentName);
		});
		next('', args);
	});

	taskList.push((args, next) => require(path.join(bundleDirPath, expected.entryFileName))({ embedder: null }).forge({ sourcePath: path.join(snapshotDirPath, expected.sourceFileName), owner: moduleName, skipEmbedding: true }, (forgeError, forgeResult) => {
		harness.section(`${expected.bundleToken} — snapshot ${SNAPSHOT_KEY} forged in process`);
		harness.accepts(`${expected.bundleToken}: the snapshot forges`, forgeError ? [forgeError] : []);
		if (forgeError) {
			next(forgeError, args);
			return;
		}
		harness.equal(`${expected.bundleToken}: node count by role`, sortedText(countBy(forgeResult.nodes, (oneNode) => oneNode.role)), sortedText(expected.nodeCountByRole));
		harness.equal(`${expected.bundleToken}: edge count by type`, sortedText(countBy(forgeResult.edges, (oneEdge) => oneEdge.type)), sortedText(expected.edgeCountByType));
		Object.keys(expected.statByName).forEach((statName) => harness.equal(`${expected.bundleToken}: stats.${statName}`, forgeResult.stats[statName], expected.statByName[statName]));
		const rootNode = forgeResult.nodes.find((oneNode) => oneNode.role === 'DmeStandardRoot');
		harness.equal(`${expected.bundleToken}: root version|publishedVersion|versionSource`, `${rootNode.properties.version}|${rootNode.properties.publishedVersion}|${rootNode.properties.versionSource}`, expected.rootVersionText);
		harness.equal(`${expected.bundleToken}: root foreignTermEntryList (A5)`, JSON.parse(rootNode.properties.foreignTermEntryList).length, expected.foreignTermEntryCount);
		const hasValueCountByScheme = countBy(forgeResult.edges.filter((oneEdge) => oneEdge.type === 'HAS_VALUE' && expected.hasValueCountByScheme[oneEdge.fromRef.id] !== undefined), (oneEdge) => oneEdge.fromRef.id);
		harness.equal(`${expected.bundleToken}: the new native concept schemes keep their concepts`, sortedText(hasValueCountByScheme), sortedText(expected.hasValueCountByScheme));
		const undefinedNativeCrossRefList = crossRefListOf(forgeResult).filter((oneCrossRef) => oneCrossRef.raw === UNDEFINED_NATIVE_CLASS_ID);
		harness.equal(`${expected.bundleToken}: ${UNDEFINED_NATIVE_CLASS_ID} carried as crossRefs by locator (E11; a source defect, never dropped)`, sortedText(countBy(undefinedNativeCrossRefList, (oneCrossRef) => oneCrossRef.locator)), sortedText(expected.undefinedNativeCrossRefCountByLocator));
		next('', { ...args, forgeResult });
	}));

	taskList.push((args, next) => validateDouble({ forgeResult: args.forgeResult, caseName: 'real' }, (validateError, verdict) => {
		harness.accepts(`${expected.bundleToken}: the validator runs`, validateError ? [validateError] : []);
		if (validateError) {
			next(validateError, args);
			return;
		}
		harness.equal(`${expected.bundleToken}: inventedTotal 0, lostTotal 0, roundTripClean`, `${verdict.inventedTotal}|${verdict.lostTotal}|${verdict.roundTripClean}`, '0|0|true');
		harness.equal(`${expected.bundleToken}: nothing explicitly omitted`, verdict.explicitlyOmittedList.length, 0);
		next('', args);
	}));

	[
		{ twinName: 'a structural edge dropped from the graph', caseName: 'twinEdge', perturb: (forgeResult) => withoutOneEdge(forgeResult, expected) },
		{ twinName: 'one crossRef dropped from the graph', caseName: 'twinCrossRef', perturb: withoutOneCrossRef },
	].forEach((oneTwin) => taskList.push((args, next) => validateDouble({ forgeResult: oneTwin.perturb(args.forgeResult), caseName: oneTwin.caseName }, (validateError, verdict) => {
		harness.ok(`${expected.bundleToken}: RED-OBSERVED: ${oneTwin.twinName} → lost ${verdict && verdict.lostTotal}`, !validateError && verdict.lostTotal >= 1 && verdict.roundTripClean === false, validateError);
		next('', args);
	})));
});

pipeRunner(taskList.getList(), {}, (pipeError) => {
	if (pipeError) {
		harness.ok('the suite ran to the end', false, pipeError);
	}
	fs.rmSync(scratchRootPath, { recursive: true, force: true });
	harness.report();
});
