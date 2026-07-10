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
// ANCHOR-FORM STRATEGY REGISTRY (WORKORDER-inferenceAndSelfDoc-070226 A0.2, added 070226): anchor
// resolution is a REGISTRY of strategies (lib/anchor-strategies.js) selected by the `anchorForm`
// declaration on the source standard's DmeStandardRoot NODE (per-standard authored data; absent =
// pForm). -build (the EdFi crosswalk path) routes its extracted P-tokens through the registry's
// pFormDirect strategy; -buildNative derives the pairs from the source block's OWN native anchors
// (SEDM/SIF cedsId crossRefs = pFormDirect, extracted verbatim from the standards-campaign emit;
// CTDL OS-form value anchors = osFragmentJoin). A new anchor format = one new registered strategy,
// never a new module.
//
//   edf-mapping -buildNative --gatingManifest=<key> --sourceStandard=<SEDM|SIF|CTDL|…>
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
const { CLASSIFICATION_EDGE_TYPES, PROVENANCE_TIER } = require(path.join(CORE_LIB, 'vocabulary', 'vocabulary'));
const mappingSubgraphFactory = require(path.join(CORE_LIB, 'mapping-subgraph', 'mappingSubgraph'));
const versionBridge = require(path.join(__dirname, 'assets', 'versionBridge'));
const valueCrosswalk = require(path.join(__dirname, 'lib', 'value-crosswalk'));
const anchorStrategies = require(path.join(__dirname, 'lib', 'anchor-strategies'));

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
		// A0.2 registry routing: the crosswalk path is P-form by construction — the source standard's
		// DmeStandardRoot must therefore declare pForm (or nothing). Its extracted tokens resolve to
		// targetKeys through the registry's pFormDirect strategy (identity for a P-token; the routing
		// is byte-neutral, proven by the retrofit red test).
		const strategySelection = anchorStrategies.strategyForSourceNodes(sourceBlock.nodes);
		if (strategySelection.error) {
			next(`edf-mapping -build: ${strategySelection.error}`);
			return;
		}
		if (strategySelection.strategy.strategyName !== 'pFormDirect') {
			next(
				`edf-mapping -build: the authored-crosswalk path requires anchorForm 'pForm' (or none) — '${sourceStandard}' declares '${strategySelection.anchorForm}'; use -buildNative for native-anchor standards`,
			);
			return;
		}
		const { authoredMappings: rawPropertyMappings, totalYesRows, tokenlessRows } = loadAuthoredMappings({ sourceStandard });
		const propertyMappings = rawPropertyMappings.map((oneMapping) => ({
			...oneMapping,
			targetKey: strategySelection.strategy.resolveTargetKey(oneMapping.targetKey),
		}));

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
// ACTION: -buildNative — authored mapping block from a standard's OWN native CEDS anchors,
// resolved through the anchor-form strategy registry (A0.2). The pFormDirect leg is the
// standards-campaign emit (SEDM 220 / SIF 2,202 EXACT) EXTRACTED VERBATIM — its blocks re-emit
// byte-identically (the retrofit red test). The osFragmentJoin leg is CTDL's OS+fragment→notation
// join → authored VALUE-tier EXACT_MATCH block (subject '<standard>-value' — the M14 discovery
// convention: a value-only block must never masquerade as the property-tier gating block).
// NO manifest is assembled here (campaign manifests are assembled deliberately, per wave).
// =====================================================================
const handleBuildNative = (resources, callback) => {
	const { xLog } = process.global;
	const { forgeStore } = resources;
	const gatingManifest = (commandLineParameters.values.gatingManifest || [])[0] || null;
	const sourceStandard = (commandLineParameters.values.sourceStandard || [])[0] || null;
	if (!gatingManifest || !sourceStandard) {
		callback(
			'edf-mapping -buildNative: --gatingManifest= and --sourceStandard= are both required (no defaults across builds)',
		);
		return;
	}

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

	// 2) locate the source-standard block, the CEDS reference block, and the CEDS standard block.
	//    ALL THREE are REQUIRED read inputs on the native path: the reference resolves hubs, and the
	//    CEDS standard block classifies orphans (pForm) / supplies the notation join rows (osFragment)
	//    — requires = [source, reference, cedsStandard] is the honest full declaration (M3 doctrine).
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
			if (!cedsStandardRow) {
				next('no CEDS standard block found in the gating manifest — the native path REQUIRES it (orphan classification / notation join)');
				return;
			}
			next('', { ...args, sourceRow, referenceRow, cedsStandardRow });
		});
	});

	// 3) deserialize; select the strategy from the root's anchorForm declaration; harvest + resolve
	taskList.push((args, next) => {
		const sourceBlock = replayBlock.deserializeBlock(args.sourceRow.text);
		const referenceBlock = replayBlock.deserializeBlock(args.referenceRow.text);
		const cedsStandardBlock = replayBlock.deserializeBlock(args.cedsStandardRow.text);
		const strategySelection = anchorStrategies.strategyForSourceNodes(sourceBlock.nodes);
		if (strategySelection.error) {
			next(`edf-mapping -buildNative: ${strategySelection.error}`);
			return;
		}
		const { strategy, anchorForm } = strategySelection;
		const resolutionContext = strategy.buildResolutionContext({
			referenceNodes: referenceBlock.nodes,
			cedsStandardNodes: cedsStandardBlock.nodes,
		});
		const harvest = strategy.harvestNativeAnchors({
			sourceNodes: sourceBlock.nodes,
			resolutionContext,
		});
		xLog.status(
			`[edf-mapping -buildNative ${sourceStandard}] anchorForm=${anchorForm} strategy=${strategy.strategyName}: ` +
				`${harvest.authoredMappings.length} resolved pair(s), ${harvest.unresolvedRows.length} abstain(s); ` +
				`report=${JSON.stringify({
					...harvest.report,
					nonPForm: (harvest.report.nonPForm || []).length,
					unknownToCeds: (harvest.report.unknownToCeds || []).length,
				})}`,
		);
		if (harvest.unresolvedRows.length > 0) {
			xLog.status(
				`[edf-mapping -buildNative ${sourceStandard}] ABSTAINS (true reasons): ${JSON.stringify(harvest.unresolvedRows.slice(0, 10))}${harvest.unresolvedRows.length > 10 ? ' …' : ''}`,
			);
		}
		if ((harvest.report.unknownToCeds || []).length > 0) {
			xLog.status(
				`[edf-mapping -buildNative ${sourceStandard}] unknownToCeds (will orphan in the core): ${JSON.stringify((harvest.report.unknownToCeds || []).slice(0, 10))}${harvest.report.unknownToCeds.length > 10 ? ' …' : ''}`,
			);
		}
		next('', { ...args, sourceBlock, referenceBlock, strategy, anchorForm, harvest });
	});

	// 4) derive PURELY through the same core; serialize; deserialize-back read; save (additive)
	taskList.push((args, next) => {
		const { sourceBlock, referenceBlock, strategy, harvest } = args;
		// pFormDirect keeps the stamp frozen into the campaign blocks (byte-identity + re-derivability
		// pin it); every OTHER strategy stamps 'edf-mapping:<strategyName>' (the registry stamping rule,
		// SCARLET_PEAK ruling 070226).
		const mappingTool =
			strategy.strategyName === 'pFormDirect'
				? strategy.nativeMappingTool
				: `edf-mapping:${strategy.strategyName}`;
		const builder = mappingSubgraphFactory({
			predicate: 'exactMatch',
			mappingJustification: 'semapv:ManualMappingCuration',
			subjectSource: sourceStandard,
			subjectVersion: sourceBlock.header.version || '',
			objectSource: 'CEDS',
			objectVersion: referenceBlock.header.version || '',
			mappingTool,
		});
		const subgraph = builder.buildMappingSubgraph({
			authoredMappings: harvest.authoredMappings,
			sourceNodes: sourceBlock.nodes,
			referenceNodes: referenceBlock.nodes,
			versionBridge,
		});
		xLog.status(
			`[edf-mapping -buildNative ${sourceStandard}] derived ${subgraph.counts.edgesTotal} distinct EXACT_MATCH edges ` +
				`(${subgraph.counts.direct} direct / ${subgraph.counts.directValue} value-direct / ${subgraph.counts.versionBridge} version-bridge); ` +
				`orphans=${subgraph.counts.orphans}; fromGaps=${subgraph.counts.fromGaps}`,
		);
		if (subgraph.orphans.length > 0) {
			xLog.status(
				`[edf-mapping -buildNative ${sourceStandard}] ORPHANS: ${JSON.stringify(subgraph.orphans.slice(0, 10))}${subgraph.orphans.length > 10 ? ' …' : ''}`,
			);
		}
		// the M14 discovery convention: a value-tier block's store subject carries '-value' so it can
		// never masquerade as the property-tier gating block; the in-text header standardKey stays the
		// bare standard (the edf-implied value-block precedent exactly).
		const blockSubject =
			strategy.strategyName === 'osFragmentJoin' ? `${sourceStandard}-value` : `${sourceRowSubject(args)}`;
		// L13 doctrine: edges-only block, NO embedding metadata in the header
		const header = {
			blockType: 'mapping',
			standardKey: strategy.strategyName === 'osFragmentJoin' ? sourceStandard : blockSubject,
			version: sourceBlock.header.version || null,
			stableUriPropertyName: 'uri',
			resolutionKey: 'uri',
		};
		const blockText = replayBlock.serializeBlock({
			header,
			nodes: [], // mappings are EDGES (reify-on-demand): zero nodes
			edges: subgraph.edges.map(toBlockEdge),
		});
		// doctrine (Phase R STOP FORK 2): emit acceptance includes a deserialize-back READ
		const readBack = replayBlock.deserializeBlock(blockText);
		if (readBack.edges.length !== subgraph.edges.length || readBack.nodes.length !== 0) {
			next(
				`deserialize-back FAILED: wrote ${subgraph.edges.length} edges/0 nodes, read ${readBack.edges.length}/${readBack.nodes.length}`,
			);
			return;
		}
		forgeStore.saveBlock(
			{
				type: 'mapping',
				subject: blockSubject,
				version: sourceBlock.header.version || null,
				requires: [args.sourceRow.blockId, args.referenceRow.blockId, args.cedsStandardRow.blockId],
				text: blockText,
				producedBy: 'edf-mapping',
			},
			(err, result) => {
				if (err) {
					next(`saveBlock failed: ${err}`);
					return;
				}
				xLog.status(
					`[edf-mapping -buildNative ${sourceStandard}] mapping block saved: ${result.blockId} (${blockText.split('\n').filter(Boolean).length} lines)`,
				);
				next('', { ...args, mappingBlockId: result.blockId, blockSubject, subgraph });
			},
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
					action: 'buildNative',
					gatingManifest,
					sourceStandard,
					anchorForm: args.anchorForm,
					strategy: args.strategy.strategyName,
					blockSubject: args.blockSubject,
					sourceBlockId: args.sourceRow.blockId,
					referenceBlockId: args.referenceRow.blockId,
					cedsStandardBlockId: args.cedsStandardRow.blockId,
					mappingBlockId: args.mappingBlockId,
					counts: args.subgraph.counts,
					abstains: args.harvest.unresolvedRows,
					orphans: args.subgraph.orphans,
				},
				null,
				2,
			),
		);
		callback('');
	});
};

