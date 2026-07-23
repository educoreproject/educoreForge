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

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// ---------------------------------------------------------------------
// STDIN ENVELOPE VALIDATION — a parse is not a command (polyArch2 §6)
// ---------------------------------------------------------------------
// The machine channel exists for PROGRAMS, which cannot notice help prose the way a human can. So
// a JSON that PARSES but is not a command envelope must be REFUSED by name, not degraded to
// `{switches:{},values:{},fileList:[]}` (via `parsed.switches || {}`) — that degradation reads as
// "no action", which the entry file treats as a HELP request and EXITS 0. A build script piping a
// flat {"build":true,...}, checking the documented exit contract (0 = the action succeeded), then
// believing a graph was built while stdout is help prose, is exactly the silent-default defect the
// remediation removed everywhere else. Present-but-invalid operator input is the WORSE fault.
//
// A valid envelope carries at least ONE of switches/values/fileList, each of the right type. An
// empty-but-well-formed envelope ({"switches":{}}) is admitted — it is a legitimate empty command,
// distinct from a shape that never was an envelope. Returns '' when admitted, else the refusal.
const stdinEnvelopeError = (parsed) => {
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return (
			`graphBuilder: stdin JSON parsed, but its root is ` +
			`${Array.isArray(parsed) ? 'an array' : parsed === null ? 'null' : typeof parsed} — ` +
			`not a command envelope object. The machine channel expects { switches, values, fileList }: ` +
			`actions under "switches" (e.g. {"switches":{"build":true}}), parameters under "values". ` +
			`It is NOT silently treated as a help request.`
		);
	}
	const has = (key) => Object.prototype.hasOwnProperty.call(parsed, key);
	if (!has('switches') && !has('values') && !has('fileList')) {
		return (
			`graphBuilder: stdin JSON parsed, but carries NONE of the command-envelope keys ` +
			`(switches, values, fileList). Received keys: [${Object.keys(parsed).join(', ') || '(none)'}]. ` +
			`A flat shape like {"build":true,...} is NOT the envelope — actions go under "switches" and ` +
			`parameters under "values". Refusing rather than silently degrading to help (exit 0).`
		);
	}
	const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
	if (has('switches') && !isPlainObject(parsed.switches)) {
		return `graphBuilder: stdin envelope 'switches' must be an object of action flags, got ${Array.isArray(parsed.switches) ? 'an array' : typeof parsed.switches}.`;
	}
	if (has('values') && !isPlainObject(parsed.values)) {
		return `graphBuilder: stdin envelope 'values' must be an object of parameter arrays, got ${Array.isArray(parsed.values) ? 'an array' : typeof parsed.values}.`;
	}
	if (has('fileList') && !Array.isArray(parsed.fileList)) {
		return `graphBuilder: stdin envelope 'fileList' must be an array, got ${typeof parsed.fileList}.`;
	}
	return '';
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
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
		// A PARSE IS NOT A COMMAND. A JSON that parses but is not a command envelope is refused by
		// name here, never degraded to an empty envelope that the entry file reads as "help, exit 0".
		const envelopeError = stdinEnvelopeError(parsed);
		if (envelopeError) {
			callback(envelopeError);
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
// An absent ini IS an error. Discovery that finds nothing must say so and STOP (polyArch2 §6):
// "No config file found, so use in-code values" is the same silent-default defect wearing a hat —
// the operator who moved or misnamed graphBuilder.ini would be told nothing while the whole tree
// reverted to in-code values. A missing SECTION still answers {} (each leaf module now refuses its
// own required keys BY NAME), but a missing FILE is fatal, named, and loud. This is the same law
// the module already applied to TWO inis; ZERO is no longer the exception.
// ---------------------------------------------------------------------

const findSystemRoot = () =>
	__dirname.replace(new RegExp(`^(.*/system).*$`), '$1');

// DISCOVERY, not a hostname whitelist. (The incumbent gated on os.hostname() === 'qMax.local' |
// 'qbook.local' — and this machine is qMini.local, so the incumbent has been silently running
// configless here for its whole life. A whitelist that rots is worse than no gate.) The file's
// PRESENCE is authoritative: look in configs/instanceSpecific/*/ and configs/ flat; exactly one
// hit wins; more than one is a LOUD error and ZERO is a LOUD error too — ambiguity and absence are
// BOTH fatal, neither is ever resolved silently. Returns a real path or throws; never null.
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
	if (candidates.length === 0) {
		throw new Error(
			`graphBuilder: NO graphBuilder.ini found — discovery that finds nothing must say so ` +
				`and STOP; there is no configless default. Looked in ` +
				`${path.join(instanceSpecificDir, '<host>', 'graphBuilder.ini')} and ${flatCandidate}. ` +
				`Put the file in exactly one of those two homes. ` +
				`(The same discovery REFUSES more than one graphBuilder.ini, for the same reason — ` +
				`absence and ambiguity are both fatal.)`,
		);
	}
	return candidates[0];
};

const loadConfig = () => {
	const configFilePath = discoverConfigFile(); // a real, existing path or it has already thrown
	// getConfig returns undefined ONLY when the file is absent; discoverConfigFile guarantees an
	// existing path, so a falsy answer here means the found file yielded nothing usable — name it
	// and stop rather than silently substituting {} (audit row 53, the discovery-clause of §6).
	const wholeConfig = configFileProcessor.getConfig(configFilePath);
	if (!wholeConfig || typeof wholeConfig !== 'object') {
		throw new Error(
			`graphBuilder: ${configFilePath} was found but yielded no configuration object. ` +
				`The file is present but parsed to nothing usable. There is no default.`,
		);
	}
	// A missing SECTION still answers {} — sanctioned plumbing now that each leaf module refuses
	// its own required keys by name (Phase 4 groups 1-5). Only the FILE and its parse are fatal.
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

return { resolveParameters, bootstrapGlobal, loadConfig };
};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
