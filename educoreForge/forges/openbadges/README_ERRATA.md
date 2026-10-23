# Open Badges 3.0 — upstream observations (ERRATA)

Observations about the publisher's document `ob_v3p0_oas.json` (snapshot 01, sha256 `816f431e…063ba9`), each with its evidence. The
forge carries every one of them VERBATIM; none is repaired. Measured 2026-10-23 by AZURE_MARBLE (nextStandards-102326 A1) with
`python3 -I` over the snapshot.

| # | observation | evidence | how the forge carries it |
|---|---|---|---|
| E1 | `x-srcprop-pid` names a property's VALUE TYPE, not the property | 179 occurrences, 42 distinct values; `org.1edtech.ob.v3p0.primitive.string.class` on 63 properties, `…derived.iri.class` 22, `…derived.uri.class` 22; `Achievement.alignment` carries `org.1edtech.ob.v3p0.alignment.class` | verbatim as `xSrcpropPid`; `nativeIdentifierPropertyName` null; the usage tips say what it means |
| E2 | a `@context` item branch is typed `string` but described as a map | `AchievementCredential.@context` and `EndorsementCredential.@context`, `items.oneOf[1]`: `{ "type": "string", "description": "A map representing an object with unknown, arbitrary properties" }` | verbatim in `compositionBranches` (`/items/oneOf/1`) |
| E3 | the word "respresents" (for "represents") | 4 descriptions: the `@context` and `issuer` `oneOf[0]` branches of `AchievementCredential` and `EndorsementCredential` | verbatim |
| E4 | 22 properties carry no description | a property that is a bare `$ref` (e.g. `Achievement.creator → Profile`): OpenAPI 3.0 allows no sibling of `$ref`, so the document cannot describe them | no `description`; the judge sees the `$ref` target's name |
| E5 | `info.contact` still names IMS Global (`support@imsglobal.org`) | `info.contact`, `info.license` | not forged (info is out of scope by declaration; `info.description` is the root's description) |
