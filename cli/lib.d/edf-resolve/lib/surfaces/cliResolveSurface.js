'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// cliResolveSurface.js — SURFACE 1 of 3 (the CLI verb's core). A thin adapter over the injected shared
// resolve-core: translates the CLI's input shape to resolve-core params and returns the CLI result envelope.
// edfResolve.js binds this to the `-resolve` action; the surfaces-parity gate invokes it directly with an
// injected resolveCore (deterministic stub reranker) and asserts its result MATCHES the MCP + askMilo
// adapters for the same input. No async/await, no try/catch for control flow. camelCase only.

// resolveViaCli({ resolveCore, input }, cb) -> cb(err, { action:'resolve', ...resolveResult })
//   input: { term, definition, datatype, context, targetHub, topK, cosineFloor }
const resolveViaCli = ({ resolveCore, input = {} } = {}, callback) => {
	resolveCore.resolve(
		{
			term: input.term,
			definition: input.definition,
			datatype: input.datatype,
			contextText: input.context,
			targetHub: input.targetHub || 'CEDS',
			topK: input.topK,
			cosineFloor: input.cosineFloor,
		},
		(err, result) => {
			if (err) {
				callback(err);
				return;
			}
			callback('', { action: 'resolve', ...result });
		},
	);
};

// the underlying resolve result (what the surfaces-parity gate compares across all three surfaces).
const extractResult = (cliEnvelope) => {
	const { action, ...rest } = cliEnvelope || {};
	return rest;
};

module.exports = { surface: 'cli', resolveViaCli, extractResult };
