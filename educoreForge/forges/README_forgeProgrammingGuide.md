# A Programmer's Guide to Creating a New Forge

*The STANDARD-side guide: how to bring a new education-data standard ("XYZ") into the educoreForge graph.*

This is one of a pair. **Standard-side vs mapping-side — you likely need both:**

- **This guide** covers the standard side: parsing a standard's native source and emitting it into the
  universal forge contract, through the build-and-verify workflow.
- **[`README_bridgeProgrammingGuide.md`](./README_bridgeProgrammingGuide.md)** covers the mapping
  side: getting your forged standard evidence-judged against the CEDS hub, from the zero-code
  `genericBridge` path to writing a custom evidence bridge.

Audience: a competent JS programmer who has never seen this codebase. Every factual claim below is
grounded in code read in the working tree of `educoreForge/system/code/educoreForge` (branch
`architecture-improvement`, 2026-07-30, including the SIF sequence-capture work) — file paths are
repo-relative unless stated otherwise. Citations name files and exported symbols rather than raw line
numbers wherever possible, because line numbers rot; where a line number appears it was verified on
the date above. This project has a documented history of exactly one plausible-but-wrong claim
costing a day of work (a phantom `matchType` field that lived only in comments) — treat anything not
backed by a citation with suspicion. (`forges/README.md` is a shorter narrative companion to this
guide, worth reading once; this document is the contract-complete reference.)

---

## Table of contents

