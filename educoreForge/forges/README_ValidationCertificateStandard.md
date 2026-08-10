# How to write a validation certificate

**A validation certificate answers one question: how far can a person trust this graph?** It is read
by someone who does not already know what to look for, which is the whole reason it exists separately
from the verdict JSON, the known-issues backlog and the round-trip contract. Those three are found by
someone who knows something is there. The certificate is found by someone who does not.

Every bundle that declares a round-trip validator carries one, at
`forges/<standard>/README_ValidationCertificate.md`.

**Origin.** These rules were extracted from TQ's own edits to
`forges/pesc260805/README_ValidationCertificate.md` on 2026-08-08, after he judged the previous
version incomprehensible. That version ran 4,083 words with 96 bold spans and 36 all-caps runs, and
its limits section was longer than its findings, corpus record and backlog combined. The rewrite
finished at about 1,600 words. **Use `forges/pesc260805/README_ValidationCertificate.md` as the
worked example; this document is the reasoning behind it.**

---

## The six sections, in order

1. **Summary** — the verdict, the identity table, where the corpus came from, and what the graph
   holds.
2. **The counts** — the figures, including what is intentionally omitted.
3. **Round Trip Validation** — a few practical sentences on each validation process that ran.
4. **Known issues** — bullets, ordered by consequence, each asserting what it costs the reader.
5. **Provenance** — brief; URLs where they exist; what is open and what was done about it.
6. **For more information** — the detail document by name, and the other bundle documents.

The long argument goes to `README_ValidationDetail.md` beside it. Nothing is deleted; it is moved.

---

## The one rule everything else serves

**A certificate is read by someone deciding whether to use the data.** Not by an auditor of our
process, not by a reviewer of our methods, not by us. Every paragraph must answer one of three
questions for that person:

1. **What is in the graph?**
2. **How accurate is it?**
3. **What problems will I hit?**

**If a paragraph answers none of those, cut it — however true it is.** That test alone removed about
half of every certificate in the 2026-08-09 rewrite.

---

## Rules

### The opening

**1. Say what it is, then that it works, in that order, in the first four sentences.** What standard,
what it was built from, how many nodes; then the verdict; then one sentence saying what the check
actually did. Nothing else.

**2. NEVER open with a caveat.** A first paragraph that leads with what is missing reads as a document
written by someone anticipating blame. Problems have their own section — they do not get the doorway.
*(TQ, on a draft that led with the SIF container gap: "It BEGS them to start asking.")*

**3. Explain the term you are about to lean on.** "Round trip validation" means nothing to a reader
until you say that data was converted back from the graph and compared against the source. Say it
once, in the opening, in a clause.

### Known problems

**4. Problems are facts about the data. Opinions and worries are not problems.** *"Repeatability marks
present in the XSD are not in the graph"* is a problem. *"Only one instrument examined the graph"* is
an anxiety about our confidence and belongs nowhere in this document.

**5. Write each one as what a consumer will not find, or will find wrong.** Lead with the effect on
them, not with the mechanism that caused it.

**6. Relevance decides inclusion. If it is relevant, it is in.** Do not include something because it
was hard-won, interesting, or recently on your mind.

**7. A defect in someone else's published standard is not our business** beyond stating what it means
for this graph. Describe the consequence; do not diagnose the publisher.

### What never belongs

**8. No self-explanation.** Why we chose a method, what we considered and rejected, how careful we
were, what our instrument cannot see about itself. All of it belongs in the detail document.

**9. No document history.** No session names, no "this used to say," no changelog in the body.
**History earns its place only when it changes what a reader should believe** — CEDS's
character-reference defect survives because it is why a second instrument exists; everything else went.

**10. No operational instructions.** How to connect to a container is not part of how far to trust it.

**11. Watch for subordinate clauses that open a door.** *"…, which this certificate does not cover"*,
*"…, and that matching layer"* — nearly every one introduces an explanation nobody asked for. Prefer
two flat statements and a pointer.

### Language

**12. Every sentence needs a concrete noun.** *"What the round trip models is declared by the bundle
rather than derived by a reader"* is grammatical and means nothing, because the thing it is about — a
paragraph of text in an output file — is never named. This failure is more common than jargon and
harder to see in your own prose.

**13. No superlatives without a stated comparison.** "The most consequential finding" is a comparison
with the comparison left out.

**14. Say "missed," not "lost."**

**15. Gloss numbers inline** — `173,216 / 0 / 0 (reproduced / missed / invented)`.

**16. Name the two concrete things being compared**, not a symmetry.

**17. Do not shout, and measure rather than judge by eye.** No all-caps runs. Target one bold span per
60–80 words; below 1 per 50, take it seriously. **Measure before you ship:**
`grep -o '\*\*[^*]*\*\*' <file> | wc -l` against `wc -w <file>`. The document that prompted this
standard ran 1 per 42 with 36 all-caps runs and was judged incomprehensible.

### Scope and framing

**18. Name the scope in the opening when the standard has more than one role.** CEDS is both a
standard and a hub; the certificate says which one it covers before it says anything else.

**19. State an absence as a fact, not as an apology.** *"The hub is not in this graph and is certified
separately"* — not *"not present… returns nothing, by design."* The phrase "by design" is what you
reach for when you expect to be doubted.

**20. Say which figures were measured here and which were carried forward.**

---

## The claim in rule 1 is not free

Before writing *complete and usable*, confirm all of the following for the bundle in hand. **If any
fails, the certificate says something narrower and names the fix.**

| check | why |
|---|---|
| `invented` is 0 | a fabrication is never excused by coverage elsewhere |
| `missed` is 0, or every missed statement is enumerated and shown not to affect the model | an unenumerated gap cannot be sized by the reader |
| every declared validator actually ran | a declared-but-uninvoked stage emits no error and is indistinguishable from a working one |
| more than one instrument agrees, or the certificate says plainly that only one ran | a tool cannot audit the assumption it is built on |
| the source itself is not known to be missing content | a perfect round trip against an incomplete source is still an incomplete graph |
| the bundle declares a `semanticValidationLimit` | a declared limit travels with the number into every payload; a derived one drifts the moment someone edits the module |

**As of 2026-08-09, after a day's remediation:**

| bundle | passes | fails |
|---|---|---|
| `pesc260805` | six of six | — |
| `ceds` | five of six | no declared `semanticValidationLimit`, so its limits section is derived by reading code. Independent rdflib check run 2026-08-09 and it agreed |
| `edfi` | five of six | only one instrument examines the graph — no second implementation by another author. **Certified clean 2026-08-09**: the 349 carried, limit now declared |
| `sif` | five of six | the source itself is known to be missing content — 6,586 containers, 1,887 repeatability declarations. **Nothing on our side can fix it**, so this row may never close |

See each certificate's Summary for what it claims instead. **A bundle that fails a row is not thereby
disqualified from claiming anything** — SIF still claims a complete and usable rendering *of its
source*, and states in the same breath that the source is incomplete. Scope the claim to what holds.
