# Adversarial review — Phase 1, hub reimplementation (cedsHubForge)

Reviewed: SPEC-hubReimplementation-080326.md (incl. R-P1-1); forges/ceds/lib/cedsHubForge.js;
forges/ceds/gates/hubGates.jsonc; forges/ceds/test/test-cedsHubForge.js; incumbent
forges/ceds/lib/referenceSubgraph.js; harness forges/ceds/lib/roundTripGates.js; test harness
test/testLib/harness.js; artifact test-artifacts/latestSuiteRun.txt; vocabulary.js:603-612;
WORKORDER-hubReimplementation-080326.md Phase 1; forger.js:317 (registry confirmed NOT flipped —
in scope for Phase 1).

Verdict: **SOUND-WITH-GAPS** — the implementation itself survived every line-level attack I
could mount (hash parity with the incumbent holds by inspection; enumeration is a faithful
transplant; the census 2,750 + 91,825 + 27 = 94,602 matches the incumbent's known figure; the
three sample cards match §1 field-for-field). The gaps are all in what the gates PROVE, not in
what the module DOES.

---

## STOP

None found. I looked hardest at: (a) hash-input divergence from the incumbent — walked both
encoders slot by slot (`canonicalKey||''` vs `encodeSignatureSlot`, range fold precedence,
qualifier sort/join, valueKey `''` on property tier) and they are byte-equivalent for all
values that occur (divergence exists only for non-string falsy keys, which cannot occur);
(b) enumeration drift — pass 1 and pass 2 are structural transplants of referenceSubgraph.js:306-469
including the allDomainIds-else-domainId read, the option-set value fan-out, the stem-match,
the tokenNodes.length!==1 skip, and the token's scalar domainId; the deliberate deltas
(refuse-on-missing-class/name/key instead of emitting degraded cards; no `" [qualifier]"`
suffix; no `_id`; URI stableIds) are each spec-mandated; (c) value-tier slot-4 — the module
reads the spec's "full stop" ruling correctly (rangeOptionSetDefinition only, no
propertyDefinition chain).

## MUST-FIX

**M-1. R-P1-1's central ruling — "the HASH COMPUTATION is the incumbent's, unchanged" — is
asserted nowhere.** The suite's independent recomputation (test-cedsHubForge.js:236-264) is a
same-author MIRROR of the new module's encoder (same `encodeSlot`, same fold, same join), not
the incumbent's. If the new module and its mirror shared a deviation from the incumbent hash
(e.g. a changed fold precedence or delimiter), G-2 passes while every one of 94,602
addressSignatures silently churns. The incumbent's `addressSignatureFor` is exported and sits
in the same directory (referenceSubgraph.js:121-145, 550); one loop comparing
`incumbent.addressSignatureFor(tuple) === card.addressSignature` per card would make R-P1-1 a
proven fact instead of a code-read. The same mirror weakness applies to G-1/G-10's
`deriveExpectedTupleKeys` (test-cedsHubForge.js:117-218 duplicates the module's own
enumeration, stem-match included) — mitigated only by the census matching the incumbent's
historical 94,602/27, a number this suite never recomputes from the incumbent.
Failure scenario: builder tweaks the range fold in both module and suite mirror; suite green;
every URI in the Phase-2 graph differs from the ruled scheme.

**M-2. G-8 does not enforce its own contract sentence.** Contract: "every uri =
HubDefinition.namespace + hubVersion + '/' + addressSignature … minted FROM this field, never
from a literal in the module" (spec §2, hubGates.jsonc:70). The measure
(test-cedsHubForge.js:475-497) compares against `HUB_NAMESPACE` — the SUITE'S OWN literal
(line 64) — and never reads the forged HubDefinition's `namespace` property; G-9 checks only
that namespace is non-empty. Two undetected faults: (1) module hard-codes the identical
namespace string internally and ignores the factory argument — value-equal, gate green (the
refusal tests prove the factory VALIDATES the arg, not that forgeHub USES it); (2) module mints
card URIs from the factory arg but stamps a different namespace on HubDefinition — G-8 green,
G-9 green. Fix: a sentinel-namespace re-forge probe (forge once with
`https://sentinel.example/hub/`, assert every uri and HubDefinition.namespace carry it), and
make G-8's expected prefix READ from the forged HubDefinition node. The twin
`mintOneUriFromLiteral` (example.invalid) proves only the comparator bites on a
different-valued literal — it cannot, by construction, catch a same-valued one.

