'use strict';

// Phase-3 standing gate (HubReference reference subgraph) — HubReference count == the DERIVED expectation
// (2324 property-tier + 27437 value-tier + 27 qualified = 29788) + exactly 1 HubDefinition. The count is
// DERIVED (and re-derived by referenceSubgraph.js), not a magic number; the standalone gate of record
// test/phase3HubReference.js proves the full additive delta + the drop/collision twins.
//
// expectFail:true UNTIL the Phase-3 re-freeze. The HubReference subgraph is NOT in the current gating
// manifest (it lands when the baselines are re-frozen to the Phase-3 candidate), so this gate honestly
// XFAILs against today's golden. ▶ RE-FREEZE CHECKLIST (REQUIRED, do NOT omit — a real gate left masked
// as XFAIL hides regressions): when the baselines are re-frozen to the candidate, FLIP expectFail:false
// here AND prove it with the count-drop twin (test/phase3HubReference.js twinB observed failing).

module.exports = () => ({
	name: 'referenceSubgraph.hubReferenceCountDerived',
	phase: 'ReferenceSubgraph',
	kind: 'positive',
	expectFail: false, // ENFORCED at the Phase-3 re-freeze (2026-06-30, VELVET_MARBLE) — proven by phase3HubReference twinB
	run: (ctx, callback) => {
		const cypher = `
			MATCH (r:HubReference)
			WITH
				sum(CASE WHEN r.referenceTier='property' AND size(r.qualifierKeys)=0 THEN 1 ELSE 0 END) AS propertyTier,
				sum(CASE WHEN r.referenceTier='value' THEN 1 ELSE 0 END) AS valueTier,
				sum(CASE WHEN r.referenceTier='property' AND size(r.qualifierKeys)>0 THEN 1 ELSE 0 END) AS qualified,
				count(r) AS refs
			MATCH (d:HubDefinition)
			RETURN propertyTier, valueTier, qualified, refs, count(d) AS defs
		`;
		ctx.resources.lifecycle.runCypher(
			{ graphName: ctx.candidateGraphName, cypher, params: {} },
			(err, result) => {
				if (err) {
					callback('', { passed: false, detail: `query error: ${err}` });
					return;
				}
				const row = (result.records && result.records[0]) || {};
				const propertyTier = Number(row.propertyTier || 0);
				const valueTier = Number(row.valueTier || 0);
				const qualified = Number(row.qualified || 0);
				const refs = Number(row.refs || 0);
				const defs = Number(row.defs || 0);
				const passed =
					propertyTier === 2324 &&
					valueTier === 27437 &&
					qualified === 27 &&
					refs === 29788 &&
					defs === 1;
				callback('', {
					passed,
					detail: `HubReference=${refs} (property=${propertyTier}/2324, value=${valueTier}/27437, qualified=${qualified}/27); HubDefinition=${defs}/1 (REQUIRED total 29788)`,
				});
			},
		);
	},
});
