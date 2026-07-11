'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// synthetic-native-mapping.js — TEST SCAFFOLDING, never a production flow (Phase D ruling
// D-D8, option C; supervisor riders 1–4 baked in below).
//
// The LLM-free deterministic mapping producer for the SYNTHETIC standards: derives the
// pair's mapping block from the STORE'S OWN standard blocks — the gating manifest's spoke
// nodes' declared cedsId × the hub block nodes' cedsId, the exact semantic the retired
// edf-bridge -specified pass implemented — and emits through ALL the real machinery: the
// pair-binding resolver (WITH the D-D5 preferredHubBundleDir honesty knob — synthetic hub
// emissions stamp p6hub's own provenance, never the real hub's), the extended header
// serializer (pair fields + tierScope), the forge-store saveBlock CHOKE POINT, and the
// ordinary group-minting path afterwards. No private shortcuts (rider 4): its blocks are
// first-class citizens or nothing.
//
// WHY THIS TOOL EXISTS (the honest coverage boundary, rider 2): the real producers'
// native-anchor harvest is P-form/OS-form by design (anchor-strategies.js) and CANNOT
// operate over the synthetic fixtures' C-form refs; the fixtures' @01 content is FROZEN
// (fingerprint instrument lineage). This tool exercises every downstream stage the
// synthetic flows exist to prove — pair keying, choke validation, grouping, expansion,
// replay, connect report — and deliberately does NOT exercise the real producers' harvest
// internals (covered by their real flows and Phase C's smokes).
//
//   -syntheticNativeMapping --gatingManifest=<key> --sourceStandard=<synthetic name>
//                           [--hubBundleDir=<dir>]   (default forge-p6hub)
//
// RIDER 1 (structural misuse guard): --sourceStandard MUST resolve to a roster entry with
// synthetic:true — a real standard is REFUSED by a hard check.

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const path = require('path');

const CORE_LIB = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'..',
	'npm',
	'qtools-graph-forge-core',
	'lib',
);
const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));

const DEFAULT_HUB_BUNDLE_DIR = 'forge-p6hub';

