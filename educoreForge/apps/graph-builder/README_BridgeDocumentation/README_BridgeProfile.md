# EDUcore Bridge Profile v1.0

> Amended 2026-08-16 (v1.0.6, B2 ruling 12:20): §4.6 `provenanceTier` is retired from mapping SEMANTICS but REQUIRED BY THE GRAPH ENGINE on every edge — mapping edges carry the fixed per-producer value (authored → 'spec-authoritative'; inferred → 'embedding-inferred'; debug blocks → 'invalid-debug'), which is never exported to SSSOM and never read as a mapping property.
> Amended 2026-08-16 (v1.0.5, ruling BF16): §4.6 `provenanceTier: 'invalid-debug'` MAY be emitted on the edges of a DEBUG-JUDGE decision block only, and such a block MUST NOT reach a certified graph (the certification check refuses it); §5.1 `range` is a declarable tuple field in the plugin's column map (a source that supplies it is filtered by it); §3.1 `matchBasis` is CONSISTENT WITH the SSSOM slots, not derivable from them (standard and crosswalk share the provider-URL slot shape).
> Amended 2026-08-16 (v1.0.4): §5.1 tentative labels → judged (ruling BR-137, RULINGS-supervisor-bridgeFramework.md).

> Amended 2026-08-15 (v1.0.1) after the Phase 2 harvest and reviews: §4.5 subject_match_field,
> §4.6 mapping_date and the internal properties, §5.1 conflicting specifications and the derived
> pool, §5.2 the judge's predicate return, new §5.4 value tier, new §4.7 block naming. Every change
> is traceable to `RULINGS-supervisor-phase2.md` §5.
>
> Amended again 2026-08-15 (v1.0.2) after the Phase 6 finding: §6 corrected — the value tier has
> the SAME defect at its composite key; the measured numbers are labelled by graph; per-run
> measurement required. See `RULINGS-supervisor-phase6.md`.
>
> Amended 2026-08-15 (v1.0.3) after the Phase 6 review: §5.1 the applicable filter includes every
> tuple field the source supplies as data (PROFILE-C); §5.3 where a specified mapping's predicate
> comes from when the source names none (PROFILE-D). See `RULINGS-supervisor-phase6.md` addendum.

This specification defines how a forge or bridge asserts that an element of some standard
corresponds to an idea in the CEDS hub. It covers the addressing of hub references, the three
properties every mapping carries, the SSSOM slots and values used to express them, the rules for
resolving a target, and the gates a forge must ship to claim conformance.

It applies to every forge and every bridge that emits a mapping into an educoreForge graph. It
supersedes the implicit taxonomy embedded in `referenceIndex.js` and the authored-bridge track.

Statements about existing code are marked `[code fact]` where verified against the source, and
`[design]` where this document is making a decision. **MUST**, **MUST NOT**, **SHOULD** and **MAY**
carry their ordinary specification force. A forge that violates a MUST is non-compliant and its
output does not enter canon.

---

## 1. Terms

**card** — informal name for a `HubReference` node. One domain's view of one CEDS idea.

**canonicalKey** — the kind-prefixed CEDS id: P-form for properties, OV-form for option values.
`[code fact]` The prefix is minted by the forge; CEDS supplies the number. It is a join key, not an
address.

**crosswalk** — a document, usually published by a standards body, asserting correspondences between
its own elements and another standard's. Distinct from the standard itself.

**matchBasis** — a property defined by this document. Where a mapping's matching parameters came
from: `standard`, `crosswalk`, or `derived`.

**resolution** — a property defined by this document. Whether the source named the target precisely
(`specified`) or an algorithm had to choose among candidates (`judged`).

**semapv** — the Semantic Mapping Vocabulary, a controlled vocabulary maintained by the Mapping
Commons group. SSSOM's `mapping_justification` slot is bound to its terms. Published at
`mapping-commons.github.io/semantic-mapping-vocabulary/` and browsable at EBI OLS4.

