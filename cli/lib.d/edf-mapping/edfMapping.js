#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// edfMapping.js — the `edf-mapping` CLI: PHASE-4 AUTHORED-CROSSWALK bridge producer (deterministic track).
//
//   edf-mapping -build [--gatingManifest=<key>] [--sourceStandard=EdFi] [--label=<text>] [--keyOut=<path>]
//                      [--includeValues=false]
//
// Converts the AUTHORED Ed-Fi CEDS crosswalk into EXACT_MATCH mapping EDGES (source element -> HubReference)
// PURELY (no LLM, no network), THROUGH the maintained version-bridge table for the CEDS-remodeled person-ids
// (P001070..P001075). Reads the gating manifest's Ed-Fi standard block (source elements carrying cedsId) +
// reference block (HubReferences) from forgeStore + the authored crosswalk CSV (the Yes-row authority via
// edf-gate's ground-truth loader — the SAME source gate 17 joins). Serializes the mappings as ONE additive
// blockType:'mapping' block (edges only; reify-on-demand -> zero MappingAssertion nodes), content-addresses
// it into forgeStore, and assembles a CANDIDATE manifest = (gating members) + (the mapping block). STRICTLY
// ADDITIVE: never supersedes/edits an existing block, NEVER touches the production golden / golden pointer,
// NEVER commits. Mirrors edf-reference/edfReference.js (Phase 3). replay-engine.js is NOT modified by Phase 4
// (the mapping block replays through the existing engine unchanged — edges MERGE on :ForgedNode {stableId},
// both EXACT_MATCH endpoints already carry :ForgedNode); a pre-existing uncommitted :ForgedNode endpoint-
// narrowing change to replay-engine.js remains in-tree (not introduced here), verified safe, slated for the
// Phase-1 commit-isolation step.
//
// CODESET-VALUE (PLAN-codesetValueMatching-070126.md Phase A, added 070126): ALSO converts the AUTHORED
// descriptor ("codeset value") crosswalk (EdFiEntityDescriptorsToCEDS.csv, 8,310 rows; previously loaded
// as fixtures.descriptors but ignored) into value-tier EXACT_MATCH edges, additive alongside the property
// rows — see lib/value-crosswalk.js for the join logic + measured coverage/ambiguity numbers. Requires the
// CEDS 'standard' block in the gating manifest (for source DmeOptionValue notation/rangeOptionSetId); if
// absent, the value track is skipped with a status log (never a hard failure — property track is
// unaffected). --includeValues=false is an escape hatch back to pre-CODESET behavior.
//
// Action flags single-hyphen; parameters double-hyphen. Async style: qtools taskListPlus/pipeRunner; no
// async/await, no try/catch for control flow. camelCase only.

const path = require('path');
const fs = require('fs');
const os = require('os');

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
const GROUND_TRUTH = path.join(projectRoot, 'code', 'cli', 'lib.d', 'edf-gate', 'lib', 'ground-truth', 'groundTruth');

const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));
const mappingSubgraphFactory = require(path.join(CORE_LIB, 'mapping-subgraph', 'mappingSubgraph'));
const versionBridge = require(path.join(__dirname, 'assets', 'versionBridge'));
const valueCrosswalk = require(path.join(__dirname, 'lib', 'value-crosswalk'));

const DEFAULT_GATING_MANIFEST =
	'ef7d99309413d955e4885141c75bde39d92fa559ba6090441b5da83278effc31';

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

// edge serialization shape (mirror edf-reference.toBlockEdge): every property value is a PG-JSON array.
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

