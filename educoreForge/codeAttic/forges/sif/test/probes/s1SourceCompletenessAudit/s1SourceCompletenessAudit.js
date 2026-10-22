#!/usr/bin/env node
'use strict';

// ============================================================================
// sifSourceCompletenessAudit
//
// Settles the open question in forges/sif/README_ERRATA.md entry S-1: does the
// SIF flattened TSV export systematically omit container-element rows, or is
// ValidMark special?
//
// READ-ONLY BY CONSTRUCTION. It opens two files, writes JSON to a directory you
// name, and does nothing else. It opens no database, resolves no bolt port and
// holds no connection, so its results are unaffected by anything happening to
// DEV_FourWithNewPesc or any other container.
//
// THE ANNOTATED XSD IS NOT IN THIS BUNDLE. Do not go looking for it under
// assets/standardSourceData/ -- README_PROVENANCE.md records the published schema
// zips as deliberately uncommitted. See this directory's README.md for where the
// copy used in 2026-08 was found and why its chain of custody is stated as
// INFERRED rather than VERIFIED. Read that before re-running or you will lose an
// afternoon rediscovering it.
//
// R-SF-6 framing, per CRYSTAL_ORBIT: the spreadsheet is the source of truth.
// The XSD is used here purely as an INDEPENDENT WITNESS to what the export
// generator dropped on its way from the spreadsheet. Nothing in this tool
// claims the XSD is more authoritative.
// ============================================================================

const path = require('path');
const fs = require('fs');

const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();
const commandLineParser = require('qtools-parse-command-line');

const moduleName = 'sifSourceCompletenessAudit';

// --- process.global, populated once at entry and frozen ---------------------
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

// --- required inputs. No default path is supplied for either; a missing one
// --- refuses by name, because a silently-substituted corpus is the one
// --- failure this whole audit exists to detect.
const tsvFilePath = commandLineParameters.values.tsvFilePath
	? commandLineParameters.values.tsvFilePath[0]
	: '';
const xsdFilePath = commandLineParameters.values.xsdFilePath
	? commandLineParameters.values.xsdFilePath[0]
	: '';
const outputDirPath = commandLineParameters.values.outputDirPath
	? commandLineParameters.values.outputDirPath[0]
	: '';

if (!tsvFilePath || !xsdFilePath || !outputDirPath) {
	xLog.error(
		`[${moduleName}] --tsvFilePath, --xsdFilePath and --outputDirPath are all required. There are no defaults; naming the corpus explicitly is the point of the audit.`,
	);
	process.exit(1);
}

const tsvRowInventory = require('./lib/tsvRowInventory')({ tsvFilePath });
const xsdElementInventory = require('./lib/xsdElementInventory')({ xsdFilePath });
const containerOmissionReport = require('./lib/containerOmissionReport')();
const bidirectionalInventoryDiff = require('./lib/bidirectionalInventoryDiff')({
	xsdElementInventory,
});

// The XSD type graph is recursive, so expansion needs an explicit stopping depth.
// It is required rather than defaulted: a silently shallow expansion would report
// elements as missing from the export when they were merely never visited.
const maximumExpansionDepth = commandLineParameters.values.maximumExpansionDepth
	? Number(commandLineParameters.values.maximumExpansionDepth[0])
	: 0;
if (!maximumExpansionDepth) {
	xLog.error(
		`[${moduleName}] --maximumExpansionDepth is required. The export's deepest row is depth 13; supply that or deeper, and know that anything shallower undercounts by construction.`,
	);
	process.exit(1);
}

// --- the declared interface every path-inventory producer satisfies ---------
//
//   producerName : string, matching its registry entry
//   produce(callback) -> callback(errString, producedInventory)
//
// producedInventory is producer-specific by design and the consumers are written
// to one shape each: tsvExport yields { rowList, tableNameList, headerRowCount,
// sectionCount, malformedLineList }; annotatedXsd yields { globalElementsByName,
// complexTypesByName, summary }. What the seam guarantees is the CALLING contract
// -- one argument, callback-last, errString-first, never a throw -- not a common
// payload. Stating a shared payload here would be a lie, and a false interface is
// worse than none because the next author will code against it.
//
// A registry, so adding a third source (a second export, another schema flavor)
// is data, not another branch.
const pathInventoryProducerRegistry = {
	tsvExport: {
		producerName: 'tsvExport',
		produce: (callback) => tsvRowInventory.readRowInventory(callback),
	},
	annotatedXsd: {
		producerName: 'annotatedXsd',
		produce: (callback) => xsdElementInventory.readElementInventory(callback),
	},
};

