# codeAttic — retired code, kept for its history

Code here is NOT discovered by `test/runAllTests.js` (which walks `apps/**/test` and `lib/**/test` only) and is not
required by any production module. It is kept so a later reader can see what a retired instrument did and revive it
deliberately rather than rewrite it from memory.

| directory | retired | why |
|---|---|---|
| `retrieval-metrics/` | 2026-10-06, campaign P3 (W-B-8; ROADS-NOT-TAKEN row "retrievalMetrics: Retire") | It read a PRE-FRAMEWORK forensic record shape (`promptText`, `response {…}`, `sourceStableId`, `judgedVia`) that no bridge-framework judgment carries, so against every record written since 2026-08-16 each of its reads was absent. The retrieval evidence now lives in each decision record's `retrievalVoteList` (decision store). `graphBuilder -retrievalMetrics` refuses by name and says so. |
