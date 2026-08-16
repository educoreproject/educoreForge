NAME
     forge -- turn one education data standard into a graph, on the Forge Framework

SYNOPSIS
     From system/code/educoreForge, the whole graphForge process for Ed-Fi (forge -> materialize
     into a scratch container -> round-trip validate -> write the standardBase block):

         mkdir -p /Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/buildLogs/forgeFramework/edfi-<run>

         node --max-old-space-size=20000 apps/graph-builder/graphBuilder.js -build \
           --recipePath=recipes/edfiOnlyRoundTrip.recipe.jsonc \
           --vectorize=true \
           --standardsDatabaseFilePath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/graphBuilder/forgeFramework_edfi_<run>.standardsDatabase.sqlite3 \
           --embeddingCacheFilePath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/vectorCache/vectorCache.sqlite3 \
           </dev/null 2>&1 | tee /Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/buildLogs/forgeFramework/edfi-<run>/build.log

     Then the certification check on the run directory the build names (buildLogs/edfiOnlyRoundTrip_<stamp>):

         node apps/graph-builder/graphBuilder.js -goldEvalCheck \
           --buildLogDirPath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/buildLogs/edfiOnlyRoundTrip_<stamp> </dev/null

     <run> is a label YOU choose to name this run -- it appears in two places, the scratch
     standards database the build writes into and the directory its log lands in -- so that runs
     do not overwrite each other and you can tell them apart afterward (the F3b builder used
     preMigration and migrated; tq1 or 260816a would do). Any string that is safe in a filename.
     The scratch database is created if absent and is not the golden's. About two minutes with
     the warm cache. Look for
     "standardBase aea6d8dfe789..." in the log; that is the block id. This is the FROZEN per-forge
     command (README_ForgeFrameworkSpecification.md s9.2); the committed copy for every forge is
     lib/forge-framework/test/acceptance/acceptanceCommands.jsonc.

     Notes on the flags. </dev/null is not optional: graphBuilder blocks on non-TTY stdin. Heap
     20000 is what the four-forge build needs; the single-forge build tolerates less but the frozen
     line says 20000. --vectorize=true is the default, stated explicitly because a vectorize-off run
     mints a different id. The embedding cache path is the canonical warm cache; a cold cache spends
     Voyage credit. Every path is absolute. The build mints a container named
     DEV_gb_materialize_<pid>_<seq>; rename it to a DEV_<label> or dispose it; never `docker rm -v`
     anything you did not create.

DESCRIPTION
     A forge turns one education data standard -- Ed-Fi, SIF, PESC, CEDS -- into a graph the Data
     Model Explorer can serve: nodes for the standard's classes, properties and code values, edges
     for how they relate, and one root node that says what the standard is.

     THE KITCHEN. Before the framework, every forge was its own restaurant. Each had its own stove,
     sink, dishwasher and cash register: its own code to verify source files, stamp a version,
     build the root node, clean up the structure, embed the text, and hand the result to the graph
     builder. Four copies of the same equipment, each slightly different, each drifting.

     Now there is one kitchen. The kitchen owns the equipment. A forge brings three things:

         1. A recipe card -- plain facts about the standard: its name, what its identifiers look
            like, what its root node says, which quirks it still carries. Data, never code.
         2. A cook -- the one part that is genuinely the standard's: how to read its files and
            walk them into nodes and edges. This is the plugin.
         3. A taster -- the round-trip validator that re-emits the source from the graph and
            confirms nothing was invented.

     Everything else the kitchen does the same way for everyone.

     Two rules keep the kitchen honest. The cook may only put food on the plate with the kitchen's
     own utensils -- it cannot slip a raw node onto the plate -- so the kitchen can guarantee no
     duplicate identifiers, no cross-standard edges, no made-up names. And if a forge needs an
     exception, it declares it on the card; the kitchen refuses undeclared exceptions and
     declared-but-unused ones alike.

