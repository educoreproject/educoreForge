#!/usr/bin/env node
'use strict';

// oracleDiff.js — judge a re-forged standard against its frozen oracle census, row by row of a DECLARED allowance
// (ctdlHub-101926 plan §4.1, rows A1-A5 plus the ratified A3 list, L1 and M1). Both inputs are census files written
// by oracleCensus.js — the oracle from the July graph, the candidate from a DEV build of the new forge — so the two
// sides are measured by the same instrument. Every difference the allowance does not name is UNEXPLAINED and fails
// the run; an allowance row whose condition is not met fails it too.
//
// Run: node apps/graph-builder/tools/oracleDiff.js --oracleCensusPath=<census.json> --candidateCensusPath=<census.json>
//          --allowanceSpecPath=<allowance.json> [--outputFilePath=<verdict.json>]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- a re-forged standard's census against its oracle census, inside a declared allowance (read-only)

SYNOPSIS
     ${moduleName} --oracleCensusPath=<json> --candidateCensusPath=<json> --allowanceSpecPath=<json> [--outputFilePath=<json>] [-help]

DESCRIPTION
     Reads three files and writes at most one (the verdict). Compares, for the one standard both censuses describe:
       nodes        identical stableId set; identical role per node; labels identical once the spec's ignored labels are
                    removed from each side (L1)
       edges        identical (type, from, to) set for intra-standard edges; identical edge properties once the spec's
                    ignoredOracleEdgePropertyList is removed from the oracle side
       properties   per node, every name and value identical EXCEPT where a row of the allowance names it:
                    A1 crossRefs     the oracle's non-seam (raw, locator) multiset is contained in the candidate's; every
                                     candidate entry is exactly { raw, locator }; the candidate's totals by (locator,
                                     prefix) equal the source census (nonNativeReferenceCensus) less the seam prefixes
                    A2 seam          the declared seam property holds expectedEntryTotal entries on expectedNodeTotal
                                     nodes, and every oracle seam-prefixed crossRef reappears as { predicate: its
                                     locator, target: its raw }
                    A3 removed/added the names the ratified list lets disappear (per role) or appear (per role)
                    A4               the embedding stamps, oracle side only, name-only
                    A5 foreign terms the root property holds exactly the source's foreign @graph entries (A5 counts file)
                    V1 values        properties whose new value is declared in the spec
                    M1 list-wrapped  properties the oracle holds as a scalar and the candidate as a one-element list
     Prints one verdict line per row and the first unexplained differences.

EXIT STATUS
     0 every row PASS and no unexplained difference;  1 otherwise, or refused (missing argument, unreadable file).

FILES
     the allowance spec is DATA in the campaign directory (one file per standard, append only); its relative paths
     resolve against its own directory

EXAMPLES
     node apps/graph-builder/tools/oracleDiff.js --oracleCensusPath=<campaign>/oracle/CTDL.census.json \\
          --candidateCensusPath=<campaign>/p1/census/CTDL.census.json --allowanceSpecPath=<campaign>/oracle/oracleAllowance.CTDL.json
