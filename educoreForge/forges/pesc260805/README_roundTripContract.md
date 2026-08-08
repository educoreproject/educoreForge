# The round-trip contract

**The acceptance criterion, in one sentence:** if our graph really represents the PESC schema family,
we must be able to write the graph back out as XSD and get the same statements.

**This document describes the CONTRACT. `README_ValidationCertificate.md` reports a RUN.** If you want
numbers, read that one. If you want to know what the numbers are permitted to mean, read this one.

---

## Semantic equality, not byte equality — and the sentence that must never be dropped

Both sides are reduced to canonical statement sets and compared by set membership. **The instrument
compares statements, not bytes.**

⟪R-VAL-7⟫ **"Semantically clean" MUST NEVER be reported as "identical."** Semantic validation cannot
detect a change that is semantically null but byte-visible. That is not a caveat added later; it is a
requirement of the specification, and the verdict artifact carries it in its own
`semanticValidationLimit` field.

### THE STATEMENT SET IS ONE THIS INSTRUMENT CHOOSES TO MODEL

**This is the hinge of the whole contract.** A dimension that neither side models cannot register as
loss — it reports zero on both sides and **reads as fidelity**.

What IS modelled, each on both sides:

- **The compositor** — kind, effective occurrence, nesting, and the ORDERED particle list
  (`declaresContentModel`, `compositorKind`, `compositorMinOccurs`, `compositorMaxOccurs`,
  `particleAt:N`).
- **Prefix bindings** — `declaresNamespacePrefix` and `boundNamespace` per `xmlns` declaration.
- **Element order** within a content model, made visible by the ordinal in `particleAt:N`.

**Phase 6's declaration that element order is undetectable was RETRACTED ON EVIDENCE**, not on
argument: a driven sibling swap in a graph row moves 2 statements under the current form and moved 0
under the previous one.

What is NOT modelled is enumerated in `README_KnownIssues.md` §1 and travels with every restatement of
the verdict. **Three dimensions; the type-reference namespace is the serious one.**

---

## THE ASYMMETRY — invented and lost are not two sides of one coin

**`inventedTotal > 0` FAILS the build, unconditionally. `lostTotal > 0` is TOLERATED and logged.**

**An invented statement is an assertion about PESC that PESC never made — a lie the graph tells. A
lost statement is a truth the graph fails to tell.** A gap is a gap; a fabrication is a different kind
of thing entirely, and no amount of coverage elsewhere excuses one.

`lostTotal` is therefore the **enrichment meter**, and a nonzero value is a work order rather than a
verdict. `inventedTotal` is the verdict.

**No percentage participates in acceptance.** This project has already watched a tampered emission
carrying four fabricated statements report 71.9% fidelity. Acceptance is counts, never ratios.

---

## Round trip is defined over the SOURCE-tier projection — R-VAL-1

**A graph richer than its source is not a failure**, so long as the surplus is marked and the emitter
reads only the marked subset.

Every node carries a `pescTier`. The emitter reads `source` and nothing else. Emitting a derived or
synthetic node would *invent* a statement PESC never made — which the diff would correctly report as
the worst category.

**The exclusion is enforced as a stated decision a reviewer can see**, not as an accident of which
node types happen to exist today: a suite assertion holds that **zero synthetic content is reachable
by the emitter's source predicate.**

---

## Synthetic content is validated by a DIFFERENT instrument — R-VAL-5

**Synthetic content cannot be round-trip validated against a source file. It matches none by
construction.**

It is validated instead by **reproducibility of its derivation**: re-running the documented synthesis
rule over the preserved inputs must reproduce exactly what is in the graph.

**Fidelity checking and reproducibility checking are different instruments and must never be
conflated.** The validator owns both and reports them as separate fields —
`roundTripClean` versus `syntheticReproducible`.

**The qualification travels with the boolean.** `syntheticReproducible: true` covers **S-1 identity
only** — the merged definitions by kind and name. **S-1c's children and S-2 are unchecked.** A reader
who takes the bare `true` has been told less than it sounds.

---

## Every normalization must be NAMED — R-VAL-2

**Whitespace inside `xs:documentation` is significant to a reader and must not be silently
collapsed.** The incumbent's canonicalizer collapsed all of it (`.replace(/\s+/g,' ').trim()`) — the
same blind spot that once hid 62 character references from CEDS's comparator.

