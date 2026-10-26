'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// replayCount.js — the HERMETIC replay of a manifest: what a graph replayed from these schema blocks would hold, counted without a
// graph (ML3.1 Part B, the replay-the-oldest discipline; AMBER_JOURNEY ruling Q1 2026-10-26). It runs replay()'s own pre-write path
// (lib/replay/replay-engine.js replay(), lines ~1835-1880): each block through replay-block's deserializeBlock (which reads EVERY
// serializerVersion this tree has written), each block's nodes and edges through the engine's own validateShapedGraph guards, then
// applies the engine's MERGE semantics to count:
//   nodeCount  distinct stableIds              (nodes MERGE on :ForgedNode {stableId})
//   edgeCount  distinct edge identities whose BOTH endpoints are nodes of the manifest (edges merge on type, endpoints and the
//              FULL property map, replay-engine edgeConservationIdentityFor; an edge with an absent endpoint is dangling, never
//              written)
// The live twin is graphBuilder -replayOldest --live, which replays the same blocks into a DEV_ graph through replayManager and
// counts what the graph holds; the two must be equal (measured once at READY, reported in GATEREPORT-ML3.1b).
//
//   hermeticReplayCountFor({ memberCount, blockTextAt }) → { nodeCount, edgeCount, danglingEdgeCount, blockCount } | { error }
//       blockTextAt(position) → the member's schema block text (the caller's reader, so a 1 GB manifest is never held whole)
//
// One block is held in memory at a time; only identity strings accumulate. A block that will not deserialize, or that a guard
// refuses, is refused BY NAME with its position: a format replay can no longer read is exactly what this exists to catch.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const replayBlock = require(path.join(__dirname, '..', 'replay', 'replay-block'))();
const replayEngine = require(path.join(__dirname, '..', 'replay', 'replay-engine'))();

const refusalText = (what, where) => refuse.byName({ moduleName, what, where }).message;

// attemptDeserialize — the ONE boundary where deserializeBlock's throw becomes an error string (replay() contains it the same way)
const attemptDeserialize = (blockText) => {
	let block = null;
	let deserializeFault = '';
	try {
		block = replayBlock.deserializeBlock(blockText);
	} catch (deserializeError) {
		deserializeFault = deserializeError.message;
	}
	return deserializeFault ? { error: deserializeFault } : { block };
};

const hermeticReplayCountFor = ({ memberCount, blockTextAt } = {}) => {
	if (!Number.isInteger(memberCount) || memberCount <= 0 || typeof blockTextAt !== 'function') {
		return { error: refusalText('memberCount (a positive whole number) and blockTextAt(position) are required', 'hermeticReplayCountFor({ memberCount, blockTextAt }); members are read in replay order') };
	}
	const nodeIdentitySet = new Set();
	const edgeEndpointByIdentity = new Map();
	for (let blockIndex = 0; blockIndex < memberCount; blockIndex++) {
		const deserialized = attemptDeserialize(blockTextAt(blockIndex));
		if (deserialized.error) {
			return { error: refusalText(`member ${blockIndex} is not a readable schema block: ${deserialized.error}`, 'lib/replay/replay-block.js deserializeBlock must read every format a published manifest holds (README_AI rule 7)') };
		}
		const { header, nodes, edges } = deserialized.block;
		const validated = replayEngine.validateShapedGraph([{ sourceLabel: `member ${blockIndex} ${header.blockType}`, nodes, edges: edges.map((oneEdge) => ({ ...oneEdge, blockType: header.blockType })) }]);
		if (validated.error) {
			return { error: refusalText(`member ${blockIndex}: ${validated.error}`, 'replay-engine validateShapedGraph: the guards replay() applies before any write') };
		}
		nodes.forEach((oneNode) => nodeIdentitySet.add(`${oneNode.stableId}`));
		edges.forEach((oneEdge) => edgeEndpointByIdentity.set(replayEngine.edgeConservationIdentityFor(oneEdge), [`${oneEdge.fromRef.id}`, `${oneEdge.toRef.id}`]));
	}
	let edgeCount = 0;
	let danglingEdgeCount = 0;
	edgeEndpointByIdentity.forEach(([fromStableId, toStableId]) => {
		if (nodeIdentitySet.has(fromStableId) && nodeIdentitySet.has(toStableId)) {
			edgeCount += 1;
		} else {
			danglingEdgeCount += 1;
		}
	});
	return { nodeCount: nodeIdentitySet.size, edgeCount, danglingEdgeCount, blockCount: memberCount };
};

module.exports = { hermeticReplayCountFor, moduleName };
