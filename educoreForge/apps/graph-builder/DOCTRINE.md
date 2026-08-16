# educoreForge — Control-Flow Doctrine

House async style, and the one sanctioned dispensation from it. Read this before
adding any code that awaits, returns, or surfaces a Promise.

## The house rule (applies to ALL non-test source)

Control flow is **callback-style, error-string-first**:

```
callback(errString, result)   // errString is '' on success, a non-empty string on failure
```

Sequencing is done with qtools pipeRunner / taskListPlus, not with language-level
async control flow. Concretely, tree-wide:

- **No `async` / `await`** for control flow.
- **No `try`/`catch`** for control flow (the only accepted `try`/`catch` wraps a
  synchronous boundary such as `JSON.parse` / `fs` and converts it to an error *value*).
- **No Promises surfaced** past a leaf.

This is consistent with polyArch2 (qtools pipeRunner idiom, err-string channel) and is
asserted in the header comment of essentially every module in the tree
(e.g. `interfaces.js:14`, `forger.js:7`, `replay-engine.js:31`).

## The ONE sanctioned exception: the promise-native neo4j-driver v6

`neo4j-driver@^6` is promise-native — `session.run(...)`, `session.close()`, and
`driver.close()` all return Promises; there is no callback form. Code that talks to the
driver is therefore permitted to consume those Promises. **This is TQ's blessed
dispensation** (2026-07-23): the driver is the single sanctioned interface point where
promise-based control flow is allowed to exist.

The non-test source files that interface the driver:

- `lib/replay/replay-engine.js`
- `apps/graph-builder/apps/replay-manager/replayManager.js`
- `lib/bridge-framework/graphReader.js` — the Bridge Framework's ONE bolt-facing READ file (B2, 2026-08-16;
  SPEC-bridgeFramework-v1.md §14.1, RULING A9): `readHubCards`, `readSubjectNodes`, the `forWalk()` /
  `forEvidence()` views. Driver required LAZILY inside the factory; `.then().catch()`-to-callback at the leaf.
- `lib/bridge-framework/graphWriter.js` — the Bridge Framework's ONE bolt-facing WRITE file: `writeMappingEdge`
  (the pair-scoped label on both endpoints, MERGE on (from, type, to), the §6 refusals). Same dispensation.
  Also `lib/forge-framework/roundTripHarness/graphReader.js` (the round-trip harness's reader, F3a).

## How the dispensation is actually taken today (accurate as of this commit)

The driver's Promises are **not** consumed with `async`/`await`. They are consumed with
`.then().catch()` chains that **resolve at the leaf** back into the err-string callback
convention — `.catch(err => callback(...))` / `.catch(err => next(err))`. See the header
at `replay-engine.js:30`: *"each neo4j-driver call resolves at the leaf via
`.then().catch(err=>next(err))`."* The Promise is never surfaced above that leaf.

**There is currently no `async`/`await` keyword in any non-test source file in the tree.**
A mechanical word-grep for `async`/`await` matches only comments — most of which assert
the *absence* of async/await. (This corrects deep-dive review finding #6, which read those
comment mentions as usages.)

## The standing rule going forward

- `.then()/.catch()`-to-callback at the leaf, in the two driver-facing files above, is the
  blessed pattern — keep new driver work in that shape.
- `async`/`await` **directly against the neo4j-driver** is within the dispensation if a
  future change genuinely needs it, but the leaf-resolves-to-callback pattern is preferred.
- `async`/`await` **anywhere that is not driver-facing** remains a breach of the house rule.
- Nothing here relaxes the `try`/`catch`-for-control-flow prohibition.
