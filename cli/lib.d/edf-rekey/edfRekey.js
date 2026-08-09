#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// edfRekey.js — the `edf-rekey` CLI: the Phase-C RE-KEY TRANSFORMER (BINDING spec §4,
// WORKORDER Phase C work item 3). A DETERMINISTIC, ZERO-LLM tool that reads an existing
// mapping block, rewrites ONLY the header line (pair subject + version key + provenance),
// preserves every subsequent byte of the block text VERBATIM, and saves the result as a
// NEW content-addressed block. Nothing existing is ever mutated (append-only doctrine).
//
//   edfRekey -census    [--manifest=<key>] [--db=<path>]
//   edfRekey -transform --sourceBlock=<blockId> [--dryRun] [--db=<path>]
//
// -census    : STORE-QUERY inventory (front-gate F2): every member of the manifest whose
//              type is REKEYABLE (mapping types ∪ structuralBridge — S1.3a), with its
//              derived pair, tierScope, and edge region digest — the disposition
//              table's mechanical core. Read-only.
// -transform : re-key ONE block. The new text = newHeaderLine + '\n' + (every byte of the
//              source text after its first newline, untouched) — byte-preservation holds
//              BY CONSTRUCTION and is re-verified by digest before the save.
//
// PROVENANCE (supervisor-ruled D7): the transformed header REPLACES standardKey with the
// pair fields; preserves blockType/serializerVersion/version/stableUriPropertyName/
// resolutionKey and every other original field in original insertion order; APPENDS
// pairA/pairAVersion/pairB/pairBVersion + publishedVersionA/publishedVersionB + tierScope
// (Q11: derived from the original subject's suffix) + sourceBlockId + originalProducedBy +
// originalStandardKey + originalSubject. Row producedBy = 'edf-rekey' — transformation
// never masquerades as original authorship. requires copied VERBATIM from the source row.
//
// PAIR DERIVATION: HEADER-PAIR-FIRST (forgeArchitectureRefactor S1.3b) — a block whose
// header already names pairA/pairB derives from the HEADER through discovery casing,
// never from edge-endpoint uniformity (structural bridges are inherently bidirectional
// per the ratified LOCATOR_EDGE table, so the uniform-endpoint rule can never describe
// them). Legacy standardKey-headed blocks keep the original branches: hub-pair blocks
// (tierScope property|value) pair CEDS::<header standardKey resolved through discovery
// casing> (D6, Q10); crosswalk blocks (tierScope crosswalk) pair by their EDGE
// ENDPOINTS — pairA = the uniform fromRef.source, pairB = the uniform toRef.source
// (Q12: an island-to-island crosswalk never read the hub; a non-uniform endpoint set
// is a loud refusal, never a guess).
//
// ZERO-LLM ABSOLUTE: this module imports neither llm-client nor embedding-client (the
// G-C7 grep gate proves it). It re-keys frozen blocks; it never re-infers.
//
// Async style: qtools-asynchronous-pipe; no async/await; no try/catch control flow
// (header parse guards are the sanctioned local exception). camelCase only.

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const commandLineParser = require('qtools-parse-command-line');
const commandLineParameters = commandLineParser.getParameters();
const configFileProcessor = require('qtools-config-file-processor');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// --------------------------------------------------------------------------------
// PROJECT ROOT + PATHS (mirror edf-reference)
const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();
const CORE_LIB = path.join(projectRoot, 'code', 'npm', 'qtools-graph-forge-core', 'lib');
const CONFIGS_DIR = path.join(projectRoot, 'configs');

const {
	REKEYABLE_BLOCK_TYPES,
	isRekeyableBlockType,
	STRUCTURAL_BRIDGE_BLOCK_TYPE,
	PROVENANCE_TIER,
	pairSubjectText,
	versionKeyText,
} = require(path.join(CORE_LIB, 'vocabulary', 'vocabulary'));
const pairBinding = require(path.join(CORE_LIB, 'pair-binding', 'pair-binding'))({});
const standardDiscovery = require(path.join(
	projectRoot,
	'code',
	'cli',
	'lib.d',
	'forger',
	'lib',
	'standard-discovery',
));

