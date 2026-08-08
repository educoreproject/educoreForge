# Notes to the next Milo

**This is not a user document. It is the judgment that reading the code will not give you.**

Everything here was paid for. Most of it was paid for by someone who had already read the warning and
committed the error anyway, which is the part worth taking seriously: **these are not failures of
ignorance.** They are failures that feel like rigour while you are committing them.

---

## THE ONE THAT WILL GET YOU

### A fix feels like it discharges the whole class. The class is a PATTERN, not a location.

Phase 7 found a vacuous closure in `mp_auditConjunctiveAssertions.js` — a sum that held by
construction and could never fail. The builder named it beautifully (*"a tautology wearing a
measurement's clothes"*), repaired it properly, wrote it up in a self-audit as a class of defect…

**…and shipped the identical shape in a sibling probe written the same afternoon**, where
`51 + 65 = 116` was partition arithmetic printed as a measurement. Every proven row incremented the
total and was pushed into exactly one of two arrays, so the sum held BY CONSTRUCTION. The reviewer
demonstrated it by doctoring every lever in the ledger and watching it still print `CLOSES`.

**Repairing an instance and SWEEPING FOR THE SHAPE are different acts. Only the second is safe.**

When you fix something, immediately ask what else you wrote that week. Not what else is *like* it in
the abstract — what else your own hands made while the same idea was in your head.

---

## Evidence, and how it lies to you

### A red observed at the WRONG ALTITUDE is not evidence for the gate you meant to test

You invert something, you watch the suite go red, you conclude the gate works. **Check what actually
fired.** If a self-test or a precondition check sits *before* your gate in the execution order, your
inversion trips that instead — and you have proven the self-test, not the gate. The gate you care
about was never reached.

A gate that has only ever been shadowed is exactly as unproven as one that has only ever passed.

### A FILTER MUST BE PROVEN TO FILTER, NOT MERELY TO RETURN NOTHING

A comment stripper that deleted the entire document scores zero on every rejection specimen and looks
like a working filter.

**Hence the ACCEPT-CONTROL.** Every filter in this bundle carries specimens it must ACCEPT alongside
the ones it must reject. `mp_auditConjunctiveAssertions.js` carries seven, each requiring a different
score — parse / benign / refuse / strip-line-comment / strip-block-comment / **do not strip a label
containing `//` inside a string literal** / do not strip code after a comment.

`p7_repinnedDescriptorLevers.js` carries a `noOpControl` for the same reason: without it, a reader
serving a stale cached parse would make every red uninterpretable.

**A negative result from an instrument you have not proven can discriminate is not a result.**

### An instrument built to COMPUTE can disagree with its author. One built to RECORD a handed answer cannot.

The ledger once carried `measuredBy: "the third independent adversarial review"` — a figure *handed*
to the ledger rather than computed by it. Nothing recomputed it, so it could not notice the ledger
moving underneath it, and it was wrong by the time anyone read it.

**Build the thing that computes, even when you already know the answer.** Its whole value is that it
is free to tell you that you are wrong. Twice in Phase 7 the auditor found its own author's phantoms.

### A mechanism that predicts the right number is worth nothing until the artifact is READ

**This is the most dangerous item on the page, because the story arrives already fitting.**

Phase 6.5 published a five-`xs:sequence` shortfall with two named mechanisms explaining it:
`OrganizationType` absent from a file, `SponsorType` declared twice. Both were **fabrications**.
`OrganizationType` is at line 377 of `AdmissionsRecord_v1.0.0.xsd`, inside
`<!-- moved to core main per discussion with Tom 7/6/2008`. `SponsorType`'s "first occurrence" is
inside a `<!-- JAF 2011/06/03 Modified this ComplexType…` comment. **The sequences were never
missing.**

The author inferred a duplicate declaration from a `diff` of sorted name lists and **never opened the
file.** Line 317 says what it is in plain text.

**The countermeasure is mechanical, not attitudinal: when a mechanism explains a discrepancy exactly,
open the artifact before you write the sentence.**

---

## THE F-3 STORY — read this one twice

### Measurements independent in EXECUTION but identical in ASSUMPTION prove LESS than one

The supervisor counted `xs:sequence` in the corpus **four independent ways** and got **3,042** every
single time. That agreement was presented as corroboration and used to rule against a builder.

**All four counted RAW BYTES INCLUDING XML COMMENTS.** They were four spellings of one wrong basis.
The true declared figure is **3,037**.

**Both previously published figures were wrong** — Phase 6's 3,021 and the supervisor's 3,042 — and
the ruling built on the second was wrong with it.

**Four measurements that share an assumption are one measurement with a false confidence interval
attached.** Worse than one honest measurement, because the agreement is itself the thing that stops
you looking. Before you call measurements independent, ask what they share, not whether they ran
separately.

### ANY CORPUS COUNT MUST STATE WHETHER XML COMMENTS WERE STRIPPED, AND BY WHAT INSTRUMENT

**The PESC corpus carries schema that has been commented out and left in place.** It is not a
curiosity; it is everywhere and it is load-bearing on every count you will ever take here.

I hit it again in this pass, benignly. Counting `<xs:group … ref=` gives **283** over raw source and
**282** over the emitted output — a one-statement shortfall that does not exist. One of the 283 is
inside a comment. **Declared is 282, emitted is 282, and the class is closed.** Had I written the
sentence before checking, I would have published a phantom regression.

`p65_conservationCensus.js` now strips comments before counting, publishes the raw and commented-out
counts *beside* the declared one so the volume is visible rather than asserted, and runs a self-test
that plants each counted construct inside a comment and requires it to score ZERO — with an
accept-control outside a comment required to score ONE.

---

## Instruments and their silences

### NEVER redirect stderr away from an instrument whose SILENCE you intend to interpret

The supervisor ran `find -newermt "-35 minutes" … 2>/dev/null` to check whether a builder was working,
got empty output, and **reported that nothing had been written in 35 minutes.**

**`find` on this machine is `bfs`, and it REJECTS a relative timestamp** with `Invalid timestamp`. The
stderr redirect swallowed the error and left an empty stdout **indistinguishable from a clean
negative.** `-mmin -35` showed 41 files. A false alarm was raised on a suppressed error read as a
measurement.

**Use `-mmin -N`. Never `-newermt` with a relative time.** And more generally: if you are about to
conclude something *from an absence*, you must be able to prove the instrument would have spoken.

### BANNED INSTRUMENT — ordinary `grep`. Use `/usr/bin/grep -a`.

The corpus contains files that ordinary `grep` skips **silently**, treating them as binary. A skipped
file and a file with no match look identical.

### `graphBuilder` reads JSON from stdin — and there are TWO opposite failure modes

This one deserves care, because the two remedies contradict each other and you must know which
situation you are in.

**FAILURE MODE A — the hang.** A foreground pipe-driven invocation whose stdin is left inherited
**waits forever on stdin, with an empty log.** The remedy is to redirect stdin from `/dev/null`.
*(Inherited from Phase 7's record. I did NOT reproduce this in my pass and am passing it on as
received, not as observed.)*

**FAILURE MODE B — the silent discard. I DID observe this one, in this pass.** When graphBuilder is
itself the target of the pipe, adding a stdin redirect destroys the input:

```bash
jq -nc '{switches:{goldEvalCheck:true},...}' | node apps/graph-builder/graphBuilder.js < /dev/null
```

**The `< /dev/null` overrides the pipe. The JSON never arrives. graphBuilder prints its full help page
and EXITS 0.** Exit 0 plus a plausible page of output is a very good imitation of success.

**The rule that covers both: `< /dev/null` belongs on invocations that are NOT receiving JSON on the
pipe, and never on ones that are.**

### Run long builds nohup-DETACHED, with PID and log written to files

A foreground shell that dies takes the build with it. This is standard here, and there is a sharper
reason below.

### A FIXED OUTPUT PATH TURNS A RETRY INTO A DELETION

Phase 7's A/B pair script wrote each attempt to a fixed path. The stage-ON build failed early
(`neo4j at bolt://localhost:7827 never authenticated within 90s`, under contention from six
accumulated scratch containers), was re-run by hand **to the same path, and the failure log was
overwritten. It is gone.**

**NOTHING IS DELETED INCLUDES FAILURES** — and the artifact destroyed was precisely the one telling a
successor that the instrument is unreliable under container pressure. The reviewer caught it from the
artifacts alone: the surviving log carried neither of the script's own markers and no exit code, and
the `.done` stamp predated the build its log described.

**Every attempt writes to a path carrying a run stamp and a label. The script refuses to write to a
path that exists. The exit code is recorded even when the build dies before the closing marker.**

---

## The graph itself

### RESOLVE THE BOLT PORT FROM THE CONTAINER. NEVER FROM A DOCUMENT.

```bash
docker inspect DEV_pesc260805 --format \
  '{{range $p,$c := .NetworkSettings.Ports}}{{if eq $p "7687/tcp"}}{{(index $c 0).HostPort}}{{end}}{{end}}'
```

**Names are stable. Ports are minted per build and change every time.**

The instance that made this a rule: a stale pre-4.6a graph sat on bolt **7811** while the live
`DEV_pesc260805` was on **7821**. A reviewer following a port out of a document read the wrong graph
and reported 522 legitimate children as missing. Nothing complained, because **7811 served a real,
running, entirely plausible graph.**

**AND IT IS NOW WORSE THAN STALE, WHICH I OBSERVED IN THIS PASS.** That container has been removed —
and the very first build I ran was handed **bolt 7811** for a brand-new scratch graph. The port did
not go quiet when the container went away. **It was reassigned.** A document naming 7811 today points
at whatever was built most recently, which is a fresher way to be wrong.

**Removing the trap did not retire the rule. Documents go stale faster than graphs do.**

### Scratch container hygiene is a correctness issue, not tidiness

Six accumulated `DEV_gb_materialize_*` containers caused a real build failure by resource contention.
Remove the ones you create. **Do not remove ones you did not** — `DEV_pesc260805`, `GOLD_260718`,
`neoBrainV2`, `neoBrain_Milo`, `rag_CareerStoryGraph` and anything `usr_*` are not yours.

### `-replay` does not run the round trip

Observed in this pass:

```
[roundTrip] stage not applicable to -replay (the round trip runs at build time, against the build that composed the manifest)
```

A replayed graph is byte-equivalent to the built one and carries **no fresh verdict**. If someone
hands you a replayed graph and a verdict, the verdict came from somewhere else.

---

## Where things live

**THE DEVLOG IS OUTSIDE THE GIT REPOSITORY.** `system/management` is not versioned. The campaign
record at `system/management/zNotesPlansDocs/DEVLOG-pescForgeRebuild-080526.md` **will not appear in
any diff, will not be restored by any checkout, and is not covered by any commit you make.** Treat it
accordingly.

Build run directories are under `system/dataStores/buildLogs/`, **not** under the code directory —
the DEVLOG's `buildLogs/<runDir>` citations are shorthand, and `-goldEvalCheck` wants an absolute
path.

---

## And the habit under all of it

The campaign's worst errors were **published sentences, not broken code.** Prose is the easiest
artifact in the world to make plausible and the hardest to falsify. Every number in this bundle's
documentation is one somebody ran; where a claim is inherited rather than observed, it says so.

**Write the vaguer accurate sentence over the crisper one you have not checked.** The crisp one
survives right up until someone opens the file.
