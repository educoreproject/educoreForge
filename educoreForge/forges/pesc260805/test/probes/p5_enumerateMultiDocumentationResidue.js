#!/usr/bin/env node
'use strict';

// p5_enumerateMultiDocumentationResidue.js — Phase 5 (session CRYSTAL_STREAM), written on the
// supervisor's requirement ONE at the O-2 ruling.
//
// THE RESIDUE THIS NAMES. XSD permits an xs:annotation to carry MORE THAN ONE xs:documentation
// child. The forge parser keeps only the FIRST. Every second-and-subsequent literal is therefore
// lost at PARSE time — before the graph, before the emitter, before any validator can see it — and
// it will show up in the validator's lostTotal with no provenance unless it is enumerated here.
//
// WHY IT IS WRITTEN DOWN RATHER THAN FIXED. Repairing the parser is out of Phase 5's scope and is a
// later order's call. What Phase 5 owes its successors is the difference between a KNOWN LIMITATION
// and a FRESH REGRESSION: a Phase 6 or 7 reader who meets a nonzero lostTotal must be able to
// subtract this list by name rather than re-investigate it. An unnamed residue reads as a defect
// every time someone new arrives.
//
// THIS IS A FORGE FINDING, NOT A VALIDATOR FINDING. The loss happens in lib/parser.js's
// documentation extraction, not in the round-trip instrument.
//
// READ-ONLY. Touches no graph, no network, and nothing outside the pinned snapshot. Takes no input:
//   node test/probes/p5_enumerateMultiDocumentationResidue.js

const fs = require('fs');
const path = require('path');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (message) => console.error(message),
	result: () => {},
	verbose: () => {},
};

const REPO_NODE_MODULES = path.join(__dirname, '..', '..', '..', '..', 'node_modules');
const xml2js = require(path.join(REPO_NODE_MODULES, 'xml2js'));

const moduleName = 'p5_enumerateMultiDocumentationResidue';
const BUNDLE_DIR = path.join(__dirname, '..', '..');
const SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '01');

// -----
// walkForMultiDocumentationAnnotations — descends objects AND arrays (xml2js wraps children in
// arrays but leaves the root a bare object; a walk that descends only arrays never enters the
// document and reports a believable zero). Carries the nearest NAMED ancestor so each residue entry
// says what it annotates, not merely which file it is in.
const walkForMultiDocumentationAnnotations = (
	parsedElement,
	ancestorDescription,
	filename,
	foundEntryList,
) => {
	if (!parsedElement || typeof parsedElement !== 'object') {
		return foundEntryList;
	}
	if (Array.isArray(parsedElement)) {
		parsedElement.forEach((oneEntry) =>
			walkForMultiDocumentationAnnotations(oneEntry, ancestorDescription, filename, foundEntryList),
		);
		return foundEntryList;
	}
	Object.keys(parsedElement).forEach((oneChildName) => {
		if (oneChildName === '$' || oneChildName === '_') {
			return;
		}
		const childValue = parsedElement[oneChildName];
		const childValueList = Array.isArray(childValue) ? childValue : [childValue];

		if (oneChildName === 'xs:annotation') {
			childValueList.forEach((oneAnnotation) => {
				const documentationList = (oneAnnotation && oneAnnotation['xs:documentation']) || [];
				if (!Array.isArray(documentationList) || documentationList.length < 2) {
					return;
				}
				const literalTextList = documentationList.map((oneDocumentation) =>
					typeof oneDocumentation === 'string'
						? oneDocumentation
						: (oneDocumentation && oneDocumentation['_']) || '',
				);
				foundEntryList.push({
					filename,
					annotates: ancestorDescription,
					documentationChildCount: documentationList.length,
					discardedLiteralCount: documentationList.length - 1,
					keptLiteral: String(literalTextList[0]).trim(),
					discardedLiteralList: literalTextList
						.slice(1)
						.map((oneLiteral) => String(oneLiteral).trim()),
				});
			});
			return;
		}

		childValueList.forEach((oneChildValue) => {
			const ownName =
				oneChildValue && oneChildValue['$'] && oneChildValue['$'].name
					? `${oneChildName}[name="${oneChildValue['$'].name}"]`
					: oneChildName;
			const nextDescription =
				oneChildValue && oneChildValue['$'] && oneChildValue['$'].name
					? `${ancestorDescription} > ${ownName}`
					: ancestorDescription;
			walkForMultiDocumentationAnnotations(oneChildValue, nextDescription, filename, foundEntryList);
		});
	});
	return foundEntryList;
};

