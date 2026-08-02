# Where every id comes from

Four kinds of identity live in this graph, and they are not interchangeable. One of them is
**load-bearing in a way that is easy to destroy without noticing.**

---

## 1. Source ids — CEDS said it

`dc:identifier` on classes and properties: `C200400`, `P001071`. Carried as `cedsId`. Nothing
clever here.

## 2. REWRITTEN ids — and the one place the original survives

Option sets and option values carry a **derived** `cedsId`:

```
C000002        →  OS000002
NI000002113286 →  OV000002113286
```

**20,511 of 23,237 entities** are rewritten this way. The prefix disambiguates: the bare 6-digit
core is reused across a class and its characterizing property, so it is not unique alone.

### THE FRAGILITY

**The source's own `dc:identifier` text survives in exactly ONE place: `crossRefs[0].raw`.**

If `crossRefs` were ever dropped, or its `raw` slot stopped being populated, **20,511
`dc:identifier` statements become unreconstructible while every entity still looks perfectly
healthy.** No error, no missing node, no failing query — just a round trip that quietly loses
statements.

The forge programming guide describes `crossRefs` as "bridge fuel… optional — most standards
have no such native anchor." **For CEDS it is not optional.** Gate `A-1` asserts all 20,511 are
present.

## 3. DERIVED ids — for records CEDS left anonymous

Change-history entries (1,920) and `owl:Restriction` blocks (18) have **no identity whatsoever**
in the source. Every forged node needs one, so it is minted:

```
<ownerUri>#editHistory/<sequence>
<ownerUri>#restriction/<sequence>
```

**Reproducible from the source alone.** Forging twice yields identical ids, which the
byte-identical replay the whole build rests on depends on. Anything incidental — a counter, a
timestamp, a hash of run state — would make every rebuild look like a change.

It also means **owner and order are both recoverable from the entry alone**, so the compiler
reassembles each history with no join and no extra property.

### `sequence` is FILE POSITION, never chronology

`editHistory` is `rdf:parseType="Collection"` — an ordered list — and CEDS's ordering is untidy.
`P000225` "Has Program Type" carries seven entries in file order:

| position | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| **version** | 10 | 11 | 12 | **3** | **4** | **7** | **8** |

Sorting by version is the obvious, helpful, **wrong** thing: it produces a graph that reads
better and can no longer regenerate the file it came from. The chronological view is
`ORDER BY changeVersion` and costs nothing.

## 4. MINTED ids — for CEDS's own vocabulary

CEDS defines 26 terms for its own use — `textFormat`, `changeVersion`, `editHistory`,
`issueLink` — and gives none of them a `dc:identifier`. That is CEDS being sensible:
**`textFormat` is grammar, not a data element.**

⟪TQ ruling, 2026-08-02: *"mint the IDs"*⟫ — given after being told the cost. They get
`VT<localName>`, a pure function of the source URI so it is stable across re-forges.

**These are TOP-LEVEL entities**, so `VT` enters the addressing scheme as a **new identifier
kind** — a larger act than the derived ids above, which hang off an owner that already has one.
Every such node carries `cedsIdIsMinted: true` so **a minted id is never mistaken for one CEDS
assigned.**

---

## Rules that hold across all four

**`stableId` is the URI.** CEDS's `stableUriPropertyName` is `uri`; the URI is the subject of
every statement about an entity and is what edges resolve against.

**Derivation must be reproducible from the source alone.** This is not a style preference. The
build proves `graph == replay(manifest)`, and an id that varies between runs breaks that
silently — every rebuild reads as a change and the proof becomes noise.

**Never invent an identifier that could be mistaken for a source one.** The `VT` prefix and the
`cedsIdIsMinted` flag exist for exactly this. A consumer must always be able to ask "did CEDS
say this, or did we?"
