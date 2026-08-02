# What the CEDS forge had to accommodate

**Written 2026-08-02 (session OCEAN_MARBLE), at the point the CEDS round trip reached zero.**

```
statements in source .......  239,761
MATCHED ....................  239,761
LOST .......................        0
INVENTED ...................        0
```

Eleven cases. **Every one was found by measurement, not by reading a specification** — the
round-trip diff reported a number that would not move, and each investigation ended at a fact about
CEDS nobody had written down.

This document exists because the next standard will have its own eleven, and the *shape* of these
transfers even though the specifics will not.

---

## The general rule

### 1. Open list, not closed list

The parser kept a **closed list of four fields** and silently discarded every other predicate. It now
carries *every* predicate it does not specially interpret, named by the source's own local name.

**57,462 statements** — 85% of everything that was missing, recovered by deleting an enumeration
rather than extending it.

> ⟪TQ, 2026-08-02⟫ *"I would have thought that the conversion from OWL to graph is essentially an
> algorithm that is universal without reference to the specific nature of the source. Why isn't that
> true?"* — It largely is. Only the **role interpretation** is standard-specific: deciding that an
> `rdfs:Class` is an entity, a `skos:ConceptScheme` is a codeset, a named individual in one is an
> allowed value. Annotations need no interpretation at all.

---

## Shape and cardinality

### 2. RDF is a SET of statements, not a list

CEDS asserts `<minInclusive>0</minInclusive>` **twice, verbatim**, on `P000101`. Five such exact
duplicates exist in the file. The same subject, predicate and object asserted twice is **one**
statement.

Keeping both turned a single-valued fact into a two-element array, and the compiler **refused the
emission by name** rather than truncating it silently. That refusal is the only reason this was
found.

### 3. Some literals genuinely repeat — with different values

- `P600571` carries **two different** `dc:description` values ("The current status of…" and
  "References the current status of…")
- `P000725` and `P000972` each carry **two** `dc:alternative` titles

Reading only the first is the natural implementation and it loses data. `description`, `notation` and
`alternative` are multi-valued.

### 4. Singleton arrays come back as scalars

The replay engine unwraps single-element arrays at MERGE — a deliberate PG-JSON convention — so
**2,068 of 2,324** property nodes store `allDomainIds` as a bare **string**. An `Array.isArray()`
branch silently skips the majority of the corpus.

It was lossless only **by coincidence**: `allDomainIds[0] === domainId` happened to hold. A genuine
second domain would have broken it with no error. Every read is now shape-agnostic.

### 5. An empty value is still a statement

CEDS asserts `<dc:description> </dc:description>` on 27 option values. It is **saying** there is a
description and leaving it blank.

This one had a precondition: the forge had been stamping `description: ''` and `notation: ''` as
defaults on entities the source was **silent** about. Fabricating a placeholder into a source-named
property destroys the distinction the fix depends on — **"CEDS said nothing" and "CEDS said nothing
useful" are different facts.** Both defaults were removed before empties could be honoured.

*Consumer-visible:* some CEDS nodes no longer carry a `description` key at all.

---

## Identity

### 6. Identifiers get rewritten, and the original survives in one place

Option sets and option values carry a **derived** `cedsId` (`C000002` → `OS000002`,
`NI000002113286` → `OV000002113286`) — **20,511 of 23,237 entities**.

The source's own `dc:identifier` survives in exactly one place: **`crossRefs[0].raw`**. If that were
ever dropped, 20,511 statements would become unreconstructible **while every entity still looked
perfectly healthy**. The forge must never stop writing it.

### 7. Nested records are anonymous

1,920 change-history entries and 18 `owl:Restriction` blocks have **no identity whatsoever** in the
source. Every forged node needs one.

Minted as `<ownerUri>#editHistory/<sequence>` — **derived from the source alone**, so forging twice
yields identical ids and the byte-identical replay the whole build rests on still holds. Anything
incidental (a counter, a hash of run state) would make every rebuild look like a change.

### 8. So are 26 top-level things

CEDS defines its own vocabulary — `textFormat`, `changeVersion`, `editHistory`, `issueLink` — and
gives none of them a `dc:identifier`. That is CEDS being sensible: **`textFormat` is grammar, not a
data element.** And the forge was being sensible: an unidentified thing had no place in a model built
on identifiers.

⟪TQ ruling, 2026-08-02: *"mint the IDs"*⟫ — given after being told the cost. `VT<localName>` enters
the addressing scheme as a **new identifier kind**, which is a larger act than the derived ids above,
because those hang off an owner that already has one. Nodes carry `cedsIdIsMinted: true` so a minted
id is never mistaken for one CEDS assigned.

---

## Structure

### 9. Order is real, and it is NOT chronology

`editHistory` is `rdf:parseType="Collection"` — an **ordered** list — and CEDS's own ordering is
untidy. `P000225` "Has Program Type" carries seven entries in file order:

| position | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| **version** | 10 | 11 | 12 | **3** | **4** | **7** | **8** |

Sorting by version is the obvious, helpful, **wrong** thing: it produces a graph that reads better
and can no longer regenerate the file it came from. `sequence` is position in the **file**. The
chronological view is a query and costs nothing.

### 10. One kind, four source shapes

Vocabulary terms arrive as `owl:AnnotationProperty`, `rdfs:Class`, `owl:Class` **or** `rdf:Property`.
The shape travels on the node as `sourceElementName`; reconstructing it from the role would be
guessing at the one thing the source states outright.

### 11. A node can be two things, and can point outside CEDS

- `P000131` is an `rdf:Property` that **also** declares `rdf:type skos:ConceptScheme`. The forge
  gives each node one role and derives the type from it, so the second type had nowhere to live. It
  travels as data now — the one place where *"the role IS the fact"* stops being sufficient.
- `P001396`'s range points at `dc:format` — **foreign vocabulary**, neither a CEDS URI nor an XSD
  datatype, so both existing filters dropped it.

---

## The thing that needed no accommodation

**Invented stayed at 0 at every commit point.** Eleven exceptions, none of which required inventing
anything: each is a fact the source states and the graph now carries.

The one time invention appeared — four `rdfs:label` statements fabricated from local names on
declarations that have no label — the diff caught it and the commit was held until it was back to
zero. **A gap is a gap; a fabrication is a lie about CEDS.**

---

## The pattern, for the next standard

**Eight of the eleven are one closed assumption meeting an open reality:**

| assumed | actually |
|---|---|
| one value per predicate | sometimes two, sometimes duplicated, sometimes blank |
| one type per node | sometimes two |
| one identifier per entity | sometimes none, sometimes rewritten |
| one element shape per kind | sometimes four |
| an array is an array | sometimes a scalar |

The remaining three are about **order**, **provenance of identity**, and **references leaving the
standard's own namespace**.

None of this was discoverable by reading. All of it was discoverable by trying to write the source
back out and counting what did not come back.

---

*Round-trip verb: `graphBuilder -cedsRoundTrip --containerName=<graph>`*
*Gate suite: `graphBuilder -cedsGates --containerName=<graph> --reportJsonPath=<json>`*
