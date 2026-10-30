# Errata — observations about the use-case standard's own source (`forges/usecase`)

Evidence first; each is a finding for the coalition, never a fix the forge makes.

**E1. The v0.11 schema forbids the property that would let a case state its format version.** `formats/v011-schema.json` is
`additionalProperties: false` at the document root and lists no `formatVersion`, so a v0.11 case cannot say it is written to v0.11
without failing its own schema (REVISION 1, R3 asks each case to document its format version). Measured 2026-10-29: no case states it;
the forge takes `0.11` from the schema `$id` and records `formatVersionSource: schemaId`. A later format schema should admit the
property.

**E2. Two CEDS citations give the full CEDS term IRI as their identifier.** `fs002Compilation.json` `subject/comprises/3` and `/7`
(and five more sites) cite `https://w3id.org/CEDStandards/terms/NI002114100002` and `…/NI001943162284`, where every other CEDS
citation uses the registry's shorthand (`C200079`). Both forms are legal (the registry: an identifier is the target's stableId or a
declared shorthand), but the registry's CEDS shorthand pattern `^[PC][0-9]{6}$` has no form for the `NI` (option-value) ids, so an
author citing one must write the IRI. The forge carries the identifier verbatim and keys the reference node by its registry-relative
local part.

**E3. The registry has no CTDL entry**, so no author can cite a CTDL term (TQ, 2026-10-29, Q15: the coalition is to be asked to add one).
The bridge's CTDL facet carries zero assertions until it does.
