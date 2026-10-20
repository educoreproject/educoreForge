#!/usr/bin/env node
'use strict';

// test-ctdlForge.js — the CTDL forge bundle (ctdlHub-101926 P1), Docker-free: the real snapshot forged in process, its
// round trip run over the harness's graph double, the instrument's twins observed red, and the loader's refusals
// proven on synthetic sources. The ORACLE gate (identity with the July graph) is a separate, built check:
// apps/graph-builder/tools/oracleDiff.js over a DEV build's census.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the CTDL forge bundle: real-snapshot counts, round trip and its twins, loader refusals (no Docker)

SYNOPSIS
     node forges/ctdl/test/${moduleName}.js [-verbose] [-help]

DESCRIPTION
     Forges forges/ctdl/assets/standardSourceData/01 in process (no embedding), asserts its counts and carriage rules,
     runs forges/ctdl/roundTripValidator.js over the harness graph double, perturbs that double four ways and requires
     each perturbation to show in the verdict, and forges synthetic JSON-LD sources written to os.tmpdir() (never into
     the repo) to observe each loader refusal by name. Writes only under os.tmpdir().

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
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();
const roundTripHarness = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'roundTripHarness', 'roundTripHarness'))();
const bundle = require(path.join(__dirname, '..', 'forgeCtdl'))({ embedder: null });
const validator = require(path.join(__dirname, '..', 'roundTripValidator'));

const SNAPSHOT_DIR_PATH = path.join(__dirname, '..', 'assets', 'standardSourceData', '01');
const SOURCE_FILE_PATH = path.join(SNAPSHOT_DIR_PATH, 'ctdl-schema.json');
const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ctdlForgeTest-'));

// the snapshot-01 measurements (dataStores/ctdlHub_101926/oracle/*.json, P0) — the counts this forge must reproduce
const EXPECTED = Object.freeze({
	nodeCountByRole: { DmeStandardRoot: 1, DmeClass: 136, DmeProperty: 378, DmeOptionSet: 34, DmeOptionValue: 445 },
	edgeCount: 10119,
	crossRefTotal: 562,
	declaredCorrespondenceTotal: 53,
	declaredCorrespondenceNodeTotal: 52,
	duplicateEdgeSuppressedCount: 9,
	undefinedNativeTargetCount: 21,
	foreignTermEntryCount: 20,
	explicitlyOmittedByKind: { changeHistory: 993, secondaryDescription: 265, usageNoteOffProperty: 62, undefinedNativeTarget: 21, nativeReferenceNotModelled: 942, schemeStatus: 34 },
});

const forgeSource = ({ sourceFilePath }, callback) => bundle.forge({ sourcePath: sourceFilePath, owner: 'test', skipEmbedding: true }, callback);
const validateDouble = ({ forgeResult, outputPath, snapshotPath }, callback) => {
	fs.mkdirSync(outputPath, { recursive: true });
	validator.validateWithReader({ reader: roundTripHarness.graphDoubleFrom({ forgeResult }), snapshotPath, outputPath }, callback);
};
const countOmittedByKind = (verdict) => verdict.explicitlyOmittedList.reduce((counts, oneItem) => ({ ...counts, [oneItem.kind]: (counts[oneItem.kind] || 0) + 1 }), {});
const copyOfForgeResult = (forgeResult) => ({ nodes: forgeResult.nodes.map((oneNode) => ({ ...oneNode, properties: { ...oneNode.properties } })), edges: forgeResult.edges.slice() });

// writeSyntheticSnapshot — a one-file snapshot with its SHA256SUMS and provenance, under os.tmpdir() only
const writeSyntheticSnapshot = ({ caseName, graphEntryList }) => {
	const snapshotDirPath = path.join(scratchRootPath, caseName, 'assets', 'standardSourceData', '01');
	fs.mkdirSync(snapshotDirPath, { recursive: true });
	const sourceText = JSON.stringify({ '@context': {}, '@graph': graphEntryList });
	const locationText = 'publishedVersion: Synthetic 1\nupstreamUrl: https://example.invalid/ctdl\n';
	fs.writeFileSync(path.join(snapshotDirPath, 'ctdl-schema.json'), sourceText);
	fs.writeFileSync(path.join(snapshotDirPath, 'standardSourceLocation'), locationText);
	const sha256Of = (text) => crypto.createHash('sha256').update(text).digest('hex');
	fs.writeFileSync(path.join(snapshotDirPath, 'SHA256SUMS'), `${sha256Of(sourceText)}  ctdl-schema.json\n${sha256Of(locationText)}  standardSourceLocation\n`);
	return path.join(snapshotDirPath, 'ctdl-schema.json');
};

