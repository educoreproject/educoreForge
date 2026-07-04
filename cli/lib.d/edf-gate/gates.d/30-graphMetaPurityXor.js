'use strict';

const path = require('path');

// Wave-B standing gate (CRIMSON gate 6 — WORKORDER-inferenceAndSelfDoc-070226.md): the :GraphMeta
// STRUCTURAL purity invariant. THE NEW G2: for EVERY node in the graph — no label scoping, no exempt
// name list — exactly one of the following holds:
//   (a) the node carries an honest `_source` (it is replayed standards content), OR
//   (b) the node carries the :GraphMeta marker (it is legitimately source-less self-documentation:
//       SchemaView terms, ManifestRecipe/RecipeBlock, StandardDefinition, the GraphProvenance passport —
//       stamped label-driven by the graph-meta finisher / stampProvenance from
//       vocabulary.GRAPH_META.META_NODE_LABELS).
// A node with NEITHER is unattributed content (the old G2's silent failure mode); a node with BOTH is
// misattributed self-documentation. Either way the gate is RED and NAMES examples. Adding a new meta
// node type = one entry in META_NODE_LABELS; this gate needs zero edits (the structural-marker doctrine).
//
// LEGACY-EDGE purity (the old G2's other half) is unchanged and remains asserted elsewhere; this gate
// REPLACES the hand-written 64-node exemption list of the Phase-R G2.
//
// RED TEST (proven in the Wave-B scratch battery, DEVLOG-inferenceAndSelfDoc-070226.md PHASE B): a node
// with neither _source nor :GraphMeta injected into a candidate turns this gate RED naming the node.

const CORE_LIB = path.join(__dirname, '..', '..', '..', '..', 'npm', 'qtools-graph-forge-core', 'lib');
const { GRAPH_META } = require(path.join(CORE_LIB, 'vocabulary', 'vocabulary'));

module.exports = () => ({
	name: 'purity.graphMetaXor',
	phase: 'WaveB',
	kind: 'positive',
	expectFail: false,
	run: (ctx, callback) => {
		// the label position cannot be parameterized; GRAPH_META.LABEL is registry-sourced and shaped
		// like a bare identifier by construction ('GraphMeta').
		const cypher = `
			MATCH (n)
			WITH n, (n._source IS NOT NULL) AS hasSource, (n:\`${GRAPH_META.LABEL}\`) AS isMeta
			WHERE NOT (hasSource XOR isMeta)
			RETURN count(n) AS violations,
				collect(CASE WHEN hasSource AND isMeta THEN 'BOTH: ' ELSE 'NEITHER: ' END +
					coalesce(n.stableId, n.name, 'labels=' + reduce(s='', l IN labels(n) | s + l + ' ')))[0..10] AS examples
		`;
		ctx.resources.lifecycle.runCypher(
			{ graphName: ctx.candidateGraphName, cypher, params: {} },
			(err, result) => {
				if (err) {
					callback('', { passed: false, detail: `query error: ${err}` });
					return;
				}
				const row = (result.records && result.records[0]) || {};
				const violations = Number(row.violations || 0);
				callback('', {
					passed: violations === 0,
					detail:
						`graphMetaXor violations=${violations}` +
						(violations
							? ` examples=[${(row.examples || []).join(' | ')}]`
							: ' (REQUIRED: every node carries _source XOR :GraphMeta — structural marker, no exempt list)'),
				});
			},
		);
	},
});
