# THE FAILED STAGE-ON BUILD OF 2026-08-07 — RECONSTRUCTED, NOT RETAINED

**THIS IS NOT A RETAINED LOG. THE LOG IS GONE AND I DESTROYED IT.** Everything below is
reconstructed from the session transcript of SCARLET_GARDEN, and it is labelled as reconstruction
because a reconstruction presented as a receipt is worse than an admitted absence.

Raised as **F-4** by the independent review of Phase 7. The reviewer did not take my word for the
build provenance; it noticed that `runStageAbPair.sh` wraps every build in `=== label started ===`
and `=== label exit=N ===` markers, that log A carried both and log B carried **neither and no exit
code**, and that `p7BuildPair.done` was stamped `16:54:18` while log B described a build that started
`16:56:15`. Those three tells are the whole finding, and every one of them is a property of the
artifacts rather than of my account of them.

## WHAT HAPPENED

1. `runStageAbPair.sh` ran both builds sequentially. The stage-OFF build succeeded (exit 0).
2. The stage-ON build **failed early**, during phase A (forge), before the round-trip stage was
   reached.
3. I re-ran the stage-ON build **by hand**, writing to **the same fixed log path**, which
   **overwrote the failure log**. `p7BuildPairRunner.log` is empty — the script redirects each
   build's output into its own per-build file, so nothing was captured there either.
4. My phase report then said *"both builds ran sequentially through the ordinary graphBuilder -build
   recipe path."* **That sentence is wrong and is retracted.** Build A ran through the pair script;
   build B was a hand invocation of the same command with the same parameters.

## THE FAILURE TEXT

Quoted from the session transcript, which is the only surviving source:

```
graphBuilder -build failed: phase A (forge) failed: create(forge) for pesc260805:
replayManager.create 'DEV_gb_forge_4290_1': neo4j at bolt://localhost:7827 never
authenticated within 90s (the container it launched was disposed)
```

## WHY IT FAILED

Resource contention, not a defect in the recipe, the bundle or the stage. **Six
`DEV_gb_materialize_*` scratch containers from earlier phases had been running for 24–28 hours**,
plus the container my own stage-OFF build had just left behind. Each build provisions a fresh
scratch Neo4j; under that pressure the new container did not authenticate inside the 90-second
window and was disposed. The retry succeeded with no change to any input.

**I stopped and removed nothing.** Destructive operations on shared resources are not mine to
authorize, and the run succeeded without them.

## WHAT IS AND IS NOT ESTABLISHED

- **ESTABLISHED, by artifacts anyone can open:** the stage-ON build that produced
  `buildLogs/pesc260805OnlyRoundTrip_20260807-215615` used parameters equivalent to the script's
  (`stageOnBuildParams.json` is retained beside this file), and the independent reviewer confirmed
  that equivalence and that the two recipes differ, comment-stripped, only in `recipeName`,
  `description` and `roundTripStage: true`.
- **NOT ESTABLISHED:** anything about the failed run beyond the text above. Its log does not exist.
  Nobody can check the reconstruction against the artifact, because there is no artifact.

## WHAT WAS CHANGED SO THIS CANNOT RECUR

`runStageAbPair.sh` now writes every attempt to a path carrying the run stamp and the attempt label,
**refuses to write to a path that already exists**, records the exit code into both the per-attempt
log and a manifest even when the build dies before the closing marker, and returns a failing exit
status for the pair. A retry mints a new path; it can no longer land on an existing log.

## THE LESSON, WHICH IS NOT ABOUT BASH

A fixed output path turns a retry into a deletion. The failure was not that a build failed — builds
fail — it is that **the artifact recording an unreliable instrument was destroyed by the act of
working around that instrument**, and the workaround then appeared in the record as a clean run. An
unretained failure inside a provenance claim is the most expensive kind to lose: it is exactly the
evidence a successor needs to know the pair script is unreliable under container pressure.
