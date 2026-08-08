# Where every id comes from

**One decision in this file is the entire reason this bundle exists.** The incumbent PESC forge was
not retired because it was slow or ugly. It was retired because its identity rule fused definitions
that PESC keeps separate, and nothing complained.

Every figure below was measured against `DEV_pesc260805` on 2026-08-07 (session VIOLET_STONE), port
resolved from the container.

---

## The decision — R-ID-1

**A named top-level definition is identified by its own RESOLVED qualified name.**

```
<targetNamespace>#<kind>/<localName>

urn:org:pesc:core:CoreMain:v1.19.1#complexType/DocumentIDType
```

**Nothing is invented.** The namespace URN already encodes layer and version; the source names itself
and we use the name.

⟪TQ, 2026-08-05⟫ — the rule was amended on his proposal to *use the source's own qualified name*
rather than a forge-coined key. Precedent: CEDS's `stableId` is simply the source URI.

### What it prevents, and the number that shows it

Every other forge in this fleet builds a **version-free** natural key — `sif:${token}/${cleanKey}`,
`edfi:${constructType}/${cleanName}` — and replay does
`MERGE (n:ForgedNode {stableId: row.stableId})`. **Two generations of the same element in one build
collapse into one node.**

For every other standard that is correct. **For PESC it is fatal.**

```cypher
MATCH (n) WHERE n.stableId ENDS WITH '#complexType/TransmissionDataType' RETURN count(n)
```

**Observed: 33.**

Fourteen CoreMain generations, thirteen AcademicRecord generations, five AdmissionsRecord
generations, one AcademicEportfolio — **thirty-three genuinely different types that PESC declares
under one local name.** Under a version-free key every one of them would be node number one, and the
other thirty-two would vanish into it silently. No error, no missing node, no failing query.

### THE PART THAT IS EASY TO DESTROY

**This is the RESOLVED name, never the WRITTEN one.**

`core:DocumentIDType` is *prefixed*, not qualified. **The prefix is file-local:** `core:` is bound at
the top of each file to *that file's* choice of CoreMain. So the identical eleven characters denote
different types in different files.

**The prefix MUST be resolved at parse time, inside the declaring file, and the resolved
fully-qualified namespace carried onto the edge.** Storing a raw prefixed string and resolving it
later is resolution-by-guess — precisely how the incumbent came to substitute versions silently.

**AND THE COMPARATOR DOES NOT YET HONOR THIS.** `canonicalTypeRef` strips the prefix, so a reference
repointed to a same-named type in a different namespace canonicalizes identically. **R-ID-1's fusion
survives in the object space.** It is named in `README_KnownIssues.md` §1a as the most serious
residue, and it is the one thing in this bundle where the fix and its own certification do not yet
agree.

### Why `kind` is kept even though it is redundant today

XSD keeps types, elements, groups and attributeGroups in **separate symbol spaces**, so a type and a
global element may legitimately share a name. Measured 2026-08-05: **zero such collisions in the
present corpus.** The bare qualified name would work today.

**It would work by luck, not by construction**, and one PESC release could break it silently. The
`kind` is cheap insurance against a failure that would otherwise be invisible.

---

## The structural keys — R-ID-2

**XSD gives no namespace identity to local declarations, and this corpus leans on them heavily.**
Measured 2026-08-05: **190 anonymous inline complexTypes**, and local element names repeat massively —
`NoteMessage` **1,454 declarations**, `UserDefinedExtensions` 278, `Response` 170, `Contacts` 147.

So anything without a qualified name gets a structural key derived from its container. Forms observed
in the graph:

| shape | what it identifies |
|---|---|
| `<ownerStableId>/el/<sequencePosition>:<localName>` | a local element declaration |
| `<ownerStableId>/restriction/<sequence>` | a derivation step |
| `pescArtifact:<sha256 of the file>` | one acquired file |
| `pescNamespace:<targetNamespace URN>` | one namespace |

**The sequence position is FILE POSITION.** It must be, because the round trip has to put the
elements back in the order the source declared them — and element order is modelled (as the ordinal
in `particleAt:N`). Sorting these into any more helpful order produces a graph that reads better and
can no longer regenerate the file it came from.

**Derivation must be reproducible from the source alone.** The build proves
`graph == replay(manifest)`, and an id that varied between runs would break that silently — every
rebuild would read as a change and the proof would become noise. Observed in this pass: a fresh build
composed manifest `f17896a4a89c70a3034fd33f097833f69398bdbebcdf71e0f666d58512dd8acf`, **byte-identical
to the manifest the canonical graph was built from.**

---

## The one place a hash DOES enter identity — D-1

**PESC publishes two different files that both claim `urn:org:pesc:sector:AcademicRecord:v1.6.0`,
and both carry `version="v1.6.0"`.**