// the pForm block subject is the SOURCE ROW's subject verbatim (byte-lock with the campaign rows)
const sourceRowSubject = (args) => args.sourceRow.subject;

// =====================================================================
// ACTION: -buildCrosswalk — A0.3 CLASSIFICATION_CROSSWALK producer (workorder
// inferenceAndSelfDoc-070226, AZURE_OCEAN rulings 2026-07-02). Reads the SOURCE standard's
// stashed cross-taxonomy crossRefs (system=--crossRefSystem) and the TARGET standard's code
// index (--targetCodeProperty) from the gating manifest, and emits direct node-to-node
// CLASSIFICATION_CROSSWALK edges in a normal content-addressed 'mapping' block, subject
// '<sourceStandard>-crosswalk' (M14 anti-masquerade — never the bare standard).
// NO hub semantics BY CONSTRUCTION: requires is 2-strong [source, target] (no CEDS reference,
// no CEDS standard block) and no edge ever touches a HubReference. NOT equivalence: no
// predicate, no SSSOM justification — a crosswalk correspondence is not a mapping.
// REPEATABILITY RIDER (AZURE_OCEAN, binding): the COMPLETE parameter set is stamped into the
// block header as crosswalkInstruction — the block is self-describing; re-derivation needs
// repo code + store only.
// =====================================================================
const handleBuildCrosswalk = (resources, callback) => {
	const { xLog } = process.global;
	const { forgeStore } = resources;
	const requiredParams = [
		'gatingManifest',
		'sourceStandard',
		'targetStandard',
		'crossRefSystem',
		'targetCodeProperty',
		'edgeFrom',
		'edgeTo',
		'crosswalkSource',
	];
	const paramValues = {};
	const missingParams = requiredParams.filter((oneName) => {
		paramValues[oneName] = (commandLineParameters.values[oneName] || [])[0] || null;
		return !paramValues[oneName];
	});
	if (missingParams.length) {
		callback(
			`edf-mapping -buildCrosswalk: missing required parameter(s): ${missingParams
				.map((oneName) => `--${oneName}=`)
				.join(' ')} (no defaults across builds)`,
		);
		return;
	}
	// optional: refs whose code matches this pattern abstain as sentinelNoMatch (data-declared)
	const sentinelCodePattern =
		(commandLineParameters.values.sentinelCodePattern || [])[0] || null;
	const {
		gatingManifest,
		sourceStandard,
		targetStandard,
		crossRefSystem,
		targetCodeProperty,
		edgeFrom,
		edgeTo,
		crosswalkSource,
	} = paramValues;
	// the stated direction must be a permutation of {source, target} — declared, never implied
	const directionOk =
		(edgeFrom === sourceStandard && edgeTo === targetStandard) ||
		(edgeFrom === targetStandard && edgeTo === sourceStandard);
	if (!directionOk || edgeFrom === edgeTo) {
		callback(
			`edf-mapping -buildCrosswalk: --edgeFrom/--edgeTo must be a permutation of --sourceStandard/--targetStandard (got ${edgeFrom}->${edgeTo})`,
		);
		return;
	}
	const crosswalkEdgeType = CLASSIFICATION_EDGE_TYPES.CLASSIFICATION_CROSSWALK;
	const mappingTool = 'edf-mapping:classificationCrosswalk';

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

	// 2) locate the source and target standard blocks — the ONLY read inputs (2-strong requires:
	//    no CEDS reference, no CEDS standard; the no-hub-semantics guarantee lives in the shape)
	taskList.push((args, next) => {
		const sub = new taskListPlus();
		let sourceRow = null;
		let targetRow = null;
		args.members.forEach((oneMember) => {
			sub.push((a2, n2) => {
				if (sourceRow && targetRow) {
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
					if (row && row.type === 'standard' && row.subject === targetStandard) {
						targetRow = row;
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
			if (!sourceRow || !targetRow) {
				next(
					`edf-mapping -buildCrosswalk: gating manifest lacks required standard block(s): ${[
						!sourceRow ? sourceStandard : null,
						!targetRow ? targetStandard : null,
					]
						.filter(Boolean)
						.join(', ')}`,
				);
				return;
			}
			next('', {
				...args,
				sourceRow,
				targetRow,
				sourceBlock: replayBlock.deserializeBlock(sourceRow.text),
				targetBlock: replayBlock.deserializeBlock(targetRow.text),
			});
		});
	});

	// 3) target code index (unique-owner-or-abstain) + source crossRef harvest + resolution
	taskList.push((args, next) => {
		const firstValue = (oneVal) => (Array.isArray(oneVal) ? oneVal[0] : oneVal);
		const codeIndex = new Map(); // code -> [stableIds] (multi-owner detected, abstained)
		(args.targetBlock.nodes || []).forEach((oneNode) => {
			const codeValue = firstValue((oneNode.properties || {})[targetCodeProperty]);
			if (codeValue === undefined || codeValue === null || codeValue === '') {
				return;
			}
			if (!codeIndex.has(codeValue)) {
				codeIndex.set(codeValue, []);
			}
			codeIndex.get(codeValue).push(oneNode.stableId);
		});
		const sentinelRe = sentinelCodePattern ? new RegExp(sentinelCodePattern) : null;
		const abstainRows = [];
		const abstainTally = {};
		const seenPairKeys = new Set();
		const edgeList = [];
		let refsTotal = 0;
		let duplicatePairs = 0;
		(args.sourceBlock.nodes || []).forEach((oneNode) => {
			const rawCrossRefs = firstValue((oneNode.properties || {}).crossRefs);
			if (!rawCrossRefs || rawCrossRefs === '[]') {
				return;
			}
			let crossRefList = null;
			try {
				crossRefList = JSON.parse(rawCrossRefs);
			} catch (parseErr) {
				crossRefList = null;
			}
			if (!Array.isArray(crossRefList)) {
				return;
			}
			crossRefList
				.filter((oneRef) => oneRef.system === crossRefSystem)
				.forEach((oneRef) => {
					refsTotal += 1;
					const abstain = (reason) => {
						abstainTally[reason] = (abstainTally[reason] || 0) + 1;
						abstainRows.push({
							reason,
							sourceStableId: oneNode.stableId,
							code: oneRef.id,
							raw: oneRef.raw,
							locator: oneRef.locator,
						});
					};
					if (sentinelRe && sentinelRe.test(oneRef.id)) {
						abstain('sentinelNoMatch');
						return;
					}
					const ownerList = codeIndex.get(oneRef.id) || [];
					if (ownerList.length === 0) {
						abstain(`targetCodeNotIn${targetStandard}Standard`);
						return;
					}
					if (ownerList.length > 1) {
						abstain('ambiguousTargetCode');
						return;
					}
					const targetStableId = ownerList[0];
					const fromNode = edgeFrom === targetStandard ? targetStableId : oneNode.stableId;
					const toNode = edgeTo === sourceStandard ? oneNode.stableId : targetStableId;
					const pairKey = `${fromNode}|${toNode}`;
					if (seenPairKeys.has(pairKey)) {
						duplicatePairs += 1;
						return;
					}
					seenPairKeys.add(pairKey);
					edgeList.push({
						type: crosswalkEdgeType,
						fromRef: { source: edgeFrom, id: fromNode },
						toRef: { source: edgeTo, id: toNode },
						properties: {
							confidence: [1],
							crosswalkSource: [crosswalkSource],
							mappingTool: [mappingTool],
							provenanceTier: [PROVENANCE_TIER.SPEC_AUTHORITATIVE],
						},
					});
				});
		});
		xLog.status(
			`[edf-mapping -buildCrosswalk ${sourceStandard}->${targetStandard}] refs=${refsTotal}: ` +
				`${edgeList.length} distinct ${crosswalkEdgeType} edge(s) (direction ${edgeFrom}->${edgeTo}), ` +
				`${duplicatePairs} duplicate pair(s) deduped, abstains=${JSON.stringify(abstainTally)}`,
		);
		if (abstainRows.length > 0) {
			xLog.status(
				`[edf-mapping -buildCrosswalk] ABSTAINS (true reasons): ${JSON.stringify(abstainRows.slice(0, 10))}${abstainRows.length > 10 ? ' …' : ''}`,
			);
		}
		next('', { ...args, edgeList, abstainRows, abstainTally, refsTotal, duplicatePairs });
	});

	// 4) serialize (edges-only, L13); deserialize-back read; save (additive, 2-strong requires)
	taskList.push((args, next) => {
		const header = {
			blockType: 'mapping',
			standardKey: sourceStandard,
			version: args.sourceBlock.header.version || null,
			stableUriPropertyName: 'uri',
			resolutionKey: 'uri',
			// the repeatability rider: the block re-describes its own derivation completely
			crosswalkInstruction: {
				sourceStandard,
				targetStandard,
				crossRefSystem,
				targetCodeProperty,
				edgeFrom,
				edgeTo,
				crosswalkSource,
				sentinelCodePattern,
			},
		};
		const blockText = replayBlock.serializeBlock({
			header,
			nodes: [], // crosswalk correspondences are EDGES: zero nodes
			edges: args.edgeList,
		});
		const readBack = replayBlock.deserializeBlock(blockText);
		if (readBack.edges.length !== args.edgeList.length || readBack.nodes.length !== 0) {
			next(
				`deserialize-back FAILED: wrote ${args.edgeList.length} edges/0 nodes, read ${readBack.edges.length}/${readBack.nodes.length}`,
			);
			return;
		}
		forgeStore.saveBlock(
			{
				type: 'mapping',
				subject: `${sourceStandard}-crosswalk`,
				version: args.sourceBlock.header.version || null,
				requires: [args.sourceRow.blockId, args.targetRow.blockId],
				text: blockText,
				producedBy: 'edf-mapping',
			},
			(err, result) => {
				if (err) {
					next(`saveBlock failed: ${err}`);
					return;
				}
				xLog.status(
					`[edf-mapping -buildCrosswalk] crosswalk block saved: ${result.blockId} (${blockText.split('\n').filter(Boolean).length} lines)`,
				);
				next('', { ...args, crosswalkBlockId: result.blockId });
			},
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
					action: 'buildCrosswalk',
					gatingManifest,
					crosswalkInstruction: {
						sourceStandard,
						targetStandard,
						crossRefSystem,
						targetCodeProperty,
						edgeFrom,
						edgeTo,
						crosswalkSource,
						sentinelCodePattern,
					},
					sourceBlockId: args.sourceRow.blockId,
					targetBlockId: args.targetRow.blockId,
					crosswalkBlockId: args.crosswalkBlockId,
					counts: {
						refsTotal: args.refsTotal,
						distinctEdges: args.edgeList.length,
						duplicatePairs: args.duplicatePairs,
						abstains: args.abstainTally,
					},
					abstainSamples: args.abstainRows.slice(0, 20),
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
	buildNative: handleBuildNative,
	buildCrosswalk: handleBuildCrosswalk,
};

const main = () => {
	bootstrapGlobal();
	const { xLog } = process.global;
	const action = Object.keys(commandLineParameters.switches).find(
		(oneSwitch) => dispatchMap[oneSwitch],
	);
	if (!action) {
		xLog.error(
			'edf-mapping: unknown action. Actions: -build, -buildNative, -buildCrosswalk. Params: --gatingManifest= --sourceStandard= --label= --keyOut= --includeValues= | crosswalk: --targetStandard= --crossRefSystem= --targetCodeProperty= --edgeFrom= --edgeTo= --crosswalkSource= [--sentinelCodePattern=]',
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