If any normalization survives review it is **declared and separately counted**. The verdict carries a
`whitespaceOnlyDifferenceTotal` field for exactly this reason: a difference that is whitespace-only is
a *diagnostic* pointing at character encoding, not a missing statement, and the pair of numbers tells
you which repair you are facing before you start.

---

## RT-13.3 — A DECLARED VALIDATOR THAT CANNOT LOAD REFUSES EVERY BUILD

**The bundle declares its validator in `parserDescriptor.ini`, beside `entryModule`. Declared — not
sniffed.**

**A declared validator that does not exist, or does not load, REFUSES the build by name — on EVERY
build, stage on or off.** It never downgrades to "absent."

**Why the refusal rather than a skip:** a gate that quietly does not run is indistinguishable from one
that passed. Silence is the failure mode this rule exists to eliminate.

That is why the declaration is never added speculatively. It went into this bundle in Phase 5 only
after the module loaded clean and produced a verdict whose numbers were trusted.

### The refusal semantics are PROVEN, not asserted

`test/probes/p7_repinnedDescriptorLevers.js` mutates the shipped `parserDescriptor.ini` and observes
three assertions go red. **Re-run in this pass; every row matched expectation:**

| lever | assertions reddened |
|---|---|
| `noOpControl` (accept-control) | — |
| `removeTheDeclarationEntirely` | declared · exists · exports |
| `pointTheDeclarationAtAMissingFile` | declared · exists · exports |
| `pointTheDeclarationAtAModuleExportingNoValidate` | **declared · exports** (exists stays GREEN) |

**That last row is why the check is three assertions and not one conjunction.** A module that exists
but exports no `validate()` is a real and distinct failure, and a single `A AND B AND C` would have
hidden a case its own receipt could not distinguish. **The separation was measured, not preferred.**

**The probe must stay one-shot** — see `README_KnownIssues.md` §8.

---

## THE INDEPENDENT INSTRUMENT — R-VAL-4

**A tool cannot audit the assumption it is built on.**

A third-party Python XSD **schema-component-model** implementation (`xmlschema`, `XMLSchema11`) reads
both the source corpus and the emitted output. It shares no code with our emitter or our
canonicalizer, and the foreignness is a feature rather than a compromise: **a different-language
instrument cannot borrow our blind spots even by accident.** CEDS's `rdf-independent-check` set the
precedent.

**It cannot tell you which predicate to fix. It tells you whether the answer is true.**

What it reports: per side, files attempted / compiled clean / refused, plus a refusal-cause tally and
a count of types whose traversal was unavailable. Then `compileAgreement` — the divergence in both
directions, which is the part that matters.

**Its refusal counts are LOWER BOUNDS.** It is a fail-fast processor: it reports the FIRST fault per
component and stops. **A counter fed by a fail-fast reporter measures what failed first, not what is
wrong.** The claim the instrument supports is that the two sides refuse *the same files for the same
causes* — never that the tally is the number of defects in PESC's bytes.

**Gate 6 carries an explained-disagreement clause.** The two instruments must agree, or disagree by an
amount that is **fully explained**. An unexplained gap is a failure even when it is small.

---

## The anti-cheat gate — R-VAL-3

**A check that has only ever passed has not been tested.**

The validator ships with planted defects it must catch, each demonstrated RED before the build is
believed green: drop one enumeration value; swap two sibling elements; change one `minOccurs`; alter
one character of documentation; **repoint one reference to a same-named type in a different
namespace**; delete one type.

**That fifth mutation is the one to watch.** It is the exact shape of the residue in
`README_KnownIssues.md` §1a — and the mutation suite planting it in a *graph row* is a different test
from the comparator detecting it in a *type reference*. Do not read a green mutation suite as
retiring that residue.

---

## What a PASS from this contract does NOT establish

**That the graph is complete with respect to PESC.** It establishes that the graph reproduces **the
ingested snapshot**. A round-trip verdict cannot see what was never ingested — which is exactly the
criticism that retired the incumbent's `contentGap 732`, and it applies here with equal force. The
snapshot is pinned in the verdict by combined digest and per-file sha256 so that "which snapshot" is
never a question.

**That the numbers came from this build.** `-goldEvalCheck` exists to answer that, and it REFUSES a
run directory whose stage did not run. **A verdict handed to you without its run directory is a
number, not evidence.**

**That a replayed graph has been validated.** `-replay` does not run the stage, and says so in its own
log line.