// =====================================================================
// BOOTSTRAP process.global (mirror edf-reference.bootstrapGlobal)
// =====================================================================
const bootstrapGlobal = () => {
	const verbose = !!commandLineParameters.switches.verbose;
	const xLog = {
		status: (...a) => console.error(...a),
		error: (...a) => console.error(...a),
		result: (...a) => console.log(...a),
		verbose: verbose ? (...a) => console.error(...a) : () => {},
	};
	let wholeConfig = {};
	const hostConfigName =
		os.hostname() === 'qMax.local' || os.hostname() === 'qbook.local'
			? 'qbook'
			: 'instanceSpecific';
	const configPath = path.join(CONFIGS_DIR, 'instanceSpecific', hostConfigName, 'systemParameters.ini');
	if (fs.existsSync(configPath)) {
		wholeConfig = configFileProcessor.getConfig(configPath) || {};
	}
	const getConfig = (sectionName) => wholeConfig[sectionName] || {};
	process.global = { xLog, getConfig, commandLineParameters };
};

// =====================================================================
// helpers
// =====================================================================
const strParam = (name, dflt) => {
	const values = commandLineParameters.values[name];
	return values && values.length ? values[0] : dflt;
};

const sha256Hex = (text) => crypto.createHash('sha256').update(text).digest('hex');

// parseHeaderLine — guarded parse of a block text's first line (the sanctioned local
// exception; a malformed header is a named error on the error channel).
const parseHeaderLine = (text) => {
	const firstLine = `${text}`.split('\n')[0];
	let header;
	try {
		header = JSON.parse(firstLine);
	} catch (parseErr) {
		return { error: `block header (line 1) is not valid JSON (${parseErr.message})` };
	}
	return { header, firstLine };
};

// afterFirstNewline — EVERY byte of the text after the first '\n', verbatim (incl. the
// trailing-newline shape). The transformer's byte-preservation guarantee is over THIS —
// stricter than the reporting digest below.
const afterFirstNewline = (text) => {
	const idx = `${text}`.indexOf('\n');
	return idx === -1 ? '' : `${text}`.slice(idx + 1);
};

// edgeRegionDigest — THE PHASE-0 CONVENTION (mappingInventory-preC.json): sha256 of
// lines 2..N, empties dropped, '\n'-joined, NO trailing newline. Empirically bisected
// against the frozen inventory (the raw-byte region differs by the trailing '\n' alone);
// every digest this tool REPORTS uses this convention so G-C3 reconciles against the
// frozen file's numbers, never fresh counting conventions.
const edgeRegionDigest = (text) =>
	sha256Hex(
		`${text}`
			.split('\n')
			.slice(1)
			.filter((oneLine) => oneLine.trim().length > 0)
			.join('\n'),
	);

// tierScopeForOriginalSubject — Q11(c): the mechanical suffix derivation.
const tierScopeForOriginalSubject = (subject) => {
	if (`${subject}`.endsWith('-value')) return 'value';
	if (`${subject}`.endsWith('-crosswalk')) return 'crosswalk';
	return 'property';
};

// crosswalkEndpoints — scan EVERY edge line; the from/to sources must each be UNIFORM
// (a mixed-endpoint crosswalk block is a loud refusal, never a guess). Returns
// { fromSource, toSource } | { error }.
const crosswalkEndpoints = (text) => {
	const lines = `${text}`.split('\n').filter((oneLine) => oneLine.trim().length > 0);
	const fromSources = new Set();
	const toSources = new Set();
	for (let index = 1; index < lines.length; index++) {
		let edge;
		try {
			edge = JSON.parse(lines[index]);
		} catch (parseErr) {
			return { error: `edge line ${index + 1} is not valid JSON (${parseErr.message})` };
		}
		if (edge.kind !== 'edge') {
			return { error: `line ${index + 1} kind '${edge.kind}' is not 'edge' — not an edges-only mapping block` };
		}
		fromSources.add(edge.fromRef.source);
		toSources.add(edge.toRef.source);
	}
	if (fromSources.size !== 1 || toSources.size !== 1) {
		return {
			error:
				`crosswalk endpoints are not uniform (from: ${[...fromSources].join(',')}; ` +
				`to: ${[...toSources].join(',')}) — refusing to derive a pair`,
		};
	}
	return { fromSource: [...fromSources][0], toSource: [...toSources][0] };
};