**SSSOM** — the Simple Standard for Sharing Ontology Mappings. A LinkML schema defining `Mapping`
and `MappingSet` classes and their slots, with TSV, JSON, RDF and OWL/RDF serialisations.
Implementations must support SSSOM/TSV.

**tuple** — the ordered field set from which a card's `addressSignature` is computed. The address.

---

## 2. Addressing a hub reference

Every HubReference carries three handles. Each has one job.

| handle | job | uniqueness |
|---|---|---|
| `stableId` / `uri` | identity — names exactly one card; MERGE key; every edge endpoint | unique |
| `canonicalKey` | join key — how an outside standard names a CEDS thing | not unique |
| `embedText` | search — composed from the card's own fields; feeds semantic retrieval | not applicable |

`[code fact]` The vocabulary states the non-uniqueness directly: `canonicalKey` is "intentionally
NON-unique"; uniqueness is the composite `(hubName, addressSignature)`.

### 2.1 The identity tuple

`[code fact]` A card's `addressSignature` is a SHA-256 over an ordered join of exactly:

```
hubName | canonicalKey | domainId | propertyKey | range | valueKey | qualifierKeys | hubVersion
```

`stableId` and `uri` are identical and take the form
`hubNamespace + hubVersion + '/' + addressSignature`, resolving today to:

```
https://w3id.org/EDUcore/CEDStandards/hub/14.0.0.0/<addressSignature>
```

This tuple is the address. A mapping that cannot name the tuple has not named a card.

### 2.2 Rules

- A resolver MUST NOT treat `canonicalKey` as an address.
- A resolver MAY use `canonicalKey` as a first-stage filter to narrow candidates. This is its proper
  use and it is efficient: it reduces 2,777 property-tier candidates to at most 11.
- A resolver MUST resolve to a `stableId` before emitting an edge.
- Any index keyed on a non-unique field MUST be a multimap or MUST refuse by name. A bare assignment
  into a single-valued map is forbidden wherever the key is not proven unique.

---

## 3. The three properties of a mapping

A mapping carries three independent properties. None may be inferred from another.

### 3.1 matchBasis

| value | meaning |
|---|---|
| `standard` | the parameters come from the standard's own specification |
| `crosswalk` | the parameters come from a non-standard document |
| `derived` | no specification exists; the parameters are derived from other properties |

`[design]` `matchBasis` is not an SSSOM slot. SSSOM offers no source-category enum. It is computed
from `mapping_provider` and `mapping_tool` (§4.3), MUST be derivable from them, and MUST NOT
contradict them.

### 3.2 resolution

| value | meaning |
|---|---|
| `specified` | the source named the target precisely; it resolves to exactly one card |
| `judged` | the source under-determined the target; an algorithm chose among candidates |

This axis is carried on the wire by `mapping_justification` (§4.2).

### 3.3 predicate

The SKOS mapping relation between subject and object. This is a claim about meaning, independent of
confidence about which card was meant. A judged mapping may assert `skos:exactMatch`; a specified
mapping may assert `skos:closeMatch`.

### 3.4 The matrix

| | `specified` | `judged` |
|---|---|---|
| `standard` | the specification determines the tuple | the standard names a neighbourhood; the judge chooses |
| `crosswalk` | the crosswalk row resolves to one card | the row resolves to several; the judge chooses |
| `derived` | n/a | no specification exists; the judge produces the mapping |

`derived` with `specified` does not arise. If nothing specified the target, there was something to
judge.

---

## 4. SSSOM conformance

Every mapping emitted MUST be a valid SSSOM `Mapping`. Everything published is SSSOM-native; nothing
internal may contradict it.

### 4.1 Mandatory slots

SSSOM requires four and states that there can be no mapping without a justification.

| slot | value |
|---|---|
| `subject_id` | the source standard's element, as a CURIE |
| `object_id` | the HubReference's `uri` |
| `predicate_id` | §4.4 |
| `mapping_justification` | §4.2 |

