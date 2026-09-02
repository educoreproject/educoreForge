# EDUcore Forge Profile v1.0

> Amended 2026-08-16 (v1.0.2) by the supervisor after the framework spec's adversarial review
> (`reviews/REVIEW-forgeFramework-adversarial-081626.md`; rulings `RULINGS-supervisor-forgeFramework.md`
> D5/D6/D10, FR1, FR4, FR20): §13.1 P4 is SEVEN edge types; §7.1 `name` is OPTIONAL at mint (absent
> stays absent, never `''`, counted); §5.1 `_id` is stamped by the FRAMEWORK (`_id = stableId`, byte-
> invisible) and never by a hook; §13.1 preface: a byte-free repair the framework performs by
> construction discharges WITH the migration commit; §10.4 the five root fields become MUST once P5
> retires; punch rows C9, S6, E7, E8, P18, S7, C10 added.
>
> Amended 2026-08-16 (v1.0.1) after the independent adversarial review
> (`reviews/REVIEW-forgeProfile-adversarial-081526.md`, verdict SOUND-WITH-GAPS) under the
> supervisor's remediation list R1-R8: §13 preface and §15 gain the COMPATIBILITY-DECLARATION rule that
> repairs the byte-identity premise; §13.1 gains twelve punch rows and loses two; §6 hooks are restated as
> `[design — F2 defines]` over today's four divergent shapes; §5.5 (engine-side canonicalization) added;
> §11.3 gates tightened (A13 identity asserted, twin per conjunct, gate 5 stated RED today); stale
> "supervisor to CONFIRM" purged; `_id` closed; provenanceTier scope note; `[doc fact]` marker introduced.
> Every change is traceable to `RULINGS-supervisor-forgeProfile.md` addendum 23:00.
>
> Merged 2026-08-16 by CELESTIAL_OCEAN (F1 merger) under SABLE_RIVER from two drafts written in
> parallel under `BRIEF-F1-forgeProfileAuthors.md`: `drafts/F1-authorB-contractDoctrine.md`
> (PEARL_COMPASS — the normative spine) and `drafts/F1-authorA-forgeAnatomy.md` (GOLDEN_MIRROR — the
> anatomy, the duplication census, the hooks, the round-trip census). Every open question the two
> drafts left is closed by `RULINGS-supervisor-forgeProfile.md` (2026-08-15 22:32) or recorded in
> §14. Every `[code fact]` was verified against the working tree at branch
> `architecture-improvement`, HEAD `ae41a89`, with `grep -a`; line numbers are as of that tree.
> Where the two drafts cited different line numbers for one fact, the number here is the one that
> matches HEAD. Appendix A records every place the drafts contradicted each other and how each was
> resolved.

This specification defines what a forge bundle IS and what it MUST satisfy to enter `forges/` and
have its block enter canon. It covers the seam the forger calls it through, the descriptor that
registers it, the pipeline every forge runs, the identity it mints and the determinism that makes
its block reproducible, the per-standard hooks a forge author supplies and nothing more, the
refusals it performs, the round trip it must survive, the line it must not cross into bridging, the
provenance it carries, the tests and gates it ships, the practices the four surviving forges taught
us to forbid, and the rule under which those four migrate onto the coming framework.

It applies to every forge bundle — the four that survive the root-and-branch reset (`ceds`, `edfi`,
`sif`, `pesc260805`) and every one written on the Forge Framework whose specification (F2) is written
against this Profile. The framework is a way of satisfying this Profile with shared code; it is not
exempt from any line of it. Its ruling priority is MAXIMUM SHARED CODE, so throughout this document
what is COMMON to all forges is marked as framework territory and what is legitimately PER-STANDARD
is marked as the forge author's.

Its sibling is `SPEC-educoreBridgeProfile-v1.0.md`, which governs how a forge's output is mapped
into the CEDS hub. This Profile does not contradict it and cites it where the two meet (§5.2, §9).

Statements about existing code are marked `[code fact]` where verified against the source;
statements resting on a governing DOCUMENT (the round-trip doctrine, the DEVLOG, a README, the Bridge
Profile) are marked `[doc fact]`; and `[design]` marks where this document is making or restating a
decision. `[design — F2 defines]` marks a shape the Forge Framework specification must fix. **MUST**,
**MUST NOT**, **SHOULD** and **MAY** carry their ordinary specification force. A forge that violates a
MUST is non-compliant and its block does not enter canon. Where this Profile says a rule is a MUST and one of the four
surviving forges violates it today, §13 says what happens: the forge migrates byte-identical first
and the repair is a separate, deliberate change.

---

## 1. Terms

**the doctrine** — `system/management/zNotesPlansDocs/DOCTRINE-roundTripForgeContract-080326.md`,
the round-trip forge contract. Its rules are numbered **RT-n** (RT-1 … RT-14) and its amendments
**A-n** (A3 … A13; A13 is the lost/contentGap/explicitlyOmitted arithmetic reconciliation). **R-WO-n**
numbers are rulings from the Ed-Fi work order (`WORKORDER-edfiRoundTripForge-080326.md`); **K-n**
numbers are DEVLOG Phase 4 findings. Cited below as `[doc fact]` doctrine §x / RT-n / A-n.

**polyArch2** — TQ's house architecture discipline (`developmentPractices.md`): registry/data over
switch statements; no silent default for absent or invalid input (refuse by name); no mutation of
global state except the frozen `process.global`; error-first callbacks on server/CLI, no async/await,
no try/catch as control flow; a declared interface at every polymorphic seam; compound greppable
names, never the bare word `key`; every gate observed failing before it passes.

**forge bundle** — the per-standard kit under `forges/<standard>/`. Always the full two-word term.
`[doc fact]` The doctrine records this as a TQ vocabulary ruling (2026-07-22), doctrine §2.

**descriptor** — `forges/<standard>/parserDescriptor.ini`. The bundle's whole registration (§3).

**entry module** — the file the descriptor's `entryModule` names. It exports a factory taking
`{ embedder }` and returning the bundle.

**seam** — the call the forger makes into a bundle and the shape it demands back (§2).
`[code fact]` `apps/graph-builder/apps/forger/forger.js:816-840` and `:932-958`.

**forger** — `apps/graph-builder/apps/forger/forger.js`. Resolves the bundle, wires the embedder,
runs `forge()`, translates the return to engine shape. Touches no graph.

**engine shape** — the `{ nodes, edges, embeddingDims }` form `replayManager.init` consumes;
produced from the bundle's return by `shapeForgedGraph`. `[code fact]`
`apps/graph-builder/apps/forger/lib/shape-forged-graph.js:42-162`.

**block** — the schema block harvested from a materialized graph; the unit of canon. Its id is the
SHA-256 of its text. `[code fact]` `lib/content-address/content-address.js:22`.

**pure layer** — the bundle's `buildContractGraph`: synchronous, deterministic, no I/O, no clock, no
randomness; source-model in, `{ nodes, edges }` out. Exported for determinism tests.

**hook** — one of the five things a forge author supplies (§6): the descriptor, the parser, the
emission walk, the round-trip canonicalizer/emitter pair, the tests. Everything else is framework
territory.

**Layer 1 / Layer 2** — the standard faithfully represented, versus our invented matching apparatus
(hub cards, address signatures, embeddings). Only Layer 1 round-trips. `[doc fact]` doctrine §2.

**round-trip validator** — `roundTripValidator.js` at bundle root, declared in the descriptor,
invoked by the graphBuilder stage after materialization. `[doc fact]` doctrine §7;
`apps/graph-builder/lib/round-trip-stage.js`.

**refusal by name** — stopping with an error that states what is missing or wrong and where it
belongs, instead of substituting, defaulting, skipping, or coercing.

**compatibility declaration** — a per-forge DATA entry in the forge's declaration object telling the
framework to reproduce that forge's pre-migration bytes at a framework-owned step (§13). Never a code
branch. Retired one at a time, each retirement its own commit with its own new block id.

**block determinism** — the property that two builds over the same pinned snapshot with the same
code produce byte-identical block text and therefore the same block id (§5.4).

---

## 2. The seam

The seam is the contract between the forger and a bundle. The framework MUST satisfy it unchanged;
graphBuilder is not to be modified to accommodate a forge. `[code fact]`
`PLAN-forgeFramework-v1.md` "What exists today"; `forger.js:816-827`. This section is copied from the
code, not paraphrased: the F2 panel reads it first.

### 2.1 The factory

```
require(<bundleDir>/<entryModule>)({ embedder }) -> bundle
```

- The entry module MUST export a function of ONE named-argument object carrying `embedder`, and
  MUST return the bundle synchronously. `[code fact]` `forger.js:816`
  (`const bundle = require(resolved.entryPath)({ embedder });`); `apps/graph-builder/interfaces.js:229-243`
  (`@interface ForgeBundle`).
- `embedder` is an `Embedder` (`interfaces.js:245-254`: one method,
  `embedTexts({ texts }, cb(err, { vectors, embeddingModelVersion }))`) or `null`. `null` means the
  spend knob is off and the bundle will be run with `skipEmbedding: true`. `[code fact]` `forger.js:766`,
  `:828`.
- The bundle MUST expose `forge` and `buildContractGraph` under exactly those names. `[code fact]`
  `interfaces.js:237-242`; `forges/ceds/forgeCeds.js:963-968`, `forges/edfi/forgeEdfi.js:269-275`,
  `forges/sif/forgeSif.js:832-838` return both. `[code fact]` ⚠ **SUPERSEDED 2026-08-29** (hub-kit-role Phase 4,
  commit b1a6705): this read *"`forges/pesc260805/forgePesc260805.js:800-806` exports its pure layer
  as `buildSourceTierGraph`, not `buildContractGraph` — the declared interface is not literally
  satisfied by PESC (§13 punch list)"*. PESC is now ON the framework and returns the framework's own
  bundle, so it exports `buildContractGraph` like the other three and the punch-list item is
  discharged. `buildSourceTierGraph` is GONE — ruling FJ-P4-4 as amended: keeping it was not
  mechanically possible (the framework fixes the bundle surface) and it had no consumer anywhere in
  the tree.
- The bundle MUST NOT construct an embedding client of its own. The forger constructs the ONE client
  and injects it, so the shared vector cache and the ini-declared model are the same for the base
  pass and the hub pass. `[code fact]` `forger.js:796-813`, `:885-887`.
- All four surviving bundles are a two-stage factory
  `moduleFunction({ moduleName }) => ({ embedder }) => bundle` and export the applied second stage.
  `[code fact]` `forgeCeds.js:99-101`, `forgeEdfi.js:53-55`, `forgeSif.js:190-192`,
  `forgePesc260805.js:78-80`. `[design]` The two-stage form is the house pattern and SHOULD be kept;
  the seam only requires that what `require` returns is the `({ embedder }) => bundle` function.

- `[design — F2 defines]` Under the framework the ENTRY MODULE is one line that binds the forge's
  declaration object (H1) and its injected hooks (H2-H4) to the framework factory; what `require`
  returns is still `({ embedder }) => bundle`, and `buildContractGraph` is the framework's pure run of
  the injected hooks. The forge author writes data and hooks, not the seam.

**WHY a factory and not a module of functions.** The embedder is the only impure dependency a forge
has, and injecting it is what makes `buildContractGraph` provably pure and the whole bundle runnable
in a test with no credential in scope. `[code fact]` `interfaces.js:241-242` names
`buildContractGraph` "the PURE deterministic layer, exported for determinism tests."

### 2.2 forge() — the call

```
bundle.forge({ sourcePath, owner, embedNodeLimit, skipEmbedding }, callback)
```

`[code fact]` `forger.js:827-828`:
`bundle.forge({ sourcePath, owner, embedNodeLimit, skipEmbedding: !vectorize }, ...)`. Exactly these
four keys are passed; the values are:

| argument | value | force on the bundle |
|---|---|---|
| `sourcePath` | the FILE the descriptor's `sourceFile` names inside the pinned snapshot, or the snapshot DIRECTORY when `sourceFile` is absent; or the caller's `spec.source` override | MUST be read; MUST NOT be replaced by any other path. `[code fact]` `forger.js:262-269`, `:756-762`. A bundle MUST refuse an absent `sourcePath` by name rather than let the parser fail on it — a universal refusal (§7.2). `[code fact]` `forgePesc260805.js:628-631` does; the other three do not (Author A §1.1); under the framework it is the framework's |
| `owner` | ownerStamp pass-through, default `':golden'` | RESERVED. The framework MUST accept it and pass it through unchanged; a bundle MAY read it. Both reference bundles read it off the argument object and do not otherwise consult it. `[code fact]` `forger.js:24`, `:672`; `forgeCeds.js:887`, `forgeEdfi.js:114`. **Ruling:** the seam is sacred; removing a seam argument is graphBuilder's change, not ours (`RULINGS-supervisor-forgeProfile.md`) |
| `embedNodeLimit` | embed only the first N nodes (spend bound) | MUST be honored when present. `[code fact]` `forger.js:39`, `:675` |
| `skipEmbedding` | `!vectorize` | MUST be honored: when true the bundle MUST make no embedding call and MUST report `embedCallCount: 0`. `[code fact]` `forgeCeds.js:931-934`, `forgeEdfi.js:235-238`, `forgeSif.js:796-799`, `forgePesc260805.js:756-759` |

- `forge` MUST be arity 2 — one named-argument object plus the callback. `[code fact]`
  `interfaces.js:237-238`. `[code fact]` Under the framework a fifth key is REFUSED by name
  (`lib/forge-framework/forge-framework.js:60` fixes `SEAM_ARGUMENT_NAME_LIST` to the four names;
  `:389-394` refuses any other; twin-proven by `test-gSeam.js` conjunct `fifthKeyRefused`). SIF's former
  fifth argument `resolutionMapPath` is gone — `forgeSif.js` has been framework wiring since 343d82e
  (hub-kit-role Phase 3) and destructures nothing. Its parser still reads a SECOND input,
  `refIdResolutionMap.tsv`, located by fixed name inside the snapshot directory
  (`forges/sif/lib/parser.js:519`) and NOT declared in `additionalSourceInputList`
  (`forges/sif/lib/sifForgeDeclaration.js:83`) — recorded as §13.1 S3 (clause 2, OPEN; verified
  Lane B 2026-09-02, filed in `WORKORDER-standDownBacklog-090226.md` §5).
- `forge` MUST be error-first callback-shaped: `callback(errString, result)`, `''` on success. No
  Promise, no throw across the boundary. `[code fact]` `interfaces.js:14-15`; doctrine RT-8 (§5.5).
