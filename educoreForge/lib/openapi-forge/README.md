# lib/openapi-forge — the OpenAPI kit

Forges an OpenAPI 3 data model (`components.schemas`) into the DME roles. Designs: `system/management/zNotesPlansDocs/nextStandards-102326/`
`DESIGN-K0-openapiKit-102326.md` (K0, `$ref`-based single file) and `DESIGN-K1-openapiKitDereferenced-102326.md` (K1, dereferenced, multi-file).

## A bundle supplies

1. **A profile JSON** (`openapiProfileContract.js`; every field required for its layout, unknown refused): `profileNote`, `sourceLayout`
   (`referencedSingleFile` | `dereferencedMultiFile`), `sourceFileName` (first layout) or `sourceFileNameList` (second), `sourceFormat`
   (`json` | `yaml`, parsed by `openapiSourceParser.js`; YAML under js-yaml's JSON_SCHEMA), `stableIdPrefix`, `rootStableId`, `perStandardLabelByRole`, `schemaExclusionList`; and, for `dereferencedMultiFile` only,
   `statementOmissionDeclaration` (K1c, LIF): `{ emptyValueKeywordList, enumMemberRepeatList }`, the empty values and enum repeats the walk
   does not carry and the pair declares omitted, BY NAME (both lists may be empty; an unlisted empty or repeat refuses; a stale entry refuses).
   In EVERY profile (K2, wave 2 lane E, CASE 1.1): `listValuedVendorExtensionNameList` (vendor extensions the source states as a LIST of
   strings, carried as JSON text) and `enumMemberTextDeclarationList` (`{ enumObjectPointer, statedValue, carriedText }`: an enum member the
   source types as a number or boolean, carried as its own text). Both may be empty; an unlisted list or typed member refuses; a stale entry
   refuses; under `dereferencedMultiFile` both must be empty (that walk reads neither).
2. **A forge declaration** whose `stableIdPattern` is `openapiIdentity.stableIdPatternFor(profile)` and whose `additionalSourceInputList` names
   `standardSourceLocation` (it must be in `SHA256SUMS`, and its `upstreamUrl:` line a bare URL: the root's `sourceUrl` is read from it).
3. **A hooks module**: one line, `require('lib/openapi-forge/openapiHooks')({ openapiProfile })`.
4. **A round-trip pair module through the layout table**: `require('lib/openapi-forge/openapiLayout').roundTripPairFor({ openapiProfile,
   stableUriPropertyName, ruleModulePath })`. Never require a pair module by name: the pair must match the layout.

## The kit owns

The loader (`openapiLoader.js`) and the one source parser (`openapiSourceParser.js`, which the pairs read through too), the walk per layout (`openapiWalk.js`, `openapiDereferencedWalk.js`), the keyword registries (DATA: an
unlisted keyword at its position is refused by name; a vendor name's digit-led word is marked with `_`, `x-1edtech-privacy` ->
`x_1edtechPrivacy`), the identity rule (`openapiIdentity.js`), the pairs (`openapiRoundTripPair.js`,
`openapiDereferencedRoundTripPair.js`) and the layout table (`openapiLayout.js`). Reference bundle: `forges/openbadges`.
