#!/usr/bin/env node
'use strict';

// ============================================================================
// s3CrossArtifactCharacteristics
//
// Do SIF's spreadsheet and SIF's XSD ever CONTRADICT each other?
//
// This is the companion to s1SourceCompletenessAudit, and it exists because
// that probe's first write-up got this wrong. S-1 established that the export
// omits 6,586 container elements. The natural misreading of that number is
// "the spreadsheet and the XSD disagree." This probe tests that directly, on
// every export row where BOTH artifacts actually speak, and the answer is no.
//
// WHY IT WAS WRITTEN. The S-1 finding originally claimed repeatability was
// corroborated by "two independent encodings, the spreadsheet's R suffix and
// the XSD's maxOccurs." That was false: the 6,586 containers have no
// spreadsheet row at all, so BOTH compared values came from the XSD. The
// figures were right; the word "independent" was not. TQ asked the plain
// question -- do the spreadsheet and the XML disagree -- and it did not
// survive. Errata S-3 records the result. See README.md.
//
// READ-ONLY BY CONSTRUCTION. Two files in, a report to stdout, nothing else.
// No database, no bolt port, no connection, no writes anywhere.
//
// THE ANNOTATED XSD IS NOT IN THIS BUNDLE. Do not look for it under
// assets/standardSourceData/ -- README_PROVENANCE.md records the published
// schema zips as deliberately uncommitted. This directory's README.md says
// where the 2026-08 copy was found and why its chain of custody is stated as
// INFERRED rather than VERIFIED. Read it before re-running.
//
// R-SF-6 stands: the spreadsheet is the source of truth. The XSD is a witness.
// ============================================================================

const path = require('path');

const commandLineParser = require('qtools-parse-command-line');

const moduleName = 's3CrossArtifactCharacteristics';

const commandLineParameters = commandLineParser.getParameters();

const xLog = {
	status: (message) => process.stderr.write(`${message}\n`),
	error: (message) => process.stderr.write(`ERROR ${message}\n`),
	verbose: (message) => {
		if (commandLineParameters.switches.verbose) {
			process.stderr.write(`  ${message}\n`);
		}
	},
	result: (message) => process.stdout.write(`${message}\n`),
};

process.global = { xLog, commandLineParameters };
Object.freeze(process.global);

// Both inputs are required and neither is defaulted. A silently substituted
// corpus is the failure this probe family exists to detect.
const firstValueOf = (parameterName) =>
	commandLineParameters.values[parameterName]
		? commandLineParameters.values[parameterName][0]
		: '';

const tsvFilePath = firstValueOf('tsvFilePath');
const xsdFilePath = firstValueOf('xsdFilePath');

if (!tsvFilePath || !xsdFilePath) {
	xLog.error(
		`[${moduleName}] --tsvFilePath and --xsdFilePath are both required and neither is defaulted. Naming the corpus explicitly is the point of the probe.`,
	);
	process.exit(1);
}

// The TSV and XSD readers are the SIBLING PROBE's, deliberately reused rather
// than reimplemented: two parsers for one format would be two things to keep
// true, and a divergence between them would look like a finding about SIF.
const siblingProbeLibDir = path.join(
	__dirname,
	'..',
	's1SourceCompletenessAudit',
	'lib',
);

const tsvRowInventory = require(path.join(siblingProbeLibDir, 'tsvRowInventory'))({
	tsvFilePath,
});
const xsdElementInventory = require(path.join(
	siblingProbeLibDir,
	'xsdElementInventory',
))({ xsdFilePath });

// --------------------------------------------------------------------------
// resolveRowPath(): walk an export row's xpath down the XSD type graph and
// return the element or attribute record it names. Returns null when the path
// cannot be walked; the caller counts those separately and never treats an
// unresolvable path as agreement.
// --------------------------------------------------------------------------
const resolveRowPath = ({ globalElementsByName, complexTypesByName, rowXpath }) => {
	const segmentList = rowXpath.slice(1).split('/');
	let currentElementRecord = globalElementsByName.get(segmentList[0]);
	if (!currentElementRecord) {
		return null;
	}

	for (
		let segmentIndex = 1;
		segmentIndex < segmentList.length;
		segmentIndex = segmentIndex + 1
	) {
		const wantedName = segmentList[segmentIndex];

		if (wantedName.charAt(0) === '@') {
			const attributeName = wantedName.slice(1);
			let typeName = currentElementRecord.typeName;
			const visitedTypeNameSet = new Set();
			while (typeName && !visitedTypeNameSet.has(typeName)) {
				visitedTypeNameSet.add(typeName);
				const typeRecord = complexTypesByName.get(typeName);
				if (!typeRecord) {
					return null;
				}
				const matchedAttribute = typeRecord.attributeList.find(
					(attributeRecord) => attributeRecord.attributeName === attributeName,
				);
				if (matchedAttribute) {
					return matchedAttribute;
				}
				typeName = typeRecord.baseTypeName;
			}
			return null;
		}

		const candidateList = xsdElementInventory.effectiveChildElementList({
			complexTypesByName,
			typeName: currentElementRecord.typeName,
		});
		const matchedElement = candidateList.find(
			(elementRecord) => elementRecord.elementName === wantedName,
		);
		if (!matchedElement) {
			return null;
		}
		currentElementRecord = matchedElement;
	}

	return currentElementRecord;
};

