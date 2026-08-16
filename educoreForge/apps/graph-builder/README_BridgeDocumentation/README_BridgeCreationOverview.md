NAME
     bridge plugin -- how one standard's elements are mapped onto the CEDS hub, by declaration,
     through the shared bridge framework, into a frozen decision block that graphBuilder replays

SYNOPSIS
     From system/code/educoreForge. A bridge runs INSIDE a graph build (Phase C of graphBuilder
     -build): the forges make the standards' subgraphs, then each `bridges[]` entry of the recipe
     runs its plugin through the framework. Three shapes of the same command:

     (1) FREEZE under the debug judge -- zero LLM cost; the shape every gate run uses:

         node --max-old-space-size=20000 apps/graph-builder/graphBuilder.js -build \
           --recipePath=recipes/fourWithHubEdfiBridge.recipe.jsonc \
           --vectorize=true \
           --rebridge=edfi --useDebugJudge=digest \
           --standardsDatabaseFilePath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/graphBuilder/bridge_edfi_<run>.standardsDatabase.sqlite3 \
           --decisionStoreFilePath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/bridgeAcceptance/edfi/edfi.decisions.sqlite3 \
           --judgmentCacheFilePath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/bridgeAcceptance/edfi/judgmentCache.sqlite3 \
           --matchForensicsDirPath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/bridgeAcceptance/edfi/matchForensics \
           --embeddingCacheFilePath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/vectorCache/vectorCache.sqlite3 \
           </dev/null 2>&1 | tee /Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/buildLogs/bridge/edfi-<run>/build.log

     (2) FREEZE under the REAL judge -- the one run that spends credit, on the judged share only
         (drop --useDebugJudge; everything else identical; the judgment cache makes it free the
         second time).

     (3) REPLAY -- a plain build with NO --rebridge and NO --useDebugJudge: the frozen block is
         materialised verbatim, zero LLM, zero Voyage, SAME block id. That is the proof.

     <run> is a label you choose so runs do not overwrite each other. --decisionStoreFilePath is
     PINNED in the frozen command (otherwise it defaults to a sibling of the standards database
     and a fresh scratch database silently starts a fresh, empty decision store). The frozen
     per-plugin lines live in lib/bridge-framework/test/acceptance/acceptanceCommands.jsonc.
     </dev/null is not optional: graphBuilder blocks on non-TTY stdin.

DESCRIPTION
     THE MATCHMAKER. Imagine a hall with two long tables. On one table sit the CEDS hub's CARDS
     -- every card names one concept (a Global ID like P000006), the class it belongs to, sometimes
     the property, the range, a qualifier. On the other table sit one standard's ELEMENTS --
     Ed-Fi's Student.FirstName, SIF's cedsId column, whatever that standard says about itself.
     A BRIDGE is the record of which element is introduced to which card, and on what authority.

     The PLUGIN is the standard's chaperone. It does exactly two things: it hands the framework a
     DECLARATION -- a form saying "here is where you find, in MY paperwork, the hub's Global ID,
     the class, the property, the range; here is my table of what my labels ('Yes', 'Partial',
     'Maybe') mean in SKOS; here is how you tell my elements apart" -- and it WALKS its own
     paperwork, reading out one assertion at a time ("Student.FirstName says P000106 in class
     C200001, label Yes"). It never touches the cards. It never says "these two are married."

     The FRAMEWORK is the matchmaker. For every assertion it takes the tuple fields the source
     supplied and finds the cards that fit ALL of them. Exactly ONE card fits: SPECIFIED -- the
     source said so, the predicate comes from the source's own label. MORE THAN ONE fits: JUDGED
     -- the framework asks the JUDGE (an LLM, or its debug double for rehearsals) to choose among
     that pool by ordinal, and records the choice with confidence; the plugin cannot reach the
     judge. NONE fits: ORPHAN, reported. Two SOURCES disagree about one subject: CONFLICT --
     refused, written to a MappingReview record, never resolved by guessing.

     THE LEDGER. When the walk is done the framework writes ONE frozen, content-addressed
     DECISION BLOCK: every subject, its resolution, the card, the predicate, the census, the
     digests of every input, the framework's own fingerprint. The graph is the REPLAY of that
     ledger. A plain build materialises it verbatim -- zero LLM, zero embeddings -- and produces the
     same block id, which is how you know nothing invented itself in between.

     THE EDGES. Only the framework mints mapping edges (through graphWriter.js, the kit-only
     door), from resolved cards only, each carrying matchBasis (crosswalk | standard),
     resolution (specified | judged), and a SKOS predicate; both endpoints receive the
     pair-scoped label BridgedRelation_<SOURCE>_<HUB> so graphBuilder's harvest can find them.
     A plugin cannot mint an edge, address a card by join key, override a predicate, or emit to
     an unresolved target. The SSSOM export beside the block is the same ledger in the standard
     mapping vocabulary.

THE FLOW IN PROSE
     graphBuilder builds the forges. Then, for each bridge in the recipe: the framework validates
     the plugin's declaration (every required key present, every channel's columns verified by
     count and name, no per-standard branch anywhere -- refused by name otherwise). It opens the
     graph through ONE reader with two views: forWalk() shows the plugin its own declared columns;
     forEvidence() is blinded (nodes and edges) so the judge never sees the answer. It reads the hub
     cards. The plugin walks its assertions; the framework groups them by subject, resolves each
     subject to a forged node (subjectStableIdFor), applies the hub-owned remodel table, filters
     the cards, counts, classifies through one ordered registry (first match wins), calls the
     judge only for MANY, freezes the block, materialises the edges, exports SSSOM, and reports
     the census. Replay is the same path with the judge never called.

