> Moved 2026-08-16 (TQ's instruction) from apps/graph-builder/README_ForgeDocumentation/README_HOWTO_ForgeCreationInstructions.md into apps/graph-builder/README_ForgeDocumentation/ as the HOWTO of the forge documentation package. Companion overview: README_ForgeCreationOverview.md; index: README.md (same directory). Written at Profile v1.0.1 (F1), BEFORE the Forge Framework existed: it describes the compliant forge by hand; on the framework, the scaffolding steps collapse to a declaration + hooks (README_ForgeFrameworkSpecification.md §8.2; worked example forges/edfi/).

# Writing a Forge — the guide

> Companion to `README_ForgeProfile.md` (the rules). This document is the procedure.
> Written 2026-08-16 by CELESTIAL_OCEAN under SABLE_RIVER from Author A's survey of the four
> surviving forges (`drafts/F1-authorA-forgeAnatomy.md` §5) and the Profile. Paths are relative to
> `system/code/educoreForge/` unless stated. Verified against branch `architecture-improvement`,
> HEAD `ae41a89`. Where a claim depends on a rule, the Profile section is named in brackets so you
> can read the WHY; this document stands alone as a procedure without it.
>
> Amended 2026-08-16 (v1.0.1) after the adversarial review (`reviews/REVIEW-forgeProfile-adversarial-081526.md`
> §H): prerequisites section added; test-discovery claim corrected; `graphIdentity` and the reader shape
> defined inline; `buildSearchText` element fields and the six `mappingInstruction` keys listed; `_id`
> rule stated.
>
> An older, longer reference exists at `forges/README_forgeProgrammingGuide.md` (2026-07-30). It
> predates the round-trip doctrine's RT-13 stage, the root-and-branch reset and this Profile; where
> the two disagree, this guide and the Profile win.

## What a forge is

A **forge** turns one education-data standard's published source (an RDF file, a set of `.metaed`
files, a TSV, a directory of XSDs) into a graph fragment: a list of **nodes** and a list of
**edges** in a fixed shape, plus a little provenance. It never touches a database. The build system
(`graphBuilder`) finds the forge by its descriptor file, hands it the pinned source, calls it once,
takes the nodes and edges it returns, and writes them into a Neo4j graph as a content-addressed
**block** whose id is the SHA-256 of its text. Later, a **bridge** maps that standard's nodes onto
the CEDS hub; the forge stamps the raw cross-references a bridge will need but never resolves them
itself.

A forge is judged on four things: it emits exactly what the source says (no more — an invented
statement fails the build; no less than it can honestly model — losses are counted and named); two
runs over the same source produce the same block id; it refuses bad input by name instead of
guessing; and it ships the tests that prove all of that, each seen failing before it passed.

## The framework is coming — read this first

At the time of writing the four surviving forges (`ceds`, `edfi`, `sif`, `pesc260805`) each carry
their own copy of everything: the pipeline, the embedding pass, the root node, the finalizer calls,
the node and edge builders, half of the round-trip validator. A **Forge Framework** (specified in F2
of `PLAN-forgeFramework-v1.md`, built in F3) will own all of that as a shared object that hands out
utility methods and asks you to inject only what is genuinely yours. When it lands, the steps below
marked **[framework]** disappear from your list; the steps marked **[you]** remain. Until it lands,
follow the whole list and take every **[framework]** item from `lib/` or from the Ed-Fi bundle as a
template — never by cloning a sibling and editing in place (see "Copying the wrong forge", below).

What the framework will remove from this list: the `forge()` orchestrator and its single
throw-to-callback adapter; the batched embedding pass and its `skipEmbedding` short-circuit; the
`makeNode` / `addEdge` helpers; the `DmeStandardRoot` emission; the calls to
`finalizeStructuralContract` and `finalizeSequence`; the version-stamp call; the CEDS-anchor
normalizer and the clean-stableId predicate; the checksum verification of your source; the null-
embedder refusal; the round-trip validator's snapshot intake, bolt/reader/close, diff engine, verdict
assembler, gate evaluator, twin registry and graph double. What you will still write: the descriptor
data, the parser, the emission walk and its registries, the identity rule, the round-trip
canonicalizer/emitter pair, and your standard's own refusal twins.

## Prerequisites — what must be in place before step 1

