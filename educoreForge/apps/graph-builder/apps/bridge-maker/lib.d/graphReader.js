'use strict';

// graphReader.js — lib.d WRAP (design §4.1). The kit's read seam over inGraph. This file adds NO
// logic of its own — it is the real neo4jGraphReader (bridge-maker/lib/neo4jGraphReader.js),
// discovered from lib.d/ and instantiated once per run over the run's inGraph handle, exactly as
// componentLibrary hands producers the SAME factory today (as graphReaderFactory, invoked by the
// producer itself). Here the kit loader instantiates it up front (kitLoader: "instantiated once
// per run over the run resources"), so every kit module that needs to read (sourceWalker) is handed
// an ALREADY-OPEN reader rather than the bare factory.
//
//   graphReader({ inGraph }) -> { readNodes({ label, propertyEquals }, callback), close(callback) }
//
// See bridge-maker/lib/neo4jGraphReader.js for the full contract (label/propertyEquals identifier
// guards, lazy session open, safe close).

const path = require('path');

const neo4jGraphReaderFactory = require(path.join(__dirname, '..', 'lib', 'neo4jGraphReader'));

module.exports = neo4jGraphReaderFactory;
