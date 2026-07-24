'use strict';

// genericBridge — the DEFAULT generic bridge.js plugin (design §1, §3.11). It is the plugin most
// (source, hub) pairings resolve to: bringing in a new standard's bridge is normally a recipe
// entry + a crosswalk file + THIS plugin, no new code. A standard needing bespoke logic (CTDL's
// structural bridge) registers an OVERRIDE in bridgeMaker's registry alongside it.
//
// THE MAPPER CONTRACT (interfaces.js @interface BridgeModule):
//   bridgeModule({ ...injected library tools }) ({ inGraph, hub, applyLabel }, cb)
//       -> cb('', { edgesWritten, decisionBlock, counts })
//
// P0 BODY: the honest placeholder. It travels the real resolve -> compose -> run -> return path
// bridgeMaker lays, but it writes ZERO edges — the five-move loop (walk / gather candidates /
// gather evidence / select / write) and the freeze seam are filled by the authored producer (P2)
// and the inferred frozen pre-pass (P3). It composes the library (its tools are injected) but
// calls none of the skeleton components, so nothing throws and no graph connection is opened.
// This is the P0-acceptable placeholder the plan authorizes (§5): the machinery is real, the
// producers are not yet.
//
// It reads inGraph, hub and applyLabel off its ONE named-argument object (the contract the shape
// gate enforces) even though P0 does not yet act on them, so the plugin's signature already
// matches the body P2/P3 will grow into.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	(injectedTools = {}) =>
	({ inGraph, hub, applyLabel }, callback) => {
		// P0: no producer yet. Nothing is walked, nothing is written. The arguments are named here
		// so the signature is the one P2/P3 fill; `void` marks the deliberate non-use.
		void inGraph;
		void hub;
		void applyLabel;
		void injectedTools;

		callback('', {
			edgesWritten: 0,
			decisionBlock: null,
			counts: { authored: 0, inferred: 0 },
		});
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction;