- **A Node runtime with `process.global.xLog` bootstrapped.** Every forge reads `const { xLog } =
  process.global` and lets its absence fail loudly (no silent stub — PESC's `|| { status: () => {} }`
  is a recorded defect, Profile §13.1 P8). `graphBuilder` bootstraps it; a bare `node yourTest.js` does
  not, so your tests either run through the test runner or bootstrap it themselves the way
  `forges/edfi/test/test-forgeEdfi.js` does. `xLog` has at least `status(msg)` and `error(msg)`.
- **The qtools async libraries.** The pipeline is written with `taskListPlus` and `pipeRunner`
  from `qtools-asynchronous-pipe-plus` (already a dependency of the tree; `require` them as the
  four forges do at the top of their entry modules). No `async/await`, no Promises across the seam,
  no `try/catch` except the one adapter the framework will own.
- **The shared `lib/` tree** at `system/code/educoreForge/lib/`: `vocabulary`, `structural-contract`,
  `sequence-contract`, `search-text`, `snapshot-provenance`, `content-address`. Take these; never copy
  their contents.
- **For a stage-ON certification build (step "How to certify"):** (a) `[forger].voyageConfigFilePath`
  in the graphBuilder ini pointing at a Voyage credentials file — the build defaults to
  `--vectorize=true` (`apps/graph-builder/lib/build.js:555-559`) and REFUSES by name when the pointer
  or the credential file is absent rather than looking elsewhere; (b) Docker running, because the
  build materializes into a Neo4j container and the validator reads it over bolt; (c) enough memory —
  run `node --max-old-space-size=20000`. Without Voyage credentials you can still forge and test
  with `--vectorize=false`, but the block id you get is NOT the acceptance id (Profile §11.2: the
  acceptance ids are measured vectorized, warm cache, stage on).
- **Read-only respect for the live containers.** Never `rm` a `GOLD_*` or the baseline `DEV_`
  containers; you create your own `DEV_<label>`.

## The files a forge needs

```
forges/<standardKey>/
  parserDescriptor.ini            the registration — REQUIRED (nothing else registers you)
  forge<Standard>.js              the entry module the descriptor names
  roundTripValidator.js           the round-trip validator the descriptor names — REQUIRED
  package.json                    REQUIRED, so the test runner reports UNTESTED instead of nothing
  lib/                            parser, contract-graph builder, round-trip canonicalizer/emitter
  assets/standardSourceData/NN/   one directory per pinned snapshot (see step 1)
  gates/                          gate declarations as JSONC data (edfi/sif/ceds form)
  test/                           test-*.js suites, fixtures, real-graph runners
  README_ValidationCertificate.md six-section certificate (forges/README_ValidationCertificateStandard.md)
  README_ValidationDetail.md      the long argument behind the certificate
  README_roundTripContract.md     what your round trip models, the asymmetry, the named backlog
  README_identityRules.md         how you mint stableIds and why they are stable
  README_ERRATA.md                observations about the UPSTREAM source, evidence-first
  <standardKey>.forgeRecipe.jsonc the standard-version recipe (one standard @ one version)
```

`[code fact]` `ls forges/edfi forges/pesc260805 forges/ceds forges/sif` at HEAD; each carries the
first four and the certificate pair; `README_ERRATA.md` exists only in `sif` today (Profile §10.5
makes it a MUST for a new forge). `[code fact]` Test discovery is `package.json`-GATED: `test/runAllTests.js:108` treats a directory as a
test module only if it carries a `package.json`, and then (`:110-123`) runs every `test-*.js` in its
`test/`. A bundle with a `package.json` and no suite is reported UNTESTED (`forges/README.md:39`); a
bundle with a suite and NO `package.json` is never run at all — which is PESC's state today (Profile
§13.1 P12). The `package.json` is not decoration.

## The twelve steps

These are the steps as the four forges actually did them, in the order a new author meets them.

### 1. Acquire and pin a snapshot — [you]

Create `assets/standardSourceData/NN/` (two digits, e.g. `01`) and put in it, as PEERS of the source
bytes:

- the source bytes themselves, in one subfolder per declared input;
- `README_PROVENANCE.md` — what the source is, where it came from (URL, tag, commit), the EXACT
  acquisition recipe (commands a stranger can run), the license posture, and the acquisition class
  per input (`machine-canonical` for the publisher's own artifact, `human-artifact-snapshot` for
  something a person made); see `forges/edfi/assets/standardSourceData/04/README_PROVENANCE.md` for
  the form;
- `SHA256SUMS` — every source file, so "same bytes" is provable on any machine
  (`cd NN && shasum -c SHA256SUMS --quiet` must pass);
- `standardSourceLocation` — a small YAML-ish file whose `publishedVersion:` line the shared version
  stamp reads when your source does not self-describe its version
  (`lib/snapshot-provenance/snapshot-provenance.js:40-57`).

