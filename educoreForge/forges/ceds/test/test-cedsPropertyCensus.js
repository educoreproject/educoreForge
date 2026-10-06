#!/usr/bin/env node
'use strict';

// test-cedsPropertyCensus.js — ⟪campaign P3, W-C-17 (V1-C49)⟫ the CEDS node shape is DECLARED, not discovered, and the
// count facets are INTEGERS.
//
// The parser used to carry every predicate it did not interpret as a property named by its local name: an OPEN set,
// so whatever a CEDS release asserted reached the graph without anyone looking. And it carried maxLength / minLength /
// decimalPlaces as the source TEXT ("30") while Ed-Fi carried numbers (30), so one name had two types in one graph.
//
//   A  the declared table equals the measured census of the shipped ontology, and parsing it raises no fault
//   B  every maxLength / minLength / decimalPlaces the shipped ontology carries is a number (twin: typing removed)
//   C  the small fixture's facets are numbers that re-stringify to the source text, decimalPlaces 0 included
//   D  an invented predicate <frobnicate> is REFUSED by name (twin: the declared-name check removed)
//   E  a non-integer maxLength ("4O") is REFUSED by name
//
// Hermetic: parses the shipped ontology and fixture copies in an OS temp dir; no Docker, no network.
//
// Run: node forges/ceds/test/test-cedsPropertyCensus.js

const fs = require('fs');
const os = require('os');
const path = require('path');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- the CEDS annotation names are declared and the count facets are integers (W-C-17)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const moduleDouble = require('../../../lib/forge-framework/test/testSupport/moduleDouble');
const { CEDS_DECLARED_ANNOTATION_NAME_LIST, CEDS_INTEGER_ANNOTATION_NAME_LIST } = require('../lib/cedsPropertyNameTable');

const PARSER_FILE_PATH = path.join(__dirname, '..', 'lib', 'parser.js');
const SHIPPED_SNAPSHOT_PATH = path.join(__dirname, '..', 'assets', 'standardSourceData', '01');
const FIXTURE_FILE_PATH = path.join(__dirname, 'fixtures', 'roundTripFixture.rdf');
const FACET_TEXT_BY_NAME_IN_FIXTURE = Object.freeze({ maxLength: '75', minLength: '1', decimalPlaces: '0', minCount: '0', maxCount: '1' });

// the twins: each removes ONE behaviour from the parser, compiled in memory
const TYPING_REMOVED_MUTATION = { find: '\t\tconst typedValues = CEDS_INTEGER_ANNOTATION_NAME_LIST.indexOf(localName) === -1\n', replace: '\t\tconst typedValues = true\n' };
const DECLARED_CHECK_REMOVED_MUTATION = { find: '\t\tif (CEDS_DECLARED_ANNOTATION_NAME_LIST.indexOf(localName) === -1) {', replace: '\t\tif (false) {' };

const quietLog = { status: () => {}, error: () => {} };
const scratchRootDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cedsPropertyCensus-'));
const snapshotWith = (snapshotName, transformText) => {
	const dirPath = path.join(scratchRootDirPath, snapshotName);
	fs.mkdirSync(dirPath, { recursive: true });
	fs.writeFileSync(path.join(dirPath, 'fixture.rdf'), transformText(fs.readFileSync(FIXTURE_FILE_PATH, 'utf8')));
	return dirPath;
};

const parserWith = (mutationList) =>
	mutationList.length
		? moduleDouble.loadWithMutations({ modulePath: PARSER_FILE_PATH, mutationList: mutationList.map((oneMutation) => ({ modulePath: PARSER_FILE_PATH, ...oneMutation })) })
		: require(PARSER_FILE_PATH);

// every parsed entity carrying generic annotations, plus each property's interpreted maxLength
const annotationCarrierListOf = (parsed) => {
	const carrierList = [];
	const visit = (candidate, depth) => {
		if (depth > 4 || !candidate || typeof candidate !== 'object') return;
		if (Array.isArray(candidate)) {
			candidate.forEach((oneItem) => visit(oneItem, depth + 1));
			return;
		}
		if (candidate.annotations && typeof candidate.annotations === 'object') carrierList.push(candidate);
		Object.keys(candidate).forEach((oneName) => {
			if (oneName !== 'annotations') visit(candidate[oneName], depth + 1);
		});
	};
	visit(parsed, 0);
	return carrierList;
};
const facetValueListOf = (parsed) =>
	annotationCarrierListOf(parsed).reduce((soFar, oneCarrier) => {
		CEDS_INTEGER_ANNOTATION_NAME_LIST.forEach((oneName) => {
			[oneCarrier.annotations[oneName], oneCarrier[oneName]].filter((oneValue) => oneValue !== undefined).forEach((oneValue) => soFar.push({ facetName: oneName, facetValue: oneValue }));
		});
		return soFar;
	}, []);

const parseWith = ({ parserLib, sourcePath }, callback) => parserLib.parseCeds({ sourcePath, xLog: quietLog }, callback);

