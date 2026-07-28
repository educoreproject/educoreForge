'use strict';

// materializer.js — lib.d WRAP (design §4.1). The kit's materializer: frozen decision -> edge specs.
// This file adds NO logic of its own — it is the real inferredIndex (bridge-maker/lib/inferredIndex.js),
// discovered from lib.d/ and travelling THROUGH the kit UNINSTANTIATED (a producer composes it with
// its OWN mapping options — predicate, subjectSource, subjectVersion, objectSource, objectVersion,
// mappingTool, decisionBlockHash — per run, exactly as componentLibrary hands producers the SAME
// factory as `library.inferredIndex` today). PURE + deterministic: given the same frozen decisions
// it emits byte-identical edges, no Neo4j, no network, no LLM.
//
//   materializer({ predicate, mappingJustification, provenanceTier, subjectSource, subjectVersion,
//                  objectSource, objectVersion, mappingTool, decisionBlockHash })
//       -> { buildInferredSubgraph({ inferredDecisions, sourceNodes, referenceNodes, curationInputs })
//              -> { nodes, edges, orphans, diagnostics, counts } }
//
// See bridge-maker/lib/inferredIndex.js for the full contract.

const path = require('path');

const inferredIndexFactory = require(path.join(__dirname, '..', 'lib', 'inferredIndex'));

module.exports = inferredIndexFactory;
