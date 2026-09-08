'use strict';

// judgeConcurrency.js — THE JUDGE CONCURRENCY CEILING, ONE VALUE, ONE HOME.
// judgeProviderRegistry JOB 4, 2026-09-07, ruled by DAWN_TOWER.
//
// ⟪WHY THIS FILE EXISTS⟫ Until now this number lived as a literal `4` in bridge-framework.js AND as a
// second literal `4` in debugJudge.js's DEBUG_JUDGE_MAX_CONCURRENCY. MARBLE_ANCHOR named the pair "the
// weakest thing I shipped" (JOB 1 stand-down §5.1): the two must agree, nothing checked that they did, and
// raising the framework's ceiling to 8 would have made the debug judge a silent bottleneck at 4 — silent
// because 4 remains a perfectly legal declared value for any provider.
//
// The obvious repair was to have one side ASSERT agreement with the other. It was rejected, and the reason
// is the lesson JOB 3 learned one directory over on bridgePluginContract's JUDGE_CATEGORY_LIST: WHERE YOU
// CAN DERIVE, YOU DO NOT ASSERT. An assertion between two literals is a check that can pass by coincidence
// and must itself be maintained; a derivation cannot disagree at all. So the value moved HERE and both
// former literals now read it.
//
// ⟪WHY A LEAF, AND WHY NOT bridge-framework.js's OWN EXPORT⟫ bridge-framework.js DOES expose
// JUDGE_CONCURRENCY — but only on the object a CONSTRUCTED framework returns, and constructing one refuses
// without a graphReaderFactory ("the ONLY way any framework module reads the dependency graph, SPEC §3.2").
// So there is no load-time read of it, and a consumer that only wants the integer would have had to stand
// up the whole framework and its 29-require closure to get it. This module has ZERO requires of its own
// and never will; that is asserted by its test rather than promised here.
//
// ⟪WHO MAY READ THIS⟫ Both `lib/bridge-framework/` and `apps/graph-builder/apps/bridge-maker/lib/` are
// inside decisionBlock.js's FINGERPRINT_ROOT_LIST, so a require across that boundary takes on no
// dependency outside the decision-block fingerprint tree and interfaces.js:426-429's sentence about that
// stays true. The judge PROVIDER REGISTRY deliberately does NOT read this file: since debugJudge now
// derives its ceiling, the two 4s are one 4 and the registry has nothing left to reconcile.

// JUDGE_CONCURRENCY — how many judgments the framework drives at once. ⟪BR-072⟫ bounded, index-collecting.
// A provider may declare a LOWER ceiling of its own (Ollama declares 1, deliberately); the run uses
// min(JUDGE_CONCURRENCY, provider.maxConcurrency), so this is the ceiling and never the floor.
const JUDGE_CONCURRENCY = 4;

module.exports = Object.freeze({ JUDGE_CONCURRENCY });