- A bundle MAY throw INSIDE `buildContractGraph` (its pure layer) and MUST contain that throw at the
  orchestration boundary, translating it into the callback error. This is the ONE sanctioned
  `try/catch` in a forge and it is an adapter, not control flow. `[code fact]` `forgeCeds.js:914-925`
  ("boundary containment, not control flow"); `forgeEdfi.js:199-231` ("the throw-to-callback ADAPTER,
  not control flow"); `forgeSif.js:773-792`; `forgePesc260805.js:641-753`. `[design]` Under the
  framework the adapter is the framework's; a forge author never writes `try`.
- When `skipEmbedding` is false and no embedder was injected, the bundle MUST refuse by name.
  `[code fact]` `forgePesc260805.js:575-582` ("silence is not consent to spend"); the other three would
  throw a TypeError on `null.embedTexts`. Today the forger cannot reach that case (`forger.js:766`,
  `:828`), so this is a defensive universal the framework owns.

### 2.3 forge() — the return

```
callback('', { nodes, edges, metadata, embedCallCount, standardKey, stableUriPropertyName })
```

`[code fact]` `interfaces.js:239-240`; `forgeCeds.js:952-959`, `forgeEdfi.js:256-265`,
`forgeSif.js:817-828`, `forgePesc260805.js:774-796`. Three of the four also return `stats`, and two
return a standard-specific report (`crosswalkMatchReport`, `syntheticMergeReport`); the forger reads
none of those. `[design]` A bundle MAY return additional keys; the forger ignores them.

- `nodes` and `edges` MUST be arrays. `[code fact]` `shape-forged-graph.js:43-45` refuses otherwise.
- Every node MUST carry `stableId`, `labels`, and `properties`, and `properties` MUST carry
  `_source`. `[code fact]` `shape-forged-graph.js:63-68` reads exactly these to mint
  `ref: { source: properties._source, id: stableId }`. `[code fact]` `lib/vocabulary/vocabulary.js:512-520`
  declares `_id`, `_source`, `name`, `role`, `searchText` universal.
- Every edge MUST carry `type`, `fromRef`, `toRef`, and MAY carry `properties`. `[code fact]`
  `shape-forged-graph.js:145-157`. `fromRef.id`/`toRef.id` MUST name member `stableId`s.
- Property values MAY be scalars; the shaper wraps every non-array into a one-element array
  (PG-JSON multi-valued form). `[code fact]` `shape-forged-graph.js:55-61`. A bundle MUST NOT
  rely on a scalar surviving to the graph as a scalar.
- A node that carries `properties.embedding` MUST ALSO carry `properties.embeddingModelVersion`,
  non-blank. `[code fact]` `shape-forged-graph.js:83-112`: the model is "CARRIED, never invented"; a
  missing one is refused by name because every content address is computed from it. Both are lifted
  out of `properties` to the top level of the shaped node (`:56-58`, `:78`, `:95`).
- Every vector in one return MUST have the same width, and that width MUST equal the ini-declared
  `embeddingDims`. `[code fact]` `shape-forged-graph.js:71-77`, `:114-143`. A ragged set or a
  width disagreement is refused, not written.
- `metadata` MUST carry the FOUR keys the forger reads: `version`, `snapshotKey`,
  `publishedVersion`, `versionSource` — the snapshot-provenance triple plus the version claim.
  `[code fact]` `forger.js:881`, `:925`, `:942-944` read exactly these off `forged.metadata`.
- `metadata.version` MUST be what the bundle READ, or the honest word `'unknown'`. It MUST NOT be
  empty, and it MUST NOT be the recipe's requested token. `[code fact]` `forger.js:362-372`
  (`resolveReportedVersion`) refuses an empty stamp: "an empty stamp is a bundle defect";
  `:44-50`, `:922-931`.
- `embedCallCount` MUST be a number: the count of embedding calls actually made. `[code fact]`
  `forger.js:835`, `:948`; `interfaces.js:67`. It is the spend meter and the proof that
  `skipEmbedding` was honored.
- `standardKey` MUST be the lowercase token matching the bundle directory. `[code fact]`
  `forgeCeds.js:71`, `:960`; `[doc fact]` `forges/README.md` ("`standardKey` is the lowercase token").
  `[code fact]` The bundle's returned `standardKey` is read by NOTHING today — the block header's
  `standardKey` is the recipe token (`build.js:1475`) — so this MUST has no mechanical enforcement; the
  framework SHOULD refuse a mismatch between the returned token and the bundle directory by name.
- `stableUriPropertyName` MUST name the node property that carries the durable resolution key.
  `[code fact]` `forger.js:956` carries it to the report; `apps/graph-builder/lib/build.js:1487-1488`
  writes it into the block header as both `stableUriPropertyName` and `resolutionKey`. A wrong value
  here mis-keys every downstream resolution.

### 2.4 bundleVersion honesty — what the forger will not do for a bundle

- The forger MUST NOT lend a bundle the recipe's version token. `bundleVersion` (what the bundle
  stamped) and `requestedVersion` (what the recipe asked) are two provenance claims and are reported
  in two fields. `[code fact]` `forger.js:288-302`, `:362-389`, `:932-936`. A bundle that stamps
  nothing is refused rather than lent the token, and the hub fold refuses on the same reading so a
  placeholder can never reach a content address (`:527-533`, `:568-573`).
- The forger MUST NOT touch a graph. It resolves, wires, runs, translates. `[code fact]`
  `forger.js:10-14`; `interfaces.js:71-78`.
- The forger MUST NOT construct an embedder or read the Voyage ini unless `vectorize` is the boolean
  `true`. `[code fact]` `forger.js:680-710`, `:780`. `vectorize` is REQUIRED with NO DEFAULT and a
  string is refused as loudly as an absence.

**WHY the two version fields.** `metadata.version || version` once collapsed them, so a bundle that
stamped nothing reported the recipe's token as though it had read it, and no trace survived. Base
nodes carry the real version and the hub folds it into every address; a placeholder there is the
golden-diff defect of 2026-07-24. `[code fact]` `forger.js:294-299`, `:527-533`.

### 2.5 Engine shape (what the seam produces)

The framework's obligation ends at the bundle's return; the forger's `shapeForgedGraph` produces
engine shape. It is stated here because a bundle author must know what their return becomes.

```
{ nodes: [{ ref: {source, id}, labels, stableId, properties: {k: [v]}, embedding?, embeddingModelVersion? }],
  edges: [{ type, fromRef, toRef, properties: {k: [v]} }],
  embeddingDims: <n> | null }
```

`[code fact]` `shape-forged-graph.js:63-69`, `:78`, `:95`, `:151-156`, `:161`. `embeddingDims` is
`null` when nothing was embedded, which the engine reads as "no vector index" (`:159-161`). Vectors
are narrowed to float32 on purpose so removing the old serialization round trip changed no stored
value (`:27-32`, `:40`). Nothing in the four forges does this translation — it is already shared.

---

## 3. The descriptor

