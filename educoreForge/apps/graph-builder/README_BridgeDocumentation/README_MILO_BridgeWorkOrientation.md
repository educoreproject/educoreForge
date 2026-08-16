# Orientation — for the next Milo (or engineer) working on bridges

Read this before touching `lib/bridge-framework/`, `apps/bridge-maker/`, or any `forges/<std>/bridges/`.
It is the bridge twin of `../README_ForgeDocumentation/README_MILO_ForgeWorkOrientation.md`; the
disciplines are the same on purpose.

## 1. Where the truth lives
- **What a mapping IS:** `README_BridgeProfile.md` (normative; version in header).
- **What the framework and a plugin ARE:** `README_BridgeFrameworkSpecification.md` (normative; the
  header carries a dated amendment note per version — read the newest note first, it is what the code
  does; the body is read WITH it).
- **What the code DOES:** the code. Where the spec and the code differ, the code wins, the difference
  is NAMED in the DEVLOG, and the spec is amended at the next CLEAR — never silently.
- **Why:** `system/management/zNotesPlansDocs/forgeDefinitionV2/RULINGS-supervisor-bridgeFramework.md`
  and `reviews/` (adversarial reviews and stand-down holdings). If you wonder why something is shaped
  as it is, grep those before changing it.

## 2. The acceptance discipline (measure, then EQUAL)
- Every claim is a **gate**, every gate has a **twin** (the fault it must be OBSERVED catching), every
  conjunct is reported by the three-state method: PASS / RED-OBSERVED / UNPROVEN or DEFECTIVE. UNMEASURED
  is a failure, not a skip.
- Acceptance numbers are **frozen from a run**, never written from arithmetic: the per-subject census
  for a plugin against a NAMED graph (`test/acceptance/expectedCensus.<plugin>.<graphId>.json`, keyed
  by graph id AND label-table digest), the frozen decision-block ids, the frozen command lines
  (`acceptanceCommands.jsonc`). Tolerance is EQUAL. When something legitimately moves the numbers you
  re-measure and freeze a NEW fixture, with the mover named.
- **Replay is the proof:** a plain build reproduces the frozen block id with zero LLM and zero Voyage.
- **Composability is proven mechanically:** a second plugin (SIF) through the same seam with ZERO
  framework diff (BG-COMPOSE diffs `lib/bridge-framework/` against a tag; `test/acceptance/` excluded).

## 3. The frozen commands
`lib/bridge-framework/test/acceptance/acceptanceCommands.jsonc` — per plugin: `rejudgeDebug` (debug
judge, zero cost, what every gate run uses), `materialise` (plain replay), `materialiseReal` (the ONE
run that spends credit). Every line pins `--decisionStoreFilePath`, `--judgmentCacheFilePath`,
`--matchForensicsDirPath` to absolute paths — unpinned, a fresh scratch database silently starts a
fresh, empty decision store and you will chase a phantom. `</dev/null` always.

## 4. What never to touch (without a supervisor ruling)
- The seam: `apps/graph-builder/lib/build.js` Phase C, `interfaces.js` (beyond the two ruled blocks),
  `apps/forger/`, `lib/replay/`, `shape-forged-graph`. `bridgeMaker.run(spec, cb)` is called exactly as
  build.js calls it; the framework satisfies it, not the other way round.
- The forges. A bridge plugin is a SIBLING under `forges/<std>/bridges/`; it reads the forged graph
  through the framework's reader, never the forge's internals.
- Live graphs: any `GOLD_*`, `GOLD_EVAL_*`, `gf_*`, `neoBrainV2`, the DME ini. Builds go to fresh
  `DEV_` containers; promotion is a RENAME after `-goldEvalCheck` PASS, and the DME flip is the
  supervisor's act with an ini chronicle line.
- `llmClient.js` / `debugJudge.js`: the judge component maps ordinal → stableId around them; they are
  unchanged since before the framework.

## 5. Habits that have paid every time
- **Refuse by name; no defaults; no fallback.** An absent column, key, hook, or table is refused with
  its name in the message. "Absent is absent, never defaulted."
- **No per-standard branch in the framework** — a gate greps for the tokens; if the plugin needs it,
  the plugin declares it as data.
- **Check the artifact, not the report.** Run the gates yourself; read the census file; query the
  graph; count the returned ids. A subordinate's "green" is a hypothesis.
- **Before you say done on a rule change, grep every README and spec** for the old wording (the
  forge documentation learned this the hard way; the bridge documentation inherits the rule).
- **Ask the retiring builder for its unwritten holdings** as a separate question — the B2 builder's
  reply (`reviews/STANDDOWN-B2-frozenStream.md`) named two bolt-file gaps no suite could show.

## 6. Where you are in the order (update this when it changes)
- B1 spec (v1.1.3) — CLEARED. B2 framework core + toy fixture + 12 gate families — CLEARED at
  `611888f`. B3 Ed-Fi plugin (census frozen, block frozen, GOLD_EVAL_ mount) — see
  `forgeDefinitionV2/BRIEF-B3-edfiPlugin.md`. B4 SIF (composability). B5 completion.
