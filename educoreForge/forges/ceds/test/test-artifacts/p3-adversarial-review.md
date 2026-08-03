# Phase 3 Adversarial Review — hub reimplementation bridge/evidence path
Reviewer: adversarial pass over the uncommitted Phase-3 diff (SCARLET_COMPASS build), 2026-08-03.
Scope: SPEC §6, gates G-14/G-15/G-17, ruling R-P3-1, the 25-file diff, runCedsHubBridgeGates.js, run logs.
Provenance: everything below is **code fact** from reading the diff/sources/logs unless marked *estimation*.

## VERDICT: SOUND-WITH-GAPS
0 STOP · 0 MUST-FIX · 4 SHOULD-FIX · 7 NOTE

The core claims survive attack: contract enforcement is real and observed red, the no-reembed
path is genuinely structural (not cosmetic), the live gates measure the live graph, and the
generation/cache bump chain is constant-driven with no stale site. The gaps are hardening and
closed-list-hygiene issues, none of which falsifies the builder's claim.

---

## SHOULD-FIX

### SF-1 — G-15 cleanup is not failure-safe on the PRESERVED graph
`forges/ceds/test/runCedsHubBridgeGates.js:544-627`. The mini-bridge run (task at :544) and the
cleanup tasks (:592 DETACH DELETE, :600 REMOVE label, :602 verification) are sequential tasks in
one pipeRunner. pipeRunner short-circuits on error, so a mid-run failure (Opus refusal, Voyage
outage, graph write error — all realistic) exits BEFORE cleanup, leaving the two
`lif:phase3G15:*` fixture nodes MERGEd into DEV_cedsHubV2_080326 and potentially the
`phase3G15MiniBridge` node-label stamped on a real card (the writer labels BOTH edge endpoints).
The supervisor obligation "the graph exits as it entered" holds only on the happy path.
Failure scenario: a transient Opus 529 during a re-run silently dirties the phase graph; the next
run's MERGE is idempotent so it self-heals for fixtures, but a stranded label on a real card
survives until a successful run's REMOVE. Fix: move cleanup into the terminal callback so it runs
on both paths (the fixtures' unmistakable prefix makes this cheap).

### SF-2 — G-14's definition assertion is conditionally vacuous, and the qualifier line is unasserted at gate level
`runCedsHubBridgeGates.js:160-163`: `if (oneBlock.requiredDefinitionFragment && ...)` — the
fragment is `flattened.propertyDefinition.slice(0,60)` (:437-438), so a sampled card that carries
no propertyDefinition silently skips the definition check. The qualified card is sampled only by
`qualifierNames IS NOT NULL` (:394) with no guarantee of a definition; for that card G-14 may
assert only the domain line + caveat absence. Separately, the rendered QUALIFIED block's
`Qualifier: ... [names]` line is never asserted by G-14 at all — a renderer regression dropping
the qualifier line on live cards would pass all three gates. (It IS bound at unit level:
test-evidenceRenderer's strengthened tuple-block section binds every line — this is why it's
SHOULD-FIX, not MUST-FIX.) Fix: sample the qualified card with `propertyDefinition IS NOT NULL`
and add a required qualifier-line fragment for the qualified block.

### SF-3 — the G-14 caveat sweep is a second unguarded closed list, and non-recursive
`runCedsHubBridgeGates.js:260-288`. `CAVEAT_SWEEP_DIRS` is a hardcoded list
(bridge-maker lib/lib.d/bridges + forges/{bridges,case,ctdl,sif}/bridges) swept with a
NON-recursive `readdirSync` (:276). Today every listed dir is flat and edfi has no bridges dir
(verified), so coverage is currently complete — but a future `forges/edfi/bridges/` or a
subdirectory inside any swept dir is silently unswept. This is exactly the closed-list disease
R-P3-1's registry names in its own comment — but this list carries no such trap comment. Fix:
recursive walk, or at minimum the named-trap comment the ruling made mandatory for its sibling.

### SF-4 — sifNominate's crossref rides the flatten's COMPUTED cedsId (one fact, two names) — confirmed, must stay tracked
`forges/sif/bridges/sifEvidenceBridge.js:413-415` reads `oneCandidate.cedsId`;
`lib.d/sourceWalker.js:54` computes `cedsId: v1(props.cedsId) || v1(props.canonicalKey) || v1(props.propertyKey)`.
Code fact: new cards carry NO cedsId property, so the crossref resolves via canonicalKey — the
builder's claim that it works is TRUE, and behavior is correct today. But the identity chain
candidateAnchorKeys just retired survives here wearing the flatten's name, silently violating
one-fact-one-field: a future card that ever grows a real `cedsId` property differing from
canonicalKey changes crossref behavior with zero refusal. The supervisor directed a
Phase-5-adjacent cleanup; this review's finding is that nothing in the tree marks it (no comment
at :415 names the debt). Fix in Phase 5: read canonicalKey directly, or comment the debt at the
read site now.

