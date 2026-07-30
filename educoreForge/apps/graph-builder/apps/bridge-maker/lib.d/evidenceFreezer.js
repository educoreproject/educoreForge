'use strict';

// lib.d/evidenceFreezer.js — THIN KIT WRAPPER (bridgeEvidenceRefactor-spec.md §7 P3 kit wiring).
// The REAL implementation + full documentation live at ../lib/evidenceFreezer.js (P2 deliverable);
// this file exists ONLY so kitLoader's closed-membership discovery can see evidenceFreezer as a real
// kit member through the SAME mechanism every other kit module travels through — see
// lib.d/evidenceComposer.js's wrapper comment for the full rationale (identical reasoning applies).
//
// LIKE lib.d/decisionFreezer.js's OWN pattern, ../lib/evidenceFreezer.js's module.exports is an
// UNINVOKED, no-argument FACTORY (`module.exports = moduleFunction({ moduleName });`) — freeze/parse
// take no per-run construction arguments (pure, stateless), but the module itself still must be
// CALLED once to produce the { freeze, parse } instance. kitLoader wires this wrapper exactly the
// same way it wires kit.decisionFreezer: `kit.evidenceFreezer = requireKitModule(libDDir,
// 'evidenceFreezer')();` — WITH the trailing invocation.

module.exports = require('../lib/evidenceFreezer');
