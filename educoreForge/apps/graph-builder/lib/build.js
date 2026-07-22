'use strict';

// build.js — graphBuilder's -build orchestration. Requires the component modules IN-PROCESS and
// drives the pipeline, threading real recipe data (tokens, versions, block refs, manifest keys)
// through stub component bodies. Swap a component's stub body for the real one with the contract
// already proven here.
//
//   build(recipe, { xLog, components }, callback) -> callback('', { manifestId, boltUrl, memberCount })
//
// COMPONENT SEAM: `deps.components` may override any of the four component FACTORIES; anything not
// named falls through to the real module. Production passes nothing and gets the real four. The
// seam exists so a test can inject a component that FAILS — without it the orchestrator's error
// paths could never be observed firing, and a path never observed is a path unproven.
//
// Pipeline (materialize-and-harvest):
//   A  forge each standardBase        -> harvest StandardBase schema block -> manifest.add
//      (if the standard is a hub)     -> harvest HubReference schema block -> manifest.add
//   C  per bridge: create dep graph   -> bridgeMaker.run (labels edges) -> harvest labeled block
//                                      -> manifest.add(pair@versionKey, 'relationship', ...)
//   compose   -> manifest.id()
//   material  -> replayManager.create({ purpose:'materialize', manifestId }) -> the eval golden

// STUB-ERA defaults. The pipeline runs against stub components until EVERY component is real —
// a real forger provisions Docker and spends Voyage credit, which must never happen inside
// `npm test` or a casual -build. The real modules (apps/forger, apps/replay-manager have real
// bodies already) are exercised through their own suites and the integration proof scripts;
// when the last component lands, this line flips to the real modules and stub-components.js dies.
// Overridable one at a time through deps.components (see COMPONENT SEAM).
const defaultComponents = require('./stub-components');

// Label vocabulary — BARE NAMES. The colons in ':BridgedRelation:' are Cypher notation, not part
// of the name; a constant carrying them would create a label literally called ':BridgedRelation:'.
// These are handed DOWN: init stamps them, harvest selects on them, so the producing side and the
// harvesting side agree by parameter instead of by two hopeful literals.
const BASE_GRAPH_LABEL = 'StandardBase';
const HUB_LABEL = 'HubReference';
const RELATION_LABEL = 'BridgedRelation';

// minimal sequential async iterator (err-string convention)
const eachSeries = (items, iterator, done) => {
	let index = 0;
	const step = () => {
		if (index >= items.length) {
			done('');
			return;
		}
		const item = items[index];
		index += 1;
		iterator(item, (err) => {
			if (err) {
				done(err);
				return;
			}
			step();
		});
	};
	step();
};

const standardKey = (std) => `${std.token}@${std.version}`;
const pairKey = (bridge) => `${bridge.source}::${bridge.hub || '(structural)'}`;