// derivePairStamp — the transformer's pair derivation for ONE source block row.
//   hub-pair blocks: CEDS::<header standardKey via discovery casing> (D6/Q10).
//   crosswalk blocks: edge-endpoint pair (Q12).
// -> { pairA, pairAVersion, publishedVersionA, pairB, pairBVersion, publishedVersionB,
//      pairSubject, versionKey, tierScope } | { error }
const derivePairStamp = ({ row, header, warn }) => {
	const roster = standardDiscovery.roster({ includeSynthetic: true });

	// HEADER-PAIR-FIRST (S1.3b): when the header names its pair, the header WINS —
	// resolve both names through discovery casing at their CURRENT default snapshots
	// (rekey's job is following a version change). resolvePairBinding is caller-order-
	// preserving (pair-binding.js pairA = first argument's discovery casing), so the
	// header's family-root-first ordering (S11) survives resolution. tierScope: the
	// header's own value when present; a structuralBridge block without one carries
	// the structural tier by definition; anything else keeps the legacy suffix rule.
	if (header.pairA != null && header.pairB != null) {
		const binding = pairBinding.resolvePairBinding({
			roster,
			hubStandardName: header.pairA,
			spokeStandardName: header.pairB,
			warn,
		});
		if (binding.error) {
			return { error: `header-pair derivation failed: ${binding.error}` };
		}
		const headerTierScope =
			header.tierScope != null
				? header.tierScope
				: header.blockType === STRUCTURAL_BRIDGE_BLOCK_TYPE
					? PROVENANCE_TIER.STRUCTURAL
					: tierScopeForOriginalSubject(row.subject);
		return { ...binding, tierScope: headerTierScope };
	}

	const tierScope = tierScopeForOriginalSubject(row.subject);

	if (tierScope === 'crosswalk') {
		const endpoints = crosswalkEndpoints(row.text);
		if (endpoints.error) {
			return { error: `crosswalk pair derivation failed: ${endpoints.error}` };
		}
		const binding = pairBinding.resolvePairBinding({
			roster,
			hubStandardName: endpoints.fromSource,
			spokeStandardName: endpoints.toSource,
			warn,
		});
		if (binding.error) {
			return { error: binding.error };
		}
		return { ...binding, tierScope };
	}

	if (!header.standardKey) {
		return {
			error: `header carries no standardKey — cannot derive the hub pair (subject '${row.subject}')`,
		};
	}
	const binding = pairBinding.resolvePairBinding({
		roster,
		hubStandardName: standardDiscovery.cedsHubStandardName,
		spokeStandardName: header.standardKey,
		warn,
	});
	if (binding.error) {
		return { error: binding.error };
	}
	return { ...binding, tierScope };
};

// composeTransformedHeader — D7: original fields in original insertion order,
// standardKey REMOVED, pair/tierScope/provenance fields APPENDED.
const composeTransformedHeader = ({ header, pairStamp, row }) => {
	const transformed = {};
	Object.keys(header).forEach((oneKey) => {
		if (oneKey === 'standardKey') {
			return; // replaced by the pair fields (the manifestEditor:147 projection hazard)
		}
		transformed[oneKey] = header[oneKey];
	});
	transformed.pairA = pairStamp.pairA;
	transformed.pairAVersion = pairStamp.pairAVersion;
	transformed.pairB = pairStamp.pairB;
	transformed.pairBVersion = pairStamp.pairBVersion;
	transformed.publishedVersionA = pairStamp.publishedVersionA;
	transformed.publishedVersionB = pairStamp.publishedVersionB;
	transformed.tierScope = pairStamp.tierScope;
	transformed.sourceBlockId = row.blockId;
	transformed.originalProducedBy = row.producedBy;
	transformed.originalStandardKey = header.standardKey != null ? header.standardKey : null;
	transformed.originalSubject = row.subject;
	return transformed;
};

// =====================================================================
// shared resources
// =====================================================================
const buildSharedResources = (callback) => {
	const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
	const dbPath =
		strParam('db', null) ||
		process.env.EDF_FORGE_STORE_DB ||
		path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3');
	if (process.env.EDF_FORGE_STORE_DB && !strParam('db', null)) {
		console.error(`STORE OVERRIDE ACTIVE: forgeStore db = ${dbPath} (EDF_FORGE_STORE_DB)`);
	}
	forgeStore.init({ dbPath }, (err) => callback(err, { forgeStore, dbPath }));
};

