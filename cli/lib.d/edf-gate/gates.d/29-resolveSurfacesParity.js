'use strict';

const path = require('path');

// Phase-8 standing gate (the SURFACES-PARITY gate). The resolve logic is built ONCE (resolve-core) and
// exposed THRICE — a CLI verb, an educore-standards MCP tool, and an askMilo tool. This gate proves all
// three adapters invoke the SAME shared logic and return the SAME underlying result for the SAME input. It
// builds ONE resolve-core with a DETERMINISTIC STUB reranker (so the 3-way comparison can't flake on Opus
// variance — the real Opus pipeline is exercised by the accuracy + abstain gates / gate of record), drives
// EACH input through every surface adapter's callback core (resolveViaCli / resolveViaMcp /
// resolveViaAskMilo), extracts each surface's underlying resolve result, and asserts the three are
// BYTE-IDENTICAL (JSON-equal).
//
// FULL-CONTRACT COVERAGE: two inputs are exercised — (1) the minimal {term, definition}, and (2) one that
// sets EVERY optional param (datatype, context, topK, cosineFloor). The optional-param case guards against a
// FUTURE divergence in how any one adapter maps an optional param (all three must map datatype/context->
// contextText/topK/cosineFloor identically). Both inputs must agree across all three surfaces.
// TWIN: a deliberately divergent input yields a DIFFERENT result (proven in the gate of record
// test/phase8Resolve.js parityTwin) — so identical-output is a real agreement, not a constant.

const SUPPORT = path.join(__dirname, '..', 'lib', 'resolve-gate-support', 'resolveGateSupport');
const { getStubResolveCore } = require(SUPPORT);

const SURFACES_LIB = path.join(__dirname, '..', '..', 'edf-resolve', 'lib', 'surfaces');
const cliSurface = require(path.join(SURFACES_LIB, 'cliResolveSurface'));
const mcpSurface = require(path.join(SURFACES_LIB, 'mcpResolveTool'));
const askMiloSurface = require(path.join(SURFACES_LIB, 'askMiloResolveTool'));

// case 1: minimal. case 2: EVERY optional param set (datatype, context, topK, cosineFloor).
const PARITY_CASES = [
	{ label: 'minimal', input: { term: 'School Identifier', definition: 'A unique identifier assigned to a school.' } },
	{
		label: 'allOptionalParams',
		input: {
			term: 'School Identifier',
			definition: 'A unique identifier assigned to a school.',
			datatype: 'string',
			context: 'organization identification',
			topK: 8,
			cosineFloor: 0.1,
		},
	},
];

module.exports = () => ({
	name: 'resolve.surfacesParityThreeWay',
	phase: 'Phase8',
	kind: 'positive',
	expectFail: false, // ENFORCED — deterministic (stub reranker); three adapters over one shared core
	run: (ctx, callback) => {
		const forgeStore = ctx.resources.forgeStore;
		const gatingManifest = ctx.manifestKey;
		if (!gatingManifest) {
			callback('', { passed: false, detail: 'resolve.surfacesParity gate requires --manifest (the gating manifest)' });
			return;
		}
		getStubResolveCore({ forgeStore, gatingManifest, topK: 15, cosineFloor: 0 }, (coreErr, resolveCore) => {
			if (coreErr) {
				callback('', { passed: false, detail: `stub resolve-core load error: ${coreErr}` });
				return;
			}
			// run one case through all three surfaces -> { ok, sig } (ok=all three JSON-identical).
			const runCase = (oneCase, caseCallback) => {
				cliSurface.resolveViaCli({ resolveCore, input: oneCase.input }, (cliErr, cliEnvelope) => {
					if (cliErr) {
						caseCallback(`cli surface error: ${cliErr}`);
						return;
					}
					mcpSurface.resolveViaMcp({ resolveCore, input: oneCase.input }, (mcpErr, mcpResult) => {
						if (mcpErr) {
							caseCallback(`mcp surface error: ${mcpErr}`);
							return;
						}
						askMiloSurface.resolveViaAskMilo({ resolveCore, input: oneCase.input }, (amErr, amResult) => {
							if (amErr) {
								caseCallback(`askMilo surface error: ${amErr}`);
								return;
							}
							const cliJson = JSON.stringify(cliSurface.extractResult(cliEnvelope));
							const mcpJson = JSON.stringify(mcpSurface.extractResult(mcpResult));
							const amJson = JSON.stringify(askMiloSurface.extractResult(amResult));
							const ok = cliJson === mcpJson && mcpJson === amJson && cliJson !== 'undefined' && cliJson !== '';
							const agreed = ok ? JSON.parse(cliJson) : null;
							const sig = agreed
								? `abstain=${agreed.abstain} suggested=${agreed.suggested ? agreed.suggested.hubReference.canonicalKey : 'null'} candidates=${agreed.candidates.length} topK=${agreed.meta.topK} cosineFloor=${agreed.meta.cosineFloor}`
								: 'DIVERGENT';
							caseCallback('', { ok, sig });
						});
					});
				});
			};
			// run both cases sequentially; all must agree.
			let i = 0;
			const results = [];
			const nextCase = () => {
				if (i >= PARITY_CASES.length) {
					const allOk = results.every((oneResult) => oneResult.ok);
					const detail = results
						.map((oneResult, idx) => `${PARITY_CASES[idx].label}:${oneResult.ok ? 'identical' : 'DIVERGENT'}[${oneResult.sig}]`)
						.join(' | ');
					callback('', {
						passed: allOk,
						detail: `3 surfaces (cli/mcp/askMilo) over one shared core, ${PARITY_CASES.length} inputs (incl. all optional params) -> JSON-identical: ${allOk}. ${detail} (REQUIRED: byte-identical for every input)`,
					});
					return;
				}
				const oneCase = PARITY_CASES[i++];
				runCase(oneCase, (caseErr, caseResult) => {
					if (caseErr) {
						callback('', { passed: false, detail: `case '${oneCase.label}': ${caseErr}` });
						return;
					}
					results.push(caseResult);
					nextCase();
				});
			};
			nextCase();
		});
	},
});
