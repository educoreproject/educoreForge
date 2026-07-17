#!/usr/bin/env node
'use strict';

// =====================================================================
// edf-ctdl-uri-bridge — Phase 3.5 CTDL-family structural URI bridge (ADDITIVE, verification-only)
// =====================================================================
// Authors the cross-standard STRUCTURAL relationships that the CTDL-family standards (CTDLASN,
// CTDLQData) declare toward CTDL `ceterms:` classes but that the assembly NEVER materializes —
// because the standard-pure ASN/QData forges only stashCrossRef these (never emit a cross-standard
// edge), and the sole promoter of cross-standard edges (forge-ctdl's unfiltered foreign emission)
// covers only relationships CTDL's OWN schema reciprocally declares. The already-materialized
// relationships (142) are left untouched; ONLY the genuinely-unbridged (229) are authored here.
//
// This is a faithful sibling of bridge-maker/edf-mapping (which authors EXACT_MATCH classification
// edges keyed on cedsId). It differs on THREE axes, all deliberate:
//   1. JOIN KEY: the RAW CURIE in each crossRef (crossRef.raw) resolved against the existing node
//      whose uri/stableId equals that CURIE — a deterministic same-URI identity join, NOT a cedsId
//      or pForm anchor strategy, NOT similarity/embeddings/LLM.
//   2. EDGE SEMANTICS: CORRECTLY-TYPED STRUCTURAL edges (per the crossRef locator) — NOT EXACT_MATCH.
//      There is ZERO resolvable equivalence in this golden (the only equivalence locator,
//      owl:equivalentClass, is entirely CEDS-targeted and unresolved), so NO SSSOM predicate is
//      emitted. domainIncludes->HAS_PROPERTY, rangeIncludes->REFERENCES, subClassOf->SUBCLASS_OF,
//      targetScheme->HAS_OPTION_SET (the golden's schema-view vocabulary; the forge emits
//      CONSTRAINED_BY natively but the golden materializes HAS_OPTION_SET).
//   3. BLOCK TYPE: a SINGLE non-pairwise type='bridge' block (the sanctioned structural-cross-edge
//      carrier) with a DISTINCT subject 'ctdlFamilyUriBridge' — deliberately NOT a forgeManager
//      pairwise subject — so it never collides with the native pairwise bridge blocks. type='mapping'
//      is reserved (forge-store §4.2) for pair-keyed SSSOM classification blocks; structural edges
//      do not belong there.
//
// PROVENANCE: block-level producedBy='edf-ctdl-uri-bridge'; EVERY edge carries provenanceSource
// 'uriBridge' + bridgeAuthored true + crossRefLocator + provenanceTier structural, so the authored
// edges are QUERYABLE and REMOVABLE by marker and can NEVER read as forge-native. NEVER-FABRICATE:
// crossRefs whose target URI is absent from the golden are REPORTED, never invented.
//
// OUTPUT: saves the bridge block into the store named by EDF_FORGE_STORE_DB (scratch; the canonical
// store is NEVER written), then saves a candidate manifest = the gating golden's members + the bridge
// block (additive; basedOn the golden). Verification-only — nothing ships.
//
// USAGE:
//   EDF_FORGE_STORE_DB=/tmp/edfPhase3Scratch.sqlite3 \
//     node edfCtdlUriBridge.js -build --manifest=<goldenKey> [--subject=ctdlFamilyUriBridge] \
//       [--label=<text>] [--keyOut=<path>]
// =====================================================================

const path = require('path');
const fs = require('fs');
const os = require('os');

const commandLineParser = require('qtools-parse-command-line');
const configFileProcessor = require('qtools-config-file-processor');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const commandLineParameters = commandLineParser.getParameters();

// --------------------------------------------------------------------------------
// PROJECT ROOT + PATHS (mirror edf-mapping)
const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();
const CORE_LIB = path.join(projectRoot, 'code', 'npm', 'qtools-graph-forge-core', 'lib');
const CONFIGS_DIR = path.join(projectRoot, 'configs');

