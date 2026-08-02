# Adding a field — read this before you start

**FOUR SEPARATE LISTS MUST AGREE BEFORE ONE FIELD EMITS. Miss any one and it vanishes
SILENTLY** — no error, no warning, just a statement reported LOST that is sitting in the graph
the whole time.

This cost four attempts to diagnose on 2026-08-02 for a change worth eight statements.

---

## The four lists

All in `forges/ceds/lib/roundTripCompiler.js`.

| # | list | what it controls | symptom if missed |
|---|---|---|---|
| 1 | `GRAPH_PROPERTY_BY_FIELD` | field name → node property | entity field never populated; **nothing emits** |
| 2 | `READ_PROPERTY_NAMES` | what the Neo4j reader actually PROJECTS | property is in the graph but arrives `undefined` |
| 3 | `FIELD_ORDER_BY_KIND` | which entity kinds may carry it | emits for some kinds, silently not others |
| 4 | `FIELD_EMISSION` | how it becomes XML (element, literal vs resource, `many`) | refused by name — **the one failure that is loud** |

Plus, upstream: the **parser** must carry the value, and the **forge** must land it on the node.

---

## The checklist

1. **Parser** (`lib/parser.js`) — is it already carried? The open-list rule catches every
   predicate the extractors do not claim for themselves, so usually **yes, for free**. Add to
   `INTERPRETED_PREDICATES` only if you are handling it specially, and to `NESTED_PREDICATES` if
   its value is a structure rather than a literal.
2. **Forge** (`forgeCeds.js`) — `rawEntity.annotations` is spread onto every node, so generic
   annotations need nothing. Anything interpreted needs an explicit line.
3. **All four compiler lists above.** Do them together, in one edit. Doing them one at a time is
   how the four attempts happened.
4. **Re-forge and measure.** The number must move by *exactly* the amount you predicted. "About
   right" means something else moved too — stop and find out what.

---

## Traps that have actually bitten

**`many: true` is not optional.** A predicate that occurs twice on one subject without it is
refused by name — correctly, since silent truncation would be invisible loss. `dc:alternative`,
`dc:description` and `skos:notation` are all genuinely multi-valued in CEDS.

**Empty is not absent.** `<dc:description> </dc:description>` IS a statement. `present()` treats
`''` as present and `undefined` as absent — which only works because the forge no longer stamps
`description: ''` as a default. **Do not reintroduce that default**; it destroys the distinction
between "CEDS said nothing" and "CEDS said nothing useful."

**RDF is a set.** The same subject-predicate-object twice is ONE statement. CEDS really does
repeat itself (`P000101` carries `minInclusive` twice, verbatim; five such duplicates exist).
Values are deduplicated in the parser.

**Some predicates live only on the meta-vocabulary.** `rdfs:range` and `rdfs:isDefinedBy` occur
*only* on CEDS's own vocabulary declarations. Adding emission rules without forging those
entities emits nothing and looks like a bug.

**Scalarized arrays.** The replay engine unwraps single-element arrays, so a property the forge
wrote as `['C000123']` reads back as the bare string. **Never test `Array.isArray()`** — use the
shape-agnostic unwrap. 2,068 of 2,324 property nodes are affected.

---

## Why it is like this

The compiler is a serializer with a hand-maintained vocabulary, and every one of those four
lists is an enumeration a new field has to be remembered into. **Four times in one day a closed
list silently dropped data**, in three different files, with a different symptom each time:

- the parser's closed field list → 57,547 statements never captured
- a missing reader projection → 3,849 **invented** empty XML elements
- another missing projection → statements in the graph reported lost
- a missing field→property map → immune to fixing the other three

The parser's list was replaced with an open rule and that class of failure is gone there. **The
compiler's four remain**, because a serializer genuinely needs to know its own output grammar.
Suspect them first.
