# Forge Creation — Overview

This is the first document of the forge documentation package. It says what a forge is, what the
Forge Framework does for one, and what a new forge has to bring. The step-by-step procedure is the
companion `README_HOWTO_ForgeCreationInstructions.md`. The normative texts are `README_ForgeProfile.md`
(what a forge MUST satisfy) and `README_ForgeFrameworkSpecification.md` (what the framework does and
how it is used). All four sit in this directory; `README.md` here is the index.

## 1. The kitchen

A forge turns one education data standard — Ed-Fi, SIF, PESC, CEDS — into a graph the Data Model
Explorer can serve: nodes for the standard's classes, properties and code values, edges for how they
relate, and one root node that says what the standard is.

Before the framework, every forge was its own restaurant. Each had its own stove, sink, dishwasher and
cash register: its own code to verify source files, stamp a version, build the root node, clean up the
structure, embed the text, and hand the result to the graph builder. Four copies of the same equipment,
each slightly different, each drifting.

Now there is one kitchen. The kitchen owns the equipment. A forge brings three things:

1. **A recipe card** — plain facts about the standard: its name, what its identifiers look like, what
   its root node says, which quirks it still carries. Data, never code.
2. **A cook** — the one part that is genuinely the standard's: how to read its files and walk them
   into nodes and edges. This is the plugin.
3. **A taster** — the round-trip validator that re-emits the source from the graph and confirms
   nothing was invented.

Everything else the kitchen does the same way for everyone.

Two rules keep the kitchen honest. The cook may only put food on the plate with the kitchen's own
utensils — it cannot slip a raw node onto the plate — so the kitchen can guarantee no duplicate
identifiers, no cross-standard edges, no made-up names. And if a forge needs an exception, it declares
it on the card; the kitchen refuses undeclared exceptions and declared-but-unused ones alike.

## 2. What the terms mean

- **Forge** — a bundle under `forges/<standardKey>/` that the graph builder loads by the entry module
  named in its `parserDescriptor.ini`.
- **Block** — the content-addressed record of one forge's output. Its id is a sha256 of the
  canonical text of every node and edge plus a header. Two builds that produce the same bytes produce
  the same id; a one-character change anywhere produces a different id.
- **The seam** — the contract between the graph builder and a forge:
  `require(entryModule)({ embedder })` returns a bundle; `bundle.forge({ sourcePath, owner,
  embedNodeLimit, skipEmbedding }, callback)` returns nodes, edges, metadata and counts. The framework
  satisfies this contract unchanged; the graph builder was not modified.
- **Kit** — the set of utensils the framework hands the cook: `makeNode`, `addEdge`,
  `emitOptionValue`, `carriedProperties`, `crossRefsJson`, `cedsAnchorValue`, `isCleanStableId`,
  `searchTextElementFor`, `rootStableId`.
- **Compatibility declaration** — a named row, keyed by an id from the Profile's punch list, that
  licenses one known departure from the Profile while a forge is migrated byte-identically. Ed-Fi
  declares two: E6 (root `sourceUrl` written as `''`) and E8 (root `sourceFiles` names logical
  inputs rather than verified files).
- **Round trip** — the validator reads the built graph, re-emits statements in the source's own form,
  and diffs them against the source. `inventedTotal` must be 0; `-goldEvalCheck` answers PASS only
  when every declared validator ran and reported that.

## 3. What a forge supplies