// the authored crosswalk as ROW-DRIVEN mappings (the authority; PLAN §Phase 4 "convert each crosswalk row").
// Each authored Yes row whose CEDS target carries an ontology-property Global ID becomes one authored mapping
// { fromStableId, targetKey }: the FROM is the Ed-Fi field node `edfi:field/<EdFiEntity>.<EdFiElementName>`
// (the standard-specific source-element stableId convention — verified to resolve for every Yes row); the
// targetKey is the authored CEDS Global ID (resolved to a HubReference by the PURE core). Yes rows whose CEDS
// target has NO ontology-property Global ID (a class/option-set/datatype element, blank property URI) are NOT
// deterministically resolvable to a property-tier reference and are REPORTED (tokenlessRows), never dropped
// silently. Uses the SAME crosswalk + token extraction gate 17 uses.
const loadAuthoredMappings = ({ sourceStandard } = {}) => {
	const groundTruth = require(GROUND_TRUTH)();
	const fx = groundTruth.loadFixtures();
	const header = fx.elements.header;
	const entityCol = header.find((c) => /^EdFiEntity$/i.test(c));
	const nameCol = header.find((c) => /^EdFiElementName$/i.test(c));
	const uriCol = header.find((c) => /CEDSOntologyPropertyURI/i.test(c));
	const confCol = header.find(
		(c) => /CEDSMappingConfidence/i.test(c) || /MappingConfidence/i.test(c),
	);
	const tokenOf = (uri) => {
		const m = `${uri}`.match(/#?(P\d{6,})\s*$/);
		return m ? m[1] : null;
	};
	// FROM-endpoint stableId convention for the source standard (only Ed-Fi ships an authored CEDS crosswalk).
	const fromStableIdFor = (entity, elementName) => {
		if (`${sourceStandard}` === 'EdFi') {
			return `edfi:field/${entity}.${elementName}`;
		}
		return null; // unknown source standard — no FROM convention; the producer records it as a fromGap
	};
	const authoredMappings = [];
	let totalYesRows = 0;
	const tokenlessRows = [];
	fx.elements.records.forEach((oneRecord) => {
		if (`${oneRecord[confCol]}`.trim().toLowerCase() !== 'yes') {
			return;
		}
		totalYesRows++;
		const token = tokenOf(oneRecord[uriCol]);
		const entity = `${oneRecord[entityCol]}`.trim();
		const elementName = `${oneRecord[nameCol]}`.trim();
		if (!token) {
			tokenlessRows.push({ entity, elementName });
			return;
		}
		authoredMappings.push({
			fromStableId: fromStableIdFor(entity, elementName),
			targetKey: token,
		});
	});
	return { authoredMappings, totalYesRows, tokenlessRows };
};

// =====================================================================
// shared resources
// =====================================================================
const buildSharedResources = (callback) => {
	const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
	// EDF_FORGE_STORE_DB redirects the store (test harnesses); absent -> canonical, byte-identical.
	// An active override is ANNOUNCED on stderr so it can never silently redirect production writes.
	const dbPath =
		process.env.EDF_FORGE_STORE_DB ||
		path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3');
	if (process.env.EDF_FORGE_STORE_DB) {
		console.error(
			`STORE OVERRIDE ACTIVE: forgeStore db = ${dbPath} (EDF_FORGE_STORE_DB)`,
		);
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
	const gatingManifest =
		(commandLineParameters.values.gatingManifest || [])[0] || DEFAULT_GATING_MANIFEST;
	const sourceStandard = (commandLineParameters.values.sourceStandard || [])[0] || 'EdFi';
	const label =
		(commandLineParameters.values.label || [])[0] || 'phase4-authoredMapping-candidate';
	const keyOut = (commandLineParameters.values.keyOut || [])[0] || null;
	// L14 — --includeValues parses STRICTLY: only 'true'/'false' are recognized (previously
	// anything but the literal 'false' — including '=no' and '=0' — silently meant true).
	const rawIncludeValues = (commandLineParameters.values.includeValues || [])[0];
	if (rawIncludeValues !== undefined && rawIncludeValues !== 'true' && rawIncludeValues !== 'false') {
		callback(
			`edf-mapping: --includeValues must be 'true' or 'false' (got "${rawIncludeValues}")`,
		);
		return;
	}
	const includeValues = rawIncludeValues !== 'false';

	const taskList = new taskListPlus();

	// 1) read the gating manifest's members
	taskList.push((args, next) => {
		forgeStore.getManifest({ manifestKey: gatingManifest }, (err, manifest) => {
			if (err) {
				next(`getManifest('${gatingManifest}') failed: ${err}`);
				return;
			}
			if (!manifest) {
				next(`no gating manifest '${gatingManifest}'`);
				return;
			}
			next('', { ...args, members: manifest.members || [] });
		});
	});

	// 2) locate the source-standard block (type 'standard', subject sourceStandard), the reference block
	//    (type 'reference', subject 'CEDS'), and OPTIONALLY the CEDS 'standard' block (CODESET-VALUE join)
	taskList.push((args, next) => {
		const sub = new taskListPlus();
		let sourceRow = null;
		let referenceRow = null;
		let cedsStandardRow = null;
		args.members.forEach((oneMember) => {
			sub.push((a2, n2) => {
				if (sourceRow && referenceRow && cedsStandardRow) {
					n2('', a2);
					return;
				}
				forgeStore.getBlock({ blockId: oneMember.blockId }, (err, row) => {
					if (err) {
						n2(err);
						return;
					}
					if (row && row.type === 'standard' && row.subject === sourceStandard) {
						sourceRow = row;
					}
					if (row && row.type === 'reference' && row.subject === 'CEDS') {
						referenceRow = row;
					}
					if (row && row.type === 'standard' && row.subject === 'CEDS') {
						cedsStandardRow = row;
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
			if (!sourceRow) {
				next(`no '${sourceStandard}' standard block found in the gating manifest`);
				return;
			}
			if (!referenceRow) {
				next('no CEDS reference block found in the gating manifest (run edf-reference first)');
				return;
			}
			next('', { ...args, sourceRow, referenceRow, cedsStandardRow });
		});
	});

	// 3) deserialize source + reference blocks; load the authored crosswalk (row-driven); derive PURELY
	taskList.push((args, next) => {
		const sourceBlock = replayBlock.deserializeBlock(args.sourceRow.text);
		const referenceBlock = replayBlock.deserializeBlock(args.referenceRow.text);
		const { authoredMappings: propertyMappings, totalYesRows, tokenlessRows } = loadAuthoredMappings({ sourceStandard });

		// CODESET-VALUE (Phase A): authored descriptor (value-tier) rows, additive alongside property rows.
		let valueMappings = [];
		let valueStats = null;
		if (includeValues && sourceStandard === 'EdFi' && args.cedsStandardRow) {
			const cedsStandardBlock = replayBlock.deserializeBlock(args.cedsStandardRow.text);
			const valueIndex = valueCrosswalk.buildValueTargetIndex(cedsStandardBlock.nodes);
			const propertyRangeOptionSetIndex = valueCrosswalk.buildPropertyRangeOptionSetIndex(referenceBlock.nodes);
			const valueResult = valueCrosswalk.loadAuthoredValueMappings({
				sourceStandard,
				valueIndex,
				propertyRangeOptionSetIndex,
			});
			valueMappings = valueResult.authoredMappings;
			valueStats = valueResult;
			xLog.status(
				`[edf-mapping] CODESET-VALUE: ${valueResult.totalYesYesRows} Yes/Yes descriptor rows -> ` +
					`${valueMappings.length} resolved value-target mappings (${valueResult.unresolvedRows.length} unresolved ` +
					`OS+notation/name join misses); distinctFromKeys=${valueResult.distinctFromKeys}, ` +
					`ambiguousFromKeys=${valueResult.ambiguousFromKeys} (${valueResult.ambiguousRowCount} rows) — ` +
					`emitted per-row per the property-tier precedent (see lib/value-crosswalk.js header).`,
			);
			// L4: ambiguous notation/name index keys abstain rather than last-write-wins — reported.
			if (
				valueResult.ambiguousIndexKeyCounts.notation > 0 ||
				valueResult.ambiguousIndexKeyCounts.name > 0
			) {
				xLog.status(
					`[edf-mapping] CODESET-VALUE L4 AMBIGUOUS index keys (resolve to NOBODY, rows abstain): ` +
						`notation=${valueResult.ambiguousIndexKeyCounts.notation}, name=${valueResult.ambiguousIndexKeyCounts.name}; ` +
						`${valueResult.ambiguousJoinRows.length} Yes/Yes row(s) abstained on an ambiguous key` +
						`${valueResult.ambiguousJoinRows.length ? `: ${JSON.stringify(valueResult.ambiguousJoinRows.slice(0, 10))}${valueResult.ambiguousJoinRows.length > 10 ? ' …' : ''}` : '.'}`,
				);
			}
			if (valueResult.unresolvedRows.length > 0) {
				xLog.status(
					`[edf-mapping] CODESET-VALUE UNRESOLVED (sample): ${JSON.stringify(valueResult.unresolvedRows.slice(0, 10))}${valueResult.unresolvedRows.length > 10 ? ' …' : ''}`,
				);
			}
		} else if (includeValues && sourceStandard === 'EdFi' && !args.cedsStandardRow) {
			xLog.status('[edf-mapping] CODESET-VALUE: SKIPPED — no CEDS standard block found in the gating manifest.');
		}
		const authoredMappings = propertyMappings.concat(valueMappings);

		const subjectVersion = sourceBlock.header.version || '';
		const objectVersion = referenceBlock.header.version || '';

		const builder = mappingSubgraphFactory({
			predicate: 'exactMatch',
			mappingJustification: 'semapv:ManualMappingCuration',
			subjectSource: sourceStandard,
			subjectVersion,
			objectSource: 'CEDS',
			objectVersion,
			mappingTool: 'edf-mapping',
		});
		const subgraph = builder.buildMappingSubgraph({
			authoredMappings,
			sourceNodes: sourceBlock.nodes,
			referenceNodes: referenceBlock.nodes,
			versionBridge,
		});
		xLog.status(
			`[edf-mapping] ${totalYesRows} authored Yes rows -> ${propertyMappings.length} property-target mappings ` +
				`(${tokenlessRows.length} Yes rows have NO ontology-property Global ID -> out of scope for the ` +
				`deterministic property-tier track) + ${valueMappings.length} value-target mappings (CODESET-VALUE). ` +
				`Derived ${subgraph.counts.edgesTotal} distinct EXACT_MATCH edges ` +
				`(${subgraph.counts.direct} property-direct / ${subgraph.counts.directValue} value-direct / ${subgraph.counts.versionBridge} version-bridge); ` +
				`orphans=${subgraph.counts.orphans}; fromGaps=${subgraph.counts.fromGaps}`,
		);
		if (subgraph.orphans.length > 0) {
			xLog.status(
				`[edf-mapping] ORPHANS (authored but unresolvable target): ${JSON.stringify(subgraph.orphans.slice(0, 10))}${subgraph.orphans.length > 10 ? ' …' : ''}`,
			);
		}
		if (subgraph.diagnostics.fromGaps.length > 0) {
			xLog.status(
				`[edf-mapping] FROM-GAPS (authored source element not materialized): ${JSON.stringify(subgraph.diagnostics.fromGaps.slice(0, 10))}${subgraph.diagnostics.fromGaps.length > 10 ? ' …' : ''}`,
			);
		}
		// L1: value-tier HubReferences the resolver could not index — the TRUE reason, so a
		// malformed reference block is never misread as 'no HubReference with this canonicalKey'.
		if (subgraph.diagnostics.skippedValueRefs.length > 0) {
			xLog.status(
				`[edf-mapping] SKIPPED VALUE REFS (unindexable value-tier HubReferences — malformed reference block): ${subgraph.counts.skippedValueRefs} ref(s): ${JSON.stringify(subgraph.diagnostics.skippedValueRefs.slice(0, 10))}${subgraph.diagnostics.skippedValueRefs.length > 10 ? ' …' : ''}`,
			);
		}
		next('', { ...args, sourceBlock, referenceBlock, subjectVersion, objectVersion, subgraph, totalYesRows, tokenlessRowCount: tokenlessRows.length, valueStats });
	});

	// 4) serialize the mapping block (edges only) + content-address it into forgeStore (additive)
	taskList.push((args, next) => {
		const { subgraph, sourceRow, referenceRow } = args;
		// FULL derivation inputs (Phase A): when the CODESET-VALUE join ran, the CEDS standard block's
		// DmeOptionValue notations were a read input — declare it, so dependency-driven invalidation
		// and requires-walking provenance see everything this block was built from. When the value
		// join did not run, the CEDS standard block was not read and is honestly not declared.
		const valueJoinConsumedCedsStandard =
			includeValues && sourceStandard === 'EdFi' && args.cedsStandardRow;
		const requires = [sourceRow.blockId, referenceRow.blockId].concat(
			valueJoinConsumedCedsStandard ? [args.cedsStandardRow.blockId] : [],
		);
		// L13: NO embedding metadata here — this block is EDGES ONLY (zero nodes, zero
		// embeddings); stamping model/dims was misleading provenance for header readers.
		const header = {
			blockType: 'mapping',
			standardKey: `${sourceRow.subject}`,
			version: args.subjectVersion,
			stableUriPropertyName: 'uri',
			resolutionKey: 'uri',
		};
		const blockText = replayBlock.serializeBlock({
			header,
			nodes: [], // mappings are EDGES (reify-on-demand): zero nodes
			edges: subgraph.edges.map(toBlockEdge),
		});
		forgeStore.saveBlock(
			{
				type: 'mapping',
				subject: `${sourceRow.subject}`,
				version: args.subjectVersion,
				requires,
				text: blockText,
				producedBy: 'edf-mapping',
			},
			(err, result) => {
				if (err) {
					next(`saveBlock failed: ${err}`);
					return;
				}
				xLog.status(
					`[edf-mapping] mapping block saved: ${result.blockId.slice(0, 12)}… (${blockText.split('\n').filter(Boolean).length} lines)`,
				);
				next('', { ...args, mappingBlockId: result.blockId });
			},
		);
	});

	// 5) assemble the CANDIDATE manifest = gating members + the mapping block (additive)
	taskList.push((args, next) => {
		const members = args.members
			.map((oneMember) => ({ blockId: oneMember.blockId, position: null }))
			.concat([{ blockId: args.mappingBlockId, position: null }]);
		forgeStore.saveManifest(
			{
				label,
				basedOn: gatingManifest,
				note: `Phase 4 additive candidate: gating golden + ${sourceStandard} authored EXACT_MATCH mappings`,
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
					gatingManifest,
					sourceStandard,
					sourceBlockId: args.sourceRow.blockId,
					referenceBlockId: args.referenceRow.blockId,
					mappingBlockId: args.mappingBlockId,
					candidateManifestKey: args.candidateManifestKey,
					totalYesRows: args.totalYesRows,
					tokenlessRows: args.tokenlessRowCount,
					codesetValue: args.valueStats,
					counts: args.subgraph.counts,
					orphans: args.subgraph.orphans,
					fromGaps: args.subgraph.diagnostics.fromGaps,
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
const dispatchMap = { build: handleBuild };

const main = () => {
	bootstrapGlobal();
	const { xLog } = process.global;
	const action = Object.keys(commandLineParameters.switches).find(
		(oneSwitch) => dispatchMap[oneSwitch],
	);
	if (!action) {
		xLog.error(
			'edf-mapping: unknown action. Actions: -build. Params: --gatingManifest= --sourceStandard= --label= --keyOut= --includeValues=',
		);
		process.exit(2);
	}
	buildSharedResources((err, resources) => {
		if (err) {
			xLog.error(`edf-mapping bootstrap failed: ${err}`);
			process.exit(2);
		}
		dispatchMap[action](resources, (handlerErr) => {
			if (handlerErr) {
				xLog.error(`[edf-mapping] ERROR: ${handlerErr}`);
				process.exit(1);
			}
			process.exit(0);
		});
	});
};

main();
