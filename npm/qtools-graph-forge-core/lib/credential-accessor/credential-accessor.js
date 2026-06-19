#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const crypto = require('crypto');

// START OF moduleFunction() ============================================================
//
// credential-accessor (DECISIONS-firstApp §5) — the ONE module through which all
// credential read/write passes, so the storage scheme can change later (e.g. to a real
// secret store) as a one-file change. For now storage IS the graphs registry row,
// delegated to the injected forgeStore. The resolved value is NEVER logged or echoed.

const moduleFunction =
	({ moduleName } = {}) =>
	({ forgeStore } = {}) => {
		// -----
		// generateCredential — returns {reference, value}.
		//   value  = a strong random secret (never logged).
		//   reference = a stable handle by which the secret is referred to.

		const generateCredential = (callback) => {
			const value = crypto.randomBytes(32).toString('base64url');
			const reference = `cred_${crypto.randomBytes(12).toString('hex')}`;
			callback('', { reference, value });
		};

		// -----
		// storeForGraph — persist {reference,value} onto the named graph's registry row.
		//   Delegates to forgeStore.upsertGraph; never writes the value anywhere else.

		const storeForGraph = ({ graphName, reference, value }, callback) => {
			if (!forgeStore) {
				callback(
					`credential-accessor requires an injected forgeStore [${moduleName}]`,
				);
				return;
			}

			const localCallback = (err) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', { reference });
			};

			forgeStore.upsertGraph(
				{
					name: graphName,
					credentialReference: reference,
					credentialValue: value,
				},
				localCallback,
			);
		};

		// -----
		// resolveForGraph — read {reference,value} back from the named graph's row.

		const resolveForGraph = ({ graphName }, callback) => {
			if (!forgeStore) {
				callback(
					`credential-accessor requires an injected forgeStore [${moduleName}]`,
				);
				return;
			}

			const localCallback = (err, graphRow) => {
				if (err) {
					callback(err);
					return;
				}
				if (!graphRow) {
					callback(`no graph named '${graphName}' [${moduleName}]`);
					return;
				}
				callback('', {
					reference: graphRow.credentialReference,
					value: graphRow.credentialValue,
				});
			};

			forgeStore.getGraphByName({ name: graphName }, localCallback);
		};

		return { generateCredential, storeForGraph, resolveForGraph };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
