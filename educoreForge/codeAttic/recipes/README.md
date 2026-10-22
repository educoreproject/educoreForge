# codeAttic/recipes — retired recipes, kept for their history

Moved here by zeroBacklog lane D (INDIGO_COMPASS, item D2-2, 2026-10-22; ruled by BRONZE_CROWN). Nothing loads them: the
recipe loader reads `recipes/`, and `test-recipeSchemaContract` enumerates `recipes/` only.

| recipe | why retired |
|---|---|
| `edfiBridgeOnly`, `fourWithHubEdfiBridge`, `fourWithHubFourBridges`, `fourWithHubFiveBridges` | Each names `edfiCedsCrosswalkPlugin`, the CEDS-authored Ed-Fi crosswalk TQ ruled out on 2026-09-10 ("known to be garbage"; retired from the roster 2026-10-02, goldJev lane F; the plugin now lives in `forges/edfi/retiredBridges/` as history). They are also written in the OLD recipe bridge form `{ source, hub, bridge }`, which `recipe-bridge-expansion.js` refuses by name since D2-1 (deCeds R7-1). A recipe naming a deleted plugin cannot build, so they were moved rather than converted: converting them to `{ source: 'edfi', hubs: ['ceds'] }` would have silently turned four crosswalk recipes into derived-bridge recipes under their old names. The derived Ed-Fi recipe of record is `recipes/fourWithHubEdfiDerived.recipe.jsonc`. |

Reviving one means a new TQ ruling on the crosswalk, a new-form rewrite, and a new name.
