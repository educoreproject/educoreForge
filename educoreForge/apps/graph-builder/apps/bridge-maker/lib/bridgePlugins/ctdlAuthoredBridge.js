'use strict';

// ctdlAuthoredBridge — the CTDL AUTHORED `EXACT_MATCH` producer (P2 beachhead; design §1 "a standard
// needing bespoke logic registers an OVERRIDE", §3.11). A per-standard override of the generic bridge.js,
// registered in bridgeMaker's BRIDGE_PLUGIN_BY_MAPPER under CTDL's mapper token. Deterministic: no vectors,
// no LLM, no network — the whole authored spine, proven before a cent of Voyage (plan §7).
//
// THE MAPPER CONTRACT (interfaces.js @interface BridgeModule):
//   bridgeModule({ ...injected library tools }) ({ inGraph, hub, applyLabel }, cb)
//       -> cb('', { edgesWritten, decisionBlock, counts })
//
// THE FIVE MOVES (design §2), deterministic so nothing freezes (decisionBlock is null):
//   1. WALK    — read the CTDL source nodes (_source CTDL), the CEDS HubReference nodes, and the CEDS
//                standard DmeOptionValue rows out of the materialized dependency graph via graphReader.
//   2/3. GATHER + HARVEST — ctdlAnchorHarvest turns each CTDL node's NATIVE crossRefs CEDS anchor into an
//                authored { fromStableId, targetKey }: a fragment anchor -> value-tier composite
//                '${propertyKey}|${OVtoken}'; a set-level anchor -> the option set's unique owning property
//                'P######' (the golden-grounded unification; see ctdlAnchorHarvest header).
//   4. SELECT  — the pure referenceIndex (ported mappingSubgraph) resolves each targetKey to exactly one
//                HubReference stableId, or an orphan. Deterministic — the authored track has nothing to
//                select non-deterministically, so there is no decisionFreezer.
//   5. WRITE   — each resolved edge is written into the graph via relationshipWriter (P0's WRITE seam),
//                stamped confidence 1.0 / provenanceTier SPEC_AUTHORITATIVE / mappingJustification
//                semapv:ManualMappingCuration, carrying the applyLabel harvest selects by.
//
// It reads inGraph, hub and applyLabel off its ONE named-argument object (the contract the shape gate
// enforces). `hub` names the CEDS hub this CTDL bridge targets — read here so the producer refuses to run
// against a graph whose hub is not the one it authors toward.
//
// House style: qtools curried moduleFunction; callback(errString, result) with '' on success; no
// async/await, no try/catch for control flow. camelCase; compound names.

const path = require('path');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const ctdlAnchorHarvest = require(path.join(__dirname, '..', 'ctdlAnchorHarvest'));

