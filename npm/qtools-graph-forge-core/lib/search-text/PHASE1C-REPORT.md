# Phase 1C report — searchText builder + Voyage embedding helpers

**Builder:** programmer sub-agent (orchestrator: SILENT_STONE) — **Branch:** `forger-firstApp` — **Status:** GREEN
**Scope:** contract §1C of `IMPL-CONTRACTS-phase1-061926.md`; DESIGN §B/§C; DECISIONS §3/§8/§23-R4.
No `git add`/`commit`/`checkout`, no `package.json` edits, no `npm install`, no sibling module dirs touched.

## Files created

| File | Purpose |
|---|---|
| `lib/search-text/build-search-text.js` | The one shared `buildSearchText` + a real `ValidationError` Error subclass |
| `lib/search-text/test/build-search-text-test.js` | searchText gating tests (6) |
| `lib/embedding/embedding-client.js` | Provider-agnostic client: `embedText`, `encodeVector`, `decodeVector` |
| `lib/embedding/providers/voyage.js` | voyage-4-large https provider (Node built-in `https`, no http-client dep) |
| `lib/embedding/test/embedding-client-test.js` | base64 round-trip + ONE live voyage-4-large call (3 asserts) |

## Design / coding notes

- **moduleFunction curried-with-DI pattern** matching the 1A peer (`content-address.js`): `({moduleName}) => (deps) => {...}`.
- **No async/await, no Promises, no EventEmitter.** The https call lives inside a single callback in `voyage.js` (`req.on('error')` / `res.on('end')` → `callback(err)` / `callback('', embeddings)`). JSON parse is localized in a non-throwing `qtParseJson` helper so no try/catch is used for control flow.
- **Provider registry** auto-discovered from `providers/` (no switch). camelCase throughout.
- **searchText composition** is per-role via a `segmentBuildersByRole` registry covering all six Dme roles. A `DmeProperty` carries its `owningClassName`; a `DmeOptionValue` carries `optionSetName` + owner; pipe-delimited (` | `). Built from name + structural context, **never** from `description`. Empty result → descriptive `ValidationError` (a real `Error` subclass) at forge time, naming the offending element (role + name + owning context).
- **embeddingModelVersion** is stamped `voyage-4-large` per DECISIONS §3, independent of the query-side model.
- **base64 codec** uses little-endian float32 (`Buffer.toString('base64')` ↔ `readFloatLE`), round-trip byte-exact.

## SECRET HANDLING

The Voyage API key is read ONLY from config — `qtools-config-file-processor` over
`configs/instanceSpecific/qbook/voyageEmbedding.ini`, section `[voyageEmbedding] → apiKey` (also `model`, `embeddingDims`).
Never from an environment variable. The key value is referenced only as `config.voyageEmbedding.apiKey` and used
only in the `Authorization: Bearer` header. Audit grep confirmed **zero** logging/printing/writing of the key,
and it is never returned to callers nor placed in any error string. This report contains the vector LENGTH only.

## Test commands + output

```
$ node lib/search-text/test/build-search-text-test.js
searchText builder gating tests:
  PASS  DmeProperty carries its owning Class name
  PASS  DmeOptionValue carries its set + owner
  PASS  null description still yields non-empty searchText
  PASS  empty-string description still yields non-empty searchText
  PASS  genuinely-empty input throws ValidationError naming the element
  PASS  missing/unknown role throws ValidationError
searchText: 6 passed, 0 failed        (exit 0)

$ node lib/embedding/test/embedding-client-test.js
embedding client gating tests:
  PASS  base64 round-trip identical Float32Array length 1024
  PASS  live voyage-4-large call returns a 1024-dim vector
  PASS  helper stamps embeddingModelVersion = voyage-4-large
        live result: vector length = 1024, embeddingModelVersion = voyage-4-large
embedding: 3 passed, 0 failed         (exit 0)
```

## Gating assertions (all satisfied)

- searchText: Property w/ owning Class ✓; OptionValue w/ set+owner ✓; null/empty description still non-empty ✓; genuinely-empty throws ValidationError naming the element ✓ (instanceof Error confirmed).
- base64: encode→decode→identical Float32Array, length **1024** ✓.
- live voyage-4-large: returned a **1024**-dim vector ✓; `embeddingModelVersion='voyage-4-large'` ✓ (key from config, never printed).

## Deviations + rationale

- **`buildSearchText` signature.** Contract shows `buildSearchText({role,name,owningClassName,optionSetName,owningName,...})`. Implemented as a single options object (one argument) rather than `(element, ...)`, matching the qtools "params as an object" convention and the contract's own field list. No positional second arg is needed.
- **`embedText` does NOT accept an injected config blob.** Per contract ("reads key/model from config") the client loads config itself via `qtools-config-file-processor`. The ini path is injectable at construction (`require('./embedding-client')({configFilePath})`) defaulting to the canonical `configs/instanceSpecific/qbook/voyageEmbedding.ini`, so tests and callers can point at the same standard config without passing secrets around.
- **base64 endianness** is platform-native little-endian (x86/arm). Encoder and decoder mirror each other, so the round-trip is exact on this box; a cross-endian note is in the code comment.
```
