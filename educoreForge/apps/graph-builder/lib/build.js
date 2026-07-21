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
//   A  forge each standardBase        -> extract 'standardBase' block -> manifest.add
//      (if the standard is a hub)     -> extract 'hub' block          -> manifest.add
//   C  per bridge: create dep graph   -> bridgeMaker.run (labels edges) -> extract labeled block
//                                      -> manifest.add(pair@versionKey, 'relationship', ...)
//   compose   -> manifest.id()
//   material  -> replayManager.create({ purpose:'materialize', manifestId }) -> boltUrl

// the real components. Overridable one at a time through deps.components (see COMPONENT SEAM).
const defaultComponents = {
	forger: require('../../forger/forger'),
	replayManager: require('../../replay-manager/replayManager'),
	bridgeMaker: require('../../bridge-maker/bridgeMaker'),
	manifestEditor: require('../../manifest-editor/manifestEditor'),
};

const RELATION_LABEL = ':BRIDGEDRELATION:';

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
				replay.create({ purpose: 'forge' }, (e1, boltUrl) => {
					if (e1) return cb(`create(forge) for ${std.token}: ${e1}`);
					forger.forge(
						{ standard: std.token, version: std.version, destination: boltUrl },
						(e2) => {
							if (e2) return cb(`forge ${std.token}: ${e2}`);
							replay.extract(boltUrl, 'standardBase', (e3, block) => {
								if (e3) return cb(`extract standardBase ${std.token}: ${e3}`);
								manifest.add(standardKey(std), 'standardBase', block.blockRef);
								xLog.status(
									`  [A] forge ${standardKey(std)} -> standardBase ${block.blockRef}`,
								);
								const afterHub = (eh) => {
									if (eh) return cb(eh);
									replay.delete(boltUrl, (e5) => cb(e5 || ''));
								};
								if (!hubStdSet.has(String(std.token).toLowerCase())) {
									afterHub('');
									return;
								}
								replay.extract(boltUrl, 'hub', (e4, hubBlock) => {
									if (e4) return afterHub(`extract hub ${std.token}: ${e4}`);
									manifest.add(standardKey(std), 'hub', hubBlock.blockRef);
									xLog.status(
										`  [B] hub block ${std.token} -> ${hubBlock.blockRef}`,
									);
									afterHub('');
								});
							});
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
					(e1, depBolt) => {
						if (e1) return cb(`create(dep) ${pairKey(bridge)}: ${e1}`);
						bridgeMaker.run(
							{
								graphBoltUrl: depBolt,
								mapper: bridge.mapper || 'defaultSemantic',
								label: RELATION_LABEL,
							},
							(e2) => {
								if (e2) return cb(`bridge ${pairKey(bridge)}: ${e2}`);
								replay.extract(depBolt, RELATION_LABEL, (e3, relBlock) => {
									if (e3) return cb(`extract relationships ${pairKey(bridge)}: ${e3}`);
									manifest.add(pairKey(bridge), 'relationship', relBlock.blockRef);
									xLog.status(
										`  [C] bridge ${pairKey(bridge)} (mapper=${
											bridge.mapper || 'defaultSemantic'
										}) -> relationship ${relBlock.blockRef}`,
									);
									replay.delete(depBolt, (e4) => cb(e4 || ''));
								});
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