`object_id` names one domain's view of one idea. It is never "the CEDS property." This is the
purpose of the tuple and the single most consequential line in this document.

### 4.2 mapping_justification

`mapping_justification` is a closed enum, regex-bound to thirteen `semapv` terms. A forge cannot
invent one. Three are in active use.

| term | when |
|---|---|
| `semapv:ManualMappingCuration` | `resolution: specified` — a person named it and it resolves to one card |
| `semapv:CompositeMatching` | `resolution: judged` — an algorithm chose, at any `matchBasis` |
| `semapv:MappingReview` | a human reviewed and confirmed a previously judged mapping |

`[design]` One term covers every judged case. A consumer seeing `CompositeMatching` with no
`mapping_provider` and a `mapping_tool` naming the judge can infer `derived`, so the distinction is
already carried by slots that exist.

`semapv:UnspecifiedMatching` is prohibited. It means the reason was not recorded. A forge MUST NOT
emit it.

Reserved and currently unused: `LexicalMatching`, `LexicalSimilarityThresholdMatching`,
`SemanticSimilarityThresholdMatching`, `StructuralMatching`, `InstanceBasedMatching`,
`BackgroundKnowledgeBasedMatching`, `LogicalReasoning`, `MappingChaining`, `MappingInversion`.
Adopting one is a specification change, not an implementation choice.

### 4.3 Where matchBasis lives on the wire

| `matchBasis` | `mapping_provider` | `mapping_tool` |
|---|---|---|
| `standard` | URL of the standard's specification | absent |
| `crosswalk` | URL of the crosswalk document | absent |
| `derived` | absent | the judge, with `mapping_tool_version` |

A judged mapping at `standard` or `crosswalk` carries both: the provider that named the
neighbourhood and the tool that chose within it.

### 4.4 predicate_id

| predicate | when |
|---|---|
| `skos:exactMatch` | interchangeable across a wide range of uses |
| `skos:closeMatch` | interchangeable for some purposes, not all |
| `skos:broadMatch` | the subject is narrower than the card |
| `skos:narrowMatch` | the subject is broader than the card |
| `skos:relatedMatch` | associated, relation unspecified |

OWL predicates — `owl:equivalentProperty`, `owl:equivalentClass` — MUST NOT be used. Two consequences
follow from using them, and both are severe.

A reasoner acting on OWL equivalence may substitute the two entities everywhere, propagate
constraints across the pair, and on incompatibility declare the containing ontology inconsistent,
which invalidates every inference in it rather than the one bad row. A share of our mappings are
`judged`, chosen by an algorithm at confidence below 1. SKOS mapping relations carry no such
entailment: a wrong SKOS row is a wrong row.

`owl:equivalentProperty` also asserts that both sides are OWL properties. CEDS and Ed-Fi elements are
data-model elements, so the assertion claims a modeling position this project has not taken.

SKOS applies uniformly, including to specified mappings, so that no consumer must inspect a predicate
to learn whether reasoning is safe.

### 4.5 Match fields

`subject_match_field` and `object_match_field` are multivalued, `|`-separated in TSV, and
propagatable. They record the properties used to establish the match.

A mapping into the CEDS hub MUST declare the tuple:

```
object_match_field: EDUcoreCeds:canonicalKey|EDUcoreCeds:domainId|EDUcoreCeds:propertyKey|EDUcoreCeds:qualifierKeys
```

and MUST declare the field that carried the matching parameters. `subject_match_field` names a
field in the SOURCE OF THE MATCHING PARAMETERS — which is the standard's own element for
`matchBasis: standard`, but the CROSSWALK DOCUMENT's column for `matchBasis: crosswalk`. So an
Ed-Fi→CEDS row from Ed-Fi's published crosswalk declares the crosswalk's column, for example
`subject_match_field: edfiCedsCrosswalk:CEDSGlobalId`, not a field of the Ed-Fi element. The prefix
names the document; `curie_map` (§4.6) declares it.

