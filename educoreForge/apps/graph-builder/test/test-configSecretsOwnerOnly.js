'use strict';

// test-configSecretsOwnerOnly.js — ⟪campaign P4b, X4⟫ the .ini configs are the ONE home for secrets (ruled 2026-10-06), and
// every secrets-bearing config file is readable by its owner only. This gate holds that on THIS machine's educoreForge
// configs tree (system/configs, three levels above the code tree): every .ini that assigns a value to a secret-named key
// carries no group or other permission bit. It prints paths and modes only — never a value.
//
// RED TWIN (in-memory): one secrets-bearing file reported at mode 644 -> red.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- X4: secrets-bearing config files are owner-only (mode 600)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 the conjunct passed and its twin was observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');

// a key ENDING in a secret word, with a value; `apiKeyEnvironmentVariableName` names a variable, so it does not match
const SECRET_ASSIGNMENT_PATTERN = /^[ \t]*[A-Za-z0-9_.]*(?:[Aa]pi[Kk]ey|[Pp]assword|[Ss]ecret|[Aa]pi[Tt]oken|[Bb]ot[Tt]oken)[ \t]*=[ \t]*[^\s;<]/m;
const GROUP_OR_OTHER_PERMISSION_MASK = 0o077;
const CONFIGS_ROOT_PATH = path.join(__dirname, '..', '..', '..', '..', '..', '..', 'configs');

const listIniFiles = (dirPath) => fs.readdirSync(dirPath, { withFileTypes: true }).reduce((soFar, oneEntry) => {
	const entryPath = path.join(dirPath, oneEntry.name);
	if (oneEntry.isDirectory()) { return oneEntry.name === '.git' ? soFar : soFar.concat(listIniFiles(entryPath)); }
	return /\.ini$/.test(oneEntry.name) ? soFar.concat([entryPath]) : soFar;
}, []);

const judgeOwnerOnly = (fileModeList) => {
	const exposedList = fileModeList.filter((oneFileMode) => (oneFileMode.mode & GROUP_OR_OTHER_PERMISSION_MASK) !== 0);
	return { pass: fileModeList.length > 0 && exposedList.length === 0, detail: exposedList.map((oneFileMode) => `${(oneFileMode.mode & 0o777).toString(8)} ${path.relative(CONFIGS_ROOT_PATH, oneFileMode.filePath)}`).join('; ') || `${fileModeList.length} file(s), all owner-only` };
};

harness.section(`X4 — secrets-bearing .ini files under ${CONFIGS_ROOT_PATH}`);
harness.ok('the configs tree exists', fs.existsSync(CONFIGS_ROOT_PATH), CONFIGS_ROOT_PATH);
const fileModeList = (fs.existsSync(CONFIGS_ROOT_PATH) ? listIniFiles(CONFIGS_ROOT_PATH) : [])
	.filter((oneFilePath) => SECRET_ASSIGNMENT_PATTERN.test(fs.readFileSync(oneFilePath, 'utf8')))
	.map((oneFilePath) => ({ filePath: oneFilePath, mode: fs.statSync(oneFilePath).mode }));
const verdict = judgeOwnerOnly(fileModeList);
harness.ok(`every secrets-bearing .ini is mode 600 or tighter (${fileModeList.length} found)`, verdict.pass, verdict.detail);
const twinVerdict = judgeOwnerOnly(fileModeList.map((oneFileMode, fileIndex) => (fileIndex === 0 ? { ...oneFileMode, mode: 0o100644 } : oneFileMode)));
harness.ok('RED TWIN groupReadable (one file at 644) turns it red', twinVerdict.pass === false, twinVerdict.detail);

harness.report();
