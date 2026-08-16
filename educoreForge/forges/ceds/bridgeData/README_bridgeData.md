# forges/ceds/bridgeData — HUB-owned data the bridge plugins REFERENCE

`ceds14PropertyRemodel.json` — the property-side REMODEL table (SPEC-bridgeFramework-v1.md §5.3, §10.4;
RULINGS P11, D-S5; REQUIREMENTS BR-015 read as "provide by REFERENCE"; HARVEST-bridgeKnowledge.md §1.1
harvested verbatim). Keyed `hubName@hubVersion` (`CEDS@14.0.0.0` — the hub the golden's cards carry), then
by the OLD CEDS Global ID as a source names it (P-form), each entry a specific TUPLE the framework resolves
against the hub cards BEFORE direct resolution (`subjectGrouping.applyRemodel`; BG-REMODEL). It is DATA,
read at run time by `lib/bridge-framework` from `<forges>/<hubToken>/bridgeData/<remodelTableRef>.json`
and digested into the frozen decision block header (`remodelTableDigest`); a plugin only NAMES it
(`remodelTableRef: 'ceds14PropertyRemodel'`) and never carries a copy. A table without the run's
`hubName@hubVersion` entry is refused by name by the framework.

| old id | → canonicalKey | domainId | qualifierKeys | meaning |
|---|---|---|---|---|
| P001070 | P001572 | C200291 | OV002114100003 | Staff Member Identifier → Person Identifier (Person Identifier class) qualified by Has Person Identifier Type = Staff Member Identifier |
| P001071 | P001572 | C200291 | OV002114100002 | Student Identifier → Person Identifier qualified by … = Student Identifier |
| P001072 | P000827 | C200252 | — | Has Local Education Agency Identification System → Has Organization Identification System (Organization Identifier class) |
| P001073 | P000827 | C200252 | — | Has School Identification System → Has Organization Identification System |
| P001074 | P001571 | C200291 | — | Has Staff Member Identification System → Has Person Identification System |
| P001075 | P001571 | C200291 | — | Has Student Identification System → Has Person Identification System |

The `domainId` is PART of the entry (the tuple's class slot) because the crosswalk rows naming these six ids
carry the OLD class URIs (`C200399` / `C200400` / `C200252`, FINDING A5) — the table SUPERSEDES the source's
domain (the framework records `sourceDomainSuperseded` on the record) so the rewritten tuple lands on the
card the hub actually holds; without it four of the six rows fall to `sourceSideMismatch → judged` (observed
B3 run 1, 2026-08-16). Grounding: HARVEST §1.1 (P001572 class C200291; P001571 C200291; P000827 C200252),
re-verified against the CEDS 14.0.0.0 hub cards this run.

Why: the Ed-Fi crosswalk (and SIF's `CEDS ID` column) were authored against an older CEDS; these six
targets were remodeled in CEDS 14 and have NO card under the old id — without the table they orphan;
with a bare-key resolver they could land on the wrong base property. Same base property, DIFFERENT
qualifier → DISTINCT hub cards (student ≠ staff). Written by B3 (SCARLET_BRIDGE, 2026-08-16); the SIF
plugin (B4) references the SAME table.
