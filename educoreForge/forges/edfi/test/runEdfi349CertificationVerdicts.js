#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     runEdfi349CertificationVerdicts.js — run all four declared roundTripValidators against ONE
     container and print the four verdicts.

DESCRIPTION
     The Ed-Fi 349 certification container is composed by REFERENCE (see
     composeEdfi349CertificationManifest.js): ceds, sif and pesc260805 are the byte-identical
     content-addressed blocks of the certified build, and only edfi differs. This runs each
     bundle's declared validator against that one container so all four verdicts come from the
     same graph.

     READ ORDER IS DELIBERATE AND IS PRINTED IN IT. The three UNCHANGED standards are reported
     FIRST, before Ed-Fi. CRYSTAL_ORBIT's discipline, adopted: after reading "edfi clean" a
     reader is a worse reader of everything after it, and a cross-standard regression is exactly
     what a single-standard fix would hide.

     EXPECTED, and any deviation is a finding rather than a rounding error:
       ceds        reproduced 239,761  lost 0  invented 0   (MUST NOT MOVE)
       sif         reproduced  97,888  lost 0  invented 0   (MUST NOT MOVE)
       pesc260805  reproduced 173,216  lost 0  invented 0   (MUST NOT MOVE)
       edfi        reproduced  25,723  lost 0  invented 0   (25,374 + 349, the whole point)

     Snapshot pins are read from each bundle's parserDescriptor.ini defaultSnapshot rather than
     restated here — a validator run against an unpinned answer key is diffing against whatever
     happens to be on disk.

USAGE
     node runEdfi349CertificationVerdicts.js --containerName=DEV_FourWithNewEdFi
        [--outputDirPath=<dir>]

EXIT
     0 every standard matched its expectation;  1 any refusal or any deviation.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const FORGES_ROOT = path.join(__dirname, '..', '..');

// registry over switch: the four standards, their pinned snapshots, and what each MUST report.
// unchangedByConstruction marks the three whose blocks are reused by reference — for those the
// expectation is not a hope, it is what the identical bytes already produced.
const CERTIFICATION_STANDARD_REGISTRY = [
	{ standardToken: 'ceds', snapshotName: '01', expectedReproduced: 239761, unchangedByConstruction: true },
	{ standardToken: 'sif', snapshotName: '01', expectedReproduced: 97888, unchangedByConstruction: true },
	{ standardToken: 'pesc260805', snapshotName: '01', expectedReproduced: 173216, unchangedByConstruction: true },
	{ standardToken: 'edfi', snapshotName: '04', expectedReproduced: 25723, unchangedByConstruction: false },
];

const commandLineParameters = process.global.commandLineParameters;
const takeParameter = (parameterName) => {
	const valueList = commandLineParameters.values[parameterName] || [];
	return valueList.length ? valueList[0] : '';
};

const containerName = takeParameter('containerName');
const outputDirPath = takeParameter('outputDirPath');

const refuseOut = (refusalMessage) => {
	console.error(`${moduleName} REFUSED: ${refusalMessage}`);
	process.exit(1);
};

if (!containerName) {
	refuseOut('--containerName is REQUIRED and has no default. A validator that does not say which container it read is a verdict about nothing.');
}

const taskList = new taskListPlus();

// STAGE 1 — load every declared validator BEFORE running any, so a missing module refuses up
// front rather than after three standards have already been measured.
taskList.push((args, next) => {
	const loadedList = [];
	let loadFault = '';
	CERTIFICATION_STANDARD_REGISTRY.forEach((oneStandard) => {
		if (loadFault) {
			return;
		}
		const validatorPath = path.join(FORGES_ROOT, oneStandard.standardToken, 'roundTripValidator.js');
		const snapshotPath = path.join(
			FORGES_ROOT,
			oneStandard.standardToken,
			'assets',
			'standardSourceData',
			oneStandard.snapshotName,
		);
		if (!fs.existsSync(validatorPath)) {
			loadFault = `'${oneStandard.standardToken}' declares no roundTripValidator at ${validatorPath}`;
			return;
		}
		if (!fs.existsSync(snapshotPath)) {
			loadFault = `'${oneStandard.standardToken}' pins snapshot '${oneStandard.snapshotName}' but ${snapshotPath} does not exist — a validator with no answer key has nothing to diff against`;
			return;
		}
		loadedList.push({ ...oneStandard, validatorModule: require(validatorPath)(), snapshotPath });
	});
	if (loadFault) {
		next(loadFault);
		return;
	}
	next('', { ...args, loadedList });
});

// STAGE 2 — run them in registry order (unchanged standards FIRST, deliberately)
taskList.push((args, next) => {
	const verdictRowList = [];
	const runNextStandard = (standardIndex) => {
		if (standardIndex >= args.loadedList.length) {
			next('', { ...args, verdictRowList });
			return;
		}
		const oneStandard = args.loadedList[standardIndex];
		const outputPath = outputDirPath
			? path.join(outputDirPath, `${oneStandard.standardToken}RoundTripVerdict.json`)
			: undefined;
		console.error(`[${moduleName}] running ${oneStandard.standardToken} against ${containerName} ...`);
		oneStandard.validatorModule.validate(
			{ containerName, snapshotPath: oneStandard.snapshotPath, ...(outputPath ? { outputPath } : {}) },
			(validateError, verdict) => {
				if (validateError) {
					next(`'${oneStandard.standardToken}' validator refused: ${validateError}`);
					return;
				}
				verdictRowList.push({
					standardToken: oneStandard.standardToken,
					unchangedByConstruction: oneStandard.unchangedByConstruction,
					expectedReproduced: oneStandard.expectedReproduced,
					roundTripClean: verdict.roundTripClean,
					reproduced: verdict.reproduced,
					lostTotal: verdict.lostTotal,
					contentGapTotal: verdict.contentGapTotal,
					inventedTotal: verdict.inventedTotal,
				});
				setImmediate(() => runNextStandard(standardIndex + 1));
			},
		);
	};
	runNextStandard(0);
});

pipeRunner(taskList.getList(), {}, (pipeError, args) => {
	if (pipeError) {
		refuseOut(pipeError);
		return;
	}

	const deviationList = [];
	args.verdictRowList.forEach((oneRow) => {
		if (oneRow.reproduced !== oneRow.expectedReproduced) {
			deviationList.push(
				`${oneRow.standardToken}: reproduced ${oneRow.reproduced}, expected ${oneRow.expectedReproduced}` +
					(oneRow.unchangedByConstruction
						? ' — this standard reuses a BYTE-IDENTICAL block, so movement here is a replay or engine defect, never an Ed-Fi one'
						: ''),
			);
		}
		if (oneRow.lostTotal !== 0) {
			deviationList.push(`${oneRow.standardToken}: lostTotal ${oneRow.lostTotal}, expected 0`);
		}
		if (oneRow.inventedTotal !== 0) {
			deviationList.push(`${oneRow.standardToken}: inventedTotal ${oneRow.inventedTotal} — invention fails a build unconditionally`);
		}
		if (oneRow.roundTripClean !== true) {
			deviationList.push(`${oneRow.standardToken}: roundTripClean ${oneRow.roundTripClean}, expected true`);
		}
	});

	console.log(JSON.stringify({ containerName, verdictRowList: args.verdictRowList, deviationList }, null, 1));

	if (deviationList.length) {
		console.error(`${moduleName}: ${deviationList.length} DEVIATION(S) — not certified.`);
		process.exit(1);
	}
	console.error(`${moduleName}: ALL FOUR STANDARDS MATCHED EXPECTATION.`);
	process.exit(0);
});
