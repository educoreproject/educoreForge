'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// askMiloResolveTool.js — SURFACE 3 of 3: the askMilo `resolveStandardTerm` tool adapter. A thin adapter
// over the injected shared resolve-core, exposing the resolve verb as an askMilo tool (a name + a parameter
// schema + a callback invoke()). READ-ONLY. The surfaces-parity gate invokes resolveViaAskMilo directly with
// an injected resolveCore (deterministic stub) and asserts its underlying result MATCHES the CLI + MCP
// adapters for the same input. The LIVE MOUNT into the askMilo runtime (educore / miloAgentServices) is
// DEFERRED (a TQ-authorized cross-project integration). No async/await, no try/catch for control flow.
// camelCase only.

// the askMilo tool descriptor (name + human description + parameter schema).
const askMiloToolDescriptor = {
	name: 'resolveStandardTerm',
	description:
		'READ-ONLY. Resolve an education-data element (a term and optionally its definition) to ranked CEDS ' +
		'HubReference addresses with confidence, a single suggested match (address + confidence + suggested ' +
		'predicate closeMatch), and an ABSTAIN flag when nothing is a correct match (it abstains rather than ' +
		'returning a wrong address). Does not modify the graph.',
	parameters: {
		type: 'object',
		properties: {
			term: { type: 'string', description: 'The source element name (required unless definition given).' },
			definition: { type: 'string', description: 'The source element definition (optional; improves retrieval).' },
			datatype: { type: 'string', description: 'The source datatype (optional).' },
			context: { type: 'string', description: 'Surrounding context (optional).' },
			targetHub: { type: 'string', description: "Target hub (optional, default 'CEDS')." },
			topK: { type: 'integer', description: 'Candidates to return (optional, default 15).' },
			cosineFloor: { type: 'number', description: 'Below-floor best-match abstains (optional, default 0).' },
		},
	},
};

// resolveViaAskMilo({ resolveCore, input }, cb) -> cb(err, { ok, result })
const resolveViaAskMilo = ({ resolveCore, input = {} } = {}, callback) => {
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
				callback('', { ok: false, error: `${err}` });
				return;
			}
			callback('', { ok: true, result });
		},
	);
};

// what the surfaces-parity gate compares (the underlying resolve result).
const extractResult = (askMiloResult) => (askMiloResult || {}).result;

module.exports = { surface: 'askMilo', askMiloToolDescriptor, resolveViaAskMilo, extractResult };
