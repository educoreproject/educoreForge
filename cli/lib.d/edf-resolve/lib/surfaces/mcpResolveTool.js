'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// mcpResolveTool.js — SURFACE 2 of 3: the educore-standards MCP `resolve` tool adapter. A thin adapter over
// the injected shared resolve-core, structurally mountable alongside the server's existing getSchema +
// cypherQuery tools. READ-ONLY w.r.t. the graph/build artifacts (resolve-core's only side effect is the
// additive content-addressed embedding cache). The callback core (resolveViaMcp) is
// SDK-independent so the surfaces-parity gate can exercise it without the MCP SDK; registerResolveTool LAZILY
// requires @modelcontextprotocol/sdk + zod ONLY at live-mount time — and the LIVE MOUNT onto the external
// educore mcp-server.js is DEFERRED (a TQ-authorized cross-project integration; the educore project is
// separate + production-serving). No async/await, no try/catch for control flow. camelCase only.

// the tool's documented input contract (also the source for the zod schema at mount time).
const toolDescriptor = {
	name: 'resolve',
	title: 'Resolve a term to CEDS HubReference addresses',
	description:
		'READ-ONLY. Given an education-data element (a term/name and optionally its definition), returns the ' +
		'ranked candidate CEDS HubReference addresses (each with a 0-1 retrieval confidence), a single ' +
		'suggested match (HubReference address + confidence + suggested SKOS predicate), and an ABSTAIN flag. ' +
		'When no candidate is a correct match the tool ABSTAINS (suggested=null) rather than returning a wrong ' +
		'address. Suggested predicate is closeMatch (an inferred semantic match never auto-promotes to ' +
		'exactMatch — that is an authored-curation decision). Read-only over the standards graph; adds nothing ' +
		'to it and modifies no standards data.',
	inputFields: {
		term: 'string (required unless definition given) — the source element name',
		definition: 'string (optional) — the source element definition; improves retrieval',
		datatype: 'string (optional) — the source datatype',
		context: 'string (optional) — surrounding context',
		targetHub: "string (optional, default 'CEDS')",
		topK: 'integer (optional, default 15)',
		cosineFloor: 'number (optional, default 0) — below-floor best-match -> abstain',
	},
};

// resolveViaMcp({ resolveCore, input }, cb) -> cb(err, mcpToolResult)
//   mcpToolResult = { content:[{type:'text', text}], structuredContent: resolveResult }
const resolveViaMcp = ({ resolveCore, input = {} } = {}, callback) => {
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
				callback('', {
					isError: true,
					content: [{ type: 'text', text: `resolve error: ${err}` }],
				});
				return;
			}
			callback('', {
				content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
				structuredContent: result,
			});
		},
	);
};

// what the surfaces-parity gate compares (the underlying resolve result).
const extractResult = (mcpToolResult) => (mcpToolResult || {}).structuredContent;

// registerResolveTool(server, { resolveCore }) — mounts the tool on an McpServer. LAZY SDK/zod require so
// this module loads (for the callback core) without the SDK installed. DEFERRED live-mount: not wired into
// the external educore mcp-server.js by this phase. Returns the registered tool handle.
const registerResolveTool = (server, { resolveCore } = {}) => {
	const z = require('zod');
	const inputSchema = {
		term: z.string().optional().describe(toolDescriptor.inputFields.term),
		definition: z.string().optional().describe(toolDescriptor.inputFields.definition),
		datatype: z.string().optional().describe(toolDescriptor.inputFields.datatype),
		context: z.string().optional().describe(toolDescriptor.inputFields.context),
		targetHub: z.string().optional().describe(toolDescriptor.inputFields.targetHub),
		topK: z.number().int().optional().describe(toolDescriptor.inputFields.topK),
		cosineFloor: z.number().optional().describe(toolDescriptor.inputFields.cosineFloor),
	};
	return server.registerTool(
		toolDescriptor.name,
		{ title: toolDescriptor.title, description: toolDescriptor.description, inputSchema },
		(args) =>
			new Promise((resolvePromise, rejectPromise) => {
				resolveViaMcp({ resolveCore, input: args || {} }, (err, mcpResult) => {
					if (err) {
						rejectPromise(new Error(err));
						return;
					}
					resolvePromise(mcpResult);
				});
			}),
	);
};

module.exports = { surface: 'mcp', toolDescriptor, resolveViaMcp, extractResult, registerResolveTool };
