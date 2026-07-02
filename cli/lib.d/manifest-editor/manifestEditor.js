#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const qt = require('qtools-functional-library');
const os = require('os');
const path = require('path');
const fs = require('fs');

const commandLineParser = require('qtools-parse-command-line');
const commandLineParameters = commandLineParser.getParameters();

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// the store + the compose layer (the only place table/db names live is forge-store)
const forgeStoreFactory = require('../../../npm/qtools-graph-forge-core/lib/forge-store/forge-store');
const manifestEditorFactory = require('../../../npm/qtools-graph-forge-core/lib/manifest-editor/manifest-editor');

// START OF moduleFunction() ============================================================
//
// manifestEditor CLI — the bb2-style control surface for the SQL-persistence app
// (helpSpec.md is the contract). Three layers:
//   (1) THIS orchestrator: bootstrap, db resolution, action dispatch (registry, not
//       a switch statement), single final callback.
//   (2) shared resource: the manifest-editor lib (compose-by-selection) over the
//       forge-store (immutable content-addressed SQLite), instantiated once.
//   (3) command handlers: one workingFunction per action switch, registered into a
//       dispatch map and selected by the single action switch on the command line.
//
// Action flags take a SINGLE hyphen (-save -combine -validate -show -diff); parameter
// flags take a DOUBLE hyphen (--block= --base= --set= ...); parameter values arrive
// as arrays (qtools-parse-command-line). A manifestKey is ALWAYS derived, never
// supplied.