// This bridge's identity is fixed: it authors the CTDL -> CEDS hub crosswalk. These are NOT settable knobs
// (polyArch2 §6 "a constant with nothing to shadow is simply a constant") — the plugin IS the CTDL-to-CEDS
// producer, registered under exactly that mapper.
const SOURCE_STANDARD = 'CTDL';
const HUB_STANDARD = 'CEDS';
const HUB_REFERENCE_LABEL = 'HubReference';
const CEDS_OPTION_VALUE_ROLE = 'DmeOptionValue';
const MAPPING_TOOL = 'ctdlAuthoredBridge';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	(injectedTools = {}) =>
	({ inGraph, hub, applyLabel }, callback) => {
		const { graphReader, referenceIndex, relationshipWriter } = injectedTools;

		// EVERY injected tool this producer composes is stated, or it does not run (polyArch2 §6). A missing
		// tool is a wiring fault, named — never a silent no-op that writes zero edges and reads as success.
		const missingTool = ['graphReader', 'referenceIndex', 'relationshipWriter'].find(
			(oneName) => typeof injectedTools[oneName] !== 'function',
		);
		if (missingTool) {
			callback(`${moduleName}: injected tool '${missingTool}' is not a function — the component library did not supply it.`);
			return;
		}
		if (!inGraph) {
			callback(`${moduleName}: inGraph is not given — there is no graph to read the CTDL/CEDS nodes from.`);
			return;
		}
		// hub is READ and CHECKED: this producer authors toward the CEDS hub only. A different hub is a recipe
		// error, refused by name rather than silently bridged against the wrong reference set.
		if (hub !== null && hub !== undefined && `${hub}`.toUpperCase() !== HUB_STANDARD) {
			callback(`${moduleName}: hub is '${hub}', but this producer authors the ${SOURCE_STANDARD} -> ${HUB_STANDARD} crosswalk only.`);
			return;
		}
		if (typeof applyLabel !== 'string' || applyLabel.trim() === '') {
			callback(`${moduleName}: applyLabel is ${applyLabel === undefined ? 'not given' : JSON.stringify(applyLabel)} — it is the label harvest selects the written edges by; there is no default.`);
			return;
		}

		const reader = graphReader({ inGraph });
		const taskList = new taskListPlus();

		// 1. WALK — the three node sets out of the dependency graph.
		taskList.push((args, next) => {
			reader.readNodes({ label: 'ForgedNode', propertyEquals: { _source: SOURCE_STANDARD } }, (err, out) => {
				next(err ? `${moduleName}: reading ${SOURCE_STANDARD} source nodes: ${err}` : '', { ...args, sourceNodes: (out || {}).nodes || [] });
			});
		});
		taskList.push((args, next) => {
			reader.readNodes({ label: HUB_REFERENCE_LABEL, propertyEquals: {} }, (err, out) => {
				next(err ? `${moduleName}: reading ${HUB_STANDARD} HubReference nodes: ${err}` : '', { ...args, referenceNodes: (out || {}).nodes || [] });
			});
		});
		taskList.push((args, next) => {
			reader.readNodes({ label: 'ForgedNode', propertyEquals: { _source: HUB_STANDARD, role: CEDS_OPTION_VALUE_ROLE } }, (err, out) => {
				next(err ? `${moduleName}: reading ${HUB_STANDARD} standard DmeOptionValue nodes: ${err}` : '', { ...args, cedsStandardNodes: (out || {}).nodes || [] });
			});
		});

		// 2/3/4. HARVEST authored mappings, then SELECT with the pure referenceIndex.
		taskList.push((args, next) => {
			const resolutionContext = ctdlAnchorHarvest.buildResolutionContext({
				referenceNodes: args.referenceNodes,
				cedsStandardNodes: args.cedsStandardNodes,
			});
			const harvest = ctdlAnchorHarvest.harvestAuthoredMappings({ sourceNodes: args.sourceNodes, resolutionContext });

			const builder = referenceIndex({
				predicate: 'exactMatch',
				mappingJustification: 'semapv:ManualMappingCuration',
				subjectSource: SOURCE_STANDARD,
				objectSource: HUB_STANDARD,
				mappingTool: MAPPING_TOOL,
			});
			const subgraph = builder.buildMappingSubgraph({
				authoredMappings: harvest.authoredMappings,
				sourceNodes: args.sourceNodes,
				referenceNodes: args.referenceNodes,
			});
			next('', { ...args, harvest, subgraph });
		});

		// 5. WRITE — one labeled EXACT_MATCH edge per resolved mapping, through P0's relationshipWriter.
		taskList.push((args, next) => {
			const writeOne = relationshipWriter;
			const edges = args.subgraph.edges;
			let edgesWritten = 0;
			const writeList = new taskListPlus();
			edges.forEach((oneEdge) => {
				writeList.push((a2, n2) => {
					writeOne(
						{
							authoredMapping: {
								fromStableId: oneEdge.fromRef.id,
								toStableId: oneEdge.toRef.id,
								relationshipType: oneEdge.type,
								properties: oneEdge.properties,
							},
							applyLabel,
						},
						(err, writeResult) => {
							if (err) {
								n2(`${moduleName}: writing EXACT_MATCH ${oneEdge.fromRef.id} -> ${oneEdge.toRef.id}: ${err}`);
								return;
							}
							if (writeResult && writeResult.edgeWritten) {
								edgesWritten++;
							}
							n2('', a2);
						},
					);
				});
			});
			pipeRunner(writeList.getList(), {}, (err) => {
				next(err || '', { ...args, edgesWritten });
			});
		});

		pipeRunner(taskList.getList(), {}, (err, args) => {
			// close the reader whether or not the run succeeded (the writer is closed by bridgeMaker).
			reader.close((closeErr) => {
				if (err) {
					callback(closeErr ? `${err} (and the graph reader also failed to close: ${closeErr})` : err);
					return;
				}
				if (closeErr) {
					callback(`${moduleName}: authored ${args.edgesWritten} edge(s) but the graph reader failed to close: ${closeErr}`);
					return;
				}
				callback('', {
					edgesWritten: args.edgesWritten,
					decisionBlock: null, // deterministic authored track — nothing to freeze (design §2)
					counts: {
						authored: args.edgesWritten,
						inferred: 0,
						anchorsSeen: args.harvest.counts.anchorsSeen,
						valueTier: args.harvest.counts.valueTier,
						propertyTier: args.harvest.counts.propertyTier,
						abstains: args.harvest.counts.abstains,
						orphans: args.subgraph.counts.orphans,
						fromGaps: args.subgraph.counts.fromGaps,
					},
				});
			});
		});
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction;