The descriptor is the bundle's registration. There is no other. `[code fact]` `forger.js:153-154`
("discovery pattern, not a registry"); `:178-179` ("THE BUNDLE IS ITS OWN REGISTRATION. The central
standard-registry was deleted").

### 3.1 What it MUST declare

| key | force | what it is | enforced |
|---|---|---|---|
| `[parserDescriptor]` section header | MUST | the ONE section the reader consults | `[code fact]` `forger.js:186-196` refuses an absent section by name, and `:197-205` an empty one |
| `standardName` | MUST, non-blank | the name the standard is CALLED — reports, block headers; used verbatim, never lowercased; equals the `_source` value every node carries. NOTE the two meanings in the tree today: the DESCRIPTOR `standardName` is the short source token (`SIF`, `EdFi`) while the ROOT node's `standardName` PROPERTY is the in-code DISPLAY string (`SIF Implementation Specification`, `Ed-Fi Data Standard`; `forgeSif.js:61-62`, `forgeEdfiContractGraph.js:58-59`, `forgePesc260805.js:56-57,199`; CEDS `forgeCeds.js:481`). Renaming the root property (to `standardDisplayName`) is NOT this order's — noted only. Also `[design]` `standardName` MUST be UNIQUE among enabled bundles, enforced by the framework/roster by name (Author B's A3 holding) | `[code fact]` `forger.js:217-230` refuses absent or blank; the reader trims but never substitutes the directory token. `[code fact]` `forgeSif.js:61`, `forges/edfi/lib/forgeEdfiContractGraph.js:58` bind `STANDARD_SOURCE === standardName` |
| `entryModule` | MUST | the entry module file, relative to the bundle root | `[code fact]` `forger.js:206-210` |
| `defaultSnapshot` | MUST when the bundle carries source; SHOULD in every case | the pin naming ONE directory under `assets/standardSourceData/`; matched numerically against directory names, resolved to the canonical name | `[code fact]` `forger.js:242-260`: zero or more-than-one match is refused by name. `[code fact]` `round-trip-stage.js:231-241`: a declared validator with no pin is refused ("a validator with no answer key has nothing to diff against") |
| `sourceFile` | MAY | the ONE file inside the snapshot a file-bound parser reads; ABSENT for a directory-source parser, which is handed the snapshot directory itself | `[code fact]` `forger.js:262-269` |
| `roundTripValidator` | MUST (§8.1) | the validator entry file, verbatim | `[code fact]` `forger.js:280-284` reads it; `round-trip-stage.js:197-222` refuses blank and refuses declared-but-missing |
| `displayName` | SHOULD | the human name | `[code fact]` NOT read by `forger.js` or anything under `apps/graph-builder/lib/` (grep, zero hits); documentation for readers of the file. Every forge stamps its OWN in-code `STANDARD_DISPLAY` string on the root, which differs from BOTH descriptor keys in three of four forges (SIF root `'SIF Implementation Specification'` vs descriptor `SIF`; `forgeSif.js:62`, `forgeEdfiContractGraph.js:59`, `forgePesc260805.js:57`) — so the root's name text is forge-declared DATA today, never derived from the descriptor, and a framework that built the root from the descriptor would change three block ids (F2 forge-implementer, rulings addendum). `[design]` A bundle SHOULD carry it |

**WHY the descriptor is the whole registration.** A central registry is a second place a standard can
be true or false; two places disagree eventually and the disagreement is silent. With the bundle as
its own registration, absence of a descriptor is absence of a forge, and a forge that is present is
discoverable with no per-standard knowledge. `[code fact]` `forger.js:158-176` composes the list of
known forges by the presence of the descriptor and nothing else, so `forges/README.md` and a bridge
directory can sit in `forges/` without being mistaken for standards.

### 3.2 The section-header trap

The ini reader DISCARDS sectionless keys. A missing or mistyped `[parserDescriptor]` header makes
every key in the file invisible at once, and the failure would otherwise present as "no
entryModule" against a file that plainly contains one. `[code fact]` `forger.js:178-196`; the code
comment records both the mechanism and the disguise it used to wear (`.parserDescriptor || {}`
"used to let it walk on as though it were"). Every one of the four descriptors carries this warning in
its own comment block. `[code fact]` `forges/{ceds,edfi,sif}/parserDescriptor.ini:3-4`,
`forges/pesc260805/parserDescriptor.ini:2-4`.

- A descriptor MUST carry the `[parserDescriptor]` header as its first non-comment line.
- A reader of the descriptor MUST refuse an absent section by name and MUST NOT read a missing key
  as an empty registration. `[code fact]` `forger.js:186-205`.

### 3.3 Declared, not sniffed

Every capability the builder needs to know about a bundle is DECLARED in the descriptor. Nothing is
discovered by looking for a file. `[code fact]` `round-trip-stage.js:11-13` ("declared, not sniffed
— the bundle IS its own registration, exactly as it is for the forge roster"); doctrine RT-13.1.

- A bundle MUST declare its round-trip validator by file name; the stage MUST NOT look for
  `roundTripValidator.js` on its own. `[code fact]` `round-trip-stage.js:197-204` classifies an
  undeclared validator as `absent`, whether or not the file exists.
- A DECLARED value that names a file that does not exist, does not load, throws at construction, or
  exports no `validate` MUST be refused by name on EVERY build, stage on or off — never downgraded
  to absent. `[code fact]` `round-trip-stage.js:15-19`, `:120-153`, `:214-222`.
- A declared-but-BLANK value is neither a declaration nor an absence and MUST be refused by name.
  `[code fact]` `round-trip-stage.js:206-212`.

**WHY.** Declaration makes absence a visible state instead of an accident of the filesystem. A stage
that sniffs would silently stop checking the day someone renamed the file; a stage that reads a
declaration fails loudly instead. `[doc fact]` doctrine §7.1.

### 3.4 The pin

`defaultSnapshot` is an explicit pin. Dropping a new snapshot directory changes NOTHING until the pin
is deliberately flipped. `[code fact]` all four descriptors say so in their own words
(`ceds:30`, `edfi:20-21`, `pesc260805:42-45`, `sif:19`); doctrine RT-12 (§9).

- A bundle MUST NOT resolve its source by "the newest directory" or any rule other than the pin.
- When the pin flips, the round-trip verdict against the new snapshot MUST be run before anything
  downstream consumes it. `[design]` doctrine §9; the diff between the two re-emissions is the
  changelog.

### 3.5 The in-code constants that belong beside the descriptor

`[code fact]` Every forge repeats a set of constants that are descriptor-shaped data: `STANDARD_KEY`,
`STANDARD_SOURCE` (`=== standardName`), `STANDARD_DISPLAY`, `STABLE_URI_PROPERTY_NAME`,
`ROOT_STABLE_ID`, `parserVersion`, `sourceFormat`, the `mappingInstruction` values, the per-standard
label prefix (`Ceds*`, `Edfi*`, `Sif*`, `Pesc*`) — `forgeCeds.js:71-72,109`,
`forgeEdfiContractGraph.js:57-61`, `forgeSif.js:60-63,196`, `forgePesc260805.js:53-59` (Author A D12).
CEDS uses the literal `'CEDS'` where its constant belongs (`forgeCeds.js:226`, `:454-455`, `:473`).
`[design]` Under the framework these are ONE declared object (§6, H1); a forge MUST NOT scatter them
as literals.

---

## 4. The pipeline every forge runs

`[code fact]` All four forges are the same machine wearing four costumes (Author A §0, §1). `forge()`
is a `taskListPlus`/`pipeRunner` chain of exactly three kinds of step — **acquire+parse** (I/O,
callback-shaped) → **shape** (pure, synchronous, throws on refusal, wrapped in the ONE sanctioned
adapter of §2.2) → **embed** (batched, skippable) — then the return of §2.3. This section states the
pipeline as MUSTs where it is common, and records for each step Author A's verdict: **IDENTICAL**
(same code modulo names), **DRIFTED** (same job, copy-pasted, diverged), or **PER-STANDARD**
(legitimately different). Everything IDENTICAL or DRIFTED is framework territory.

### 4.1 Source acquisition — DRIFTED

- A forge MUST read exactly the `sourcePath` it is handed (§2.2).
- A forge MUST verify the source bytes it consumes against the snapshot's `SHA256SUMS` and MUST refuse
  a missing, unlisted, or mismatched file by name (RT-3, §7). `[code fact]` EDFI verifies every loaded
  file at consumption (`forges/edfi/lib/metaEdSourceLoader.js:37,103-106,195,208`; same discipline in
  `descriptorCodeValueLoader.js`, `crosswalkCarrier.js`); SIF verifies over the source bytes
  (`forges/sif/lib/parser.js:423-446`); CEDS and PESC verify ONLY inside the round-trip validator,
  which runs only on a stage-ON build (`forges/ceds/roundTripValidator.js:99,117`;
  `forges/pesc260805/roundTripValidator.js:224-259`; PESC computes each file's sha256 as IDENTITY, not
  as verification, `forges/pesc260805/lib/parser.js:513`).
- `[design]` Verification is a pure function of `(snapshotDirPath, SHA256SUMS)` with no
  standard-specific content: framework territory. It is the SAME job as the validator's snapshot
  intake (§8.6, R1); one module MUST serve both call sites.

**WHY at consumption and not only in the validator.** A forge that builds a block from drifted bytes
has already minted a wrong content address by the time a validator notices — and the validator only
runs when the stage is on.

### 4.2 Parse — PER-STANDARD content, DRIFTED signature

`[code fact]` Four parsers, three calling conventions and three shapes of "the parsed thing":
`parseCeds({ sourcePath, xLog }, cb)` → `{ entities, maps, metadata }` (`forges/ceds/lib/parser.js:433,621-637`);
EDFI's THREE loaders `parseMetaEdSnapshot({ snapshotPath, xLog }, cb)`,
`loadDescriptorCodeValues({ snapshotPath }, cb)`, `loadAuthoredCrosswalk({ snapshotPath }, cb)`
(`forgeEdfi.js:117-168`); `parseSif(sourcePath, { resolutionMapPath }, cb)` — POSITIONAL first argument
(`forges/sif/lib/parser.js:8,488,941-944`); `parsePescCorpus({ sourcePath }, cb)` → `{ artifacts, parseAudit }`
(`forges/pesc260805/lib/parser.js:27-28`).

- A parser MUST be error-first callback-shaped and MUST take ONE named-argument object. `[design]`
  The house form is `parse({ sourcePath, xLog }, callback(errString, parsed))`; SIF's positional form
  is the outlier (§13).
- The parsed model is opaque to the framework EXCEPT that the forge MUST be able to yield from it
  `metadata.{ version, versionSource?, sourceFormat, sourceFiles, sourceUrl }` (§10).
- A parser MAY be a list of loaders (EDFI's three checksum-verified inputs); the framework MUST NOT
  force a multi-input standard to fold its loaders into one function to fit a signature. `[design]`
- A parser MUST count every formerly-silent path into a `parseAudit`, threaded onto `stats` and
  digest-excluded. `[code fact]` `forgeSif.js:821-824`, `forgePesc260805.js:107`, EDFI's `census`
  objects. The content is per-standard; the shape is common.

### 4.3 Normalize — DRIFTED, with a semantic difference already produced

`[code fact]` Three near-identical implementations of "pull the last digit run out of a CEDS anchor
and pad it to `P######`" with the byte-identical regex `/(\d+)(?!.*\d)/`:
`forges/ceds/lib/normalize.js:30-65` (a `rolePrefixByKind` registry C/P/OS/OV);
`forges/sif/lib/normalize.js:73-101` (always P-prefixed); `forgeEdfiContractGraph.js:235-247`
(inlined, PLUS a `'000000'` no-mapping sentinel that returns `{ absent: true }`). Three
"is-this-stableId-clean" predicates that are one shape parameterised by prefix
(`ceds/normalize.js:74-76`, `sif/normalize.js:63-68`, `forgeEdfiContractGraph.js:216-221`); PESC has
none. **The drift has already produced a semantic difference: for the input `'000000'` EDFI returns
absent and SIF would mint `P000000` as data.**

- `[design]` The framework MUST own ONE `normalizeCedsAnchor({ rawValue, kind })` and ONE
  `isCleanStableId({ stableId, standardKey })`; a "means-absent" sentinel list is a per-standard
  PARAMETER declared by the forge, never a per-standard copy.

### 4.4 Shape the contract graph — PER-STANDARD walk, COMMON scaffolding

The emission walk is where each forge is longest and where the per-standard hook genuinely lives
(§6, H3). The scaffolding inside it is common to all four (Author A §1.4, D8-D12, D17-D25) and
under the framework a forge author CALLS it and never writes it:

1. `makeNode({...})` — stamps the universal property set (`_id`, `_source`, `name`, `role`,
   `searchText`, `[stableUriPropertyName]: stableId`, `parentId`, `depth`, `path`, `crossRefs`) and the
   label triple `[ForgedNode, <PerStandardLabel>, <DmeRole>]`. `[code fact]` `forgeCeds.js:155-261`,
   `forgeEdfiContractGraph.js:385-424`, `forgeSif.js:341-364`, `forgePesc260805.js:124-157`;
   `vocabulary.js:512-520`.
2. `addEdge(type, from, to, ...)` — stamps `provenanceTier: 'structural'`; refuses a dangling
   endpoint (§4.4 item 6). `[code fact]` `forgeCeds.js:451-458`, `forgeEdfiContractGraph.js:353-382`,
   `forgeSif.js:327-338`, `forgePesc260805.js:162-179`.
3. Emission of the ONE `DmeStandardRoot` with the provenance block (§10.4). `[code fact]`
   `forgeCeds.js:462-500`, `forgeEdfiContractGraph.js:455-495`, `forgeSif.js:366-404`,
   `forgePesc260805.js:182-209`.
4. Per-native-kind emission driven by a REGISTRY, not a switch and not hard-wired loops.
   `[code fact]` `forgeSif.js:129-137,140-148,153-165,168-174`; `forgeEdfiContractGraph.js:85-108,141-166`;
   `forgePesc260805.js:485-490` (a registry, but rebuilt inside a loop); CEDS drives emission with four
   explicit loops (`forgeCeds.js:504-803` — no registry).
5. Every edge type MUST come from `EDGE_TYPES` in the frozen vocabulary; a forge MUST NOT mint a bare
   string edge type. `[code fact]` `forgePesc260805.js:284,542` uses the literal `'DECLARES'`, which is
   not in `vocabulary.js:77-88` (§13).
6. An integrity pass: a duplicate `stableId` MUST be refused by name at mint time; a dangling edge
   endpoint MUST be refused by name. `[code fact]` `forgeEdfiContractGraph.js:336-345` (duplicate: "a
   silent overwrite is a silent merge"); dangling: `forgeEdfiContractGraph.js:1108-1113`,
   `forgeSif.js:679-683`, `forgePesc260805.js:163-167` (throws at once — but on a FALSY endpoint only, not
   on a non-member stableId; the membership check is missing); CEDS has NEITHER check —
   `addEdge` at `:451` pushes a partial edge, and duplicates collapse silently under the replay
   engine's MERGE key (`vocabulary.js:495`) (§13).
7. `finalizeStructuralContract({ nodes, edges })` MUST be the LAST call over the pure output — it derives
   `depth` from chain length, stamps `crossRefs: '[]'` where absent, and refuses ≠1 root, an unresolvable
   or wrong-referent `parentId`, and a `parentId` cycle. `[code fact]` `lib/structural-contract/structural-contract.js:72-76,108-160,147-189`;
   called by `forgeCeds.js:810`, `forgeSif.js:688`, `forgeEdfiContractGraph.js:1115`; **PESC does not call it**
   (`grep -ac finalizeStructuralContract forgePesc260805.js` → 0) and stamps its own `depth`
   arithmetically (§13). Three of four forges' hand-stamped `depth` values are DEAD inputs superseded by
   the finalizer; PESC's are LIVE because it skips it (Author A D21).
8. `finalizeSequence` MUST be called by every forge that can see element order. `[code fact]`
   `lib/sequence-contract/sequence-contract.js:11-13` names PESC (XSD `sequencePosition`,
   `forgePesc260805.js:327`) as the next caller; only SIF calls it (`forgeSif.js:634-639`) (§13).
9. `stats` — counts surfaced on status lines; a status line MUST NOT print `undefined` for a
   misspelled stat name. `[code fact]` PESC's `requiredStat` guard (`forgePesc260805.js:710-719`) is the
   form to lift.

Verdict: the walk and its registries are PER-STANDARD; items 1-9 are framework territory that four
forges built four times, and PESC's and CEDS's omissions prove they are unsafe to leave to each
author.

### 4.5 Identity — PER-STANDARD rule, DRIFTED discipline

See §5. The RULE that mints a stableId is per-standard; the DISCIPLINE (pure-of-source, clean-form
predicate, duplicate refusal, `_id` policy) is common and today drifts.

### 4.6 Search text — IDENTICAL by construction, DRIFTED element composition

- Every node that is searchable MUST get its `searchText` from the ONE shared builder
  `lib/search-text/build-search-text.js` (`buildSearchText(element)`; a role-keyed registry of segment
  composers `:49-82`; throws on unknown role or empty result `:111-127`; description is NEVER an input
  `:13,47`). `[code fact]` `forgeCeds.js:103,203,462`; `forgeEdfiContractGraph.js:268,399,455`;
  `forgeSif.js:194,342,367`; `forgePesc260805.js:85,146,193`.
- The ELEMENT each forge hands the builder is composed by a per-forge helper that has drifted:
  `searchTextElementFor({ role, name, owningName })` exists in SIF `:214-229` and EDFI
  `forgeEdfiContractGraph.js:272-297` as byte-equivalent if/else ladders; PESC inlines a ternary
  `:494-513`; CEDS composes it literally at each call site. `[design]` Framework territory: one
  role-keyed registry taking `{ role, name, owningName, standardSource }`.
- A node MAY declare itself NON-EMBEDDABLE, in which case it carries no `searchText` and is excluded
  from the embed pass. `[code fact]` CEDS alone does this, by omission plus a filter, for
  `DmeEditHistoryEntry`, `DmeRestriction`, `DmeVocabularyTerm` (`forgeCeds.js:284-286,335-336,392-393`,
  `:829-834`); nothing in the universal contract names it. `[design]` A framework concept — a declared
  per-node property or per-role list — not a CEDS one.

### 4.7 Embed — IDENTICAL modulo three real differences

`embedNodes({ nodes, nodeSubsetLimit }, callback)`: slice to `nodeSubsetLimit`, chunk by
`EMBED_BATCH_SIZE = 128` (four copies of the constant), serial recursion, `embedder.embedTexts({ texts }, cb)`,
stamp `properties.embedding = Array.from(vectors[i])`, mirror to `node.embedding`, stamp
`embeddingModelVersion` on BOTH the node and its properties, count `embedCallCount`. `[code fact]`
`forgeCeds.js:819-878`, `forgeEdfi.js:61-105`, `forgeSif.js:696-740`, `forgePesc260805.js:575-617`.
The three real differences: CEDS filters non-embeddable roles first; PESC refuses a null embedder by
name (§2.2); variable naming drifts (`bi/idx` vs `batchIndex/nodeIndex`).

- Framework territory, WHOLE. `[design]` Keep PESC's refusal, CEDS's exclusion as a per-node
  declaration, EDFI's compound names.

### 4.8 Provenance and version stamp — DRIFTED plus one omission

See §10. The shared `deriveVersionStamp` is called by three forges and NOT by PESC, which hand-builds
`metadata` with a `versionSource` value the shared module does not know (§13).

### 4.9 Return and engine shape — IDENTICAL seam, DRIFTED return surface

See §2.3 and §2.5. Framework territory.

### 4.10 The round-trip validator — half framework

See §8. Intake, bolt/reader, diff engine, verdict assembly, gates and twins are framework territory
built four times; the canonicalizer/emitter PAIR is per-standard.

---

## 5. Identity and determinism

A forge mints three handles on its nodes and MUST keep their jobs apart. This section restates the
Bridge Profile §2 for the forge side and adds the determinism obligations that make a block
reproducible.

### 5.1 stableId — identity

- Every node MUST carry a `stableId` that is UNIQUE within the bundle's output and DERIVED FROM THE
  SOURCE ALONE. `[code fact]` `vocabulary.js:493-495` names it the forged-node MERGE key;
  `forgeEdfiContractGraph.js:336-345` refuses a duplicate by name at mint time;
  `forges/ceds/README_identityRules.md` §3 ("Reproducible from the source alone. Forging twice yields
  identical ids … Anything incidental — a counter, a timestamp, a hash of run state — would make every
  rebuild look like a change").
- Where the source supplies an identity (a URI, a `dc:identifier`), the stableId SHOULD be that
  identity or a deterministic function of it. `[code fact]` `forgeCeds.js:195`
  (`stableId = rawEntity.uri`); `forges/sif/lib/normalize.js:56` (`sif:<kind>/<key>`);
  `forgeEdfiContractGraph.js:21-27` (`edfi:<constructType>/<name>`, `edfi:property/<owner>.<name>`);
  `forgePesc260805.js:16-25` (`<targetNamespace>#<kind>/<localName>[@<sha256:12>]` when contested).
- Where the source leaves a record anonymous, the stableId MUST be minted from owner + a
  source-recoverable position, never from a run counter. `[code fact]` `forgeCeds.js:292`, `:348`
  (`<ownerUri>#editHistory/<sequence>`, `#restriction/<sequence>`); `README_identityRules.md` §3
  ("`sequence` is FILE POSITION, never chronology"); `forgePesc260805.js:110-120` (`<parent>/el/<pos>:<name>`).
- Every forge MUST stamp `properties[stableUriPropertyName] = stableId` and MUST return that property
  name in the seam (§2.3). `[code fact]` `forgeCeds.js:72,243`; `forgeEdfiContractGraph.js:60,411`;
  `forgeSif.js:63,353`; `forgePesc260805.js:58,145`.
- `stableId` and `uri`, where the node has a `uri`, SHOULD be the same value; for hub cards they
  MUST be. `[code fact]` `forges/ceds/lib/cedsHubForge.js:92` ("stableId === uri ==="); Bridge
  Profile §2.1.
- A stableId MUST pass a clean-form predicate for its standard before it is minted (non-empty,
  correctly prefixed, no surrounding whitespace). `[code fact]` `forgeCeds.js:196-200`,
  `forgeEdfiContractGraph.js:223-231,395-398`, `forgeSif.js:200-211`; PESC has no predicate (§13).
- A forge HOOK MUST NOT set `_id`; the FRAMEWORK stamps `_id = stableId` (v1.0.2, keeping `REQUIRED_PROPERTIES.NODE` whole and the structural-contract "wrong referent" diagnostic alive) and the replay engine overwrites it anyway. `[doc fact]` (F2 architect GOLDEN_SIGNAL,
  rulings addendum 22:51) `replay-engine` `buildNodeRow` OVERWRITES `props._id` with `node.ref.id`
  (= stableId) and the harvest's `shapeNode` DROPS `_id` from block properties, so a forge-stamped
  `_id` can never reach block text; `cedsHubForge.js`'s own comment says "NO _id — the replay engine
  stamps it". `[code fact]` Today three forges set `_id === stableId` and CEDS sets
  `_id = ceds:<canonicalCedsId>` (`forgeCeds.js:108-109,225`; `forgeEdfiContractGraph.js:407`;
  `forgeSif.js:348`; `forgePesc260805.js:145`) — all four stamps are inert and the framework simply
  stops stamping.

### 5.2 canonicalKey — join key, not address

- A forge that emits a `canonicalKey` MUST treat it as a JOIN KEY: the way an outside standard names
  the thing, kind-prefixed by the forge (P-form, OV-form), NOT unique, and NEVER an address.
  `[code fact]` `vocabulary.js:534-538` ("canonicalKey is intentionally NON-unique … uniqueness is
  the composite (hubName, addressSignature)"); Bridge Profile §1 ("The prefix is minted by the
  forge; CEDS supplies the number. It is a join key, not an address"), §2.2.
- A forge MUST NOT build any single-valued map keyed on `canonicalKey`. Bridge Profile §2.2, §6.
- Uniqueness of a hub card is the composite `(hubName, addressSignature)`, and the signature is the
  ordered SHA-256 over exactly the declared field order. `[code fact]` `vocabulary.js:496-502`,
  `:640-649` (`ADDRESS_SIGNATURE_FIELD_ORDER`).
- `[code fact]` `canonicalKey` and the hub address slots are stamped by CEDS only
  (`forgeCeds.js:167-194,604-661`) — the hub is CEDS's job, not a forge step. The other three carry a
  `cedsId` CROSS-REFERENCE (a join key toward CEDS, §9), never a canonicalKey of their own.

### 5.3 The forbidden sources of nondeterminism

- A forge's `buildContractGraph` MUST be PURE: no I/O, no clock, no randomness, no process state.
  `[doc fact]` `forges/README.md` ("PURE, synchronous, and deterministic: same source in,
  byte-identical `{ nodes, edges }` out … No I/O, no clock, no randomness"); `forgeEdfi.js:25-27`;
  `forgeCeds.js:15-18`. `[code fact]` `grep -a` over `forges/*/forge*.js` and `forges/*/lib/*.js`
  (tests excluded) finds ZERO occurrences of `Date.now`, `new Date`, `Math.random`,
  `process.hrtime`.
- A forge MUST NOT stamp a runtime timestamp on any node, edge, or metadata field that reaches the
  block. `ingestedAt` is deliberately not stamped. `[code fact]` `forgeCeds.js:492-494`,
  `forgeSif.js:397-399`, `forgeEdfiContractGraph.js:489` say so in their root blocks; PESC never
  mentions `ingestedAt` and stamps no clock anywhere (grep, zero hits). `[design]` Bridge
  Profile §4.6 rules the same for `mapping_date`: "a runtime timestamp breaks deterministic replay,
  and replay determinism outranks this slot."
- A forge MUST NOT stamp anything derived from the embedding RESULT into a content-addressed
  property other than the vector itself and its model version. `[code fact]` the vector is
  addressed by `vectorIdForInput(embeddingModelVersion, searchText)` — a hash of the INPUT, so a
  block carries `embeddingRef` and the raw vector rides in a sidecar (`content-address.js:73-107`;
  `lib/replay/replay-block.js:188-194`, `:235`; `build.js:1444-1450`). This is what lets a
  vectorized block be deterministic across runs.
- A forge MUST NOT depend on iteration order of an unordered structure for anything that reaches
  the block. `[design]` `cedsHubForge.js:91-92` sorts by stableId before returning; the round-trip
  doctrine treats order as a modelled or unmodelled dimension, never an accident (§5.3, K3 (a)).
- A forge MUST NOT read `process.global` with a silent default. `[code fact]`
  `forgePesc260805.js:81-84` substitutes a no-op `status` logger when `process.global` is absent —
  a polyArch2 §6 violation in a forge otherwise scrupulous about it; the other three read it and let
  absence fail loudly (§13).

### 5.4 The five conjuncts of block determinism

A block id is the SHA-256 of the block TEXT. `[code fact]` `content-address.js:22`. So two runs
produce the same block when, and only when, they produce byte-identical block text. For a forge that
means ALL FIVE of:

1. Same pinned snapshot (the pin, §3.4).
2. Same `buildContractGraph` output — the purity rule (§5.3).
3. Same version stamp — the bundle's own reading, never the recipe token (§2.4).
4. Same embedding identity — the same `embeddingModelVersion` and the same `searchText`, because
   `embeddingRef` is a hash of those two. `[code fact]` `content-address.js:88-107`;
   `interfaces.js:249-251` ("embeddingModelVersion must match the addressing model version, or
   every block id changes").
5. Same header material — `stableUriPropertyName`, `embeddingDims`, `embeddingModelVersion` are
   CARRIED from the forge report into the header, never invented. `[code fact]`
   `build.js:1473-1490`.

The reset proved the property three times on the four-forge manifest
(`97c618c2…`, baseline / post-demolition / golden). `[doc fact]` `DEVLOG-rootAndBranch.md` Phase 5
handoff. A forge re-implemented on the framework is correct when it reproduces its block id — for
Ed-Fi `aea6d8df…` — and a clean round trip. `[doc fact]` `PLAN-forgeFramework-v1.md`. **Identical
block id is the acceptance test** (§15).

### 5.5 Engine-side canonicalization — what the forge does NOT have to guarantee

Forge OUTPUT ORDER does not reach block text, because the harvest canonicalizes it — this is why the
five conjuncts above are sufficient and there is no sixth "emit in a stable order" obligation.

- `[code fact]` The harvest reads nodes `ORDER BY n.stableId` and edges
  `ORDER BY fromStableId, type, toStableId` (`lib/replay/replay-engine.js:709`, `:739`, `:813`, `:840`).
- `[code fact]` `canonicalProperties` sorts property-map keys and node labels before serialization
  (`lib/replay/replay-block.js:117-128`, `:182`, `:187`, `:214`).
- `[code fact]` JSON-STRINGIFIED VALUES (`crossRefs`, `mappingInstruction`) carry their internal key
  order as bytes even though the harvest sorts property keys; a framework that re-serializes those
  values MUST preserve their key order (F2 forge-implementer QUIET_FLAME, rulings addendum).
- **The one way order becomes load-bearing: MERGE collisions.** `[code fact]` `mergeNodes` is
  `MERGE (n:ForgedNode {stableId}) SET n += row.props` (`replay-engine.js:203-205`) and `mergeEdges` is
  `MERGE (from)-[r:TYPE]->(to) SET r += e.props` (`replay-engine.js:288`), so a duplicate `stableId` or
  a duplicate `(from, type, to)` triple collapses LAST-WRITER-WINS on overlapping properties, and then
  emission order decides the bytes. This is the silent-merge hazard §4.4 item 6 names for nodes; it
  applies to EDGES too. **Ruling:** the framework passes hook emission order through UNTOUCHED and
  ships a COLLISION-CENSUS gate — duplicate stableIds and duplicate edge triples counted; nonzero
  refused by name once a forge's census reads zero (risk-tester GARDEN_HAVEN, rulings addendum).
- `[inferred]` A residual candidate: `metaEdSourceLoader.js:56` sorts directory entries with
  `localeCompare` (ICU-dependent); if the source's file order ever reached a stableId or a stamped
  position, the sort would be a platform dependency. Not observed to matter; recorded.
- The §5.3 MUST NOT (no dependence on unordered iteration) stays: it is stricter than the mechanism
  requires, and stricter is fine.

---

## 6. The per-standard hooks

This section states the MINIMUM a forge author MUST supply — and nothing more. It is derived from
what the four forges ACTUALLY vary (Author A §3). **The target signatures of H2, H3 and H4 are
`[design — F2 defines]`:** today the four forges disagree on every one of them, and the shapes listed
below are FACTS about the four, not a uniform contract a framework could call verbatim (the review
found that a framework calling H2 as stated flat would run one of four forges). Everything not listed
here is framework territory (§4).

### H1 — the descriptor (data, not code)

`[code fact]` `parserDescriptor.ini` `[parserDescriptor]`: `standardName`, `displayName`,
`entryModule`, `defaultSnapshot`, optional `sourceFile`, `roundTripValidator` (§3), PLUS the in-code
constants of §3.5 (`standardKey`, `standardSource === standardName`, `standardDisplay`,
`stableUriPropertyName`, `rootStableId`, `parserVersion`, `sourceFormat`, `mappingInstruction`
values, the per-standard label prefix, the list of non-embeddable roles). `[design]` Under the
framework: ONE declared object. A forge author writes data here, not code.

### H2 — parse (source → native model) — `[design — F2 defines]`

- Target (F2 defines): a callback-shaped parse of the pinned source yielding an opaque `parsed` from
  which the forge can produce `metadata.{ version, versionSource?, sourceFormat, sourceFiles,
  sourceUrl }`.
- Today's FOUR shapes `[code fact]`: `parseCeds({ sourcePath, xLog }, cb)` →
  `{ entities, maps, metadata }` (`forges/ceds/lib/parser.js:433,621-637`);
  `parseSif(sourcePath, { resolutionMapPath }, cb)` — POSITIONAL — → `{ nodes, metadata, parseAudit }`
  (`forges/sif/lib/parser.js:8,488,941-944`); `parsePescCorpus({ sourcePath }, cb)` →
  `{ artifacts, parseAudit }`, metadata hand-built later (`forges/pesc260805/lib/parser.js:27-28`;
  `forgePesc260805.js:777-787`); EDFI: THREE loaders — `parseMetaEdSnapshot({ snapshotPath, xLog }, cb)`,
  `loadDescriptorCodeValues({ snapshotPath }, cb)`, `loadAuthoredCrosswalk({ snapshotPath }, cb)` — whose
  three results are folded into ONE `metadata` by the orchestrator (`forgeEdfi.js:117-197`, from
  `metaEdModel.metadata.sourceInputs`).
- THE MULTI-LOADER CASE: F2 MUST specify a form in which several loaders yield one `parsed` +
  one `metadata` (Ed-Fi's three), rather than force a multi-input standard into one function.
- Owns: `parseAudit` (per-standard content, common shape). Does NOT own checksum verification —
  framework (§4.1) — but MUST consume only verified bytes.

### H3 — the emission walk (native model → nodes/edges via framework helpers) — `[design — F2 defines]`

- Target (F2 defines): `parsed` + `metadata` + the framework's `makeNode` / `addEdge` / `stats`
  (§4.4 items 1-3, 9). Today `makeNode` and `addEdge` are per-forge CLOSURES with FOUR different
  signatures `[code fact]`: CEDS `makeNode({...})` spreading `rawEntity.annotations` first
  (`forgeCeds.js:155-261`) and `addEdge(type, fromStableId, toStableId)` (`:451-458`); EDFI
  `makeNode` refusing unclean/duplicate ids and `addEdge(type, from, to, edgeProperties)` validating
  the properties type (`forgeEdfiContractGraph.js:353-424`); SIF `makeNode` coercing `name` and
  `addEdge` recording dangling for a terminal refusal (`forgeSif.js:327-364`); PESC `makeNode` with
  `description || ''` and `addEdge(type, from, to, { pescTier })` throwing at once
  (`forgePesc260805.js:124-179`). The framework's target signature is F2's to define; this Profile
  fixes only what each MUST do (§4.4).
- Output: `{ nodes, edges, stats, ...standardSpecificReports }`. `[code fact]`
  `forgeEdfiContractGraph.js:1116` (`crosswalkMatchReport`); `forgePesc260805.js:675`
  (`syntheticMergeReport`).
- Inside it, the per-standard DATA the walk is driven by, each of which MUST be a declared registry
  or closed table, not a switch and not hard-wired loops:
  - **role registry**: native kind → `{ role, perStandardLabel, nameField | naturalKey,
    ownershipEdgeType }`. `[code fact]` `forgeEdfiContractGraph.js:85-108`
    (`CONSTRUCT_ROLE_REGISTRY` — the shape to keep); `forgeSif.js:129-137,140-148,168-174`;
    `forgePesc260805.js:485-490`.
  - **edge translation registry**: native edge / property type → canonical `EDGE_TYPES.*`.
    `[code fact]` `forgeSif.js:153-165`; `forgeEdfiContractGraph.js:141-181`.
  - **identity rule**: `stableIdFor(kind, naturalKey)` — a pure function of the source (§5.1), handling
    the standard's own collision hazard explicitly (PESC's contested-namespace `@sha12`
    `forgePesc260805.js:110-120,215-218`; EDFI's owner-type prefix on property ids
    `forgeEdfiContractGraph.js:24-26`; SIF's owner-scoped sequence groups `forgeSif.js:511-535`).
  - **carry lists**: which native scalars ride on the node WHEN PRESENT (RT-2). `[code fact]`
    `forgeEdfiContractGraph.js:184-201` (`CONSTRUCT_SCALAR_CARRY_LIST` — the shape to keep);
    `forgeSif.js:455-463`; `forgeCeds.js:582-602`.
  - **cross-ref rule**: which native column is the CEDS anchor and its "means-absent" sentinel list;
    normalization itself is framework (§4.3). `[code fact]` `forgeSif.js:65,434-452` (`'CEDS ID'`);
    `forgeEdfiContractGraph.js:62-63,955-1102` (`CEDSGlobalId`/`CEDSOptionCode`).
  - **derived facts** the standard permits, from a CLOSED table that REFUSES an unlisted value, with
    the derivation documented at the site. `[code fact]` `forgeSif.js:109-115`
    (`FIELD_CHARACTERISTICS_DERIVATION`), `:479-490`; PESC's derived/synthetic tiers
    (`lib/derivedTier.js`, `lib/syntheticTier.js`).
  - **sequence groups** for `finalizeSequence`, where the standard has element order. `[code fact]`
    `forgeSif.js:278-280,524-567,632-639`.
- The walk MUST expand every `DmeOptionSet`-role node's values into `DmeOptionValue` children joined
  by `HAS_VALUE`. `[code fact]` `forgeCeds.js:757-803`, `forgeEdfiContractGraph.js:669-` (`emitOptionValue`),
  `forgeSif.js:598-623` expand; PESC carries enumeration values as a JSON array on the derivation node
  (`forgePesc260805.js:418-419`) and does not. **Ruling:** the Profile MUSTs expansion; PESC migrates
  byte-identical first through a framework hook that allows its current behaviour, and its expansion is
  a SEPARATE deliberate compliance change with a new block id (§13).

### H4 — the round-trip canonicalizer/emitter PAIR (source ↔ statements) — `[design — F2 defines]`

Per §8.5. Target (F2 defines): two functions with a shared statement-Map contract:
`canonicalizeSource({ ...intake }, cb(err, { statements: Map, stats }))` and
`emitFromGraph({ reader }, cb(err, { statements: Map, stats } | { fault }))`. `[design]` The
SIF/PESC pattern — emit, then canonicalize the emission with the SAME canonicalizer
(`forges/sif/roundTripValidator.js:232-245`, `forges/pesc260805/roundTripValidator.js:516-532`) — is the
recommended shape, because both sides of the diff pass through one canonicalizer.
Today's real names and shapes `[code fact]`: CEDS `canonicalizeRdfText({ rdfText, sourceLabel }, cb)` +
`compileToFile({ reader, outPath }, cb)` (writes RDF/XML, unique); EDFI `reduceMetaEdSourceText` /
`reduceDescriptorXmlText` / `reduceCrosswalkCsvText` + `assembleStatementMap` + SYNCHRONOUS
`emitGraphStatements({ graphRows })`; SIF `statementsFromTsvText({ tsvText }, cb)` +
`compileFromReader({ reader }, cb)` + `statementsFromSifGraph({ sifGraph }, cb)` returning a `faultList`;
PESC `canonicalizeXsdText` / `canonicalizeXsdFileSet({ fileList }, cb)` + `emitFromReader({ reader }, cb)`
(Author A §6.5).

### H5 — tests and twins

Per §11. The per-standard part is: refusal twins for the standard's own refusals (§7.2), identity
traps for the standard's own collision hazard, per-standard round-trip twins, and the certificate's
long argument. The twin sweep, the determinism gate, the gate evaluator and the common twins are the
same test in four vocabularies and are framework territory.

---

## 7. Refusal doctrine

### 7.1 The rules

- **Refuse by name.** A missing, corrupt, or checksum-failing source MUST stop the forge with an
  error stating what is missing and where the acquisition recipe lives. Never a skip, never another
  copy. `[doc fact]` doctrine RT-3 (§4).
- **Absent is absent.** The forge MUST emit exactly what the source states: no placeholder
  descriptions, no defaulted values, no `a || b || c` identity chains, no `''`-as-value. A field the
  source does not state is a field the block does not carry. `[doc fact]` doctrine RT-2 (§4);
  `lib/snapshot-provenance/snapshot-provenance.js:16-18`, `:104-109` stamps `'unknown'` honestly rather
  than fabricating a version. `[code fact]` `forgeEdfiContractGraph.js:30-31,416` states and obeys it;
  `forgePesc260805.js:142-143` stamps `description` and `documentation` with `|| ''`, and SIF/PESC coerce
  `name` to `''` when null (`forgeSif.js:349`, `forgePesc260805.js:141`) (§13). **`name` is OPTIONAL at mint (v1.0.2):** a node whose source states no label carries NO `name` property — never `''`, never a synthesised label (CEDS's four foreign vocabulary declarations, `forgeCeds.js:413`, are the proof: synthesising a label made the round-trip diff report four INVENTED statements); the framework's compliance report COUNTS nameless nodes per role.
- **No silent substitution.** A reader that reads through alternative field names, a resolver
  that guesses a path, a default that stands behind a settable key — each is banned by name.
  `[code fact]` `forger.js:96-108` (the Voyage pointer: "There is NO third arm"); `:141-146` ("A
  credential pointer that names no file is an INVALID value, not an occasion to look somewhere
  else"); `round-trip-stage.js:38-40`; doctrine A6.
- **A supplied value MUST be the right type; coercion is a substitution.** `[code fact]`
  `forger.js:701-710` (`vectorize` as a string is refused "because 'false' is truthy and would have
  spent your money"); `:738-749` (`deriveHub`); `sequence-contract.js:106-113` (`orderSemantics`
  outside its two values is refused: "a caller that cannot verify schema-ordered semantics must say
  'document', never guess 'normative'").
- **A required input MUST NOT have a do-nothing default.** `[code fact]`
  `snapshot-provenance.js:66-82` (`warn` was once `() => {}`; now a missing `warn` throws: "there is
  no do-nothing default to swallow them").
- **Structural violations MUST be refused, not repaired.** `[code fact]`
  `structural-contract.js:72-76` (not exactly one root), `:108-145` (a `parentId` that names an
  `_id` instead of a stableId, or nothing at all — the diagnostic distinguishes "wrong referent
  stamped" from "unresolvable"), `:156-160` (a parentId cycle); `sequence-contract.js:121-138` (a
  duplicate or unresolvable sibling member).
- **A refusal MUST name the fix, not the program.** `[code fact]` `forger.js:106-108` ("so the
  operator knows which line to fix rather than which program to read"); `:186-195` ("it must say
  what is missing and where it belongs").
- **A cheap refusal MUST precede a costly step.** The spend knob and the version token are checked
  before any bundle is resolved or any embedder constructed, "so a refusal can never itself cost
  anything." `[code fact]` `forger.js:689-690`, `:712-731`.

### 7.2 Which refusals are the framework's and which are the hook's

`[code fact]` Author A §4 enumerates every refuse-by-name the four forges perform. The COMMON ones —
found in ≥2 forges or universal by nature — are: unknown native kind / label / constructType;
unknown or untranslated native edge type; empty or unclean stableId; duplicate stableId; dangling
edge endpoint; unnormalizable CEDS anchor; empty `searchText` or unknown role (via `buildSearchText`);
structural-contract violations (via the finalizer); absent `warn` channel for the version stamp;
absent `sourcePath`; embedding requested with no embedder; embed batch failure surfaced with its
batch number; pure-builder throw translated to a forge-prefixed error string. `[design]` The
framework MUST make every one of these UNIVERSAL — a forge cannot omit them by forgetting.

The PER-STANDARD ones are refusals of malformed STANDARD CONTENT — EDFI's unknown reference family,
unresolvable model-internal reference, code-value XML naming an absent descriptor
(`forgeEdfiContractGraph.js:547-549,561-566,761-762,888-889`); SIF's `Characteristics` value outside
its closed table (`forgeSif.js:479-490`); PESC's unbound prefix and message→message import (parser).
`[design]` These stay in the hook. Refusal of malformed CONTRACT is the framework's; refusal of
malformed STANDARD content is the hook's.

**WHY.** A silently-skipped gate is indistinguishable from a passing one; a silently-substituted
source is indistinguishable from the real one; a coerced value is worse than an absent one, because
the caller who typed it believed it took effect. `[doc fact]` doctrine RT-3; `forger.js:685-687`.
The lexical rule follows from the engineering rule: the f-word for "quietly substitute another
value" is banned in new writing (code, comments, messages) because it names the mechanism this
doctrine forbids; say "alternative path", "recovery path", or "when X is absent" instead.

---

## 8. The round trip

Every forge MUST make a round trip: source → forge → block → load → materialized graph → re-emission
→ diff against the source. `[doc fact]` doctrine §1. The rules below are the parts a forge author
cannot leave to the campaign.

### 8.1 The validator MUST be declared

- A bundle MUST ship `roundTripValidator.js` at its root and MUST declare it in the descriptor as
  `roundTripValidator=roundTripValidator.js`. `[doc fact]` doctrine RT-1 (§3), RT-13.1 (§7.1);
  all four descriptors declare it (`ceds:29`, `edfi:19`, `pesc260805:41`, `sif:18`).
- `[design]` The doctrine's "if present" tolerance for undeclared validators (§7.3) has a mechanical
  trigger: the fleet-wide absent count reaching zero. With four bundles all declared, the fleet-wide
  count IS zero, and this Profile treats declaration as MANDATORY. Whether the stage default flips
  to failure is a separate, reviewed change the doctrine reserves; this Profile does not make it —
  it says a forge is non-compliant without a declaration (§14).
- The validator MUST expose the uniform contract:
  ```
  validate({ containerName, boltUrl, user, password, snapshotPath, outputPath }, (error, verdict) => …)
  ```
  `[code fact]` `round-trip-stage.js:490-498` calls exactly this; doctrine §7.5. Standard-specific
  options ride in the bundle's own config, never in the builder's call.
- The stage tolerates BOTH export styles — a bare factory or an already-applied one — by calling the
  export once if it is a function. `[code fact]` `round-trip-stage.js:120-157`. `[code fact]` CEDS, SIF,
  PESC export the applied stage; EDFI exports the bare one (`forges/edfi/roundTripValidator.js:478`).
  `[design]` A validator SHOULD export the applied stage; the stage's accommodation papered over a real
  drift.
- The validator MUST read the MATERIALIZED graph over bolt, scoped to its own `_source`, Layer 1
  only, roles and edge types named explicitly. `[doc fact]` doctrine RT-4 (§5.1).
- The validator MUST NOT contain or read source DATA; it may know its own output grammar and any
  constant proven uniform across the whole source. The source bytes enter once, as the answer key.
  `[doc fact]` doctrine RT-5 (§5.2).
- The validator MUST refuse an absent `outputPath`; a verdict MUST NOT be producible with nothing on
  disk. `[code fact]` `forges/ceds/roundTripValidator.js:332`, `sif:205`, `pesc260805:335` refuse;
  EDFI writes conditionally (`edfi:395`) (§13).

### 8.2 RT-13 — the builder invokes it

- The stage runs post-materialization; the verdict lands with the build outputs. `[code fact]`
  `round-trip-stage.js:28-32`; doctrine §7.2.
- The verdict MUST carry the five NORMATIVE fields under exactly these names: `roundTripClean`,
  `inventedTotal`, `lostTotal`, `contentGapTotal`, `explicitlyOmittedTotal`. A verdict lacking any of
  them is refused by name; the stage NEVER reads through an alternative-name chain. `[code fact]`
  `round-trip-stage.js:99-105` (declared as data), `:270-282`; doctrine A6 + A13.
- `roundTripClean` MUST equal `(contentGapTotal === 0 && inventedTotal === 0)`. `[code fact]`
  doctrine §5.3 (A13 reconciliation).
- The stage summary is written on EVERY build, stage on or off, and is the certification evidence
  `-goldEvalCheck` reads. `[code fact]` `round-trip-stage.js:53-55`.
- A verdict MUST self-check its own shape before it is written, refusing a missing required field and
  a NaN/Infinity count. `[code fact]` PESC's `verifyVerdictShape` driven by `REQUIRED_VERDICT_FIELD_LIST`
  (`forges/pesc260805/roundTripValidator.js:90-115,144-194`, called `:743`) is the only one; `[design]`
  framework territory: one verdict assembler with the five normative names as the required core and
  forge-declared extras allowed.

### 8.3 inventedTotal 0 fails the build; lostTotal is tolerated and logged

- `inventedTotal > 0` MUST fail the build, unconditionally. `[code fact]`
  `round-trip-stage.js:283-291`; doctrine §5.3 ("INVENTED must be 0 at all times, in every bundle,
  from the first run").
- `lostTotal > 0` MUST be tolerated and logged; it is the enrichment meter. `[code fact]`
  `round-trip-stage.js:34-36`; `forges/pesc260805/README_roundTripContract.md` "THE ASYMMETRY".
- Every LOST item MUST carry a `lostCategory` of `explicitlyOmitted` or `contentGap`, and
  `lostTotal` MUST count contentGap ALONE. `[doc fact]` doctrine A7/A13.
  **⚠ ANNOTATED 2026-09-02 (Lane B, WILD_VALLEY; ruling GRANITE_ECHO — annotate, do not silently
  reconcile).** `[artifact fact]` NO verdict opened carries a `lostCategory` key. The per-item entries in
  `report.lostDetailList` carry `subject`, `predicate`, `object`, **`bucketName`** (`'contentGap'`),
  `backlogLabel`, `located` — 349 of 349 in the Ed-Fi `-2` verdict of 2026-08-05
  (`dataStoresAttic/buildLogs/fourRoundTripNoBridges_20260805-050037/roundTrip/edfi/roundTripVerdict.json`)
  have no `lostCategory`. The SEMANTICS this bullet requires are present under the other name; the
  NAME this bullet requires was never provided. This line records both rather than rewriting the
  requirement to match the artifact. **Limitation, stated:** no current-generation lossy verdict exists
  (every 2026-08-31/09-01 run reports `lostTotal 0`, so every `lostDetailList` is empty); the current
  field names on a lossy row are UNVERIFIED and the evidence is the 08-05 attic artifact only.
- No percentage participates in acceptance. `[doc fact]` `forges/ceds/README_roundTripContract.md`
  ("A tampered emission carrying four fabricated statements still reported 71.936%").
- An invention MUST be fixed in phase the moment it is found; a loss goes to the named backlog.
  A mechanism that could MANUFACTURE an invention to reduce LOST is forbidden. `[code fact]`
  doctrine §5.3, disposition rule.

**WHY the asymmetry.** An invented statement is a claim about the standard the standard never made
— a lie the graph tells. A lost statement is a truth the graph fails to tell. Coverage elsewhere does
not excuse a fabrication. `[doc fact]` `pesc260805/README_roundTripContract.md`.

### 8.4 semanticValidationLimit MUST be stated — every forge

- The verdict MUST carry `semanticValidationLimit`: a paragraph, in the artifact, saying what the
  round trip models and does not model. `[code fact]` all four validators declare it
  (`forges/ceds/roundTripValidator.js:458`, `edfi:309`, `sif:360`, `pesc260805:636`);
  `round-trip-stage.js:305-324` carries it into the stage summary and, when a bundle omits it,
  writes a loud "NONE DECLARED BY THIS BUNDLE" marker rather than dropping the key.
- **Ruling:** MUST for EVERY forge, new or migrated. The round-trip STAGE's documented-optional
  treatment (`round-trip-stage.js:313-317`) stays as is for this order; the framework's validator
  harness REFUSES a validator that declares no limit. `[design]` The stage's flip is the doctrine's
  reviewed-change rule; the framework can enforce without touching the stage.
- `[code fact]` No validator today refuses an undeclared or unlimited `semanticValidationLimit`; it is
  free text, unchecked; only the stage marks its absence (Author A §6.6). The framework harness closes
  that gap.

**WHY (the Phase 4 lesson).** `lostTotal: 0` means zero loss IN THE DIMENSIONS THE COMPARATOR MODELS.
A dimension neither side models reports zero on both sides and reads as fidelity. Until 2026-08-15 the
CEDS bundle — the fleet's most-measured — declared no limit, so its "clean" was a claim whose scope
lived only in code a promoter would never open. `[doc fact]` `DEVLOG-rootAndBranch.md` Phase 4 K3;
`forges/README_ValidationCertificateStandard.md` ("a declared limit travels with the number into
every payload; a derived one drifts the moment someone edits the module"). "Semantically clean" MUST
NEVER be reported as "identical." `[doc fact]` `pesc260805/README_roundTripContract.md` R-VAL-7. A
`lostTotal: 0` with no stated limit is the zero easiest to over-read.

### 8.5 The canonicalizer/emitter pair contract

`[code fact]` The per-standard piece is a PAIR held apart on purpose so the instrument cannot prove
the forge agrees with itself: a SOURCE-side canonicalizer and a GRAPH-side compiler/emitter
(`forges/ceds/roundTripValidator.js:462-468`, `edfi:312-315`, `sif:363-367`).

- The canonicalizer MUST turn source text into a `Map<statementKey, statement>` with `stats`, discarding
  the dimensions the limit says it does not model (order, whitespace, prefix spelling) and modelling the
  ones it does. `[code fact]` `forges/ceds/lib/roundTripCanonical.js:260` (key =
  `(subject, predicate, objectKind, object, datatype, lang)`, order discarded `:197-205`);
  `forges/edfi/lib/roundTripMetaEdCanonical.js:341,1110,1265,1297`; `forges/sif/lib/roundTripSifCanonical.js:201`;
  `forges/pesc260805/lib/roundTripXsdCanonical.js:308,1085`.
- The emitter MUST re-emit statements from a `reader` over the materialized graph, error-first
  callback-shaped, returning `{ statements, stats } | { fault }`; an emission fault is FATAL.
  `[code fact]` `forges/sif/lib/roundTripSifCompiler.js:380`; `forges/pesc260805/lib/roundTripSourceEmitter.js:1250`;
  fault gates `ceds:366-377`, `edfi:210-213`, `sif:249-259`, `pesc260805:561-571`.
- `[design]` Two existing shapes the framework MUST NOT generalise: EDFI's SYNCHRONOUS emitter
  (`forges/edfi/lib/roundTripEdfiCompiler.js:597` — violates RT-8 callback shape) and CEDS's
  write-an-RDF-file-then-reparse compiler (`forges/ceds/lib/roundTripCompiler.js:1207` — round-trips
  through disk for no reason the other three needed).
- The pair MUST agree on ONE headline vocabulary with the A13 categories in it. `[code fact]` Today
  four headline vocabularies exist and `lostTotal` is computed four ways (Author A §6.2, R2); CEDS alone
  needs `assembleVerdictNumbers` (~75 lines) to re-derive the A13 partition. `[design]` One diff engine,
  framework territory.

### 8.6 The instrument must be able to report success and must be honest about scale

- Every bundle MUST carry a hermetic round-trip fixture that forges, loads, re-emits and diffs to
  zero loss and zero invention with no container and no real source. `[doc fact]` doctrine RT-7
  (§5.4). `[code fact]` EDFI and SIF have a Docker-free graph double (`forges/edfi/lib/roundTripGraphDouble.js:48,156`,
  `forges/sif/lib/roundTripGraphDouble.js:35,104,109,123`); CEDS inlines one in its test; PESC drives a live
  graph. `[design]` One `{ readAll, close }` double built from a forge result — framework territory
  (R5).
- Every round-trip run MUST report wall-clock, peak memory and statement census, and every count
  assertion MUST name the two quantities it compares. `[doc fact]` doctrine A8 (§5.4a).
- Every gate MUST have a fault-injection twin observed RED, including the cheating-detector twin
  (delete a fact from the graph; the diff must move). `[doc fact]` doctrine RT-10 (§6);
  `ceds/README_roundTripContract.md` ("`UNPROVEN` … `UNMEASURED` — a failure, never a skip").
- `[code fact]` The validator subsystem is ~15,400 lines; roughly half is the per-standard
  canonicalizer/emitter pairs and the other half — snapshot intake (R1, ~350 lines × 4, one already
  extracted at `forges/edfi/lib/roundTripSnapshotIntake.js:68-189`), bolt/reader/close (R6, ~55 lines × 4,
  refusal strings byte-identical ceds/sif), the diff engine (R2, 1,679 lines in 4 cousins), gates
  evaluator (R3, two generations), twin registry (R4), graph double (R5), verdict assembler (R8),
  `VERDICT_VERSION` (R9) — is framework territory built four times (Author A §6.4).

---

## 9. No bridging inside a forge (the §4 seam)

- A forge returns `{ nodes, edges }` and touches NO graph. Exactly three things touch a graph —
  replayManager owns it, bridgeMaker works over it — and neither the forger nor a forge bundle is one
  of them. `[code fact]` `forger.js:10-14`; `interfaces.js:71-78`; `forges/README.md` ("It never
  touches Neo4j, never writes a block, never knows what a manifest is").
- A forge MUST NOT emit a cross-standard edge. `[code fact]` `forgeEdfi.js:31` ("NO
  cross-standard edge is emitted here"); `forgeCeds.js:112-116` (crossRefs are captured "for the
  later bridge phase … specifiedBridgeMaker later turns into edges").
- A forge MUST stamp its source's own cross-references and anchors as DATA on the node — the
  `crossRefs` JSON property, universally present, `'[]'` when the source has none — and MUST NOT
  resolve them. `[code fact]` `structural-contract.js:184-189`; `vocabulary.js:659-664`;
  `forgeSif.js:355`; `forgePesc260805.js:147`; the shape `[{ system, id, raw, locator }]` is identical
  across the four (Author A D22). Resolution is the bridge's job, under the Bridge Profile's tuple
  addressing (§2) and its resolution rules (§5).
- A forge MUST NOT mint a mapping edge or any edge type in the retired mapping vocabulary. `[code
  fact]` `vocabulary.js:90-97` keeps `SPECIFIED_MAPPING` / `IMPLIED_MAPPING` / `DERIVED_MAPPING`
  only to PROVE their ABSENCE.
- SCOPE NOTE on `provenanceTier`. The Bridge Profile §4.6 retires `provenanceTier` and says it MUST
  NOT be emitted — on MAPPING edges, where `matchBasis` × `resolution` replaced it. This Profile §4.4
  item 2 requires `provenanceTier: 'structural'` on every STRUCTURAL edge a forge emits (`[code fact]`
  `vocabulary.js` `REQUIRED_PROPERTIES.EDGE`, the replay engine enforces it). Different edge kinds,
  different rules; the two documents do not conflict.
- A relationship block is a different producer kind — authored `_exact`, inferred `_close`,
  structural `_struct` — pair-scoped and version-keyed on both endpoints; a forge's block is
  `standardBase` and carries none of those suffixes. `[code fact]` `vocabulary.js:151-173`;
  Bridge Profile §4.7.
- The hub is the ONE exception, and it is not the forge's: when the recipe declares a standard a
  hub, the FORGER derives the hub from the base nodeEdges and folds it into the same block, through
  a registered per-standard hub forge. `[code fact]` `forger.js:407` (`HUB_FORGE_BY_STANDARD`;
  "a second hub is one MORE ROW here, never a branch to edit"), `:557-573`. A hub is Layer 2 and is
  regenerable from Layer 1; the round trip never reads it. `[doc fact]` doctrine §2;
  `ceds/README_roundTripContract.md` "TWO LAYERS".

**WHY the line is here.** The forge is the only component that knows the standard's source; the
bridge is the only component that knows the hub's tuple. Letting a forge resolve its own anchors puts
tuple knowledge in seventeen places, and the Bridge Profile §6 records what a join key does when it
is mistaken for an address. Stamping raw and resolving later keeps the source's own words in the
block — CEDS's `dc:identifier` text survives in exactly one place, `crossRefs[0].raw`, and 20,511
statements depend on it. `[doc fact]` `forges/ceds/README_identityRules.md` §2.

---

## 10. Provenance and versioning

### 10.1 Snapshot provenance

- Every snapshot directory MUST carry, as PEERS of the source bytes: `README_PROVENANCE.md` (what,
  where from, exact acquisition recipe, license posture, and the acquisition class PER SOURCE
  INPUT), `SHA256SUMS`, and `standardSourceLocation`. `[doc fact]` doctrine RT-11 (§8), RT-9 (§10),
  A3, A4; `snapshot-provenance.js:40-57` reads the `publishedVersion:` line of `standardSourceLocation`.
- The bundle MUST derive its version stamp with the shared `deriveVersionStamp({ sourcePath,
  sourceVersion, warn })`, which returns `{ snapshotKey, publishedVersion, versionSource }` with
  `versionSource` one of `'spec'`, `'provenance-file'`, `'unknown'`. `[code fact]`
  `snapshot-provenance.js:59-110`; called by `forgeCeds.js:900-908`, `forgeSif.js:759-767`,
  `forgeEdfi.js:188-195`; **NOT called by PESC**, which hand-builds `metadata` at
  `forgePesc260805.js:777-787` with `versionSource: 'aggregate-manifest'` — a value the shared module's
  precedence rule does not know (§13).
- A self-described source version OUTRANKS the provenance file; a disagreement is WARNED with both
  values named, never silently resolved. `[code fact]` `snapshot-provenance.js:93-99`.
- A bundle MUST pass a real `warn` channel; there is no default. `[code fact]`
  `snapshot-provenance.js:66-82`.
- The forger answers a version WITHOUT forging only when it comes from the provenance file, and
  refuses otherwise. `[code fact]` `forger.js:324-360` (`getVersionStamp`). `[design]` A bundle whose
  version genuinely comes from its source document should declare its own stamp resolver in the
  descriptor, declared-not-sniffed (`forger.js:320-323`, extension point, not yet needed).

### 10.2 The version that reaches a persisted subject

- The EXPLICIT stored version is `publishedVersion` when known, `unknown_<snapshotKey>` when
  `versionSource` is `'unknown'` — never the recipe's floating `'current'`, never a laundered
  default. `[code fact]` `build.js:891-897` (`explicitVersionFrom`); `forger.js:937-944`.

### 10.3 What the block header carries

The `standardBase` header is composed by build.js from the forge report; every field is CARRIED,
none invented. `[code fact]` `build.js:1473-1490`:

| header field | source |
|---|---|
| `blockType` | `'standardBase'` |
| `standardKey` | the recipe token |
| `version` | `explicitVersionFrom(...)` over the report's provenance triple |
| `stableUriPropertyName`, `resolutionKey` | `forgeReport.stableUriPropertyName` |
| `embeddingModelVersion` | `forgeReport.embeddingModelVersion` (undefined on `--vectorize=false`) |
| `embeddingEncoding`, `embeddingDtype`, `embeddingByteOrder` | `'base64'`, `'float32'`, `'little-endian'` |
| `embeddingDims` | `forgeReport.nodeEdges.embeddingDims` |

- A block that carries vectors MUST declare `embeddingDims` and `embeddingModelVersion` in its
  header; the restore gate refuses an embedded block that omits `embeddingDims`. `[code fact]`
  `build.js:1474-1483`; `forger.js:805-810`.

### 10.4 The standard root

- Every forge MUST emit exactly one root node of role `DmeStandardRoot`. `[code fact]`
  `structural-contract.js:72-76`.
- The root MUST carry the provenance block: `standardKey`, `standardName`, `version`, `sourceFormat`,
  `sourceFiles`, `sourceUrl`, `stableUriPropertyName`, `mappingInstruction`. `[code fact]`
  `vocabulary.js:521-531` (`REQUIRED_PROPERTIES.STANDARD_ROOT`; the comment records that a shared
  check does not yet enforce the set). **Ruling:** the framework MUST enforce it, refusing by name; a
  declared-unenforced requirement is the pattern this whole reset exists to end.
- The root MUST ALSO carry `snapshotKey`, `publishedVersion`, `versionSource`, `parserVersion`,
  `coreVersion` (v1.0.2: SHOULD → MUST; the framework enforces it; PESC satisfies it through compatibility declaration P5 — FOUR fields, PESC already stamps `parserVersion` — until P5 retires). `[code fact]` CEDS, SIF and EDFI stamp all of them (`forgeCeds.js:479-498`,
  `forgeSif.js:384-402`, `forgeEdfiContractGraph.js:479-492`); PESC stamps none of the five
  (`forgePesc260805.js:198-207`) — and because `REQUIRED_PROPERTIES.STANDARD_ROOT` never listed them,
  no gate noticed (§13). Whether these five join the enforced MUST set is a MUST DECIDE (§14).
- A standard that has NO source URL MUST OMIT `sourceUrl` (absent is absent, §7.1); it MUST NOT stamp
  `''`. `[code fact]` Today SIF and EDFI stamp `sourceUrl: metadata.sourceUrl || ''` (`forgeSif.js:395`,
  `forgeEdfiContractGraph.js:487`) and PESC stamps the literal `''` (`forgePesc260805.js:203`, `:785`).
  `[design]` Because `sourceUrl` is in the enforced eight, the framework MUST accept ABSENT-with-a-
  declared-reason for it; the compatibility declaration (§13) reproduces `''` until retired.
- The root's `description` MUST be source-stated or absent, never template-built. `[code fact]` Today
  three roots carry a template string (`forgeCeds.js:475`, `forgeSif.js:380`, `forgePesc260805.js:190`),
  which is the placeholder class §7.1 forbids (§13.1).
- `mappingInstruction` is a six-key object `{ cedsOriginalAnchorPropertyName,
  cedsOptionOriginalAnchorPropertyName, crosswalkPrefix, crosswalkResolveProperty, includeInImplied,
  impliedTargets }`, JSON-stringified onto the root. `[code fact]` `forgeCeds.js:88-95`,
  `forgeSif.js:119-126`, `forgeEdfiContractGraph.js:68-75`, `forgePesc260805.js:67-74`. `[design]`
  Framework schema; the forge supplies values (H1).
- `[design]` The framework SHOULD build the root node itself from the H1 declared object and forbid a
  forge from hand-rolling it, so a fifth forge cannot repeat PESC's omission.

### 10.5 Errata

- Every bundle MUST carry `README_ERRATA.md` at its root for observations about the UPSTREAM SOURCE,
  evidence-first, verified-vs-inferred separated per entry, retractions kept visible. `[code fact]`
  doctrine RT-14 (§8a); `forges/sif/README_ERRATA.md` exists; the other three do not
  (`find forges -maxdepth 2 -name README_ERRATA.md` → sif only). `[design]` A new forge MUST ship
  one; an existing bundle without one is a recorded gap (§13).

---

## 11. Test, gate and certification obligations

### 11.1 What a forge MUST ship

A forge MUST ship the following, and each MUST have been observed failing before it was made to
pass.

- **A test suite** under `test/`, with a `package.json` at bundle root so the runner discovers it and
  reports UNTESTED rather than nothing when the suite is missing. `[doc fact]` `forges/README.md`
  ("`package.json` is not vestigial"). The suite MUST cover: the descriptor resolves; the factory
  shape; the return shape of `forge()`; determinism (two `buildContractGraph` runs over the same
  parse produce byte-identical `{ nodes, edges }`); every refusal in §7 the bundle performs.
  `[code fact]` `forges/edfi/test/test-forgeEdfi.js:18`, `:44` (contract shape, determinism, refusal
  doctrine); `forges/pesc260805/test/test-pesc260805SourceTier.js:11` (G-A determinism, G-B/G-C identity traps).
- **Twins.** Every gate MUST have a fault-injection twin observed RED. A gate never seen failing is
  unproven. Gates MUST assert, not merely compute; no standing `expectFail:true`; UNPROVEN and
  UNMEASURED are failures. `[doc fact]` doctrine RT-10 (§6); Bridge Profile §7;
  `forges/ceds/test/test-cedsGates.js:10-18,263-303` (the twin sweep asserting every gate goes red).
- **The validator test.** A hermetic fixture proving the round trip can come back clean (§8.6), plus a
  test that the verdict carries the five normative fields and `semanticValidationLimit`. `[code fact]`
  `DEVLOG-rootAndBranch.md` Phase 4 K3 (`test-cedsRoundTripValidator.js` observed RED 77/79 with the
  declaration removed).
- **A validation certificate** at `README_ValidationCertificate.md`, in the six-section form, with the
  long argument in `README_ValidationDetail.md`. `[code fact]`
  `forges/README_ValidationCertificateStandard.md`; all four bundles carry both.
- **Interfaces.** Every public interface in the forge and its validator MUST be error-first
  callback-shaped from day one, even where the logic is pure. `[doc fact]` doctrine RT-8 (§5.5);
  `sequence-contract.js:37-41`.

### 11.2 The certification bar

- A DEV build is never renamed to `GOLD_EVAL_` without
  `graphBuilder -goldEvalCheck --buildLogDirPath=<run dir>` answering PASS, which it does only when
  every declared validator ran and reported `inventedTotal: 0`; it refuses by name when the stage was
  off, a verdict is missing, or invention is nonzero. `[doc fact]` deploy-dme-graph `SKILL.md`
  GNC-001; `apps/graph-builder/lib/actions.js:1239-1299`; doctrine §7.4.
- **The acceptance ids are measured under stated conditions.** The Ed-Fi block id `aea6d8df…` and
  the four-forge manifest `97c618c2…` were measured with `--vectorize=true` (the CLI default,
  `build.js:555-559`), a WARM embedding cache, and the round-trip stage ON. A build under other
  conditions produces different block text (a vectorized block carries `embeddingRef`s; an
  unvectorized one does not) and MUST NOT be compared against them. `[doc fact]` rulings addendum
  (risk-tester GARDEN_HAVEN); `PLAN-forgeFramework-v1.md` F3b.
- **GNC-001 tiers.** `DEV_<label>` is scratch and never deployed; a single- or few-standard assembly
  is ALWAYS `DEV_`. `GOLD_EVAL_<YYMMDD>` is a full all-standards golden under evaluation. `GOLD_<YYMMDD>`
  is that same container renamed. Promotion is a rename, never a rebuild; the convention is
  forward-only. `[doc fact]` `SKILL.md` "Graph naming convention (GNC-001)". The check gates
  PROMOTION ONLY and MUST NOT gate creation: any builder may create as many `DEV_` graphs as the work
  needs. `[doc fact]` `SKILL.md` (TQ ruling 2026-08-04).

### 11.3 Compliance gates (forge side)

A forge claiming conformance MUST ship gates proving each of the following. Every gate MUST have a
twin that injects the precise fault and turns it red — one twin PER CONJUNCT, named beside each gate.
A gate that asserts EXISTENCE where the rule states an IDENTITY is under-enforcement and does not
count.

1. **Descriptor resolves.** (a) `[parserDescriptor]` present; (b) `standardName` non-blank;
   (c) `entryModule` present; (d) `roundTripValidator` present and non-blank; (e) `defaultSnapshot`
   matches exactly one directory.
   *Twins:* (a) delete the header — every key must vanish and the refusal must name the header;
   (b) blank the name — refused; (c) remove `entryModule` — refused; (d) blank the validator line —
   refused as blank, not absent; (e) add a second `04*` directory — refused as ambiguous.
2. **Factory shape.** (a) the entry module is a function of `{ embedder }`; (b) it returns an object
   exposing `forge` and `buildContractGraph` under those names; (c) `forge` has arity 2 and calls back
   error-first with `''` on success.
   *Twins:* (a) export an object — refused; (b) rename the pure layer — refused by name;
   (c) call back with a non-string first argument — refused.
3. **Return shape.** (a) `nodes[]`, `edges[]`; (b) `metadata.{version,snapshotKey,publishedVersion,
   versionSource}` all present, `version` non-empty and not the recipe token; (c) `embedCallCount` a
   number; (d) `standardKey` equals the bundle directory token; (e) `stableUriPropertyName` names a
   property every node carries; (f) every node with `embedding` carries `embeddingModelVersion`. This
   gate exercises the FORGE's return, not the forger's shaper.
   *Twins:* (a) return `nodes` as an object — refused; (b) `version: ''` — refused; (c) omit
   `embedCallCount` — refused; (d) return `'EDFI'` — refused; (e) name a property one node lacks —
   refused; (f) drop `embeddingModelVersion` from one embedded node — refused.
4. **Determinism.** Two `buildContractGraph` runs over one parse are byte-identical; no `Date`,
   `Math.random`, `process.hrtime` reachable from the pure layer.
   *Twin:* stamp a run counter into one stableId — the second run must differ. `[code fact]` Over
   PESC this gate covers the SOURCE tier only: PESC's `forge()` pure computation is
   `buildSourceTierGraph` + `buildDerivedTier` + `applyDerivedTier` + the synthetic tier, so the
   exported pure layer is a SUBSET of what reaches the block (§13.1 P7).
5. **Identity.** (a) no duplicate `stableId`; (b) every edge endpoint resolves to a member;
   (c) exactly one root; (d) every non-root `parentId` names a member stableId; (e) `crossRefs` present
   on every node. **This gate is RED TODAY for CEDS (a, b) and PESC (b: falsy-only check) — the
   punch list C1/C2 and P-rows carry it; it goes green when the framework's universal refusals arrive
   and their compatibility declarations retire.**
   *Twins:* (a) mint one stableId twice — refused by name; (b) push one edge to a non-member
   stableId — refused; (c) emit two roots — the finalizer refuses; (d) point a `parentId` at an `_id`
   — refused with the "wrong referent" diagnostic; (e) strip `crossRefs` from one node before the
   finalizer — the finalizer must restore `'[]'` (or refuse if it is bypassed).
6. **Refusals observed.** Missing source, missing `[parserDescriptor]`, blank `standardName`, a
   `metadata.version` of `''`, `skipEmbedding: true` with a nonzero `embedCallCount`, absent
   `sourcePath`, embedding requested with no embedder.
   *Twins:* each fault injected and the refusal text checked for the NAME of the fault.
7. **Round trip.** (a) validator declared, loads, exports `validate`; (b) the verdict carries the five
   normative fields AND `roundTripClean === (contentGapTotal === 0 && inventedTotal === 0)` — the
   A13 identity, asserted, not merely the presence of five keys (`round-trip-stage.js:270-282` is
   presence-only; the forge's own gate MUST NOT be); (c) `semanticValidationLimit` non-blank;
   (d) `inventedTotal` 0; (e) hermetic fixture clean; (f) the cheating-detector twin moves the diff.
   *Twins:* (a) undeclare — absent, not refused; blank — refused; (b) set `roundTripClean: true`
   with `contentGapTotal: 1` — refused; (c) remove the limit — the harness refuses; (d) inject one
   invented statement — the build fails; (e) drop one source statement — `lostTotal` moves;
   (f) delete one fact from the graph double — the diff moves.
8. **Block reproduction.** The bundle's block id is reproduced by a second build over the same
   pinned snapshot under the stated acceptance conditions (§11.2).
   *Twin (nondeterminism injection):* inject a hook that returns Date-derived text into one
   `searchText` — the second build's id must differ. *Sensitivity check (not the twin):* flip the pin
   to a different snapshot — the id must change and the diff must be the changelog.

---

## 12. Anti-patterns — what the four forges did that this Profile forbids going forward

Each row names the practice, the evidence, and the rule.

| practice | evidence | rule |
|---|---|---|
| **Drift copies.** Cloning the scaffold (`embedNodes`, the `forge()` pipeline, the root provenance block, `makeNode`/`addEdge`) from a sibling and editing it in place | `[doc fact]` `forges/README.md` ("near-identical across all five bundles and is a live candidate for extraction … clone it from the nearest template"); doctrine A8 §5.4a.3 ("Cloning inherits latent defects"); Author A D1-D27 (27 idioms in ≥2 forges) and R1-R9 (9 in the validators) | `[design]` A new forge MUST take shared operations from the framework / `lib/`, never by copy. A defect found in inherited code is REPORTED across the fence and fixed at the source. Every D and R row is forbidden as a per-forge copy going forward |
| **The drift that already changed meaning.** Three CEDS-anchor normalizers with one regex and two answers for `'000000'`; four headline vocabularies computing `lostTotal` four ways; PESC's root missing four provenance fields; CEDS pushing partial edges; EDFI's validator producing a verdict with nothing on disk | `[code fact]` Author A §1.3, §1.4, §1.7, §6.2, R7 | §4.3, §4.4, §8.5, §10.4, §8.1 — each choice made ONCE and observed red ONCE |
| **Tracked regenerated artifacts.** Test suites writing files that were committed | `[doc fact]` `DEVLOG-rootAndBranch.md` Phase 4 (nine regenerated artifacts untracked; the sweep had to be by MTIME because bytes matched); commit `ae41a89` message | `[design]` A test MUST NOT write into a tracked path. Evidence of a run comes from a run |
| **Licensed source inside a gate.** The embedded end-to-end gate built `edfiOnly`, whose MetaEd bytes are gitignored | `[doc fact]` DEVLOG Phase 3 stand-down item 6, Phase 4 item 2 ("which is why the gate passed only on this Mac"); descriptor `edfi:23-25` | `[design]` A gate that must run everywhere MUST run over committed source; a license-gated bundle's gate is one-machine-only and MUST say so by name |
| **A stated expectation the instrument has not earned.** Writing an expected-loss number into a descriptor before a verdict exists | `[code fact]` `ceds/parserDescriptor.ini:18-24` ("Writing an expectation this bundle's validator has not yet earned would be exactly the tuning-toward-a-number the campaign exists to prevent") | `[design]` A descriptor MAY quote a MEASURED verdict with its date; it MUST NOT state a target |
| **A verdict number quoted without its limit.** `lostTotal: 0` carried into summaries bare | `[code fact]` `round-trip-stage.js:305-311`; DEVLOG Phase 4 K3 | §8.4 |
| **A stale verdict misread under new arithmetic.** A `verdictVersion -1` artifact satisfying a three-field check | `[code fact]` `round-trip-stage.js:42-51`; doctrine A13; PESC's `verdictVersion` string `'pesc260805RoundTripVerdict-1'` carrying the full A13 set (`pesc260805/roundTripValidator.js:85`) shows the version literal is not a reliable discriminator | The five-field list, §8.2 |
| **A superseded number left standing.** "lost 293" reading as current | `[code fact]` `pesc260805/parserDescriptor.ini:29-40` | `[design]` Superseded text is PRESERVED and MARKED superseded, never deleted and never left reading as current |
| **Sniffing instead of declaring.** A stage finding a validator by filename | `[code fact]` `round-trip-stage.js:11-13`; doctrine RT-13.1 | §3.3 |
| **A parent's prompt or a comment as the only home of a rule.** Prose in a validator's comment as the only statement of its limit | `[doc fact]` DEVLOG Phase 4 K3 (the CEDS limit lived only in code until 2026-08-15) | §8.4 — the limit travels in the artifact |
| **Sectionless ini keys.** | `[code fact]` `forger.js:178-196` | §3.2 |
| **A default standing behind a settable key.** In-code `EMBEDDING_DIMS = 1024`; an absolute Voyage path behind `voyageConfigFilePath`; PESC's no-op logger behind `process.global` | `[code fact]` `shape-forged-graph.js:20-25`; `forger.js:96-108`; `forgePesc260805.js:81-84` | §7 — no silent substitution |
| **A single-valued map on a join key.** | `[doc fact]` Bridge Profile §6 | §5.2 |
| **A hub folded with the recipe token.** The golden-diff defect | `[code fact]` `forger.js:527-533` | §2.4 |
| **A bare string where the vocabulary has a registry.** `'DECLARES'` as an edge type; `'CEDS'` where `STANDARD_SOURCE` belongs | `[code fact]` `forgePesc260805.js:284,542`; `forgeCeds.js:226,454-455,473` | §4.4 item 5, §3.5 |
| **Hard-wired emission loops in place of a role registry.** | `[code fact]` `forgeCeds.js:504-803` | §4.4 item 4, H3 |
| **A dead input kept beside the finalizer that supersedes it.** Hand-stamped `depth` in three forges | `[code fact]` Author A D21; `structural-contract.js:147-182` | §4.4 item 7 — the finalizer derives depth |

---

## 13. Migration rule — byte-identical first

**Ruling (binding):** the four surviving forges migrate onto the framework BYTE-IDENTICAL FIRST.
The framework MUST allow each forge's current behaviour through a hook so it migrates with its block
id UNCHANGED. Every compliance repair this Profile requires is a SEPARATE, deliberate change with a
NEW block id, made after migration, never as a side effect of it — two changes, two commits, two
block ids, or nobody can tell which one broke what. `[doc fact]` `RULINGS-supervisor-forgeProfile.md`,
rows 1 and 6.

**WHY.** The framework yields to the bytes unless the Profile says the bytes were wrong. Where the
Profile does say so, the repair and the migration are still two changes, because identical block id
is the migration's acceptance test (§5.4, §15) and a repair folded into a migration destroys the test.

**HOW — compatibility declarations (ruling, review §E).** A framework that OWNS a step which can
change block text (the version stamp; finalizer-derived properties such as `depth`; each universal
refusal — dangling, duplicate, edge-type membership, option-value expansion) cannot migrate a forge
byte-identical unless it can be told to reproduce that forge's current output at that step. The
review found the counter-example: PESC has no `standardSourceLocation`, so a framework-owned
`deriveVersionStamp` yields `versionSource 'unknown'` → header version `unknown_01` instead of
today's aggregate stamp → a NEW block id, with no code change to PESC's bytes. Therefore:

- The framework MUST expose per-forge **compatibility declarations** — DATA in the forge's
  declaration object (H1), never code branches — for every framework-owned step that can change
  block text.
- Migration = declarations set to reproduce today's bytes; zero change to the bytes.
- A **compat-census gate** counts declarations per forge and reports; a forge at zero declarations
  is fully compliant.
- Retiring each declaration is a SEPARATE commit with a deliberately new block id and its own
  verdict. The punch rows below that fall in this class read "retire declaration X".
- F2 MUST name the declaration set. `[doc fact]` `RULINGS-supervisor-forgeProfile.md` addendum 23:00.

### 13.1 The punch list — known non-compliance in the four surviving forges

Each row is a Profile MUST that a surviving forge violates today. Each is a separate deliberate change
after that forge's byte-identical migration. `[code fact]` per the citations; the list is Author A's
census plus the rulings, and it is the migration's punch list. A repair that changes no block text
(a rename, a refusal that never fires on the pinned snapshot) still lands as its own commit — EXCEPT (v1.0.2, ruling D6) a byte-free repair the framework performs BY CONSTRUCTION (universal checksum verification, universal refusals that do not fire, the removal of the entry module's own stub logger), which discharges WITH the migration commit and is named in its message; repairs inside loader code that becomes a hook (C7, E5) are NOT so discharged.

| # | forge | non-compliance | Profile § | evidence |
|---|---|---|---|---|
| P1 | pesc260805 | does not call `finalizeStructuralContract`; stamps `depth` arithmetically — **retire declaration** `depthSource: 'forge'` | §4.4.7 | `grep -ac` → 0; `forgePesc260805.js:236,275,317,360,411,450,524` |
| P2 | pesc260805 | does not call `deriveVersionStamp`; hand-builds `metadata` with `versionSource: 'aggregate-manifest'` — **retire declaration** `versionStamp: 'aggregate-manifest'` (NOT block-neutral: no `standardSourceLocation`, so the shared stamp would yield `unknown_01`) | §10.1 | `forgePesc260805.js:777-787` |
| P3 | pesc260805 | does not call `finalizeSequence` though it sees XSD element order | §4.4.8 | `sequence-contract.js:11-13`; `forgePesc260805.js:327` |
| P4 | pesc260805 | mints SEVEN edge types outside `EDGE_TYPES` — `DECLARES`, `IN_NAMESPACE`, `SAME_DEFINITION`, `IMPORTS`, `RESOLVES_TO`, `MERGED_FROM`, `SERVED_BY` (v1.0.2: the seventh was hidden because ugrep skips `syntheticTier.js` as binary — enumerate with `grep -a`); the serializer checks only a lexical regex, not membership, so all seven reach block text today — **retire declaration** `edgeTypeAllowList: [...]` | §4.4.5 | `forgePesc260805.js:284,542`; `forges/pesc260805/lib/derivedTier.js:705,1013`; `lib/syntheticTier.js:1384,1398,1770,1786,1800,1854,1905,1946` |
| P5 | pesc260805 | root omits `snapshotKey`, `publishedVersion`, `versionSource`, `coreVersion` (it does stamp `parserVersion: '1'`) | §10.4 | `forgePesc260805.js:198-207` |
| P6 | pesc260805 | enumeration values carried as a JSON array, not expanded to `DmeOptionValue` + `HAS_VALUE` — **retire declaration** `optionValueExpansion: 'json-array'` | H3 (ruling row 1) | `forgePesc260805.js:418-419` |
| P7 | pesc260805 | pure layer exported as `buildSourceTierGraph`, not `buildContractGraph`; and it is a SUBSET of the pure computation (`buildDerivedTier` + `applyDerivedTier` + synthetic run inside `forge()`), so gate 4 covers the source tier only | §2.1, §11.3 gate 4 | `forgePesc260805.js:650-676,800-806` |
| P8 | pesc260805 | silent no-op logger default behind `process.global` | §5.3 | `forgePesc260805.js:81-84` |
| P9 | pesc260805 | `description`/`documentation` stamped `\|\| ''`; `name` coerced to `''` (RT-2) | §7.1 | `forgePesc260805.js:141-143` |
| P10 | pesc260805 | no stableId clean-form predicate | §5.1 | Author A §1.3 |
| P11 | pesc260805 | source checksums computed as identity, verified only in the validator (RT-3: the FORGE stops) — CONFIRMED (rulings addendum M4) | §4.1 | `forges/pesc260805/lib/parser.js:513`; validator `:224-259` |
| P12 | pesc260805 | NO `package.json` at bundle root — `runAllTests.js` gates discovery on it, so PESC's suite NEVER RUNS in the fleet | §11.1 | `ls forges/pesc260805/package.json` → absent; `test/runAllTests.js:108` |
| P13 | pesc260805 | snapshot has no `standardSourceLocation` | §10.1 | `ls forges/pesc260805/assets/standardSourceData/*/standardSourceLocation` → absent |
| P14 | pesc260805 | no hermetic round-trip fixture / graph double (probes drive a live graph) | §8.6 | Author A §6.4 R5 |
| P15 | pesc260805 | `addEdge` defaults `pescTier` to `PESC_TIER.SOURCE` when the caller omits it — a silent default | §7.1 | `forgePesc260805.js:175` |
| P16 | pesc260805 | root `sourceUrl: ''` — **retire declaration** `sourceUrl: ''` | §10.4 | `forgePesc260805.js:203`, `:785` |
| P17 | pesc260805 | root `description` template-built | §10.4, §7.1 | `forgePesc260805.js:190` |
| C1 | ceds | no dangling-edge check — `addEdge` pushes a partial edge — **retire declaration** `danglingEdgeRefusal: 'off'` (unknown whether it fires on the pinned snapshot; no build) | §4.4.6 | `forgeCeds.js:451-458` |
| C2 | ceds | no duplicate-stableId refusal at mint time — **retire declaration** `duplicateStableIdRefusal: 'off'` (same caveat; and with MERGE last-writer-wins, §5.5, emission order is load-bearing until it fires) | §4.4.6, §5.1 | Author A §1.5 (c) |
| C3 | ceds | no role registry — four hard-wired emission loops | §4.4.4, H3 | `forgeCeds.js:504-803` |
| C4 | ceds | literal `'CEDS'` where `STANDARD_SOURCE` belongs | §3.5 | `forgeCeds.js:226,454-455,473` |
| C5 | ceds | source checksums verified only in the validator — CONFIRMED (rulings addendum M4) | §4.1 | `forges/ceds/roundTripValidator.js:99,117` |
| C7 | ceds | parser's no-op logger default `(xLog && xLog.status) \|\| (() => {})` | §5.3, §7.1 | `forges/ceds/lib/parser.js:434` |
| C8 | ceds | root `description` template-built | §10.4, §7.1 | `forgeCeds.js:475` |
| S1 | sif | positional parser signature `parseSif(sourcePath, {...}, cb)` — under the framework, an ADAPTER is needed to the H2 hook contract (ruling A1) | §4.2, H2 | `forges/sif/lib/parser.js:8,488` |
| S2 | sif | `name` coerced to `''` when null (RT-2) | §7.1 | `forgeSif.js:349` |
| S3 | sif | THREE CLAUSES, status verified by code reading (Lane B, WILD_VALLEY, 2026-09-02; evidence in `zNotesPlansDocs/LANEB-findings-090226.md` §B1). **Clause 1 RESOLVED** 2026-09-01 (versionFromStamp, f87f7da): the `'1.0'` literal is deleted, the parser reports no version, the root's `version` comes from the provenance stamp. **Clause 3 RESOLVED** 2026-08-29 (Phase 3, 343d82e): the fifth `forge()` argument no longer exists; the framework refuses any fifth key by name (twin-proven, `test-gSeam.js` `fifthKeyRefused`); residue only — `parser.js:522-527` still honours `options.resolutionMapPath`, dead because its sole caller `sifHooks.js:58` passes `{}`. **Clause 2 OPEN**: the second source input `refIdResolutionMap.tsv` is checksum-verified twice and refuses by name when absent (`parser.js:425-482`, `:156-166`; gated through `bundle.forge` in `test-r3-canonical.js:288-311`) — integrity is clean — but it is located by fixed name (`parser.js:519`) and NOT declared in `additionalSourceInputList` (`sifForgeDeclaration.js:83`), contrary to the Framework Spec §4.1/§5/§8.3 (FR20, RULING 23:12 #4) which names this exact input as the declared case. Not a runtime fault on the pinned snapshot; a false H1 declaration. Filed as a work order: `WORKORDER-standDownBacklog-090226.md` §5 "SIF's UNDECLARED SECOND SOURCE INPUT" (seam work — both files are in `SEAM_PATH_LIST`) | §2.2, §3.3, §7.1 | `forges/sif/lib/parser.js:519`, `:522-527`, `:425-482`; `sifForgeDeclaration.js:74-83`; `sifHooks.js:55-59`; `forge-framework.js:60`, `:389-394`, `:426-451` |
| S4 | sif | root `sourceUrl: metadata.sourceUrl \|\| ''` — **retire declaration** `sourceUrl: ''` | §10.4 | `forgeSif.js:395` |
| S5 | sif | root `description` template-built | §10.4, §7.1 | `forgeSif.js:380` |
| E1 | edfi | validator writes verdict artifacts only when `outputPath` is truthy — a verdict producible with nothing on disk | §8.1 | `forges/edfi/roundTripValidator.js:395` |
| E3 | edfi | round-trip emitter is SYNCHRONOUS (RT-8) | §8.5 | `forges/edfi/lib/roundTripEdfiCompiler.js:597` |
| E5 | edfi | `metaEdParser` no-op logger default `xLog \|\| { status: () => {}, ... }` | §5.3, §7.1 | `forges/edfi/lib/metaEdParser.js:100` |
| E6 | edfi | root `sourceUrl: metadata.sourceUrl \|\| ''` — **retire declaration** `sourceUrl: ''` | §10.4 | `forgeEdfiContractGraph.js:487` |
| E7 | edfi | root `description` template-built (v1.0.2) | §10.4, §7.1 | `forgeEdfiContractGraph.js:472-475` |
| E8 | edfi | root `sourceFiles` names LOGICAL loader inputs (`sourceInputs.map(inputName)` + three literal names), not the verified files — retire declaration `sourceFilesLogicalNames` when sourceFiles becomes the verified list (byte change, own commit) (v1.0.2, FA5) | §10.4, §7.1 | `forgeEdfi.js:183-185` |
| C9 | ceds | `_id = ceds:<cedsId>` ≠ stableId (byte-invisible; a hook-set `_id`) — retire by removing the stamp (v1.0.2) | §5.1 | `forgeCeds.js` makeNode |
| S6 | sif | `canonical \|\| EDGE_TYPES.REFERENCES` parent-edge substitution — a silent identity chain; retire declaration `parentEdgeSubstitution` only if the census counts ≥1 (v1.0.2) | §7.1 | `forgeSif.js:652` |
| P18 | pesc260805 | ships no `roundTripGates` declaration and no twins (the red-evidence ledger is an accepted alternative for the tier suite only) (v1.0.2) | §11.1, §11.3 | `forges/pesc260805/test/` |
| S7 | sif | root `sourceFiles: []` (parser returns none; `\|\| []` coercion) — retire declaration `sourceFiles: []` when the loader reports its files (v1.0.2) | §7.1, §10.4 | `forges/sif/lib/parser.js:942-955`; `forgeSif.js:394` |
| C10 | ceds | carry-list excludes `''` values (`!== ''`) where the kit filters `!== undefined` only — declaration only if the probe finds a `''` carried field on the pinned snapshot (v1.0.2) | §7.1 | `forgeCeds.js:312` |
| A1 | ceds, edfi, pesc260805 | no `README_ERRATA.md` | §10.5 | `find forges -maxdepth 2 -name README_ERRATA.md` → sif only |
| A2 | all four | 27 forge-side (D1-D27) and 9 validator-side (R1-R9) duplicated idioms | §12 row 1 | Author A §2, §6.4 — retired by the migration itself, not by per-forge repair |

Struck at v1.0.1 (review §E, rulings): former **E2** (edfi validator exports the bare factory) — the
Profile rule is a SHOULD (§8.1), not a MUST, so it is not non-compliance; former **E4** (edfi `validate()`
without a default destructure) — a stretch under §7.1; former **C6** (CEDS compiler writes an RDF file and
reparses) — the rule in §8.5 is a FRAMEWORK rule (do not generalise this shape), not a forge MUST; C6's
observation stays in §8.5.

### 13.2 What migration MUST prove

For each forge, in order: (1) framework build over the same pinned snapshot → block id IDENTICAL to
the pre-migration id (Ed-Fi: `aea6d8df…`); (2) round trip clean (or the same named `lostTotal`
backlog as before, `inventedTotal` 0); (3) `-goldEvalCheck` PASS on the run directory; (4) then, and
only then, the punch-list repairs, each its own commit with its own new block id and its own verdict.
`[doc fact]` `PLAN-forgeFramework-v1.md` F3b.

---

## 14. Unsettled questions

A forge MUST NOT assume an answer to any of these. Rulings marked **MUST DECIDE** await TQ or the
supervisor; the two positions are recorded where the drafts disagreed.

**Provisional names, not closed by this Profile (ruling row 2).** SIF's field-characteristics
property names (`characteristicsRepeatable`, `characteristicsObligation`, …) carry an
awaits-ratification comment. `[code fact]` `forgeSif.js:106-108`. PESC's `pescTier: 'meta'` on the
`DmeStandardRoot` and its ownership edges is a PROVISIONAL EXCEPTION flagged for supervisor review.
`[code fact]` `forgePesc260805.js:27-33`. **Ruling:** the Profile RECORDS both as provisional and does
not close them; TQ's call. A framework MUST carry them as they are until ratified.

**When the stage default flips.** The doctrine (§7.3, A9/A11) says the flip from "declared-absent
tolerated" to "undeclared fails the build" is a deliberate reviewed change once the fleet-wide absent
count is zero. It is zero today over four bundles. This Profile requires declaration and leaves the
stage default where the doctrine leaves it (§8.1). Likewise for `semanticValidationLimit`: the
framework harness refuses; the stage's own flip is reserved (§8.4).

**`_id` versus `stableId`.** CLOSED by the F2 architect against `replay-engine.js` (rulings addendum
22:51): a forge MUST NOT set `_id`; the engine owns it (§5.1). Recorded here because v1.0 carried it
as open.

**Which root properties are ENFORCED.** MUST DECIDE for the F2 architect. `REQUIRED_PROPERTIES.STANDARD_ROOT`
lists eight and the framework MUST enforce those (ruling row 5). The five extra (`snapshotKey`,
`publishedVersion`, `versionSource`, `parserVersion`, `coreVersion`) ARE ordinary root properties that
enter block text (rulings addendum, M6 CLOSED as to mechanism): three forges' ids already contain them;
PESC's would change, so PESC gets them as a post-migration compliance change. Whether the framework
stamps them UNIFORMLY is F2's decision.

**`owner`.** Reserved and passed through unchanged (ruling row 4). Whether a future framework version
stamps it, ignores it, or refuses a value other than the `OWNER_TOKENS` is not decided.

**`displayName`.** Not read by any code path found; carried by every descriptor. Whether the
framework or a future certificate generator reads it is open.

**PESC's red-evidence ledger.** Ruled by the F2 risk-tester (rulings addendum): an accepted alternative
for the TIER-suite assertions it covers, NOT a substitute for live round-trip twins; not lifted into v1;
two of its ideas (shipped-config / expectation-lever-does-not-count; stale-entry audit) lifted into the
twin-registry contract. Background: three forges converged on gates-as-JSONC + a twin
registry + an every-gate-observed-RED sweep; PESC built an equivalent proof as
`test/buildRedEvidenceLedger.js` + `redEvidenceLedger.json` + 24 probes. `[code fact]` Author A §6.7.
Whether the ledger migrates to the framework's twin registry or is ruled an accepted alternative is
open.

**Value-tier resolution** and **hub version in the IRI** remain the Bridge Profile's open questions
(§8) and are not decided here.

---

## 15. Positions this Profile encodes

Ratified with tqii, 2026-08-15 (by text, 22:15, and in the rulings that followed).

- **Maximize shared code.** What is common to all forges — the seam, the shaper, the pipeline
  orchestrator and its one adapter, `makeNode`/`addEdge`/the root, the structural and sequence
  finalizers, the version stamp, the search text, the embedding pass, the CEDS-anchor normalizer, the
  round-trip intake/diff/verdict/gates/twins — is framework territory. What is legitimately
  per-standard is the descriptor's data, the parser, the identity rule, the registries that drive the
  emission walk, and the validator's canonicalizer/emitter pair. The framework's value is not fewer
  lines; it is that every one of these choices gets made once and observed red once.
- **The seam is sacred.** `({ embedder }) => { forge, buildContractGraph }`;
  `forge({ sourcePath, owner, embedNodeLimit, skipEmbedding }, cb)`;
  `cb('', { nodes, edges, metadata, embedCallCount, standardKey, stableUriPropertyName })`.
  graphBuilder is not modified to accommodate a forge; a seam argument is not removed by us.
- **Identical block id is the acceptance test.** A forge re-implemented on the framework is correct
  when it reproduces its block id and a clean round trip under the stated acceptance conditions
  (`--vectorize=true`, warm cache, stage on); migration is byte-identical first and every compliance
  repair is its own change with its own id.
- **Byte-identity is achieved by compatibility declarations, not by code branches.** For every
  framework-owned step that can change block text the framework exposes a per-forge DATA declaration
  that reproduces today's bytes; a compat-census gate counts them; each retirement is its own commit
  with its own new block id (§13).
- The descriptor is the whole registration; a bundle registers itself or it does not exist.
- Two version claims, two fields; the bundle's own stamp is the one that reaches an address.
- `stableId` is identity, source-derived, unique; `canonicalKey` is a join key and never an address.
- The pure layer is pure; a block id is a function of the pinned snapshot and the code, and of
  nothing else.
- Invention fails the build; loss is a meter; the meter's limit travels with the number, in every
  forge.
- A forge stamps its source's cross-references raw and never resolves them; bridging is a
  different producer with a different block kind.
- Refuse by name; absent is absent; a coerced value is a substitution; a cheap refusal precedes a
  costly step; a declared-unenforced requirement is the pattern this reset exists to end.
- A provisional name stays provisional until TQ ratifies it; the Profile does not promote it to
  canon by restating it.

---

## Appendix A — Merge record

Where the two drafts contradicted each other, and how each was resolved.

| # | subject | Author A | Author B | resolution |
|---|---|---|---|---|
| M1 | `forger.js` line numbers (descriptor validation, `resolveBundle`, `sourceFile`, `resolveReportedVersion`) | `:100-116`, `:107-205`, `:188-190`, `:212-244` | `:186-205`, `:153-284`, `:262-269`, `:362-372` | **B's**, verified at HEAD `ae41a89`; A's are stale |
| M2 | Is `roundTripValidator` optional in the descriptor? | "optional" (as the forger reads it) | MUST (§5.1) | **MUST** — B, ruling row 3's spirit, and the fleet-wide absent count being zero; recorded in §3.1, §8.1 |
| M3 | Do all four bundles export `buildContractGraph`? | PESC exports `buildSourceTierGraph` | "every surviving forge returns both" (cites ceds, edfi) | **A is right for PESC**; verified `forgePesc260805.js:800-806`; MUST stands, PESC → punch list P7 |
| M4 | Forge-time checksum verification | CEDS/PESC verify only in the validator; forge-time is better | RT-3: checksum-failing source stops the forge (MUST) | MUST per B; P11/C5 listed; CONFIRMED by the supervisor (rulings addendum 22:46) |
| M5 | `_id` policy | framework default `_id = stableId` with declared override | silent | CLOSED by the F2 architect against replay-engine: a forge MUST NOT set `_id` (§5.1, §14) |
| M6 | Root provenance fields beyond the eight | PESC omits four; three stamp them | the eight are the MUST | eight enforced (ruling row 5); the five extra are SHOULD + MUST DECIDE (§10.4, §14) |
| M7 | Option-value expansion | question raised (D26) | silent | **ruled**: MUST expand; PESC byte-identical first (H3, P6) |
| M8 | Provisional names (SIF, PESC `'meta'`) | "Profile should close both" (D27) | silent | **ruled**: recorded, not closed (§14) |
| M9 | `semanticValidationLimit` scope | absent-everywhere refusal noted (§6.6) | REQUIRED for a NEW forge (§5.4) | **ruled**: MUST for EVERY forge; framework harness refuses (§8.4) |
| M10 | Null-embedder refusal | PESC has it; universal | not stated | added to §2.2 as a MUST — A's finding, B's refusal doctrine; not a new rule but a named instance of §7 |
