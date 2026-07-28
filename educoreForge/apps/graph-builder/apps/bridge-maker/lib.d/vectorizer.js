'use strict';

// vectorizer.js — lib.d WRAP (design §4.1). The kit's definition-embedding NET component. This file
// adds NO logic of its own — it is the real vectorizer (bridge-maker/lib/vectorizer.js), discovered
// from lib.d/ and instantiated once per run. It reaches Voyage (through embedding-client) so it runs
// ONLY in a real --rebridge, NEVER the suite (§3 hard line 2) — exactly the NET seam
// componentLibrary/kitLoader let a componentOverrides.vectorizer double replace for hermetic tests.
//
//   vectorizer({ embeddingConfigFilePath }) -> { batchEmbed({ texts }, callback('', { vectors })) }
//
// See bridge-maker/lib/vectorizer.js for the full contract (dedup, Voyage-sized batching, the
// shared content-addressed cache living inside embedding-client).

const path = require('path');

const vectorizerFactory = require(path.join(__dirname, '..', 'lib', 'vectorizer'));

module.exports = vectorizerFactory;
