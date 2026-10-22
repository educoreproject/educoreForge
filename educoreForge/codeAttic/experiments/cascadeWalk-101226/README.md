# cascadeWalk-101226 — retired experiment

Moved from `experiments/cascadeWalk-101226/` by zeroBacklog lane D (INDIGO_COMPASS, item D3-1, census row 24, 2026-10-22).
Nothing in a build or a suite imported it (verified by grep before the move: the only references were its own files).

It is history, and it cannot run as it stands. Two calls predate the hub-neutral bridge refactor (deCeds R3/R4, 2026-10-21)
and would each be refused by name (code fact at R3/R4, recorded by DAWN_STREAM):

- `parts/subjectJudge.js` calls `evidenceRenderer.renderQuestion` without `blindingNameList`. Since R3 the renderer
  refuses a question that does not say which names to blind.
- `parts/bridgeRunContext.js` calls `judgeConfigRecord.judgeConfigHeaderFor` without `toolCandidateNoun`. Since R4
  the judge's noun comes from the hub, and a header without one is refused.

Its `require` paths are also relative to the old location (`TREE_ROOT` was three levels up; it is now four), so the move
breaks them as well. Reviving it means fixing all three, deliberately.
