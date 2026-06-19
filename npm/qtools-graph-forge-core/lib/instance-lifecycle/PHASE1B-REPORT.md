# Phase 1B — instance-lifecycle library — REPORT

**Verdict: GREEN — 18 passed / 0 failed.**

## Files created
- `lib/instance-lifecycle/instance-lifecycle.js` — the shared docker/Neo4j instance-lifecycle
  library. Curried DI module: `moduleFunction({moduleName})({forgeStore, credentialAccessor})(callback)`
  → exposes `createInstanceByName`, `resolveAccessByName`, `runCypher`, `destroyInstanceByName`.
- `lib/instance-lifecycle/test/instance-lifecycle-test.js` — Phase 1B test gate (runnable with
  `node`), using in-memory fakes of `forgeStore` and `credentialAccessor`.

## Test command
```
cd /Users/tqwhite/Documents/webdev/educoreForge/system/code/npm/qtools-graph-forge-core
node lib/instance-lifecycle/test/instance-lifecycle-test.js
```

## Docker image
`neo4j:5.5` (with apoc via `NEO4J_PLUGINS=["apoc"]` + unrestricted/allowlist for `apoc.*`).
Image was `docker pull`-ed once before the test (it was not cached on this box).

## Full test output (final green run)
```
  Bound port 7704 as an in-range collision blocker.
  Held collision port: 7704. Docker-bound ports: [7475, 7476, 7688, 7690, 7700, 7701, 7702, 7703, 7706, 7707, 7708, 7709]

--- TEST A/B/C: create -> ready -> resolve -> cypher -> destroy ---
  PASS: createInstanceByName returns location
  PASS: port allocator skipped the held in-range collision port
  PASS: port allocator skipped all docker-bound ports
  PASS: container exists after create
  PASS: volume exists after create
  PASS: registry row carries credentialReference
  PASS: registry row carries credentialValue
  PASS: no gf_*.ini / credential file written
  PASS: resolveAccessByName returns location
  PASS: resolveAccessByName returns credential value
  PASS: resolved credential matches stored row
  PASS: cypher RETURN 1 round-trip yields 1

--- TEST D: teardown guard (golden/non-ephemeral) ---
  PASS: teardown guard refuses golden without force
  PASS: container still present after refused teardown
  PASS: teardown succeeds with force===true

--- TEST A (continued): post-destroy state ---
  PASS: container gone after destroy
  PASS: volume gone after destroy
  PASS: fake registry row dropped after destroy

=====================================================
RESULT: GREEN  (18 passed, 0 failed)
=====================================================
```
(The leading "No such container/volume" daemon lines are the test's idempotent pre-clean and
finally-equivalent cleanup — expected, not failures.)

## Gating assertions — coverage map (contract §1B)
1. **create → waitForNeo4jReady → resolveAccessByName → trivial cypher round-trip → destroy →
   container+volume gone, registry row dropped** — covered by: createInstanceByName returns
   location; container/volume exist after create; resolveAccessByName returns location+credential;
   `RETURN 1 AS n` yields 1; container gone / volume gone / fake registry row dropped after destroy.
   (waitForNeo4jReady is proven implicitly — the authenticated `RETURN 1` round-trip only succeeds
   because create already blocked on bolt-port-open AND an authenticated cypher probe.)
2. **Port-pair allocation avoids already-bound ports** — the test binds an in-range port (7704)
   AND snapshots the live docker-bound set (which included 7700–7709 range) before create, then
   asserts the allocated bolt/http pair collides with NEITHER. Both skip paths in the allocator
   (docker-bound set + OS-bindability) are exercised.
3. **Credential generated, stored in the registry row, retrieved by name, NEVER written to a
   file** — registry row carries credentialReference + credentialValue; resolveAccessByName
   returns a credential whose value matches the stored row; a recursive scan of the package dir
   finds no credential-artifact file (gf_*.ini / *.secret / *.credential / *.cred / *.pem / *.key).
4. **Teardown guard** — refuses a graph typed `golden` without force (and container is verified
   still present after the refusal); succeeds with `force===true`.

## Credential-file confirmation
No credential file of any kind is written. Credentials live ONLY in the registry row (via the
injected `forgeStore.upsertGraph`) and the injected `credentialAccessor.storeForGraph`; the
prototype's per-graph `gf_<name>.ini` file behavior was deliberately removed. The test asserts
zero credential-artifact files exist in the package after a full create.

## Design notes / deviations + rationale
- **Named docker volume, not a host bind dir.** The trackB prototype bind-mounted host
  directories (`-v <dataDir>/data:/data` …). I use a single named docker volume
  `gf_<graphName>_data` mounted at `/data`. Rationale: the contract's teardown requires removing
  "container + volume"; a named volume is removable with `docker volume rm` and is the natural
  unit the contract's language ("remove container + volume") points at. No host directories are
  created (also keeps the "no files written" guarantee airtight).
- **`waitForNeo4jReady` is two-phase.** Bolt-port TCP open, THEN a retried authenticated
  `RETURN 1` round-trip. The prototype only TCP-probed the port; neo4j accepts TCP before auth is
  ready, so a port-only probe races the first real query. The cypher-readiness phase removes that
  race.
- **`execFile`, not `execSync`/shell strings, for docker run.** Credential value is passed as a
  discrete argv element (`NEO4J_AUTH=neo4j/<value>`), never interpolated into a shell-quoted
  command string — avoids shell-injection / quoting hazards with random secret bytes.
- **Teardown guard keys on the registry row's `type`.** Ephemeral ⇔ type ∈ {bronze, ephemeral};
  anything else (golden, user, version, historical) is protected and requires `force===true`.
  Matches replayManager helpSpec ("ephemeral/bronze only — refuses golden … unless --force").
- **Never auto-teardown on an error path.** `destroyInstanceByName` only acts when explicitly
  invoked; no create/runCypher error path calls it. (Per helpSpec "a run that fails is NEVER torn
  down on the error path".)
- **Built against INJECTED deps only.** Does NOT `require` forge-store or credential-accessor;
  accepts them via DI so it builds/tests in parallel with 1A. Test uses in-memory fakes
  conforming to the §1A signatures (`upsertGraph`/`getGraphByName`/`dropGraph`;
  `generateCredential`/`storeForGraph`/`resolveForGraph`).

## Async-paradigm compliance
No async/await, no try/catch-for-control-flow, no Promises/EventEmitter surfaced. All sequencing
is `taskListPlus`/`pipeRunner`; neo4j-driver promises are resolved at the leaf with
`.then().catch(err => next(err))`. camelCase throughout. Synchronous `execFileSync` is used only
for cheap docker state inspects (exists checks), which are not control-flow async work.
