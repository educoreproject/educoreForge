'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sub-cli.js — the ONLY place forgeManager shells out to a component CLI. forgeManager is THIN:
// it sequences shell-outs by ABSOLUTE PATH to each entry .js (node <abs>/edfForge.js ...) and reads
// each component's stdout. forgeManager holds NO domain logic and NO neo4j/SQL of its own.
//
// PARSING CONTRACT (confirmed from the sub-CLI sources this phase — see PHASE6-REPORT.md):
//   * forger (edfForge.js), replayManager -buildGraph (edfReplay.js), bridgeMaker (edfBridge.js),
//     manifestEditor (manifestEditor.js): emit EXACTLY ONE JSON object on STDOUT (xLog.result ->
//     console.log). All status/progress is on STDERR. => parse stdout as JSON.
//   * replayManager -extractSchema (edfReplay.js): with --out=<path> the BLOCK goes to the file and
//     STDOUT IS EMPTY (the summary JSON goes to STDERR via xLog.status). So forgeManager ALWAYS
//     passes --out for extractSchema, reads the block from the file, and does NOT parse stdout for
//     it. (Without --out the block prints on stdout — unusable mixed with nothing to key on.)
//
// Async style: child_process resolves at the leaf; no async/await, no try/catch-for-control-flow.
// camelCase only.

const { execFile } = require('child_process');

const moduleFunction =
	({ moduleName } = {}) =>
	({} = {}) => {
		const { xLog } = process.global;

		// runComponent — shell out to `node <entryPath> <args...>`; callback(err, { stdout, stderr }).
		//   A non-zero exit is an error (the component failed); its stderr is surfaced.
		const runComponent = ({ entryPath, args, label }, callback) => {
			const fullArgs = [entryPath, ...args];
			xLog.status(`[forgeManager] -> ${label}: node ${entryPath} ${args.join(' ')}`);
			execFile(
				'node',
				fullArgs,
				{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
				(err, stdout, stderr) => {
					if (err) {
						callback(
							`${label} failed (exit ${err.code}): ${(stderr || '').trim() || err.message}`,
						);
						return;
					}
					callback('', { stdout: stdout || '', stderr: stderr || '' });
				},
			);
		};

		// runComponentJson — runComponent + parse the single stdout JSON object. The summary that the
		//   forger/replay-buildGraph/bridge/manifestEditor print is the LAST JSON object on stdout;
		//   we parse the whole stdout (it is exactly one pretty-printed object).
		const runComponentJson = ({ entryPath, args, label }, callback) => {
			runComponent({ entryPath, args, label }, (err, result) => {
				if (err) {
					callback(err);
					return;
				}
				const text = `${result.stdout}`.trim();
				if (!text) {
					callback(`${label}: expected a JSON object on stdout, got nothing`);
					return;
				}
				let parsed;
				try {
					parsed = JSON.parse(text);
				} catch (jsonErr) {
					callback(
						`${label}: stdout was not parseable JSON (${jsonErr.message}): ${text.slice(0, 400)}`,
					);
					return;
				}
				callback('', parsed);
			});
		};

		return { runComponent, runComponentJson };
	};

module.exports = moduleFunction({ moduleName });