| | linked from college-transcript | linked from test-score |
|---|---|---|
| bytes | 61,549 | 71,232 |
| complexTypes | 49 | 62 |
| imports CoreMain | 1.10.0 | 1.7.0 |
| carries | `RequestType`, `ResponseType`, `TranscriptHoldType` | `TestScoreReportType`, `EducationTestScoresType` |

**Six roots import that namespace. Neither file satisfies all six.** `TestScoreReport v1.0.0`
references exactly one type in its entire file — `AcRec:TestScoreReportType` — which exists only in
the test-score copy.

**This is PESC's defect, not ours. Acquisition records it and never resolves it.** Both files are on
disk under collision names, and the ruling that governs the graph is **D-1: contested namespaces
only.**

### The discriminator, and the measurement that shows it is narrow

The stableId gains `@<first 12 hex of the file's sha256>` **exactly where a namespace is disputed and
nowhere else.**

```cypher
MATCH (n) WHERE n.stableId CONTAINS '@'
RETURN DISTINCT split(n.stableId,'#')[0] AS namespaceUrn, count(n) AS n
```

**Observed — a single row:**

```
urn:org:pesc:sector:AcademicRecord:v1.6.0    952
```

**Exactly one namespace. Exactly two discriminators — `948d88f32069` and `e12830fc86a3` — which are
the first twelve hex of the two collision files' own sha256 sums**, as listed in the verdict's
`snapshot.files` block and in the filenames on disk. 952 nodes carry one; nothing else in the graph
carries any.

**Why not hash uniformly.** The uniform alternative's one advantage — immunity to a *future*
undiscovered collision — is already provided elsewhere: acquisition detects namespace collisions and
records them in the manifest, so a new dispute arrives **loudly** and the discriminator extends to it
then. Uniform hashing would pay a permanent ugliness tax for protection the pipeline already gives,
**and would erase the useful signal that a hash in a stableId MEANS a dispute.**

### A NOTE FOR WHOEVER MAINTAINS THE SPEC

**SPEC §6.1 R-ID-3 reads "No content hash participates in identity."** As written that is false of the
shipped graph, and correctly so — **ruling D-1 (2026-08-05, DESIGN §9) is a deliberate, narrow
exception to it,** and the code implements D-1. The two documents are reconcilable but the SPEC does
not say so on its face. **Reported rather than edited:** the SPEC is the normative contract and
amending it is not a documentation pass's business.

---

## The fourth kind — synthetic identity, and where the merged node sits

**The merged AcademicRecord v1.6.0 (S-1) occupies the PLAIN, undiscriminated name.** Observed:

```
pescTier=synthetic   urn:org:pesc:sector:AcademicRecord:v1.6.0#simpleType/AchievementCategoryCodeType
pescTier=source      urn:org:pesc:sector:AcademicRecord:v1.6.0#simpleType/AchievementCategoryCodeType@e12830fc86a3
```

**That layout is the whole point, and it is worth pausing on.** A consumer resolving the contested
namespace lands on **one** definition — the merged synthesis, which is a decision somebody made and
defended. The two published branches remain individually addressable underneath it, discriminated,
untouched, and preserved. **Nothing was chosen away.**

**109 named definitions** carry the merged synthetic identity — which is the same 109 the verdict
reports as `syntheticReproducibilityTotal`.

**Synthetic identity is defended, not derived.** S-1's rule is: union of named definitions from the
two files; where both define a name, **the college-transcript definition wins** (superset in 8 of 14
conflicts, subset in 0). Its cost is enumerated rather than waved at — **8 child elements declared
only by the test-score branch do not survive**, every one named.

`S-2` mints a `PescNamespace` node standing in for **CoreMain v1.6.0, a file nobody has ever seen**,
with exactly one `SERVED_BY` edge to the real v1.8.0. All 129 `core:` references in AcademicRecord
1.5.0 were verified present in 1.8.0. **That proves every reference resolves; it does NOT prove 1.8.0
says what 1.6.0 said.** The alias is manifest data, deliberately **not a symlink** — a symlink changes
what a filename finds without changing what the file declares, is invisible to namespace-based
resolution, and defeats `SHA256SUMS` by hashing the target.

---

## The rules that hold across all of them

**`stableId` is the identity and edges resolve against it.**

**A synthetic id must never be mistakable for a source one.** Every node carries `pescTier`, the
emitter reads `source` and only `source`, and a suite assertion holds that **zero synthetic content is
reachable by the emitter's source predicate.** A consumer must always be able to ask *"did PESC say
this, or did we?"* — and get an answer.

**Never let identity depend on anything incidental.** No counter, no timestamp, no hash of run state.
The one hash that participates is a hash of the *source file's own bytes*, which is a property of
what PESC published rather than of when we ran.
