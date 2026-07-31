# A Programmer's Guide to Bridging a Standard into the CEDS Hub

*The MAPPING-side guide: how a forged standard gets evidence-judged against CEDS — from the
zero-code default to a custom evidence bridge.*

This is one of a pair. **Standard-side vs mapping-side — you likely need both:**

- **[`README_forgeProgrammingGuide.md`](./README_forgeProgrammingGuide.md)** covers the standard
  side: parsing a standard's native source into the universal forge contract and building/verifying
  its base block. Your standard must exist as a forge before anything in this guide applies.
- **This guide** covers the mapping side: the evidence architecture, MATERIALIZE vs REBRIDGE, the
  contracts every bridge must satisfy, and two worked custom-bridge exemplars.

Audience: a competent JS programmer who has never seen this codebase. Every factual claim below is
grounded in code read in the working tree of `educoreForge/system/code/educoreForge` (branch
`architecture-improvement`, 2026-07-30, including the SIF evidence-bridge work). Citations name
files and exported symbols rather than raw line numbers wherever possible; where a line number
appears it was verified on the date above.

---

## Table of contents

1. [What a bridge is](#1-what-a-bridge-is)
2. [The zero-code path](#2-the-zero-code-path-genericbridge)
3. [The evidence architecture](#3-the-evidence-architecture)
4. [MATERIALIZE vs REBRIDGE](#4-materialize-vs-rebridge)
5. [Writing a custom evidence bridge](#5-writing-a-custom-evidence-bridge)
6. [The rules that bite](#6-the-rules-that-bite)
7. [Checklist](#7-checklist-forged-standard-to-evidence-judged-graph)

---

## 1. What a bridge is

CEDS is the **hub** — the standard every other standard's properties/values get judged against for
equivalence. A **bridge** is the module that produces those judgments as graph edges: it walks a
source standard's forged elements, gathers CEDS candidates, has an LLM judge the evidence, freezes
the decisions into a content-addressed block, and materializes edges — always through an injected,
guarded writer, never a raw graph connection.

Two properties define the layer:

- **Decisions are frozen, then replayed.** The expensive, non-deterministic step (the LLM judgment)
  runs once per `--rebridge`, freezes into a decision block in the decision store
  (`lib/decision-store/decision-store.js` — one content-addressed `decisionBlocks` table, keyed per
  pair, `saveDecisionBlock` idempotent by construction), and every subsequent plain `-build` replays
  it verbatim for free (§4).
- **A bridge never touches the substrate.** All writes go through the injected `kit.writer`; a
  bridge file that so much as *mentions* the forbidden substrate is refused before it runs (§6).

**Retired machinery — do not go looking for it.** The older scalar pipeline
(`bridgeSkeleton.js`, its five-move shell, and the `candidateFinder` module) and the scalar custom
bridge built on it (`forges/case/bridges/caseStructuralBridge.js`) were torn down in the P5
teardown (2026-07-30) after a decisive A/B (§5.1). The files are gone from the tree (`git rm`);
what survives are tombstone comments (e.g. the header of `caseEvidenceBridge.js`) and a vestigial,
optional `candidateFinder` slot left in the recipe schema so old recipes keep validating
(`apps/graph-builder/lib/recipe.js` marks it vestigial in a schema comment). Every live *judged*
bridge in this tree is an **evidence** bridge.

**The second live family: deterministic (authored) bridges.** Not every bridge judges — three live
bridges resolve author-declared identity with zero LLM calls: `forges/ctdl/bridges/ctdlAuthoredBridge.js`
(CTDL's native `owl:equivalentClass` anchors), `forges/ctdl/bridges/ctdlFamilyStructure.js` (the
CTDL-family URI-identity structural bridge), and `forges/bridges/authoredAnchorBridge.js` (the generic
`cedsId == cedsId` anchor resolver serving EdFi and SEDM). These compose the **flat injected component
library** (`graphReader` / `referenceIndex` / `relationshipWriter` / `decisionStore`) rather than §5's
evidence kit — deliberately, because the kit carries no `referenceIndex` and a deterministic join needs
one. They write through the same guarded writer and honor the same decision-store discipline. Building
a deterministic bridge? Model on `ctdlAuthoredBridge` and `authoredAnchorBridge`, not on §5's evidence
composition.

---

## 2. The zero-code path: genericBridge

To get your standard evidence-judged against CEDS with **no bridge code of your own**, name the
library bridge in your recipe's `bridges[]`:

```jsonc
"hubs": [
  { "standard": "ceds" }
],
"bridges": [
  {
    "source": "xyz", "hub": "ceds", "bridge": "genericBridge",
    "dependencies": ["xyz", "ceds"], "cacheMode": "reuse"
  }
]
```

(verbatim pattern of `recipes/cedsLifGeneric.recipe.jsonc`, LIF's own zero-code pairing).

`genericBridge` (`forges/bridges/genericBridge.js`) resolves through `bridgeMaker`'s **three-scope
directory search** — standard-local (`forges/<source>/bridges/`, narrowest), forges-shared
(`forges/bridges/`, middle), library (`bridge-maker/bridges/`, broadest) — and there is
deliberately **no precedence and no silent default**: zero matches is a refused-by-name recipe
error, more than one match **throws** as a tree defect
(`apps/graph-builder/apps/bridge-maker/bridgeMaker.js`, `bridgeSearchPath` /
`resolveBridgePlugin`).

Then run the build with `--rebridge=xyz` once (§4) and you have LLM-judged `CLOSE_MATCH` edges.
Write a custom bridge (§5) only when your standard carries a structural signal `genericBridge`'s
pure cosine retrieval cannot see.

---

## 3. The evidence architecture

### 3.1 The pipeline

REBRIDGE mode runs, per source element (`runRebridge` in `forges/bridges/genericBridge.js`; the
custom bridges compose the identical shape):

```
walk (the standard's forged source elements, flattened to full records)
  -> read CEDS HubReference candidates
  -> vectorize (embed every source + candidate defText)
  -> PER SOURCE:
       compose evidence (kit.evidenceComposer + kit.cedsHubModule)
       -> ⟪A3⟫ evidence-package shape gate
       -> render (kit.evidenceRenderer -> one prompt)
       -> select (kit.evidenceSelect, the injected llmClient — Opus judges)
       -> normalize confidence (kit.confidenceNormalizer)
  -> freeze everything into a content-addressed decision block (kit.evidenceFreezer)
  -> save to the decision store
  -> materialize + write edges (kit.materializer + kit.writer)
```

The components live in two places under `apps/graph-builder/apps/bridge-maker/`:

- **`lib.d/`** — the injectable kit members a bridge composes: `sourceWalker` (exports
  `flattenFullRecord`, the "every raw scalar the node forged" flatten a bridge opts into),
  `evidenceComposer` (exports `candidateKeyFor`, the one candidate-identity function),
  `cedsHubModule`, `evidenceRenderer` (exports `RENDERER_VERSION`, currently
  `'evidenceRenderer-v2'`), `evidenceSelect`, `confidenceNormalizer`, `semanticMatcher`,
  `vectorizer`, `graphReader`, `materializer`, `writer`, `evidenceFreezer`, `decisionFreezer`.
- **`lib/`** — the framework internals: `evidenceContracts.js` (§3.2), `evidenceFreezer.js`,
  `relationshipWriter.js`, `kitLoader.js`, `inferredIndex.js`, `referenceIndex.js`,
  `llmClient.js`, and the Neo4j reader/writer the kit wraps.

The kit is handed to your bridge as `injectedTools.kit`; a bridge validates its required members by
name at run time and refuses any gap (`requiredKitMembersFor` in every live bridge — five members
always, seven more when `kit.rebridge` is true).

**"THE CASE RULE"** (comment, `lib.d/sourceWalker.js`): the recipe token is lowercase (`'sif'`);
the forged `_source` is uppercase (`'SIF'`). Read and stamp by the uppercase key — every live
bridge does `config.sourceStandard.toUpperCase()` before touching the graph.

### 3.2 The six contracts

All six live in `apps/graph-builder/apps/bridge-maker/lib/evidenceContracts.js`
(`CONTRACT_STATUS = 'HARDENED'`) and are enforced by named gate functions:

| # | Contract | Shape | Gate function(s) |
|---|---|---|---|
| 1 | Evidence package (the value crossing compose->select) | data value, not a callable | `evidencePackageViolation` |
| 2 | Match/compose | `({sourceElement, candidateElements, graphReader, hubModule}, callback(err, evidencePackage))`, arity 2 | `matchComposeCallableViolation`; `matchComposeResultViolation` (which IS `evidencePackageViolation`) |
| 3 | Hub module | `(candidate, callback(err, baseTupleEvidence))`, arity 2, positional | `hubModuleCallableViolation` / `hubModulePresentationViolation` |
| 4 | Renderer | `render(evidencePackage, promptSegments, config, callback(err, promptText))`, arity 4, positional; plus a required non-empty `RENDERER_VERSION` string | `rendererModuleViolation` / `rendererDeterminismViolation` |
| 5 | Select | `select(renderedPromptOrPackage, llmClient, callback(err, selectResult))`, arity 3, positional | `selectShapeViolation` / `selectResultViolation` |
| 6 | Normalizer | `normalize(category, retrievalCosine, context, callback(err, confidence))`, arity 4, positional, deterministic | `normalizerShapeViolation` / `normalizerDeterminismViolation` |

The renderer and normalizer gates additionally **prove determinism mechanically**: call the
function twice with identical inputs and refuse if the two callback deliveries differ —
"byte-stability is the renderer's keystone invariant."

### 3.3 The judgment: categories, confidence, and where rationale lives

The LLM judgment produces a **discrete category**, never a fabricated float — one of
`SELECT_CATEGORY_ENUM = ['strong', 'moderate', 'weakButReal', 'none']`
(`evidenceContracts.js:670`) plus a non-empty prose `rationale`; `abstain`/`pick` are mutually
exclusive and mutually required (`selectResultViolation`). The category and cosine retrieval score
are then run through the **deterministic** normalizer to produce a single numeric `confidence`,
which is what actually lands on the edge.

Category and rationale themselves do **not** become edge properties — this is the documented "R-b
disposition" (comment block in `genericBridge.js`): they ride inside the frozen decision block's
`frozenEvidence[i].judgment`, retrievable by loading the pair's frozen block
(`kit.decisionStore.getDecisionBlock` + `kit.evidenceFreezer.parse`) and reading the entry keyed by
`sourceStableId`. **This is a deliberate design decision, not an oversight** — worth knowing
before you go looking for `category`/`rationale` on an edge and don't find them.

The edge's mapping stamp is `predicate` (the `SKOS_PREDICATES` enum in
`lib/vocabulary/vocabulary.js`: `exactMatch`, `closeMatch`, `broadMatch`, `narrowMatch`,
`relatedMatch`); every evidence bridge stamps
`MATERIALIZER_CONFIG = { predicate: 'closeMatch', mappingJustification: 'semapv:SemanticSimilarity' }`
because an inferred (LLM-judged) mapping is never `exactMatch` (reserved for deterministic,
identity-joined mappings). **There is no `matchType` field anywhere in this codebase** — if you
have seen that name in older notes, it is a documented phantom; `predicate` is the real, verified
name.

### 3.4 R7 — every contract callable is callback-shaped

One house ruling governs all six contracts, quoted verbatim in `evidenceContracts.js`:

> ⟪TQ RULING, 2026-07-29⟫ ALL CONTRACT CALLABLES ARE CALLBACK-SHAPED, WHETHER THEY NEED ONE OR NOT.
> "It's easy to use not-needed when the callback is present. Very difficult to change when it's
> not."

Even contracts that are pure and synchronous in every foreseeable implementation (the normalizer,
the renderer) take a callback. Your custom hooks (§5) must too. The forge-side
`lib/sequence-contract` module is written to the same ruling — this is tree-wide house law for new
contract surfaces.

### 3.5 ⟪A3⟫ — the candidate-token smuggling gate

The evidence package a composer produces contains a candidate `pool` (cosine top-K **union**
nominations), per-candidate `considerations.notes`, and global `promptSegments`. The gate
(`evidencePackageViolation`) enforces, among shape checks:

- A nomination is not a bare score with a different name — it must carry
  `{ nominatedBy, rationale }`, both non-empty strings, or the gate refuses it.
- `promptSegments` is injected once, globally, deduped — **and it must never name a specific
  candidate.** The gate scans every segment for any candidate-identifying token
  (`stableId` / `canonicalKey` / `cedsId` / `valueKey` / `name`, each considered only when >= 4
  chars, `evidenceContracts.js:184-185`) drawn from that run's own pool, and **refuses a segment
  that smuggles one in** — "a segment naming a SPECIFIC candidate is per-candidate material by
  definition, wherever it physically sits."

Both worked custom bridges prove their global segment against the REAL gate with a RED/GREEN fault
twin in their tests: a deliberately candidate-naming segment is shown failing, then the real
segment is shown passing (`forges/case/test/test-caseEvidenceBridge.js`;
`forges/sif/test/test-sifEvidenceBridge.js`, SECTION 5). Do the same for yours.

---

## 4. MATERIALIZE vs REBRIDGE

Every bridge has two modes, dispatched off `kit.rebridge` (a boolean `build.js` computes per pair
from your `--rebridge` scope; the dispatch is the literal last statement of every bridge module):

- **MATERIALIZE** (the default on a plain `-build`, zero LLM calls): loads the pair's
  already-frozen evidence-decision block from the decision store (`getDecisionBlock({ pairKey })`,
  pairKey = `'CEDS::<SOURCE>'`) and replays it verbatim — no re-judging. If no frozen block exists
  for the pair yet, you get **zero inferred edges, explicitly** — the result carries
  `counts: { inferred: 0, mode: 'materialize', noDecisionBlock: true }` — with no graph read and no
  spend.
- **REBRIDGE** (only when your source token is inside `--rebridge=xyz` or `--rebridge=all`): the
  full evidence flow of §3.1, ending in a freshly frozen block *and* materialized edges.

In practice:

```
graphBuilder -build \
  --recipePath=recipes/cedsXyzEvidence.recipe.jsonc \
  --standardsDatabaseFilePath=/path/to/standards.sqlite \
  --decisionStoreFilePath=/path/to/decisions.sqlite \
  --rebridge=xyz \
  --vectorize=true
```

This spends real Voyage (embedding) and real Anthropic (judge) credit — it is the *only* mode that
does. The Anthropic client reads its key from
`system/configs/instanceSpecific/qbook/anthropicAi.ini` or `ANTHROPIC_API_KEY`, and **throws by
name at construction** if neither resolves (`apps/graph-builder/lib/build.js`); a rebridge run also
requires `kit.inferenceConfig.llmClient` (with `rerank`) and refuses by name without it. Every
subsequent plain `-build` then MATERIALIZEs your frozen decisions for free.

**Frozen blocks self-describe** (⟪A6⟫): `kit.evidenceFreezer.freeze({ pairStamp, decisions,
generation, rendererVersion, evidencePackages })` stamps the bridge's own `EVIDENCE_GENERATION` tag
and the renderer's `RENDERER_VERSION` into the block, so a reader never has to infer what produced
it. Every bridge declares its own generation constant (`'caseEvidenceBridge-evidence-v1'`,
`'sifEvidenceBridge-evidence-v2'` — SIF bumped v1→v2 when the P9 structural dedupe landed) — a
differently-nominating (or differently-judging) pipeline is a different generation of picks even
over identical graph state, and must be legible as such.

**⟪P9, 2026-07-31⟫ decided = persisted — the judgment cache and the forensic match log.** A killed
`--rebridge` no longer loses its judgments: every per-source LLM judgment is written to the shared
**judgment cache** (`lib/judgment-cache`, keyed `(promptHash, model, rendererVersion)`, WAL sqlite,
default ON at `system/dataStores/judgmentCache/`) **the moment it is decided**, before it is used
downstream, and checked **before** any API call — so a rerun after a crash re-renders identical
prompts and resumes free (`--judgmentCacheFilePath` redirects it; `=false` disables). Alongside it,
the **forensic match log** (`lib/match-forensics`, default ON at
`system/dataStores/matchForensics/<pairKey>/<generation>.jsonl`) appends one JSONL record per
judgment — live, cache-hit, and dedupe fan-out alike — carrying the full rendered prompt, the
response, token usage, retries, and latency; a forensics write failure is loud but never kills a
run. Bridges consume both through `kit.judgmentCache`/`kit.matchForensics` via the shared seam
(`bridge-maker/lib/cachedJudgment.js`); the OPT-IN structural dedupe (a per-bridge `judgmentKey`
hook, `bridge-maker/lib/judgmentDedupe.js` — SIF implements it; genericBridge exposes the
`config.judgmentKey` seam with no default hook) judges shared structure once and fans the verdict
out honestly (`judgedVia: 'dedupe:<key>'` + the representative's `sourceStableId`; the member's
frozen entry references, never duplicates, the representative's evidence package).

---

## 5. Writing a custom evidence bridge

You write a custom bridge when your standard has a structural signal `genericBridge` cannot see. A
custom evidence bridge is **genericBridge's own composition** — the same injected kit, the same
compose -> ⟪A3⟫ gate -> render -> select -> normalize -> freeze -> materialize -> write pipeline,
the same MATERIALIZE/REBRIDGE dispatch, the same refuse-by-name kit validation — with your
standard's character layered in through exactly **three contribution seams** on
`kit.evidenceComposer`:

**(a) A nominate hook into the union pool (⟪A1⟫, recall).** The evidence package's `pool` is a
*union* of cosine top-K candidates **plus** anything your standard explicitly nominates. Contract:
`({ sourceElement, candidateElements }, callback(err, [{candidate, nominatedBy, rationale}, ...]))`.
This is what recovers a candidate the cosine top-K alone would have missed.

**(b) Per-candidate considerations (evidence, not a score).** The walk hook —
`({ sourceElement, pool, graphReader, dependencies }, callback(err, { perCandidateNotes,
promptSegments }))` — writes prose notes on pool candidates, keyed by `candidateKeyFor` (import it
from `lib/evidenceComposer.js`, never reimplement it — a locally-invented key function could
silently drift from the composer's own and orphan every note). A bare overlap *number* re-smuggled
into a note would be the scalar-blend habit this architecture exists to retire, wearing a
different hat — state the shared tokens, the structural location, the comparison, in words.

**(c) Exactly one global prompt segment (⟪A2⟫), candidate-blind.** Returned once via
`promptSegments`, deduped, teaching the judge how to read your standard's character — and never
naming a specific candidate (§3.5).

### 5.1 Worked exemplar 1 — `forges/case/bridges/caseEvidenceBridge.js`

CASE's problem: its source XML rarely states a property's domain class in its own `defText` — many
CASE properties forge with thin or empty prose — so the owning class name carried in the source's
`stableId` (`case:ClassName.propertyName`) is often the only place structural context survives to a
matcher. The bridge's three seams:

- **Nominate** — `caseNominate` tokenizes the source's casePath into owning-class + property tokens
  (`tokenize`/`overlapCoefficient`, ported verbatim from the retired scalar bridge), scores every
  candidate's token overlap, and nominates the top `CASE_NOMINATION_TOPK = 10` with a rationale
  naming the actual shared tokens. A source whose stableId is not CASE-path-shaped nominates
  nothing — never a guessed nomination.
- **Considerations** — `caseWalk` writes one note on **every** pool candidate (cosine-retrieved or
  nominated alike): `Source structural location: owning class '<class>', property '<prop>'
  (casePath <stableId>). Token overlap with this candidate: <tokens, or '(none — retrieved by
  cosine alone)'>.` Pure text over what the composer already handed it — this hook performs **no
  graph read at all**; `graphReader`/`dependencies` ride through unused (⟪A5⟫-compliant by
  construction).
- **Global segment** — `CASE_GLOBAL_SEGMENT`: CASE property definitions are frequently terse or
  empty; a thin CASE-side definition is NOT evidence of a weak match; treat genuine structural
  overlap as a real signal. Written entirely about CASE-the-standard's prose habits, never naming a
  candidate — gate-proven RED/GREEN in `test-caseEvidenceBridge.js`.

**Why it exists — the A/B that retired the scalar path.** The predecessor,
`caseStructuralBridge.js`, reached the same structural insight through a scalar blend
(`blendedScore = baseCosine + STRUCT_WEIGHT * structuralAffinity(...)`) that silently re-ranked the
pool — the structural signal reached only ranking, never the judge. P5 ran a clean three-way:
evidence+structural produced **104** picks vs **32** for evidence-generic vs **107** for the old
scalar blend; **155 of 194** winners carried a structural nomination; **13** were
domain-corrective flips only the structural signal caught. The verdict was emphatic enough that the
scalar comparator and its shell were torn down the same day (the P5 TEARDOWN TOMBSTONE in this
file's header carries the numbers).

Recipe: `recipes/cedsCaseEvidence.recipe.jsonc` — identical in shape to any other mapping bridge,
only the bridge name differs:

```jsonc
{ "source": "case", "hub": "ceds", "bridge": "caseEvidenceBridge",
  "dependencies": ["case", "ceds"], "cacheMode": "reuse" }
```

### 5.2 Worked exemplar 2 — `forges/sif/bridges/sifEvidenceBridge.js`

SIF's problem is the inverse of CASE's: not thin prose but **thin NAMES with deep, load-bearing
STRUCTURE**. SIF's ~15,620 fields draw their leaf names from a ruthlessly reused vocabulary
(`Code` alone is a leaf name on 1,125 distinct fields, `Name` on 702, `@Codeset` on 2,160 — the
file header carries the measured numbers), so a bare leaf-name match is close to worthless; SIF's
real identity is its full XML ancestry and document position. The bridge layers five SIF-specific
additions onto the same pipeline:

- **Ancestry evidence** — `ancestryDescription` states, on every pool candidate, the source field's
  full xpath chain with its owning SIF object called out by name (`SIF source location: SIF object
  'StudentPersonal', full XML ancestry: StudentPersonal > Name > FirstName.`).
- **Three-slot comparison** — `threeSlotComparisonDescription`, per candidate, in prose, never a
  hidden score: leaf token vs candidate property name; immediate-ancestor token vs candidate
  domain; the field's native XSD type/format (stashed by the forge as `nativeType`/`format`) vs the
  candidate's range slot.
- **Sequence-aware sibling context, with graceful degradation** — the payoff of the forge-side
  sequence contract (forge guide §4). `sequenceBaselineDescription` reads
  `sequenceOrdinal`/`siblingCount`/`orderSemantics` (property names imported from the vocabulary's
  `SEQUENCE_PROPERTIES`, never restated as literals) straight off the forged source element — no
  graph read — yielding `child N of M under '<label>'`, with an honest disclaimer that SIF's TSV
  cannot verify a schema compositor. It is then *optionally* enriched with the immediate
  preceding/following sibling names via ONE dependency-scoped graph read
  (`graphReader.readNodes({ label: 'SifField', propertyEquals: { _source: 'SIF',
  sequenceGroupKey } })`); a missing group key, an incapable reader, or a failed/empty read
  **degrades to the walk-free baseline, never an error** — and a source with no sequence stamp at
  all gets an honest "not available" note, never a fabricated position.
- **Dual nomination channels** — `sifNominate` merges two distinct evidence classes: (1)
  leaf+immediate-ancestor token overlap against each candidate's name+defText, capped at
  `SIF_NOMINATION_TOPK = 10`; and (2) an **authored-crossref nomination** — when the source field
  carries a native `cedsId` anchor (the forge-normalized `'CEDS ID'` column; 2,231 of 15,620
  fields do), the candidate whose own `cedsId` exact-matches it is always nominated, exempt from
  the recall cap, **and it wins on collision**: the crossref nomination OVERWRITES a token-overlap
  nomination for the same candidate, because an author-declared anchor is a stronger rationale
  than an inferred token match and the two must never dilute each other.
- **XML global segment** — `SIF_GLOBAL_SEGMENT` teaches the judge SIF's character: leaf names
  recur across hundreds of unrelated objects, so ancestry is the real disambiguating signal; a
  meaningful share of SIF enumerated values are bare codes with no semantic content, so judge those
  by path and description. Deliberately written **without quoting any specific reused leaf name**
  (`'Code'`/`'Type'`/`'Name'` are plausible real CEDS property names and would risk colliding with
  a live pool token under the gate's literal substring check) — gate-proven RED/GREEN in
  `test-sifEvidenceBridge.js` SECTION 5.

It also adds one refusal `genericBridge` doesn't need: a `config.sourceStandard` other than SIF is
refused by name — its hooks assume SIF's forged shape (`xpath`, `sequenceGroupKey/Label`,
`cedsId`); a different source should use `genericBridge`.

Recipe: `recipes/cedsSifEvidence.recipe.jsonc`, same shape as CASE's. Note the `dependencies`
field is load-bearing here: the sibling-name graph read is scoped to the SIF standard itself, so
SIF must be named in `dependencies` (⟪A5⟫ — the recipe declares the walk's read scope; the scoped
graphReader enforces it, not the bridge).

### 5.3 Where the file goes and how it's found

Put your file at `forges/<yourStandard>/bridges/<yourBridgeName>.js` for a standard-local bridge —
the same three-scope search as §2, with the same no-precedence rule: a same-named file in two
scopes throws. Reference it from your recipe exactly like `genericBridge`, just naming your own
bridge. Requires from a bundle-local bridge climb **three** levels to the tree root
(`path.join(__dirname, '..', '..', '..', 'lib', ...)` — both exemplars document this at their own
require sites); a forges-shared bridge at `forges/bridges/` climbs only **two**
(`genericBridge.js` and `authoredAnchorBridge.js` both document this at their require sites).

Export your pure helpers for the unit test (both exemplars end with an "exported for the unit test
ONLY" block), and give the bridge its own `EVIDENCE_GENERATION` constant (§4).

---

## 6. The rules that bite

Each of these is enforced *before* a write happens, and each names itself explicitly in its refusal
message ("refuse-by-value," `polyArch2 §6`).

**Refuse-by-value gates, at both construction and run time.** Every live bridge opens with a wall
of named refusals: missing `kit`, missing kit member (listed by `requiredKitMembersFor`, stricter
under rebridge), missing `kit.decisionStore`, missing `kit.inferenceConfig.llmClient` under
rebridge, missing `inGraph`, wrong `hub`, blank `applyLabel`, blank `config.sourceStandard` — each
with "there is no default" stated in the message. Copy this wall verbatim into a new bridge; it is
the difference between a wiring fault surfacing as a sentence and surfacing as a mystery.

**The vocabulary guard in relationshipWriter.** All bridge writes travel through the guarded
writer, and `relationshipWriter.js` validates every edge against policy derived from
`lib/vocabulary/vocabulary.js` — the single source of truth for sanctioned edge types and required
stamps. An edge whose `relationshipType` the vocabulary does not name (structural ∪
mapping-predicate ∪ crosswalk) is refused; so is a mapping edge whose stamps disagree with its
predicate. Every edge requires a `provenanceTier` (`REQUIRED_PROPERTIES.EDGE`), one of
`spec-authoritative`, `embedding-inferred`, `structural`, `user-asserted`.

**The substrate scan.** A bridge file that references `neo4j-driver`, `neo4jGraphWriter`,
`.boltUrl`, or `.password` is **refused by name before it ever runs**, as a static source-text scan
over the resolved plugin's own file bytes (`FORBIDDEN_SUBSTRATE_PATTERNS`,
`apps/graph-builder/apps/bridge-maker/bridgeMaker.js`). Every write must travel through the
injected `kit.writer` — never a raw connection. The scan is explicitly documented as a heuristic,
not a sandbox: "bypass must now visibly NAME the forbidden substrate... raising the bar, not
sealing the door."

**The deterministic renderer.** The renderer must be byte-stable — identical inputs, identical
prompt — and carry a non-empty `RENDERER_VERSION`; the gate proves determinism mechanically by
calling it twice (§3.2). A prompt-render change is a generation change and must be legible as one:
bump `RENDERER_VERSION` (the tree already did, v1 -> v2, when an instruction's text changed —
`lib.d/evidenceRenderer.js` documents it).

**Decision-store discipline.** Three rules that follow from "the frozen block is replayed
verbatim":

1. **Blocks self-describe** (`generation` + `rendererVersion`, §4) — never rely on a filename or a
   memory of which bridge ran.
2. **Stale blocks are disposable — and must be disposed of** (spec rider R3,
   `bridgeEvidenceRefactor-spec.md`: "Old decision blocks are disposable... delete stale blocks").
   MATERIALIZE replays whatever block is stored for the pair, with zero re-judging — a block frozen
   by an older generation of your bridge will keep resurrecting its old picks on every plain build
   until you delete it or re-freeze with `--rebridge`. When you change a bridge's nomination/walk
   behavior or the renderer, re-run `--rebridge` for the pair.
3. **The store is spend.** A frozen block is the crystallized output of real Voyage + Anthropic
   credit; `--decisionStoreFilePath` (default: sibling of the standards database,
   `<name>.decisions<ext>`) names a file worth keeping. Deleting it costs a re-judge, not a bug —
   but know which you are doing.

**MATERIALIZE-zero is a state, not an error.** A brand-new pairing on a plain `-build` yields zero
inferred edges with `noDecisionBlock: true` (§4) — confirmed, expected, explicit. Do not "fix" it;
run `--rebridge=<token>` once.

---

## 7. Checklist: forged standard to evidence-judged graph

1. **Forge first.** Your standard's base block builds and verifies clean — the
   [forge guide](./README_forgeProgrammingGuide.md)'s checklist, through `npm test`.
2. **Pair with CEDS, zero-code.** Add `hubs: [{ "standard": "ceds" }]` and a
   `genericBridge` entry (§2). Plain `-build` MATERIALIZEs (zero edges, `noDecisionBlock: true`) —
   expected.
3. **Run `--rebridge=<token>`** once, with real Voyage + Anthropic credit, to freeze your first
   evidence-judged decision block. Inspect the frozen block's `frozenEvidence[i].judgment`
   (category + rationale) via `kit.decisionStore.getDecisionBlock` + `kit.evidenceFreezer.parse`,
   or just check the materialized `CLOSE_MATCH` edges' `confidence` in the graph.
4. **Re-run plain `-build`.** Confirm it now MATERIALIZEs your frozen decisions with zero LLM
   calls, byte-identically.
5. **Decide whether you need a custom bridge.** Only if your standard carries a signal cosine
   retrieval cannot see — CASE's stableId-borne owning class, SIF's ancestry + document order +
   authored crossrefs are the precedents (§5). If yes:
   a. Start from an exemplar (`caseEvidenceBridge.js` for a no-graph-read walk;
      `sifEvidenceBridge.js` for a dependency-scoped read with graceful degradation).
   b. Write your nominate/walk hooks against the composer contracts; import `candidateKeyFor` and
      `flattenFullRecord`, never reimplement them.
   c. Write your global segment about the STANDARD, never a candidate — and prove it against the
      real gate with a RED/GREEN fault twin in your test.
   d. Place it at `forges/<token>/bridges/`, give it its own `EVIDENCE_GENERATION`, name it in the
      recipe, declare `dependencies` honestly if your walk reads the graph.
   e. `--rebridge=<token>` to freeze the new generation; compare picks against the generic run
      before you believe your signal helped (the CASE A/B in §5.1 is the template for that
      comparison).
6. **`npm test`** before calling it done.