const xsdFilenameList = fs
	.readdirSync(SNAPSHOT_DIR)
	.filter((oneName) => oneName.endsWith('.xsd'))
	.sort();

if (!xsdFilenameList.length) {
	console.error(
		`${moduleName}: '${SNAPSHOT_DIR}' holds no .xsd files. Refused by name rather than reported ` +
			`as an empty residue.`,
	);
	process.exit(1);
}

const foundEntryList = [];
const parseNextFile = (fileIndex) => {
	if (fileIndex >= xsdFilenameList.length) {
		publishResidue();
		return;
	}
	const oneFilename = xsdFilenameList[fileIndex];
	xml2js.parseString(
		fs.readFileSync(path.join(SNAPSHOT_DIR, oneFilename), 'utf8'),
		(parseError, parsedDocument) => {
			if (parseError) {
				console.error(
					`${moduleName}: XML parse of '${oneFilename}' failed: ${parseError.message}. ` +
						`Refused by name, never skipped — a file that cannot be parsed is a file whose ` +
						`residue is UNKNOWN, not a file with none.`,
				);
				process.exit(1);
			}
			walkForMultiDocumentationAnnotations(parsedDocument, 'xs:schema', oneFilename, foundEntryList);
			parseNextFile(fileIndex + 1);
		},
	);
};

const publishResidue = () => {
	const discardedLiteralTotal = foundEntryList.reduce(
		(runningTotal, oneEntry) => runningTotal + oneEntry.discardedLiteralCount,
		0,
	);

	console.log('');
	console.log(`  corpus: ${xsdFilenameList.length} .xsd files at ${SNAPSHOT_DIR}`);
	console.log('');
	console.log(`  ANNOTATIONS CARRYING MORE THAN ONE xs:documentation: ${foundEntryList.length}`);
	console.log(`  LITERALS DISCARDED BY first-documentation-wins:      ${discardedLiteralTotal}`);
	console.log('');
	foundEntryList.forEach((oneEntry, entryIndex) => {
		console.log(`  [${entryIndex + 1}] ${oneEntry.filename}`);
		console.log(`      annotates : ${oneEntry.annotates}`);
		console.log(`      kept      : ${JSON.stringify(oneEntry.keptLiteral.slice(0, 130))}`);
		oneEntry.discardedLiteralList.forEach((oneDiscarded) => {
			console.log(`      DISCARDED : ${JSON.stringify(oneDiscarded.slice(0, 130))}`);
		});
		console.log('');
	});

	const artifactDirPath = path.join(BUNDLE_DIR, 'test', 'test-artifacts');
	fs.mkdirSync(artifactDirPath, { recursive: true });
	const artifactFilePath = path.join(artifactDirPath, 'p5ParserDocumentationResidue.json');
	fs.writeFileSync(
		artifactFilePath,
		`${JSON.stringify(
			{
				probe: moduleName,
				phase: 'Phase 5 — named residue, supervisor requirement ONE at the O-2 ruling',
				mechanism:
					'XSD permits several xs:documentation children in one xs:annotation. The forge ' +
					'parser keeps only the FIRST; every subsequent literal is discarded at PARSE time. ' +
					'These appear in the validator lostTotal and are a KNOWN LIMITATION, not a regression.',
				scope: 'FORGE finding (lib/parser.js documentation extraction), not a validator finding.',
				disposition:
					'NOT FIXED IN PHASE 5 — repairing the parser is a later order. Enumerated so a ' +
					'successor can subtract it by name instead of re-investigating it.',
				snapshotDirPath: SNAPSHOT_DIR,
				xsdFileCount: xsdFilenameList.length,
				multiDocumentationAnnotationCount: foundEntryList.length,
				discardedLiteralTotal,
				residueList: foundEntryList,
			},
			null,
			1,
		)}\n`,
	);
	console.log(`  written: ${artifactFilePath}`);
	console.log('');
};

parseNextFile(0);