const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));
const { PROVENANCE_TIER } = require(path.join(CORE_LIB, 'vocabulary', 'vocabulary'));

const DEFAULT_SUBJECT = 'ctdlFamilyUriBridge';
const PRODUCED_BY = 'edf-ctdl-uri-bridge';
const PROVENANCE_SOURCE = 'uriBridge';

// crossRef locator -> the CORRECT structural edge (type + direction). Ratified by FADED_FORGE.
// MOVED (forgeArchitectureRefactor SPECIFICATION v2 S2): the table's single source of truth
// is now the ctdlFamilyStructure module; this tool consumes it from there until its retirement.
const { LOCATOR_EDGE } = require(
	path.join(projectRoot, 'code', 'cli', 'parserLib', 'forge-ctdl', 'modules', 'ctdlFamilyStructure'),
);

// =====================================================================
// BOOTSTRAP process.global (mirror edf-mapping.bootstrapGlobal)
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
			? 'instanceSpecific/qbook'
			: '';
	const systemIni = path.join(CONFIGS_DIR, hostConfigName, 'systemParameters.ini');
	if (fs.existsSync(systemIni)) {
		wholeConfig = configFileProcessor.getConfig(systemIni) || {};
	}
	process.global = {
		xLog,
		getConfig: (name) => (name === 'allConfigs' ? wholeConfig : wholeConfig[name] || {}),
		commandLineParameters,
		rawConfig: wholeConfig,
	};
};

// edge serialization shape (mirror edf-mapping.toBlockEdge): every property value is a PG-JSON array.
const toBlockEdge = (oneEdge) => {
	const properties = {};
	Object.keys(oneEdge.properties || {}).forEach((oneKey) => {
		const value = oneEdge.properties[oneKey];
		properties[oneKey] = Array.isArray(value) ? value : [value];
	});
	return {
		type: oneEdge.type,
		fromRef: oneEdge.fromRef,
		toRef: oneEdge.toRef,
		properties,
	};
};

// firstValue — PG-JSON single-element [x] -> x (deserializeBlock returns raw property arrays).
const firstValue = (oneVal) => (Array.isArray(oneVal) ? oneVal[0] : oneVal);

// parseCrossRefs — the crossRefs property is a single-element array whose [0] is a JSON string
// (or the literal '[]'). Returns an array of { raw, system, locator } (empty when none).
const parseCrossRefs = (properties) => {
	const rawStash = firstValue((properties || {}).crossRefs);
	if (rawStash === undefined || rawStash === null || rawStash === '') {
		return [];
	}
	let parsed;
	if (typeof rawStash === 'string') {
		// the one sanctioned local parse guard (mirrors forge-store's requires guard): a corrupt
		// crossRefs stash surfaces as a named error, never a raw stack.
		let guardError = null;
		const attempt = (() => {
			try {
				return JSON.parse(rawStash);
			} catch (parseErr) {
				guardError = parseErr;
				return null;
			}
		})();
		if (guardError) {
			return { error: `crossRefs stash is not valid JSON: ${guardError.message}` };
		}
		parsed = attempt;
	} else {
		parsed = rawStash;
	}
	return Array.isArray(parsed) ? parsed : [];
};

// =====================================================================
// shared resources (mirror edf-mapping.buildSharedResources — EDF_FORGE_STORE_DB override)
// =====================================================================
const buildSharedResources = (callback) => {
	const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
	// EDF_FORGE_STORE_DB redirects the store (verification harness); absent -> canonical, byte-identical.
	// An active override is ANNOUNCED on stderr so it can never silently redirect a production write.
	const dbPath =
		process.env.EDF_FORGE_STORE_DB ||
		path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3');
	if (process.env.EDF_FORGE_STORE_DB) {
		console.error(`STORE OVERRIDE ACTIVE: forgeStore db = ${dbPath} (EDF_FORGE_STORE_DB)`);
	}
	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		forgeStore.init({ dbPath }, (err) => next(err, args));
	});
	pipeRunner(taskList.getList(), {}, (err) => {
		callback(err, { forgeStore });
	});
};

