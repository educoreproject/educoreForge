# Forges — how to implement one

A forge turns one standard's source document into the universal contract graph. That is the whole job. It reads `ctdlasn.json` (or a `.rdf`, or an OpenAPI `.json`) and emits nodes and edges shaped to the same contract every other standard already speaks. It never touches Neo4j, never writes a block, never knows what a manifest is. Parse, shape, embed, hand back objects. Done.

Everything downstream — loading, harvesting, content-addressing, materializing, bridging — belongs to the graph-builder app. The seam is deliberate and it is clean: a forge is a pure factory, and the forger app is the only thing that spends Docker and embedding credit on its behalf.

## A bundle is its own registration

There is no central registry of standards. There used to be; it was deleted. A forge bundle registers itself with one file: `forges/<standard>/parserDescriptor.ini`.

```ini
[parserDescriptor]
standardName=CTDLASN
displayName=Credential Transparency Description Language — Achievement Standards Network (CTDL-ASN)
entryModule=forgeCtdlasn.js
defaultSnapshot=01
sourceFile=ctdlasn.json
```

The `[parserDescriptor]` section header is required — `qtools-config-file-processor` drops sectionless keys, and the forger reads an absent section as *this bundle registers nothing* and refuses by name. `standardName` must be unique among enabled bundles (`CTDLASN` is not `CTDL`) and it is used verbatim, no lowercasing anywhere. `entryModule` is the forge file the forger will `require`. `defaultSnapshot` pins which `assets/standardSourceData/<NN>/` directory is live — dropping a newer snapshot changes nothing until this line says so. `sourceFile` names the exact file inside that snapshot.

That is the entire contract with the discovery loader. Write the descriptor, drop the bundle in `forges/`, and `resolveBundle` finds it.

## The shape on disk

A forge bundle is three source files, an assets directory, and the descriptor:

```
forges/ctdlasn/
  parserDescriptor.ini          # the registration (above)
  forgeCtdlasn.js               # entryModule: the factory + buildContractGraph + forge()
  lib/parser.js                 # source-format -> native nodes
  lib/normalize.js              # id/crossRef normalization helpers
  assets/standardSourceData/01/ # the pinned source document(s)
  package.json                  # marks this dir as a test module (see "Prove it")
  test/                         # test-*.js gates
```

`package.json` is not vestigial. `runAllTests.js` treats *any directory under `forges/` or `apps/` carrying a `package.json`* as a discovered test module, so a bundle with a `package.json` and no `test/` is reported UNTESTED on every run rather than vanishing silently. Keep it.

## The pipeline is three steps, and the middle one is pure

The entry module exports a curried factory — `module.exports = moduleFunction({ moduleName })` — that takes `{ embedder }` and returns `{ forge, buildContractGraph }`.

```
forge({ sourcePath, skipEmbedding, ... })  ->  parse  ->  buildContractGraph  ->  embedNodes
```

1. **parse** (`lib/parser.js`) reads the source document and returns native nodes — the standard's own vocabulary, barely touched. This is the one genuinely per-standard step, because a JSON-LD `@graph`, an RDF/XML ontology, and an OpenAPI schema have nothing structural in common.
2. **buildContractGraph** translates native nodes into the universal contract — the six DME roles, the canonical ownership edges, stable ids, crossRefs — and calls `finalizeStructuralContract` as its last step. It is PURE, synchronous, and deterministic: same source in, byte-identical `{ nodes, edges }` out, every time. No I/O, no clock, no randomness. The determinism gate depends on this and so does content-addressing.
3. **embedNodes** batches the embeddable nodes through the injected `embedder` and stamps a vector on each. It is the only impure step, and it is skipped entirely when `skipEmbedding` is set (the `--vectorize=false` rehearsal path).

## What buildContractGraph must produce

Reach for the authority, do not reinvent it. The roles, labels, edge types, and provenance tiers live in `lib/vocabulary/vocabulary.js` (`DME_ROLES`, `NODE_LABELS`, `EDGE_TYPES`, `PROVENANCE_TIER`). Import them; never spell a role or an edge type as a string literal in a forge.

