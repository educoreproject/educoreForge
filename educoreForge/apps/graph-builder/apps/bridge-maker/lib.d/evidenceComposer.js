'use strict';

// lib.d/evidenceComposer.js — THIN KIT WRAPPER (bridgeEvidenceRefactor-spec.md §7 P3 kit wiring).
// The REAL implementation + full documentation live at ../lib/evidenceComposer.js (P2 deliverable);
// this file exists ONLY so kitLoader's closed-membership discovery (fs.readdirSync over lib.d/,
// verified against EXPECTED_KIT_MODULES) can see evidenceComposer as a real kit member THROUGH THE
// SAME mechanism every other kit module travels through — no side-channel, no second membership list.
//
// WHY A WRAPPER, NOT A MOVE: lib/evidenceComposer.js's own header explains why it was placed OUTSIDE
// lib.d/ in P2 ("dropping a tenth file in there makes kitLoader.buildKit() refuse the REAL lib.d/
// directory ... for a capability that isn't wired into the kit's runtime path yet"). P3 is exactly the
// phase that wires it in (spec §7: "P3 ... generic match base composer"), and moving the real 300-line
// file would (a) duplicate it or (b) relocate it out from under its own P2 test suite
// (test-evidenceComposer.js requires '../lib/evidenceComposer' directly, unaffected by this wrapper).
// A one-line re-export keeps lib/evidenceComposer.js the SINGLE source of truth while giving kitLoader
// a real, directory-discoverable member — the same trade-off kit.materializer already accepts by
// traveling UNINSTANTIATED (a bare factory a producer composes with its own per-run arguments,
// EXACTLY what evidenceComposer needs too: semanticMatcher/nominate/walk/dependencies are per-BRIDGE,
// never generic across a whole kit build).
//
// kitLoader wires this the SAME way it wires materializer: `kit.evidenceComposer =
// requireKitModule(libDDir, 'evidenceComposer');` — BARE, no invocation. A bridge/producer calls it
// itself, per run, with its own construction spec.

module.exports = require('../lib/evidenceComposer');
