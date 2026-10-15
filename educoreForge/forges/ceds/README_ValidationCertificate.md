# Validation certificate — CEDS

**CEDS 14.0.0.0 was built from the published CEDS ontology. 25,202 nodes. This certificate covers
the CEDS standard itself.**
**This graph is complete and usable.** Accuracy was confirmed by round trip validation: RDF was
regenerated from the graph and compared against the source ontology, statement by statement. Nothing
was missed. Nothing was invented. A third-party RDF library, sharing no code with ours, then read
both files and reached the same result.

| | |
|---|---|
| standard | CEDS **14.0.0.0**, read from `owl:versionInfo` inside the ontology |
| source | `assets/standardSourceData/01/CEDS-Ontology.rdf` |
| source URL | **Downloaded from** `https://github.com/CEDStandards/CEDS-Ontology/blob/2cbe23964a373c37ec9dcd0620d6a97cbfa40074/src/CEDS-Ontology.rdf`: the git blob at commit `2cbe2396` equals the ontology byte for byte (checked 2026-10-15; found afterwards, not recorded at harvest). GitHub `main` is one commit ahead (`4ef15304`, 2026-05-17) |
| graph | `DEV_FourWithNewPesc`, built 2026-08-07 |
| commit | branch `architecture-improvement`, recipe at `a0a4a90` |

---

## What is in the graph

**The CEDS ontology as published** — 25,202 nodes covering its classes, properties, elements, option
sets and edit history, with the definitions, labels, data types and relationships the ontology states
for each.

**CEDS is also used as a hub. The hub is not in this graph and is certified separately** — see
`tbd`.

---

## Accuracy

```
statements compared ............ 239,761
missing from the graph ......... 0
present but not in the source .. 0
```

**Two independent checks agree.** Ours regenerates RDF/XML from the graph and compares statement
sets. The second uses `rdflib`, a third-party RDF implementation applying the RDF/XML specification's
own parsing rules and sharing no code with ours: **243,601 triples on each side, identical.**

The two counts differ because ours does not expand RDF collections into their underlying list
structure — 1,920 edit-history entries, two triples each, accounting for the difference exactly.

---

## Known problems

**1. Edit-history entries cannot be told apart.** CEDS records 1,920 edit-history entries as
anonymous nodes. Neither check can distinguish which entry belongs to which parent, so **a consumer
relying on edit history should confirm the parent relationship against the source ontology.**

**2. RDF collections are stored flat.** Where the ontology uses an RDF collection, the graph holds
its members without the underlying list structure. The members are all present; the list plumbing is
not.

**3. Formatting differences are not detectable.** Whitespace inside literals is collapsed, namespace
prefixes are expanded to full URIs, statement order is not preserved, and two identical statements
collapse into one. A consumer needing byte-level fidelity to the published file should read the file.

---

## Where the data came from

**The publisher is the US Department of Education CEDS programme, `https://ceds.ed.gov`.**

**The download URL was not recorded at harvest; it was found afterwards.** The bytes were copied on
2026-05-28 from a local working directory. On 2026-10-15 they were matched byte for byte to commit
`2cbe2396` of `CEDStandards/CEDS-Ontology` on GitHub (the source URL above), and `standardSourceLocation`
now records that address. Nothing else about the harvest has been invented. The `SHA256SUMS` beside
the ontology was created later, on 2026-08-04 — it proves the file has not changed since that date
and proves nothing about where it came from.

The ontology itself is committed, so a clone has the exact bytes this certificate describes. A future
CEDS release becomes a new snapshot directory with its own provenance record capturing the URL.

---

## More detail

| document | what it holds |
|---|---|
| `README_ValidationDetail.md` | how the comparison works, its full modelling boundary, and the commands to reproduce this run |
| `README_roundTripContract.md` | what "faithful" means for CEDS and why |
| `assets/standardSourceData/01/README_PROVENANCE.md` | the corpus record, including what it does not know |

Figures measured 2026-08-07; the independent `rdflib` check was run 2026-08-09 against that run's own
output.
