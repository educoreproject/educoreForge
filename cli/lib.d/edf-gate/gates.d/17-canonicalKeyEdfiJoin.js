'use strict';

// Phase-2 standing gate (ENFORCED — baselines re-frozen to the addressed golden 2026-06-29): the CEDS
// property canonicalKeys JOIN the Ed-Fi crosswalk Global IDs — exactly 379 of 385 Yes-row CEDS-property
// targets, and the 6 UNjoined targets are EXACTLY {P001070..P001075} (the remodeled person-id properties,
// resolved via the Phase-4 version-bridge, not here). expectFail:false ⇒ REQUIRED pass; a regression that
// breaks the join (or shifts the miss-set) turns the suite RED. Mirrors test/phase2CanonicalAddressing.js.

const EXPECTED_JOIN = 379;
const EXPECTED_TOTAL = 385;
// the EXACT 6 unjoined targets — the remodeled person-id properties that resolve via the Phase-4
// version-bridge, not here. Asserting the SET (not just the count) closes the gap where a different
// miss-set of the same size would falsely pass.
const EXPECTED_MISSING = ['P001070', 'P001071', 'P001072', 'P001073', 'P001074', 'P001075'];

module.exports = () => ({
	name: 'canonicalAddressing.edfiGlobalIdJoin',
	phase: 'CanonicalAddressing',
	kind: 'regression',
	expectFail: false,
	run: (ctx, callback) => {
		ctx.resources.lifecycle.runCypher(
			{
				graphName: ctx.candidateGraphName,
				cypher: `MATCH (n:CedsProperty) WHERE n.canonicalKey IS NOT NULL RETURN collect(n.canonicalKey) AS keys`,
				params: {},
			},
			(err, result) => {
				if (err) {
					callback('', { passed: false, detail: `query error: ${err}` });
					return;
				}
				const keys = new Set(((result.records && result.records[0]) || {}).keys || []);
				const fx = ctx.groundTruth.loadFixtures();
				const header = fx.elements.header;
				const uriCol = header.find((c) => /CEDSOntologyPropertyURI/i.test(c));
				const confCol = header.find((c) => /CEDSMappingConfidence/i.test(c) || /MappingConfidence/i.test(c));
				const tokenOf = (uri) => {
					const m = `${uri}`.match(/#?(P\d{6,})\s*$/);
					return m ? m[1] : null;
				};
				const yesTargets = new Set();
				fx.elements.records.forEach((r) => {
					if (`${r[confCol]}`.trim().toLowerCase() !== 'yes') return;
					const t = tokenOf(r[uriCol]);
					if (t) yesTargets.add(t);
				});
				const joined = [...yesTargets].filter((t) => keys.has(t)).length;
				const missing = [...yesTargets].filter((t) => !keys.has(t)).sort();
				const missingSetExact =
					missing.length === EXPECTED_MISSING.length &&
					missing.every((t, i) => t === EXPECTED_MISSING[i]);
				callback('', {
					passed:
						joined === EXPECTED_JOIN &&
						yesTargets.size === EXPECTED_TOTAL &&
						missingSetExact,
					detail: `joined=${joined}/${yesTargets.size}; missing=[${missing.join(',')}] expectMissing=[${EXPECTED_MISSING.join(',')}] setExact=${missingSetExact} (REQUIRED: 379/385, 6 missing = remodeled person-ids -> Phase-4)`,
				});
			},
		);
	},
});
