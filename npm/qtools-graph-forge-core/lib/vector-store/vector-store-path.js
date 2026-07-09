#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const path = require('path');

// START OF moduleFunction() ============================================================
//
// vector-store-path — the SINGLE SOURCE OF TRUTH for where a standard's per-standard embedding
// sidecar store lives (PLAN §3.2 D1). The forge WRITE path (the caching-embedder decorator) and the
// EXTRACT path (replay -extractSchema) MUST derive the file path through THIS function so the two
// processes provably open the SAME file (F3 requirement, the same shared-rule discipline as
// content-address.vectorIdForInput). Convention mirrors the block store:
//   <projectRoot>/dataStores/vectorStores/<standardKey>.sqlite3
// with EDF_FORGE_VECTORSTORE_DIR overriding the DIRECTORY (mirrors EDF_FORGE_STORE_DB for the block
// store — an announced test/redirect hook). standardKey becomes a filename, so it is guarded against
// path separators / traversal.

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// vectorStoreDbPathForStandard — ({ projectRoot, standardKey }) -> absolute sqlite path.
		const vectorStoreDbPathForStandard = ({ projectRoot, standardKey } = {}) => {
			if (standardKey == null || `${standardKey}`.trim() === '') {
				throw new Error(`${moduleName}.vectorStoreDbPathForStandard: standardKey is required`);
			}
			if (/[/\\]|\.\./.test(`${standardKey}`)) {
				throw new Error(
					`${moduleName}.vectorStoreDbPathForStandard: unsafe standardKey ` +
						`'${standardKey}' (path separators / '..' are not allowed — it becomes a filename)`,
				);
			}
			const directory =
				process.env.EDF_FORGE_VECTORSTORE_DIR ||
				path.join(projectRoot, 'dataStores', 'vectorStores');
			return path.join(directory, `${standardKey}.sqlite3`);
		};

		return { vectorStoreDbPathForStandard };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
