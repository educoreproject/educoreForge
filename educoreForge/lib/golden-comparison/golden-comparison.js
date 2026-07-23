'use strict';

// golden-comparison.js — the pure set comparison behind evaluate-against-golden.js.
//
// The acceptance question is "does the recreated pipeline produce THE SAME SET OF THINGS as the
// live golden" — and "things" is NODES *and* EDGES. The evaluator used to compare node stableId
// sets only; edges were never queried on either side, so a forge change that dropped or renamed
// an entire edge class (SUBCLASS_OF, HAS_VALUE, REFERENCES) still passed green. That is the same
// class as the historical 0/0-green defect: a scope narrowing that reports success for a
// comparison it did not perform.
//
// This module holds the comparison so it can be exercised with INJECTED node/edge sets — no live
// graph, no docker, no neo4j. The evaluator wires the extraction (a cypher query on the golden, the
// block's own node/edge lines on the recreated side); the set arithmetic lives here and is tested.
//
// A missing edge set must NEVER read as "no edge differences" — that would recreate the very defect
// this fixes — so compareGraph REQUIRES all four sets to be present, and refuses a missing one.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// diffSets — what the golden has that the recreation LACKS (missing), and what the
		// recreation INVENTED that the golden lacks (extra). identical iff both are empty.
		const diffSets = (goldenSet, harvestedSet) => {
			const missing = [...goldenSet].filter((oneKey) => !harvestedSet.has(oneKey));
			const extra = [...harvestedSet].filter((oneKey) => !goldenSet.has(oneKey));
			return { missing, extra, identical: missing.length === 0 && extra.length === 0 };
		};

		// compareGraph — the whole answer: node diff AND edge diff, and one overall verdict. All four
		// sets are REQUIRED; an absent one is a fault, not an empty comparison, because "there were no
		// edge differences" and "edges were never compared" are the exact confusion the historical
		// defect lived in.
		const compareGraph = ({ goldenNodeIds, harvestedNodeIds, goldenEdgeKeys, harvestedEdgeKeys }) => {
			[
				['goldenNodeIds', goldenNodeIds],
				['harvestedNodeIds', harvestedNodeIds],
				['goldenEdgeKeys', goldenEdgeKeys],
				['harvestedEdgeKeys', harvestedEdgeKeys],
			].forEach(([argumentName, argumentValue]) => {
				if (!(argumentValue instanceof Set)) {
					throw new Error(
						`golden-comparison.compareGraph: ${argumentName} must be a Set — a missing set must ` +
							`NEVER read as "no differences". Got ${argumentValue === undefined ? 'undefined' : typeof argumentValue}.`,
					);
				}
			});
			const nodes = diffSets(goldenNodeIds, harvestedNodeIds);
			const edges = diffSets(goldenEdgeKeys, harvestedEdgeKeys);
			return { nodes, edges, identical: nodes.identical && edges.identical };
		};

		return { diffSets, compareGraph };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
