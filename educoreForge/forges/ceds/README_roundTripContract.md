# The round-trip contract

**The acceptance criterion, in one sentence:** if our graph really represents CEDS, we must be
able to write the graph back out as RDF and get the same statements.

⟪TQ, 2026-07-31⟫ *"the CEDS OWL source describes a graph. We want to represent it as a graph.
We should be able to write a graph that we could extract and compile back into the OWL."*

This replaced every earlier "is field X captured?" style of checking. **Completeness stopped
being a judgment and became a number**, and the number found things no amount of reading the
code would have.

---

## Semantic equality, not byte equality

Whitespace between elements, attribute order, prefix choices, the order entities appear — none
of these are statements, and none of them count. **A missing or extra statement counts.**

---

## TWO LAYERS, and only one round-trips

**Layer 1 — CEDS, faithfully represented.** Classes, properties, option sets, values, every
statement relating them, every annotation. This is what the round trip measures.

**Layer 2 — the matching index.** `HubReference` tuples, embeddings, address signatures.
**CEDS contains no such thing.** We invented it, it is derived from Layer 1, and the compiler
must never emit it — doing so would *invent* statements CEDS never made, which the diff would
correctly report as the worst category.

Every graph query in the compiler names its roles explicitly on **both** endpoints, so the
exclusion is a stated decision a reviewer can see, not an accident of which edge types happen
to exist today. Gate `L-4` enforces that.

> The two layers travel in ONE schema block and that is deliberate.
> ⟪TQ, 2026-08-02⟫ *"The only reason I would want the hubReferences separate is so that I could
> change them. I would only want to do that during development. Once it is all correct,
> separation is just another opportunity for error."*

---

## THE GOVERNING RULE

⟪TQ, 2026-08-02⟫ **"If it is in the OWL, it has to come out of the graph."**

Stated while answering a narrow question about validation constraints, but it settles **every**
predicate: nothing in the source is optional to carry. Any future proposal to skip one must
argue against this rule explicitly, not quietly omit the predicate.

Its companion, the tiebreaker when two representations are equally faithful:
⟪TQ⟫ **"maximally traversable."**

**The manifest of exclusions is empty.** Zero loss means zero, with nothing argued at the margin.

---

## Enforcement is TWO STEPS, and neither substitutes for the other

### 1. Our comparator — `forges/ceds/lib/roundTripDiff.js`

Fast. Per-predicate. Attributed to subjects. It tells you **what is missing and where**, which
is the work order. Run it constantly.

### 2. The independent check — `lib/rdf-independent-check/`

rdflib, applying the RDF/XML spec's own parsing rules, in a throwaway virtualenv under
`dataStores/`. It cannot tell you which predicate to fix. It tells you **whether the answer is
true.** Slow (~90s; it parses 19MB twice). Run it once per acceptance.

### Why both — the story that settled it

Our comparator collapses internal whitespace **on both sides**, deliberately, so indentation can
never register as loss. Correct for its job — and it made a real difference structurally
invisible.

CEDS writes 62 `&#13;` character references. Our emitter wrote raw carriage returns. XML 1.0
§2.11 **requires** every conformant parser to normalize those away on the next read, so 20
literals quietly changed. Strict RDF says those are different statements. **Our instrument
reported zero, honestly, under its own definition.**

Only a parser sharing no code with ours could see it.

> **A tool cannot audit the assumption it is built on.**

That is gate `C-3`, and it is the reason the second step exists. It reports two numbers: STRICT
is the verdict, whitespace-normalized is a **diagnostic** — `20 strict / 0 normalized` means
every difference is inside literal text, so look at character encoding rather than for a missing
statement. Different repairs entirely, and the pair tells you which before you start.

---

## The gates

46, declared as DATA in `forges/ceds/gates/cedsFidelityGates.jsonc`, evaluated by
`lib/roundTripGates.js`.

**Why data and not code:** this project has twice shipped a gate that COMPUTED a signal and
forgot to ASSERT it. A gate written as `{measure, comparator, expected}` cannot — the gate does
not contain the check, the harness does. That failure mode is designed out rather than watched
for.

**Every gate has a twin** — a named fault injection that must turn it RED. A gate whose twin has
never been observed reports `UNPROVEN`, never `PASS`.

**Three ways a passing comparison is still not a pass:**

- `UNPROVEN` — passed, but nobody has watched it fail
- `UNMEASURED` — nobody supplied the measure. **A failure, never a skip.** A gate passing for
  want of measurement is the exact bug the suite exists to catch
- masked — does not exist as a state at all (gate `M-2`)

**No percentage participates in acceptance.** A tampered emission carrying four fabricated
statements still reported 71.936%, proven live during an audit. Acceptance is `lost == 0 AND
invented == 0` — counts, not ratios.

**A red suite during enrichment is CORRECT.** Its redness is the work order. There is
deliberately no expected-to-fail state.

### Currently unmeasured (7)

Determinism across two forges, the hub-stripped compile, the source-absent compile, and others.
Each prints the work that would answer it. **None is a suspicion — they are unasked questions.**

---

## R-1: the round trip fails the build

Wired into `-build`, inside `materializeSchemaBlocks`. It runs only when CEDS is in the recipe.

**Invention always fails, unconditionally.** A gap is a gap; a fabrication is an assertion about
CEDS that CEDS never made.

**The escape hatch makes you name the number.** `--allowFidelityLoss=12` accepts twelve lost
statements and nothing else — thirteen still fails. It cannot be left switched on to absorb a
*future* regression; it is a statement about one known gap, not a mute button. A plain on/off
skip is exactly the masking gate `M-2` forbids and is deliberately not offered.

**A missing source ontology is a refusal, not a skip** — a gate that quietly does not run is
indistinguishable from one that passed.