`forge()` hands back one object, and every existing forge returns the same shape:

```
{ nodes, edges, metadata, standardKey, stableUriPropertyName }   // JSON-LD family adds: stats
```

- `standardKey` is the lowercase token (`ctdlasn`); `metadata.version` is the version the bundle actually read, not the recipe's token.
- `stableUriPropertyName` names the node property that carries the durable resolution key (for the CTDL family it is `uri`). The harvest reads it, so it must be right.
- Every node that carries a vector must also carry `embeddingModelVersion` — the model that made the vector. This is not decoration.

### The embedding obligation — read this one twice

A node's vector is meaningless without the model that produced it, and a block that carries vectors must declare, in its header, the width (`embeddingDims`) and model (`embeddingModelVersion`) they were made at. Every content address is computed from that model string, so it is carried, never invented.

The forge's part of this bargain is simple: **stamp `embeddingModelVersion` on every embedded node.** Miss it and the block cannot be addressed. On 2026-07-26 the *harvest* side of this same contract was found dropping `embeddingDims` from the block header — every embedded build died on restore, and no green test caught it because the suite was then barred from spending embedding credit. The lesson generalizes past the specific bug: the embedded path is load-bearing and it must be exercised for real. That is why `test-embeddedEndToEnd.js` now spends credit on purpose.

## Shared vs per-standard — the line that actually matters

Certainly it is tempting to write one parser and be done. Resist it. The three source families — JSON-LD (CTDL, CTDL-ASN, CTDL-QData, DCTAP), RDF/XML (CEDS), OpenAPI (LIF) — share no structure at the document level, so `lib/parser.js` and the stable-id model stay per-standard. That is real difference, not duplication.

What IS shared, and what you should never copy by hand, is the substrate under `../../lib`:

- `search-text/build-search-text` — the text a node is embedded from.
- `snapshot-provenance/snapshot-provenance` — `deriveVersionStamp`.
- `vocabulary/vocabulary` — roles, labels, edges, tiers.
- `structural-contract/structural-contract` — `finalizeStructuralContract`, the parentId→member referent, depth derivation, universal crossRef stamping. Always the last step of `buildContractGraph`.

The scaffold — `embedNodes`, the `forge()` task pipeline, the standard-root provenance block — is near-identical across all five bundles and is a live candidate for extraction (see the scoping audit). Until that lands, clone it from the nearest template rather than composing it fresh.

## Porting a standard, start to finish

The incumbent forges under `cli/parserLib/forge-*` are proven. A port is a harvest-and-adapt of one of those into this tree's contract, not a rewrite from the spec.

1. **Pick the template by source family.** JSON-LD → clone `forge-ctdlasn` (the cleanest of the three; no CEDS-anchor special-casing). RDF/XML → `forge-ceds`. OpenAPI → `forge-lif`.
2. **Create `forges/<std>/`** with the four files and `assets/standardSourceData/01/<sourceFile>`.
3. **Write the descriptor** — unique `standardName`, correct `entryModule`, `sourceFile`.
4. **Adapt parser + normalize** to the standard's own vocabulary; leave `buildContractGraph`'s contract translation and the shared-substrate requires alone.
5. **Add a `stdOnly` recipe** in `recipes/` (`hubs: []`, `bridges: []`) — the smallest thing that forges the base and materializes it.

## Prove it, or you have not done it

A forge is done when it matches the gold, not when it runs.

- **Forge it:** `graphBuilder -build --recipePath=recipes/<std>Only.recipe.jsonc --standardsDatabaseFilePath=<throwaway> --vectorize=true`. Never point `--standardsDatabaseFilePath` at the canonical store; a scratch save once overwrote it, which is why there is no default.
- **Golden-verify:** query the materialized DEV graph and `GOLD_260718` for that standard's `_source` nodes and edges and diff them. Same node count, same edges, zero either-only. DCTAP is 36 nodes in the golden; CTDL-ASN is 119; a mismatch of one is a real defect, not rounding.

A forge you have not diffed against the gold is a forge you are hoping about. The gold does not care how careful you were.
