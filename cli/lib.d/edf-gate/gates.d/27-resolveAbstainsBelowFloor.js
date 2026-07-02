'use strict';

const path = require('path');

// Phase-8 standing gate (the ABSTAIN gate — the correctness differentiator). A genuinely-unmappable input
// MUST ABSTAIN (suggested=null) rather than return a wrong address. This gate proves the deterministic
// abstain BOUNDARY (WILD_FALCON: "a term whose true answer is below the abstain threshold MUST abstain"):
// a gibberish term (measured best-cosine ~0.35) under a documented cosineFloor of 0.5 abstains via the
// deterministic cosineFloor pre-abstain (reason='cosineFloor', suggested=null), while a real mappable term
// (best-cosine ~0.7-0.95) under the SAME floor does NOT abstain and returns a resolved address. Both halves
// in one gate = the assertion AND its fault-injection twin (the positive-of-the-negative): if the boundary
// did not bite, the gibberish term would return a wrong address; if it bit too hard, the real term would be
// wrongly abstained. Deterministic (cosine-based, stub reranker) so it never flakes. The REAL Opus
// llm-NONE abstain path (a 'Not in CEDS' negative -> NONE) is additionally exercised by the gate of record.

const SUPPORT = path.join(__dirname, '..', 'lib', 'resolve-gate-support', 'resolveGateSupport');
const { getStubResolveCore, getCuratedKnownTerms } = require(SUPPORT);

const ABSTAIN_FLOOR = 0.5; // gibberish ~0.35 (abstains) vs real terms ~0.7-0.95 (do not)
const GIBBERISH = 'xyzzy plugh frobnicate the quux of zorkmid blivet wibble';

module.exports = () => ({
	name: 'resolve.abstainsBelowFloorNotMappable',
	phase: 'Phase8',
	kind: 'twin',
	expectFail: false, // ENFORCED — read-only capability, deterministic boundary
	run: (ctx, callback) => {
		const forgeStore = ctx.resources.forgeStore;
		const gatingManifest = ctx.manifestKey;
		if (!gatingManifest) {
			callback('', { passed: false, detail: 'resolve.abstain gate requires --manifest (the gating manifest)' });
			return;
		}
		getStubResolveCore({ forgeStore, gatingManifest, topK: 15, cosineFloor: 0 }, (coreErr, resolveCore) => {
			if (coreErr) {
				callback('', { passed: false, detail: `stub resolve-core load error: ${coreErr}` });
				return;
			}
			// (1) unmappable gibberish under the floor MUST abstain.
			resolveCore.resolve(
				{ term: GIBBERISH, definition: GIBBERISH, cosineFloor: ABSTAIN_FLOOR },
				(unErr, unmappable) => {
					if (unErr) {
						callback('', { passed: false, detail: `unmappable resolve error: ${unErr}` });
						return;
					}
					// (2) a real mappable term (the control twin) under the SAME floor must NOT abstain.
					getCuratedKnownTerms({ forgeStore, gatingManifest }, (curatedErr, curated) => {
						if (curatedErr || !curated.length) {
							callback('', { passed: false, detail: `curated-set load error: ${curatedErr || 'empty'}` });
							return;
						}
						const real = curated[0];
						resolveCore.resolve(
							{ term: real.term, definition: real.defText, cosineFloor: ABSTAIN_FLOOR },
							(reErr, mappable) => {
								if (reErr) {
									callback('', { passed: false, detail: `mappable resolve error: ${reErr}` });
									return;
								}
								const unmappableAbstains =
									unmappable.abstain === true &&
									unmappable.suggested === null &&
									unmappable.abstainReason === 'cosineFloor';
								const mappableResolves = mappable.abstain === false && !!mappable.suggested;
								const passed = unmappableAbstains && mappableResolves;
								callback('', {
									passed,
									detail: `floor=${ABSTAIN_FLOOR}: UNMAPPABLE(gibberish best=${unmappable.meta.bestCosine}) abstain=${unmappable.abstain} reason=${unmappable.abstainReason} suggested=${unmappable.suggested === null ? 'null' : 'SET'} | CONTROL('${real.fromStableId.replace('edfi:field/', '')}' best=${mappable.meta.bestCosine}) abstain=${mappable.abstain} suggested=${mappable.suggested ? 'SET' : 'null'} (REQUIRED: unmappable abstains via cosineFloor AND mappable resolves)`,
								});
							},
						);
					});
				},
			);
		});
	},
});
