'use strict';

// decisionFreezer.js — lib.d WRAP (design §4.1). The kit's freeze seam: quarantines the
// semanticMatcher+selector's raw decisions into a content-addressed, byte-stable block (the pin
// every materialized CLOSE_MATCH edge carries). This file adds NO logic of its own — it is the real
// decisionFreezer (bridge-maker/lib/decisionFreezer.js), discovered from lib.d/ and instantiated
// once per run, exactly as componentLibrary hands producers the SAME factory today.
//
//   decisionFreezer() -> {
//       freeze({ pairStamp, decisions }) -> { frozenText, decisionBlockHash, inferredDecisions },
//       parse(frozenText)                -> { pairStamp, decisions, inferredDecisions } | { error },
//   }
//
// PURE + synchronous + deterministic: no Neo4j, no async, no Date/random, no LLM.

const path = require('path');

const decisionFreezerFactory = require(path.join(__dirname, '..', 'lib', 'decisionFreezer'));

module.exports = decisionFreezerFactory;