const label = (text) => ({ 'en-US': text });
const SYNTHETIC_BASE_ENTRY_LIST = Object.freeze([
	{ '@id': 'ceterms:Thing', '@type': 'rdfs:Class', 'rdfs:label': label('Thing'), 'rdfs:comment': label('A thing.'), 'vs:term_status': 'vs:stable', 'owl:equivalentClass': ['schema:Thing'] },
	{ '@id': 'ceterms:size', '@type': 'rdf:Property', 'rdfs:label': label('Size'), 'rdfs:comment': label('Its size.'), 'schema:domainIncludes': ['ceterms:Thing'], 'schema:rangeIncludes': ['xsd:string'] },
	// an option set NO property constrains: the root anchors it (the July orphan pass; CTDL snapshot 01 has none)
	{ '@id': 'ceterms:Colour', '@type': 'skos:ConceptScheme', 'rdfs:label': label('Colour'), 'rdfs:comment': label('Colours.') },
	// a concept carrying a ceds: declaration under a predicate snapshot 01 never uses — carried verbatim, not refused
	{ '@id': 'audience:Red', '@type': 'skos:Concept', 'skos:prefLabel': label('Red'), 'skos:definition': label('Red.'), 'skos:inScheme': ['ceterms:Colour'], 'skos:exactMatch': ['ceds:000123#Red'] },
	// a concept in NO native scheme: parented to the root, its owning name the standard's
	{ '@id': 'audience:Loose', '@type': 'skos:Concept', 'skos:prefLabel': label('Loose'), 'skos:definition': label('Unschemed.'), 'skos:inScheme': ['asn:Elsewhere'] },
	{ '@id': 'ceasn:Foreign', '@type': 'rdfs:Class', 'rdfs:label': label('Foreign'), 'rdfs:comment': label('Not ours.') },
]);