SSSOM's match-field slot is a flat list of fields used. It has no conjunction semantics, cannot
express that four fields jointly identify an object, and enforces nothing. It documents the tuple
and will not catch a violation of it. The gates in §7 do that.

Declaring these fields is still required. It makes the failure in §6 visible on the face of every
row: a mapping whose `object_match_field` holds only `EDUcoreCeds:canonicalKey` is matching on a
field that does not identify.

### 4.6 Other slots

| slot | requirement |
|---|---|
| `object_label` | MUST be emitted. The address signature is an opaque hash; without a label no reader can tell what a TSV row maps. |
| `confidence` | MUST be present when `judged`. MUST be absent when `specified` — absent, not `1.0`. |
| `subject_source`, `object_source`, and their `_version` slots | MUST be emitted |
| `mapping_date` | MAY be emitted ONLY when supplied as data (a provenance date carried by the source). MUST NOT be minted at produce time — a runtime timestamp breaks deterministic replay, and replay determinism outranks this slot. |
| `author_id`, `creator_id` | SHOULD be emitted where known |
| `matchId` (internal) | never exported; a forensic key |
| `provenanceTier` (internal, retired) | replaced by `matchBasis` × `resolution`; MUST NOT be emitted |
| `curie_map` | MUST declare every non-built-in prefix used, including `EDUcoreCeds:` and each standard's prefix |

`mapping_provider`, `mapping_tool`, `object_match_field` and the `*_source` slots are propagatable. A
set drawn from one crosswalk declares them once at set level rather than per row.

### 4.7 Block naming and version keying — all producer kinds

A document titled *Bridge* Profile governs every bridge, not only mapping bridges. Three producer
kinds exist: `authored` (mapping, `matchBasis` standard or crosswalk), `inferred` (mapping,
`matchBasis` derived), and `structural` (intra-family edges among sibling standards, toward no hub).
Structural bridges never address a HubReference, so §2 and §3–§5 do not apply to them; this section
does apply to all three.

- Every relationship block is PAIR-SCOPED and VERSION-KEYED on BOTH endpoints. A block that cannot
  name a resolved version for both endpoints has no address and MUST be refused by name.
- The producer kind is declared by the block itself through a per-producer suffix on the block
  subject (`_exact` authored, `_close` inferred, `_struct` structural). One data row per producer;
  no per-producer conditional anywhere in the naming code.
- A structural family entry MAY emit several pair-scoped blocks from one invocation; each is
  version-keyed on its own two endpoints.
- A structural bridge that is handed a hub MUST refuse by name.

---

## 5. Resolution and the judge

### 5.1 Cardinality rules