`;

const fs = require('fs');
const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const { xLog, commandLineParameters } = process.global;

const PASS = 'PASS';
const FAIL = 'FAIL';
const UNEXPLAINED_SHOW_LIMIT = 25;

const flagValueOf = (flagName) => {
	const flagValue = commandLineParameters.values[flagName];
	return Array.isArray(flagValue) ? flagValue[0] : flagValue;
};
const refuse = (reasonText) => {
	xLog.error(`${moduleName}: REFUSED: ${reasonText}\n(${moduleName} -help for the full page)`);
	process.exit(1);
};
const absentFlagNameList = ['oracleCensusPath', 'candidateCensusPath', 'allowanceSpecPath'].filter((flagName) => typeof flagValueOf(flagName) !== 'string' || !fs.existsSync(flagValueOf(flagName)));
if (absentFlagNameList.length !== 0) {
	refuse(`required and absent (or not on disk): ${absentFlagNameList.map((flagName) => `--${flagName}`).join(', ')}. There are no defaults.`);
}
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const allowanceSpecPath = path.resolve(flagValueOf('allowanceSpecPath'));
const allowanceSpec = readJson(allowanceSpecPath);
const oracleCensus = readJson(flagValueOf('oracleCensusPath'));
const candidateCensus = readJson(flagValueOf('candidateCensusPath'));
const specRelative = (relativePath) => path.resolve(path.dirname(allowanceSpecPath), relativePath);
if (oracleCensus.sourceName !== allowanceSpec.standardSource || candidateCensus.sourceName !== allowanceSpec.standardSource) {
	refuse(`the spec is for '${allowanceSpec.standardSource}' but the censuses are '${oracleCensus.sourceName}' (oracle) and '${candidateCensus.sourceName}' (candidate)`);
}

const prefixOf = (iriText) => `${iriText}`.split(':')[0];
const stableText = (oneValue) => JSON.stringify(oneValue);
const countInto = (counts, countName) => ({ ...counts, [countName]: (counts[countName] || 0) + 1 });
const multisetOf = (textList) => textList.reduce(countInto, {});
const multisetMissingFrom = (smallerSet, largerSet) => Object.keys(smallerSet).filter((oneText) => (largerSet[oneText] || 0) < smallerSet[oneText]);
const listOfRole = (byRole, role) => (byRole && byRole[role]) || [];
const withoutNames = (propertyMap, nameList) => Object.keys(propertyMap).filter((oneName) => nameList.indexOf(oneName) === -1)
	.reduce((kept, oneName) => ({ ...kept, [oneName]: propertyMap[oneName] }), {});

const unexplainedList = [];
const rowEvidence = {};
const noteUnexplained = (kindText, detail) => unexplainedList.push({ kindText, ...detail });

// ---------------------------------------------------------------- nodes and labels
const oracleNodeById = oracleCensus.nodes.reduce((byId, oneNode) => ({ ...byId, [oneNode.stableId]: oneNode }), {});
const candidateNodeById = candidateCensus.nodes.reduce((byId, oneNode) => ({ ...byId, [oneNode.stableId]: oneNode }), {});
Object.keys(oracleNodeById).filter((stableId) => !candidateNodeById[stableId]).forEach((stableId) => noteUnexplained('node absent from candidate', { stableId }));
Object.keys(candidateNodeById).filter((stableId) => !oracleNodeById[stableId]).forEach((stableId) => noteUnexplained('node absent from oracle', { stableId }));
const sharedIdList = Object.keys(oracleNodeById).filter((stableId) => candidateNodeById[stableId]).sort();
sharedIdList.forEach((stableId) => {
	const oracleNode = oracleNodeById[stableId];
	const candidateNode = candidateNodeById[stableId];
	if (oracleNode.role !== candidateNode.role) {
		noteUnexplained('role differs', { stableId, oracleValue: oracleNode.role, candidateValue: candidateNode.role });
	}
	const oracleLabelText = stableText(oracleNode.labels.filter((oneLabel) => allowanceSpec.ignoredOracleLabelList.indexOf(oneLabel) === -1));
	const candidateLabelText = stableText(candidateNode.labels.filter((oneLabel) => allowanceSpec.ignoredCandidateLabelList.indexOf(oneLabel) === -1));
	if (oracleLabelText !== candidateLabelText) {
		noteUnexplained('labels differ', { stableId, oracleValue: oracleLabelText, candidateValue: candidateLabelText });
	}
});

// ---------------------------------------------------------------- edges
const edgeSignatureOf = (oneEdge) => `${oneEdge.type}|${oneEdge.from}|${oneEdge.to}`;
const oracleEdgeBySignature = oracleCensus.intraEdges.reduce((bySignature, oneEdge) => ({ ...bySignature, [edgeSignatureOf(oneEdge)]: oneEdge }), {});
const candidateEdgeBySignature = candidateCensus.intraEdges.reduce((bySignature, oneEdge) => ({ ...bySignature, [edgeSignatureOf(oneEdge)]: oneEdge }), {});
Object.keys(oracleEdgeBySignature).filter((oneSignature) => !candidateEdgeBySignature[oneSignature]).forEach((oneSignature) => noteUnexplained('edge absent from candidate', { edgeSignature: oneSignature }));
Object.keys(candidateEdgeBySignature).filter((oneSignature) => !oracleEdgeBySignature[oneSignature]).forEach((oneSignature) => noteUnexplained('edge absent from oracle', { edgeSignature: oneSignature }));
Object.keys(oracleEdgeBySignature).filter((oneSignature) => candidateEdgeBySignature[oneSignature]).forEach((oneSignature) => {
	const oracleEdgeText = stableText(withoutNames(oracleEdgeBySignature[oneSignature].properties, allowanceSpec.ignoredOracleEdgePropertyList));
	const candidateEdgeText = stableText(candidateEdgeBySignature[oneSignature].properties);
	if (oracleEdgeText !== candidateEdgeText) {
		noteUnexplained('edge properties differ', { edgeSignature: oneSignature, oracleValue: oracleEdgeText, candidateValue: candidateEdgeText });
	}
});

// ---------------------------------------------------------------- properties, row by row
const { a1, a2, a5 } = allowanceSpec;
const seamPrefixList = a1.seamPrefixList;
const isSeamRaw = (rawText) => seamPrefixList.indexOf(prefixOf(rawText)) !== -1;
const candidateCrossRefTotalsByKey = {};
let oracleSeamAnchorList = [];
let candidateSeamEntryTotal = 0;
let candidateSeamNodeTotal = 0;
const candidateSeamPairSet = new Set();
const rowNameList = [a1.crossRefsPropertyName, a2.seamPropertyName, a5.propertyName];

sharedIdList.forEach((stableId) => {
	const role = oracleNodeById[stableId].role;
	const oracleProps = withoutNames(oracleNodeById[stableId].properties, allowanceSpec.a4OracleOnlyPropertyList);
	const candidateProps = candidateNodeById[stableId].properties;

	// A1 — crossRefs
	const oracleCrossRefList = JSON.parse(oracleProps[a1.crossRefsPropertyName] || '[]');
	const candidateCrossRefList = JSON.parse(candidateProps[a1.crossRefsPropertyName] || '[]');
	candidateCrossRefList.forEach((oneCrossRef) => {
		if (stableText(Object.keys(oneCrossRef).sort()) !== stableText(['locator', 'raw'])) {
			noteUnexplained('A1 crossRef entry is not exactly { raw, locator }', { stableId, candidateValue: stableText(oneCrossRef) });
		}
		const totalsKey = `${oneCrossRef.locator} -> ${prefixOf(oneCrossRef.raw)}:`;
		candidateCrossRefTotalsByKey[totalsKey] = (candidateCrossRefTotalsByKey[totalsKey] || 0) + 1;
	});
	const oracleNonSeamPairSet = multisetOf(oracleCrossRefList.filter((oneCrossRef) => !isSeamRaw(oneCrossRef.raw)).map((oneCrossRef) => `${oneCrossRef.raw}|${oneCrossRef.locator}`));
	const candidatePairSet = multisetOf(candidateCrossRefList.map((oneCrossRef) => `${oneCrossRef.raw}|${oneCrossRef.locator}`));
	multisetMissingFrom(oracleNonSeamPairSet, candidatePairSet).forEach((oneMissing) => noteUnexplained('A1 oracle crossRef absent from candidate', { stableId, oracleValue: oneMissing }));
	oracleSeamAnchorList = oracleSeamAnchorList.concat(oracleCrossRefList.filter((oneCrossRef) => isSeamRaw(oneCrossRef.raw)).map((oneCrossRef) => ({ stableId, raw: oneCrossRef.raw, locator: oneCrossRef.locator })));

	// A2 — the seam property
	if (candidateProps[a2.seamPropertyName] !== undefined) {
		const seamEntryList = JSON.parse(candidateProps[a2.seamPropertyName]);
		candidateSeamNodeTotal += 1;
		candidateSeamEntryTotal += seamEntryList.length;
		seamEntryList.forEach((oneEntry) => candidateSeamPairSet.add(`${stableId}|${oneEntry.predicate}|${oneEntry.target}`));
		if (role !== a2.seamRole) {
			noteUnexplained('A2 seam property on a node of another role', { stableId, role });
		}
	}

	// every other name: identical, or named by A3 / V1 / M1
	const nameList = [...new Set(Object.keys(oracleProps).concat(Object.keys(candidateProps)))].filter((oneName) => rowNameList.indexOf(oneName) === -1).sort();
	nameList.forEach((propertyName) => {
		const isInOracle = Object.prototype.hasOwnProperty.call(oracleProps, propertyName);
		const isInCandidate = Object.prototype.hasOwnProperty.call(candidateProps, propertyName);
		if (isInOracle && !isInCandidate) {
			if (listOfRole(allowanceSpec.a3RemovedPropertyListByRole, role).indexOf(propertyName) === -1) {
				noteUnexplained('property absent from candidate', { stableId, propertyName, oracleValue: stableText(oracleProps[propertyName]) });
			}
			return;
		}
		if (!isInOracle && isInCandidate) {
			if (listOfRole(allowanceSpec.a3AddedPropertyListByRole, role).indexOf(propertyName) === -1) {
				noteUnexplained('property absent from oracle', { stableId, propertyName, candidateValue: stableText(candidateProps[propertyName]) });
			}
			return;
		}
		const declaredValueByName = (allowanceSpec.v1DeclaredValueByRole && allowanceSpec.v1DeclaredValueByRole[role]) || {};
		const expectedCandidateValue = declaredValueByName[propertyName] !== undefined
			? declaredValueByName[propertyName]
			: (listOfRole(allowanceSpec.m1ListWrappedPropertyListByRole, role).indexOf(propertyName) !== -1 ? [oracleProps[propertyName]] : oracleProps[propertyName]);
		if (stableText(expectedCandidateValue) !== stableText(candidateProps[propertyName])) {
			noteUnexplained('property value differs', { stableId, propertyName, oracleValue: stableText(oracleProps[propertyName]), candidateValue: stableText(candidateProps[propertyName]) });
		}
	});
});

// A1 totals against the source census, less the seam prefixes
const sourceReferenceCensus = readJson(specRelative(a1.nonNativeReferenceCensusPath)).bySource[allowanceSpec.standardSource].referenceCountByPredicateAndPrefix;
const expectedCrossRefTotalsByKey = Object.keys(sourceReferenceCensus)
	.filter((totalsKey) => seamPrefixList.indexOf(totalsKey.split(' -> ')[1].replace(/:$/, '')) === -1)
	.reduce((totals, totalsKey) => ({ ...totals, [totalsKey]: sourceReferenceCensus[totalsKey] }), {});
const a1TotalsMismatchList = [...new Set(Object.keys(expectedCrossRefTotalsByKey).concat(Object.keys(candidateCrossRefTotalsByKey)))]
	.filter((totalsKey) => (expectedCrossRefTotalsByKey[totalsKey] || 0) !== (candidateCrossRefTotalsByKey[totalsKey] || 0))
	.map((totalsKey) => ({ totalsKey, expected: expectedCrossRefTotalsByKey[totalsKey] || 0, candidate: candidateCrossRefTotalsByKey[totalsKey] || 0 }));
const sumOf = (totals) => Object.values(totals).reduce((total, oneCount) => total + oneCount, 0);
rowEvidence.A1 = {
	verdict: a1TotalsMismatchList.length === 0 && !unexplainedList.some((oneItem) => oneItem.kindText.startsWith('A1')) ? PASS : FAIL,
	detail: `candidate crossRefs ${sumOf(candidateCrossRefTotalsByKey)} = source non-native references less seam ${sumOf(expectedCrossRefTotalsByKey)}; totals mismatches ${a1TotalsMismatchList.length}; oracle (raw, locator) pairs all contained`,
	a1TotalsMismatchList,
};

// A2
const oracleAnchorMissingList = oracleSeamAnchorList.filter((oneAnchor) => !candidateSeamPairSet.has(`${oneAnchor.stableId}|${oneAnchor.locator}|${oneAnchor.raw}`));
rowEvidence.A2 = {
	verdict: candidateSeamEntryTotal === a2.expectedEntryTotal && candidateSeamNodeTotal === a2.expectedNodeTotal && oracleAnchorMissingList.length === 0 && oracleSeamAnchorList.length === a2.expectedOracleAnchorTotal ? PASS : FAIL,
	detail: `seam entries ${candidateSeamEntryTotal} (expected ${a2.expectedEntryTotal}) on ${candidateSeamNodeTotal} nodes (expected ${a2.expectedNodeTotal}); oracle anchors ${oracleSeamAnchorList.length} (expected ${a2.expectedOracleAnchorTotal}), ${oracleAnchorMissingList.length} missing`,
	oracleAnchorMissingList,
};

// A5
const foreignTermCounts = readJson(specRelative(a5.foreignTermCountsPath)).bySource[allowanceSpec.standardSource];
const rootStableId = sharedIdList.find((stableId) => oracleNodeById[stableId].role === 'DmeStandardRoot');
const candidateForeignEntryList = JSON.parse((candidateNodeById[rootStableId] && candidateNodeById[rootStableId].properties[a5.propertyName]) || '[]');
const candidateForeignIriText = stableText(candidateForeignEntryList.map((oneEntry) => oneEntry.iri).sort());
const nonRootCarrierList = sharedIdList.filter((stableId) => stableId !== rootStableId && candidateNodeById[stableId].properties[a5.propertyName] !== undefined);
rowEvidence.A5 = {
	verdict: candidateForeignEntryList.length === foreignTermCounts.foreignEntryCount && candidateForeignIriText === stableText(foreignTermCounts.foreignEntryIdList) && nonRootCarrierList.length === 0 ? PASS : FAIL,
	detail: `root ${a5.propertyName} holds ${candidateForeignEntryList.length} entries (source census ${foreignTermCounts.foreignEntryCount}); iri set ${candidateForeignIriText === stableText(foreignTermCounts.foreignEntryIdList) ? 'identical' : 'DIFFERS'}; carried off the root on ${nonRootCarrierList.length} nodes`,
};

// structural rows
rowEvidence.nodes = { verdict: unexplainedList.some((oneItem) => /^node |^role |^labels /.test(oneItem.kindText)) ? FAIL : PASS, detail: `${oracleCensus.nodes.length} oracle / ${candidateCensus.nodes.length} candidate nodes; stableIds, roles and labels (L1) compared` };
rowEvidence.edges = { verdict: unexplainedList.some((oneItem) => /^edge /.test(oneItem.kindText)) ? FAIL : PASS, detail: `${oracleCensus.intraEdges.length} oracle / ${candidateCensus.intraEdges.length} candidate intra-standard edges; (type, from, to) and properties compared` };
rowEvidence.properties = { verdict: unexplainedList.some((oneItem) => /^property /.test(oneItem.kindText)) ? FAIL : PASS, detail: 'every other property identical, or named by A3 (removed/added), A4, V1 or M1' };

const rowNameOrder = ['nodes', 'edges', 'properties', 'A1', 'A2', 'A5'];
const overallVerdict = rowNameOrder.every((rowName) => rowEvidence[rowName].verdict === PASS) && unexplainedList.length === 0 ? PASS : FAIL;
rowNameOrder.forEach((rowName) => xLog.result(`[${rowName}] ${rowEvidence[rowName].verdict} — ${rowEvidence[rowName].detail}\n`));
unexplainedList.slice(0, UNEXPLAINED_SHOW_LIMIT).forEach((oneItem) => xLog.result(`  UNEXPLAINED ${JSON.stringify(oneItem)}\n`));
xLog.result(`${moduleName}: ${allowanceSpec.standardSource} ${overallVerdict} — ${unexplainedList.length} unexplained difference(s)\n`);
const outputFilePath = flagValueOf('outputFilePath');
if (outputFilePath) {
	fs.writeFileSync(outputFilePath, `${JSON.stringify({ standardSource: allowanceSpec.standardSource, overallVerdict, rowEvidence, unexplainedTotal: unexplainedList.length, unexplainedList }, null, 1)}\n`);
	xLog.result(`${moduleName}: wrote ${outputFilePath}\n`);
}
process.exit(overallVerdict === PASS ? 0 : 1);
