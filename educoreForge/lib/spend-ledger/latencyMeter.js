'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// latencyMeter.js — how long a judge took, measured OUTSIDE the clock-free trees (spend ledger lane R1, 2026-10-21).
//
//   latencyMeteredJudgeClientFor({ judgeClient, readClockMs }) → { judgeClient } | { error }
//
// BG-DET (test-bgReplay a_noClockOrRandomToken) keeps every clock out of lib/bridge-framework/** and the judge clients,
// because those trees feed content-addressed blocks. Latency is evidence, not block text, so it is measured HERE, in a
// wrapper build.js puts around the selected provider (the cacheOnlyJudgeClientFor precedent): rerank's return gains
// latencyMs, the wall-clock milliseconds of that one rerank call, retries and backoff included. judgeComponent carries the
// number into the spend record and the forensic record exactly as it carries `usage`, and never reads a clock itself.
//
// The wrapper is a FROZEN copy of the provider with rerank replaced: every other member (name, model, judgeConfig,
// decisionAlgorithm, modelForChoiceQuestionForm, …) is the provider's own, so no identity and no cache key can move.
// readClockMs is required: build.js hands () => Date.now(); a test hands a scripted clock.

const latencyMeteredJudgeClientFor = ({ judgeClient, readClockMs } = {}) => {
	if (!judgeClient || typeof judgeClient.rerank !== 'function') {
		return { error: `${moduleName}: judgeClient is absent or has no rerank; there is nothing to meter` };
	}
	if (typeof readClockMs !== 'function') {
		return { error: `${moduleName}: readClockMs is ${JSON.stringify(readClockMs)}; the caller names the clock (build.js: () => Date.now()); there is no default` };
	}
	const rerank = (rerankOptions, rerankCallback) => {
		const startedAtMs = readClockMs();
		judgeClient.rerank(rerankOptions, (rerankError, clientReturn) => {
			if (rerankError || clientReturn === null || typeof clientReturn !== 'object') {
				rerankCallback(rerankError, clientReturn);
				return;
			}
			rerankCallback('', { ...clientReturn, latencyMs: Math.max(0, Math.round(readClockMs() - startedAtMs)) });
		});
	};
	return { judgeClient: Object.freeze({ ...judgeClient, rerank }) };
};

module.exports = { latencyMeteredJudgeClientFor, moduleName };