// =====================================================================
// ACTION: -census — the disposition table's mechanical core (read-only store query)
// =====================================================================
const handleCensus = (resources, callback) => {
	const { xLog } = process.global;
	const { forgeStore } = resources;
	const manifestKey = strParam('manifest', null);
	if (!manifestKey) {
		callback('edf-rekey -census: --manifest= is required (the golden of record; never a guess)');
		return;
	}

	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		forgeStore.getManifest({ manifestKey }, (err, manifest) => {
			if (err || !manifest) {
				next(err || `no manifest '${manifestKey}'`);
				return;
			}
			next('', { ...args, members: manifest.members || [] });
		});
	});
	taskList.push((args, next) => {
		const censusRows = [];
		const sub = new taskListPlus();
		args.members.forEach((oneMember) => {
			sub.push((a2, n2) => {
				forgeStore.getBlock({ blockId: oneMember.blockId }, (err, row) => {
					if (err || !row) {
						n2(err || `member block ${oneMember.blockId} not found`);
						return;
					}
					if (!isRekeyableBlockType(row.type)) {
						censusRows.push({
							blockId: row.blockId,
							type: row.type,
							subject: row.subject,
							producedBy: row.producedBy,
							disposition: 'not-a-rekeyable-block-type',
						});
						n2('', a2);
						return;
					}
					const parsed = parseHeaderLine(row.text);
					if (parsed.error) {
						n2(`block ${row.blockId}: ${parsed.error}`);
						return;
					}
					const pairStamp = derivePairStamp({
						row,
						header: parsed.header,
						warn: (message) => xLog.verbose(message),
					});
					const edgeRegion = afterFirstNewline(row.text);
					censusRows.push({
						blockId: row.blockId,
						type: row.type,
						subject: row.subject,
						producedBy: row.producedBy,
						disposition: 'transform-candidate',
						derivedPairSubject: pairStamp.error ? null : pairStamp.pairSubject,
						derivedVersionKey: pairStamp.error ? null : pairStamp.versionKey,
						derivedTierScope: pairStamp.error ? null : pairStamp.tierScope,
						derivationError: pairStamp.error || null,
						edgeLineCount: edgeRegion.split('\n').filter((l) => l.trim().length > 0).length,
						edgeRegionDigest: edgeRegionDigest(row.text),
					});
					n2('', a2);
				});
			});
		});
		pipeRunner(sub.getList(), {}, (err) => next(err, { ...args, censusRows }));
	});

	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		xLog.result(JSON.stringify({ action: 'census', manifestKey, count: args.censusRows.length, censusRows: args.censusRows }, null, 2));
		callback('');
	});
};