tsvRowInventory.readRowInventory((tsvErrString, tsvInventory) => {
	if (tsvErrString) {
		xLog.error(tsvErrString);
		process.exit(1);
	}

	xsdElementInventory.readElementInventory((xsdErrString, xsdInventory) => {
		if (xsdErrString) {
			xLog.error(xsdErrString);
			process.exit(1);
		}

		const { globalElementsByName, complexTypesByName } = xsdInventory;

		let comparedCount = 0;
		let agreeCount = 0;
		let unresolvableCount = 0;
		let mandatoryStarBlankCharacteristicsCount = 0;
		let mandatoryStarBlankButXsdSpeaksCount = 0;
		let blankCharacteristicsBlankMandatoryCount = 0;

		const contradictionList = [];
		const valuePairCount = {};
		const q1XsdValueCount = {};

		tsvInventory.rowList.forEach((rowItem) => {
			const xsdRecord = resolveRowPath({
				globalElementsByName,
				complexTypesByName,
				rowXpath: rowItem.rowXpath,
			});

			if (!xsdRecord) {
				unresolvableCount = unresolvableCount + 1;
				return;
			}

			const spreadsheetValue = rowItem.characteristics;
			const xsdValue = xsdRecord.sifChar || '';

			const valuePairLabel = `tsv:${spreadsheetValue || '(blank)'} | xsd:${xsdValue || '(blank)'}`;
			valuePairCount[valuePairLabel] = (valuePairCount[valuePairLabel] || 0) + 1;

			//errata Q-1's population, settled here rather than left open
			if (spreadsheetValue === '' && rowItem.mandatoryFlag === '*') {
				mandatoryStarBlankCharacteristicsCount =
					mandatoryStarBlankCharacteristicsCount + 1;
				if (xsdValue !== '') {
					mandatoryStarBlankButXsdSpeaksCount =
						mandatoryStarBlankButXsdSpeaksCount + 1;
					q1XsdValueCount[xsdValue] = (q1XsdValueCount[xsdValue] || 0) + 1;
				}
			}
			if (spreadsheetValue === '' && rowItem.mandatoryFlag === '') {
				blankCharacteristicsBlankMandatoryCount =
					blankCharacteristicsBlankMandatoryCount + 1;
			}

			comparedCount = comparedCount + 1;

			if (spreadsheetValue === xsdValue) {
				agreeCount = agreeCount + 1;
				return;
			}

			//A CONTRADICTION is both artifacts stating DIFFERENT non-empty values.
			//One artifact being silent is a difference in expressive reach and is
			//counted apart, because conflating the two is exactly the misreading
			//this probe exists to prevent.
			const isContradiction = spreadsheetValue !== '' && xsdValue !== '';
			if (isContradiction) {
				contradictionList.push({
					rowXpath: rowItem.rowXpath,
					tsvCharacteristics: spreadsheetValue,
					xsdSifChar: xsdValue,
					sourceLineNumber: rowItem.sourceLineNumber,
				});
			}
		});

		const spreadsheetSilentCount = comparedCount - agreeCount - contradictionList.length;

		xLog.result('=== CROSS-ARTIFACT: spreadsheet Characteristics vs XSD sifChar ===');
		xLog.result(
			JSON.stringify(
				{
					exportRows: tsvInventory.rowList.length,
					resolvedInXsd: comparedCount,
					unresolvableInXsd: unresolvableCount,
					identicalValue: agreeCount,
					spreadsheetSilent_xsdSpeaks: spreadsheetSilentCount,
					CONTRADICTIONS_differentValuesStated: contradictionList.length,
				},
				null,
				2,
			),
		);

		xLog.result('');
		xLog.result('=== errata Q-1: mandatory * with blank Characteristics ===');
		xLog.result(
			JSON.stringify(
				{
					rowsAsserting: mandatoryStarBlankCharacteristicsCount,
					ofThose_xsdCarriesAValue: mandatoryStarBlankButXsdSpeaksCount,
					ofThose_xsdAlsoSilent:
						mandatoryStarBlankCharacteristicsCount -
						mandatoryStarBlankButXsdSpeaksCount,
					xsdValueDistribution: q1XsdValueCount,
				},
				null,
				2,
			),
		);

		xLog.result('');
		xLog.result(
			`=== errata cross-tab cell: blank Characteristics AND blank Mandatory = ${blankCharacteristicsBlankMandatoryCount} (the 2026-08-04 correction block says 364) ===`,
		);

		xLog.result('');
		xLog.result('=== value-pair shapes, most common first ===');
		Object.entries(valuePairCount)
			.sort((left, right) => right[1] - left[1])
			.forEach(([valuePairLabel, count]) =>
				xLog.result(`  ${String(count).padStart(6)}  ${valuePairLabel}`),
			);

		if (contradictionList.length) {
			xLog.result('');
			xLog.result('=== CONTRADICTIONS (expected: none) ===');
			xLog.result(JSON.stringify(contradictionList.slice(0, 25), null, 2));
		}
	});
});
