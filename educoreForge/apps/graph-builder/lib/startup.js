'use strict';

// startup.js — graphBuilder's plumbing: work out WHAT was asked, then stand up the process
// environment the rest of the app assumes. Nothing here decides anything about graphs.
//
//   resolveParameters(callback) -> callback(errString, commandLineParameters)
//   bootstrapGlobal(commandLineParameters)   // sets and FREEZES process.global
//
// Two input channels, one shape. Parameters arrive either as command-line flags or as a JSON
// object on stdin; when stdin is not a terminal and carries content it REPLACES the command
// line rather than merging with it. Replacement, not merge, is deliberate: a half-command-line
// half-stdin invocation would be untraceable when something later goes wrong.
//
// process.global is bootstrapped and FROZEN exactly once, carrying xLog, getConfig and the
// resolved commandLineParameters. Frozen because a global that anything may reshape mid-run is
// not a global, it is a rumour.

const path = require('path');
const fs = require('fs');

const commandLineParser = require('qtools-parse-command-line');
const configFileProcessor = require('qtools-config-file-processor');

// ---------------------------------------------------------------------
// PARAMETER RESOLUTION — JSON-on-stdin overrides the command line
// ---------------------------------------------------------------------
// Errors are values (callback(errString)); no try/catch for control flow beyond the parse.

const resolveParameters = (callback) => {
	const cliParameters = commandLineParser.getParameters({ noFunctions: true });

	if (process.stdin.isTTY) {
		// attached to a terminal -> there is no piped stdin
		callback('', cliParameters);
		return;
	}

	let buffer = '';
	process.stdin.setEncoding('utf8');
	process.stdin.on('data', (chunk) => {
		buffer += chunk;
	});
	process.stdin.on('end', () => {
		if (!buffer.trim()) {
			// non-TTY but nothing piped (e.g. </dev/null) -> fall back to the command line
			callback('', cliParameters);
			return;
		}
		let parsed;
		try {
			parsed = JSON.parse(buffer);
		} catch (parseError) {
			callback(`graphBuilder: invalid JSON on stdin: ${parseError.message}`);
			return;
		}
		callback('', {
			switches: parsed.switches || {},
			values: parsed.values || {},
			fileList: parsed.fileList || [],
		});
	});
};

// ---------------------------------------------------------------------
// CONFIG RESOLUTION — the project convention is per-concern ini files in
// system/configs/instanceSpecific/<host>/; this app's file is graphBuilder.ini, one section
// per component ([forger], [replay-manager], ...). SECRETS never live here — they stay in
// their own files (voyageEmbedding.ini), which this file may POINT AT but never contains.
//
// An absent ini is not an error: getConfig answers {} for every section and each module
// falls back to its in-code defaults, so a relocated tree runs identically unconfigured.
// ---------------------------------------------------------------------

const findSystemRoot = () =>
	__dirname.replace(new RegExp(`^(.*/system).*$`), '$1');

// DISCOVERY, not a hostname whitelist. (The incumbent gated on os.hostname() === 'qMax.local' |
// 'qbook.local' — and this machine is qMini.local, so the incumbent has been silently running
// configless here for its whole life. A whitelist that rots is worse than no gate.) The file's
// PRESENCE is authoritative: look in configs/instanceSpecific/*/ and configs/ flat; exactly one
// hit wins; more than one is a LOUD error (ambiguity is never resolved silently); none -> {}.
const discoverConfigFile = () => {
	const configsRoot = path.join(findSystemRoot(), 'configs');
	const candidates = [];
	const instanceSpecificDir = path.join(configsRoot, 'instanceSpecific');
	if (fs.existsSync(instanceSpecificDir)) {
		fs.readdirSync(instanceSpecificDir, { withFileTypes: true })
			.filter((oneEntry) => oneEntry.isDirectory())
			.forEach((oneEntry) => {
				const candidate = path.join(instanceSpecificDir, oneEntry.name, 'graphBuilder.ini');
				if (fs.existsSync(candidate)) {
					candidates.push(candidate);
				}
			});
	}
	const flatCandidate = path.join(configsRoot, 'graphBuilder.ini');
	if (fs.existsSync(flatCandidate)) {
		candidates.push(flatCandidate);
	}
	if (candidates.length > 1) {
		throw new Error(
			`graphBuilder: MORE THAN ONE graphBuilder.ini found — refusing to guess which governs: ${candidates.join(
				', ',
			)}`,
		);
	}
	return candidates[0] || null;
};

const loadConfig = () => {
	const configFilePath = discoverConfigFile();
	const wholeConfig = configFilePath
		? configFileProcessor.getConfig(configFilePath) || {}
		: {};
	const getConfig = (sectionName) =>
		sectionName === 'allConfigs' ? wholeConfig : wholeConfig[sectionName] || {};
	return { getConfig, wholeConfig, configFilePath };
};

// ---------------------------------------------------------------------
// BOOTSTRAP process.global (xLog + getConfig + commandLineParameters), frozen once
// ---------------------------------------------------------------------

const bootstrapGlobal = (commandLineParameters) => {
	// qtools-x-log: status/error/verbose to stderr, result to stdout. That default is correct
	// HERE -- graphBuilder's product is the JSON another program consumes, so progress must not
	// pollute it. (The test apps deliberately invert this with logToStdOut, because a test
	// report IS its product; see test/testLib/testAppStartup.js.)
	//
	// CODE FACT: xLog.result uses process.stdout.write and appends NO newline -- the caller owns
	// line termination so results stay pipe-composable. Every result() call here supplies its own.
	//
	// KNOWN LIMITATION: xLog is a singleton that reads process.argv at require time, so its
	// -verbose / -quiet / -silent switches follow the COMMAND LINE even when parameters arrived
	// by JSON on stdin. A stdin-supplied "verbose" switch will reach the app's own logic but not
	// xLog's. Acceptable while the stdin channel is used for actions rather than log levels;
	// worth revisiting if that changes.
	const xLog = require('qtools-x-log');

	const { getConfig, wholeConfig } = loadConfig();

	process.global = { xLog, getConfig, commandLineParameters, rawConfig: wholeConfig };
	Object.freeze(process.global);
};

module.exports = { resolveParameters, bootstrapGlobal, loadConfig };