> **v1.0.4 (supervisor, 2026-08-16 10:10, ruling BR-137):** `resolution: judged` arises from cardinality MANY after the applicable filter **or** from a source label the plugin declares TENTATIVE (Ed-Fi's `Maybe`). A tentative label never yields a `specified` mapping, whatever the cardinality; the judge confirms one card or abstains, and the mapping carries `resolution: judged` with `CompositeMatching`. Rationale: a row that does not commit to exactly one CEDS idea is not a curated mapping, and stamping it `ManualMappingCuration` would claim curation nobody performed.

Given a target the source names, a resolver MUST classify by the count of candidates AFTER THE
APPLICABLE FIRST-STAGE FILTER.

For `matchBasis: standard` and `crosswalk` the applicable filter is `canonicalKey` (§2.2) PLUS
every further identity-tuple field (§2.1) the source supplies AS DATA — for example a crosswalk
column that names the CEDS class, which is the card's `domainId`. The resolver narrows to the cards
matching every supplied field, then counts. A source that supplies more of the tuple gets more
`specified` mappings; a source that supplies only the join key gets `judged` ones. A plugin MUST
declare which tuple fields its source supplies and from which source columns; it MUST NOT infer a
tuple field the source did not supply. For `matchBasis: derived` there is no join key to filter by;
the candidate pool is the semantic retrieval's top-K, and the classification is `judged` by
construction.

| candidates after filter | classification | action |
|---|---|---|
| exactly one | `specified` | emit; `mapping_justification: semapv:ManualMappingCuration` |
| more than one | `judged` | hand to the judge |
| zero | error | record as an orphan; MUST NOT emit an edge; does not enter canon |
| two SOURCES name different targets for one subject | **conflict** | record like an orphan — refused by name, both candidates named; MUST NOT emit an edge; does not enter canon; route to human review |

Zero and many are different failures and MUST NOT be collapsed. Zero means the target does not
exist. Many means the target is under-specified, which is the case the judge exists to serve.
Treating many as an error rejects the rows the judging path was built for.

A CONFLICT is two SOURCES disagreeing — for example the standard's own element anchor and a
third-party crosswalk naming different CEDS targets for the same element. It is not a weaker
mapping and it is not `judged`; nobody's specification is authoritative when two of them
disagree. If a human resolves a conflict, the surviving mapping carries
`semapv:MappingReview`. ONE source whose scalar echo is a lossy summary of its own multi-valued
row (a crosswalk row naming several Global IDs, collapsed to the first at forge time) is NOT a
conflict: the row is the specification, it resolves to MANY, and it is `judged`.

A resolver MUST NOT emit an edge to an unresolved or conflicted target, and MUST NOT silently
select among candidates.

### 5.2 The judge's return

The judge MUST return either a chosen card with a confidence, or an abstention. Abstention is a
legitimate outcome and emits nothing.

When `matchBasis` is `derived` the judge MUST ALSO return a predicate (§4.4) — there is no source
to have asserted one. When `matchBasis` is `standard` or `crosswalk` the judge MUST NOT be asked
for a predicate, and any predicate it volunteers MUST be discarded (§5.3). A judge whose return
shape cannot distinguish these two cases is non-compliant.

### 5.3 Predicate authority

The judge answers up to two questions and its authority differs between them.

| `matchBasis` | which card | which predicate |
|---|---|---|
| `standard`, `crosswalk` | the judge decides | the source asserted it; the judge MUST NOT override |
| `derived` | the judge decides | the judge decides; its predicate is authoritative |

A specification that named a neighbourhood also asserted a relation, usually that the two things are
the same. Where a specification exists the judge's job is addressing only. Overriding the predicate
replaces a human's assertion with a machine's opinion in a slot no reader would think to check.

Where a specification names a target but names NO relation (a crosswalk with a confidence label
and no predicate column), the plugin MUST supply the predicate from a DATA-DECLARED table mapping
the source's own labels to SKOS predicates (for example `Yes → skos:exactMatch`,
`Partial → skos:closeMatch`), declared with the plugin and exported as part of its provenance. That
table is the source's confidence semantics made explicit; it is not a producer constant (§4.4 forbids
a constant standing in for a claim) and it is not the judge's opinion (the judge is still not asked
at `standard`/`crosswalk`). A source label that names no predicate at all is a MUST DECIDE for the
plugin's specification, not a default.

### 5.4 Value tier

Everything above is stated for the property tier. The hub also carries a value tier — one card per
option value per property, 91,825 cards at the time of writing — whose identity tuple includes
`propertyKey` and `valueKey`. §2 (addressing) and §4 (SSSOM) apply to value-tier cards unchanged.
This Profile is SILENT on value-tier RESOLUTION: what a source names when it maps to a value, how
the first-stage filter works for values, and whether the first bridge system built under this
Profile resolves values at all. That is a Phase 6 requirements decision and MUST be stated there
before any value-tier bridge is written. Until then a bridge MUST refuse a value-tier target by
name rather than guess.

---

## 6. The failure this specification prevents

