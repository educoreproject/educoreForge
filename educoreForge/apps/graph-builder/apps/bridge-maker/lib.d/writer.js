'use strict';

// writer.js — lib.d WRAP (bridgeKitRefactor_072726 design §4.1). The kit's write component: the
// guarded single write seam a producer composes to put ONE mapping edge into the graph
// (type/predicate/provenanceTier checked). This file adds NO logic of its own — it is the real
// relationshipWriter (bridge-maker/lib/relationshipWriter.js), discovered from lib.d/ and
// instantiated once per run over the run's graphWriter + the edgePolicy derived from
// lib/vocabulary/vocabulary.js (componentLibrary.deriveEdgePolicy), exactly as componentLibrary
// constructs the SAME module for the old flat bag today. Wrapping (not duplicating) means the
// guard proven by test-relationshipWriter.js is the guard this kit module runs — a second, drifted
// copy of the vocabulary checks is exactly the mistake polyArch2 §6 warns a duplicated guard invites.
//
//   writer({ graphWriter, edgePolicy }) -> ({ decision, authoredMapping, applyLabel }, callback)
//
// See bridge-maker/lib/relationshipWriter.js for the full contract and the four ordered checks.

const path = require('path');

const relationshipWriterFactory = require(path.join(__dirname, '..', 'lib', 'relationshipWriter'));

module.exports = relationshipWriterFactory;