const build = (recipe, deps, callback) => {
	const { xLog } = deps;
	const components = { ...defaultComponents, ...(deps.components || {}) };

	const forger = components.forger();
	const replay = components.replayManager();
	const bridgeMaker = components.bridgeMaker();
	const manifest = components.manifestEditor().init(recipe.recipeName, recipe);

	const standards = Array.isArray(recipe.standards) ? recipe.standards : [];
	const hubs = Array.isArray(recipe.hubs) ? recipe.hubs : [];
	const bridges = Array.isArray(recipe.bridges) ? recipe.bridges : [];
	const hubStdSet = new Set(hubs.map((h) => String(h.standard).toLowerCase()));

	// ---- Phase A: forge each standardBase (+ hub block when the standard is a hub) ----
	const phaseA = (done) => {
		eachSeries(
			standards,
			(std, cb) => {
				replay.create({ purpose: 'forge' }, (e1, workingGraph) => {
					if (e1) return cb(`create(forge) for ${std.token}: ${e1}`);
					forger.forge(
						{ standard: std.token, version: std.version },
						(e2, forgeReport) => {
							if (e2) return cb(`forge ${std.token}: ${e2}`);
							// the forger produced; replayManager loads. The label the harvest will
							// select on is the label init stamps — handed down, not hoped for.
							replay.init(
								{
									inGraph: workingGraph,
									nodeEdges: forgeReport.nodeEdges,
									applyLabels: [BASE_GRAPH_LABEL],
									sourceLabel: `nodeEdges from forge bundle '${std.token}'`,
								},
								(eInit) => {
							if (eInit) return cb(`init ${std.token}: ${eInit}`);
							replay.harvest(
								{
									inGraph: workingGraph,
									selectionLabels: [BASE_GRAPH_LABEL],
									header: { blockType: 'standardBase', standardKey: std.token, version: std.version },
								},
								(e3, block) => {
								if (e3) return cb(`harvest standardBase ${std.token}: ${e3}`);
								manifest.add(standardKey(std), 'standardBase', block.blockId);
								xLog.status(
									`  [A] forge ${standardKey(std)} -> standardBase ${block.blockId}`,
								);
								const afterHub = (eh) => {
									if (eh) return cb(eh);
									replay.delete(workingGraph, (e5) => cb(e5 || ''));
								};
								if (!hubStdSet.has(String(std.token).toLowerCase())) {
									afterHub('');
									return;
								}
								replay.harvest(
									{
										inGraph: workingGraph,
										selectionLabels: [HUB_LABEL],
										header: {
											blockType: 'hub',
											standardKey: std.token,
											version: std.version,
										},
									},
									(e4, hubBlock) => {
										if (e4) return afterHub(`harvest hub ${std.token}: ${e4}`);
										manifest.add(standardKey(std), 'hub', hubBlock.blockId);
										xLog.status(
											`  [B] hub block ${std.token} -> ${hubBlock.blockId}`,
										);
										afterHub('');
									},
								);
								},
							);
						},
					);
						},
					);
				});
			},
			done,
		);
	};

	// ---- Phase C: bridges (materialize dep graph, run bridge, harvest labeled relationships) ----
	const phaseC = (done) => {
		eachSeries(
			bridges,
			(bridge, cb) => {
				replay.create(
					{ purpose: 'dependencyGraph', dependencies: bridge.dependencies },
					(e1, depGraph) => {
						if (e1) return cb(`create(dep) ${pairKey(bridge)}: ${e1}`);
						bridgeMaker.run(
							{
								inGraph: depGraph,
								mapper: bridge.mapper || 'defaultSemantic',
								applyLabel: RELATION_LABEL,
							},
							(e2) => {
								if (e2) return cb(`bridge ${pairKey(bridge)}: ${e2}`);
								replay.harvest(
									{
										inGraph: depGraph,
										selectionLabels: [RELATION_LABEL],
										header: {
											blockType: 'relationship',
											standardKey: pairKey(bridge),
										},
									},
									(e3, relBlock) => {
										if (e3) return cb(`harvest relationships ${pairKey(bridge)}: ${e3}`);
										manifest.add(pairKey(bridge), 'relationship', relBlock.blockId);
										xLog.status(
											`  [C] bridge ${pairKey(bridge)} (mapper=${
												bridge.mapper || 'defaultSemantic'
											}) -> relationship ${relBlock.blockId}`,
										);
										replay.delete(depGraph, (e4) => cb(e4 || ''));
									},
								);
							},
						);
					},
				);
			},
			done,
		);
	};

	phaseA((eA) => {
		if (eA) return callback(`phase A (forge) failed: ${eA}`);
		phaseC((eC) => {
			if (eC) return callback(`phase C (bridge) failed: ${eC}`);
			const manifestId = manifest.id();
			xLog.status(
				`  [compose] manifest ${manifestId} -- ${manifest.members().length} members`,
			);
			replay.create({ purpose: 'materialize', manifestId }, (eM, boltUrl) => {
				if (eM) return callback(`materialize failed: ${eM}`);
				xLog.status(`  [materialize] -> ${boltUrl}`);
				callback('', {
					manifestId,
					boltUrl,
					memberCount: manifest.members().length,
				});
			});
		});
	});
};

module.exports = { build };