`referenceIndex.js` builds its lookup for the authored-crosswalk track as a bare assignment keyed on
`canonicalKey`:

```js
basePropertyRef[canonicalKey] = oneNode.stableId;
```

A CEDS property has one HubReference per declared domain, so several correct and distinct cards share
that key and each overwrites the last.

Measured against the live graph: 2,777 property-tier HubReferences across 2,324 distinct
`canonicalKey` values. 256 keys carry more than one card, the largest carrying 11. 426 cards cannot
be reached through that index.

Nothing errors and no count is emitted. The number of cards processed stays correct; only the number
retrievable is wrong. No stage of the pipeline holds both figures, so no stage can notice the
difference.

The forge is not the fault. `[code fact]` `cedsHubForge.js` mints one card per property per declared
domain and derives each card's identity from a tuple including `domainId`, so the cards are distinct
by construction and every one is present and correctly addressed. The defect is a consumer
addressing them with a join key.

The value tier is NOT unaffected — v1.0.2 CORRECTION. The earlier text here said the value tier's
composite key `propertyKey|valueCanonicalKey` resolved all 91,825 cards; that was inferred from the
old index's own comment, not measured, and it was wrong. Measured against the from-scratch
baseline (2026-08-15): 91,825 value-tier cards over 27,437 distinct `propertyKey|valueKey`
composites; **14,070 composites carry more than one card, distinguished only by `domainId`**
(worst 10). The old value-tier index was ALSO a bare assignment (`baseValueRef[...] = stableId`),
so it silently overwrote exactly as the property tier did. Only the FULL identity tuple (§2.1) is
unique at either tier.

The numbers in this section are graph-specific: 256 contended keys / worst 11 / 426 unreachable
were measured on CELESTIAL_MIRROR's evidence graph (2026-08-14); the from-scratch baseline
(2026-08-15) shows 260 / 13. Same defect, different build. A bridge system MUST measure contention
per run and report it; it MUST NOT carry these figures forward as constants.

---

## 7. Compliance gates

A forge or bridge claiming conformance MUST ship gates proving each of the following. A gate that has
never been observed failing is unproven: every gate MUST have a twin that injects the precise fault
and turns it red.

1. No single-valued index on a non-unique key. Every resolver index keyed on `canonicalKey`, or any
   other join key, is a multimap or refuses.
2. Tuple addressing. Resolved `object_id` values are card `stableId`s, and the count of distinct
   resolved cards matches the count of distinct resolved tuples.
3. Cardinality classification. A many-candidate target is classified `judged`; a zero-candidate
   target is recorded as an orphan with no edge emitted.
4. Justification correctness. No judged mapping carries `semapv:ManualMappingCuration`, and
   `semapv:UnspecifiedMatching` never appears.
5. Confidence discipline. `confidence` is present on every judged mapping and absent on every
   specified one.
6. Predicate authority. A judged mapping at `matchBasis: standard` or `crosswalk` carries the
   predicate its source asserted.
7. SSSOM validity. The emitted set parses as valid SSSOM/TSV with every prefix declared.

---

## 8. Unsettled questions

A forge MUST NOT assume an answer to either of these.

**Hub version in the IRI.** A card's `uri` embeds `hubVersion`, so every re-version of the hub mints
new IRIs for every card and published mappings pin to a hub version.

**General bridge engine.** Bridges are standard-specific. Whether a parameterized general engine is
workable, and where the seam falls between shared resolution strategy and per-standard source
parsing, is undecided.

---

## 9. Positions this specification encodes

Ratified with tqii, 2026-08-15.

- A one-field id cannot address a CEDS idea. Only a tuple can.
- We do not dictate how outside standards reference the hub. The hub must therefore carry enough
  information for a per-standard bridge to map whatever a standard says onto the tuple.
- All terminology is SSSOM-consistent, accepting that the vocabulary is unfamiliar, because
  consistency will gain acceptance for the work.
- A target resolving to zero is an error. A target resolving to many is not.