---

## NOTE

### N-1 — renderTupleBlock is not self-defending; safety is entirely the ⟪A3⟫ seam's
`lib.d/evidenceRenderer.js` (v5): `Domain: ${domain.domainName} (${domain.domainId})` is pushed
unconditionally — a meaning-less tuple reaching it renders `Domain: undefined (undefined)` into
a judge prompt rather than refusing. Verified unreachable through the pipeline: evidenceComposer
runs evidencePackageViolation (:313) → candidateEvidenceViolation (:324) →
hubModulePresentationViolation before callback, and the hub module itself refuses first. But
`renderTupleBlock` is a direct export (:434) — any future direct caller (a report tool, a debug
path) gets the fabrication. Same class: `isQualified && Array.isArray(qualifierNames) && length`
silently DROPS the qualifier line instead of refusing when handed a gate-bypassing tuple. Both
are documented design ("gating lives at A3") — recorded here so the residual is named.

### N-2 — copyPresentFields silently treats wrong-typed present values as absent
`lib.d/cedsHubModule.js` hasProse/copyPresentFields: a present-but-non-string field (e.g. a
numeric propertyNotation ever stamped by a forge change) is silently omitted from the
presentation — absence propagation swallowing a type fault rather than refusing it. The contract
gate would not catch it either (optional fields checked only when present as strings on the
EVIDENCE, and the field simply won't be there). Low likelihood; contained to optional prose.

### N-3 — flattenFullRecord still manufactures synthetic cedsId and defText on every card
`lib.d/sourceWalker.js:93-103`: the computed layer wins on overlap, so every flattened card
carries `cedsId` (=canonicalKey) and `defText` (=name — cards carry no description/searchText).
Readers beyond sifNominate: `lib.d/selector.js:99,142` and `lib/inferencePipeline.js:123,166`
use `candidate.cedsId` as targetKey (legacy scalar path, not the §6 evidence path);
`evidenceComposer.js:97` / `evidenceContracts.js:207` (display labels only). Nothing breaks
today; the synthetic fields are a standing ambiguity source. Also: builder's open-item 2
confirmed — case/sif nomination tokenization is effectively name-only on the candidate side.

### N-4 — G-15's LIVE proof covers genericBridge only
The live seam counter ran one genericBridge mini-bridge. case/sif zero-reembed is proven
hermetically (verified: both suites keep a batchEmbedCalls ledger, assert source-texts-only, and
have OBSERVED-RED no-embedding/no-embedText refusals through the real bridgeMaker.run). The diff
shows the three bridges' vectorize steps are structurally identical. Acceptable; recorded.

### N-5 — G-15's twin corrupts the MEASURE's data, not the seam
`runCedsHubBridgeGates.js:714-726`: forceOneCandidateEmbed appends a candidate embedText to the
observed list and re-computes — it proves the comparator discriminates, not that the seam would
CAPTURE a real forced embed. Mitigated by the vacuous-counter refusal (:183-185: an unfired
counter is a violation) plus the verified fact that the bridge path's ONLY embedding-client
require is vectorizer (lib.d/vectorizer.js is a pure re-export of lib/vectorizer.js, so the
injected seam IS the kit's seam — checked because the two-file layout invited a bypass that
isn't there). Consistent with the Phase-1/2 twin doctrine ("re-run over a corrupted clone").

### N-6 — G-14 asserts by substring, not line-binding — but honestly
`indexOf(requiredDomainLine)` where the required string is independently derived from the card's
own fields; renderCandidateBlock (verified :335-350) prints no embedText/defText, so the
definition fragment can only be satisfied by the tuple block's Definition line. The laxity is
theoretical. The vacuous-skip case is SF-2.

### N-7 — refusal-message display chains
The bridges' refusals use `canonicalKey || stableId` label chains — the same a||b display
pattern the builder's own self-audit replaced in facetScan with candidateLabelOf. Cosmetic
inconsistency only (display labels, no downstream reader).

---

## ATTACKS THAT FAILED (verified claims — the passing suites do NOT hide these)

- **A. Contract enforcement**: cedsHubModule refuses missing domainName/propertyName NAMING the
  card (canonicalKey in the message — code fact, resolveDomain/resolveProperty). The ⟪A3⟫ gate
  (evidenceContracts.js:227-236) now runs hubModulePresentationViolation on considerations.tuple
  AND refuses the three retired fields on sight (RETIRED_TUPLE_EVIDENCE_FIELDS, :522). The
  refusals are OBSERVED RED in test-evidenceContracts (retired-field-by-field, missing-domain,
  missing-propertyName, ''-definition — verified in the diff). End-to-end old-shape flow is
  impossible: old cards carry no `embedding`, so all three bridges refuse at the candidate-read
  step before any evidence work; a hypothetical embedded old card dies at the hub module.
- **B. Renderer honesty**: definitions render ONLY when present (conditional pushes, no '(none)'
  in the meaning lines, the caveat string deleted — `grep 'may be incomplete'` over the full
  bridge scope: zero, independently re-verified). Qualifier rendering does not zip
  names-to-keys positionally in the renderer; parallelism (length mismatch, empty-string names,
  names-without-keys) is refused in cedsHubModule.resolveQualifierNames — refusal, not
  zip-truncation.
- **C. No-reembed reality**: batchEmbed call sites in all three bridges now pass
  `args.sourceNodes.map(...)` exactly (verified in the diff); candidate.vector = candidate.embedding
  with refusal-if-absent-or-non-array. R-P3-1's pass-through delivers number[]: the registry
  spellings (embedding/qualifierKeys/qualifierNames) match the live graph's property names —
  proven live, not assumed, by G-15's successful read of all 94,602 cards' vectors and G-14's
  real-card renders (bridgeGatesRun2.log). The three-state test (7 observed red pre-fix) and the
  reverted fixture pre-wrap are in the diff as claimed.
- **D. facetScan retirements**: buildDomainMap/composeCandidateEmbedText deleted AND de-exported;
  candidateDomainText/embedTextForCandidate throw by name (no ''-return); candidateAnchorKeys is
  canonicalKey-only; no surviving domainMap consumer anywhere outside test files (grep-verified;
  ctdl has only authored/structure bridges, no evidence bridge).
- **E. Gate runner**: G-14/G-17 measure the LIVE graph via cypher (not fixtures); G-15's counter
  is a delegating proxy AROUND the real client injected at the one seam all embeds cross;
  kitLoader passes config.vectorizerConfig through (:195-197). Run-1's genuine G-14 failure
  (bridgeGatesRun1.log, the sweep catching the runner's own comment) is real observed-red
  evidence for the sweep. Cleanup census 94,602 / 0 fixtures / 0 labels asserted inside the
  17/17 (assertion count reconciles: 17 = material+cleanup+declarations+3 twins+verdict set).
- **F. Generation bumps**: every non-test read site of the generation is the per-bridge
  EVIDENCE_GENERATION constant (grep: zero hardcoded stale 'v4'/'v3' strings outside tests). The
  judgment cache key is (promptHash, model, rendererVersion) — rendererVersion bumped to v5 AND
  every prompt's bytes changed, so Phase-4 stale cache hits are structurally impossible; freezer
  and forensics take generation/rendererVersion as passed from the same constants.
