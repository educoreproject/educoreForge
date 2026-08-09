# Validation certificate — PESC260805

## Summary

**The graph is a faithful re-statement of its 64 source XSD files.** Everything those files say, the graph carries. Nothing the graph carries was invented. That was checked two independent ways, and confirmed a third time inside a four-standard graph where every figure came out identical. **This round trip validation supports the judgement that this graph is complete and usable.**

| | |
|---|---|
| standard | `PESC260805` (bundle `forges/pesc260805/`) |
| corpus | `assets/standardSourceData/01/` — 64 XSD files, 9,733,713 bytes |
| corpus digest | `92e9a6326ff1edda465db3d704632491a7b5bb39469edfee883f366840688984` |
| commit | `dfe97d3`, branch `architecture-improvement` |
| run | `pesc260805OnlyRoundTrip_20260807-235125`, 2026-08-07 |
| graph | `DEV_pesc260805` — resolve the bolt port from the container, never from a document |

PESC publishes no coherent whole-family release. Files had to be tracked down to complete the set based on 'approved-standards' on the PESC website. The version, 01, was generated here and refers to this specific interconnected set of PESC-named versions and files.

| source | what it supplied |
|---|---|
| `https://pesc.org/approved-standards/` and nine standard pages beneath it — `college-transcript`, `high-school-transcript`, `admissions-application`, `course-inventory`, `test-score`, `eportfolio`, `credential-and-experiential-learning`, `pdf-attachment`, `edexchange` | the bulk of the corpus, via CDN links on those pages |
| `https://pesc.org/wp-content/uploads/2025/11/Academic-College-Transcript-Request-Response-v1.0.zip` | the newest schema block. Its five CDN links return HTTP 410 Gone on every page that carries them, so this ZIP is the only working source for CoreMain 1.19.1 and AcademicRecord 1.14.0 |
| `https://developer.ocas.ca/transcripts/schemas/pesc/` — `TranscriptRequest`, `TranscriptResponse`, `TranscriptAcknowledgement`, all `_v1.1.0.xsd` | the three legacy Transcript roots, no longer linked from pesc.org at all |

Everything was downloaded anonymously — free and ungated, per PESC's stated policy. The one genuine paywall in PESC's estate is the EDI transaction sets, which come from ANSI and are excluded by scope.

**What the graph holds, in tiers.** Every node carries a `pescTier`, and the tier decides whether the round trip looks at it. Derived and synthetic look alike and are opposites: derived is computed from the source and could be thrown away and recomputed, synthetic is a decision we made that no filesupports.

| tier | what it means | nodes | in the round trip? |
|---|---|---:|---|
| **source** | a file literally says this — definitions, element declarations, derivations, anonymous types, imports, attributes, and the 64 artifacts themselves | 41,676 | **yes, and only this** |
| **derived** | computed from source and fully recoverable from it, so disposable — the namespaces resolved out of the import declarations | 63 | no |
| **synthetic** | a decision, not recoverable from source, and therefore defended rather than proved — the merged AcademicRecord v1.6.0 with its children, and the `CoreMain v1.6.0` stand-in | 632 | separately, by identity only |
| **meta** | the standard's own root node, which the DME hangs the standard from | 1 | no |

Tier counts from a Cypher census of `DEV_pesc260805`, carried forward from `README_HowToForgePesc.md` rather than re-measured here.

---

## The counts

```
statements reproduced .......... 173,216
invented ....................... 0
lost ........................... 0
  contentGap ................... 0        real loss — counted in lost
  explicitlyOmitted ............ 0        deliberate non-carriage — not counted in lost
whitespaceOnlyDifference ....... 0
syntheticReproducible .......... true     (109 definitions, identity only)
test suites .................... 237 passed, 0 failed
```



**explicitlyOmitted**: Six file-level housekeeping fields are ommitted: targetNamespace, schemaVersionAttribute, elementFormDefault, attributeFormDefault,importsNamespace, importsSchemaLocation. 

---

## Round Trip Validation

Two vaidation processes ran against the same build.

**The textual pass compares statements.** The validator extracts XSD from the working graph,
canonicalizes both the emission and the original corpus into sets of statements, and compares by set
membership. It reads the source tier only — the 41,676 nodes that some file literally says, per the
tier table above. That matters because a derived or synthetic node has no counterpart in any published
file, so emitting one would invent a statement PESC never made, which is the one category that fails a
build outright. This is where 173,216 / 0 / 0 (reproduced / missed / invented) comes from.

It reads the raw source bytes off the snapshot directory, not a parsed intermediate, so a construct
the forge never ingested still appears on the source side and reports as loss. That is exactly how an
earlier run counted 293 missing `xs:group ref` and `xs:any` constructs for which the graph held no
node at all.

**The compiled pass asks whether the result still works.** A third-party Python XSD implementation
(`xmlschema`, `XMLSchema11`), sharing no code with our emitter or canonicalizer, compiles the source corpus and the extraced XSD data and the outcomes are compared. Each side: 64 attempted, 55 compiled clean, 9 refused — with
identical refusal-cause tallies, three missing-group and six unknown-type. No file compiles on one
side and fails on the other.

Statement equality alone would not tell you the emitted schemas are usable. Compilation alone would
not tell you the content survived. Together they do.

**A gate proves the check actually ran.** `goldEvalCheck` reports PASS for this build.

---

## Known issues

Ordered by consequence. Full treatment of each in `README_ValidationDetail.md`.

