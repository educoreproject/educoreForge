#!/usr/bin/env node
'use strict';

// jsonLdSourceCensus.js — measure, from the JSON-LD SOURCE files (not a graph), what a standard-pure forge must carry
// rather than emit: the @graph entries outside a forge's native allowlist (plan §4.1 A5), the cross-IRI assertions a
// source declares (P6's declared-correspondence counts), and every non-native IRI a native entry references (the
// material the crossRefs allowance A1 is judged against). ctdlHub-101926 P0 step 4b.
//
// Run: node apps/graph-builder/tools/jsonLdSourceCensus.js --specFilePath=<spec.json> --outputDirectoryPath=<dir>

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- census of foreign entries, declared correspondences and non-native references in JSON-LD sources

SYNOPSIS
     ${moduleName} --specFilePath=<spec.json> --outputDirectoryPath=<dir> [-help]

DESCRIPTION
     Reads only the source files the spec names; writes three files into --outputDirectoryPath:

       A5-foreignTermCounts.json            per standard: @graph entries whose own @id prefix is NOT in the native
                                            allowlist, counted by prefix and by @type, and listed
       declaredCorrespondenceCounts.json    per standard: assertions on the spec's correspondencePredicateList whose
                                            object is a non-native IRI, by predicate and object prefix, split by
                                            whether the DECLARING entry is native or foreign
       nonNativeReferenceCensus.json        per standard: every non-native IRI a NATIVE entry references through an
                                            IRI-valued predicate (one whose value is an array of strings), by predicate
                                            and object prefix; scalar-string predicates are listed by name, not counted

     The spec (JSON) is data: { correspondencePredicateList: [...], standardList: [{ sourceName, sourceFilePath,
     nativePrefixList }] }. sourceFilePath resolves against the spec file's own directory.

EXIT STATUS
     0 written;  1 refused (missing argument, unreadable spec or source, a source without @graph, an entry without @id).

EXAMPLES
     node apps/graph-builder/tools/jsonLdSourceCensus.js --specFilePath=../../dataStores/ctdlHub_101926/oracle/sourceCensusSpec.json \\
          --outputDirectoryPath=../../dataStores/ctdlHub_101926/oracle
