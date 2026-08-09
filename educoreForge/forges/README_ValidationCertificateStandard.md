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

## Rules

### Verdict

**1. Lead with what the reader may now believe.** The counts do not tell anyone what conclusion they
license. State it in a sentence — *"This round trip validation supports the judgement that this graph
is complete and usable"* — and only if it is true. If it is not true, say what IS supported and name
what would have to change. **Never write the sentence because the other certificates have it.**

**2. Say what an observation means for the verdict.** *"Files that fail on both sides, corpus and
extracted, count as success in the validation"* is the sentence the reader needs. An observation left
without its bearing is work handed to someone with less context than you.

### Structure

**3. The corpus's origin belongs in Summary, not in a later section.** A reader asking *what is this*
needs *where did it come from* in the same breath. Provenance keeps the acquisition rule, what is
open, and gaps in the record itself.

**4. Name a section for the process it documents.** *Round Trip Validation*, not *How it was checked*.

**5. One issue per issue.** A limitation and the measured instance of that limitation are one item.
Two items make a reader meet the same fact twice with no signal they are connected.

**6. Order known issues by consequence**, and say so at the top of the list.

### Compression

**7. Cut the epistemology.** Which instrument answers which question, what a certificate is for,
whether "semantically clean" equals "identical" — all true, none of it helps a reader decide
anything. It belongs in the detail document.

**8. Cut the meta-justification.** Describe the two passes. Do not explain why there are two; the
reader works that out.

**9. The counts get a note, not an essay.** State what is omitted. Do not argue the doctrine behind
the omission on this page.

**10. One sentence for the gate.** *"`goldEvalCheck` reports PASS for this build."* The negative
control and why it matters go to detail.

**11. A known issue states its fact and stops.** Resist appending the reasoning that made you
comfortable with it.

**12. No filler labels.** If a paragraph needs to be announced with *Note:*, it is not earning its
place.

### Language

**13. Do not shout, and measure rather than judge by eye.** No all-caps runs. **Measure before you
ship:** `grep -o '\*\*[^*]*\*\*' <file> | wc -l` against `wc -w <file>`.

**Target one bold span per 60–80 words.** That range is calibrated from the four certificates written
under this standard on 2026-08-09 — pesc260805 at 1 per 79, ceds 1 per 69, edfi 1 per 62, sif 1 per
55 — rather than chosen in advance. **The number in the first draft of this document was one per
hundred, and all four documents written under it missed that by a wide margin**, which is a fact
about the number rather than about the documents: much of the emphasis is structural (numbered-issue
lead phrases, table cells, section-opening claims) and does not read as shouting. Recalibrated
2026-08-09.

**Below 1 per 50, take it seriously.** That is where emphasis stops marking the important sentence
and starts hiding it. For reference, the document that prompted this whole standard ran **1 per 42**
with 36 all-caps runs, and was judged incomprehensible.

**14. A headline states the finding, not its epistemic status.** *"The nine XSD files would not
compile"*, not *"the nine compile refusals are a lower bound, not a defect total."*

**15. Gloss numbers inline** — `173,216 / 0 / 0 (reproduced / missed / invented)`.

**16. Say "missed," not "lost."**

**17. Name the two concrete things being compared**, not a symmetry. *"Compiles the source corpus and
the extracted XSD data"*, not *"compiles both sets of files."* Likewise *"extracts XSD from the
working graph"*, not *"re-emits from the materialized graph."*

**18. Every pronoun needs an unmistakable antecedent.** *"None of those five"* broke because the
nearest list was not the intended one.

**19. Explain what a version designation denotes. Do not admonish about it.** *"The version, 01, was
generated here and refers to this specific interconnected set"* tells a reader what the number means.
*"It is OURS and must never be read as a published edition"* only warns them off a misreading they
had not yet made.

### Content

**20. Define every term of art on the page.** Tiers, source-tier-only, compile refusals. **If the
reader must already know the project's vocabulary, the certificate has failed at its one job.** A
short table beats a paragraph.

**21. A known issue must say why it does not invalidate the result** — or say that it does. A
limitation stated without its consequence leaves the reader to assume the worst, and a certificate
whose caveats cannot be sized is indistinguishable from one saying the whole thing is broken.

**22. An open item says what was done about it.** *"Substitution is a forge decision, not an
acquisition one"* is a jurisdictional dodge. Say what the forge actually did, and what that does and
does not prove.

**23. Check whether a limitation is a limitation at all.** Attribute order was filed as a gap through
two drafts. It is not one — XML attribute order carries no meaning, so there is nothing to lose. **A
true statement filed under the wrong heading acquires a meaning nobody wrote.**

**24. Distinguish the two completeness questions and answer both.** *Ingestion* completeness — does
the graph carry what the source says — is what the round trip measures. *Corpus* completeness — is
this the right source — is answered by the acquisition record, not by silence. Reporting the second
as unknown because the first cannot see it understates the work.

**25. Say which figures you measured and which you carried forward.** Where a number came from
another document or an earlier run, name the source in the same breath.

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
| `ceds` | six of six | — *(independent rdflib check run 2026-08-09; no declared limit, so §3 is derived — see its certificate)* |
| `sif` | five of six | the source itself is known to be missing content — 6,586 containers, 1,887 repeatability declarations. **Nothing on our side can fix it**, so this row may never close |
| `edfi` | four of six | 349 statements missed and enumerated; no declared limit |

See each certificate's Summary for what it claims instead. **A bundle that fails a row is not thereby
disqualified from claiming anything** — SIF still claims a complete and usable rendering *of its
source*, and states in the same breath that the source is incomplete. Scope the claim to what holds.