// =====================================================================
// ACTION: -transform — re-key ONE block (append-only; the source is never touched)
// =====================================================================
const handleTransform = (resources, callback) => {
	const { xLog } = process.global;
	const { forgeStore } = resources;
	const sourceBlockId = strParam('sourceBlock', null);
	const dryRun = !!commandLineParameters.switches.dryRun;
	if (!sourceBlockId) {
		callback('edf-rekey -transform: --sourceBlock=<blockId> is required');
		return;
	}

	const taskList = new taskListPlus();

	taskList.push((args, next) => {
		forgeStore.getBlock({ blockId: sourceBlockId }, (err, row) => {
			if (err) {
				next(err); // incl. the store's verify-on-read corruption refusal — loud, named
				return;
			}
			if (!row) {
				next(`edf-rekey: no block ${sourceBlockId} in the store`);
				return;
			}
			if (!isRekeyableBlockType(row.type)) {
				next(
					`edf-rekey: block ${sourceBlockId} is type '${row.type}' — not in REKEYABLE_BLOCK_TYPES ` +
						`[${REKEYABLE_BLOCK_TYPES.join(', ')}]; refusing to transform`,
				);
				return;
			}
			next('', { ...args, row });
		});
	});

	taskList.push((args, next) => {
		const { row } = args;
		const parsed = parseHeaderLine(row.text);
		if (parsed.error) {
			next(`edf-rekey: block ${sourceBlockId}: ${parsed.error}`);
			return;
		}
		// the pair-header refusal guards against double-transforming a legacy->pair
		// OUTPUT. A structuralBridge natively carries its pair header (choke-enforced),
		// so the refusal cannot apply to it: its transform IS the version-following
		// re-key to the roster's current defaults via header-pair-first derivation
		// (addendum A1/BR1-1; a dedicated arbitrary-target-version verb remains the
		// BR1-4 future work-order). Idempotent by content address: re-transforming an
		// already-current structuralBridge dedups to the same blockId.
		if (
			row.type !== STRUCTURAL_BRIDGE_BLOCK_TYPE &&
			parsed.header.pairA != null &&
			parsed.header.pairAVersion != null
		) {
			next(
				`edf-rekey: block ${sourceBlockId} already carries a pair header ` +
					`(${parsed.header.pairA}::${parsed.header.pairB}) — refusing to re-transform`,
			);
			return;
		}
		const pairStamp = derivePairStamp({
			row,
			header: parsed.header,
			warn: (message) => xLog.status(`[edf-rekey] ${message}`),
		});
		if (pairStamp.error) {
			next(`edf-rekey: block ${sourceBlockId}: ${pairStamp.error}`);
			return;
		}
		const transformedHeader = composeTransformedHeader({ header: parsed.header, pairStamp, row });
		const edgeRegion = afterFirstNewline(row.text);
		const newText = `${JSON.stringify(transformedHeader)}\n${edgeRegion}`;

		// byte-preservation verification (belt to the by-construction braces): the new
		// text's RAW post-header region must digest IDENTICALLY to the source's (raw-byte,
		// stricter than the Phase-0 reporting convention).
		const sourceRawDigest = sha256Hex(edgeRegion);
		const newRawDigest = sha256Hex(afterFirstNewline(newText));
		if (sourceRawDigest !== newRawDigest) {
			next(
				`edf-rekey: INTERNAL byte-preservation failure on ${sourceBlockId} ` +
					`(source ${sourceRawDigest} vs new ${newRawDigest}) — refusing to save`,
			);
			return;
		}
		next('', { ...args, pairStamp, newText, edgeRegionDigestReported: edgeRegionDigest(row.text) });
	});

	taskList.push((args, next) => {
		if (dryRun) {
			next('', { ...args, saveResult: { blockId: '(dryRun — not saved)' } });
			return;
		}
		forgeStore.saveBlock(
			{
				type: args.row.type,
				subject: args.pairStamp.pairSubject,
				version: args.pairStamp.versionKey,
				requires: args.row.requires, // VERBATIM — the derivation inputs remain true post-re-key
				text: args.newText,
				producedBy: 'edf-rekey',
			},
			(err, result) => next(err, { ...args, saveResult: result }),
		);
	});

	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		xLog.result(
			JSON.stringify(
				{
					action: 'transform',
					dryRun,
					sourceBlockId,
					newBlockId: args.saveResult.blockId,
					pairSubject: args.pairStamp.pairSubject,
					versionKey: args.pairStamp.versionKey,
					tierScope: args.pairStamp.tierScope,
					originalProducedBy: args.row.producedBy,
					originalSubject: args.row.subject,
					edgeRegionDigest: args.edgeRegionDigestReported,
				},
				null,
				2,
			),
		);
		callback('');
	});
};

// =====================================================================
// DISPATCH (registry, not a switch)
// =====================================================================
const helpText = `
edfRekey — the Phase-C deterministic re-key transformer (zero-LLM; append-only).

USAGE
  edfRekey -census    --manifest=<manifestKey> [--db=<sqlitePath>]
  edfRekey -transform --sourceBlock=<blockId> [--dryRun] [--db=<sqlitePath>]

  -census    Read-only store-query inventory of the manifest's mapping-type members with
             derived pair/tierScope and edge-region digests (the disposition table's core).
  -transform Re-key ONE block: new header (pair subject + version key + provenance:
             producedBy 'edf-rekey', sourceBlockId + originalProducedBy preserved), every
             byte after line 1 VERBATIM, saved as a NEW block. The source is never touched.
`;

const actionRegistry = {
	census: handleCensus,
	transform: handleTransform,
};

const main = () => {
	bootstrapGlobal();
	const { xLog } = process.global;
	if (commandLineParameters.switches.help) {
		xLog.status(helpText);
		process.exit(0);
	}
	const requested = Object.keys(actionRegistry).filter(
		(oneName) => commandLineParameters.switches[oneName],
	);
	if (requested.length !== 1) {
		xLog.error(`edf-rekey: exactly one action required. Actions: -census | -transform (see -help)`);
		process.exit(2);
	}
	buildSharedResources((err, resources) => {
		if (err) {
			xLog.error(`edf-rekey: store init failed: ${err}`);
			process.exit(1);
		}
		actionRegistry[requested[0]](resources, (actionErr) => {
			if (actionErr) {
				xLog.error(`edf-rekey: ${actionErr}`);
				process.exit(1);
			}
			process.exit(0);
		});
	});
};

main();
