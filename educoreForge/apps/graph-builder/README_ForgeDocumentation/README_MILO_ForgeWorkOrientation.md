# Forge work — orientation for the next Milo

You are picking up forge work cold. This page tells you where the truth lives, what discipline the
work runs under, and what you must not touch. It assumes you have read `README.md` and
`README_ForgeCreationOverview.md` in this directory.

## 1. Where the truth lives

| question | answer |
|---|---|
| What must a forge satisfy? | `README_ForgeProfile.md` (normative; version in header) |
| What does the framework do, and how do I use it? | `README_ForgeFrameworkSpecification.md` (normative; §3 object, §4 declaration, §5 hooks, §6 pipeline, §7 compatibility registry, §8 migration recipe, §9 acceptance, §10 gates) |
| What does the framework actually do right now? | `lib/forge-framework/*.js` — the code wins over the spec when they differ; then the spec gets amended, never the other way round silently |
| What is green, what is frozen, what did the last builder learn? | `system/management/zNotesPlansDocs/forgeDefinitionV2/DEVLOG-forgeFramework.md` (newest phase on top; per-gate red-observation tables; handoff blocks) |
| Why was something decided? | `RULINGS-supervisor-forgeFramework.md` (D/FR/FA/FB rulings) and `RULINGS-supervisor-forgeProfile.md`, same folder |
| What did a reviewer find? | `reviews/REVIEW-*.md`, same folder — read the one for the phase you are continuing |
| What did the last builder NOT check? | `reviews/STANDDOWN-*.md` — do not assume anything listed there as unchecked |
| Which forges are migrated? | Ed-Fi only (2026-08-16). SIF next: `BRIEF-F3c-sifMigration.md`. Then PESC, CEDS. |

## 2. The acceptance discipline (do not shortcut it)

A forge on the framework is accepted only when all of these hold, in this order:

1. **Probes first** (spec §8.4): collision census, PROXY fingerprint, `typeof name`, whitespace in
   stableIds, describeSource values, JSON key orders. Freeze the results into
   `lib/forge-framework/test/acceptance/*.json`. If a probe surprises you, STOP and rule before code.
2. **Measure the baseline block id on the UNMIGRATED forge** under the frozen command for that forge
   (`acceptanceCommands.jsonc`; the runner `runAcceptanceCommand.js` writes `provenance.json` beside
   the log). Compare like with like — never trust an id measured under a different recipe or flag set.
3. **Write the thin file** (spec §8.2): declaration + hooks + one-line entry; delete the scaffolding,
   do not copy it into a hook; declare only the compatibility rows the probes proved necessary.
4. **Build under the identical command; require EQUALITY** with the baseline id. If it differs, run
   the BLOCK diff (§8.6) and name the first differing property; the framework yields to the bytes
   unless the Profile says the bytes were wrong; report before changing anything.
5. `-goldEvalCheck` PASS on the run dir; then the four-forge recipe (`fourWithHub-baseline`) must
   reproduce the manifest.
6. Every gate observed RED at least once (three-state method: passes → invert-and-watch-red →
   fix-to-green). A gate never seen failing proves nothing.
7. Commit at the phase boundary with a message that names the spec version, the declared rows,
   the equal ids, the manifest, and the goldEvalCheck line. Never push without TQ's word.

Independent adversarial review before each phase closes is how every phase so far found a real
defect. Do not skip it because the suite is green.

## 3. The frozen commands and their gotchas

- `graphBuilder.js` BLOCKS on non-TTY stdin — always `</dev/null`.
- `node --max-old-space-size=20000`; ABSOLUTE paths for every path flag.
- Warm Voyage cache always: `--embeddingCacheFilePath=<abs>/system/dataStores/vectorCache/vectorCache.sqlite3`.
  A cold cache is real money.
- `--vectorize=true` explicit (the default is true, but the frozen line says it).
- Round-trip stage on (`*RoundTrip` recipes).
- Builds mint `DEV_gb_materialize_<pid>_<seq>` containers — rename to a `DEV_<label>`; never
  `docker rm -v` anything you did not create tonight.
- Docker memory is ~10 GB total: four Neo4j scratch containers plus a heap-20000 build plus
  neoBrainV2 exceed it. Stop scratch containers (not rm) before a four-forge build.
- `grep -a` always — ugrep skips at least one file in this tree as "binary" and once hid a whole
  edge type.
- Nothing a test writes is tracked; fixtures are immutable; scratch goes to `os.tmpdir()`.

## 4. What you must not touch

- The seam: `apps/forger/forger.js`, `lib/build.js`, `lib/shape-forged-graph.js`,
  `lib/replay-engine.js`, `lib/replay-block.js`, `interfaces.js`, replayManager. G-SEAM-UNTOUCHED
  greps them against a tag; if the framework needs the seam to change, STOP and rule.
- Golden and baseline containers: `GOLD_EVAL_*`, `GOLD_*`, `DEV_rootAndBranch_baseline`, `gf_*`,
  `neoBrainV2`, `usr__warm_*`. The DME golden pointer (`_goldenContainer.ini` in the educore
  project) is TQ's.
- Forges you are not migrating. A migration touches one forge and (if truly needed) the framework
  with its own twin, reported.
- No fallback, no silent substitution, no default for an absent declaration/hook/argument — refuse
  by name. Empty string is bytes; absent is absent; a name the source never stated is not stamped.

## 5. Working with the framework's rows

- Every departure from the Profile a migrated forge still carries is a **compatibility declaration**
  (spec §7): keyed by the Profile's punch-list id, `declarableBy` one or more forges, with a
  precondition the framework evaluates at forge time (or an offline probe result recorded as data).
  Undeclared-but-needed → refused. Declared-but-unneeded → refused. Outside its forge → refused.
- Retiring a row is its own commit with a deliberately new block id, after migration.
- Rows for a forge are added in that forge's migration commit, not ahead of it.
- Retire promptly: when a snapshot updates or a loader changes, the same session retires every row
  that change makes unnecessary, one commit each. The registry should shrink; if it grows, ask why.
- Loader names (`sourceLoaderList[].loaderName`) are the forge's own logical names for its inputs —
  not a shared vocabulary — but the CONVENTION is uniform: lowerCamelCase, letters and digits, unique
  within the bundle, declared once in the hooks file, and (if they appear in `sourceFiles`) declared
  on the card. The framework refuses a non-camelCase or duplicate loaderName by name.

## 5a. Before you say "done" on any rule change

Grep every README and spec in the tree for the words the rule touches — `lib/forge-framework/README.md`,
this directory's six files, the DEVLOG handoff — and update each one that still states the old rule.
A repair that lands in some artifacts and not the others that assert the old state is half a repair,
and it is the half that propagates. (Learned 2026-08-16: a loader-name rule reached three documents
and declared itself finished; TQ asked "did you update the READMEs?" and two more were still wrong.)

## 6. When you are the supervisor

Spawn one fresh Programmer Milo per phase (`spawn-milo-programmer`), brief it from a `BRIEF-*.md`,
answer its questions by IMCS within a watcher cycle, run an independent adversarial review when it
reports, send one batched remediation, verify in the file and by your own run, CLEAR, ask the
stand-down question separately, capture the answer to `reviews/STANDDOWN-*.md`, retire it. Text TQ
only when blocked or done; lead with what was NOT built.