**M-3. G-4 measures a subset of §1.3 while its contract claims the full stack.** The measure
(test-cedsHubForge.js:352-425) checks domainName/domainDefinition/propertyName (required),
propertyDefinition (two-sided), and on value tier: valueName, rangeOptionSetName/Definition,
valueDefinition. NEVER checked: `propertyNotation`, `propertyDataType`, `propertyTextFormat`,
`valueNotation`, `valuePrefLabel`, and — the worst — `rangeClassName`/`rangeClassDefinition`
(class-range prose, cedsHubForge.js:487-498). None of the three sample cards has a class range
(property sample: rangeDatatype; value sample: option set; qualified sample: rangeDatatype),
so class-range prose is verified by NO gate and shown in NO sample. A module that deleted the
`classRangeNode` prose block entirely would pass all 11 gates and the supervisor back-gate.
Failure scenario: exactly that — a refactor drops lines 487-498; suite green; every
class-ranged card ships without its range's name or definition and the Phase-3 renderer has
nothing to print.

## SHOULD-FIX

**S-1. Decomposition-edge targets are un-gated — in Phase 1 and in the whole plan.** The module
emits HAS_CEDS_DOMAIN/PROPERTY/RANGE/VALUE/QUALIFIER per card (cedsHubForge.js:575-588); the
only edge assertion anywhere is IN_HUB degree + target (G-9). A card whose HAS_CEDS_DOMAIN
points at the wrong DmeClass passes all 11 gates; Phase-3's G-17 checks edge-type presence and
shape, not per-card targeting. Cheap Phase-1 gate: for every card, assert the DOMAIN edge
lands on classByDomainId[card.domainId], the PROPERTY edge on the card's property node, etc.,
and edgeTotal equals the derivable expectation.

**S-2. Provenance URIs violate absent-is-absent at the `undefined` level.**
cedsHubForge.js:536-540 assign `anchorUri`/`domainUri`/`propertyUri` UNCONDITIONALLY: a source
node lacking `uri` yields a card key with value `undefined` (Object.keys includes it), instead
of either the spec'd refusal (these are "always" fields, §1.4) or true absence. G-3 detects
only `''`, so this leak is gate-invisible. Corpus currently carries uris everywhere (suite
green), so it is latent, not live.

**S-3. A DmeProperty with zero declared domains silently yields zero cards.** declaredDomainIds
= [] → the forEach at cedsHubForge.js:623 never runs — no card, no refusal, no report row. The
suite's mirror enumerates the same zero, so G-1/G-10 cannot see it. Incumbent parity, yes —
but "a HubReference for every idea CEDS can represent" plus refuse-by-name doctrine argue for
at least a named entry in a skip report, and the gates cannot currently distinguish "property
fully enumerated" from "property fell out of the hub."

**S-4. G-9 is a spot check presented as a structure check.** Not verified:
HubDefinition.uri/stableId === namespace + 'hubDefinition/CEDS' (§2's replacement of
`cedsHubDefinition:CEDS` — the very point of the new card), `version` equals the base-derived
version, `displayName`, and namespace↔card-URI linkage (see M-2). slotProfile check
(test-cedsHubForge.js:519-535) samples 4 address slots (omits the range slot, valueKey,
hubName, hubVersion) and 4 meaning fields.

