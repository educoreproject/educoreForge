# CLR 2.0 — upstream observations (ERRATA)

Observations about the publisher's document `clr_v2p0_oas.json` (snapshot 01, sha256 `fc6d7ea0…a994d`), each with its evidence. The forge
carries every one of them VERBATIM; none is repaired. Measured 2026-10-24 by QUIET_GATE (nextStandards-102326 wave 2 lane D) with
`python3 -I` over the snapshot.

| # | observation | evidence | how the forge carries it |
|---|---|---|---|
| E1 | `x-srcprop-pid` names a property's VALUE TYPE, not the property | 184 occurrences, 44 distinct values; `org.1edtech.clr.v2p0.primitive.string.class` on 59 properties, `…derived.uri.class` 24, `…derived.iri.class` 23; `Achievement.alignment` carries `org.1edtech.clr.v2p0.alignment.class` | verbatim as `xSrcpropPid`; `nativeIdentifierPropertyName` null |
| E2 | a `@context` item branch is typed `string` but described as a map | `ClrCredential`, `VerifiableCredential` and `EndorsementCredential` `.@context`, `items.oneOf[0]` ("A map representing an object with unknown, arbitrary properties") | verbatim in `compositionBranches` |
| E3 | the word "respresents" (for "represents") | 6 descriptions: the `@context` and `issuer` `oneOf[1]` branches of the same three credential schemas | verbatim |
| E4 | 22 properties carry no description | a property that is a bare `$ref` (e.g. `Achievement.creator → Profile`): OpenAPI 3.0 allows no sibling of `$ref` | no `description`; the judge sees the target's name (`referencedSchemaNames`) |
| E5 | 27 schemas are Open Badges 3.0's, renamespaced; `EndorsementCredential` also differs | equal to `ob_v3p0_oas.json`'s once `org.1edtech.clr.v2p0.` and `org.1edtech.ob.v3p0.` are equated; `EndorsementCredential` additionally lists `issuer`'s `oneOf` branches in the opposite order and differs in `@context.items` | each forged as CLR's own (README_identityRules) |
| E6 | `info.contact` still names IMS Global; `info.license` reads "IMS Global Specification Document License" | `info.contact`, `info.license` | not forged (info is out of scope by declaration; `info.description` is the root's description) |