THE FLOW, IN PROSE
     Same skeleton as THE FLOW, AS PSEUDO-CODE below, one line per element, so the two can be read
     side by side.

     The forge's side -- three files

     1. The recipe card (forgeDeclaration). A frozen object of plain facts: which standard this
        is, what its identifiers must look like, what its root node is called, which version of
        the parser this is, the six-key mapping instruction, and the list of declared quirks (Ed-Fi:
        E6 and E8). No logic anywhere in it.

     2. The cook (hooks). Four entries:
          sourceLoaderList   one reader per input file or directory. Ed-Fi has three; a simpler
                             standard has one. This is the "method or methods."
          describeSource     given what was read, say the version the source claims for itself,
                             its format, its URL, its files.
          emitContractGraph  the walk. Given the parsed source and the framework's kit, go through
                             every class, property and code value and ask the kit to make each node
                             and edge. Return the kit's collected nodes and edges plus any reports.
          describeRoot       the sentence that goes on the root node.

     3. The entry module. One line: hand the card and the cook to the framework, return what it
        gives back. The graph builder calls this file exactly as it always did.

     The kitchen's side -- what the framework does with them

        forgeFramework({ embedder })     take the embedder (or none); refuse any other dependency.
        .injectStandardHooks({...})      check the card (unknown key, unknown quirk id -> refuse) and
                                         check the cook (missing or misshapen hook -> refuse by
                                         name), before touching any file. Return the bundle the
                                         graph builder expects.

     Then, when the graph builder calls bundle.forge(...):

        1  Cheap refusals     no source path, or "embed" requested with no embedder -> refuse. The
                              owner argument is accepted and never read.
        2  Verify             every file the readers will touch is checked against the snapshot's
                              checksums first.
        3  Read               run the loaders; the results are folded into one parsed object keyed
                              by loader name.
        4  Describe and stamp call describeSource, derive the version stamp; a fake version like
                              'current' is refused.
        5  The pure layer     inside the framework's single try/catch: build a fresh kit; build the
                              root node first from the card; hand the kit to the cook and let it
                              walk; then check every returned node and edge came from the kit and
                              none was dropped; check the declared quirks against what actually
                              happened (needed-but-undeclared refused, declared-but-unneeded
                              refused); run the sequence finalizer, then the structural finalizer.
        6  Embed              keep the embeddable roles, take the first N, batch them, count the
                              calls.
        7  Return             the nodes and edges in the cook's order, untouched, plus the metadata,
                              the counts, and a compliance report naming which quirks were live.

     The only place the forge's own code runs is inside step 5, and even there it holds utensils it
     did not make.