`;

const fs = require('fs');
const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const { xLog, commandLineParameters } = process.global;

const flagValueOf = (flagName) => {
	const flagValue = commandLineParameters.values[flagName];
	return Array.isArray(flagValue) ? flagValue[0] : flagValue;
};
const refuse = (reasonText) => {
	xLog.error(`${moduleName}: REFUSED: ${reasonText}\n(${moduleName} -help for the full page)`);
	process.exit(1);
};

const specFilePath = flagValueOf('specFilePath') && path.resolve(flagValueOf('specFilePath'));
const outputDirectoryPath = flagValueOf('outputDirectoryPath') && path.resolve(flagValueOf('outputDirectoryPath'));
if (!specFilePath || !outputDirectoryPath) {
	refuse('--specFilePath and --outputDirectoryPath are both REQUIRED and have no default');
}
if (!fs.existsSync(specFilePath) || !fs.existsSync(outputDirectoryPath)) {
	refuse(`'${fs.existsSync(specFilePath) ? outputDirectoryPath : specFilePath}' does not exist`);
}
const censusSpec = JSON.parse(fs.readFileSync(specFilePath, 'utf8'));
if (!Array.isArray(censusSpec.standardList) || !Array.isArray(censusSpec.correspondencePredicateList)) {
	refuse(`${specFilePath} must hold standardList and correspondencePredicateList arrays`);
}

const prefixOf = (curieText) => `${curieText}`.split(':')[0];
const countInto = (counts, countName) => ({ ...counts, [countName]: (counts[countName] || 0) + 1 });
const sortedCounts = (counts) => Object.keys(counts).sort().reduce((sorted, countName) => ({ ...sorted, [countName]: counts[countName] }), {});

const censusOfStandard = ({ sourceName, sourceFilePath, nativePrefixList }) => {
	const resolvedSourcePath = path.resolve(path.dirname(specFilePath), sourceFilePath);
	if (!fs.existsSync(resolvedSourcePath)) {
		refuse(`${sourceName}: source '${resolvedSourcePath}' does not exist`);
	}
	const sourceDocument = JSON.parse(fs.readFileSync(resolvedSourcePath, 'utf8'));
	if (!Array.isArray(sourceDocument['@graph'])) {
		refuse(`${sourceName}: '${resolvedSourcePath}' has no @graph array`);
	}
	const graphEntryList = sourceDocument['@graph'];
	const idlessEntryCount = graphEntryList.filter((oneEntry) => typeof oneEntry['@id'] !== 'string').length;
	if (idlessEntryCount !== 0) {
		refuse(`${sourceName}: ${idlessEntryCount} @graph entries carry no string @id`);
	}
	const isNativeIri = (iriText) => nativePrefixList.includes(prefixOf(iriText));
	const nativeEntryList = graphEntryList.filter((oneEntry) => isNativeIri(oneEntry['@id']));
	const foreignEntryList = graphEntryList.filter((oneEntry) => !isNativeIri(oneEntry['@id']));

	// an IRI-valued predicate is one whose value is an array of strings (measured true of every array predicate in
	// the ctdl-family sources; language maps are objects and so never counted)
	const iriPairListOf = (oneEntry) => Object.keys(oneEntry)
		.filter((predicateName) => Array.isArray(oneEntry[predicateName]))
		.reduce((pairList, predicateName) => [...pairList, ...oneEntry[predicateName].filter((objectValue) => typeof objectValue === 'string').map((objectIri) => ({ predicateName, objectIri }))], []);
	const scalarStringPredicateNameList = [...new Set(graphEntryList.reduce((nameList, oneEntry) => [...nameList, ...Object.keys(oneEntry).filter((predicateName) => typeof oneEntry[predicateName] === 'string')], []))].sort();

	const correspondenceCountsOf = (entryList) => entryList.reduce((counts, oneEntry) => iriPairListOf(oneEntry)
		.filter((onePair) => censusSpec.correspondencePredicateList.includes(onePair.predicateName) && !isNativeIri(onePair.objectIri))
		.reduce((innerCounts, onePair) => countInto(innerCounts, `${onePair.predicateName} -> ${prefixOf(onePair.objectIri)}:`), counts), {});
	const nonNativeReferenceCounts = nativeEntryList.reduce((counts, oneEntry) => iriPairListOf(oneEntry)
		.filter((onePair) => !isNativeIri(onePair.objectIri))
		.reduce((innerCounts, onePair) => countInto(innerCounts, `${onePair.predicateName} -> ${prefixOf(onePair.objectIri)}:`), counts), {});
	const correspondenceDeclaringEntryCount = nativeEntryList.filter((oneEntry) => iriPairListOf(oneEntry)
		.some((onePair) => censusSpec.correspondencePredicateList.includes(onePair.predicateName) && !isNativeIri(onePair.objectIri))).length;

	return {
		foreignTerms: {
			sourceName, sourceFilePath: resolvedSourcePath, nativePrefixList,
			graphEntryCount: graphEntryList.length,
			nativeEntryCount: nativeEntryList.length,
			foreignEntryCount: foreignEntryList.length,
			foreignEntryCountByPrefix: sortedCounts(foreignEntryList.reduce((counts, oneEntry) => countInto(counts, prefixOf(oneEntry['@id'])), {})),
			foreignEntryCountByType: sortedCounts(foreignEntryList.reduce((counts, oneEntry) => countInto(counts, `${oneEntry['@type']}`), {})),
			foreignEntryIdList: foreignEntryList.map((oneEntry) => oneEntry['@id']).sort(),
		},
		declaredCorrespondence: {
			sourceName,
			fromNativeEntries: sortedCounts(correspondenceCountsOf(nativeEntryList)),
			nativeDeclaringEntryCount: correspondenceDeclaringEntryCount,
			fromForeignEntries: sortedCounts(correspondenceCountsOf(foreignEntryList)),
		},
		nonNativeReferences: {
			sourceName,
			referenceCountByPredicateAndPrefix: sortedCounts(nonNativeReferenceCounts),
			referenceTotal: Object.values(nonNativeReferenceCounts).reduce((total, oneCount) => total + oneCount, 0),
			scalarStringPredicateNameList,
		},
	};
};

const censusList = censusSpec.standardList.map(censusOfStandard);
const outputFileList = [
	{ fileName: 'A5-foreignTermCounts.json', sectionName: 'foreignTerms' },
	{ fileName: 'declaredCorrespondenceCounts.json', sectionName: 'declaredCorrespondence' },
	{ fileName: 'nonNativeReferenceCensus.json', sectionName: 'nonNativeReferences' },
];
outputFileList.forEach(({ fileName, sectionName }) => {
	const outputFilePath = path.join(outputDirectoryPath, fileName);
	const bySource = censusList.reduce((byName, oneCensus) => ({ ...byName, [oneCensus[sectionName].sourceName]: oneCensus[sectionName] }), {});
	fs.writeFileSync(outputFilePath, `${JSON.stringify({ specFilePath, correspondencePredicateList: censusSpec.correspondencePredicateList, bySource }, null, 2)}\n`);
	xLog.result(`${moduleName}: wrote ${outputFilePath}\n`);
});
censusList.forEach((oneCensus) => xLog.result(`${oneCensus.foreignTerms.sourceName}: foreign entries ${oneCensus.foreignTerms.foreignEntryCount} ${JSON.stringify(oneCensus.foreignTerms.foreignEntryCountByPrefix)}; declared correspondence ${JSON.stringify(oneCensus.declaredCorrespondence.fromNativeEntries)}\n`));
