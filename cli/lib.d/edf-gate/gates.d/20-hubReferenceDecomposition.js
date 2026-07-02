'use strict';

// Phase-3 standing gate — decomposition invariants. Every HubReference resolves its address onto the REAL
// hub structural nodes: exactly one HAS_CEDS_DOMAIN, one HAS_CEDS_PROPERTY, one IN_HUB (a HubDefinition);
// every value-tier reference additionally resolves exactly one HAS_CEDS_VALUE and one HAS_CEDS_RANGE; and
// every HAS_CEDS_* edge lands on a real :ForgedNode hub node (no dangling decomposition). A malformed
// reference (missing a required decomposition edge, or a dangling target) turns the suite RED. Standalone
// proof: test/phase3HubReference.js (the drop twin removes a reference and its decomposition).
//
// expectFail:true UNTIL the Phase-3 re-freeze (the subgraph is not in today's gating manifest, so this
// honestly XFAILs). ▶ RE-FREEZE CHECKLIST (REQUIRED): FLIP expectFail:false at re-freeze AND prove with
// the phase3HubReference twins (a dropped reference fails the decomposition/count gate).

module.exports = () => ({
	name: 'referenceSubgraph.decompositionInvariants',
	phase: 'ReferenceSubgraph',
	kind: 'positive',
	expectFail: false, // ENFORCED at the Phase-3 re-freeze (2026-06-30, VELVET_MARBLE) — proven by phase3HubReference twins
	run: (ctx, callback) => {
		const cypher = `
			MATCH (r:HubReference)
			OPTIONAL MATCH (r)-[:HAS_CEDS_DOMAIN]->(dom) WITH r, count(dom) AS doms
			OPTIONAL MATCH (r)-[:HAS_CEDS_PROPERTY]->(prop) WITH r, doms, count(prop) AS props
			OPTIONAL MATCH (r)-[:IN_HUB]->(hub:HubDefinition) WITH r, doms, props, count(hub) AS hubs
			OPTIONAL MATCH (r)-[:HAS_CEDS_VALUE]->(val) WITH r, doms, props, hubs, count(val) AS vals
			OPTIONAL MATCH (r)-[:HAS_CEDS_RANGE]->(rng) WITH r, doms, props, hubs, vals, count(rng) AS rngs
			WITH
				sum(CASE WHEN doms<>1 THEN 1 ELSE 0 END) AS missingDomain,
				sum(CASE WHEN props<>1 THEN 1 ELSE 0 END) AS missingProperty,
				sum(CASE WHEN hubs<>1 THEN 1 ELSE 0 END) AS missingInHub,
				sum(CASE WHEN r.referenceTier='value' AND vals<>1 THEN 1 ELSE 0 END) AS valueMissingValue,
				sum(CASE WHEN r.referenceTier='value' AND rngs<>1 THEN 1 ELSE 0 END) AS valueMissingRange
			RETURN missingDomain, missingProperty, missingInHub, valueMissingValue, valueMissingRange
		`;
		ctx.resources.lifecycle.runCypher(
			{ graphName: ctx.candidateGraphName, cypher, params: {} },
			(err, result) => {
				if (err) {
					callback('', { passed: false, detail: `query error: ${err}` });
					return;
				}
				const row = (result.records && result.records[0]) || {};
				const md = Number(row.missingDomain || 0);
				const mp = Number(row.missingProperty || 0);
				const mh = Number(row.missingInHub || 0);
				const vv = Number(row.valueMissingValue || 0);
				const vr = Number(row.valueMissingRange || 0);
				// require refs to exist (so an empty graph does not pass vacuously) — a separate dangling check
				const cypherDangling = `
					MATCH (r:HubReference)-[e:HAS_CEDS_DOMAIN|HAS_CEDS_PROPERTY|HAS_CEDS_RANGE|HAS_CEDS_VALUE|HAS_CEDS_QUALIFIER]->(t)
					RETURN count(e) AS decompEdges, sum(CASE WHEN NOT t:ForgedNode OR t._source IS NULL THEN 1 ELSE 0 END) AS dangling
				`;
				ctx.resources.lifecycle.runCypher(
					{ graphName: ctx.candidateGraphName, cypher: cypherDangling, params: {} },
					(err2, result2) => {
						if (err2) {
							callback('', { passed: false, detail: `dangling query error: ${err2}` });
							return;
						}
						const row2 = (result2.records && result2.records[0]) || {};
						const decompEdges = Number(row2.decompEdges || 0);
						const dangling = Number(row2.dangling || 0);
						const passed =
							md === 0 && mp === 0 && mh === 0 && vv === 0 && vr === 0 && dangling === 0 && decompEdges > 0;
						callback('', {
							passed,
							detail: `missing DOMAIN=${md} PROPERTY=${mp} IN_HUB=${mh}; value-tier missing VALUE=${vv} RANGE=${vr}; HAS_CEDS_* edges=${decompEdges} dangling=${dangling} (REQUIRED all 0, edges>0)`,
						});
					},
				);
			},
		);
	},
});