**The declaration** (`lib/<std>ForgeDeclaration.js`) is a frozen object: `standardKey`,
`standardSource` (equal to the descriptor's `standardName`), `standardDisplayName`,
`stableUriPropertyName`, `stableIdPattern` (`{ pattern, trimmed }` — the real predicate, as data),
`rootStableIdFrom` and `rootStableId`, `rootLabel`, `parserVersion`, `mappingInstruction` (six keys,
fixed order — the JSON string is a byte of the block), `nonEmbeddableRoleList`,
`cedsAnchorAbsentSentinelList`, `additionalSourceInputList`, `compatibilityDeclarationList`.
Ed-Fi's is 71 lines.

**The hooks** (`lib/<std>Hooks.js`) are functions the framework calls:

| hook | shape | what it owns |
|---|---|---|
| `sourceLoaderList` | one or more `{ loaderName, load({ sourcePath, additionalSourceInputPathByName, xLog }, cb) }` | reading the source (Ed-Fi has three loaders) |
| `describeSource` | `({ parsed }) => { version, selfDescribedVersion, sourceFormat, sourceUrl, sourceFiles }` | what the source says about itself |
| `emitContractGraph` | `({ parsed, metadata, kit }) => { nodes, edges, stats, ...reports }` | the walk — every node and edge, minted through the kit |
| `describeRoot` | `({ parsed, metadata }) => { description?, extraProperties? }` | the root's text |

**The entry module** (`forge<Std>.js`) is one line:
`forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks })`. Ed-Fi's is 33 lines
including its header comment; it was 280 before the migration.

**The validator** (`roundTripValidator.js`) is unchanged by the framework.

## 4. What the framework does

`forge()` runs the same seven steps for every forge:

1. Refuses a missing `sourcePath`, `skipEmbedding: false` with no embedder, or a fifth argument key.
   `owner` is accepted and never read.
2. Verifies every file the loaders will read against the snapshot's `SHA256SUMS`, before any loader
   runs.
3. Runs the loaders and folds their results into one `parsed` object keyed by loader name.
4. Calls `describeSource`, derives the provenance stamp, and refuses a blank version or the recipe
   token `'current'`.
5. Runs the pure layer under the framework's one throw-to-callback adapter: a fresh kit; the root
   built first from declared data; the walk; an integrity pass (every returned node and edge was
   kit-minted and returned exactly once; universal properties re-checked after any post-mint writes);
   `finalizeSequence` then `finalizeStructuralContract`.
6. Embeds: filters by role, then slices to `embedNodeLimit`, batches, counts calls.
7. Returns the walk's arrays in the walk's order, untouched, plus the walk's reports and a compliance
   report naming the active declarations.

The framework has no per-standard branch. Every difference between forges is declaration data, a
hook, or a compatibility declaration. A gate greps for the four standard keys in framework code and
turns red if one appears.

## 5. What the framework refuses to offer

No graph access at forge time. No cross-standard edge (`kit.addEdge` refuses an endpoint from another
source). No hub hook (the CEDS hub is the forger's, outside the seam). No join-key addressing. No
default for an absent declaration key, hook, or seam argument. No clock, no randomness, no process
state in the pure layer. No sorting or deduplication of the walk's output. No round-trip diff engine
(the harness ships the contract; each forge's validator keeps its own diff for now).

## 6. How a forge is proven

A forge on the framework is accepted when, built through the unchanged graph builder under a frozen
command line, it produces the same block id as the forge produced before migration, its round trip
is clean, `-goldEvalCheck` is PASS, and the four-forge manifest reproduces.

Ed-Fi, 2026-08-16: block id `aea6d8dfe7899adef57c5ac3adb6b0df2bfc7e4a4ae859c4fa3893c132c8b304`
measured on the unmigrated forge, then reproduced by the migrated one; four-forge manifest
`97c618c20e07c0c612957def69164402d364a98d5dfee865faacae1deace6382`; goldEvalCheck PASS. An
independent review compared every distinct property-key set per role between the new graph and the
baseline graph — 98 signatures, identical. The block-id gate was observed red: changing
`parserVersion` from `'2'` to `'2a'` moved exactly the root line and the id.

## 7. Where things stand

Ed-Fi is on the framework. SIF, PESC and CEDS are not yet; each has a declared allowance set in the
framework specification (§7.3) and SIF's migration brief is written. Ed-Fi's two compatibility
declarations are still in force; retiring each is its own commit with a deliberately new block id.

## 8. Where to go next

- To write or migrate a forge: `README_HOWTO_ForgeCreationInstructions.md` (this directory), then
  `README_ForgeFrameworkSpecification.md` §8 (the migration recipe) and `forges/edfi/` as the worked example.
- To know what a forge MUST satisfy: `README_ForgeProfile.md`.
- To run the framework's own gates: `lib/forge-framework/test/` (23 files; every gate has a twin that
  turns it red).
- To see the frozen acceptance command per forge:
  `lib/forge-framework/test/acceptance/acceptanceCommands.jsonc`.
