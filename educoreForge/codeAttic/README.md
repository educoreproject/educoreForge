# codeAttic — retired code, kept for its history

Code here is NOT discovered by `test/runAllTests.js` (which walks `apps/**/test` and `lib/**/test` only) and is not
required by any production module. It is kept so a later reader can see what a retired instrument did and revive it
deliberately rather than rewrite it from memory.

| directory | retired | why |
|---|---|---|
| `retrieval-metrics/` | 2026-10-06, campaign P3 (W-B-8; ROADS-NOT-TAKEN row "retrievalMetrics: Retire") | It read a PRE-FRAMEWORK forensic record shape (`promptText`, `response {…}`, `sourceStableId`, `judgedVia`) that no bridge-framework judgment carries, so against every record written since 2026-08-16 each of its reads was absent. The retrieval evidence now lives in each decision record's `retrievalVoteList` (decision store). `graphBuilder -retrievalMetrics` refuses by name and says so. |
| `recipes/` | 2026-10-22, zeroBacklog lane D (D2-2) | Four recipes naming the retired Ed-Fi crosswalk plugin, written in the refused old recipe bridge form; see `recipes/README.md`. |
| `experiments/cascadeWalk-101226/` | 2026-10-22, zeroBacklog lane D (D3-1) | The cascade-walk experiment of 2026-10-12. Two of its calls predate deCeds R3/R4 and would be refused by name (no `blindingNameList`, no `toolCandidateNoun`); see its README. |