If the source is licensed and cannot be committed, gitignore the bytes, keep the checksums and the
recipe committed, and say so in `README_PROVENANCE.md` — a git-clone consumer runs the recipe first
or the forge refuses by name (Ed-Fi's MetaEd bytes are the example). [Profile §10.1]

**Version-following:** a new upstream version is a NEW directory `NN+1`, acquired by the recipe,
checksummed, committed. Nothing changes until you flip the pin (step 2). On the flip, run the round
trip against the new snapshot BEFORE anything downstream consumes it; the diff between the two
re-emissions is your changelog. [Profile §3.4]

### 2. Write the descriptor — [you]

`forges/<standardKey>/parserDescriptor.ini`:

```ini
# The [parserDescriptor] header is REQUIRED. The ini reader DISCARDS sectionless keys, so a missing
# or mistyped header makes every key below invisible at once and the error will say "no entryModule"
# against a file that plainly has one.
[parserDescriptor]
standardName=<TheStandard>          # used verbatim in reports and as every node's _source; never lowercased
displayName=<The Standard (Long Name)>
entryModule=forge<Standard>.js
roundTripValidator=roundTripValidator.js   # REQUIRED; declared, not sniffed
defaultSnapshot=01                  # the PIN. Dropping a new snapshot changes NOTHING until this changes.
# sourceFile=<file>                 # ONLY if your parser reads one file inside the snapshot;
                                    # omit it and the forge is handed the snapshot DIRECTORY
```

Choose `standardName` deliberately: it is the name the standard is CALLED everywhere and it must equal
the `_source` your nodes carry. PESC260805 was named distinct from the incumbent PESC so both could
coexist. Do not write an expected-loss number into the descriptor before your validator has earned one
— you may quote a MEASURED verdict with its date, never a target. [Profile §3, §12]

The forger reads exactly: `standardName`, `entryModule`, `defaultSnapshot`, `sourceFile` (optional),
`roundTripValidator`; it refuses a missing header, an empty section, a blank `standardName`, and a
`defaultSnapshot` matching zero or more than one directory
(`apps/graph-builder/apps/forger/forger.js:186-284`).

### 3. Write the parser — [you]

`lib/parser.js` (or several loaders — Ed-Fi has three). Contract:

> **On the framework** the parser(s) become `sourceLoaderList` entries — `{ loaderName, load({ sourcePath,
> additionalSourceInputPathByName, xLog }, cb) }`. `loaderName` is YOUR logical name for that input (there
> is no shared vocabulary across forges), but the convention is uniform and enforced: lowerCamelCase,
> letters and digits, unique within the bundle, declared once in the hooks file (Ed-Fi:
> `metaEdModel`, `descriptorCodeValues`, `authoredCrosswalk`), and — if the names appear in the root's
> `sourceFiles` — declared on the card too (compatibility row E8 is the Ed-Fi instance). A non-camelCase
> or duplicate `loaderName` is refused by name (G-HOOK).

```
parse<Standard>({ sourcePath, xLog }, callback(errString, parsed))
```

- ONE named-argument object, error-first callback, `''` on success. No Promise, no `async`, no
  positional arguments (SIF's `parseSif(sourcePath, {...}, cb)` is the outlier not to copy).
- `sourcePath` is the file `sourceFile` names, or the snapshot directory. Read exactly that. Refuse an
  absent `sourcePath` by name.
- Verify every byte you consume against `SHA256SUMS` before you parse it; refuse a missing, unlisted
  or mismatched file naming the file and where the acquisition recipe lives
  (`forges/edfi/lib/metaEdSourceLoader.js` is the discipline to copy). **[framework]** will own the
  verifier; until then take Ed-Fi's.
- The `parsed` object is yours — any shape — EXCEPT that from it you must be able to produce
  `metadata: { version, versionSource?, sourceFormat, sourceFiles, sourceUrl }`. Self-describe
  `version` when the source can (`owl:versionInfo`, MetaEd `projectVersion`) and say `'unknown'`
  honestly when it cannot; never invent one and never use the recipe's token.
- Count every formerly-silent path (a skipped row, an unbound prefix, a duplicate) into a
  `parseAudit` object you return alongside; it rides on `stats` and is excluded from the digest.
- Refuse malformed source by name. Never coerce, never default, never `a || b || c`.

### 4. Decide the role mapping — [you], and get it RULED

Every node carries exactly one of the `Dme*` roles from `lib/vocabulary/vocabulary.js` (`DME_ROLES`,
`vocabulary.js:47`: `DmeStandardRoot`, `DmeClass`, `DmeProperty`, `DmeOptionSet`, `DmeOptionValue`,
`DmeSupport`, plus the CEDS-specific `DmeEditHistoryEntry`, `DmeRestriction`, `DmeVocabularyTerm`). Map your standard's native kinds onto them as a
REGISTRY object, not a switch and not a set of hard-wired loops:

```js
const CONSTRUCT_ROLE_REGISTRY = Object.freeze({
  <nativeKind>: { role: ROLES.CLASS, perStandardLabel: '<Std>Class', nameField: 'name', ownershipEdgeType: EDGE_TYPES.HAS_PROPERTY },
  ...
});
```

(`forges/edfi/lib/forgeEdfiContractGraph.js:85-108` is the shape to keep.) An unknown kind is a
refusal by name, not a silent skip. If your standard has an option-set-like kind, its values MUST be
expanded into `DmeOptionValue` children joined by `HAS_VALUE`, not carried as a JSON array. The
mapping is a design decision that gets recorded in the module header as a ruling (SIF's, EDFI's and
PESC's all were). [Profile §4.4, H3]

### 5. Decide the identity rule — [you]

Every node has a `stableId`: a pure function of the SOURCE, unique within your output. Write
`README_identityRules.md` saying how each kind's id is minted and why it is stable:

- if the source supplies an identity (a URI, an identifier), use it or a deterministic function of it;
- otherwise mint `<standardKey>:<kind>/<naturalKey>` from a natural key per kind (a table name, an
  xpath, a fingerprint) — never a counter, never a timestamp, never anything from run state;
- for anonymous records, owner + a source-recoverable position (`<ownerId>#restriction/<n>` where `n`
  is FILE POSITION, never chronology);
- handle your standard's own collision hazard explicitly and say so (PESC's contested namespaces get
  an `@<sha256:12>` suffix; Ed-Fi's property ids carry the owner type; SIF scopes sequence groups by
  owner).

Also fix your `stableUriPropertyName` (`edfiStableId`, `sifStableId`, …) — the node property that
carries the stableId and that the block header will name as the resolution key — and your root's
stableId (`<standardKey>:root`). [Profile §5]

### 6. Write the emission walk — [you], using [framework] helpers

`lib/forge<Standard>ContractGraph.js` exports `buildContractGraph(parsed) -> { nodes, edges, stats }`.
It is PURE: synchronous, no I/O, no clock, no randomness, no `process` state; it may THROW on a
refusal (the orchestrator adapts the throw). Two calls over the same `parsed` must be byte-identical.

Inside it you drive the walk from your registries (step 4) and helpers you take from Ed-Fi today and
from the framework tomorrow:

- `makeNode({ role, stableId, name, ...})` — stamps the universal properties (`_source`, `name`,
  `role`, `searchText`, `[stableUriPropertyName]`, `parentId`, `crossRefs`) and the label triple
  `[ForgedNode, <PerStandardLabel>, <DmeRole>]`; refuses an unclean or duplicate stableId. Do NOT set
  `_id`: the replay engine overwrites it with the stableId and the harvest drops it from block text,
  so a forge-stamped `_id` is inert at best (Profile §5.1). `_source` MUST equal the descriptor's
  `standardName` exactly.
- `addEdge(type, fromStableId, toStableId, extraProperties?)` — stamps `provenanceTier: 'structural'`;
  records a dangling endpoint and refuses at the end naming the first offender. Every `type` comes
  from `EDGE_TYPES`; never a bare string.
- `buildSearchText(element)` from `lib/search-text/build-search-text.js` — the ONE searchText builder;
  description is never an input; a node you do not want embedded gets no searchText and is excluded
  from the embed pass (declare that, don't leave it implicit). The `element` fields it reads, per role
  (`build-search-text.js:49-82`, a role-keyed registry): `DmeStandardRoot` → `{ name, standardName }`;
  `DmeClass` → `{ name, standardName, owningName }`; `DmeProperty` and `DmeOptionSet` →
  `{ name, owningClassName | owningName }`; `DmeOptionValue` → `{ name, optionSetName, owningName,
  owningClassName }`; `DmeSupport` → `{ name, owningName, standardName }`. An unknown role or an
  empty result throws. Note that what you pass for `owningName` on a class is a byte-relevant choice:
  PESC passes the owning artifact where SIF and Ed-Fi pass the standard's own name, and every
  `embeddingRef` hashes the resulting text (Profile §5.4 conjunct 4).
- Carry a native scalar onto a node ONLY when the source states it (a `CONSTRUCT_SCALAR_CARRY_LIST`,
  `forgeEdfiContractGraph.js:184-201`); absent is absent — no `description: ''`.
- Stash cross-references to other standards (typically the CEDS anchor) as DATA: a normalized `cedsId`
  plus a `crossRefs` JSON property `[{ system, id, raw, locator }]` (`'[]'` when none). NEVER emit a
  cross-standard edge; a bridge resolves these later. Declare which native column is the anchor and
  which values mean "absent" (Ed-Fi's `'000000'`); the normalizer itself is shared.
- Derived facts (things your standard implies but does not state) come ONLY from a closed table that
  REFUSES an unlisted value, with the derivation documented at the site
  (`forges/sif/forgeSif.js:109-115,479-490`).
- Emit exactly ONE `DmeStandardRoot` carrying `standardKey`, `standardName`, `version`,
  `sourceFormat`, `sourceFiles`, `sourceUrl`, `stableUriPropertyName`, `mappingInstruction`, and
  (as the three well-behaved forges do) `snapshotKey`, `publishedVersion`, `versionSource`,
  `parserVersion`, `coreVersion`. Never `ingestedAt` — no clock. If your standard has no source URL,
  OMIT `sourceUrl` rather than stamping `''` (absent is absent). The root's `description` is
  source-stated or absent, never a template like `"<Display> — N objects"`. `mappingInstruction` is
  a JSON-stringified object with exactly six keys, all present even when empty:
  `cedsOriginalAnchorPropertyName` (your node property that holds the raw CEDS anchor, e.g.
  `cedsId`), `cedsOptionOriginalAnchorPropertyName` (same for option values), `crosswalkPrefix`,
  `crosswalkResolveProperty`, `includeInImplied` (boolean), `impliedTargets` (list) — copy the shape
  from `forges/sif/forgeSif.js:119-126` and fill in your values; the bridge reads it. Note the root's
  `standardName` PROPERTY today carries the DISPLAY string (`STANDARD_DISPLAY`), not the descriptor's
  short `standardName` — that is forge-declared data (Profile §3.1). **[framework]** will build the
  root from your declaration object.

[Profile §4.4, §5.3, §7, §9, §10.4]

### 7. Call the finalizers — [framework]; until then, [you]

As the LAST thing your pure layer does over `{ nodes, edges }`:

- `finalizeStructuralContract({ nodes, edges })` from `lib/structural-contract/` — derives `depth`
  from the parent chain (so do NOT hand-stamp `depth`), stamps `crossRefs: '[]'` where absent, and
  REFUSES anything but exactly one root, a `parentId` that names nothing or names an `_id` instead
  of a stableId, and a `parentId` cycle.
- `finalizeSequence(...)` from `lib/sequence-contract/` — if your standard has element ORDER you can
  see (XSD sequences, ordered TSV groups), declare the sequence groups and call it; order then becomes
  a modelled dimension the round trip checks (SIF `forgeSif.js:278-280,524-567,632-639`).

PESC calls neither today and that is a recorded non-compliance, not a precedent. [Profile §4.4.7-8]

### 8. Write the entry module — [framework]; until then, [you], from the Ed-Fi template

`forge<Standard>.js` exports the second stage of a two-stage factory:

```js
const moduleFunction =
  ({ moduleName } = {}) =>
  ({ embedder } = {}) => {
    const { xLog } = process.global;           // no silent default logger
    ...
    const forge = ({ sourcePath, owner, embedNodeLimit, skipEmbedding }, callback) => {
      // taskListPlus: parse -> [try { buildContractGraph } catch -> next(err)] -> deriveVersionStamp
      //   -> embedNodes (or skip with embedCallCount 0) -> callback('', {
      //   nodes, edges, metadata: { version, snapshotKey, publishedVersion, versionSource },
      //   embedCallCount, standardKey, stableUriPropertyName, stats })
    };
    return { forge, buildContractGraph, STANDARD_KEY, STANDARD_SOURCE, STABLE_URI_PROPERTY_NAME };
  };
module.exports = moduleFunction({ moduleName: 'forge<Standard>' });
```

The seam is exact and you must not vary it: the factory takes `{ embedder }` (an object with one
method, `embedTexts({ texts }, cb)`, or `null`); `forge` takes those four arguments and calls back
error-first with those six keys (`nodes`, `edges`, `metadata` with its four keys, `embedCallCount`,
`standardKey`, `stableUriPropertyName`); the pure layer is exported as `buildContractGraph` under that
name. `metadata.version` is what you READ or `'unknown'`, never `''` and never the recipe token; the
forger refuses an empty one. `skipEmbedding: true` means zero embedding calls and
`embedCallCount: 0`; embedding requested with no embedder is a refusal by name. Do not construct an
embedding client — it is injected. Do not stamp `owner` unless you have a reason; it is reserved and
passed through. [Profile §2]

The version stamp: call `deriveVersionStamp({ sourcePath, sourceVersion, warn })` from
`lib/snapshot-provenance/` and `Object.assign` its `{ snapshotKey, publishedVersion, versionSource }`
onto `metadata`; pass a real `warn` (there is no default); a version your source self-describes wins
over the provenance file and a disagreement is warned with both values. [Profile §10.1]

### 9. Prove determinism — [you], with [framework] gate

Write a test that runs `buildContractGraph` twice over one parse and asserts the two `{ nodes, edges }`
are byte-identical (JSON-stringify and compare), and a test that greps your pure layer for `Date.now`,
`new Date`, `Math.random`, `process.hrtime` and finds none. Then the twin: stamp a run counter into one
stableId in a copy of the builder and watch the determinism test go RED. `forges/pesc260805/test/test-pesc260805SourceTier.js`
G-A and `forges/edfi/test/test-forgeEdfi.js` are the examples. [Profile §5.4, §11.3 gate 4]

### 10. Write the round-trip validator — [you] for the pair; [framework] for the rest

The round trip proves the graph can give the standard back: source → forge → block → load →
materialized graph → re-emission → diff against the source. `roundTripValidator.js` at your bundle
root exposes:

```
validate({ containerName, boltUrl, user, password, snapshotPath, outputPath }, (error, verdict) => …)
```

and `validateWithReader({ reader, snapshotPath, outputPath, graphIdentity }, cb)` — the seam every
twin test drives. Here `reader` is an object with exactly two methods, `readAll(cb)` (calls back with
the standard's Layer-1 rows read from the graph, scoped to your `_source`) and `close(cb)`; the bolt
path constructs one over a Neo4j driver (`makeNeo4j<Std>Reader`), the hermetic path constructs one
over a forge result (the graph double, `forges/edfi/lib/roundTripGraphDouble.js:48,156`). `graphIdentity`
is the small record the verdict prints to say WHICH graph was read — the container name or bolt URL —
so a verdict can never be mistaken for a verdict about a different build. The verdict MUST carry, under exactly these names, `roundTripClean`,
`inventedTotal`, `lostTotal`, `contentGapTotal`, `explicitlyOmittedTotal`, and a
`semanticValidationLimit` paragraph saying what the round trip does and does not model (order?
whitespace? prefix spelling? documentation text?). `roundTripClean === (contentGapTotal === 0 &&
inventedTotal === 0)`. `inventedTotal > 0` fails the build, always. `lostTotal` is a meter: tolerated,
logged, every lost item labelled `contentGap` or `explicitlyOmitted`, and named in your backlog. No
percentage anywhere. Refuse an absent `outputPath`; a verdict must land on disk. [Profile §8]

What is yours is the PAIR: a source-side **canonicalizer** (`lib/roundTrip<Std>Canonical.js`) that
turns source text into a `Map<statementKey, statement>` + `stats`, and a graph-side **emitter**
(`lib/roundTrip<Std>Compiler.js` / `Emitter.js`) that reads the materialized graph through a `reader`
(scoped to your `_source`, Layer 1 only, roles and edge types named explicitly), re-emits, and —
recommended — passes the emission through the SAME canonicalizer so both sides of the diff are
canonicalized identically (SIF and PESC do this). Both callback-shaped. Keep them apart on purpose:
the instrument must not prove the forge agrees with itself. The validator MUST NOT contain or read
source data; the source enters once, as the answer key. Everything else — snapshot intake and
checksum, bolt resolve / reader construct / close, the diff engine, verdict assembly and shape check,
gate evaluation, the twin registry, the Docker-free graph double — is **[framework]**; until then
take Ed-Fi's or SIF's copies, and prefer the extracted `forges/edfi/lib/roundTripSnapshotIntake.js`
for intake.

Declare it in the descriptor (`roundTripValidator=roundTripValidator.js`) ONLY once it loads and
produces a verdict you trust; a declared-but-missing or declared-but-broken validator is a refusal on
EVERY build, stage on or off. [Profile §3.3, §8.1]

### 11. Ship the tests — [you] for your twins; [framework] for the sweep

Under `test/`, `test-*.js` files the runner discovers:

- the hermetic pure-layer suite: descriptor resolves; factory shape; return shape; determinism;
  every refusal your bundle performs, each with a twin that injects the exact fault and checks the
  refusal text NAMES it (`forges/edfi/test/test-forgeEdfi.js`);
- a gate declaration file `gates/*.jsonc` — JSON-with-comments DATA, one entry per gate naming the
  measurement path (dotted, into the verdict), the comparator (`equals`, `lessThan`, …) and the
  expected value; the evaluator (`forges/edfi/lib/roundTripGates.js`, `loadGateDeclarations` +
  `evaluateGates`) reads it, so a gate is data, not code — and a twin for every gate
  (`forges/ceds/test/test-cedsGates.js` is the "every gate observed RED" sweep;
  `forges/edfi/lib/roundTripGateTwins.js` the twin registry);
- the validator test: a hermetic fixture that forges, loads into a graph double, re-emits and diffs to
  zero loss and zero invention with no container and no real source; the five normative fields and
  the limit present; the cheating-detector twin (delete one fact from the double, the diff moves); the
  invention twin (inject one statement, the build fails);
- a real-graph runner (`run<Std>RoundTripRealGraph.js`) for stage-ON evidence.

A test must never write into a tracked path; evidence of a run comes from a run. UNPROVEN and
UNMEASURED are failures, never skips; no standing `expectFail:true`. Every gate observed RED before it
was made green — a gate never seen failing is unproven. [Profile §11]

### 12. Write the READMEs and certify — [you]

Write `README_ValidationCertificate.md` in the six-section form of
`forges/README_ValidationCertificateStandard.md`, `README_ValidationDetail.md` with the long argument,
`README_roundTripContract.md`, `README_identityRules.md`, `README_ERRATA.md`. Then certify (next
section).

## How to certify

1. **A recipe.** Write `<standardKey>.forgeRecipe.jsonc` (one standard @ one version — copy
   `forges/edfi/edfi.forgeRecipe.jsonc`) and a graphBuilder recipe under `recipes/` with
   `"roundTripStage": true` (copy `recipes/edfiOnlyRoundTrip.recipe.jsonc`). A recipe with the stage
   off produces no verdict and can never be certified.
2. **A stage-ON build**, detached, with a PID and a log:
   ```
   node --max-old-space-size=20000 apps/graph-builder/graphBuilder.js -build \
     --recipePath=recipes/<yours>.recipe.jsonc \
     --standardsDatabaseFilePath=<a fresh .sqlite3 path under system/dataStores/graphBuilder/> \
     < /dev/null > <logdir>/build.log 2>&1 &
   ```
   Always `< /dev/null`: graphBuilder reads a JSON parameter object from stdin whenever stdin is not a
   TTY and will otherwise block. The build lands `roundTrip/roundTripStageSummary.json` in its run
   directory under `system/dataStores/buildLogs/`.
3. **Read the verdict.** `inventedTotal` must be 0. `lostTotal` is whatever it honestly is, with its
   `semanticValidationLimit` beside it and each loss named in your backlog.
4. **`goldEvalCheck`:**
   ```
   node apps/graph-builder/graphBuilder.js -goldEvalCheck --buildLogDirPath=<the run dir> < /dev/null
   ```
   PASS only when every declared validator ran and reported `inventedTotal: 0`; it refuses by name when
   the stage was off, a verdict is missing, or invention is nonzero.
5. **Reproduce the block id.** Build again over the same pinned snapshot; the block id must be
   identical. That id is your acceptance number; record it in the certificate.
6. **Name the container by tier (GNC-001).** Anything you build to check your own forge is
   `DEV_<label>` — scratch, never deployed; a single- or few-standard assembly is ALWAYS `DEV_`. Only a
   full all-standards build earns `GOLD_EVAL_<YYMMDD>`, and only after `goldEvalCheck` PASS. A
   `GOLD_EVAL_` becomes `GOLD_<YYMMDD>` by RENAME of the same container and volume, never by rebuild.
   `goldEvalCheck` gates PROMOTION only; create as many `DEV_` graphs as the work needs. [Profile §11.2]

## Copying the wrong forge — the pitfalls

Every one of the four surviving forges is the same machine, and every one has a defect the others do
not. If you clone one, you inherit its defect. Take the pieces from `lib/` (and, when it lands, the
framework); where you must copy, know what you are copying:

- **Copying PESC** gets you: no `finalizeStructuralContract`, no `deriveVersionStamp`, no
  `finalizeSequence`, a root missing four provenance fields, a silent no-op logger behind
  `process.global`, a bare `'DECLARES'` edge type, `description: ''` for absent, enumeration values
  as a JSON array instead of `DmeOptionValue` nodes, and a pure layer named `buildSourceTierGraph`.
  Its null-embedder refusal, its `requiredStat` guard and its `verifyVerdictShape` are the good parts.
- **Copying CEDS** gets you: no dangling-edge check, no duplicate-stableId check, no role registry
  (four hard-wired loops), the literal `'CEDS'` where the constant belongs, `_id !== stableId` for a
  legacy hub reason, source checksums verified only in the validator, and a compiler that writes an
  RDF file to disk and reparses it. Its identity-rules README and its twin sweep are the good parts.
- **Copying SIF** gets you: a positional parser signature and `bi/idx` names — but also the best
  sequence-capture and closed-table-derivation examples in the tree, and the only `README_ERRATA.md`.
- **Copying Ed-Fi** gets you the most disciplined scaffolding — duplicate refusal, `edgeProperties`
  validation, absent-is-absent, checksum at consumption, a role registry, a carry list, an extracted
  snapshot intake — and it is the recommended template. But its validator writes artifacts only when
  `outputPath` is truthy, exports the bare factory where the others export the applied one, and its
  emitter is synchronous; and its 1,130-line contract graph hides that ~150 lines of it are the common
  scaffolding the framework removes.

Two things you would get wrong by reading any two of them: the three CEDS-anchor normalizers share one
regex and give two different answers for `'000000'` (Ed-Fi says absent; SIF would mint `P000000`);
and four validator headline vocabularies compute `lostTotal` four different ways. Neither is a style
choice — take the shared one when it exists and say which you took when it does not.

## The checklist

Empty directory to certified block:

- [ ] `assets/standardSourceData/NN/` with source bytes, `README_PROVENANCE.md` (recipe, license,
      acquisition class per input), `SHA256SUMS` (passes `shasum -c`), `standardSourceLocation`
- [ ] `parserDescriptor.ini` with `[parserDescriptor]` header, `standardName`, `displayName`,
      `entryModule`, `roundTripValidator`, `defaultSnapshot=NN`, and `sourceFile` only if one file
- [ ] `package.json` at bundle root (test discovery is gated on it)
- [ ] parser: one named-arg object, error-first callback, checksums verified at consumption, refuses
      by name, yields `metadata.{version, sourceFormat, sourceFiles, sourceUrl}`, `parseAudit`
- [ ] role registry decided, ruled, recorded in the header; option sets expanded to `DmeOptionValue`
- [ ] identity rule written in `README_identityRules.md`; stableIds pure of source; collision hazard
      handled explicitly; `stableUriPropertyName` and root id fixed
- [ ] `buildContractGraph` pure; `makeNode`/`addEdge` used; `_id` never set; every edge type from
      `EDGE_TYPES`; cross-refs stashed as data, no cross-standard edge; absent is absent (no `''`,
      omit `sourceUrl` when none, no template description); one `DmeStandardRoot` with the full
      provenance block and no clock
- [ ] `finalizeStructuralContract` last; `finalizeSequence` if you can see order
- [ ] entry module satisfies the seam exactly; `metadata.version` read or `'unknown'`;
      `skipEmbedding` honored with `embedCallCount: 0`; null embedder refused by name; no own
      embedding client; `deriveVersionStamp` with a real `warn`
- [ ] determinism test green and its twin observed red
- [ ] `roundTripValidator.js` declared; canonicalizer/emitter pair; five normative fields +
      `semanticValidationLimit`; `outputPath` refused when absent; hermetic fixture clean;
      cheating-detector and invention twins observed red
- [ ] every refusal has a twin whose text names the fault; every gate observed red; no test writes a
      tracked path
- [ ] `README_ValidationCertificate.md`, `README_ValidationDetail.md`, `README_roundTripContract.md`,
      `README_identityRules.md`, `README_ERRATA.md`
- [ ] prerequisites in place: `xLog` bootstrap, qtools, Voyage pointer + credentials, Docker
- [ ] stage-ON build (vectorized, warm cache) → `inventedTotal 0`; `goldEvalCheck` PASS; block id
      reproduced twice; container named `DEV_<label>`

When the framework lands, strike every line marked **[framework]** in the steps above; the checklist
shrinks to the descriptor, the parser, the registries, the identity rule, the pair, and your own
twins — and everything struck is proven once, in one place, for every forge.