THE FLOW, AS PSEUDO-CODE
     Faithful to the real shapes, stripped to the flow. The numbered items match THE FLOW, IN PROSE.

     // --- the forge's side: three files ---------------------------------------------------

     // 1. the recipe card -- data only
     forgeDeclaration = {
       standardKey: 'edfi',  standardSource: 'EdFi',  standardDisplayName: 'Ed-Fi Data Standard',
       stableIdPattern: { pattern: '^edfi:[A-Za-z]+(/.+)?$', trimmed: true },
       rootStableId: 'edfi:root',  rootLabel: 'EdfiRoot',  parserVersion: '2',
       mappingInstruction: { ...six keys, fixed order... },
       compatibilityDeclarationList: [ {E6}, {E8, logicalSourceFileNameList:[...]} ],
     }

     // 2. the cook -- the hooks
     hooks = {
       sourceLoaderList: [                       // "method or methods": one per input
         { loaderName:'metaEdModel',           load({sourcePath}, cb) },
         { loaderName:'descriptorCodeValues',  load({sourcePath}, cb) },
         { loaderName:'authoredCrosswalk',     load({sourcePath}, cb) },
       ],
       describeSource: ({ parsed }) => ({ version, selfDescribedVersion, sourceFormat, sourceUrl, sourceFiles }),
       emitContractGraph: ({ parsed, metadata, kit }) => {      // THE WALK -- the standard's own knowledge
         for each class in parsed.metaEdModel:
           kit.makeNode({ role:'class', stableId, name, description, structural:{parentId, path}, ... })
         for each property:
           kit.makeNode({...});  kit.addEdge({ type:'HAS_PROPERTY', from, to })
         for each descriptor value:
           kit.emitOptionValue({...})
         return { nodes: kit.nodes, edges: kit.edges, stats, crosswalkMatchReport }
       },
       describeRoot: ({ parsed, metadata }) => ({ description: 'Ed-Fi Data Standard -- 849 constructs...' }),
     }

     // 3. the entry module -- one line of wiring; the seam is unchanged
     module.exports = ({ embedder }) =>
       forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks })
     //   ^ graphBuilder still calls require(entry)({embedder}) -> bundle.forge(args, cb)


     // --- the kitchen's side: what injectStandardHooks + forge() do --------------------------

     forgeFramework({ embedder })                 // refuses undeclared deps; embedder may be null
       .injectStandardHooks({ forgeDeclaration, hooks })
          validate declaration keys/values (unknown key -> refuse; unknown allowance id -> refuse)
          validate hooks (missing/misshapen/wrong arity -> refuse by name, before any I/O)
          return bundle = { forge, buildContractGraph, STANDARD_KEY, ... }

     bundle.forge({ sourcePath, owner, embedNodeLimit, skipEmbedding }, callback):
       1  cheap refusals          (no sourcePath -> refuse; skipEmbedding:false + null embedder -> refuse; owner never read)
       2  verify SHA256SUMS       every file the loaders will read
       3  run loaders             parsed = { metaEdModel:..., descriptorCodeValues:..., authoredCrosswalk:... }
       4  describe + stamp        metadata = deriveVersionStamp(describeSource(parsed))  ('current' -> refuse)
       5  PURE LAYER (one try/catch adapter -> callback(err))
            kit  = contractGraphKit({ forgeDeclaration, metadata })   // the utensils
            root = kit.makeRoot(declared data + describeRoot(...))    // root FIRST
            { nodes, edges } = hooks.emitContractGraph({ parsed, metadata, kit })
            integrity: every node/edge kit-minted AND returned exactly once; universal props re-checked
            allowances: needed-but-undeclared -> refuse; declared-but-unneeded -> refuse
            finalizeSequence(...); finalizeStructuralContract(...)
       6  embed                   filter by role -> slice embedNodeLimit -> batch -> embedCallCount
       7  return                  callback('', { nodes, edges (walk's order, untouched), metadata,
                                                 embedCallCount, standardKey, stableUriPropertyName,
                                                 complianceReport, ...reports })

     Read top to bottom: the forge writes the card, the cook, and one line; the kitchen runs the
     same seven steps for every forge, and the only place a forge's code executes is inside step 5,
     holding utensils it did not make.

TERMS
     forge          a bundle under forges/<standardKey>/ that the graph builder loads by the entry
                    module named in its parserDescriptor.ini.
     block          the content-addressed record of one forge's output. Its id is a sha256 of the
                    canonical text of every node and edge plus a header. Two builds that produce the
                    same bytes produce the same id; a one-character change anywhere produces a
                    different id.
     the seam       the contract between the graph builder and a forge:
                    require(entryModule)({ embedder }) returns a bundle; bundle.forge({ sourcePath,
                    owner, embedNodeLimit, skipEmbedding }, callback) returns nodes, edges, metadata
                    and counts. The framework satisfies this contract unchanged; the graph builder
                    was not modified.
     kit            the set of utensils the framework hands the cook: makeNode, addEdge,
                    emitOptionValue, carriedProperties, crossRefsJson, cedsAnchorValue,
                    isCleanStableId, searchTextElementFor, rootStableId.
     compatibility  a named row, keyed by an id from the Profile's punch list, that licenses one
     declaration    known departure from the Profile while a forge is migrated byte-identically.
                    Ed-Fi declares two: E6 (root sourceUrl written as '') and E8 (root sourceFiles
                    names logical inputs rather than verified files).
     round trip     the validator reads the built graph, re-emits statements in the source's own
                    form, and diffs them against the source. inventedTotal must be 0; -goldEvalCheck
                    answers PASS only when every declared validator ran and reported that.

WHAT A FORGE SUPPLIES
     The declaration (lib/<std>ForgeDeclaration.js) is a frozen object: standardKey, standardSource
     (equal to the descriptor's standardName), standardDisplayName, stableUriPropertyName,
     stableIdPattern ({ pattern, trimmed } -- the real predicate, as data), rootStableIdFrom and
     rootStableId, rootLabel, parserVersion, mappingInstruction (six keys, fixed order -- the JSON
     string is a byte of the block), nonEmbeddableRoleList, cedsAnchorAbsentSentinelList,
     additionalSourceInputList, compatibilityDeclarationList. Ed-Fi's is 71 lines.

     The hooks (lib/<std>Hooks.js) are functions the framework calls:

        sourceLoaderList    one or more { loaderName, load({ sourcePath,
                            additionalSourceInputPathByName, xLog }, cb) }
                            -- reading the source (Ed-Fi has three loaders)
        describeSource      ({ parsed }) => { version, selfDescribedVersion, sourceFormat,
                            sourceUrl, sourceFiles }
                            -- what the source says about itself
        emitContractGraph   ({ parsed, metadata, kit }) => { nodes, edges, stats, ...reports }
                            -- the walk: every node and edge, minted through the kit
        describeRoot        ({ parsed, metadata }) => { description?, extraProperties? }
                            -- the root's text

     The entry module (forge<Std>.js) is one line:
     forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks }). Ed-Fi's is 33
     lines including its header comment; it was 280 before the migration.

     The validator (roundTripValidator.js) is unchanged by the framework.