THE FLOW AS PSEUDO-CODE
     for bridge in recipe.bridges:
         plugin       = registry[bridge.name]                 # discovered under forges/<std>/bridges/
         validate(plugin.declaration)                         # refuse by name; no defaults
         reader       = graphReader(inGraph, plugin.declaration.blinding)
         hubCards     = reader.readHubCards(hub)
         assertions   = plugin.walkSourceAssertions(reader.forWalk())
         subjects     = groupBySubject(assertions, plugin.subjectStableIdFor)
         for subject in subjects:
             pool     = filterCards(hubCards, subject.tupleFields)   # every supplied field
             pool     = sortByStableId(pool)
             row      = classify(pool, subject)                     # ordered registry, first match
             if row.kind == 'judged': choice = judge(render(pool, reader.forEvidence()))
         block        = freezeDecisionBlock(subjects, census, digests, frameworkFingerprint)
         edges        = materialise(block)                          # writer = the only door
         exportSssom(block); report(census)

TERMS
     hub card        one CEDS concept as the hub forge emitted it (HubReference; identity tuple ->
                     addressSignature; canonicalKey = Global ID)
     assertion       one source row/property saying "my element X relates to hub key K [in class
                     D] [label L]"
     subject         one source element (path-distinguished; common-type properties under common/)
     specified/judged/orphan/conflict
                     the four outcomes of the filter; the Profile's cardinality rule
     decision block  the frozen ledger; content-addressed; the graph is its replay
     pair-scoped label
                     BridgedRelation_<SOURCE>_<HUB>, stamped on both endpoints of every mapping edge
     twin            the fault a gate must be OBSERVED catching; every conjunct has one

WHAT A PLUGIN SUPPLIES / WHAT THE FRAMEWORK OWNS
     plugin:    declaration (identity, matchBasis, producerKind, channels + columns, tuple-field
                map, label->SKOS table, subject-identity rule, blinding, compat declarations),
                walkSourceAssertions(view), subjectStableIdFor(view, subjectKey)
     framework: reading, grouping, filtering, classification registry, the judge + debug double,
                the judgment cache, forensics, freezing, materialising, SSSOM, census, refusals,
                the compliance report, the plugin registry, the gates

HOW A BRIDGE IS PROVEN
     Its census EQUALS the frozen fixture for a NAMED graph (frozen from the first accepted
     classifier run, never from prose arithmetic); every edge carries the three properties; zero
     UnspecifiedMatching; SSSOM validates; the seven Profile gates and the framework's gate
     families are green with every conjunct observed red; replay reproduces the block id; and
     -goldEvalCheck (which refuses any invalid-debug edge in a certified graph) still PASSES.
     Composability is proven the same way the forge framework proves it: a SECOND plugin (SIF)
     through the same seam with ZERO framework diff -- a framework byte changed is a red gate.

EXAMPLES
     Run every bridge gate (hermetic; no container, no LLM):
         cd lib/bridge-framework && for f in test/test-bg*.js; do node "$f" </dev/null; done

     The whole fleet:
         node test/runAllTests.js </dev/null

     Certification on a build's run directory:
         node apps/graph-builder/graphBuilder.js -goldEvalCheck \
           --buildLogDirPath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/buildLogs/fourWithHubEdfiBridge_<stamp> </dev/null

     Rehearse a plugin cheaply on a subset of subjects (debug judge, first 40 after 100):
         ... -build --recipePath=recipes/fourWithHubEdfiBridge.recipe.jsonc --rebridge=edfi \
             --useDebugJudge=digest --limit=40 --offset=100 ... </dev/null

     Where the SSSOM landed:
         ls <matchForensicsDirPath>/<pairKey>/<blockId>.sssom.tsv

SEE ALSO
     README_BridgeProfile.md (normative: what a mapping is), README_BridgeFrameworkSpecification.md
     (normative: the framework, the plugin contract, the gates), README_MILO_BridgeWorkOrientation.md,
     ../README_ForgeDocumentation/ (the forge side; the bridge framework mirrors it deliberately),
     ../DOCTRINE.md, `node apps/graph-builder/graphBuilder.js -help` (the flags in full).
