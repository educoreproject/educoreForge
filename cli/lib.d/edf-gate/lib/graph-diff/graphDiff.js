'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// graphDiff.js — structured baseline-vs-candidate diff (Phase 0, deliverable 3).
//
// Consumes two elementManifests (the sorted node/edge line arrays produced by graphFingerprint) and
// partitions the difference into added / removed / changed, broken out by node-label, edge-type, and
// changed-property. An EMPTY report means the two graphs are byte-identical in content (the same
// condition the fingerprint equality asserts) — the diff explains a non-empty fingerprint mismatch.
//
// Identity keys:
//   nodes — keyed by stableId (the durable resolution key). Present-both-but-different => changed,
//           with the differing fields named (labels / specific properties / embedding).
//   edges — no intrinsic id, so diffed as a multiset of canonical lines: a line in candidate but not
//           baseline is added, the reverse is removed. (A property change reads as one removed + one
//           added edge line — correct, since an edge has no identity to "change in place".)
//
// Pure + synchronous (no Neo4j, no async). No async/await, no try/catch for control flow. camelCase.
//
// @concept: [[GraphDiff]]
// @concept: [[StructuredDiffReport]]

// parse a node line back to its object; tolerant only of well-formed lines (the producer is
// graphFingerprint, so malformedness is a real defect, surfaced by throwing).
const parseNodeLine = (line) => {
	const obj = JSON.parse(line);
	return obj;
};

// tally helper: increment a count keyed by `key` in `bucket`.
const bump = (bucket, key) => {
	bucket[key] = (bucket[key] || 0) + 1;
};

// describe what changed between two same-stableId node objects.
const describeNodeChange = (baseObj, candObj) => {
	const labelsBase = (baseObj.labels || []).slice().sort();
	const labelsCand = (candObj.labels || []).slice().sort();
	const labelsChanged = JSON.stringify(labelsBase) !== JSON.stringify(labelsCand);

	const propKeys = new Set([
		...Object.keys(baseObj.props || {}),
		...Object.keys(candObj.props || {}),
	]);
	const changedProps = [];
	propKeys.forEach((oneKey) => {
		const a = JSON.stringify((baseObj.props || {})[oneKey]);
		const b = JSON.stringify((candObj.props || {})[oneKey]);
		if (a !== b) {
			changedProps.push(oneKey);
		}
	});
	changedProps.sort();

	const embeddingChanged =
		(baseObj.embeddingHash || null) !== (candObj.embeddingHash || null);

	return {
		stableId: candObj.stableId,
		labelsChanged,
		labelsBase: labelsChanged ? labelsBase : undefined,
		labelsCand: labelsChanged ? labelsCand : undefined,
		changedProps,
		embeddingChanged,
	};
};

const moduleFunction = ({ moduleName } = {}) => () => {
	// diffManifests({baseline, candidate}) -> structured report. baseline/candidate are
	// elementManifests: { nodes: string[], edges: string[] } (sorted canonical lines).
	const diffManifests = ({ baseline, candidate } = {}) => {
		const baseNodes = new Map();
		(baseline.nodes || []).forEach((line) => {
			const obj = parseNodeLine(line);
			baseNodes.set(obj.stableId, { line, obj });
		});
		const candNodes = new Map();
		(candidate.nodes || []).forEach((line) => {
			const obj = parseNodeLine(line);
			candNodes.set(obj.stableId, { line, obj });
		});

		const addedNodes = [];
		const removedNodes = [];
		const changedNodes = [];
		const addedNodesByLabel = {};
		const removedNodesByLabel = {};
		const changedPropFrequency = {};

		// removed + changed: walk baseline
		baseNodes.forEach((baseEntry, stableId) => {
			const candEntry = candNodes.get(stableId);
			if (!candEntry) {
				removedNodes.push(stableId);
				(baseEntry.obj.labels || ['(none)']).forEach((lbl) =>
					bump(removedNodesByLabel, lbl),
				);
				return;
			}
			if (baseEntry.line !== candEntry.line) {
				const change = describeNodeChange(baseEntry.obj, candEntry.obj);
				changedNodes.push(change);
				change.changedProps.forEach((p) => bump(changedPropFrequency, p));
				if (change.embeddingChanged) {
					bump(changedPropFrequency, '(embedding)');
				}
				if (change.labelsChanged) {
					bump(changedPropFrequency, '(labels)');
				}
			}
		});

		// added: walk candidate
		candNodes.forEach((candEntry, stableId) => {
			if (!baseNodes.has(stableId)) {
				addedNodes.push(stableId);
				(candEntry.obj.labels || ['(none)']).forEach((lbl) =>
					bump(addedNodesByLabel, lbl),
				);
			}
		});

		// edges: multiset line difference, partitioned by edge type (parsed from the line)
		const baseEdgeCounts = new Map();
		(baseline.edges || []).forEach((line) =>
			baseEdgeCounts.set(line, (baseEdgeCounts.get(line) || 0) + 1),
		);
		const candEdgeCounts = new Map();
		(candidate.edges || []).forEach((line) =>
			candEdgeCounts.set(line, (candEdgeCounts.get(line) || 0) + 1),
		);

		const addedEdges = [];
		const removedEdges = [];
		const addedEdgesByType = {};
		const removedEdgesByType = {};
		const edgeType = (line) => {
			const obj = JSON.parse(line);
			return obj.type || '(none)';
		};

		const allEdgeLines = new Set([
			...baseEdgeCounts.keys(),
			...candEdgeCounts.keys(),
		]);
		allEdgeLines.forEach((line) => {
			const baseN = baseEdgeCounts.get(line) || 0;
			const candN = candEdgeCounts.get(line) || 0;
			if (candN > baseN) {
				for (let i = 0; i < candN - baseN; i++) addedEdges.push(line);
				bump(addedEdgesByType, edgeType(line));
			} else if (baseN > candN) {
				for (let i = 0; i < baseN - candN; i++) removedEdges.push(line);
				bump(removedEdgesByType, edgeType(line));
			}
		});

		const identical =
			addedNodes.length === 0 &&
			removedNodes.length === 0 &&
			changedNodes.length === 0 &&
			addedEdges.length === 0 &&
			removedEdges.length === 0;

		return {
			identical,
			summary: {
				addedNodes: addedNodes.length,
				removedNodes: removedNodes.length,
				changedNodes: changedNodes.length,
				addedEdges: addedEdges.length,
				removedEdges: removedEdges.length,
			},
			nodes: {
				added: addedNodes.sort(),
				removed: removedNodes.sort(),
				changed: changedNodes,
				addedByLabel: addedNodesByLabel,
				removedByLabel: removedNodesByLabel,
				changedPropFrequency,
			},
			edges: {
				added: addedEdges.sort(),
				removed: removedEdges.sort(),
				addedByType: addedEdgesByType,
				removedByType: removedEdgesByType,
			},
		};
	};

	return { diffManifests, describeNodeChange };
};

module.exports = moduleFunction({ moduleName });
