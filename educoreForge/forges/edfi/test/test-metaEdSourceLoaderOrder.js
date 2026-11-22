#!/usr/bin/env node
'use strict';

// test-metaEdSourceLoaderOrder.js — the F-27 gate (deep review 2026-11-21): the Ed-Fi source loader lists .metaed files in
// UTF-16 code-unit order, whatever the host's locale.
//
// The loader sorted each directory with localeCompare and no locale, so the order followed LANG: on this Mac (en_US) 211 of
// 655 core files sat in different positions from code-unit order (pass 2, T0 4.2), and cs_CZ and lt_LT gave two more
// orders. Harvest re-sorts before hashing, so no schema block id moved (proven by a real before/after build, DEVLOG), but
// the forged stream, and anything that reads it in order, did.
//
// A throwaway snapshot is built in the OS temp directory with names chosen so that code-unit order and every tested locale's
// order disagree: capitals before lower case ('StudentCTEProgram' before 'StudentCohort', 'Zeta' before 'alpha'), and
// 'chata' / 'hrad' (Czech sorts 'ch' after 'h'), 'yla' / 'izop' (Lithuanian sorts 'y' with 'i'), and a directory
// beside a file it prefixes. (No two names differ only by case: the volume is case-insensitive.) The list is read in this
// process and in child processes under cs_CZ, lt_LT and tr_TR; every one must equal the code-unit order.
//
// Run: node forges/edfi/test/test-metaEdSourceLoaderOrder.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- F-27 gate: the Ed-Fi source loader's file order is code-unit order under every locale

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Builds a throwaway MetaEd snapshot (README_PROVENANCE.md, SHA256SUMS, both source inputs with package.json) whose file
     names sort differently by locale and by code unit, loads it through loadMetaEdSourceFiles in this process and in child
     processes under cs_CZ, lt_LT and tr_TR, and requires every listing to equal code-unit order.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const LOADER_PATH = path.join(__dirname, '..', 'lib', 'metaEdSourceLoader.js');
const loadMetaEdSourceFiles = require(LOADER_PATH)().loadMetaEdSourceFiles;

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfMetaEdOrderGate-'));
const snapshotPath = path.join(scratchDir, '04');

const FIXTURE_FILE_NAME_LIST = ['StudentCohort.metaed', 'StudentCTEProgram.metaed', 'alpha.metaed', 'Zeta.metaed', 'hrad.metaed', 'chata.metaed', 'izop.metaed', 'yla.metaed', 'Association/inner.metaed', 'Assoc_z.metaed'];
const CHILD_LOCALE_LIST = ['cs_CZ.UTF-8', 'lt_LT.UTF-8', 'tr_TR.UTF-8'];

const compareByCodeUnit = (leftText, rightText) => (leftText < rightText ? -1 : leftText > rightText ? 1 : 0);

// writeFixtureSnapshot — both source inputs carry the same names; SHA256SUMS lists every file
const writeFixtureSnapshot = () => {
	const sumLineList = [];
	['metaEdModel', 'tpdmCommunityModel'].forEach((inputName) => {
		const inputDirectoryPath = path.join(snapshotPath, inputName);
		fs.mkdirSync(inputDirectoryPath, { recursive: true });
		fs.writeFileSync(path.join(inputDirectoryPath, 'package.json'), JSON.stringify({ metaEdProject: { projectName: `gate-${inputName}`, projectVersion: '0.0.1' } }));
		FIXTURE_FILE_NAME_LIST.forEach((relativeFileName) => {
			const filePath = path.join(inputDirectoryPath, relativeFileName);
			fs.mkdirSync(path.dirname(filePath), { recursive: true });
			const fileText = `// ${inputName}/${relativeFileName}\n`;
			fs.writeFileSync(filePath, fileText);
			sumLineList.push(`${crypto.createHash('sha256').update(fileText).digest('hex')}  ${inputName}/${relativeFileName}`);
		});
	});
	fs.writeFileSync(path.join(snapshotPath, 'README_PROVENANCE.md'), 'gate fixture, not a real snapshot\n');
	fs.writeFileSync(path.join(snapshotPath, 'SHA256SUMS'), `${sumLineList.join('\n')}\n`);
};

// the order a code-unit walk gives: each directory's entries by code unit, a directory's contents in its place
const codeUnitOrderFor = (inputName) => {
	const walkedList = [];
	const walk = (relativeDirPath) => {
		fs.readdirSync(path.join(snapshotPath, inputName, relativeDirPath), { withFileTypes: true })
			.sort((left, right) => compareByCodeUnit(left.name, right.name))
			.forEach((oneEntry) => {
				const relativePath = relativeDirPath ? `${relativeDirPath}/${oneEntry.name}` : oneEntry.name;
				if (oneEntry.isDirectory()) {
					walk(relativePath);
					return;
				}
				if (relativePath.endsWith('.metaed')) {
					walkedList.push(`${inputName}/${relativePath}`);
				}
			});
	};
	walk('');
	return walkedList;
};

const listingOf = (loaded) => loaded.sourceInputList.map((oneInput) => oneInput.metaEdFileList.map((oneFile) => oneFile.sourceFileRelativePath));

const CHILD_SCRIPT_TEXT = `require(process.argv[1])().loadMetaEdSourceFiles({ snapshotPath: process.argv[2] }, (err, loaded) => { if (err) { console.log(JSON.stringify({ err })); return; } console.log(JSON.stringify({ listing: loaded.sourceInputList.map((oneInput) => oneInput.metaEdFileList.map((oneFile) => oneFile.sourceFileRelativePath)) })); });`;

writeFixtureSnapshot();
const expectedListing = ['metaEdModel', 'tpdmCommunityModel'].map(codeUnitOrderFor);

const taskList = new taskListPlus();

taskList.push((args, next) => {
	harness.section('THIS PROCESS — the loader lists files in code-unit order');
	harness.ok(
		'FIXTURE: code-unit order and this host locale order really disagree on these names',
		JSON.stringify(FIXTURE_FILE_NAME_LIST.slice().sort(compareByCodeUnit)) !== JSON.stringify(FIXTURE_FILE_NAME_LIST.slice().sort((left, right) => left.localeCompare(right))),
	);
	loadMetaEdSourceFiles({ snapshotPath }, (err, loaded) => {
		if (err) {
			next(err, args);
			return;
		}
		harness.equal(`under this process's locale (${Intl.DateTimeFormat().resolvedOptions().locale}) the listing is code-unit order`, JSON.stringify(listingOf(loaded)), JSON.stringify(expectedListing));
		next('', args);
	});
});

CHILD_LOCALE_LIST.forEach((oneLocale) => {
	taskList.push((args, next) => {
		execFile(process.execPath, ['-e', CHILD_SCRIPT_TEXT, LOADER_PATH, snapshotPath], { env: { ...process.env, LANG: oneLocale, LC_ALL: oneLocale } }, (execError, stdoutText) => {
			if (execError) {
				next(`child under ${oneLocale}: ${execError.message}`, args);
				return;
			}
			const childResult = JSON.parse(`${stdoutText}`.trim());
			harness.equal(`under ${oneLocale} the listing is code-unit order`, JSON.stringify(childResult.listing), JSON.stringify(expectedListing));
			next('', args);
		});
	});
});

pipeRunner(taskList.getList(), {}, (err) => {
	if (err) {
		harness.ok('the gate fixture ran to completion', false, err);
	}
	fs.rmSync(scratchDir, { recursive: true, force: true });
	harness.report();
});