WHAT THE FRAMEWORK DOES
     forge() runs the same seven steps for every forge:

     1  Refuses a missing sourcePath, skipEmbedding: false with no embedder, or a fifth argument
        key. owner is accepted and never read.
     2  Verifies every file the loaders will read against the snapshot's SHA256SUMS, before any
        loader runs.
     3  Runs the loaders and folds their results into one parsed object keyed by loader name.
     4  Calls describeSource, derives the provenance stamp, and refuses a blank version or the
        recipe token 'current'.
     5  Runs the pure layer under the framework's one throw-to-callback adapter: a fresh kit; the
        root built first from declared data; the walk; an integrity pass (every returned node and
        edge was kit-minted and returned exactly once; universal properties re-checked after any
        post-mint writes); finalizeSequence then finalizeStructuralContract.
     6  Embeds: filters by role, then slices to embedNodeLimit, batches, counts calls.
     7  Returns the walk's arrays in the walk's order, untouched, plus the walk's reports and a
        compliance report naming the active declarations.

     The framework has no per-standard branch. Every difference between forges is declaration data,
     a hook, or a compatibility declaration. A gate greps for the four standard keys in framework
     code and turns red if one appears.

WHAT THE FRAMEWORK REFUSES TO OFFER
     No graph access at forge time. No cross-standard edge (kit.addEdge refuses an endpoint from
     another source). No hub hook (the CEDS hub is the forger's, outside the seam). No join-key
     addressing. No default for an absent declaration key, hook, or seam argument. No clock, no
     randomness, no process state in the pure layer. No sorting or deduplication of the walk's
     output. No round-trip diff engine (the harness ships the contract; each forge's validator
     keeps its own diff for now).

HOW A FORGE IS PROVEN
     A forge on the framework is accepted when, built through the unchanged graph builder under a
     frozen command line, it produces the same block id as the forge produced before migration,
     its round trip is clean, -goldEvalCheck is PASS, and the four-forge manifest reproduces.

     Ed-Fi, 2026-08-16: block id aea6d8dfe7899adef57c5ac3adb6b0df2bfc7e4a4ae859c4fa3893c132c8b304
     measured on the unmigrated forge, then reproduced by the migrated one; four-forge manifest
     97c618c20e07c0c612957def69164402d364a98d5dfee865faacae1deace6382; goldEvalCheck PASS. An
     independent review compared every distinct property-key set per role between the new graph and
     the baseline graph -- 98 signatures, identical. The block-id gate was observed red: changing
     parserVersion from '2' to '2a' moved exactly the root line and the id.

STATUS
     Ed-Fi is on the framework. SIF, PESC and CEDS are not yet; each has a declared allowance set in
     the framework specification (s7.3) and SIF's migration brief is written. Ed-Fi's two
     compatibility declarations are still in force; retiring each is its own commit with a
     deliberately new block id.

FILES
     apps/graph-builder/README_ForgeDocumentation/README.md
                    the index of this package
     apps/graph-builder/README_ForgeDocumentation/README_HOWTO_ForgeCreationInstructions.md
                    the step-by-step procedure for writing or migrating a forge
     apps/graph-builder/README_ForgeDocumentation/README_ForgeProfile.md
                    normative: what every forge MUST satisfy
     apps/graph-builder/README_ForgeDocumentation/README_ForgeFrameworkSpecification.md
                    normative: the framework's object, hooks, pipeline, registry, migration recipe,
                    acceptance test, gates (s8 = the migration recipe)
     apps/graph-builder/README_ForgeDocumentation/README_MILO_ForgeWorkOrientation.md
                    orientation for the next Milo doing forge work
     lib/forge-framework/          the framework (13 flat modules) and roundTripHarness/
     lib/forge-framework/test/     the framework's gates (every gate has a twin that turns it red)
     lib/forge-framework/test/acceptance/acceptanceCommands.jsonc
                    the frozen acceptance command per forge; expected ids beside it
     forges/edfi/                  the worked example: forgeEdfi.js, lib/edfiForgeDeclaration.js,
                                   lib/edfiHooks.js, lib/forgeEdfiContractGraph.js
     apps/graph-builder/DOCTRINE.md
                    graphBuilder-wide control-flow doctrine (not forge-specific)

EXAMPLES
     All commands run from /Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge.
     Every path is absolute; every graphBuilder call ends in </dev/null. Where a command spends
     Voyage credit or provisions a Docker container it says so.

     1. The real Ed-Fi run, fully qualified (forge + materialize + round trip; ~2 min warm cache;
        provisions one DEV_ container; free when the cache is warm). Label: tq1.

         mkdir -p /Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/buildLogs/forgeFramework/edfi-tq1
         node --max-old-space-size=20000 /Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/apps/graph-builder/graphBuilder.js -build \
           --recipePath=/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/recipes/edfiOnlyRoundTrip.recipe.jsonc \
           --vectorize=true \
           --standardsDatabaseFilePath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/graphBuilder/forgeFramework_edfi_tq1.standardsDatabase.sqlite3 \
           --embeddingCacheFilePath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/vectorCache/vectorCache.sqlite3 \
           </dev/null 2>&1 | tee /Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/buildLogs/forgeFramework/edfi-tq1/build.log

        The same run through the framework's acceptance runner (writes provenance.json beside the
        log, refuses to overwrite a recorded phase):

         node lib/forge-framework/test/acceptance/runAcceptanceCommand.js --standardKey=edfi --phaseToken=tq1

     2. Certify that run (READ-ONLY, free): the run directory is the buildLogs/edfiOnlyRoundTrip_<stamp>
        the build printed.

         node apps/graph-builder/graphBuilder.js -goldEvalCheck \
           --buildLogDirPath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/buildLogs/edfiOnlyRoundTrip_20260816-070445 </dev/null

     3. Build the graph ONLY -- reproduce a graph from a manifest already in the store. No forging,
        no bridge runs, no Voyage or LLM; provisions one DEV_ container. --manifestRefId is the
        manifest id -build printed (here the single-forge Ed-Fi manifest from the F3b run).

         node apps/graph-builder/graphBuilder.js -replay \
           --standardsDatabaseFilePath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/graphBuilder/forgeFramework_edfi_migrated.standardsDatabase.sqlite3 \
           --manifestRefId=da574bf184877bfb971e88d988f374bd13a25b027b13439d785b53bb05a910a8 </dev/null

     4. Forge ONLY, without spending -- there is no forge-only verb (the forger is an in-process
        module of graphBuilder), so the closest is a build with embedding switched off: forge +
        materialize, no Voyage credit; the block id will DIFFER from the vectorized one (no
        embeddingRef lines), so this is a rehearsal, never an acceptance run.

         node --max-old-space-size=20000 apps/graph-builder/graphBuilder.js -build \
           --recipePath=/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/recipes/edfiOnly.recipe.jsonc \
           --vectorize=false \
           --standardsDatabaseFilePath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/graphBuilder/rehearsal_edfi.standardsDatabase.sqlite3 </dev/null

        To run the forge in-process with no container at all, use the bundle's own hermetic suite
        (embedder null; the framework's step 5 runs end to end):

         node forges/edfi/test/test-forgeEdfi.js </dev/null

     5. Bridging with the DEBUG JUDGE over a WINDOW of source elements -- exercises the whole
        bridging chain at ZERO Opus cost; --limit/--offset window the source elements (sorted by
        stableId, so the window is reproducible); the decision block is marked PARTIAL_WINDOW; every
        node and edge carries decisionAlgorithm 'INVALID_DEBUG'. --useDebugJudge REQUIRES a
        --rebridge scope. (STATUS 2026-08-16: bridge-maker is a stub that refuses by name; these
        flags are the graphBuilder contract and will drive the new bridge system when it lands.)

         node --max-old-space-size=20000 apps/graph-builder/graphBuilder.js -build \
           --recipePath=/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/recipes/fourWithHub.recipe.jsonc \
           --rebridge=edfi --useDebugJudge=digest --limit=10 --offset=50 \
           --standardsDatabaseFilePath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/graphBuilder/debugJudge_edfi.standardsDatabase.sqlite3 \
           --embeddingCacheFilePath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/vectorCache/vectorCache.sqlite3 </dev/null

     6. Validate a recipe before building it (free):

         node apps/graph-builder/graphBuilder.js -validate \
           --recipePath=/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/recipes/edfiOnlyRoundTrip.recipe.jsonc </dev/null

     7. List the standard tokens and versions the builder can resolve (free):

         node apps/graph-builder/graphBuilder.js -deps </dev/null

     8. The four-forge proof (the manifest that must reproduce 97c618c2...; ~10 min warm cache;
        one DEV_ container; stop other scratch containers first, Docker memory is tight):

         mkdir -p /Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/buildLogs/forgeFramework/fourWithHub-tq1
         node --max-old-space-size=20000 apps/graph-builder/graphBuilder.js -build \
           --recipePath=/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/recipes/fourWithHub-baseline.recipe.jsonc \
           --vectorize=true \
           --standardsDatabaseFilePath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/graphBuilder/forgeFramework_fourWithHub_tq1.standardsDatabase.sqlite3 \
           --embeddingCacheFilePath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/vectorCache/vectorCache.sqlite3 \
           </dev/null 2>&1 | tee /Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/buildLogs/forgeFramework/fourWithHub-tq1/build.log

        Or through the acceptance runner:  node lib/forge-framework/test/acceptance/runAcceptanceCommand.js -finalProof --phaseToken=tq1

     9. Read the ids out of a build log:

         grep -a "standardBase\|manifestId" /Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/buildLogs/forgeFramework/edfi-tq1/build.log

    10. Find and rename the container a build minted (GNC-001: DEV_ names for scratch; never rm -v):

         docker ps --format '{{.Names}}\t{{.Ports}}' | grep DEV_gb_
         docker rename DEV_gb_materialize_<pid>_1 DEV_edfi_tq1
         docker stop DEV_edfi_tq1        # when done; the volume stays

    11. The framework's own gates (hermetic, no container, no credit; every gate has a twin):

         node lib/forge-framework/test/test-gKit.js </dev/null          # one family
         node test/runAllTests.js </dev/null                             # the whole fleet, all forges

    12. The Ed-Fi pre-migration probes (census, PROXY fingerprint, name types, whitespace, key
        orders; free, no container) -- what a migration runs BEFORE writing its thin file:

         node forges/edfi/test/runEdfiPreMigrationProbes.js </dev/null

SEE ALSO
     graphBuilder -help            the builder's own manpage (-build, -replay, -goldEvalCheck)
     README_HOWTO_ForgeCreationInstructions.md, README_ForgeProfile.md,
     README_ForgeFrameworkSpecification.md, README_MILO_ForgeWorkOrientation.md
