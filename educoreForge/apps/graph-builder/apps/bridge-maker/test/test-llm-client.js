#!/usr/bin/env node
'use strict';

// test-llm-client.js — the HERMETIC gate for the ported REAL Anthropic reranker llmClient (P3b). It proves
// CONSTRUCTION and SHAPE, and the §6 keyless-refusal — WITHOUT EVER calling the API (no https request is
// made; rerank is never invoked). The one real Opus call belongs to the parent's real --rebridge run, not
// this suite (§3 hard line 2).
//
// Proves:
//   A. CONSTRUCTS with a key present (supplied via env for determinism, NOT the real ini/key) and exposes the
//      rerank({systemPrompt,userPrompt,choiceEnum}, cb) contract inferencePipeline.js calls, plus model +
//      keySource. Never touches the network.
//   B. THROWS BY NAME at construction when NO key resolves (no ini, no env) — the §6 no-silent-default seam
//      the recreation adds over the incumbent. Observed red->green (see the three-state note at the bottom).
//   C. a model OVERRIDE is honoured (so the caller can SEE/steer the model that will be sent).
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-llm-client.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the ported Anthropic reranker llmClient (construction/shape/§6 refusal)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the ported llmClient CONSTRUCTS and exposes the rerank contract inferencePipeline.js calls, and
     that it REFUSES BY NAME at construction when no key resolves. Never makes an https request; rerank is
     never called. No network, no key file read (the success case supplies a throwaway key via env).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const llmClientFactory = require('../lib/llmClient');

const NONEXISTENT_INI = '/nonexistent/definitely-no-anthropic-config.ini';

// a throwaway key used ONLY to exercise the construction/shape path deterministically; it is never sent
// anywhere because rerank is never called. Save/restore the real env around each case so the suite process
// is left exactly as found.
const savedEnvKey = process.env.ANTHROPIC_API_KEY;

// =====================================================================
harness.section('A — CONSTRUCTS + exposes the rerank contract (key via env; NO network, NO real ini)');
// =====================================================================
process.env.ANTHROPIC_API_KEY = 'sk-test-throwaway-never-sent';
const client = llmClientFactory({ configFilePath: NONEXISTENT_INI });
harness.ok('client constructs when a key resolves', !!client);
harness.ok('exposes rerank as a function (the pipeline calls llmClient.rerank({systemPrompt,userPrompt,choiceEnum}, cb))', typeof client.rerank === 'function');
harness.equal('default model is claude-opus-4-8', client.model, 'claude-opus-4-8');
harness.equal('keySource reports env (the alternative source, resolved without touching the real ini)', client.keySource, 'env');
harness.ok('the key is NEVER exposed on the returned client (no apiKey property)', client.apiKey === undefined && Object.keys(client).indexOf('apiKey') === -1);

// =====================================================================
harness.section('C — a model OVERRIDE is honoured');
// =====================================================================
const overridden = llmClientFactory({ configFilePath: NONEXISTENT_INI, model: 'claude-3-5-sonnet-latest' });
harness.equal('model override flows to client.model', overridden.model, 'claude-3-5-sonnet-latest');

// =====================================================================
harness.section('B — §6 REFUSAL: throws BY NAME at construction when no key resolves (no ini, no env)');
// =====================================================================
delete process.env.ANTHROPIC_API_KEY;
let threw = null;
const attemptKeyless = () => llmClientFactory({ configFilePath: NONEXISTENT_INI });
try {
	attemptKeyless();
} catch (e) {
	threw = e;
}
harness.ok('construction with no key THROWS (never constructs a silently-no-op client)', !!threw);
harness.match('  the throw NAMES the missing key sources ([anthropicAi].apiKey / ANTHROPIC_API_KEY)', threw ? `${threw.message}` : '', /ANTHROPIC_API_KEY[\s\S]*|anthropicAi[\s\S]*apiKey|apiKey[\s\S]*ANTHROPIC_API_KEY/);
harness.match('  and names the module (llmClient) so the fault is locatable', threw ? `${threw.message}` : '', /llmClient/);

// restore the process env exactly as found (the success case set it; the refusal case deleted it).
if (savedEnvKey === undefined) {
	delete process.env.ANTHROPIC_API_KEY;
} else {
	process.env.ANTHROPIC_API_KEY = savedEnvKey;
}

// THREE-STATE (§ method): the §6 refusal (B) was observed RED by commenting out the construction-time
// `if (!cfg.apiKey) throw` in llmClient.js — construction then returned a no-op client and B's 'throws'
// assertion failed; restoring the throw returns green. The factory-selection red (stub vs real) is observed
// in test-build.js's FACTORY SELECTION section against resolveInferenceConfig.

harness.report();