const refusalCaseList = Object.freeze([
	{ caseName: 'unknownType', mutate: (entryList) => entryList.concat([{ '@id': 'ceterms:Odd', '@type': 'owl:Ontology', 'rdfs:label': label('Odd') }]), refusalPattern: /'ceterms:Odd' has @type "owl:Ontology", which the profile does not map/ },
	{ caseName: 'missingId', mutate: (entryList) => entryList.concat([{ '@type': 'rdfs:Class', 'rdfs:label': label('Anonymous') }]), refusalPattern: /@graph entry 6 has no string @id/ },
	{ caseName: 'malformedCurie', mutate: (entryList) => entryList.concat([{ '@id': 'NoColonHere', '@type': 'rdfs:Class', 'rdfs:label': label('Bad') }]), refusalPattern: /@id 'NoColonHere' is not a CURIE/ },
	{ caseName: 'unknownPredicate', mutate: (entryList) => entryList.concat([{ '@id': 'ceterms:Extra', '@type': 'rdfs:Class', 'rdfs:label': label('Extra'), 'meta:newThing': ['ceterms:Thing'] }]), refusalPattern: /native 'ceterms:Extra' carries predicate 'meta:newThing', which the profile's predicateDispositionByName does not name/ },
	{ caseName: 'noLabel', mutate: (entryList) => entryList.concat([{ '@id': 'ceterms:Nameless', '@type': 'rdfs:Class', 'rdfs:comment': label('No name.') }]), refusalPattern: /native 'ceterms:Nameless' carries no label/ },
	{ caseName: 'wrongLanguage', mutate: (entryList) => entryList.concat([{ '@id': 'ceterms:French', '@type': 'rdfs:Class', 'rdfs:label': { fr: 'Chose' } }]), refusalPattern: /native 'ceterms:French' predicate 'rdfs:label' is not a language map carrying 'en-US'/ },
	{ caseName: 'nonStringReference', mutate: (entryList) => entryList.concat([{ '@id': 'ceterms:Nested', '@type': 'rdfs:Class', 'rdfs:label': label('Nested'), 'rdfs:subClassOf': [{ '@id': 'ceterms:Thing' }] }]), refusalPattern: /native 'ceterms:Nested' predicate 'rdfs:subClassOf' is not a list of strings/ },
	{ caseName: 'duplicateNativeId', mutate: (entryList) => entryList.concat([entryList[0]]), refusalPattern: /native @id 'ceterms:Thing' is defined twice/ },
]);

const taskList = new taskListPlus();

// ------------------------------------------------------------------ 1. the real snapshot
taskList.push((args, next) => forgeSource({ sourceFilePath: SOURCE_FILE_PATH }, (forgeError, forgeResult) => {
	harness.section('SECTION 1 — snapshot 01 forged in process: the July counts, the carriage rules');
	harness.accepts('the real snapshot forges', forgeError ? [forgeError] : []);
	if (forgeError) {
		next(forgeError, args);
		return;
	}
	const nodeCountByRole = forgeResult.nodes.reduce((counts, oneNode) => ({ ...counts, [oneNode.role]: (counts[oneNode.role] || 0) + 1 }), {});
	harness.equal('node count by role = the July oracle (994)', JSON.stringify(nodeCountByRole), JSON.stringify(EXPECTED.nodeCountByRole));
	harness.equal('edge count = the oracle graph (10,119; the July forge emitted 10,128 with 9 duplicates)', forgeResult.edges.length, EXPECTED.edgeCount);
	['crossRefTotal', 'declaredCorrespondenceTotal', 'duplicateEdgeSuppressedCount', 'undefinedNativeTargetCount'].forEach((statName) => harness.equal(`stats.${statName}`, forgeResult.stats[statName], EXPECTED[statName]));
	const rootNode = forgeResult.nodes.find((oneNode) => oneNode.role === 'DmeStandardRoot');
	harness.equal('root foreignTermEntryList carries the 20 foreign entries (A5)', JSON.parse(rootNode.properties.foreignTermEntryList).length, EXPECTED.foreignTermEntryCount);
	harness.equal('root publishedVersion read from standardSourceLocation, never hard-coded', `${rootNode.properties.publishedVersion}|${rootNode.properties.versionSource}`, 'Release 20260327|provenance-file');
	harness.equal('root sourceUrl read from standardSourceLocation', rootNode.properties.sourceUrl, 'https://credreg.net/ctdl/schema/encoding/json');
	harness.equal('root standardFamily is CTDL (ruling Q5)', rootNode.properties.standardFamily, 'CTDL');
	harness.ok('no node carries the July cedsId derivation (R6)', forgeResult.nodes.every((oneNode) => oneNode.properties.cedsId === undefined && oneNode.properties.anchorForm === undefined));
	const crossRefEntryList = forgeResult.nodes.reduce((entryList, oneNode) => entryList.concat(JSON.parse(oneNode.properties.crossRefs)), []);
	harness.ok('every crossRef is exactly { raw, locator } — no ownership tag (R4)', crossRefEntryList.every((oneEntry) => JSON.stringify(Object.keys(oneEntry)) === '["raw","locator"]'));
	harness.ok('no crossRef targets the seam prefix ceds: (those are carried as declarations, A2)', crossRefEntryList.every((oneEntry) => !oneEntry.raw.startsWith('ceds:')));
	const seamCarrierList = forgeResult.nodes.filter((oneNode) => oneNode.properties.declaredCorrespondenceList !== undefined);
	harness.equal('seam declarations sit on 52 nodes (A2)', seamCarrierList.length, EXPECTED.declaredCorrespondenceNodeTotal);
	const seamPredicateCounts = seamCarrierList.reduce((counts, oneNode) => JSON.parse(oneNode.properties.declaredCorrespondenceList).reduce((innerCounts, oneEntry) => ({ ...innerCounts, [oneEntry.predicate]: (innerCounts[oneEntry.predicate] || 0) + 1 }), counts), {});
	harness.equal('seam declarations by predicate, verbatim: 26 owl:equivalentClass, 22 skos:narrowMatch, 5 skos:relatedMatch', JSON.stringify(seamPredicateCounts, Object.keys(seamPredicateCounts).sort()), JSON.stringify({ 'owl:equivalentClass': 26, 'skos:narrowMatch': 22, 'skos:relatedMatch': 5 }));
	next('', { ...args, forgeResult });
}));

// ------------------------------------------------------------------ 2. the round trip over the double
taskList.push((args, next) => validateDouble({ forgeResult: args.forgeResult, outputPath: path.join(scratchRootPath, 'roundTripReal'), snapshotPath: SNAPSHOT_DIR_PATH }, (validateError, verdict) => {
	harness.section('SECTION 2 — round trip of snapshot 01 over the graph double');
	harness.accepts('the validator runs', validateError ? [validateError] : []);
	if (validateError) {
		next(validateError, args);
		return;
	}
	harness.equal('inventedTotal 0', verdict.inventedTotal, 0);
	harness.equal('lostTotal 0', verdict.lostTotal, 0);
	harness.equal('roundTripClean', verdict.roundTripClean, true);
	harness.equal('explicitly omitted, by declared kind (ruling 2026-10-20; retired in P2b)', JSON.stringify(countOmittedByKind(verdict), Object.keys(EXPECTED.explicitlyOmittedByKind).sort()), JSON.stringify(EXPECTED.explicitlyOmittedByKind, Object.keys(EXPECTED.explicitlyOmittedByKind).sort()));
	next('', { ...args, cleanVerdict: verdict });
}));

// ------------------------------------------------------------------ 3. the instrument's twins: each perturbation must show
const twinList = [
	{
		twinName: 'a REFERENCES edge dropped from the graph',
		perturb: (forgeResult) => ({ ...forgeResult, edges: forgeResult.edges.filter((oneEdge, edgeIndex) => edgeIndex !== forgeResult.edges.findIndex((candidate) => candidate.type === 'REFERENCES')) }),
		isSeen: (verdict) => verdict.lostTotal === 1 && verdict.inventedTotal === 0,
	},
	{
		twinName: 'one description altered in the graph',
		perturb: (forgeResult) => {
			const perturbed = copyOfForgeResult(forgeResult);
			const target = perturbed.nodes.find((oneNode) => oneNode.role === 'DmeClass');
			target.properties.description = `${target.properties.description} (altered)`;
			return perturbed;
		},
		isSeen: (verdict) => verdict.lostTotal === 1 && verdict.inventedTotal === 1,
	},
	{
		twinName: 'one crossRef dropped from the graph',
		perturb: (forgeResult) => {
			const perturbed = copyOfForgeResult(forgeResult);
			const target = perturbed.nodes.find((oneNode) => JSON.parse(oneNode.properties.crossRefs).length > 0);
			target.properties.crossRefs = JSON.stringify(JSON.parse(target.properties.crossRefs).slice(1));
			return perturbed;
		},
		isSeen: (verdict) => verdict.lostTotal === 1 && verdict.inventedTotal === 0,
	},
	{
		twinName: 'one seam declaration retargeted in the graph',
		perturb: (forgeResult) => {
			const perturbed = copyOfForgeResult(forgeResult);
			const target = perturbed.nodes.find((oneNode) => oneNode.properties.declaredCorrespondenceList !== undefined);
			const seamList = JSON.parse(target.properties.declaredCorrespondenceList);
			target.properties.declaredCorrespondenceList = JSON.stringify([{ ...seamList[0], target: 'ceds:999999#Invented' }].concat(seamList.slice(1)));
			return perturbed;
		},
		isSeen: (verdict) => verdict.lostTotal === 1 && verdict.inventedTotal === 1,
	},
];
twinList.forEach((oneTwin, twinIndex) => taskList.push((args, next) => validateDouble({ forgeResult: oneTwin.perturb(args.forgeResult), outputPath: path.join(scratchRootPath, `twin${twinIndex}`), snapshotPath: SNAPSHOT_DIR_PATH }, (validateError, verdict) => {
	if (twinIndex === 0) {
		harness.section('SECTION 3 — the round-trip instrument observed RED, once per perturbation');
	}
	harness.ok(`RED-OBSERVED: ${oneTwin.twinName} → lost ${verdict && verdict.lostTotal}, invented ${verdict && verdict.inventedTotal}`, !validateError && oneTwin.isSeen(verdict) && verdict.roundTripClean === false, validateError);
	next('', args);
})));

taskList.push((args, next) => {
	const perturbed = copyOfForgeResult(args.forgeResult);
	delete perturbed.nodes.find((oneNode) => oneNode.role === 'DmeClass').properties.crossRefs;
	validateDouble({ forgeResult: perturbed, outputPath: path.join(scratchRootPath, 'twinNoCrossRefs'), snapshotPath: SNAPSHOT_DIR_PATH }, (validateError) => {
		harness.rejects('RED-OBSERVED: a graph node without crossRefs is an emission FAULT, never read as an empty list', validateError ? [validateError] : [], /carries no crossRefs/);
		next('', args);
	});
});

// ------------------------------------------------------------------ 4. synthetic: the paths snapshot 01 never exercises
taskList.push((args, next) => forgeSource({ sourceFilePath: writeSyntheticSnapshot({ caseName: 'base', graphEntryList: SYNTHETIC_BASE_ENTRY_LIST }) }, (forgeError, forgeResult) => {
	harness.section('SECTION 4 — a synthetic source: the orphan option set, the unschemed concept, an unused seam predicate');
	harness.accepts('the synthetic base forges', forgeError ? [forgeError] : []);
	if (forgeError) {
		next(forgeError, args);
		return;
	}
	const edgeTextList = forgeResult.edges.map((oneEdge) => `${oneEdge.type} ${oneEdge.fromRef.id} ${oneEdge.toRef.id}`);
	harness.ok('an option set no property constrains is anchored from the root by HAS_OPTION_SET', edgeTextList.indexOf('HAS_OPTION_SET ctdl:root ceterms:Colour') !== -1, edgeTextList.join('\n'));
	const looseNode = forgeResult.nodes.find((oneNode) => oneNode.stableId === 'audience:Loose');
	harness.equal('a concept in no native scheme is parented to the root, its path under the standard', `${looseNode.properties.parentId}|${looseNode.properties.path}`, 'ctdl:root|CTDL.Loose');
	harness.equal('its non-native scheme reference is carried verbatim', looseNode.properties.crossRefs, JSON.stringify([{ raw: 'asn:Elsewhere', locator: 'skos:inScheme' }]));
	const redNode = forgeResult.nodes.find((oneNode) => oneNode.stableId === 'audience:Red');
	harness.equal('a ceds: target under skos:exactMatch (unused by snapshot 01) is carried verbatim, never refused (R6)', redNode.properties.declaredCorrespondenceList, JSON.stringify([{ predicate: 'skos:exactMatch', target: 'ceds:000123#Red' }]));
	harness.ok('the foreign entry is no node', forgeResult.nodes.every((oneNode) => oneNode.stableId !== 'ceasn:Foreign'));
	next('', args);
}));

// ------------------------------------------------------------------ 5. the loader's refusals
refusalCaseList.forEach((oneCase, caseIndex) => taskList.push((args, next) => forgeSource({ sourceFilePath: writeSyntheticSnapshot({ caseName: oneCase.caseName, graphEntryList: oneCase.mutate(SYNTHETIC_BASE_ENTRY_LIST.slice()) }) }, (forgeError) => {
	if (caseIndex === 0) {
		harness.section('SECTION 5 — the loader refuses external data by name');
	}
	harness.rejects(`${oneCase.caseName} is refused by name`, forgeError ? [forgeError] : [], oneCase.refusalPattern);
	next('', args);
})));

pipeRunner(taskList.getList(), {}, (pipeError) => {
	if (pipeError) {
		harness.ok('the suite ran to the end', false, pipeError);
	}
	fs.rmSync(scratchRootPath, { recursive: true, force: true });
	harness.report();
});