const moduleFunction =
	({ moduleName } = {}) =>
	({ unused } = {}) => {
		const { xLog, getConfig, commandLineParameters } = process.global;
		const localConfig = getConfig(moduleName) || {};

		const helpText = `
manifestEditor — the SQL-persistence app; sole canonicalizing writer of manifests.

USAGE
  manifestEditor -save     --block=<path|-> [--producedBy=<text>]
  manifestEditor -combine  [--base=<manifestKey>] --set=<blockId>[,<blockId>...]
                           [--label=<text>] [--note=<text>]
  manifestEditor -show     --manifest=<manifestKey>
  manifestEditor -validate --manifest=<manifestKey>
  manifestEditor -diff     --from=<manifestKey> --to=<manifestKey>
  manifestEditor -listBlocks
  manifestEditor -listManifests

  [--db=<sqlitePath>]   override the store location (else config, else dataStore default)

  -save     Persist a schemaBlock (PG-JSONL) to the blocks table; returns its blockId
            (= sha256 of the block text). Idempotent. type/subject/version/requires are
            read from the block's PG-JSONL header (the header is authoritative).
  -combine  Compose a NEW immutable manifest from a base + a selection. Each --set block
            SUPERSEDES the base's block for its (type,subject) or ADDS a new subject.
            Nothing is mutated; the manifestKey is derived. With no --base, composes a
            genesis manifest from --set alone.
  -show     Print a manifest's membership in derived build order.
  -validate Bridge-closure check: every relationships/overlay block's required subjects
            are present AND ordered earlier.
  -diff     Block-membership delta between two manifests.
  -listBlocks     List catalog blocks (type standard/reference/mapping — bridge and
                  inferredDecision blocks are excluded) as blockId/type/subject/version/requires.
  -listManifests  List all manifests as manifestKey/label/note/basedOn/createdAt.
`;

		// -----
		// parameter helpers — values arrive as arrays; first() takes index 0,
		// list() flattens comma-or-multi-flag selections.

		const first = (name) => {
			const values = commandLineParameters.values[name];
			return values && values.length ? values[0] : undefined;
		};

		const list = (name) => {
			const values = commandLineParameters.values[name];
			if (!values || !values.length) {
				return [];
			}
			return values
				.flatMap((oneValue) => `${oneValue}`.split(','))
				.map((oneValue) => oneValue.trim())
				.filter((oneValue) => oneValue.length > 0);
		};

		// -----
		// dbPath resolution: --db override, else config, else dataStore default
		// (created if missing). forge-store owns the table names; this picks the file.

		const repoRoot = path.join(__dirname, '../../..');
		const resolveDbPath = () => {
			const override = first('db');
			if (override) {
				return override;
			}
			if (localConfig.dbPath) {
				return localConfig.dbPath;
			}
			return path.join(repoRoot, 'dataStore', 'forgeStore.sqlite');
		};

		// -----
		// readBlockText — file path, or '-' for stdin

		const readBlockText = (blockSource) => {
			if (blockSource === '-') {
				return fs.readFileSync(0, 'utf8');
			}
			return fs.readFileSync(blockSource, 'utf8');
		};

		// -----
		// blockMetaFromHeader — type/subject/version/requires are a PROJECTION of the
		// PG-JSONL header (schemas.md §2: the header is authoritative). subject is the
		// standardKey; a consolidated relationships block has none (=> null); a per-pair
		// relationships block (future) projects pairA::pairB.

		//
		// L9: the header parse is guarded — a malformed first line returns { error } for the
		// caller's error channel (named, explicit), never a raw JSON.parse stack. The guard is
		// isolated to the parse itself (the sanctioned local exception).

		const blockMetaFromHeader = (text) => {
			const firstLine = `${text}`.split('\n')[0];
			let header;
			try {
				header = JSON.parse(firstLine);
			} catch (parseErr) {
				return {
					error:
						`block header (first line) is not valid JSON (${parseErr.message}): ` +
						`${firstLine.slice(0, 120)}`,
				};
			}
			const subject =
				header.standardKey != null
					? header.standardKey
					: header.pairA != null && header.pairB != null
						? `${header.pairA}::${header.pairB}`
						: null;
			return {
				type: header.blockType,
				subject,
				version: header.version != null ? header.version : null,
				requires: Array.isArray(header.requires) ? header.requires : [],
			};
		};

		// =====================================================================
		// COMMAND HANDLERS — each (manifestEditor, callback)
		// =====================================================================

		const handleSave = (manifestEditor, callback) => {
			const blockSource = first('block');
			if (!blockSource) {
				callback(`-save requires --block=<path|->`);
				return;
			}
			const text = readBlockText(blockSource);
			const meta = blockMetaFromHeader(text);
			if (meta.error) {
				callback(`-save: ${meta.error} [${moduleName}]`);
				return;
			}
			if (!meta.type) {
				callback(`-save: block header has no blockType [${moduleName}]`);
				return;
			}
			manifestEditor.saveSchemaBlock(
				{
					type: meta.type,
					subject: meta.subject,
					version: meta.version,
					requires: meta.requires,
					text,
					producedBy: first('producedBy'),
				},
				(err, result) =>
					callback(err, err ? undefined : { blockId: result.blockId }),
			);
		};

		const handleCombine = (manifestEditor, callback) => {
			const set = list('set');
			if (set.length === 0) {
				callback(`-combine requires --set=<blockId>[,<blockId>...]`);
				return;
			}
			manifestEditor.combine(
				{
					base: first('base'),
					set,
					label: first('label'),
					note: first('note'),
				},
				(err, result) => callback(err, err ? undefined : result),
			);
		};

		const handleValidate = (manifestEditor, callback) => {
			const manifest = first('manifest');
			if (!manifest) {
				callback(`-validate requires --manifest=<manifestKey>`);
				return;
			}
			manifestEditor.validate({ manifest }, (err, verdict) =>
				callback(err, err ? undefined : verdict),
			);
		};

		const handleShow = (manifestEditor, callback) => {
			const manifest = first('manifest');
			if (!manifest) {
				callback(`-show requires --manifest=<manifestKey>`);
				return;
			}
			manifestEditor.show({ manifest }, (err, shown) =>
				callback(err, err ? undefined : shown),
			);
		};

		const handleDiff = (manifestEditor, callback) => {
			const from = first('from');
			const to = first('to');
			if (!from || !to) {
				callback(`-diff requires --from=<manifestKey> --to=<manifestKey>`);
				return;
			}
			manifestEditor.diff({ from, to }, (err, delta) =>
				callback(err, err ? undefined : delta),
			);
		};

		const handleListBlocks = (manifestEditor, callback) => {
			manifestEditor.listBlocks((err, blocks) =>
				callback(err, err ? undefined : blocks),
			);
		};

		const handleListManifests = (manifestEditor, callback) => {
			manifestEditor.listManifests((err, manifests) =>
				callback(err, err ? undefined : manifests),
			);
		};

		// dispatch map (registry pattern — the single action switch selects a handler)
		const dispatchMap = {
			save: handleSave,
			combine: handleCombine,
			validate: handleValidate,
			show: handleShow,
			diff: handleDiff,
			listBlocks: handleListBlocks,
			listManifests: handleListManifests,
		};

		// =====================================================================
		// ORCHESTRATION — help, select action, open store, dispatch
		// =====================================================================

		if (commandLineParameters.switches.help || commandLineParameters.switches.h) {
			xLog.status(helpText);
			return {};
		}

		const selectedActions = Object.keys(dispatchMap).filter(
			(oneAction) => commandLineParameters.switches[oneAction],
		);

		if (selectedActions.length === 0) {
			xLog.error(
				`no action: one of -save -combine -validate -show -diff -listBlocks -listManifests is required (use --help)`,
			);
			return {};
		}
		if (selectedActions.length > 1) {
			xLog.error(
				`one action at a time, got: ${selectedActions.map((oneAction) => `-${oneAction}`).join(' ')}`,
			);
			return {};
		}

		const actionName = selectedActions[0];
		const dbPath = resolveDbPath();

		const taskList = new taskListPlus();

		// ensure the store directory exists
		taskList.push((args, next) => {
			const storeDir = path.dirname(dbPath);
			if (!fs.existsSync(storeDir)) {
				fs.mkdirSync(storeDir, { recursive: true });
			}
			next('', args);
		});

		// open + init the store
		taskList.push((args, next) => {
			const forgeStore = forgeStoreFactory();
			forgeStore.init({ dbPath }, (err) =>
				next(err, { ...args, forgeStore }),
			);
		});

		// instantiate the compose layer + dispatch the selected action
		taskList.push((args, next) => {
			const manifestEditor = manifestEditorFactory({
				forgeStore: args.forgeStore,
			});
			dispatchMap[actionName](manifestEditor, (err, result) =>
				next(err, { ...args, result }),
			);
		});

		pipeRunner(taskList.getList(), {}, (err, args) => {
			if (err) {
				xLog.error(`manifestEditor -${actionName} failed: ${err}`);
				process.exitCode = 1;
				return;
			}
			xLog.result(JSON.stringify(args.result, null, 2));
		});

		return {};
	};

// END OF moduleFunction() ============================================================

// prettier-ignore
{
	process.global = {};
	process.global.xLog = fs.existsSync('./lib/x-log')
		? require('./lib/x-log')
		: { status: console.error, error: console.error, result: console.log };
	process.global.getConfig = typeof(getConfig) != 'undefined'
		? getConfig
		: (moduleName => ({ [moduleName]: undefined }[moduleName]));
	process.global.commandLineParameters = typeof(commandLineParameters) != 'undefined'
		? commandLineParameters
		: undefined;
	process.global.rawConfig = {};
}

module.exports = moduleFunction({ moduleName })({});