const taskList = new taskListPlus();

taskList.push((args, next) => {
	const { producerName } = { producerName: 'tsvExport' };
	xLog.status(`[${moduleName}] reading the export: ${tsvFilePath}`);
	pathInventoryProducerRegistry[producerName].produce((errString, result) => {
		if (errString) {
			next(errString, args);
			return;
		}
		xLog.status(
			`[${moduleName}]   ${result.rowList.length} rows across ${result.sectionCount} table sections (${result.headerRowCount} header rows recognized as grammar)`,
		);
		next('', { ...args, tsvInventory: result });
	});
});

taskList.push((args, next) => {
	const { tsvInventory } = args;
	xLog.status(`[${moduleName}] deriving implied containers from row xpaths`);
	containerOmissionReport.buildReport(
		{ rowList: tsvInventory.rowList },
		(errString, result) => {
			if (errString) {
				next(errString, args);
				return;
			}
			next('', { ...args, omissionReport: result });
		},
	);
});

taskList.push((args, next) => {
	xLog.status(`[${moduleName}] reading the annotated XSD: ${xsdFilePath}`);
	pathInventoryProducerRegistry.annotatedXsd.produce((errString, result) => {
		if (errString) {
			next(errString, args);
			return;
		}
		next('', { ...args, xsdInventory: result });
	});
});

taskList.push((args, next) => {
	const { omissionReport, xsdInventory } = args;
	xLog.status(
		`[${moduleName}] resolving each omitted container through the XSD type graph`,
	);
	xsdElementInventory.resolveContainerWitnessList(
		{
			xsdInventory,
			containerList: omissionReport.intermediateOmittedList,
		},
		(errString, result) => {
			if (errString) {
				next(errString, args);
				return;
			}
			next('', { ...args, witnessReport: result });
		},
	);
});

taskList.push((args, next) => {
	const { xsdInventory, tsvInventory } = args;
	xLog.status(
		`[${moduleName}] expanding the XSD element inventory and diffing both directions (max depth ${maximumExpansionDepth})`,
	);
	bidirectionalInventoryDiff.buildDiff(
		{
			xsdInventory,
			rowList: tsvInventory.rowList,
			maximumDepth: maximumExpansionDepth,
		},
		(errString, result) => {
			if (errString) {
				next(errString, args);
				return;
			}
			next('', { ...args, inventoryDiff: result });
		},
	);
});

taskList.push((args, next) => {
	const { omissionReport, witnessReport, xsdInventory, inventoryDiff } = args;

	if (!fs.existsSync(outputDirPath)) {
		fs.mkdirSync(outputDirPath, { recursive: true });
	}

	const writeJson = (fileName, payload) => {
		const filePath = path.join(outputDirPath, fileName);
		fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
		xLog.status(`[${moduleName}] wrote ${filePath}`);
	};

	writeJson('omissionReport.json', omissionReport);
	writeJson('witnessReport.json', witnessReport);
	writeJson('xsdInventorySummary.json', xsdInventory.summary);
	writeJson('inventoryDiff.json', inventoryDiff);

	next('', args);
});

pipeRunner(taskList.getList(), {}, (errString, args) => {
	if (errString) {
		xLog.error(errString);
		process.exit(1);
	}

	const { omissionReport, witnessReport } = args;

	xLog.result('');
	xLog.result('=== TSV-INTERNAL: containers implied by rows, but given no row ===');
	xLog.result(JSON.stringify(omissionReport.totals, null, 2));
	xLog.result(`omitted by depth:     ${JSON.stringify(omissionReport.omittedByDepth)}`);
	xLog.result(`represented by depth: ${JSON.stringify(omissionReport.representedByDepth)}`);
	xLog.result('');
	xLog.result('=== DECIDING CROSS-TAB (intermediate depth only) ===');
	xLog.result(JSON.stringify(omissionReport.structureVersusRowCrossTab, null, 2));
	xLog.result('');
	xLog.result('=== XSD AS WITNESS: what the omitted intermediate containers carry ===');
	xLog.result(JSON.stringify(witnessReport.totals, null, 2));
	xLog.result('');
	xLog.result('=== PASS 3: full XSD inventory vs export, both directions ===');
	xLog.result(JSON.stringify(args.inventoryDiff.totals, null, 2));
	xLog.result('');
});