**S-5. Divergence "both exist" treats null and `''` as existing.** cedsHubForge.js:783-789: a
`description: null` passes the `!== undefined` test and emits a row with String(null)='null';
`''` likewise counts as existing prose. Inconsistent with `hasProse` used everywhere else in
the same module. The suite recount (test-cedsHubForge.js:316-322) mirrors the same rule, so
the gate cannot notice. Corpus-latent (71 rows within spec's ≤37/≤8/≤26 bounds).

## NOTE

**N-1.** The one sanctioned substitution is present and correctly scoped: `domainListOf` +
allDomainIds-else-domainId (cedsHubForge.js:68-71, 603-606) is the incumbent-matching
shape-agnostic read, with the incumbent's own rationale carried in comment. All other `||`
occurrences (lines 302, 307, 312, 647, 722) are accumulator-init or guard idioms, not data
substitution; `encodeSignatureSlot`'s null→'' is the incumbent's registered hash-slot encoding
(parity-required); the tier/XOR ternaries (613-621, 372, 536) are stated presence rules. No
`??` anywhere. Module purity confirmed: no fs/Date/Math.random/async/await/process reads;
callbacks error-first throughout.

**N-2. Twin honesty, surveyed twin-by-twin:** all 11 twins re-invoke a REAL measure computer
over corrupted clones (not fabricated violation strings) — good. Two caveats: (a) G-2's
`feedDefinitionIntoHash` cannot fail by construction (a definition-fed hash always differs
from the stored one), so it proves comparator wiring only; the real G-2 burden is carried by
the two re-forge probes (test-cedsHubForge.js:1228-1287), which DO exercise the module itself
(meaning-edit → signature set unchanged + embedText-changed sanity guard; canonicalKey-edit →
signature set changed) and feed the gate's own measure. (b) G-1's twin drops the domain from
the RE-DERIVATION side rather than the module's enumeration — inherent to measure-boundary
injection, and the pristine two-sided compare would catch the module-side drop symmetrically.

**N-3. The "pristine measurements restored" output line is proven by construction, not by
re-measurement.** I verified all 11 twin functions are non-mutating (spread/map/filter/slice
copies only; the harness additionally deep-clones the measurement bundle per twin,
roundTripGates.js:415-416) and that evaluateSuite judges the measurement object computed
BEFORE the twin sweep — so the restore is architecturally safe, but nothing re-verifies it,
and the wording overstates.

**N-4. Vacuous-pass defense is real.** Every isEmpty gate would pass over zero cards, but the
suite pins non-vacuity: twin preconditions assert a multi-domain property, a qualified card, a
datatype card, and a non-empty divergence report exist (test-cedsHubForge.js:1030-1046);
sample-card assertions add a full-prose value card; the census assertion ties both computed
totals. An empty forge cannot go green.

**N-5.** Phase scoping is per WORKORDER: registry at forger.js:317 still `referenceSubgraph`
(correct for Phase 1), G-7/G-13..G-17 deferred by OMISSION from hubGates.jsonc rather than
declared-and-UNMEASURED. Sanctioned, but note the spec's own "unmeasured gate is a failure"
doctrine is sidestepped by not declaring them; the jsonc header at least says so out loud.

**N-6.** Factory-argument refusal is by throw, not R7 callback (cedsHubForge.js:121-127) —
consistent with the house moduleFunction pattern; the suite adapts via `refusalMessageOf`.

**N-7.** Suite-side `|| []` defaults (closureKeyOfCard, recomputeSignature, recomposeEmbedText,
G-9 parses) are benign under attack: in every case a module-side field DROP flows into a
two-sided mismatch (G-2/G-6/G-10 red) rather than a masked pass — checked each path.

**N-8.** Incumbent-vs-new behavioral deltas inventoried and each traced to a spec clause:
refusals replace degraded emission (§3); name loses the qualifier suffix (§1.2); `_id` dropped
(§1.2); `label` param dropped (§1.5); anchorUri unconditional (see S-2); HubDefinition
stableId becomes a real URI (§2); slotProfile regenerated v2 (§2). Nothing the incumbent
enumerates is skipped; nothing new is enumerated. A rangeClassId that resolves to no class
node still mints the card with the id but no rangeUri/prose (incumbent parity; un-refused —
adjacent to S-2).