1. [What a forge is](#1-what-a-forge-is)
2. [Anatomy of a forge bundle](#2-anatomy-of-a-forge-bundle)
3. [The forge contract](#3-the-forge-contract)
4. [The sequence contract](#4-the-sequence-contract)
5. [Source data and versions](#5-source-data-and-versions)
6. [Purity rules](#6-purity-rules)
7. [Your first build](#7-your-first-build)
8. [The rules that bite](#8-the-rules-that-bite)
9. [Checklist](#9-checklist-empty-directory-to-verified-base-block)

---

## 1. What a forge is

A **forge** is a small, pure, synchronous-shaped module that reads one standard's native source
document (an OpenAPI schema, an RDF ontology, an XSD set, a flattened TSV, ...) and emits a fixed,
universal shape of nodes and edges — never a graph connection, never Neo4j, never a database write.

The pipeline downstream of a forge is:

```
forge()  ->  content-addressed schema block  ->  store  ->  manifest  ->  replay
```

- **forge** produces `{ nodes, edges, metadata, ... }` in memory (§3 below).
- The forger app (`apps/graph-builder/apps/forger/forger.js`) shapes that into "engine shape" and
  hands it downstream; the replay machinery is one of the only things in this tree that ever writes
  to a graph.
- `apps/graph-builder/lib/build.js` serializes the shaped nodes/edges into a **schema block** — a
  content-addressed text blob whose `refId` is `sha256(text)` — and writes it into the `blocks`
  table of the standards database (`lib/standards-database/standards-database.js`; hashing is
  `blockIdForText` in `lib/content-address/content-address.js`).
- A **manifest** is a named, content-addressed *set* of blocks (`manifests` + `manifestBlocks`
  tables in the same module). The manifest's own `refId` is a hash of its membership
  (`manifestKeyForMembership`, `lib/content-address/content-address.js`), not of anything else —
  renaming or re-describing it never changes its identity.
- **A graph is a replay.** `graphBuilder -replay --standardsDatabaseFilePath=<path>
  --manifestRefId=<refId>` opens a stored manifest, resolves its member blocks, and materializes
  them into a fresh graph — no forging, no bridge runs, no LLM/Voyage calls
  (`apps/graph-builder/lib/help.js`). **The store is the truth; the graph is disposable and
  reproducible from it.**

This is why the forge itself is required to be *pure*: "buildContractGraph is a PURE, synchronous,
deterministic function of the parsed source — same source -> identical nodes/edges" (comment,
`forges/sif/forgeSif.js:25-27`; the same wording appears in `forges/lif/forgeLif.js` and
`forges/ceds/forgeCeds.js`). The only non-deterministic part of forging is the embedding pass, which
is deliberately isolated into its own step (`embedNodes`) so the structural shaping itself can be
tested and diffed byte-for-byte.

---

## 2. Anatomy of a forge bundle

A forge bundle is a directory under `forges/<token>/`. The tree currently carries eighteen of them
(`case`, `ceds`, `cip`, `clr`, `ctdl`, `ctdlasn`, `ctdlqdata`, `dctap`, `edfi`, `eduapi`, `jedx`,
`lif`, `medbiquitous`, `openbadges`, `pesc`, `sedm`, `sif`, `soc`). `forges/lif/` is small and
complete, and is the worked example here:

```
forges/lif/
├── forgeLif.js                                  the forge module (parse -> shape -> embed)
├── parserDescriptor.ini                          the bundle's OWN registration
├── lif.forgeRecipe.jsonc                         a single-standard forge recipe (rarely used directly)
├── package.json                                  name/description only, no real deps
├── lib/
│   ├── parser.js                                 reads the native source -> raw intermediate entities
│   └── normalize.js                               stableId + cross-reference normalization (R3)
├── test/
│   └── test-lif-parser.js
└── assets/standardSourceData/
    └── 01/                                        one SNAPSHOT directory (see §5)
        ├── data_model_1_bare_openapi_schema.1.json   the actual source file
        └── standardSourceLocation                     provenance metadata (see §5)
```

**There is no central standard registry.** A forge bundle *is* its own registration: the discovery
loader (`resolveBundle` in `apps/graph-builder/apps/forger/forger.js`) looks for
`forges/<token>/parserDescriptor.ini` and reads a required `[parserDescriptor]` section. The section
header is mandatory — `qtools-config-file-processor` silently **discards sectionless keys**, so a
missing or mistyped header makes every key in the file invisible at once; the forger's own refusal
message spells this out (`forger.js`, the "REGISTERS NOTHING" refusal).

`forges/lif/parserDescriptor.ini`, section body in full:

```ini
[parserDescriptor]
standardName=LIF
displayName=LIF
entryModule=forgeLif.js
# defaultSnapshot is an explicit pin (spec §15-6): dropping a new snapshot changes NOTHING until this line says so.
defaultSnapshot=01
# source is a specific FILE within the snapshot directory (file-bound parser).
sourceFile=data_model_1_bare_openapi_schema.1.json
```

Required keys, each individually refused-by-name if missing or blank (`forger.js`, `resolveBundle`):

| Key | Meaning |
|---|---|
| `standardName` | The name this standard is *called* — flows into reports, block-header naming, and every node description. **There is no substitution from the directory token** (a deleted `standardName=` key used to silently rename `LIF` to `lif` everywhere; that behavior was removed on purpose — the refusal comment in `resolveBundle` tells the story). |
| `entryModule` | The forge's entry file, e.g. `forgeLif.js`. |
| `defaultSnapshot` | Which snapshot directory (§5) a bare `version: "current"` resolves to when the recipe names no `source` override. |
| `sourceFile` | *Optional.* Present for a single-file parser (LIF, CEDS, CASE, CTDL-family, CIP, CLR, DCTAP, eduAPI, OpenBadges). **Omitted** for a directory-source standard whose parser wants the whole snapshot directory — currently `edfi`, `jedx`, `medbiquitous`, `pesc`, `sedm`, `sif`, `soc` (verified by grepping every descriptor in the tree). |

**"Known forges" listing.** When a standard token doesn't resolve, the forger reports every
directory under `forges/` that *does* carry a `parserDescriptor.ini` — this is how you self-check
that your new bundle was discovered at all. The same rule is exposed as `graphBuilder -deps`
(`deps` in `apps/graph-builder/lib/actions.js`), which applies the identical "does the descriptor
exist and does its `entryModule` file exist" test, so what `-deps` advertises and what the forger
will actually accept can never disagree.

Note: `forges/bridges/`, `forges/README.md`, and this file are **not** forge bundles — they hold no
`parserDescriptor.ini`, so the discovery scan correctly skips them (`forges/bridges/` is the
forges-shared bridge search scope; see the [bridge guide](./README_bridgeProgrammingGuide.md)).

**`forges/sif/`** is the bundle to study if your standard's source carries element order (§4) or if
its mapped role wants a companion bridge directory: it has the same shape as `forges/lif/` plus
`bridges/sifEvidenceBridge.js` (a custom evidence bridge — bridge guide §5) and the tree's first
sequence-contract call (§4 below). `forges/case/` carries the other custom bridge,
`bridges/caseEvidenceBridge.js`.

---

## 3. The forge contract

### 3.1 What `forge()` must produce

Every forge bundle's default export is a curried `moduleFunction`:

```js
module.exports = ({ moduleName }) => ({ embedder } = {}) => {
  const forge = ({ sourcePath, owner, embedNodeLimit, skipEmbedding } = {}, callback) => { ... };
  return { forge, buildContractGraph, STANDARD_KEY, STABLE_URI_PROPERTY_NAME };
};
```

verified identically in `forges/lif/forgeLif.js`, `forges/ceds/forgeCeds.js`, and
`forges/sif/forgeSif.js:140-142,740-746` (SIF additionally exports `STANDARD_SOURCE`). The forger
calls it as `require(entryPath)({ embedder })` — `embedder` is the *only* dependency injected in,
and it is `null` when `vectorize:false` (§7.2).

`forge(spec, callback)` is **error-first callback style** (`callback(errString, result)`, never
`throw` across the async boundary) and internally runs a 3-step `taskListPlus` pipeline
(`forges/sif/forgeSif.js:657-738` is the current cleanest worked example):

1. **parse** — read the native source into raw intermediate entities (never touches the universal
   shape), then stamp the snapshot-provenance triple (§5.2) onto `parsed.metadata`.
2. **buildContractGraph** — PURE, synchronous. Raw entities -> `{ nodes, edges }` in the universal
   contract. Wrapped in a local `try/catch` *only* at this one boundary, to translate a thrown
   `Error` into the callback's error string (`forgeSif.js:684-703`) — this is the one sanctioned
   use of try/catch in this codebase (boundary containment of a pure function's throw, not control
   flow).
3. **embedNodes** — batched, async, calls the injected `embedder.embedTexts`. Skipped entirely when
   `skipEmbedding` is true.

The callback's success payload (`forgeSif.js:728-737`):

```js
callback('', {
  nodes, edges, metadata, embedCallCount,
  standardKey,               // e.g. 'sif' — lowercase token
  stableUriPropertyName,     // e.g. 'sifStableId' — see §3.2
});
```

(SIF also returns a `stats` object of counts — dangling edges, expanded option values, codeset
dedup figures — surfaced, never silent. Copy that habit.)

### 3.2 The universal node shape and the stableId contract

Every forge emits exactly **six canonical roles** (`DME_ROLES`,
`lib/vocabulary/vocabulary.js:47-54`):

```
DmeStandardRoot   DmeClass   DmeProperty   DmeOptionSet   DmeOptionValue   DmeSupport
```

Every node (see `makeNode`, `forges/sif/forgeSif.js:291-314`) carries:

- `labels: [NODE_LABELS.FORGED_NODE, <perStandardLabel>, <role>]` — `FORGED_NODE` ("ForgedNode") is
  the universal structural label that scopes content-equality/fingerprint checks
  (`lib/vocabulary/vocabulary.js:41-42`); `perStandardLabel` is your standard's own flavor label
  (`SifObject`, `SifField`, `LifEntity`, ...) — not shared, not enforced beyond convention.
- `stableId` — **the value under `stableUriPropertyName`.** This is the single most important
  design decision your forge makes (§3.2.1).
- `role` — one of the six `DME_ROLES`.
- `properties._id` — deterministic from natural keys, never a random UUID. LIF/CEDS use
  `"<standardKey>:<naturalKey>"`; SIF sets `_id === stableId` (both deterministic from the same
  natural key, `forgeSif.js:298`).
- `properties._source` — the standard's canonical name string (`'LIF'`, `'CEDS'`, `'SIF'`), stamped
  identically on every node the forge produces. **`_source` purity is enforced downstream**: every
  forged node's `_source` must be non-null, and every legitimately source-less node (schema-view,
  self-doc, provenance nodes) instead carries a `:GraphMeta` label, so
  `(_source IS NOT NULL) XOR (:GraphMeta)` holds for every node in the graph (the "G2 purity gate";
  `GRAPH_META` in `lib/vocabulary/vocabulary.js`).
- `properties.searchText` — built by the ONE shared builder, never hand-rolled (§3.2.2).
  **Empty throws.**
- `properties.description` — free text, `|| ''`. **`searchText` is never built from `description`**
  (comment at the top of `lib/search-text/build-search-text.js`) — this is the answer to "why do I
  have both a description and a searchText field."
- Required universal set: `['_id', '_source', 'name', 'role', 'searchText']`
  (`REQUIRED_PROPERTIES.NODE`, `lib/vocabulary/vocabulary.js`). The `DmeStandardRoot` additionally
  requires the provenance block: `standardKey`, `standardName`, `version`, `sourceFormat`,
  `sourceFiles`, `sourceUrl`, `stableUriPropertyName`, `mappingInstruction`
  (`REQUIRED_PROPERTIES.STANDARD_ROOT`).

#### 3.2.1 stableId — the universal identity contract

Every standard names, on its `DmeStandardRoot` node, a **`stableUriPropertyName`** — the property
that carries this standard's stable identifier, and that identifier *is* the node's `stableId`.
Three case studies, all real:

- **CEDS** (`forges/ceds/forgeCeds.js`): `STABLE_URI_PROPERTY_NAME = 'uri'`. CEDS has native URIs;
  the `stableId` *is* that URI.
- **LIF** (`forges/lif/forgeLif.js`): `STABLE_URI_PROPERTY_NAME = 'lifPath'`. LIF's OpenAPI schema
  has **no native per-element URI at all** — its identity is *structural*: the forge mints a clean,
  deterministic dotted locator from the schema shape itself, built by `buildLifPath` in
  `forges/lif/lib/normalize.js`. A miss (no usable segment) is a hard throw, never a silently-blank
  id.
- **SIF** (`forges/sif/forgeSif.js:63`): `STABLE_URI_PROPERTY_NAME = 'sifStableId'`, a synthetic
  `sif:<kind>/<naturalKey>` path minted by `buildStableId` in `forges/sif/lib/normalize.js` (SIF's
  native `RefId` is instance-level, so a path-based key was ruled correct). `isCleanStableId` is
  the R3 predicate the tests assert against; an unclean or empty id throws at forge time
  (`forgeSif.js:150-161`).

If your standard has no native URIs (very common — OpenAPI schemas, XSD sets, TSVs), follow the
LIF/SIF pattern: mint a structural path from the parse tree and name your own
`stableUriPropertyName`. `forges/case/lib/normalize.js` does the identical thing for CASE
(`casePath`, e.g. `case:CFAssociation.associationType`).

#### 3.2.2 searchText — the ONE shared builder

Every forge calls the **same** function, `buildSearchText` from
`lib/search-text/build-search-text.js`, never a hand-rolled join. It is a per-role,
structural-context-only builder (never reads `description`) that pipe-joins segments and **throws a
`ValidationError` at forge time** if the result would be empty. Registry of per-role segment
builders (read the module for the source of truth):

```
DmeStandardRoot -> [standardName, name]
DmeClass        -> [standardName, owningName, name]
DmeProperty     -> [owningClassName || owningName, name]        // ALWAYS carries owning class
DmeOptionSet    -> [owningClassName || owningName, name]
DmeOptionValue  -> [owningClassName, owningName || optionSetName, optionSetName, name]
DmeSupport      -> [standardName, owningName, name]
```

A `DmeProperty` *always* carries its owning class name in `searchText` — called out explicitly in
code comments as "the CEDS hub fix" (`build-search-text.js`), because early on properties were
embedded without their owning context and retrieval quality suffered. **Do not omit
`owningClassName`/`owningName` for your `DmeProperty` nodes.**

#### 3.2.3 crossRefs — bridge fuel, stashed not resolved

If your standard carries a *native* pointer to CEDS in its own source text (LIF's harvested
`ceds.ed.gov/element/NNN` URLs embedded in prose; SIF's `'CEDS ID'` TSV column), your forge should
normalize that pointer to a canonical CEDS id and stamp it into `properties.crossRefs` (a
JSON-stringified array of `{system, id, raw, locator}` — see `forgeSif.js:383-402` for the current
worked example) *and* into `properties.cedsId` when the anchor is CEDS-property-shaped
(`P######`). This is optional — most standards have no such native anchor and get `crossRefs: '[]'`,
stamped universally by the structural-contract finalizer (§3.4) whether or not the producer supplied
one.

**This is the purity rule in miniature: the forge STASHES bridge data, it never RESOLVES it.**
`crossRefs`/`cedsId` are raw, harvested, canonicalized *references* — the actual CEDS mapping edges
are produced later, by a bridge (see the [bridge guide](./README_bridgeProgrammingGuide.md)), which
may or may not use them as one signal. A forge that reached into CEDS to resolve its own mappings
would no longer be a pure function of its own source. (The payoff is real: SIF's stashed `cedsId`
anchors become `sifEvidenceBridge`'s strongest nomination channel — bridge guide §5.2.)

Normalization is strict: a present-but-unnormalizable anchor is a **thrown error at forge time**,
never a silently-dropped reference (`normalizeCedsCrossRef` in `forges/sif/lib/normalize.js`;
`normalizeCedsId` in `forges/lif/lib/normalize.js`). This discipline is named "R3" throughout the
forge layer — a mapping that cannot be canonicalized cannot pass as data.

### 3.3 The `mappingInstruction` block

Every `DmeStandardRoot` carries a JSON-stringified `mappingInstruction` object
(`forgeSif.js:69-76` is the current template):

```js
{
  cedsOriginalAnchorPropertyName: [...],   // which native field(s) carry the harvested CEDS anchor
  cedsOptionOriginalAnchorPropertyName: [],
  crosswalkPrefix: [],
  crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
  includeInImplied: true,
  impliedTargets: ['CEDS'],
}
```

For CEDS itself this is present-but-empty (CEDS is the hub, not a mapped-in standard). For SIF it
names `'CEDS ID'` as the anchor column. The block is **required on the root** by
`REQUIRED_PROPERTIES.STANDARD_ROOT` (`lib/vocabulary/vocabulary.js`), so you must declare it — but
a grep of `apps/` and `lib/` finds no *runtime* consumer beyond that validation. Declare it
faithfully by copying SIF's pattern; do not assume any particular downstream reads it.

### 3.4 The structural-contract finalizer — call it LAST

Every `buildContractGraph` must end by calling
`finalizeStructuralContract({ nodes, edges })` (`lib/structural-contract/structural-contract.js`) —
the literal last step in every worked forge (`forgeSif.js:599`). This one shared module:

- **Enforces `parentId`'s referent.** `parentId` on every non-root node must resolve to a *member's
  `stableId`* (not its `_id`) — a mismatch throws a diagnostic distinguishing "matches a member
  `_id` — wrong referent stamped" from "matches nothing at all" (`classifyParentReferent`, exported
  for tests).
- **Derives `depth`**, overwriting whatever the producer stamped, as the `parentId`-chain length to
  the root (root = 0).
- **Stamps `crossRefs` universally** — `'[]'` when the producer harvested nothing.
- **Re-parents single-owner `DmeOptionSet`s** to their one owning `DmeProperty` when the producer
  left them root-parented (a multi-owner set honestly stays root-parented).

If your forge stamps `parentId`/`depth`/`path` on nodes as it builds them (all worked examples do),
the finalizer is what makes `parentId` and `depth` *actually correct* — the producer's own depth
stamp is a best-effort input, not the final word.

---

## 4. The sequence contract

*New with the SIF sequence-capture work (2026-07-30). Optional per forge, additive by design, and
governed by one shared module: `lib/sequence-contract/sequence-contract.js`.*

Some standards' sources carry **element order** — the position of a field among its XML siblings,
the order of children under a complex element. That order is real, load-bearing data (it is SIF's
most concrete disambiguator when a leaf name like `Code` recurs on a thousand fields), and it now
has one canonical home instead of a per-standard invention.

### 4.1 The module and the three properties

`finalizeSequence` is called by any forge that can see element order, as one of the *last* steps of
its `buildContractGraph` — **before** `finalizeStructuralContract`, which must stay last per its own
contract (`forgeSif.js:537-550` shows the ordering). Signature:

```js
finalizeSequence({ nodes, orderingByParent }, callback(errString, { nodes }));
```

- `nodes` — the forge's in-progress node array, the SAME array structural-contract works on;
  `node.properties` is mutated in place (that module's own convention).
- `orderingByParent` — `{ [groupKey]: { orderSemantics, members: [stableId, ...] } }`, ONE entry per
  sibling group the parser saw. `groupKey` is never read beyond error-message provenance — key it
  however is convenient. `members` is the ORDERED list of that group's children, named by their own
  `stableId`; **array index IS the ordinal**.

On success, every named member carries three properties — the names come from the vocabulary
registry (`SEQUENCE_PROPERTIES`, `lib/vocabulary/vocabulary.js:620-625`), never restated as
literals:

| Property | Meaning |
|---|---|
| `sequenceOrdinal` | 0-based position of the node within its own sibling group, exactly as the parser saw it. One uniform property name for every standard — no per-certainty name variants. |
| `siblingCount` | The size of that same sibling group (>= 1 — "1 of 1" is real information, stamped honestly, not a degenerate case). |
| `orderSemantics` | `'normative'` or `'document'` — see the honesty rule below. |

### 4.2 The honesty rule

`orderSemantics` is `'normative'` **only when the parser POSITIVELY VERIFIED a schema-ordered
group** (e.g. an `xs:sequence`, where the schema itself makes reordering the children invalid). It
is `'document'` when only document/source order is known — `xs:choice` children, or a source format
that never captured the compositor at all. **A caller that cannot VERIFY normative order MUST say
`'document'`** — the module refuses any value outside
`SEQUENCE_ORDER_SEMANTICS_VALUES = ['normative', 'document']` with a refusal message that states the
rule by name ("a caller that cannot verify schema-ordered semantics must say 'document', never
guess 'normative'", `sequence-contract.js:106-113`). A forge can therefore never *accidentally*
claim schema semantics it never checked; claiming them deliberately without grounds is the one
thing a gate cannot catch, which is why the rule is stated as loudly as it is.

SIF is the honest worked case: its only source is a flattened Implementation-Specification TSV with
**no compositor column anywhere** — the parser only ever sees TSV-row/XPath order — so every group
the SIF forge declares is `'document'`, stated once as a named constant
(`SEQUENCE_ORDER_SEMANTICS_HERE = 'document'`, `forgeSif.js:228`) with the grounding written out in
the SEQUENCE CAPTURE comment block above it (`forgeSif.js:188-227`).

### 4.3 Additive-only, identity-stable

The three properties are **EXTRA properties on already-built nodes**. The module never reads or
writes `stableId`, `parentId`, `path`, `depth`, or any other addressing/identity slot — a forge
that never calls `finalizeSequence` is byte-unchanged; a forge that does call it gains exactly
these three properties on the nodes named in `orderingByParent`, and nothing else moves. This is
the P4 address-stability ruling carried forward: extend additively, never change what an existing
address is keyed on (the same ruling behind CEDS's `allDomainIds`/`allDomainNames` — §8).

The module is pure, synchronous, deterministic, and **callback-shaped** (the R7 house ruling — see
the bridge guide §3.4): a malformed input is refused BY NAME via `callback(errString)`, never
thrown. Refusals: `nodes` not an array; `orderingByParent` not a plain object; a group whose
`orderSemantics` is outside the enum; empty `members`; a duplicate member; a member `stableId` that
resolves to no node in `nodes` ("never stamp an unresolvable member"). Its test suite is
`lib/sequence-contract/test/test-sequence-contract.js`.

### 4.4 forgeSif.js — the first caller, and the owner-scoping ruling

`forges/sif/forgeSif.js` is the first (currently only) caller, and its SEQUENCE CAPTURE comments
(`forgeSif.js:188-227`, plus the two capture sites at `forgeSif.js:415-446` and
`forgeSif.js:448-478`) carry a ruling any future caller must understand. SIF declares **two
disjoint sibling-group families**, and they are scoped *differently*, on purpose:

- **Field groups ARE owner-scoped** — keyed
  `sif:fieldGroup:<owningObjectName>:<pathSegments>` (nested) or
  `sif:fieldGroup:root:<objectName>` (direct children of the object). **Why: field nodes are
  per-object.** A `SifField` is a distinct forged node for each owning `SifObject`, even when it
  shares a relative path with fields in other objects. The original implementation keyed nested
  groups on `pathSegments` alone (which the parser had already made object-relative), so a shared
  nested shape — `SIF_Metadata/TimeElements/TimeElement`, reused by 136 different SifObjects —
  silently merged into ONE cross-object group: 268 of 1,873 field groups merged, 10,933 of 15,620
  fields (70%) sat in a merged group, worst case 952 members from 136 objects (measured against the
  real asset; the fix comment at the capture site carries these numbers). Folding the owning
  object's name into the key scopes each group to one object's contiguous TSV rows, making
  per-owner ordinals correct by construction.
- **Element groups are NOT owner-scoped — deliberately.** A `SifXmlElement` is already **deduped to
  ONE node per relativePath** (the parser's `elementMap` is global; `isShared` marks exactly this),
  so its `CHILD_ELEMENT` children ARE the one merged tree the forged graph actually contains —
  scoping by owner would fabricate distinctions the node model doesn't carry. The asymmetry is
  called out in the code as deliberate, not an oversight: element-level `siblingCount` can
  legitimately exceed what any single document instance shows; field-level `siblingCount` must not.
  Root elements (depth 1) are deliberately not grouped at all — a depth-1 relativePath (`Name`) can
  root multiple unrelated SifObjects, and forcing one group would silently pick a winner.

The general ruling to carry into your own forge: **scope each sibling group to match the identity
model of the nodes in it** — per-owner groups for per-owner nodes, merged groups for genuinely
shared (deduped) nodes.

SIF also stamps two SIF-local convenience scalars, `sequenceGroupKey` and `sequenceGroupLabel`
(`forgeSif.js:441-442`) — *not* part of the canonical vocabulary — so its bridge can read a
human-legible group name without a graph walk (the bridge guide's sequence-aware sibling context
reads exactly these). The verification test is `forges/sif/test/test-sequence-ordinal.js`.

---

## 5. Source data and versions

### 5.1 Snapshot layout

```
forges/<token>/assets/standardSourceData/
  01/
    <source file(s) or the whole directory, per the parser>
    standardSourceLocation      <- provenance metadata, NOT parsed, just recorded
  02/
    ...
```

Each numbered subdirectory is a **snapshot** — one dated pull of the standard's source. The
descriptor's `defaultSnapshot` key names which one a bare `version: "current"` resolves to (§2).
`standardSourceLocation` is a small plain-text provenance record, not machine-consumed by the
parser; LIF's (`forges/lif/assets/standardSourceData/01/standardSourceLocation`) is a representative
shape:

```
standard: forge-lif
publishedVersion: 2.0
publishedVersionEvidence: openapi info.version, "Machine-Readable Schema for LIF"
upstreamUrl: unknown (A4L-internal LIF schema; no public URL recorded)
copiedFrom: /path/to/original/source
copiedDate: 2026-05-28
```

### 5.2 The snapshot-provenance triple

Every forge, after parsing, calls `deriveVersionStamp`
(`lib/snapshot-provenance/snapshot-provenance.js`) to stamp three fields onto its metadata — see
`forgeSif.js:668-678` for the live call shape:

| Field | Meaning |
|---|---|
| `snapshotKey` | The snapshot directory name (`'01'`), derived by walking up from `sourcePath` until the parent is `standardSourceData/`. |
| `publishedVersion` | The honest published version string. |
| `versionSource` | One of `'spec'` (the parser itself read a version out of the self-describing source — wins over the provenance file), `'provenance-file'` (the source doesn't self-describe; the file supplies it), or `'unknown'` (neither supplies it — **stamped honestly, never fabricated**). |

A disagreement between what the source says and what `standardSourceLocation` says is **warned with
both values named, never silently resolved** — the source always wins when it self-describes.

### 5.3 `'current'` is a recipe directive, resolved and thrown away

A recipe names `"version": "current"` (every worked recipe in `recipes/` does this). This token is
**never persisted**. At forge time, `build.js` composes the block's real, explicit, persisted
version from the snapshot-provenance triple the forge actually read (`explicitVersionFrom`,
`apps/graph-builder/lib/build.js`):

```js
const explicitVersionFrom = ({ versionSource, publishedVersion, snapshotKey }) =>
  versionSource === 'unknown' ? `unknown_${snapshotKey}` : `${publishedVersion}`;
```

So a source that genuinely has no version stamps as `unknown_01` — an honest, disk-traceable
placeholder, never a value that merely *looks* like a version. The recipe's floating `'current'`
never reaches a content-addressed block, a block subject, or `blocks.version`.

---

## 6. Purity rules

Collected here because they are the forge layer's identity, not incidental style:

1. **A forge is a pure function of its own source.** `buildContractGraph` — pure, synchronous,
   deterministic; same source -> byte-identical nodes/edges. No I/O, no clock, no graph access, no
   network. The one wall-clock temptation is called out in the code: `ingestedAt` is deliberately
   NOT stamped into node properties, because a timestamp inside content-addressed block text broke
   same-source -> same-blockId determinism (`forgeSif.js:347-349`) — run timestamps live in the
   store row (`blocks.createdAt`), never in block text.
2. **Standard-pure blocks.** A standard's base block contains that standard and nothing else — no
   other standard's nodes, no mapping edges. The G2 gate (§3.2) polices `_source` purity
   graph-wide.
3. **Bridge data is stashed, not resolved** (§3.2.3). Harvest and canonicalize native cross-standard
   anchors into `crossRefs`/`cedsId`; never emit a mapping edge from a forge. Mapping is the bridge
   layer's job, with its own evidence discipline — see the
   [bridge guide](./README_bridgeProgrammingGuide.md).
4. **The embedding pass is isolated.** `embedNodes` is the only non-deterministic step, injected
   (`embedder`), batched (SIF uses `EMBED_BATCH_SIZE = 128`), and skippable (`skipEmbedding`), so
   the structural shape can be tested and diffed with zero spend.
5. **Structural edges are stamped `'structural'`.** Every edge requires a `provenanceTier`
   (`REQUIRED_PROPERTIES.EDGE`), one of `PROVENANCE_TIERS`: `spec-authoritative`,
   `embedding-inferred`, `structural`, `user-asserted` (`lib/vocabulary/vocabulary.js`).
   Ownership/reference edges from a forge (`HAS_CLASS`, `HAS_PROPERTY`, `HAS_OPTION_SET`,
   `HAS_VALUE`, `HAS_SUPPORT`, `REFERENCES`) are all `'structural'`; inferred mapping tiers are
   stamped by the bridge materializer, never by your forge.
6. **A partial edge is never emitted.** An edge endpoint that fails to resolve is recorded and the
   whole forge throws with a count and a first-offender sample (`forgeSif.js:590-594`) — not
   silently skipped.

---

## 7. Your first build

### 7.1 A single-standard recipe

Copy the shape of `forges/sif/sif.forgeRecipe.jsonc` for a quick smoke, or (more usefully once you
have two standards) write a *build* recipe under `recipes/`. The build-recipe schema is enforced by
`RECIPE_SCHEMA` in `apps/graph-builder/lib/recipe.js` (strict — `additionalProperties: false`).
Minimum shape for "just my one standard, no hub, no bridge":

```jsonc
{
  "schemaVersion": "1.0.0",
  "recipeName": "xyzOnly",
  "kind": "dev",
  "description": "XYZ alone, no hub, no bridge — smoke test.",
  "standards": [
    { "token": "xyz", "version": "current" }
  ],
  "hubs": [],
  "bridges": []
}
```

(Compare `recipes/sifOnly.recipe.jsonc` or `recipes/lifOnly.recipe.jsonc` for the real
single-standard shape, and `recipes/allStandardsNoBridges.recipe.jsonc` for the "every standard, no
hub, no bridges" base-load recipe — all real, live recipes in the tree.)

`recipeName` and `description` are **both required at the `build.js` level**, not just the schema
layer — a manifest with no `recipeName` cannot be found again, and a `description`-less manifest of
sha256 addresses is unreadable to a human (the refusals in `build.js` say exactly this).

### 7.2 The CLI

```
graphBuilder -build \
  --recipePath=recipes/xyzOnly.recipe.jsonc \
  --standardsDatabaseFilePath=/path/to/scratch/standards.sqlite \
  --vectorize=false
```

Flags, always shown with values (`apps/graph-builder/lib/help.js`):

| Flag | Required? | Meaning |
|---|---|---|
| `--recipePath=<path>` | yes (or a positional) | The recipe file. |
| `--standardsDatabaseFilePath=<path>` | **yes, no default** | Where harvested blocks + the manifest are written. A build that doesn't say where it writes is refused. |
| `--decisionStoreFilePath=<path>` | optional | Where frozen bridge decision blocks live. Defaults to a sibling of the standards database (`<name>.decisions<ext>`) (`decisionStorePathFrom`, `apps/graph-builder/lib/actions.js`). |
| `--rebridge=all` or `--rebridge=<token>[,<token>...]` | optional, default **none** | Scope the semantic re-inference — bridge guide §4. A **value flag**, not a bare switch. |
| `--vectorize=true` \| `--vectorize=false` | optional-looking but **required by the forger, no default** | Whether the real forge spends Voyage embedding credit. **Only the literal strings `'true'`/`'false'` are accepted** — `'yes'`/`'1'` are refused by name, not coerced (`'false'` as a truthy string once caused a spend; the refusal comment in `forger.js` tells the story). For a first smoke build of a brand-new forge, pass `--vectorize=false` — you get structural nodes/edges with no vectors and spend nothing. |
| `--embeddingCacheFilePath=<path>` | optional | Redirect the shared content-addressed vector cache (on by default) — e.g. point a test at a throwaway cache. |

Recipe **validation is layered** (`apps/graph-builder/lib/recipe.js`): Layer 1 is strict JSON Schema
(structural); Layer 2a is *referential* (every `hub.standard`/`bridge.source`/`bridge.hub`/
`bridge.dependencies` token must actually appear in `standards[]`); Layer 2b is *resolvability*
(does a forge bundle actually exist for every named token). You can check what your recipe means
before spending anything:

```
graphBuilder -validate --recipePath=recipes/xyzOnly.recipe.jsonc
```

### 7.3 What comes back

`graphBuilder -build ...` prints `{ manifestId, boltUrl }` on stdout (progress goes to stderr) —
the result shape is composed in `materializeSchemaBlocks` (`apps/graph-builder/lib/build.js`).
`manifestId` is the manifest's `refId` (a hash of its block membership); `boltUrl` is the freshly
provisioned scratch graph you can query directly.

**Every scratch graph this tree provisions is `DEV_*`-named**, enforced *before* any `docker`
command runs, refusing `GOLD_*`/`gf_*` by regex (`nameRefusal`,
`apps/graph-builder/apps/replay-manager/replayManager.js`) — see GNC-001 in §8. A default-minted
name looks like `DEV_gb_<purpose>_<pid>_<seq>`.

### 7.4 Verifying the build

**a) Counts, straight from Cypher against the returned `boltUrl`** (using `cypher-shell` or any
bolt client):

```cypher
MATCH (n:ForgedNode {_source: 'XYZ'}) RETURN count(n);
MATCH (n:ForgedNode {_source: 'XYZ', role: 'DmeProperty'}) RETURN count(n);
MATCH ()-[r:HAS_PROPERTY]->() RETURN count(r);
```

If your forge stamps sequence properties (§4), verify them too:

```cypher
MATCH (n:ForgedNode {_source: 'XYZ'})
WHERE n.sequenceOrdinal IS NOT NULL
RETURN n.orderSemantics, count(n);
```

**b) Store inspection with `sqlite3`** — the standards database is a plain SQLite file with three
tables (`lib/standards-database/standards-database.js`): `blocks(refId, kind, subject, version,
requires, text, producedBy, createdAt)`, `manifests(refId, name, description, recipeName, ...)`,
`manifestBlocks(manifestRefId, schemaBlockRefId, position, description)`.

```bash
sqlite3 /path/to/scratch/standards.sqlite \
  "SELECT refId, kind, subject, version, length(text) FROM blocks WHERE subject LIKE 'xyz@%';"
```

You should see one row with `kind = 'standardBase'` and a `subject` ending in `_base` — the subject
marker is *derived from the kind*, so the two can never silently disagree
(`SCHEMA_BLOCK_KIND_SUFFIX`, `lib/vocabulary/vocabulary.js`).

**c) Block-text parsing directly**, if you want to see the raw block your forge produced without a
live graph — `lib/replay/replay-block.js` exports `deserializeBlock(blockText)`, callable from a
one-off `node -e`:

```bash
node -e "
  const { deserializeBlock } = require('./lib/replay/replay-block')();
  const db = require('better-sqlite3')('/path/to/scratch/standards.sqlite');
  const row = db.prepare(\"SELECT text FROM blocks WHERE subject LIKE 'xyz@%_base'\").get();
  const parsed = deserializeBlock(row.text);
  console.log(parsed.nodes.length, 'nodes,', parsed.edges.length, 'edges');
"
```

**d) The test suite.** `npm test` runs `node test/runAllTests.js` (`package.json`). Look at
`forges/lif/test/test-lif-parser.js` for a parser-level test, `forges/sif/test/test-r3-canonical.js`
for the stableId/canonicalization discipline, and `forges/sif/test/test-sequence-ordinal.js` for a
sequence-capture verification — all shapes worth imitating for your own bundle.

---

## 8. The rules that bite

Each of these is enforced *before* a write happens, and each names itself explicitly in its refusal
message — deliberate house style ("refuse-by-value," `polyArch2 §6`, cited throughout the
codebase's own comments). The bridge-side rules (substrate scan, vocabulary guard, contract gates)
live in the [bridge guide](./README_bridgeProgrammingGuide.md) §6; these are the ones a forge
author hits.

**One vocabulary file.** Node labels, edge types, provenance tiers, SKOS predicates,
required-property sets, and now the sequence-property names all come from **one file**,
`lib/vocabulary/vocabulary.js` — nothing downstream hardcodes its own copy, and neither should your
forge (`forgeSif.js` requires `NODE_LABELS`, `DME_ROLES`, `EDGE_TYPES`, `PROVENANCE_TIER` from it;
`sequence-contract.js` requires `SEQUENCE_PROPERTIES` from it). **There is no `matchType` field
anywhere in this codebase** — the mapping stamp on an edge is `predicate`
(`MAPPING_PROPERTIES.PREDICATE`), one of the five `SKOS_PREDICATES` (`exactMatch`, `closeMatch`,
`broadMatch`, `narrowMatch`, `relatedMatch`). If you encounter `matchType` anywhere it is stale or
wrong.

**Refuse-by-value doctrine, everywhere.** A required value that is absent, wrong-typed, or a
suspicious string masquerading as a boolean (`'false'` is truthy!) is refused **by name**, never
silently defaulted or coerced. The forger's `vectorize` knob is the canonical example — it has *no*
default on purpose, checked *before* any bundle is resolved or Voyage client constructed, so a
missing spend-decision costs nothing (`forger.js`). The same discipline governs `version`,
`deriveHub`, and essentially every constructor/entry point in the tree. Write your forge's own
refusals the same way.

**No relative `require` deeper than the parent — matched by convention, not yet enforced.** Both
worked forges climb two levels via a single named constant,
`const CORE_LIB = path.join(__dirname, '..', '..', 'lib')` (`forgeSif.js:39`, `forgeLif.js:43`).
**Match that pattern** rather than inlining `require('../../../lib/...')` literals or inventing a
new resolution mechanism. (Bridge files under `forges/<token>/bridges/` sit one level deeper and
climb three — see the bridge exemplars.)

**Never `require` anything that pulls in `sqlite-instance` at module load time.**
`sqlite-instance` **destructures `process.global` at require time**, and `process.global` is not
bootstrapped yet when `graphBuilder.js`'s entry file first requires its action modules — so a
top-level `require` of `standards-database` or `decision-store` would kill even `-help`. Both are
required **lazily, inside the function that needs them** (`requireStandardsDatabase`/
`requireDecisionStore` in `apps/graph-builder/lib/actions.js`). If your forge or bridge ever needs
either module, require it inside a function body, not at the top of the file.

**Extend additively; never change what an address is keyed on.** The standing precedent is CEDS's
`allDomainIds`/`allDomainNames` (`forges/ceds/forgeCeds.js`): a CEDS property can belong to more
than one owning class, but the *address-bearing* slot (`domainId`) always takes only the first
resolvable domain, byte-unchanged from historical behavior — the full list is stamped as a NEW,
additional property that nothing address-bearing reads. The sequence contract (§4) is written to
the same ruling. If your standard has an analogous "one canonical slot, but here's the whole truth
too" situation, this is the pattern.

**GNC-001 — graph naming.** `DEV_<label>` = scratch/verification, ephemeral, never a golden — a
single- or few-standard rig (exactly what you'll be building while developing a new forge) is
*always* `DEV_`. `GOLD_EVAL_<YYMMDD>[_label]` = a full all-standards golden under evaluation.
`GOLD_<YYMMDD>[_label]` = declared gold — a *rename* of the exact evaluated container, never a
rebuild. Enforced in code, not just convention (`nameRefusal`, `replayManager.js`). As a new-forge
author you will only ever see `DEV_*` containers.

---

## 9. Checklist: empty directory to verified base block

1. **Scaffold the bundle.** `forges/<token>/` with `parserDescriptor.ini` (`[parserDescriptor]`
   section, `standardName`, `entryModule`, `defaultSnapshot`, optional `sourceFile`),
   `<entryModule>.js`, `lib/parser.js`, `lib/normalize.js`, `assets/standardSourceData/01/` with
   your source file(s) + a `standardSourceLocation` provenance record.
2. **Write the parser.** Read the native source into raw intermediate entities only — no node
   shaping, no Neo4j, no embeddings. Follow `forges/lif/lib/parser.js`'s callback shape.
3. **Decide your `stableUriPropertyName`.** Native URI (CEDS pattern) or minted structural path
   (LIF/SIF/CASE pattern). Write the corresponding `lib/normalize.js` with a clean-form predicate
   and a builder that throws on a miss.
4. **Write `buildContractGraph`.** Pure, synchronous. Emit the six `DME_ROLES`, universal
   properties (`_id`, `_source`, `name`, `role`, `searchText` via the ONE shared builder),
   `crossRefs` (harvest + normalize any native CEDS pointer, or leave empty), and
   `mappingInstruction` on the root.
5. **If your source carries element order, capture it** via `finalizeSequence`
   (`lib/sequence-contract`) — sibling groups scoped to your nodes' identity model (§4.4), honest
   `orderSemantics` (§4.2), called *before* the structural finalizer.
6. **End with `finalizeStructuralContract`.** The literal last line of `buildContractGraph`.
7. **Wire `forge()`.** `taskListPlus` pipeline: parse (+ `deriveVersionStamp`) ->
   `buildContractGraph` (wrapped in the one sanctioned local try/catch) -> `embedNodes` (skippable
   via `skipEmbedding`). Return the standard
   `{ nodes, edges, metadata, embedCallCount, standardKey, stableUriPropertyName }` shape.
8. **Confirm discovery.** `graphBuilder -deps` lists your token; `resolveBundle` resolves it with
   no error.
9. **Write a smoke recipe** naming only your standard, `hubs: []`, `bridges: []`.
   `graphBuilder -validate` clean, then `graphBuilder -build --vectorize=false` clean.
10. **Verify the base block.** Counts via Cypher against the returned `boltUrl`; row present in
    `blocks` with `kind='standardBase'` and a `_base`-suffixed subject; parse the block text
    directly with `deserializeBlock` if you want raw node/edge counts without touching Neo4j.
11. **Run with real embeddings.** `--vectorize=true` once the structural shape is right — confirms
    your `searchText` builder never throws across your real dataset.
12. **`npm test`** before calling it done.
13. **Then cross to the mapping side.** Pairing your standard with CEDS — zero-code or custom — is
    the [bridge guide](./README_bridgeProgrammingGuide.md)'s whole subject.