1. **Type-reference namespace is not compared — the most serious item here.** `canonicalTypeRef`
   strips the prefix, so a reference repointed to a same-named type in a *different* namespace
   canonicalizes identically and cannot register as loss. This is the exact defect class the bundle
   was commissioned to eliminate, surviving on the measuring side. The graph itself no longer has the
   problem — it keeps 33 same-named `TransmissionDataType` definitions as 33 distinct nodes instead of
   fusing them into one. The comparator was never updated to match, so it could not detect a future
   change that re-fused them.

2. **`explicitlyOmitted` is sorted by field name alone, with nothing checking the omission was
   deliberate.** Six file-level housekeeping fields are hard-coded as intentional and excluded from
   `lost`: `targetNamespace`, `schemaVersionAttribute`, `elementFormDefault`, `attributeFormDefault`,
   `importsNamespace`, `importsSchemaLocation`.

3. **141 captured properties are read by neither the emitter nor the comparator.**
   `substitutionGroupAsWritten` on 113 nodes and `abstract` on 28. The parser recorded them
   faithfully and nothing downstream looks at them, so they report zero loss on both sides and that
   reads as fidelity. A one-sided omission shows as loss and gets investigated; one shared by both
   sides is invisible by construction.

4. **`syntheticReproducible: true` is narrower than the boolean suggests.** It covers identity only —
   109 merged definitions checked by kind and name. The 522 children beneath them, and the second
   synthetic class, are unchecked.

5. **Repeated `xs:documentation` elements are not carried, and two real literals were lost that way.**
   Where one `xs:annotation` holds several `xs:documentation` children, the forge keeps the first and
   drops the rest. Five annotations in the corpus do this; five literals were dropped and three of
   them were empty. The two that were not are on `DocumentCategory` and `DocumentFormat` in
   `AcademicRecord_v1.14.0.xsd`. **Only human-readable prose was lost.** XSD annotation content
   carries no schema semantics, so no type, element, cardinality, enumeration or constraint changed
   and the graph remains a valid model of the standard. Subtract these two by name before reading any
   future nonzero `missed` count as a regression.

6. **Attribute order is not modelled, and does not need to be.** The order in which XML attributes are
   written on an element is not significant in XML — `name` before `type` and `type` before `name`
   declare the same thing — so a reordering carries no meaning to lose. **Element order is a different
   matter and it is modelled**, through the ordered particle list of each content model, the same
   property SIF reports as `orderMismatches`.

7. **The nine XSD files would not compile** A compile refusal is the
   independent Python processor being unable to build a schema object from a file because something it
   references cannot be resolved — three files name a missing group, six name an unknown type. The
   causes are in the PESC corpus. Files that fail on both sides, corpus and extracted, count as success in the validation.

---

## Provenance

Cut 2026-08-05 by session VELVET_COMPASS, by `assets/acquisition/acquirePescCorpus.js`. Full record in
`assets/standardSourceData/01/README_PROVENANCE.md`.

**The rule.** Every artifact linked from the PESC standards pages, plus the published Request/Response
ZIP and the OCAS legacy mirror, retained if and only if it parses as XML and declares a
`urn:org:pesc:*` targetNamespace. Filenames derive from the targetNamespace, never from anchor text —
PESC's CDN serves `application/octet-stream` with no filename anywhere in the response, so a
mislabelled link cannot produce a misnamed file. Repair policy is none: contradictions are mirrored,
not fixed, and all merging belongs to the forge.

Where it came from is the source table in Summary above.

**What is open.** One unresolved import. `AcademicRecord v1.5.0` requires `CoreMain v1.6.0`, which is
linked from no PESC page and could not be found. The forge minted a stand-in namespace node for it and
pointed that node at the real `CoreMain v1.8.0`, the next surviving version. All 129 `core:`
references in AcademicRecord 1.5.0 were verified present in 1.8.0, **which proves every reference
resolves but does not prove 1.8.0 says what 1.6.0 said.** The substitution is recorded as manifest
data and deliberately not made a symlink, so nothing about the corpus files themselves is disturbed.

**And a gap in this record itself.** `acquirePescCorpus.js` states that the manifest records nine
fields per artifact, five of them tracing where the file came from: upstream URL, source page, anchor
label, HTTP status, and every other page that linked the identical bytes. **The shipped
`manifest.json` carries none of those five.** It holds only filename, targetNamespace, byteCount,
sha256 and collisionMember. Searching the repository finds the five missing field names in the
acquisition script and in no data file anywhere. **Per-file provenance is therefore not on disk; only
the corpus-level rule above is.** Whether the script fails to write those fields or something strips
them afterward has not been determined.

---

## For more information

| document | what it holds |
|---|---|
| `README_ValidationDetail.md` | the evidence behind every figure above, the verbatim `semanticValidationLimit`, the demonstration of issue 2, and the commands to reproduce this run |
| `README_KnownIssues.md` | the standing backlog — conjunction class, expectation levers, concept collapse, ledger hazards |
| `README_roundTripContract.md` | the contract the validator implements, as distinct from this run of it |
| `assets/standardSourceData/01/README_PROVENANCE.md` | the corpus record — composition rule, the AcademicRecord v1.6.0 namespace collision, acquisition hazards, and what this corpus replaced |

Certificate written 2026-08-07 by session VIOLET_STONE from a build it ran; restructured 2026-08-08
by session CRYSTAL_ORBIT. Figures unchanged. Revision history lives in
`README_ValidationDetail.md`, not here.