const stepList = [
	// A + B over the shipped ontology, then B's twin
	(next) => parseWith({ parserLib: parserWith([]), sourcePath: SHIPPED_SNAPSHOT_PATH }, (parseError, parsed) => {
		harness.section('A/B — the shipped ontology: declared names only, integer facets');
		harness.ok('A: the shipped ontology parses with no fault', !parseError, String(parseError).slice(0, 300));
		if (parseError) {
			next();
			return;
		}
		const censusNameList = [...new Set(annotationCarrierListOf(parsed).reduce((soFar, oneCarrier) => soFar.concat(Object.keys(oneCarrier.annotations)), []))].sort();
		const declaredUnusedNameList = CEDS_DECLARED_ANNOTATION_NAME_LIST.filter((oneName) => censusNameList.indexOf(oneName) === -1);
		const undeclaredNameList = censusNameList.filter((oneName) => CEDS_DECLARED_ANNOTATION_NAME_LIST.indexOf(oneName) === -1);
		harness.ok('A: the fourteen names the ontology carries are all declared, and the declared-but-unused are exactly issueLink, maxCount, minCount', censusNameList.length === 14 && undeclaredNameList.length === 0 && JSON.stringify(declaredUnusedNameList) === JSON.stringify(['issueLink', 'maxCount', 'minCount']), `census ${censusNameList.length}; undeclared ${JSON.stringify(undeclaredNameList)}; declared unused ${JSON.stringify(declaredUnusedNameList)}`);
		const facetValueList = facetValueListOf(parsed);
		const nonIntegerList = facetValueList.filter((oneFacet) => typeof oneFacet.facetValue !== 'number' || !Number.isInteger(oneFacet.facetValue));
		harness.ok(`B: every one of the ${facetValueList.length} count facets is an integer (> 500 expected: maxLength 399, decimalPlaces 114, minLength 26)`, facetValueList.length > 500 && nonIntegerList.length === 0, `${nonIntegerList.length} non-integer, e.g. ${JSON.stringify(nonIntegerList.slice(0, 2))}`);
		next();
	}),
	(next) => parseWith({ parserLib: parserWith([TYPING_REMOVED_MUTATION]), sourcePath: SHIPPED_SNAPSHOT_PATH }, (parseError, parsed) => {
		const stringFacetCount = parseError ? 0 : facetValueListOf(parsed).filter((oneFacet) => typeof oneFacet.facetValue === 'string').length;
		harness.ok('B twin (typing removed from the generic path): string facets reappear — the B judge would be RED', !parseError && stringFacetCount > 0, `string facets ${stringFacetCount}; error ${parseError}`);
		next();
	}),
	// C — the small fixture: canonical round-trip text
	(next) => parseWith({ parserLib: parserWith([]), sourcePath: snapshotWith('plain', (text) => text) }, (parseError, parsed) => {
		harness.section('C — the fixture facets are integers that re-stringify to the source');
		const facetValueList = parseError ? [] : facetValueListOf(parsed);
		const restringifiedByName = facetValueList.reduce((soFar, oneFacet) => ({ ...soFar, [oneFacet.facetName]: String(oneFacet.facetValue) }), {});
		const sortedEntriesOf = (byName) => JSON.stringify(Object.keys(byName).sort().map((oneName) => [oneName, byName[oneName]]));
		harness.equal('C: maxLength 75, minLength 1, decimalPlaces 0, minCount 0 and maxCount 1 are numbers whose String() is the source text', sortedEntriesOf(restringifiedByName), sortedEntriesOf(FACET_TEXT_BY_NAME_IN_FIXTURE));
		harness.ok('C: all five are of type number', facetValueList.length === 5 && facetValueList.every((oneFacet) => typeof oneFacet.facetValue === 'number'), JSON.stringify(facetValueList));
		next();
	}),
	// D — an undeclared predicate
	(next) => {
		harness.section('D/E — refusals by name');
		const inventedSnapshotPath = snapshotWith('invented', (text) => text.replace('<minLength>1</minLength>', '<minLength>1</minLength>\n\t\t<frobnicate>yes</frobnicate>'));
		parseWith({ parserLib: parserWith([]), sourcePath: inventedSnapshotPath }, (parseError) => {
			harness.match('D: an invented predicate <frobnicate> is refused by name', String(parseError), /UNDECLARED PREDICATE 'frobnicate' \(local name 'frobnicate'\).*cedsPropertyNameTable/s);
			parseWith({ parserLib: parserWith([DECLARED_CHECK_REMOVED_MUTATION]), sourcePath: inventedSnapshotPath }, (twinError, twinParsed) => {
				const carriesFrobnicate = !twinError && annotationCarrierListOf(twinParsed).some((oneCarrier) => oneCarrier.annotations.frobnicate !== undefined);
				harness.ok('D twin (declared-name check removed): frobnicate is silently CARRIED — the D judge would be RED', carriesFrobnicate, `error ${twinError}`);
				next();
			});
		});
	},
	// E — a non-integer count
	(next) => parseWith({ parserLib: parserWith([]), sourcePath: snapshotWith('nonInteger', (text) => text.replace('<maxLength>75</maxLength>', '<maxLength>7S</maxLength>')) }, (parseError) => {
		harness.match('E: a non-integer maxLength "7S" is refused by name', String(parseError), /NON-INTEGER FACET 'maxLength' = "7S"/);
		next();
	}),
];

const runSteps = (remainingStepList) => {
	if (remainingStepList.length === 0) {
		fs.rmSync(scratchRootDirPath, { recursive: true, force: true });
		harness.report();
		return;
	}
	remainingStepList[0](() => runSteps(remainingStepList.slice(1)));
};
runSteps(stepList);
