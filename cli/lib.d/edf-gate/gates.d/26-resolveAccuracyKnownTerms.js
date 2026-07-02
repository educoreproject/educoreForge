'use strict';

const path = require('path');

// Phase-8 standing gate (the RESOLVE-VERB ACCURACY gate). Over the deterministic curated KNOWN-TERM set
// (Appendix A: the first 15 Ed-Fi gold-crosswalk positives, sorted by source stableId, whose Ed-Fi source is
// materialized), resolve must RETRIEVE the correct CEDS HubReference address into the ranked candidates
// (recall@K) for at least the documented floor. This asserts the substantive correctness claim — "resolve
// returns the correct HubReference address for terms with known answers" — on the DETERMINISTIC retrieval
// half (cosine top-K), so it never flakes: the gate uses a deterministic STUB reranker (the reranker only
// chooses AMONG retrieved candidates; the gold-in-candidates check is reranker-independent). recall@15
// measured 13/15 = 0.867 (consistent with the Phase-5 recall@15 = 0.871); the floor is set to 0.80 (12/15)
// for embedding/cache-drift margin. The REAL Opus end-to-end top-1 is exercised by the gate of record
// (test/phase8Resolve.js), not here (LLM variance quarantined). The TWIN (test/phase8Resolve.js
// accuracyTwin): degrade the curated definitions to gibberish -> recall collapses far below the floor,
// proving the gate measures real definition signal and bites.

const SUPPORT = path.join(__dirname, '..', 'lib', 'resolve-gate-support', 'resolveGateSupport');
const { getCuratedKnownTerms, getStubResolveCore, goldInCandidates } = require(SUPPORT);

const RECALL_FLOOR = 0.8; // >= 12/15

module.exports = () => ({
	name: 'resolve.accuracyKnownTermsRecallAtK',
	phase: 'Phase8',
	kind: 'positive',
	expectFail: false, // ENFORCED — read-only capability, baseline-independent; deterministic retrieval
	run: (ctx, callback) => {
		const forgeStore = ctx.resources.forgeStore;
		const gatingManifest = ctx.manifestKey;
		if (!gatingManifest) {
			callback('', { passed: false, detail: 'resolve.accuracy gate requires --manifest (the gating manifest)' });
			return;
		}
		getCuratedKnownTerms({ forgeStore, gatingManifest }, (curatedErr, curated) => {
			if (curatedErr) {
				callback('', { passed: false, detail: `curated-set load error: ${curatedErr}` });
				return;
			}
			getStubResolveCore({ forgeStore, gatingManifest, topK: 15, cosineFloor: 0 }, (coreErr, resolveCore) => {
				if (coreErr) {
					callback('', { passed: false, detail: `stub resolve-core load error: ${coreErr}` });
					return;
				}
				let inTopK = 0;
				const misses = [];
				let i = 0;
				const runOne = () => {
					if (i >= curated.length) {
						const recall = curated.length ? inTopK / curated.length : 0;
						const passed = recall >= RECALL_FLOOR;
						const missText = misses.slice(0, 4).map((oneMiss) => oneMiss.from).join(', ');
						callback('', {
							passed,
							detail: `recall@15=${inTopK}/${curated.length}=${Math.round(recall * 1e4) / 1e4} (REQUIRED >= ${RECALL_FLOOR}); gold HubReference present in ranked candidates. ${misses.length ? `misses: [${missText}]` : 'no misses'} (deterministic retrieval; stub reranker)`,
						});
						return;
					}
					const oneTerm = curated[i++];
					resolveCore.resolve({ term: oneTerm.term, definition: oneTerm.defText }, (resErr, result) => {
						if (resErr) {
							callback('', { passed: false, detail: `resolve('${oneTerm.fromStableId}') error: ${resErr}` });
							return;
						}
						const found = goldInCandidates(result, oneTerm.goldToken);
						if (found.hit) {
							inTopK++;
						} else {
							misses.push({ from: oneTerm.fromStableId.replace('edfi:field/', ''), gold: oneTerm.goldToken });
						}
						runOne();
					});
				};
				runOne();
			});
		});
	},
});