const moduleFunction =
	({ moduleName } = {}) =>
	({ storeAccess, standardDiscovery, pairBinding, vocabulary } = {}) => {
		const { xLog, commandLineParameters } = process.global;
		const { forgeStore } = storeAccess;

		const strParam = (name, dflt) => {
			const values = commandLineParameters.values[name];
			return values && values.length ? values[0] : dflt;
		};

		// scalar — PG-JSON single-element array or scalar.
		const scalar = (propValue) =>
			Array.isArray(propValue) ? propValue[0] : propValue;

		// rootStampOf — the D-D4 layered read over a DESERIALIZED standard block's nodes:
		// the DmeStandardRoot's Phase-A snapshotKey stamp, or a LOUD refusal (synthetic
		// blocks are always fresh-forged; an unstamped one is a defect, never defaulted).
		const rootStampOf = (blockNodes, label) => {
			const rootNode = (blockNodes || []).find(
				(oneNode) =>
					(oneNode.labels || []).indexOf(vocabulary.DME_ROLES.STANDARD_ROOT) !== -1,
			);
			if (!rootNode) {
				return { error: `${label}: no ${vocabulary.DME_ROLES.STANDARD_ROOT} node found` };
			}
			const snapshotKey = scalar((rootNode.properties || {}).snapshotKey);
			if (snapshotKey == null) {
				return {
					error:
						`${label}: standard block carries no snapshotKey root stamp — ` +
						`refusing to guess a version key (gaps explicit, never fabricated)`,
				};
			}
			return { snapshotKey: `${snapshotKey}` };
		};

		// toBlockEdge — every property value a PG-JSON array (the edf-mapping/edf-reference
		// serialization shape).
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

		const syntheticNativeMapping = (callback) => {
			const gatingManifest = strParam('gatingManifest', null);
			const sourceStandard = strParam('sourceStandard', null);
			const hubBundleDir = strParam('hubBundleDir', DEFAULT_HUB_BUNDLE_DIR);
			if (!gatingManifest || !sourceStandard) {
				callback(
					`-syntheticNativeMapping: --gatingManifest= and --sourceStandard= are both required`,
				);
				return;
			}

			const roster = standardDiscovery.roster({ includeSynthetic: true });
			const spokeFound = pairBinding.findRosterEntry({
				roster,
				standardName: sourceStandard,
			});
			if (spokeFound.error) {
				callback(`-syntheticNativeMapping: ${spokeFound.error}`);
				return;
			}
			// RIDER 1 — the structural misuse guard: TEST SCAFFOLDING refuses real standards.
			if (spokeFound.entry.synthetic !== true) {
				callback(
					`-syntheticNativeMapping REFUSED: '${sourceStandard}' resolves to bundle ` +
						`'${spokeFound.entry.bundleDir}' which is NOT synthetic. This tool is test ` +
						`scaffolding for the synthetic fixtures only — real standards use the real producers.`,
				);
				return;
			}
			const spokeName = spokeFound.entry.standardName;
			const hubName = standardDiscovery.cedsHubStandardName;

			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				storeAccess.open((err) => next(err, args));
			});

			// locate the gating manifest's hub + spoke STANDARD blocks (the only read inputs)
			taskList.push((args, next) => {
				forgeStore.getManifest({ manifestKey: gatingManifest }, (err, manifestRow) => {
					if (err) {
						next(err, args);
						return;
					}
					if (!manifestRow) {
						next(`-syntheticNativeMapping: no manifest '${gatingManifest}'`, args);
						return;
					}
					next('', { ...args, members: manifestRow.members || [] });
				});
			});

			taskList.push((args, next) => {
				const memberTaskList = new taskListPlus();
				const standardRows = {};
				args.members.forEach((oneMember) => {
					memberTaskList.push((memberArgs, memberNext) => {
						forgeStore.getBlock({ blockId: oneMember.blockId }, (err, blockRow) => {
							if (err) {
								memberNext(err, memberArgs);
								return;
							}
							if (blockRow && blockRow.type === 'standard') {
								standardRows[`${blockRow.subject}`.toLowerCase()] = blockRow;
							}
							memberNext('', memberArgs);
						});
					});
				});
				pipeRunner(memberTaskList.getList(), {}, (err) =>
					next(err, { ...args, standardRows }),
				);
			});

			// derive the edges: spoke nodes' cedsId × hub nodes' cedsId (deterministic order)
			taskList.push((args, next) => {
				const hubRow = args.standardRows[hubName.toLowerCase()];
				const spokeRow = args.standardRows[spokeName.toLowerCase()];
				if (!hubRow || !spokeRow) {
					next(
						`-syntheticNativeMapping: gating manifest lacks a ${!hubRow ? `'${hubName}'` : ''}` +
							`${!hubRow && !spokeRow ? ' and ' : ''}${!spokeRow ? `'${spokeName}'` : ''} standard block`,
						args,
					);
					return;
				}
				const hubBlock = replayBlock.deserializeBlock(hubRow.text);
				const spokeBlock = replayBlock.deserializeBlock(spokeRow.text);

				const hubStamp = rootStampOf(hubBlock.nodes, `hub '${hubName}'`);
				if (hubStamp.error) {
					next(`-syntheticNativeMapping: ${hubStamp.error}`, args);
					return;
				}
				const spokeStamp = rootStampOf(spokeBlock.nodes, `spoke '${spokeName}'`);
				if (spokeStamp.error) {
					next(`-syntheticNativeMapping: ${spokeStamp.error}`, args);
					return;
				}

				// the honesty knob (D-D5): the hub side of the binding stamps the SYNTHETIC
				// hub bundle's own snapshot provenance, never the real hub's.
				const binding = pairBinding.resolvePairBindingAtVersions({
					roster,
					hubStandardName: hubName,
					spokeStandardName: spokeName,
					aVersion: hubStamp.snapshotKey,
					bVersion: spokeStamp.snapshotKey,
					preferredHubBundleDir: hubBundleDir,
					warn: (message) => xLog.status(`[${moduleName}] ${message}`),
				});
				if (binding.error) {
					next(`-syntheticNativeMapping: ${binding.error}`, args);
					return;
				}

				const hubByCedsId = {};
				(hubBlock.nodes || []).forEach((oneNode) => {
					const cedsId = scalar((oneNode.properties || {}).cedsId);
					if (cedsId != null && `${cedsId}`.trim() !== '') {
						hubByCedsId[`${cedsId}`] = oneNode;
					}
				});

				const edges = [];
				const orphans = [];
				(spokeBlock.nodes || [])
					.slice()
					.sort((a, b) => (a.stableId < b.stableId ? -1 : a.stableId > b.stableId ? 1 : 0))
					.forEach((oneNode) => {
						const cedsId = scalar((oneNode.properties || {}).cedsId);
						if (cedsId == null || `${cedsId}`.trim() === '') {
							return;
						}
						const hubNode = hubByCedsId[`${cedsId}`];
						if (!hubNode) {
							orphans.push({ stableId: oneNode.stableId, cedsId: `${cedsId}` });
							return;
						}
						edges.push({
							type: 'EXACT_MATCH',
							fromRef: { source: oneNode.ref.source, id: oneNode.ref.id },
							toRef: { source: hubNode.ref.source, id: hubNode.ref.id },
							properties: {
								provenanceTier: 'spec-authoritative',
								mappingTool: `forgeManager:${moduleName}`,
							},
						});
					});

				if (edges.length === 0) {
					next(
						`-syntheticNativeMapping: derived ZERO edges for ${binding.pairSubject} — ` +
							`refusing to emit an empty mapping block`,
						args,
					);
					return;
				}
				xLog.status(
					`[${moduleName}] ${binding.pairSubject}@${binding.versionKey}: ` +
						`${edges.length} EXACT_MATCH edge(s), ${orphans.length} orphan(s) ` +
						`${orphans.length ? JSON.stringify(orphans) : ''}`,
				);
				next('', { ...args, binding, edges, orphans, hubRow, spokeRow, spokeBlock });
			});

			// serialize (the REAL extended serializer) + save through the REAL choke point
			taskList.push((args, next) => {
				const { binding } = args;
				const spokeHeader = args.spokeBlock.header || {};
				const header = {
					blockType: 'mapping',
					version: binding.publishedVersionB,
					stableUriPropertyName: spokeHeader.stableUriPropertyName,
					resolutionKey: spokeHeader.resolutionKey,
					pairA: binding.pairA,
					pairAVersion: binding.pairAVersion,
					pairB: binding.pairB,
					pairBVersion: binding.pairBVersion,
					publishedVersionA: binding.publishedVersionA,
					publishedVersionB: binding.publishedVersionB,
					tierScope: 'property',
				};
				const blockText = replayBlock.serializeBlock({
					header,
					nodes: [], // mappings are EDGES (reify-on-demand): zero nodes
					edges: args.edges.map(toBlockEdge),
				});
				forgeStore.saveBlock(
					{
						type: 'mapping',
						subject: binding.pairSubject,
						version: binding.versionKey,
						requires: [args.spokeRow.blockId, args.hubRow.blockId],
						text: blockText,
						producedBy: `forgeManager:${moduleName}`,
					},
					(err, result) =>
						next(err, { ...args, mappingBlockId: result ? result.blockId : null }),
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', {
					action: 'syntheticNativeMapping',
					pairSubject: args.binding.pairSubject,
					versionKey: args.binding.versionKey,
					publishedVersionA: args.binding.publishedVersionA,
					publishedVersionB: args.binding.publishedVersionB,
					edgeCount: args.edges.length,
					orphans: args.orphans,
					mappingBlockId: args.mappingBlockId,
				});
			});
		};

		return { syntheticNativeMapping };
	};

module.exports = moduleFunction({ moduleName });