// =====================================================================
// ACTION: -build
// =====================================================================
const handleBuild = (resources, callback) => {
	const { xLog } = process.global;
	const { forgeStore } = resources;

	const manifestKey = (commandLineParameters.values.manifest || [])[0] || null;
	const subject = (commandLineParameters.values.subject || [])[0] || DEFAULT_SUBJECT;
	const label =
		(commandLineParameters.values.label || [])[0] || 'phase3.5-ctdlFamilyUriBridge-candidate';
	const keyOut = (commandLineParameters.values.keyOut || [])[0] || null;

	if (!manifestKey) {
		callback('edf-ctdl-uri-bridge -build: --manifest=<goldenManifestKey> is required');
		return;
	}

	const taskList = new taskListPlus();

	// 1) read the gating manifest members
	taskList.push((args, next) => {
		forgeStore.getManifest({ manifestKey }, (err, manifest) => {
			if (err) {
				next(`getManifest('${manifestKey}') failed: ${err}`);
				return;
			}
			if (!manifest) {
				next(`no gating manifest '${manifestKey}'`);
				return;
			}
			next('', { ...args, members: manifest.members || [] });
		});
	});

	// 2) read + deserialize every member block; accumulate the node universe, crossRefs (from
	//    STANDARD blocks) and the existing typed-edge set (from ALL member blocks).
	taskList.push((args, next) => {
		const existing = new Set(); // every uri/stableId that resolves to a real node
		const nodeIds = new Map(); // stableId -> Set(identifiers: stableId + uris)
		const nodeSource = new Map(); // identifier -> surviving _source scalar
		const typedEdges = new Set(); // `${type} ${fromId} ${toId}`
		const crossRefRows = []; // { sid, srcIds:Set, raw, locator }
		let standardBlockCount = 0;

		const edgeKey = (type, fromId, toId) => `${type} ${fromId} ${toId}`;

		const sub = new taskListPlus();
		args.members.forEach((oneMember) => {
			sub.push((a2, n2) => {
				forgeStore.getBlock({ blockId: oneMember.blockId }, (err, row) => {
					if (err) {
						n2(`getBlock('${oneMember.blockId}') failed: ${err}`);
						return;
					}
					if (!row) {
						n2(`member block '${oneMember.blockId}' not found`);
						return;
					}
					let block;
					// deserializeBlock throws LOUD on a corrupt block; convert to the error channel.
					let guardError = null;
					block = (() => {
						try {
							return replayBlock.deserializeBlock(row.text);
						} catch (deErr) {
							guardError = deErr;
							return null;
						}
					})();
					if (guardError) {
						n2(`deserializeBlock('${oneMember.blockId}') failed: ${guardError.message}`);
						return;
					}

					// edges from ALL member blocks (standard + bridge) -> the existing-edge universe
					(block.edges || []).forEach((oneEdge) => {
						typedEdges.add(
							edgeKey(oneEdge.type, oneEdge.fromRef.id, oneEdge.toRef.id),
						);
					});

					// nodes + crossRefs from STANDARD blocks only
					if (row.type === 'standard') {
						standardBlockCount++;
						(block.nodes || []).forEach((oneNode) => {
							const sid = oneNode.stableId;
							const props = oneNode.properties || {};
							const ids = new Set();
							if (sid) {
								ids.add(sid);
							}
							const uriList = (props.uri || []).map((oneUri) => oneUri);
							uriList.forEach((oneUri) => ids.add(oneUri));
							const survivingSource = firstValue(props._source) || row.subject;
							ids.forEach((oneId) => {
								existing.add(oneId);
								nodeSource.set(oneId, survivingSource);
							});
							if (sid) {
								nodeIds.set(sid, ids);
							}

							const crossRefs = parseCrossRefs(props);
							if (crossRefs && crossRefs.error) {
								n2(`node '${sid}' crossRefs: ${crossRefs.error}`);
								return;
							}
							(crossRefs || []).forEach((oneRef) => {
								const raw = oneRef.raw || oneRef.id;
								crossRefRows.push({
									sid,
									srcIds: ids,
									raw,
									locator: oneRef.locator,
								});
							});
						});
					}
					n2('', a2);
				});
			});
		});

		pipeRunner(sub.getList(), {}, (err) => {
			if (err) {
				next(err);
				return;
			}
			next('', {
				...args,
				existing,
				nodeIds,
				nodeSource,
				typedEdges,
				crossRefRows,
				standardBlockCount,
				edgeKey,
			});
		});
	});

	// 3) resolve each crossRef: resolvable? already-bridged? -> emit the missing structural edge.
	taskList.push((args, next) => {
		const { existing, nodeSource, typedEdges, crossRefRows, edgeKey } = args;
		const emittedEdges = [];
		const unresolved = new Set();
		let alreadyBridged = 0;
		let skippedUnknownLocator = 0;
		const byType = {};

		crossRefRows.forEach((oneRow) => {
			const { srcIds, raw, locator } = oneRow;
			if (!existing.has(raw)) {
				unresolved.add(raw);
				return;
			}
			const rule = LOCATOR_EDGE[locator];
			if (!rule) {
				skippedUnknownLocator++;
				return;
			}
			// expected edge exists already (any source-identifier form)? -> leave it; do NOT duplicate.
			let bridgedAlready = false;
			srcIds.forEach((oneSrcId) => {
				const [fromId, toId] =
					rule.direction === 'targetToSource' ? [raw, oneSrcId] : [oneSrcId, raw];
				if (typedEdges.has(edgeKey(rule.type, fromId, toId))) {
					bridgedAlready = true;
				}
			});
			if (bridgedAlready) {
				alreadyBridged++;
				return;
			}
			// GENUINELY UNBRIDGED -> author the correctly-typed structural edge (canonical: stableId form).
			const [fromId, toId] =
				rule.direction === 'targetToSource' ? [raw, oneRow.sid] : [oneRow.sid, raw];
			emittedEdges.push({
				type: rule.type,
				fromRef: { source: nodeSource.get(fromId) || null, id: fromId },
				toRef: { source: nodeSource.get(toId) || null, id: toId },
				properties: {
					provenanceTier: PROVENANCE_TIER.STRUCTURAL,
					provenanceSource: PROVENANCE_SOURCE,
					bridgeAuthored: true,
					crossRefLocator: locator,
					owner: ':golden',
				},
			});
			byType[rule.type] = (byType[rule.type] || 0) + 1;
		});

		// DETERMINISM: content-address is byte-stable only if the caller supplies stable order.
		emittedEdges.sort((leftEdge, rightEdge) => {
			const leftKey = edgeKey(leftEdge.type, leftEdge.fromRef.id, leftEdge.toRef.id);
			const rightKey = edgeKey(rightEdge.type, rightEdge.fromRef.id, rightEdge.toRef.id);
			return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
		});

		next('', {
			...args,
			emittedEdges,
			unresolvedList: Array.from(unresolved).sort(),
			alreadyBridged,
			skippedUnknownLocator,
			byType,
		});
	});

	// 4) serialize + saveBlock (type='bridge', non-version-keyed, distinct non-pairwise subject).
	taskList.push((args, next) => {
		const header = {
			blockType: 'bridge',
			// NON-pairwise on purpose (this block spans CTDL::CTDLASN, CTDL::CTDLQData,
			// CTDLASN::CTDLQData). pairA/pairB deliberately omitted -> a family-scoped bridge.
			stableUriPropertyName: 'uri',
			resolutionKey: 'uri',
			goldenVersionAuthoredAgainst: manifestKey,
		};
		const blockText = replayBlock.serializeBlock({
			header,
			nodes: [], // structural bridge edges only (reify-on-demand); zero nodes
			edges: args.emittedEdges.map(toBlockEdge),
		});

		// guardrail: prove the block round-trips before saving (edge types valid, header well-formed).
		let rtError = null;
		const readBack = (() => {
			try {
				return replayBlock.deserializeBlock(blockText);
			} catch (rtErr) {
				rtError = rtErr;
				return null;
			}
		})();
		if (rtError) {
			next(`serialize/deserialize round-trip FAILED: ${rtError.message}`);
			return;
		}
		if (readBack.edges.length !== args.emittedEdges.length || readBack.nodes.length !== 0) {
			next(
				`round-trip mismatch: wrote ${args.emittedEdges.length} edges/0 nodes, read ${readBack.edges.length}/${readBack.nodes.length}`,
			);
			return;
		}

		const requires = args.members.map((oneMember) => oneMember.blockId);
		forgeStore.saveBlock(
			{
				type: 'bridge',
				subject,
				version: manifestKey,
				requires,
				text: blockText,
				producedBy: PRODUCED_BY,
			},
			(err, result) => {
				if (err) {
					next(`saveBlock (bridge) failed: ${err}`);
					return;
				}
				xLog.status(
					`[edf-ctdl-uri-bridge] bridge block saved: ${result.blockId.slice(0, 12)}… ` +
						`(${blockText.split('\n').filter(Boolean).length} lines, ${args.emittedEdges.length} edges)`,
				);
				next('', { ...args, bridgeBlockId: result.blockId });
			},
		);
	});

	// 5) assemble the CANDIDATE manifest = gating members + the bridge block (ADDITIVE).
	taskList.push((args, next) => {
		const members = args.members
			.map((oneMember) => ({ blockId: oneMember.blockId, position: null }))
			.concat([{ blockId: args.bridgeBlockId, position: null }]);
		forgeStore.saveManifest(
			{
				label,
				basedOn: manifestKey,
				note: `Phase 3.5 additive CTDL-family structural URI bridge (${args.emittedEdges.length} edges) layered on the gating golden`,
				members,
			},
			(err, result) => {
				if (err) {
					next(`saveManifest failed: ${err}`);
					return;
				}
				next('', { ...args, candidateManifestKey: result.manifestKey });
			},
		);
	});

	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		if (keyOut) {
			fs.writeFileSync(keyOut, args.candidateManifestKey);
		}
		xLog.result(
			JSON.stringify(
				{
					action: 'build',
					gatingManifest: manifestKey,
					subject,
					producedBy: PRODUCED_BY,
					provenanceSource: PROVENANCE_SOURCE,
					standardBlocks: args.standardBlockCount,
					bridgeBlockId: args.bridgeBlockId,
					candidateManifestKey: args.candidateManifestKey,
					counts: {
						crossRefsTotal: args.crossRefRows.length,
						edgesAuthored: args.emittedEdges.length,
						alreadyBridged: args.alreadyBridged,
						unresolved: args.unresolvedList.length,
						skippedUnknownLocator: args.skippedUnknownLocator,
					},
					byType: args.byType,
					unresolvedList: args.unresolvedList,
				},
				null,
				2,
			),
		);
		callback('');
	});
};

// =====================================================================
// DISPATCH
// =====================================================================
const dispatchMap = {
	build: handleBuild,
};

const main = () => {
	bootstrapGlobal();
	const { xLog } = process.global;
	const action = Object.keys(commandLineParameters.switches).find(
		(oneSwitch) => dispatchMap[oneSwitch],
	);
	if (!action) {
		xLog.error(
			'edf-ctdl-uri-bridge: unknown action. Actions: -build. ' +
				'Params: --manifest=<goldenKey> [--subject=ctdlFamilyUriBridge] [--label=<text>] [--keyOut=<path>]',
		);
		process.exit(2);
	}
	buildSharedResources((err, resources) => {
		if (err) {
			xLog.error(`edf-ctdl-uri-bridge bootstrap failed: ${err}`);
			process.exit(2);
		}
		dispatchMap[action](resources, (actionErr) => {
			if (actionErr) {
				xLog.error(`edf-ctdl-uri-bridge -${action}: ${actionErr}`);
				process.exit(1);
			}
			process.exit(0);
		});
	});
};

main();
